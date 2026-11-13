import * as THREE from 'three';
import {
  MotionEngine, WebcamSource, syntheticObservation, poseTimeline,
  type GestureEvent, type PoseSample, type WorldPose,
} from '@games/motion-core';
import { bladeSweepVsSphere, scoreHit, type Segment } from '@games/game-kit';
import { Stage, SCALE, Z_BASE, Z_DEPTH_GAIN, Y_CENTER } from './stage';
import { Sword, BLADE_START, BLADE_LEN } from './sword';
import { BladeTrail, Particles } from './fx';
import { Targets, type Target } from './targets';
import { Sfx } from './audio';

/* ---------- konstanta gameplay ---------- */
const CUT_SPEED = 2.2;       // L/s: di bawah ini sentuhan tidak memotong
const HIT_Z_SQUASH = 0.3;    // tumbukan hampir 2D: kedalaman hanya berpengaruh sedikit
const COMBO_WINDOW = 1.6;    // detik
const PROFILE_KEY = 'neonblade-profile';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- engine gerakan (dipakai ulang oleh game lain) ---------- */
const engine = new MotionEngine({ pose: { stickLengthM: BLADE_LEN, worldWidthM: 1.6, depthGainM: 1.0 } });
try { const p = localStorage.getItem(PROFILE_KEY); if (p) engine.importProfile(JSON.parse(p)); } catch { /* abaikan */ }
const saveProfile = () => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(engine.exportProfile())); } catch { /* abaikan */ } };

/* ---------- dunia 3D ---------- */
const stage = new Stage($('stage'));
const sword = new Sword(stage.scene, SCALE);
const fx = new Particles(stage.scene);
const trail = new BladeTrail(stage.scene);
const targets = new Targets(stage.scene, fx);
const sfx = new Sfx();

type Mode = 'menu' | 'calibrate' | 'playing' | 'over';
const G = {
  mode: 'menu' as Mode, input: null as null | 'camera' | 'mouse',
  score: 0, combo: 0, lives: 3, best: 0, lastSlice: -99, hits: 0, bombs: 0, gestures: 0, thrusts: 0, thrustReady: 0,
  poses: 0,
};
try { G.best = +(localStorage.getItem('neonblade-best') ?? 0); } catch { /* abaikan */ }

/* ---------- pose -> ruang game ---------- */
const target = { pos: new THREE.Vector3(0, Y_CENTER, Z_BASE), quat: new THREE.Quaternion(), speed01: 0, has: false, snap: true };
function toGame(w: WorldPose) {
  return {
    pos: new THREE.Vector3(w.position.x * SCALE, Y_CENTER + w.position.y * SCALE, Z_BASE + w.position.z * SCALE * Z_DEPTH_GAIN),
    quat: new THREE.Quaternion(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]),
  };
}
const segFrom = (pos: THREE.Vector3, quat: THREE.Quaternion) => {
  const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  return { a: pos.clone().addScaledVector(dir, BLADE_START * SCALE), b: pos.clone().addScaledVector(dir, BLADE_LEN * SCALE), dir };
};
const sq = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: Z_BASE + (v.z - Z_BASE) * HIT_Z_SQUASH });
let prevSeg: ReturnType<typeof segFrom> | null = null;
let lastPose: PoseSample | null = null;

engine.on('trackingChanged', ({ tracking }) => { target.snap = true; prevSeg = null; if (!tracking) target.has = false; updateChip(); });
engine.on('pose', pose => {
  G.poses++; lastPose = pose;
  const g = toGame(pose.world);
  target.pos.copy(g.pos); target.quat.copy(g.quat); target.has = true;
  target.speed01 = Math.min(1, pose.speed / 12);
  const seg = segFrom(g.pos, g.quat);
  if (G.mode === 'playing' && prevSeg && pose.speed > CUT_SPEED) testHits(prevSeg, seg, pose);
  prevSeg = seg;
});
engine.on('gesture', onGesture);

/* ---------- tebasan ---------- */
function testHits(prev: ReturnType<typeof segFrom>, cur: ReturnType<typeof segFrom>, pose: PoseSample) {
  const ps: Segment = { a: sq(prev.a), b: sq(prev.b) }, cs: Segment = { a: sq(cur.a), b: sq(cur.b) };
  for (const t of targets.items.slice()) {
    if (!t.alive) continue;
    const hit = bladeSweepVsSphere(ps, cs, sq(t.pos), t.radius * 1.2);
    if (!hit) continue;
    const swing = new THREE.Vector3(hit.tipDelta.x, hit.tipDelta.y, 0);
    if (swing.lengthSq() < 1e-6) swing.set(pose.velocity.x, -pose.velocity.y, 0);
    swing.normalize();
    onTargetHit(t, swing, Math.min(1, pose.speed / 12), cur.dir);
  }
}

