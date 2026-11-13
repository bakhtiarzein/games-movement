import * as THREE from 'three';
import { analyzeSwing, poseTimeline, type PoseSample, type SwingTrace } from '@games/motion-core';
import { MotionInput, Particles } from '@games/shell';
import { GolfStage } from './scene';
import { HOLES, type Hole } from './holes';
import {
  DRIVER, IRON, PUTTER, WEDGE, FULL_SWING_SPEED, azimuthTo, chooseClub, distTo, flightPos, planFullShot, planPutt,
  suggestedPower, surfaceAt, type Club, type Pt, type ShotPlan, type Surface,
} from './physics';
import { Sfx } from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ANCHOR = { hx: 0.5, hy: 0.28 };       // titik pusat ayunan di mode mouse (satuan lebar gambar)
const MIN_FULL_PEAK = 2.4;                   // L/s: di bawah ini ayunan penuh diabaikan sebagai gerakan iseng
const MIN_PUTT_PEAK = 0.9;

/* ---------- engine gerakan ---------- */
const input = new MotionInput({
  profileKey: 'neongolf-profile',
  engine: { pose: { stickLengthM: 0.6, worldWidthM: 1.6, depthGainM: 1.0 } },
  mouse: { anchor: ANCHOR },
  onNotice: (t, s) => banner(t, s),
});
const engine = input.engine;
const stage = new GolfStage($('stage'));
const fx = new Particles(stage.scene);
const sfx = new Sfx();

let fullSpeed = FULL_SWING_SPEED;
try { const v = +(localStorage.getItem('neongolf-fullspeed') ?? 0); if (v > 3 && v < 30) fullSpeed = v; } catch { /* abaikan */ }

type Mode = 'menu' | 'calibrate' | 'playing' | 'over';
type Phase = 'address' | 'flight' | 'roll' | 'result' | 'holeEnd';
const G = {
  mode: 'menu' as Mode, phase: 'address' as Phase, hole: 0, strokes: 0, scores: [] as number[], pars: [] as number[],
  ball: { x: 0, z: 0 } as Pt, prev: { x: 0, z: 0 } as Pt, lie: 'tee' as Surface,
  aimOffset: 0, forcedClub: null as Club | null, club: DRIVER as Club, aim: 0,
  plan: null as ShotPlan | null, t: 0, rollLen: [] as number[], rollTotal: 0, rollT: 0, rollDur: 1,
  nextAt: 0, shots: 0, best: 0, lastMetrics: null as ReturnType<typeof analyzeSwing> | null,
};
try { G.best = +(localStorage.getItem('neongolf-best') ?? 0) || 0; } catch { /* abaikan */ }
const holeNow = (): Hole => HOLES[G.hole];
const now = () => performance.now() / 1000;
const V3 = (p: Pt, y = 0) => new THREE.Vector3(p.x, y, p.z);
const fwd = (azDeg: number) => new THREE.Vector3(Math.sin((azDeg * Math.PI) / 180), 0, -Math.cos((azDeg * Math.PI) / 180));

/* ---------- pose -> klub di layar ---------- */
const clubState = { px: 0, py: 0, quat: new THREE.Quaternion(), speed01: 0, has: false };
engine.on('pose', (p: PoseSample) => {
  clubState.px = p.world.position.x; clubState.py = p.world.position.y;
  clubState.quat.set(p.world.quaternion[0], p.world.quaternion[1], p.world.quaternion[2], p.world.quaternion[3]);
  clubState.speed01 = Math.min(1, p.speed / 12); clubState.has = true;
});
engine.on('trackingChanged', ({ tracking }) => { if (!tracking) clubState.has = false; });
engine.on('trace', onTrace);

/* ---------- alur ---------- */
function startRound() {
  sfx.init();
  G.mode = 'playing'; G.hole = 0; G.scores = []; G.pars = []; G.shots = 0;
  $('menu').classList.add('hidden'); $('over').classList.add('hidden');
  input.setPlaying(true);
  startHole();
}

function startHole() {
  const h = holeNow();
  stage.setHole(h);
  G.ball = { ...h.tee }; G.prev = { ...h.tee }; G.lie = 'tee'; G.strokes = 0; G.aimOffset = 0; G.forcedClub = null; G.plan = null;
  $('holeNo').textContent = String(G.hole + 1); $('par').textContent = String(h.par);
  banner(`LUBANG ${G.hole + 1}`, `${h.name} · par ${h.par} · ${Math.round(distTo(h.tee, h.pin))} m`);
  toAddress(true);
}

