# games-movement

Game 3D yang dikendalikan gerakan tongkat lewat webcam. Tongkat berpenanda warna: **ujung hijau** dan **gagang biru**.
Satu engine pembaca gerakan dipakai bersama oleh semua game.

```
packages/motion-core   engine pembaca gerakan (TypeScript murni, tanpa Three.js)
packages/game-kit      helper tumbukan/skor yang netral terhadap game
packages/shell         bagian browser bersama: input webcam/mouse + kalibrasi, bloom, partikel, audio
apps/sword             "Neon Blade"  — tebas orb (tebasan, tusukan)
apps/tennis            "Neon Match"  — reli melawan lawan AI (arah, kecepatan, lob)
apps/golf              "Neon Golf"   — 3 lubang (tempo, bidang ayun, kemiringan stik, putting)
apps/lab               alat kalibrasi dan diagnosis tracker
```

## Menjalankan di komputer lokal (Windows / Laragon / macOS / Linux)

Yang dibutuhkan: **Git** dan **Node.js ≥ 22.12** (disarankan 22 LTS; cek dengan `node -v`).
Game saja (`npm run dev:*`) cukup Node ≥ 20.19, tetapi `npm test` (vitest 5) butuh ≥ 22.12.
Tidak perlu Apache, PHP, atau MySQL: Vite punya server dev sendiri. Laragon boleh dipakai sebagai folder
dan terminalnya, tetapi tidak wajib. Folder bebas, tidak harus di `www`.

```bash
git clone https://github.com/bakhtiarzein/games-movement.git
cd games-movement
npm install
npm run dev:lab      # mulai dari sini: pastikan warna ujung/gagang terbaca di kamera (http://localhost:5174)
npm run dev:golf     # http://localhost:5176
```

Buka alamat yang tercetak di terminal lalu izinkan akses kamera. Perintah lain:

```bash
npm run dev:sword    # http://localhost:5173
npm run dev:tennis   # http://localhost:5175
npm test             # tes engine, tenis, golf, game-kit
npm run typecheck
npm run build
```

Catatan penting:

- **Kamera hanya diizinkan di `http://localhost` (atau HTTPS).** Jangan membukanya lewat virtual host Laragon
  `*.test` yang berbasis HTTP atau lewat alamat IP jaringan (mis. `http://192.168.x.x`): browser akan memblokir kamera.
  Mode demo (mouse/sentuh) tetap jalan di alamat mana pun.
- Ingin membuka dari HP di jaringan yang sama (hanya mode demo sentuh): jalankan `npm run dev:golf -- --host`.
- Tutup aplikasi lain yang sedang memakai webcam (Zoom, Teams, OBS) agar kamera bisa dibuka.
- Jika port bentrok, Vite memakai port berikutnya; lihat alamat yang dicetak di terminal.
- Jika repo privat, masuk ke GitHub lewat jendela login Git saat `git clone`.
- Perintah selalu diawali `npm` (mis. `npm run dev:lab`, bukan `run dev:lab`).
- Peringatan `tarball data ... seems to be corrupted. Trying again.` saat `npm install` biasanya akibat jaringan/antivirus;
  npm mengunduh ulang otomatis. Bila berakhir dengan galat `EINTEGRITY`, jalankan `npm cache clean --force` lalu ulangi.
- Peringatan `install scripts blocked ... esbuild` aman diabaikan: esbuild tetap berfungsi tanpa skrip postinstall-nya.
- Tidak perlu menjalankan `npm audit fix --force`; versi yang di-commit sudah bebas kerentanan (`npm audit` = 0).

## Cara main

