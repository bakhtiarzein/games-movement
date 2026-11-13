import * as THREE from 'three';
import { poseTimeline, type PoseSample, type WorldPose } from '@games/motion-core';
import { MotionInput, Particles } from '@games/shell';
import { bladeSweepVsSphere, type Segment } from '@games/game-kit';
import { TennisStage, Racket, BallMesh, Opponent, RACKET_SCALE, POS_GAIN_X, POS_GAIN_Y, Y_HAND, Z_DEPTH_GAIN } from './scene';
import {
  BALL_R, COURT, Z_HIT, Z_OPP, inCourt, planShot, predictAtPlane, stepBall, type Ball,
} from './physics';
import { Sfx } from './audio';

/* ---------- konstanta gameplay ---------- */
const SWING_MIN = 2.0;        // L/s: di bawah ini sentuhan tidak memukul bola
const HIT_RADIUS = 1.05;      // radius kepala raket yang dimurahkan (kamera 30 fps tidak presisi)
const HIT_Z_SQUASH = 0.25;    // tumbukan hampir 2D
const HIT_ZONE = 2.6;         // bola hanya bisa dipukul di Z_HIT ± ini
const REACH = 1.1;            // jangkauan lawan
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ---------- engine gerakan + dunia ---------- */
const input = new MotionInput({
  profileKey: 'neonmatch-profile',
  engine: { pose: { stickLengthM: 0.6, worldWidthM: 1.6, depthGainM: 1.0 }, gesture: { startThreshold: SWING_MIN } },
  onNotice: (t, s) => banner(t, s),
});
const engine = input.engine;
const stage = new TennisStage($('stage'));
const racket = new Racket(stage.scene, RACKET_SCALE);
const ballMesh = new BallMesh(stage.scene);
const opp = new Opponent(stage.scene);
const fx = new Particles(stage.scene);
const sfx = new Sfx();

type Mode = 'menu' | 'calibrate' | 'playing' | 'over';
type Phase = 'wait' | 'toPlayer' | 'toOpp' | 'dead';
const G = {
  mode: 'menu' as Mode, phase: 'wait' as Phase, lastHitBy: 'opp' as 'opp' | 'player',
  score: 0, rally: 0, bestRally: 0, lives: 3, level: 0, winners: 0, returns: 0, hits: 0, misses: 0,
  serveAt: 0, best: 0, oppMoveAt: 0, ballVisible: false,
};
try { G.best = +(localStorage.getItem('neonmatch-best') ?? 0); } catch { /* abaikan */ }
const ball: Ball = { x: 0, y: 1, z: Z_OPP, vx: 0, vy: 0, vz: 0 };
const bounces = { player: 0, opp: 0 };

/* ---------- pose -> raket ---------- */
const target = { pos: new THREE.Vector3(0, Y_HAND, Z_HIT), quat: new THREE.Quaternion(), speed01: 0, has: false, snap: true };
function toGame(w: WorldPose) {
  return {
    pos: new THREE.Vector3(w.position.x * POS_GAIN_X, clamp(Y_HAND + w.position.y * POS_GAIN_Y, 0.15, 4.6), Z_HIT + w.position.z * RACKET_SCALE * Z_DEPTH_GAIN),
    quat: new THREE.Quaternion(w.quaternion[0], w.quaternion[1], w.quaternion[2], w.quaternion[3]),
  };
}
const headFrom = (pos: THREE.Vector3, quat: THREE.Quaternion): Segment => {
  const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
  const a = pos.clone().addScaledVector(dir, 0.3 * RACKET_SCALE), b = pos.clone().addScaledVector(dir, 0.62 * RACKET_SCALE);
  return { a, b };
};
const sq = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: Z_HIT + (v.z - Z_HIT) * HIT_Z_SQUASH });
let prevSeg: Segment | null = null;
let lastPose: PoseSample | null = null;

engine.on('trackingChanged', ({ tracking }) => { target.snap = true; prevSeg = null; if (!tracking) target.has = false; });
engine.on('pose', pose => {
  lastPose = pose;
  const g = toGame(pose.world);
  target.pos.copy(g.pos); target.quat.copy(g.quat); target.has = true;
  target.speed01 = Math.min(1, pose.speed / 10);
  const seg = headFrom(g.pos, g.quat);
  if (G.mode === 'playing' && prevSeg && pose.speed >= SWING_MIN && G.phase === 'toPlayer' && G.lastHitBy === 'opp') testHit(prevSeg, seg, pose);
  prevSeg = seg;
});

