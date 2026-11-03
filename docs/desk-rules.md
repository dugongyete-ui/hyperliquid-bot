# Desk Rules — HyperGrok Trading Desk (ported)

Aturan lengkap yang di-port dari [galleonlabs/hypergrok-trading-desk](https://github.com/galleonlabs/hypergrok-trading-desk)
(skills: `desk-risk-limits`, `desk-execution-protocol`, `desk-trade-lifecycle`, `desk-monitoring`,
`desk-post-trade-review`, `desk-strategy-lab` — MIT license) ke engine TypeScript project ini.

> **Catatan penting:** bot ini TIDAK punya AI/LLM yang "membaca" instruksi. Semua aturan di bawah
> diterjemahkan menjadi **kode yang memaksa** (enforcement), bukan teks yang diharapkan dipatuhi.
> Kolom "Ditegakkan di" menunjukkan file + fungsi yang mengeksekusi aturan itu.

---

## 1. The stop defines the size (stressed-stop sizing)

**Aturan asli (desk-risk-limits §2.2):** ukuran posisi dihitung dari biaya stop yang *tertekan
(stressed)* — bukan dari margin, bukan dari profit yang diinginkan, bukan dari feeling.

```
stop_fill     = stop ∓ slippage          (stop dieksekusi sebagai taker)
fees_per_unit = (entry + stop_fill) × taker_fee   (kedua kaki)
stressed_dist = |entry − stop_fill| + fees_per_unit
size          = risk_usd / stressed_dist          (BUKAN risk/|entry−stop|)
size          = round DOWN — jangan pernah membulatkan risiko ke atas
```

**Ditegakkan di:** `src/lib/engine/risk.ts` → `stressedStopSize()` (sizing entry) dan
`stressedRiskOfPosition()` (ledger posisi berjalan). Dipakai di `engine.ts → openPosition()`.
- Slippage minimum 10 bps, atau spread live bila lebih lebar.
- Taker fee Hyperliquid 0.045%/kaki dihitung dua kaki.
- Ukuran akhir dibatasi lagi oleh: margin×leverage, batas leverage per-coin exchange,
  likuiditas (0.1% dari volume 24 jam), dan sanity cap $25,000.

## 2. Two-layer limits — hard ceiling + user layer yang hanya bisa MENGECILKAN

**Aturan asli:** ada dua lapis limit. Lapis keras (hard ceiling) tidak boleh dilewati siapa pun;
lapis user hanya boleh **mengetatkan**, tidak pernah melonggarkan.

| Limit | Hard ceiling | Default user |
|---|---|---|
| Risiko per trade | 2% equity | 1.0% |
| Total risiko terbuka (semua posisi) | 6% equity | 4.0% |
| Daily loss stop | 10% | 6.0% |
| Leverage | 20× (atau max per-coin exchange) | 5× |
| Posisi per cluster correlated | 2 | 2 |

**Ditegakkan di:** `risk.ts → CEILINGS + clampLimits()` — nilai user di-clamp masuk ceiling
sebelum dipakai, di `engine.ts → applySettings()` dan saat init. Slider di UI sudah dibatasi
ke ceiling (turbo mode pun tidak bisa menembus).

## 3. Reservation ledger — satu anggaran untuk semua bot

**Aturan asli:** 5 bot berbagi satu akun. Risiko terbuka + order pending + kandidat baru harus
digabung dalam satu pembukuan. Dua proposal tidak boleh membelanjakan kapasitas yang sama.

**Ditegakkan di:** `risk.ts → RiskLedger` (reservasi per trade-id), `engine.ts → tryEntries()`
(`risk.canOpen()` memeriksa open risk + kandidat vs limit total sebelum ticket diberi izin),
`openPosition()` (reservasi dibukukan begitu posisi ada), `finalizeClose()` (reservasi dilepas).
Setelah restart, ledger dibangun ulang dari posisi live (`rebuildLedger()`).

## 4. Daily loss stop — latch "no-new-risk"

**Aturan asli:** kalau equity turun melewati daily stop dari equity awal hari, desk masuk kondisi
**latched**: tidak ada risiko baru (entry berhenti), tapi exit & proteksi posisi berjalan tetap.
Latch tidak otomatis lepas di tengah hari; reset manual atau rollover UTC.

**Ditegakkan di:** `risk.ts → observeDay()/canOpen()/reset()`, watchdog di `engine.ts → tick()`
(notifikasi saat latch + peringatan 80%), tombol "Reset daily stop" di Settings, dan aksi
`resetDailyStop` di API control.

## 5. Cluster limits — coin berkorelasi = SATU risiko

**Aturan asli:** BTC/ETH/SOL adalah satu cluster "majors". Memegang 3 posisi di satu cluster
bukan diversifikasi — itu satu taruhan ×3.

**Ditegakkan di:** `risk.ts → CLUSTERS + clusterOf()` (majors, memes, l1alts, defi, other),
gate per-cluster di `engine.ts → tryEntries()` (maks 2 posisi per cluster).

## 6. Reduce, don't flip — proteksi tidak pernah melompat ke sisi lawan

**Aturan asli:** mengubah TP/SL pada order resting = pasang level baru → konfirmasi resting →
baru tarik level lama. Cancel satu, bukan semua. Selama manage, hanya boleh **mengurangi
risiko** (memperketat), tidak pernah memperlebar.

**Ditegakkan di:** engine SIM mengelola TP/SL sebagai plan yang dihitung SAAT ENTRY dan hanya
dievaluasi (tidak pernah dilebar): trailing stop hanya mengunci profit dari `peakPct`
(`managePositions()`) — SL efektif hanya bergerak ke arah menguntungkan; TP tidak pernah
ditambah setelah entry. Mode live menempatkan market order reduce-only via SDK
(`hl-exchange.ts`) — satu jalur eksekusi untuk semua bot.

## 7. Unknown result ≠ failure (order timeout)

**Aturan asli:** order yang timeout adalah **hasil tidak diketahui**, bukan gagal. Jangan
kirim ulang buta — rekonsiliasi per `cloid` dulu.

**Ditegakkan di:** `hl-exchange.ts` menandai setiap order dengan id dan menunggu konfirmasi
exchange; `syncLive()` (engine, tiap 10 detik) merekonsiliasi posisi aktual dari exchange —
posisi yang hilang di exchange ditutup pembukuannya ("closed on exchange"), posisi tak dikenal
di-adopt dengan bot idle. Tidak ada resend buta di jalur mana pun.

## 8. Three-state monitoring — fired / didn't fire / UNAVAILABLE

**Aturan asli:** jangan perlakukan "tidak ada data" sebagai "aman/tidak ada sinyal". Ada tiga
keadaan: sinyal terjadi, sinyal tidak terjadi, dan **data tidak tersedia**.

**Ditegakkan di:** `engine.ts → tryEntries()` — feed stale >15 detik = sinyal tidak dievaluasi
sama sekali (UNAVAILABLE), bukan dianggap pasar sepi. `market.feedOk` + fallback sintetis
dilaporkan jujur ke UI (`feedOk` di snapshot).

## 9. R-multiple review — nilai proses, bukan vibes

**Aturan asli:** setiap trade ditutup dinilai dalam R = PnL / risiko yang dianggarkan saat entry.
Proses (entry sesuai rencana, stop ditegakkan) dinilai terpisah dari hasil. Scratch (±0.08%)
tidak dihitung menang/kalah.

**Ditegakkan di:** `riskUsd` disimpan per trade (kolom DB), R-multiple dihitung di
`finalizeClose()` dan ditampilkan di thought bot ("banked +1.8R"), streak & win-rate
memakai definisi scratch di atas.

## 10. Single writer — satu jalur ke exchange

**Aturan asli:** hanya SATU modul eksekusi yang boleh menyentuh `/exchange`. Bot lain hanya
mengirim intent/sinyal.

**Ditegakkan di:** semua 5 strategi (`strategies.ts`) hanya menghasilkan `Signal` (intent).
Satu-satunya pemanggil order adalah `engine.ts` melalui `hl-exchange.ts` (SIM: fill kertas di
harga live mainnet; LIVE: SDK resmi Hyperliquid).

## 11. Honesty gate (strategy lab)

**Aturan asli:** sebelum naik mode (SIM → testnet → mainnet), strategi harus membuktikan
kinerjanya pada data yang belum pernah dilihat (holdout 15–25%) dan lolos sanity test fee ×2.

**Status di project ini:** parafrase — mode manual di tangan user (SIM → TESTNET → MAINNET
ada di Settings), dan UI menyediakan statistik per-bot (PnL, win-rate, R-multiple di thought)
agar keputusan naik mode berdasar bukti, bukan harapan. Tidak ada auto-promosi mode.

---

## Ekstra project ini (di luar desk, tapi selaras)

- **Adaptive exit engine (auto TP/SL):** target profit dihitung per-coin dari volatilitas live
  (ATR 1m) dan **rezim market** via Kaufman Efficiency Ratio: *trending* → TP ×1.45, trailing
  ×1.2, time-stop ×1.5 (biar profit jalan); *ranging* → TP ×0.78, trailing ×0.72, time-stop
  ×0.8 (ambil profit cepat). Stop distance tetap murni volatilitas. Bisa dimatikan lewat
  Settings (Auto → Manual dengan TP%/SL% tetap).
- **Likuiditas:** coin < $500k volume 24h tidak pernah ditradingkan; ukuran dibatasi 0.1%
  volume 24 jam per coin.
- **Full universe:** semua perp aktif Hyperliquid (delisted dilewati), data prioritas untuk
  posisi yang sedang dipegang.

## Peta file

| File | Isi |
|---|---|
| `src/lib/engine/risk.ts` | stressed-stop sizing, ceilings, clamp, ledger, cluster |
| `src/lib/engine/engine.ts` | watchdog harian, gates entry, manage exit, R-multiple, single-writer |
| `src/lib/engine/market.ts` | data pasar, ATR, regime (Kaufman ER), likuiditas |
| `src/lib/engine/strategies.ts` | 5 bot = penghasil intent (tidak pernah menyentuh exchange) |
| `src/lib/engine/hl-exchange.ts` | satu-satunya jalur order ke Hyperliquid |
| `src/components/dashboard/SettingsModal.tsx` | kontrol user (hanya bisa mengetatkan limit) |