function onTargetHit(t: Target, swing: THREE.Vector3, power: number, _bladeDir: THREE.Vector3) {
  const now = performance.now() / 1000;
  if (t.kind === 'bomb') {
    targets.explodeBomb(t);
    G.bombs++; G.combo = 0; G.lives--;
    sfx.bomb(); stage.addShake(1); flash(); renderHud();
    if (G.lives <= 0) endGame();
    return;
  }
  // bidang potong tegak lurus arah tebasan di layar -> belahan terlempar ke sisi
  const n = new THREE.Vector3(-swing.y, swing.x, 0).normalize();
  targets.slice(t, n, swing, power);
  G.combo = now - G.lastSlice < COMBO_WINDOW ? G.combo + 1 : 1;
  G.lastSlice = now; G.hits++;
  const pts = scoreHit(power, G.combo);
  G.score += pts;
  sfx.slice(power, G.combo);
  stage.addShake(0.1 + 0.3 * power); stage.pulse(t.color.getHex());
  if (power > 0.55) hitstop = 0.06;
  scorePop(t.pos, `+${pts}`, t.color);
  renderHud();
}

let hitstop = 0;

const GESTURE_LABEL: Record<string, string> = { slice: 'TEBAS', chop: 'BELAH', uppercut: 'TEBAS ATAS', diagonal: 'DIAGONAL', thrust: 'TUSUK' };
const ARROW: Record<string, string> = { right: '→', left: '←', up: '↑', down: '↓', 'up-right': '↗', 'up-left': '↖', 'down-right': '↘', 'down-left': '↙' };
function onGesture(g: GestureEvent) {
  G.gestures++;
  banner(GESTURE_LABEL[g.kind] + (g.depth ? ' ⤓' : ' ' + ARROW[g.direction]), g.depth ? `KEKUATAN ${Math.round(g.power * 100)}%` : `${g.peak.toFixed(1)} L/s · ${Math.round(g.power * 100)}%`);
  if (g.kind === 'thrust' && g.depth && G.mode === 'playing') shockwave(g.power);
}

/* ---------- gelombang kejut dari tusukan ---------- */
const rings: { mesh: THREE.Mesh; t: number }[] = [];
function shockwave(power: number) {
  const now = performance.now() / 1000;
  if (now < G.thrustReady) return;
  G.thrustReady = now + 2.5; G.thrusts++;
  sfx.thrust(); stage.addShake(0.8); hitstop = 0.08;
  const center = sword.group.position.clone().addScaledVector(segFrom(sword.group.position, sword.group.quaternion).dir, BLADE_LEN * SCALE);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 2, 2.2), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.copy(center); ring.position.z = Z_BASE + 0.2; stage.scene.add(ring); rings.push({ mesh: ring, t: 0 });
  const radius = 3.4 + power * 1.6;
  for (const t of targets.items.slice()) {
    const d = Math.hypot(t.pos.x - center.x, t.pos.y - center.y);
    if (d > radius) continue;
    if (t.kind === 'bomb') { targets.explodeBomb(t); continue; }
    const out = new THREE.Vector3(t.pos.x - center.x, t.pos.y - center.y, 0).normalize();
    if (out.lengthSq() === 0) out.set(1, 0, 0);
    targets.slice(t, new THREE.Vector3(-out.y, out.x, 0), out, 0.8);
    G.combo++; G.hits++; G.score += scoreHit(0.8, G.combo);
    scorePop(t.pos, `+${scoreHit(0.8, G.combo)}`, t.color);
  }
  renderHud();
}