| Game | Gerakan | Yang dibaca engine |
|---|---|---|
| **Neon Blade** | Tebas ke arah mana saja untuk membelah orb. **Tusuk ke kamera** = gelombang kejut. Hindari bom. | kecepatan & arah ayunan, kedalaman (ketebalan gagang) |
| **Neon Match** | Gerakkan raket ke bola, lalu ayunkan. **Arah ayunan** = arah bola, **kecepatan** = kedalaman, ayunan **naik** = lob. | pose raket 2.5D, arah/kecepatan saat kena |
| **Neon Golf** | Tongkat menggantung ke bawah, diam sampai lampu **SIAP** hijau, lalu ayun: backswing pelan, downswing cepat melewati bawah. | jejak ayunan penuh: tempo, bidang ayun, kemiringan saat kena |

Golf: kecepatan ayunan = jarak; tempo ≈ 3:1, bidang ayun rata, dan titik kena di dasar busur = akurat;
**memiringkan ujung stik** saat kena melengkungkan bola (kanan/kiri layar = kanan/kiri). `← →` arah bidik,
`1 2 3` pilih stik, `0` otomatis, `- =` menyesuaikan kecepatan "ayunan penuh" (default 11 L/s), `C` kalibrasi.
Mode mouse golf: putar mouse mengelilingi titik pusat layar (ayunan melingkar).
Tenis dan Neon Blade (mode mouse): Spasi = tusuk ke kamera.

## Arsitektur engine (`motion-core`)

```
FrameSource ──► Tracker ──► Observation ──► PoseEstimator ──► PoseSample ─┬─► SwingRecognizer ──► GestureEvent (slice/chop/tusuk)
(webcam)        (warna)     (2D, direkam)    (filter, L/s,      (pose      └─► TraceRecorder  ──► SwingTrace ──► analyzeSwing ──► SwingMetrics
                                              kedalaman)         dunia 2.5D)     (satu gerakan utuh)               (tempo, bidang, kemiringan, titik kena)
```

```ts
const input = new MotionInput({ profileKey: 'my-game' });        // @games/shell: webcam atau mouse + layar kalibrasi
const engine = input.engine;
engine.on('pose', p => racket.set(p.world.position, p.world.quaternion)); // kontinu, per frame
engine.on('gesture', g => { /* g.kind, g.direction, g.power, g.speedMps */ }); // ayunan cepat
engine.on('trace', t => { const m = analyzeSwing(t); /* m.tempo, m.quality, m.leanDeg ... */ }); // gerakan utuh
```

- **Satuan L/s** (panjang tongkat per detik): kecepatan tidak bergantung jarak ke kamera.
- **Kedalaman** dari ketebalan gagang (silinder, tidak terpengaruh foreshortening). Tanda kemiringan ambigu dari
  satu kamera; diasumsikan ujung lebih dekat ke kamera daripada tangan (maju dari tubuh).
- **Tracker bisa ditukar**: cukup menghasilkan `Observation`. `engine.pushObservation()` juga dipakai mode mouse dan tes.
- **Rekam dan putar ulang**: `startRecording()` / `stopRecording()` / `replay()` untuk tes deterministik.
- **Profil kalibrasi**: `exportProfile()` / `importProfile()` (disimpan per game di localStorage).
- **Titik kena** pada `analyzeSwing` = puncak kecepatan pada gelombang TERAKHIR, jadi downswing yang melambat
  (kesalahan umum pemula) tidak salah dibaca dari backswing.

## Batas yang diketahui

- Satu webcam = 2.5D; kedalaman hanya perkiraan.
- Tracker berjalan di main thread. Jika render berat membuat frame kamera terbuang, pindahkan
  `ColorTracker.process` ke Web Worker (antarmukanya sudah tanpa DOM).
- Motion blur saat ayunan cepat bisa membuat ujung hilang; ukur dengan lab ("Ujung hilang saat ayunan").
  Cahaya terang dan kamera 60 fps sangat membantu. Penanda bola/LED di ujung adalah jalur upgrade.
- Konstanta rasa (kecepatan "ayunan penuh" golf, ambang ayunan tenis, bobot kualitas) belum dikalibrasi
  dengan pemain sungguhan; semuanya konstanta bernama di kode agar mudah disetel.
- Validasi sejauh ini memakai video kamera sintetis, mode mouse, dan tes unit, bukan webcam sungguhan.