function toAddress(snap = false) {
  const h = holeNow();
  G.phase = 'address'; G.plan = null;
  G.club = G.lie === 'green' ? PUTTER : (G.forcedClub ?? chooseClub(h, G.ball, G.lie));
  G.aim = azimuthTo(G.ball, h.pin) + G.aimOffset;
  placeAddressCamera(snap);
  stage.setBall(G.ball.x, 0, G.ball.z);
  renderHud();
}

function placeAddressCamera(snap: boolean) {
  const f = fwd(G.aim), put = G.club === PUTTER;
  const pos = V3(G.ball).addScaledVector(f, put ? -5.5 : -11).add(new THREE.Vector3(0, put ? 2.2 : 3.8, 0));
  const look = V3(G.ball).addScaledVector(f, put ? 12 : 45).add(new THREE.Vector3(0, put ? 0.3 : 2.5, 0));
  stage.moveCamera(pos, look, 3.2, snap);
}

function onTrace(trace: SwingTrace) {
  if (G.mode !== 'playing' || G.phase !== 'address') return;
  const m = analyzeSwing(trace);
  if (!m.valid) return;
  const h = holeNow(), putt = G.club === PUTTER;
  if (putt ? m.peakSpeed < MIN_PUTT_PEAK : m.peakSpeed < MIN_FULL_PEAK) { banner('TERLALU PELAN', 'ayunan lebih cepat melewati bawah'); sfx.bad(); return; }
  G.lastMetrics = m;
  const power = m.peakSpeed / fullSpeed;
  const plan = putt
    ? planPutt(h, G.ball, m.peakSpeed, m.quality, m.leanDeg, G.aim)
    : planFullShot(h, G.ball, { club: G.club, power, quality: m.quality, leanDeg: m.leanDeg, pathAngleDeg: m.pathAngleDeg, aimDeg: G.aim, lie: G.lie, wind: h.wind });
  G.strokes++; G.shots++; G.prev = { ...G.ball }; G.plan = plan;
  showCard(m, power, plan, putt);
  launch(plan, clamp(power, 0, 1.2));
}

function launch(plan: ShotPlan, power: number) {
  stage.setAim(V3(G.ball), 0, 0, false);
  sfx.swing(power); setTimeout(() => sfx.hit(power), 90);
  stage.addShake(0.2 + power * 0.3); stage.post.kick(0.8);
  fx.burst(V3(G.ball, 0.4), new THREE.Color(1.3, 1.3, 1.1), 18, 3, undefined, 1);
  G.t = 0;
  if (plan.kind === 'putt') { startRoll(plan); } else { G.phase = 'flight'; }
  renderHud();
}

function startRoll(plan: ShotPlan) {
  G.phase = 'roll';
  G.rollLen = [0];
  for (let i = 1; i < plan.roll.length; i++) G.rollLen.push(G.rollLen[i - 1] + distTo(plan.roll[i - 1], plan.roll[i]));
  G.rollTotal = G.rollLen[G.rollLen.length - 1];
  G.rollDur = clamp(G.rollTotal / (plan.kind === 'putt' ? 5 : 7), 0.35, 4.5);
  G.rollT = 0;
}

function finishShot() {
  const plan = G.plan!, h = holeNow();
  if (plan.holed) return holeOut();
  if (plan.penalty) {
    G.strokes++; G.ball = { ...G.prev }; G.lie = surfaceAt(h, G.ball);
    banner('AIR!', '+1 stroke · ulangi dari posisi sebelumnya'); sfx.bad(); stage.addShake(0.4);
  } else {
    G.ball = { ...plan.final }; const s = plan.finalSurface; G.lie = s === 'tree' ? 'rough' : s === 'water' ? 'rough' : s;
    if (s === 'tree') banner('POHON!', 'bola tersangkut di semak');
    else if (s === 'sand') banner('BUNKER', 'pakai wedge dan ayun lebih kuat');
    else if (G.lie === 'green' && plan.kind === 'full') banner('DI GREEN', `${distTo(G.ball, h.pin).toFixed(1)} m ke lubang · putt!`);
    else banner(`${Math.round(plan.distance)} m`, `sisa ${Math.round(distTo(G.ball, h.pin))} m ke lubang`);
  }
  if (G.strokes >= h.par + 5) { banner('ANGKAT BOLA', 'batas stroke tercapai'); return holeOut(true); }
  G.phase = 'result'; G.nextAt = now() + 1.3;
  renderHud();
}