/* ---------- pukulan pemain ---------- */
function testHit(prev: Segment, cur: Segment, pose: PoseSample) {
  if (ball.vz <= 0 || Math.abs(ball.z - Z_HIT) > HIT_ZONE) return;
  const hit = bladeSweepVsSphere(
    { a: sq(prev.a), b: sq(prev.b) }, { a: sq(cur.a), b: sq(cur.b) }, sq(ball), HIT_RADIUS + BALL_R,
  );
  if (hit) playerHit(pose);
}

const marker = { mesh: null as THREE.Mesh | null, t: 0 };
function showMarker(x: number, z: number) {
  if (marker.mesh) stage.scene.remove(marker.mesh);
  const m = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.5, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.8, 2), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); stage.scene.add(m); marker.mesh = m; marker.t = 0;
}

function playerHit(pose: PoseSample) {
  const vx = pose.velocity.x, vy = -pose.velocity.y;          // y atas
  const vm = Math.hypot(vx, vy) || 1;
  const dx = vx / vm, dy = vy / vm;
  const power = clamp(pose.speed / 10, 0.15, 1);
  // arah ayunan -> arah bola; kecepatan -> kedalaman; ayunan naik -> lob
  const aimX = clamp(dx * 4.2, -4.6, 4.6);
  const aimZ = -(2.5 + power * 7.6);
  const lift = clamp(dy, 0, 1);
  const T0 = THREE.MathUtils.lerp(1.4, 0.85, power) + lift * 0.85;
  const from = { x: ball.x, y: ball.y, z: ball.z };
  const plan = planShot(from, aimX, aimZ, T0, 0.25) ?? planShot(from, aimX * 0.5, -6, 1.8, 0.2, 3.5);
  if (!plan) return;
  ball.vx = plan.vx; ball.vy = plan.vy; ball.vz = plan.vz;
  G.lastHitBy = 'player'; G.phase = 'toOpp'; bounces.player = 0; bounces.opp = 0;
  G.rally++; G.returns++; G.hits++; G.bestRally = Math.max(G.bestRally, G.rally);
  const pts = 10 + 2 * G.rally; G.score += pts;
  const kmh = Math.round(Math.hypot(plan.vx, plan.vy, plan.vz) * 3.6);
  const label = plan.T >= 1.75 ? 'LOB' : power > 0.8 ? 'SMASH' : power > 0.5 ? 'DRIVE' : 'TOUCH';
  banner(label, `${kmh} km/j · ${Math.abs(aimX) > 3 ? 'melebar' : 'tengah'}`);
  sfx.hit(power); stage.addShake(0.15 + power * 0.35); stage.post.kick(0.9);
  fx.burst(new THREE.Vector3(ball.x, ball.y, ball.z), new THREE.Color(1.1, 1.5, 0.5), 24 + Math.round(power * 20), 4 + power * 4, undefined, 1);
  if (power > 0.6) hitstop = 0.05;
  scorePop(ball, `+${pts}`);
  showMarker(aimX, aimZ);
  // lawan membaca bola dan mulai berlari setelah jeda reaksi
  const pred = predictAtPlane(ball, Z_OPP);
  opp.targetX = clamp(pred ? pred.x : 0, -COURT.halfW - 0.8, COURT.halfW + 0.8);
  G.oppMoveAt = performance.now() / 1000 + Math.max(0.15, 0.5 - 0.03 * G.level);
  oppTarget = opp.targetX; opp.targetX = opp.x; // diam dulu sampai waktu reaksi lewat
  renderHud();
}
let oppTarget = 0;
let hitstop = 0;

/* ---------- lawan & alur poin ---------- */
function serve() {
  G.phase = 'wait';
  const bx = rand(-3.4, 3.4), bz = rand(4.2, 6.2);
  const from = { x: rand(-1.5, 1.5), y: 1.0, z: Z_OPP };
  const plan = planShot(from, bx, bz, Math.max(1.25, 1.75 - 0.04 * G.level), 0.3);
  if (!plan) { G.serveAt = now() + 0.3; return; }
  Object.assign(ball, { x: from.x, y: from.y, z: from.z, vx: plan.vx, vy: plan.vy, vz: plan.vz });
  G.phase = 'toPlayer'; G.lastHitBy = 'opp'; bounces.player = 0; bounces.opp = 0; G.ballVisible = true;
  opp.x = from.x; opp.targetX = 0; opp.hit(); sfx.serve();
  if (marker.mesh) { stage.scene.remove(marker.mesh); marker.mesh = null; }
}

