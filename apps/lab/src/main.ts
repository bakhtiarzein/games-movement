import { MotionEngine, WebcamSource, type GestureEvent, type PoseSample } from '@games/motion-core';

/** Lab diagnosis: kalibrasi warna, lihat apa yang "dilihat" tracker, dan uji deteksi gerakan. Memakai engine yang sama dengan game. */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'motionlab-profile';
const engine = new MotionEngine();
try { const p = localStorage.getItem(KEY); if (p) engine.importProfile(JSON.parse(p)); } catch { /* abaikan */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(engine.exportProfile())); } catch { /* abaikan */ } };

const view = $<HTMLCanvasElement>('view'), vctx = view.getContext('2d')!;
const mview = $<HTMLCanvasElement>('maskview'), mctx = mview.getContext('2d')!;
let webcam: WebcamSource | null = null;
let pickMode: 'tip' | 'handle' | null = null;
let trail: { x: number; y: number; s: number; t: number }[] = [];
let pose: PoseSample | null = null;
let lastPeak = 0, lastLost = 0;
let frames = 0, fpsT = performance.now(), procMs = 0;

/* ---------- kontrol ---------- */
function syncUI() {
  const c = engine.cfg;
  ($('tol') as HTMLInputElement).value = String(c.tracker.hueTolerance); $('vTol').textContent = c.tracker.hueTolerance + '°';
  ($('sat') as HTMLInputElement).value = String(c.tracker.tip.sMin); $('vSat').textContent = c.tracker.tip.sMin.toFixed(2);
  ($('startThr') as HTMLInputElement).value = String(c.gesture.startThreshold); $('vStart').textContent = c.gesture.startThreshold.toFixed(1) + ' L/s';
  ($('zThr') as HTMLInputElement).value = String(c.gesture.thrustThreshold); $('vZ').textContent = c.gesture.thrustThreshold.toFixed(1) + ' /s';
  $('thrMark').style.left = Math.min(100, (c.gesture.startThreshold / 15) * 100) + '%';
}
$('tol').oninput = e => { engine.setConfig({ tracker: { hueTolerance: +(e.target as HTMLInputElement).value } }); syncUI(); save(); };
$('sat').oninput = e => { const v = +(e.target as HTMLInputElement).value; engine.setConfig({ tracker: { tip: { sMin: v }, handle: { sMin: v } } }); syncUI(); save(); };
$('startThr').oninput = e => { engine.setConfig({ gesture: { startThreshold: +(e.target as HTMLInputElement).value } }); syncUI(); };
$('zThr').oninput = e => { engine.setConfig({ gesture: { thrustThreshold: +(e.target as HTMLInputElement).value } }); syncUI(); };
$('showMask').onchange = e => { $('maskview').style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none'; };
$('resetColors').onclick = () => { engine.setConfig({ tracker: { tip: { h: 140, sMin: 0.35, vMin: 0.3 }, handle: { h: 225, sMin: 0.4, vMin: 0.2 }, hueTolerance: 28 } }); syncUI(); save(); };
function setPick(m: 'tip' | 'handle' | null) {
  pickMode = pickMode === m ? null : m;
  $('pickTip').classList.toggle('on', pickMode === 'tip'); $('pickHandle').classList.toggle('on', pickMode === 'handle');
  const h = $('hint'); h.style.display = pickMode ? 'block' : 'none';
  h.textContent = pickMode ? 'Klik pada warna ' + (pickMode === 'tip' ? 'UJUNG' : 'GAGANG') + ' tongkat di gambar kamera.' : '';
}
$('pickTip').onclick = () => setPick('tip');
$('pickHandle').onclick = () => setPick('handle');
const calibrate = () => { engine.calibrate(); save(); setStatus('Panjang acuan & kedalaman dikalibrasi.'); };
$('calLen').onclick = calibrate;
addEventListener('keydown', e => { if (e.key === 'c' || e.key === 'C') calibrate(); });
view.addEventListener('click', e => {
  if (!pickMode) return;
  const r = view.getBoundingClientRect();
  const p = engine.pickColor(pickMode, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  if (!p) { setStatus('Warna terlalu abu-abu untuk dipilih.', true); return; }
  setStatus(`Warna ${pickMode === 'tip' ? 'ujung' : 'gagang'}: hue ${p.h}°`); save(); syncUI(); setPick(pickMode);
});
function setStatus(m: string, err = false) { const s = $('status'); s.textContent = m; s.className = err ? 'err' : ''; }
syncUI();

/* ---------- peristiwa ---------- */
const ARROW: Record<string, string> = { right: '→', left: '←', up: '↑', down: '↓', 'up-right': '↗', 'up-left': '↖', 'down-right': '↘', 'down-left': '↙' };
engine.on('pose', p => { pose = p; trail.push({ x: p.tip.x, y: p.tip.y, s: p.speed, t: performance.now() }); if (trail.length > 24) trail.shift(); });
engine.on('gesture', (g: GestureEvent) => {
  const li = document.createElement('li'); if (g.depth) li.className = 'z';
  const at = (performance.now() / 1000).toFixed(1);
  li.innerHTML = g.depth
    ? `<span style="color:var(--dim)">${at}s</span> <b>TUSUK</b> ⤓ maju ke kamera · zoom ${g.peak.toFixed(1)}/s · ${(g.durationMs / 1000).toFixed(2)}s`
    : `<span style="color:var(--dim)">${at}s</span> <b>${g.kind.toUpperCase()}</b> ${ARROW[g.direction]} ${g.direction} · ${g.peak.toFixed(1)} L/s (${Math.round(g.power * 100)}%) · ${(g.durationMs / 1000).toFixed(2)}s · lurus ${g.straightness.toFixed(2)}${g.arc ? ' · melengkung' : ''}`;
  const log = $('log'); log.prepend(li); while (log.children.length > 40) log.lastChild!.remove();
  const b = $('banner'); b.innerHTML = `${g.kind.toUpperCase()} ${g.depth ? '⤓' : ARROW[g.direction]}<small>${g.depth ? 'zoom ' + g.peak.toFixed(1) + '/s' : g.peak.toFixed(1) + ' L/s · ' + g.direction}</small>`;
  b.style.transition = 'none'; b.style.opacity = '1';
  requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transition = 'opacity 1.1s'; b.style.opacity = '0'; }));
  if (!g.depth) lastPeak = g.peak;
  lastLost = g.lostFrames;
});