function holeOut(pickup = false) {
  const h = holeNow();
  G.phase = 'holeEnd'; G.scores.push(G.strokes); G.pars.push(h.par);
  const d = G.strokes - h.par;
  const name = pickup ? 'ANGKAT BOLA' : G.strokes === 1 ? 'HOLE IN ONE!' : d <= -2 ? 'EAGLE!' : d === -1 ? 'BIRDIE!' : d === 0 ? 'PAR' : d === 1 ? 'BOGEY' : `+${d}`;
  banner(name, `${G.strokes} stroke · par ${h.par}`);
  if (!pickup) { sfx.cup(); stage.addShake(0.35); fx.burst(V3(h.pin, 0.6), new THREE.Color(1.8, 1.3, 0.5), 60, 7); stage.post.kick(1.1); }
  G.nextAt = now() + 3.4; renderHud();
}

function nextHoleOrEnd() {
  if (G.hole + 1 < HOLES.length) { G.hole++; startHole(); return; }
  endRound();
}
function endRound() {
  G.mode = 'over';
  const total = G.scores.reduce((a, b) => a + b, 0), par = G.pars.reduce((a, b) => a + b, 0), d = total - par;
  const score = Math.max(0, 1000 - d * 100 - total * 10);
  if (score > G.best) { G.best = score; try { localStorage.setItem('neongolf-best', String(G.best)); } catch { /* abaikan */ } }
  $('finalScore').textContent = `${total} (${d === 0 ? 'E' : d > 0 ? '+' + d : d})`;
  $('bestLine').innerHTML = G.scores.map((s, i) => `Lubang ${i + 1}: <b>${s}</b> / par ${G.pars[i]}`).join('<br>') + `<br>Skor akhir ${score} · terbaik ${G.best}`;
  setTimeout(() => $('over').classList.remove('hidden'), 600);
  input.setPlaying(false);
}