function oppReturn() {
  const from = { x: ball.x, y: clamp(ball.y, 0.7, 1.6), z: Z_OPP };
  const spread = Math.min(3.7, 2.4 + 0.15 * G.level);
  const bx = clamp(rand(-1, 1) * spread, -3.7, 3.7), bz = rand(3.8, 6.4);
  const plan = planShot(from, bx, bz, Math.max(1.15, 1.7 - 0.05 * G.level), 0.28);
  if (!plan) return;
  Object.assign(ball, { x: from.x, y: from.y, z: from.z, vx: plan.vx, vy: plan.vy, vz: plan.vz });
  G.phase = 'toPlayer'; G.lastHitBy = 'opp'; bounces.player = 0; bounces.opp = 0;
  opp.hit(); opp.targetX = 0; sfx.oppHit();
  fx.burst(new THREE.Vector3(ball.x, ball.y, ball.z), new THREE.Color(1.5, 0.5, 1), 14, 3);
}

function winner() {
  G.phase = 'dead'; G.winners++; G.level++;
  const pts = 50 + 10 * G.rally; G.score += pts;
  banner('WINNER!', `+${pts} · lawan makin cepat (lv ${G.level + 1})`);
  sfx.winner(); stage.addShake(0.5); stage.post.kick(1.1);
  fx.burst(new THREE.Vector3(ball.x, ball.y, Z_OPP - 0.5), new THREE.Color(1.6, 1.3, 0.4), 70, 7);
  G.serveAt = now() + 1.9; G.rally = 0; renderHud();
}
function oppFault(why: string) {
  G.phase = 'dead'; G.score += 20; banner(why, '+20 · servis ulang'); sfx.net();
  G.serveAt = now() + 1.5; G.rally = 0; renderHud();
}
function losePoint(why: string) {
  if (G.phase === 'dead') return;
  G.phase = 'dead'; G.lives--; G.misses++; G.rally = 0;
  banner(why, G.lives > 0 ? `sisa nyawa ${G.lives}` : 'permainan selesai'); sfx.miss(); stage.addShake(0.6); flash(); renderHud();
  if (G.lives <= 0) endGame(); else G.serveAt = now() + 1.9;
}

function onBallEvent(e: ReturnType<typeof stepBall>[number]) {
  if (G.phase === 'dead' || G.phase === 'wait') return;
  if (e.type === 'net') {
    sfx.net(); stage.addShake(0.25);
    if (G.lastHitBy === 'player') losePoint('NET'); else oppFault('NET LAWAN');
    return;
  }
  sfx.bounce();
  fx.burst(new THREE.Vector3(e.x, 0.1, e.z), new THREE.Color(0.8, 0.9, 1.2), 6, 1.6);
  if (G.lastHitBy === 'opp') {
    if (e.z > 0 && e.count === 1 && !inCourt(e.x, e.z, 'player')) oppFault('OUT LAWAN');
    else if (e.z > 0 && e.count >= 2) losePoint('TERLEWAT');
  } else if (e.z < 0 && e.count === 1 && !inCourt(e.x, e.z, 'opp')) {
    losePoint('OUT');
  }
}

const now = () => performance.now() / 1000;
function physics(dt: number) {
  if (G.phase !== 'toPlayer' && G.phase !== 'toOpp' && G.phase !== 'dead') return;
  const h = 1 / 120;
  let left = dt;
  while (left > 1e-6) {
    const d = Math.min(h, left); left -= d;
    const events = stepBall(ball, d, bounces);
    for (const e of events) onBallEvent(e);
    if (G.phase === 'toOpp' && ball.z <= Z_OPP && ball.vz < 0) {
      const reachable = Math.abs(ball.x - opp.x) <= REACH && ball.y > 0.15 && ball.y < 3.0 && Math.random() > Math.max(0.04, 0.16 - 0.01 * G.level);
      if (reachable) oppReturn(); else winner();
    }
    if (G.phase === 'toPlayer' && ball.z > Z_HIT + HIT_ZONE + 0.3) { losePoint('MISS'); }
    if (ball.y < -5 || Math.abs(ball.z) > 40) { if (G.phase !== 'dead') { G.phase = 'dead'; G.serveAt = now() + 1; } else if (G.serveAt === 0) G.serveAt = now() + 0.5; G.ballVisible = false; }
  }
}

/* ---------- HUD ---------- */
function banner(text: string, sub: string) {
  const b = $('banner'); b.innerHTML = `${text}<small>${sub}</small>`;
  b.style.color = ['#2fe3ff', '#ff3fa4', '#ffc24d', '#8f5bff'][(G.hits + G.misses) % 4];
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function scorePop(p: { x: number; y: number; z: number }, text: string) {
  const v = new THREE.Vector3(p.x, p.y, p.z).project(stage.camera);
  const el = document.createElement('div'); el.className = 'pop'; el.textContent = text;
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth) + 'px'; el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 950);
}
function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }
function renderHud() {
  $('score').textContent = String(G.score);
  $('combo').textContent = G.rally > 1 ? `RELI ×${G.rally}` : '';
  $('lvl').textContent = G.mode === 'playing' ? `LEVEL ${G.level + 1}` : '';
  $('lives').innerHTML = [0, 1, 2].map(i => `<i class="${i < G.lives ? 'on' : ''}">♥</i>`).join('');
}

