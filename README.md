# games-movement

Game 3D yang dikendalikan gerakan tongkat lewat webcam. Tongkat berpenanda warna: **ujung hijau** dan **gagang biru**.

```
packages/motion-core   engine pembaca gerakan (TypeScript murni, tanpa Three.js)
packages/game-kit      helper tumbukan/skor yang netral terhadap game
apps/sword             game "Neon Blade" (Three.js)
apps/lab               alat kalibrasi dan diagnosis tracker
```

## Menjalankan

```bash
npm install
npm run dev:sword   # game        -> http://localhost:5173
npm run dev:lab     # lab tracker -> http://localhost:5174
npm test            # tes engine dan game-kit
npm run typecheck
```

Kamera butuh `localhost` atau HTTPS. Game punya **mode demo (mouse)** yang tidak memerlukan webcam
(Spasi = tusuk ke kamera).

## Arsitektur engine (`motion-core`)

```
FrameSource ──► Tracker ──► Observation ──► PoseEstimator ──► PoseSample ──► SwingRecognizer ──► GestureEvent
(webcam)        (warna)     (2D, direkam)    (filter, L/s,      (pose dunia     (slice/chop/
                                              kedalaman)         2.5D)           tusuk, ...)
```

Game hanya memakai dua keluaran:

```ts
const engine = new MotionEngine();
engine.on('pose', p => sword.set(p.world.position, p.world.quaternion)); // kontinu, per frame
engine.on('gesture', g => { /* g.kind, g.direction, g.power, g.speedMps */ }); // diskret
webcam.onFrame(f => engine.pushFrame(f));
```

- **Satuan L/s** (panjang tongkat per detik): kecepatan tidak bergantung jarak ke kamera.
- **Kedalaman** dari ketebalan gagang (silinder, tidak terpengaruh foreshortening). Tanda kemiringan
  ambigu dari satu kamera; diasumsikan ujung lebih dekat ke kamera daripada tangan (maju dari tubuh).
- **Tracker bisa ditukar**: cukup menghasilkan `Observation`. `engine.pushObservation()` juga dipakai
  oleh mode mouse dan oleh tes.
- **Rekam dan putar ulang**: `startRecording()` / `stopRecording()` / `replay()` untuk tes deterministik.
- **Profil kalibrasi**: `exportProfile()` / `importProfile()`.

## Batas yang diketahui

- Satu webcam = 2.5D; kedalaman hanya perkiraan.
- Tracker saat ini berjalan di main thread. Jika render berat membuat frame kamera terbuang, pindahkan
  `ColorTracker.process` ke Web Worker (antarmukanya sudah tanpa DOM).
- Motion blur saat ayunan cepat bisa membuat ujung hilang; ukur dengan lab ("Ujung hilang saat ayunan").
  Pencahayaan terang dan kamera 60 fps sangat membantu. Penanda bola/LED di ujung adalah jalur upgrade.
- Validasi sejauh ini memakai video kamera sintetis dan tes unit, bukan webcam sungguhan.