/* ---------- HUD ---------- */
function banner(text: string, sub: string) {
  const b = $('banner'); b.innerHTML = `${text}<small>${sub}</small>`;
  b.style.color = ['#2fe3ff', '#ff3fa4', '#ffc24d', '#8f5bff'][G.shots % 4];
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function renderHud() {
  const h = holeNow();
  const d = distTo(G.ball, h.pin);
  $('score').textContent = G.mode === 'playing' ? `${d.toFixed(d < 20 ? 1 : 0)} m` : '–';
  const done = G.scores.reduce((a, b) => a + b, 0) - G.pars.reduce((a, b) => a + b, 0);
  $('lives').innerHTML = `STROKE <b>${G.strokes}</b><br>TOTAL ${G.scores.length ? (done === 0 ? 'E' : done > 0 ? '+' + done : done) : '–'}`;
  $('club').textContent = G.club.name + (G.forcedClub ? ' (manual)' : '');
  const w = h.wind;
  $('wind').textContent = `angin ${w === 0 ? 'tenang' : (w > 0 ? '→ ' : '← ') + Math.abs(w) + ' m/s'}`;
  const sp = suggestedPower(G.club, G.lie, d);
  $('need').textContent = sp.kind === 'lps' ? `butuh ≈ ${sp.value.toFixed(1)} L/s` : `butuh ≈ ${Math.round(sp.value)}% kekuatan`;
  $('full').textContent = `penuh = ${fullSpeed.toFixed(0)} L/s`;
}
function showCard(m: ReturnType<typeof analyzeSwing>, power: number, plan: ShotPlan, putt: boolean) {
  const c = $('card');
  const curveTxt = Math.abs(plan.curve) < 1 ? 'lurus' : `lengkung ${plan.curve > 0 ? 'kanan' : 'kiri'} ${Math.abs(plan.curve).toFixed(0)} m`;
  c.innerHTML = `<b>KUALITAS ${Math.round(m.quality * 100)}%</b><br>
    Kecepatan <b>${m.peakSpeed.toFixed(1)}</b> L/s (${Math.round(power * 100)}% dari penuh)<br>
    Tempo <b>${m.tempo ? m.tempo.toFixed(1) : '–'}:1</b> · bidang ayun <b>${m.planeDeviationDeg.toFixed(0)}°</b><br>
    Kemiringan saat kena <b>${m.leanDeg > 0 ? '+' : ''}${m.leanDeg.toFixed(0)}°</b>${putt ? '' : ' → ' + curveTxt}`;
  c.classList.add('show'); setTimeout(() => c.classList.remove('show'), 5200);
}

/* ---------- menu & input ---------- */
$('bAgain').onclick = () => startRound();
$('bMenu').onclick = () => { input.setPlaying(false); G.mode = 'menu'; $('over').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('bCam').onclick = async () => {
  sfx.init();
  const err = await input.startCamera(() => startRound());
  if (err) { $('err').textContent = err; return; }
  G.mode = 'calibrate'; $('menu').classList.add('hidden');
};
$('bMouse').onclick = () => {
  input.startMouse();
  const r = $('ring'); r.style.display = 'block';
  const place = () => { const rad = 0.27 * innerWidth; r.style.width = r.style.height = rad * 2 + 'px'; r.style.left = ANCHOR.hx * innerWidth - rad + 'px'; r.style.top = (ANCHOR.hy / 0.75) * innerHeight - rad + 'px'; };
  place(); addEventListener('resize', place);
  startRound();
};

addEventListener('keydown', e => {
  if (G.mode !== 'playing' || G.phase !== 'address') return;
  const redo = () => { G.club = G.lie === 'green' ? PUTTER : (G.forcedClub ?? chooseClub(holeNow(), G.ball, G.lie)); G.aim = azimuthTo(G.ball, holeNow().pin) + G.aimOffset; placeAddressCamera(false); renderHud(); sfx.tick(); };
  if (e.key === 'ArrowLeft') { G.aimOffset -= 1.5; redo(); }
  if (e.key === 'ArrowRight') { G.aimOffset += 1.5; redo(); }
  if (e.key === '0') { G.forcedClub = null; redo(); }
  if (e.key === '1') { G.forcedClub = DRIVER; redo(); }
  if (e.key === '2') { G.forcedClub = IRON; redo(); }
  if (e.key === '3' && !input.isCameraCalibrating) { G.forcedClub = WEDGE; redo(); }
  if (e.key === '-' || e.key === '=') {
    fullSpeed = clamp(fullSpeed + (e.key === '=' ? 1 : -1), 4, 25);
    try { localStorage.setItem('neongolf-fullspeed', String(fullSpeed)); } catch { /* abaikan */ }
    renderHud();
  }
});

/* ---------- loop ---------- */
const trail = { last: 0 };
let last = performance.now();
function frame(t: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  input.step(t);

  const playing = G.mode === 'playing';
  stage.updateClub(clubState.px, clubState.py, clubState.quat, clubState.speed01, playing && G.phase === 'address' && clubState.has, dt);

  // indikator siap/sedang merekam
  const rd = $('ready'); rd.className = engine.swingRecording ? 'rec' : engine.swingReady ? 'on' : '';

  if (playing && G.phase === 'address') {
    const h = holeNow();
    const d = distTo(G.ball, h.pin);
    const len = G.club === PUTTER ? Math.min(d, 25) : Math.min(G.club.max, d + 5);
    stage.setAim(V3(G.ball), G.aim, len, true);
    stage.setBall(G.ball.x, 0, G.ball.z);
  } else if (playing && G.phase === 'flight' && G.plan) {
    G.t += dt;
    const p = flightPos(G.plan, G.t);
    stage.setBall(p.x, Math.max(0, p.y), p.z);
    const f = fwd(G.plan.azimuthDeg);
    stage.moveCamera(new THREE.Vector3(p.x, 0, p.z).addScaledVector(f, -16).add(new THREE.Vector3(0, 7 + p.y * 0.4, 0)), new THREE.Vector3(p.x, p.y * 0.6, p.z).addScaledVector(f, 24), 2.4);
    if (t - trail.last > 16) { fx.burst(new THREE.Vector3(p.x, p.y + 0.3, p.z), new THREE.Color(1, 1, 1), 1, 0.3); trail.last = t; }
    if (G.t >= G.plan.T) {
      const surf = surfaceAt(holeNow(), G.plan.landing);
      stage.setBall(G.plan.landing.x, 0, G.plan.landing.z);
      if (surf === 'water') { sfx.splash(); fx.burst(V3(G.plan.landing, 0.4), new THREE.Color(0.7, 1.4, 2), 50, 7); stage.addShake(0.3); }
      else if (surf === 'sand') { sfx.sand(); fx.burst(V3(G.plan.landing, 0.3), new THREE.Color(1.6, 1.3, 0.8), 40, 5); }
      else { sfx.land(); fx.burst(V3(G.plan.landing, 0.2), new THREE.Color(0.5, 1.2, 0.5), 22, 3); }
      startRoll(G.plan);
    }
  } else if (playing && G.phase === 'roll' && G.plan) {
    G.rollT += dt;
    const u = clamp(G.rollT / G.rollDur, 0, 1), s = (1 - (1 - u) * (1 - u)) * G.rollTotal;
    const pts = G.plan.roll;
    let i = 1; while (i < pts.length - 1 && G.rollLen[i] < s) i++;
    const a = pts[i - 1] ?? pts[0], b = pts[i] ?? pts[0];
    const seg = (G.rollLen[i] ?? 0) - (G.rollLen[i - 1] ?? 0) || 1;
    const k = clamp((s - (G.rollLen[i - 1] ?? 0)) / seg, 0, 1);
    const x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
    stage.setBall(x, 0, z);
    const f = fwd(G.plan.azimuthDeg);
    stage.moveCamera(new THREE.Vector3(x, 0, z).addScaledVector(f, G.plan.kind === 'putt' ? -5 : -16).add(new THREE.Vector3(0, G.plan.kind === 'putt' ? 2.2 : 6, 0)), new THREE.Vector3(x, 0.5, z).addScaledVector(f, G.plan.kind === 'putt' ? 10 : 22), 2.2);
    if (u >= 1) finishShot();
  } else if (playing && G.phase === 'result' && now() >= G.nextAt) {
    toAddress();
  } else if (playing && G.phase === 'holeEnd' && now() >= G.nextAt) {
    nextHoleOrEnd();
  }

  fx.update(dt);
  stage.render(dt);
}
renderHud();
stage.setHole(HOLES[0]);
stage.setBall(0, 0, 0, false);
stage.moveCamera(new THREE.Vector3(0, 6, 16), new THREE.Vector3(0, 3, -60), 3, true);
requestAnimationFrame(frame);

/* ---------- bantuan tes otomatis ---------- */
/**
 * Ayunan sintetis tampak depan (mode mouse). `peak` = kecepatan puncak yang diinginkan (L/s);
 * durasi downswing dikalibrasi dari pengukuran engine (dur x peak ~ 3.9 untuk ayunan penuh, ~2.05 untuk putt).
 * Hanya untuk tes.
 */
function testSwing(kind: 'full' | 'putt' = 'full', lean = 0, peak = 9) {
  const base = { hx: ANCHOR.hx, hy: ANCHOR.hy, angleDeg: 90 };
  const full = kind === 'full';
  // amplitudo backswing mengikuti kekuatan agar backswing tidak lebih cepat dari downswing (seperti ayunan nyata)
  const A = Math.min(full ? 125 : 60, 20.6 * peak), Ar = (A * Math.PI) / 180;
  const down = Math.max(0.1, (1.78 * Ar) / peak);
  const follow = Math.max(full ? 0.3 : 0.5, down * (full ? 1.3 : 1.4));
  input.playScript(poseTimeline([
    { dur: 0.5, to: base, mode: 'hold' },
    { dur: full ? 0.9 : 0.7, to: { ...base, angleDeg: 90 + A }, mode: 'ease' },
    { dur: 0.08, to: { ...base, angleDeg: 90 + A }, mode: 'hold' },
    { dur: down, to: { ...base, angleDeg: 90 + lean }, mode: 'in' },
    { dur: follow, to: { ...base, angleDeg: 90 - A * 0.95 }, mode: 'out' },
    { dur: 0.8, to: { ...base, angleDeg: 90 - A * 0.95 }, mode: 'hold' },
  ], base, { fps: 60 }));
}
(window as unknown as { __game: unknown }).__game = { G, engine, input, stage, testSwing, HOLES, surfaceAt, holeNow };