/* ---------- alur game ---------- */
function startGame() {
  sfx.init();
  Object.assign(G, { score: 0, rally: 0, lives: 3, level: 0, winners: 0, returns: 0, hits: 0, misses: 0, bestRally: 0, mode: 'playing', phase: 'wait', serveAt: now() + 1.2, ballVisible: false });
  opp.x = 0; opp.targetX = 0; oppTarget = 0; G.oppMoveAt = 0;
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
  input.setPlaying(true); renderHud();
  banner('SIAP!', 'gerakkan raket ke bola, lalu ayunkan');
}
function endGame() {
  G.mode = 'over';
  if (G.score > G.best) { G.best = G.score; try { localStorage.setItem('neonmatch-best', String(G.best)); } catch { /* abaikan */ } }
  $('finalScore').textContent = String(G.score);
  $('bestLine').textContent = `Terbaik: ${G.best} · reli terpanjang ${G.bestRally} · ${G.winners} winner`;
  setTimeout(() => $('over').classList.remove('hidden'), 900);
  input.setPlaying(false);
}
$('bAgain').onclick = () => startGame();
$('bMenu').onclick = () => { input.setPlaying(false); G.mode = 'menu'; $('over').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('bCam').onclick = async () => {
  sfx.init();
  const err = await input.startCamera(() => startGame());
  if (err) { $('err').textContent = err; return; }
  G.mode = 'calibrate'; $('menu').classList.add('hidden');
};
$('bMouse').onclick = () => { input.startMouse(); startGame(); };

/* ---------- loop ---------- */
let last = performance.now();
function frame(t: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  input.step(t);
  let sdt = dt;
  if (hitstop > 0) { hitstop -= dt; sdt = dt * 0.1; }

  const visible = G.mode !== 'menu' && target.has;
  racket.update(target.pos, target.quat, target.speed01, dt, visible, target.snap);
  if (target.has) target.snap = false;

  if (G.mode === 'playing' && (G.phase === 'wait' || G.phase === 'dead') && G.serveAt > 0 && now() >= G.serveAt) { G.serveAt = 0; serve(); }
  if (G.mode === 'playing' || G.mode === 'over') physics(sdt);
  if (G.oppMoveAt && now() >= G.oppMoveAt) { opp.targetX = oppTarget; G.oppMoveAt = 0; }
  opp.update(sdt, 2.8 + 0.28 * G.level);

  ballMesh.set(ball.x, ball.y, ball.z, G.ballVisible && (G.phase === 'toPlayer' || G.phase === 'toOpp' || G.phase === 'dead'));
  if (G.ballVisible && G.phase !== 'wait' && Math.hypot(ball.vx, ball.vz) > 4) fx.burst(new THREE.Vector3(ball.x, ball.y, ball.z), new THREE.Color(0.7, 0.9, 0.3), 1, 0.4);
  ballMesh.mesh.rotation.x += sdt * 12; ballMesh.mesh.rotation.z += sdt * 7;
  fx.update(sdt);
  if (marker.mesh) {
    marker.t += dt; const k = marker.t / 1.6;
    marker.mesh.scale.setScalar(1 + Math.sin(marker.t * 8) * 0.12);
    (marker.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    if (k >= 1) { stage.scene.remove(marker.mesh); marker.mesh = null; }
  }
  stage.render(dt);
}
renderHud();
requestAnimationFrame(frame);

/* ---------- bantuan tes otomatis ---------- */
/** Memainkan satu ayunan sintetis (mode mouse) yang menjemput bola yang sedang datang. Hanya untuk tes. */
function autoSwing(dirX = 1) {
  const pred = predictAtPlane(ball, Z_HIT);
  if (!pred) return false;
  const headDist = 0.46 * RACKET_SCALE;
  const hx = pred.x / POS_GAIN_X / 1.6 + 0.5;
  const worldY = (pred.y - headDist - Y_HAND) / POS_GAIN_Y;
  const hy = 0.375 - worldY / 1.6;
  const lead = Math.max(0, pred.t - 0.1);
  const base = { hx: hx - 0.12 * dirX, hy, angleDeg: -90 };
  input.playScript(poseTimeline([
    { dur: lead, to: base, mode: 'hold' },
    { dur: 0.2, to: { ...base, hx: hx + 0.12 * dirX }, mode: 'lin' },
    { dur: 0.3, to: { ...base, hx: hx + 0.12 * dirX }, mode: 'hold' },
  ], base, { fps: 60 }));
  return true;
}
(window as unknown as { __game: unknown }).__game = { G, engine, input, ball, opp, autoSwing, get lastPose() { return lastPose; } };