/* ---------- HUD ---------- */
function banner(text: string, sub: string) {
  const b = $('banner'); b.innerHTML = `${text}<small>${sub}</small>`;
  b.style.color = ['#2fe3ff', '#ff3fa4', '#ffc24d', '#8f5bff'][G.gestures % 4];
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function scorePop(p: THREE.Vector3, text: string, color: THREE.Color) {
  const v = p.clone().project(stage.camera);
  const el = document.createElement('div'); el.className = 'pop'; el.textContent = text;
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  el.style.setProperty('--c', '#' + color.getHexString());
  document.body.appendChild(el); setTimeout(() => el.remove(), 950);
}
function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
function renderHud() {
  $('score').textContent = String(G.score);
  $('combo').textContent = G.combo > 1 ? `KOMBO ×${G.combo}` : '';
  $('lives').innerHTML = [0, 1, 2].map(i => `<i class="${i < G.lives ? 'on' : ''}">♥</i>`).join('');
}
function updateChip() {
  const c = $('chip');
  const lost = G.mode === 'playing' && G.input === 'camera' && !engine.isTracking;
  c.style.display = lost ? 'block' : 'none'; c.className = lost ? 'warn' : '';
  if (lost) c.textContent = 'Tongkat tidak terdeteksi — tampilkan ujung hijau & gagang biru ke kamera';
}

/* ---------- alur game ---------- */
function startGame() {
  sfx.init();
  G.score = 0; G.combo = 0; G.lives = 3; G.hits = 0; G.bombs = 0; G.thrusts = 0; G.mode = 'playing';
  targets.reset(); renderHud();
  $('menu').classList.add('hidden'); $('over').classList.add('hidden'); $('calib').style.display = 'none';
  $('pip').classList.remove('large'); $('pip').style.display = G.input === 'camera' ? 'block' : 'none';
  updateChip();
}
function endGame() {
  G.mode = 'over';
  if (G.score > G.best) { G.best = G.score; try { localStorage.setItem('neonblade-best', String(G.best)); } catch { /* abaikan */ } }
  $('finalScore').textContent = String(G.score);
  $('bestLine').textContent = `Terbaik: ${G.best} · ${G.hits} orb terbelah`;
  setTimeout(() => $('over').classList.remove('hidden'), 700);
  updateChip();
}
$('bAgain').onclick = () => startGame();
$('bMenu').onclick = () => { G.mode = 'menu'; $('over').classList.add('hidden'); $('menu').classList.remove('hidden'); };

/* ---------- input: mouse / sentuh (mode demo) ---------- */
const pointer = { nx: 0.5, ny: 0.5, inside: false, vx: 0, lastNx: 0.5, lean: 0 };
let script: Generator<ReturnType<typeof syntheticObservation>> | null = null;
addEventListener('pointermove', e => { pointer.nx = e.clientX / innerWidth; pointer.ny = e.clientY / innerHeight; pointer.inside = true; });
addEventListener('pointerdown', e => { pointer.nx = e.clientX / innerWidth; pointer.ny = e.clientY / innerHeight; pointer.inside = true; });
document.addEventListener('pointerleave', () => { pointer.inside = false; });
let lastMouseT = 0;
function mouseStep(now: number) {
  const dt = Math.max(0.001, (now - lastMouseT) / 1000); lastMouseT = now;
  if (script) {
    const r = script.next();
    if (!r.done) { engine.pushObservation({ ...r.value, t: now }); return; }
    script = null;
  }
  if (!pointer.inside) { engine.pushObservation({ t: now, aspect: 0.75, tip: null, handle: null }); return; }
  pointer.vx = pointer.vx * 0.8 + ((pointer.nx - pointer.lastNx) / dt) * 0.2; pointer.lastNx = pointer.nx;
  pointer.lean += (Math.max(-30, Math.min(30, pointer.vx * 14)) - pointer.lean) * 0.2;
  engine.pushObservation(syntheticObservation(now, { hx: pointer.nx, hy: pointer.ny * 0.75, angleDeg: -90 + pointer.lean }));
}
/** Spasi di mode demo = tusuk ke kamera (mendekat + memendek) */
function demoThrust() {
  if (G.input !== 'mouse' || script) return;
  const base = { hx: pointer.nx, hy: pointer.ny * 0.75, angleDeg: -90 };
  script = poseTimeline([
    { dur: 0.25, to: { ...base, k: 1.5, c: 0.5 }, mode: 'ease' },
    { dur: 0.5, to: { ...base, k: 1.5, c: 0.5 }, mode: 'hold' },
    { dur: 0.3, to: { ...base, k: 1, c: 1 }, mode: 'lin' },
  ], base, { fps: 60 });
}
addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); demoThrust(); }
  if (e.key === 'c' || e.key === 'C') { engine.calibrate(); saveProfile(); banner('KALIBRASI', 'panjang & kedalaman direset'); }
});