/* ---------- render ---------- */
function render() {
  if (!webcam) return;
  const { width: pw, height: ph } = webcam.size;
  if (view.width !== 640) { view.width = 640; view.height = Math.round((640 * ph) / pw); }
  const w = view.width;
  vctx.save(); vctx.setTransform(-1, 0, 0, 1, w, 0); vctx.drawImage(webcam.video, 0, 0, w, view.height); vctx.restore();
  const now = performance.now();
  vctx.lineCap = 'round';
  for (let i = 1; i < trail.length; i++) {
    if (now - trail[i].t > 450) continue;
    const k = Math.min(1, trail[i].s / (engine.cfg.gesture.startThreshold * 1.8));
    vctx.strokeStyle = `rgba(255,${Math.round(220 - 160 * k)},${Math.round(90 - 60 * k)},${0.25 + 0.7 * (i / trail.length)})`;
    vctx.lineWidth = 3 + 8 * k; vctx.beginPath(); vctx.moveTo(trail[i - 1].x * w, trail[i - 1].y * w); vctx.lineTo(trail[i].x * w, trail[i].y * w); vctx.stroke();
  }
  const o = engine.lastObservation;
  const ring = (x: number, y: number, c: string) => { vctx.strokeStyle = c; vctx.lineWidth = 3; vctx.beginPath(); vctx.arc(x * w, y * w, 14, 0, 6.2832); vctx.stroke(); vctx.fillStyle = c; vctx.beginPath(); vctx.arc(x * w, y * w, 3, 0, 6.2832); vctx.fill(); };
  if (pose && engine.isTracking) {
    vctx.strokeStyle = '#ffe14d'; vctx.lineWidth = 2; vctx.beginPath(); vctx.moveTo(pose.handle.x * w, pose.handle.y * w); vctx.lineTo(pose.tip.x * w, pose.tip.y * w); vctx.stroke();
    ring(pose.tip.x, pose.tip.y, '#46e07a'); ring(pose.handle.x, pose.handle.y, '#4c8dff');
  }
  if (o && (!o.tip || !o.handle)) {
    vctx.fillStyle = '#ffb84d'; vctx.font = '600 13px system-ui';
    vctx.fillText(!o.tip && !o.handle ? 'Tongkat tidak terdeteksi' : !o.tip ? 'Ujung (hijau) tidak terlihat' : 'Gagang (biru) tidak terlihat', 12, 22);
  }
  if (($('showMask') as HTMLInputElement).checked) {
    const { width: mw, height: mh } = engine.tracker.size;
    if (mw) {
      if (mview.width !== mw) { mview.width = mw; mview.height = mh; }
      const img = mctx.createImageData(mw, mh), d = img.data, mt = engine.tracker.maskTip, mh2 = engine.tracker.maskHandle;
      for (let i = 0; i < mw * mh; i++) { const p = i * 4; d[p + 1] = mt[i] ? 230 : 0; d[p + 2] = mh2[i] ? 255 : 0; d[p + 3] = 255; }
      mctx.putImageData(img, 0, 0);
    }
  }
  $('kSpeed').textContent = pose ? pose.speed.toFixed(1) + ' L/s' : '–';
  $('spdBar').style.width = Math.min(100, ((pose?.speed ?? 0) / 15) * 100) + '%';
  $('kPeak').textContent = lastPeak ? lastPeak.toFixed(1) + ' L/s' : '–';
  $('kZ').textContent = pose ? pose.depthRate.toFixed(1) + ' /s' : '–';
  $('kPitch').textContent = pose ? pose.pitchDeg.toFixed(0) + '°' : '–';
  $('kAngle').textContent = pose ? pose.angleDeg.toFixed(0) + '°' : '–';
  $('kMs').textContent = procMs.toFixed(1) + ' ms';
  $('kLost').textContent = lastLost + ' frame';
}

/* ---------- kamera ---------- */
$('start').onclick = async () => {
  try {
    webcam = new WebcamSource({ processWidth: 320 });
    webcam.onFrame(f => {
      const t0 = performance.now();
      engine.pushFrame(f);
      procMs = procMs * 0.9 + (performance.now() - t0) * 0.1;
      frames++; const n = performance.now(); if (n - fpsT > 1000) { $('kFps').textContent = String(Math.round((frames * 1000) / (n - fpsT))); frames = 0; fpsT = n; }
      render();
    });
    await webcam.start();
    const fr = webcam.settings.frameRate;
    setStatus(`Kamera aktif ${webcam.video.videoWidth}×${webcam.video.videoHeight} @ ${fr ? Math.round(fr) : '?'} fps (diminta 60).`);
    $('start').style.display = 'none';
  } catch (err) { setStatus('Gagal membuka kamera: ' + (err as Error).message, true); }
};
if (new URLSearchParams(location.search).has('auto')) $('start').click();
(window as unknown as { lab: unknown }).lab = { engine };