/* ---------- input: webcam ---------- */
let webcam: WebcamSource | null = null;
const pip = $<HTMLCanvasElement>('pip'); const pctx = pip.getContext('2d')!;
let pickMode: 'tip' | 'handle' | null = null;
function setPick(m: 'tip' | 'handle' | null) {
  pickMode = m;
  $('cTip').classList.toggle('on', m === 'tip'); $('cHandle').classList.toggle('on', m === 'handle');
  $('calibHelp').innerHTML = m ? `Klik warna <b>${m === 'tip' ? 'ujung (hijau)' : 'gagang (biru)'}</b> tongkat pada gambar kamera.` : 'Pilih warna ujung & gagang bila deteksi kurang pas, lalu pegang tongkat <b>mendatar</b> menghadap kamera dan tekan <b>3</b>.';
}
async function startCamera() {
  $('err').textContent = '';
  try {
    sfx.init();
    webcam = new WebcamSource({ processWidth: 320 });
    webcam.onFrame(f => engine.pushFrame(f));
    await webcam.start();
  } catch (e) {
    $('err').textContent = 'Kamera tidak bisa dibuka: ' + (e as Error).message + '. Coba mode demo, atau izinkan akses kamera.';
    return;
  }
  G.input = 'camera'; G.mode = 'calibrate';
  $('menu').classList.add('hidden'); $('calib').style.display = 'block';
  pip.style.display = 'block'; pip.classList.add('large'); setPick(null);
}
function startMouse() { G.input = 'mouse'; lastMouseT = performance.now(); startGame(); }
$('bCam').onclick = () => void startCamera();
$('bMouse').onclick = () => startMouse();
$('cTip').onclick = () => setPick(pickMode === 'tip' ? null : 'tip');
$('cHandle').onclick = () => setPick(pickMode === 'handle' ? null : 'handle');
$('cLen').onclick = () => { engine.calibrate(); saveProfile(); banner('KALIBRASI', 'panjang tongkat tersimpan'); };
$('cGo').onclick = () => { saveProfile(); startGame(); };
pip.addEventListener('click', e => {
  if (!pickMode) return;
  const r = pip.getBoundingClientRect();
  const p = engine.pickColor(pickMode, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  if (p) { saveProfile(); setPick(null); }
});
addEventListener('keydown', e => { if (G.mode === 'calibrate' && e.key === '3') $('cLen').click(); });

function drawPip() {
  if (!webcam || pip.style.display === 'none') return;
  const w = pip.width, h = pip.height = Math.round(pip.width * (webcam.video.videoHeight / webcam.video.videoWidth || 0.75));
  pctx.save(); pctx.setTransform(-1, 0, 0, 1, w, 0); pctx.drawImage(webcam.video, 0, 0, w, h); pctx.restore();
  const o = engine.lastObservation;
  if (o) {
    const ring = (b: { x: number; y: number } | null, c: string) => { if (!b) return; pctx.strokeStyle = c; pctx.lineWidth = 3; pctx.beginPath(); pctx.arc(b.x * w, b.y * w, 12, 0, 6.2832); pctx.stroke(); };
    ring(o.tip, '#46e07a'); ring(o.handle, '#4c8dff');
    if (o.tip && o.handle) { pctx.strokeStyle = '#ffe14d'; pctx.lineWidth = 2; pctx.beginPath(); pctx.moveTo(o.handle.x * w, o.handle.y * w); pctx.lineTo(o.tip.x * w, o.tip.y * w); pctx.stroke(); }
    if (!o.tip || !o.handle) { pctx.fillStyle = '#ffb84d'; pctx.font = '600 14px system-ui'; pctx.fillText(!o.tip && !o.handle ? 'Tongkat tidak terdeteksi' : !o.tip ? 'Ujung hijau tidak terlihat' : 'Gagang biru tidak terlihat', 10, 22); }
  }
}

/* ---------- loop ---------- */
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.input === 'mouse') mouseStep(now);
  let sdt = dt;
  if (hitstop > 0) { hitstop -= dt; sdt = dt * 0.08; }
  const t = now / 1000;

  const visible = G.mode !== 'menu' && target.has;
  sword.update(target.pos, target.quat, target.speed01, dt, visible, target.snap);
  if (target.has) target.snap = false;
  if (visible && target.speed01 * 12 > CUT_SPEED) { const s = sword.segment(); trail.push(s.a, s.b, t); }
  trail.update(t);

  const missed = targets.update(sdt, G.mode === 'playing');
  if (missed > 0 && G.mode === 'playing') { G.combo = 0; sfx.miss(); renderHud(); }
  if (G.combo && t - G.lastSlice > COMBO_WINDOW && G.mode === 'playing') { G.combo = 0; renderHud(); }
  fx.update(sdt);
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt; const k = r.t / 0.5;
    r.mesh.scale.setScalar(0.5 + k * 7); (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    if (k >= 1) { stage.scene.remove(r.mesh); rings.splice(i, 1); }
  }
  stage.render(dt);
  drawPip();
}
renderHud();
requestAnimationFrame(frame);
setInterval(updateChip, 300);

// untuk debugging dan tes otomatis
(window as unknown as { __game: unknown }).__game = { G, engine, targets, sword, stage, get lastPose() { return lastPose; } };
