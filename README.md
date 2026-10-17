# DompetHarian — Aplikasi Pencatat Keuangan Pribadi Offline-First (Edisi Android PWA)

**Kredit & Arsitek Utama:** **Aravajordan**

DompetHarian adalah Progressive Web App (PWA) pencatat pengeluaran dan pemasukan harian berbahasa Indonesia yang dirancang khusus untuk ponsel Android (Chrome Android, dipasang ke layar utama / *Add to Home Screen*), tetap berfungsi penuh tanpa koneksi internet (*local-first*), menjaga privasi data finansial sesuai **UU PDP (UU No. 27 Tahun 2022)**, dan menyimpan foto struk belanja langsung di **Google Drive pribadi milik masing-masing pengguna** (`drive.file`).

---

## Fitur Utama & Keputusan Arsitektur

1. **Arsitektur Local-First (IndexedDB via Dexie.js + Sinkronisasi Supabase PostgreSQL)**
   - Seluruh layar aplikasi membaca dan menulis langsung ke database lokal IndexedDB (`DompetHarianLocalDB`) yang diisolasi per `user_id`.
   - Sinkronisasi dua arah menggunakan antrean operasi (`op_id` idempoten), nomor urut perubahan monotonik (`change_seq`), *soft-delete tombstone* (`deleted_at`), dan *optimistic concurrency control* (`version` / `base_version`) beserta UI resolusi konflik berdampingan dalam bahasa Indonesia.
2. **Privasi Foto Struk di Google Drive Pengguna Sendiri (`drive.file`)**
   - Server pengembang **tidak pernah menerima atau menyimpan gambar struk**.
   - Sebelum disimpan di antrean lokal (`receiptOutbox`) atau diunggah ke folder `DompetHarian_Struk` di Google Drive pengguna, aplikasi menghapus seluruh segmen metadata EXIF/GPS (APP1–APP15 & COM) dan mengganti nama file menjadi `{uuid}.jpg`.
   - Begitu unggahan ke Google Drive terkonfirmasi, *blob* gambar lokal di IndexedDB **langsung dihapus**.
   - Token akses Google Identity Services (`initTokenClient`) disimpan **hanya di RAM JavaScript** (`DriveTokenStore`), tidak pernah ditulis ke `localStorage`, `IndexedDB`, atau database server.
3. **OCR Struk 100% di Perangkat (Tesseract.js Web Worker)**
   - Pemindaian teks struk berjalan di *Web Worker* lokal dengan indikator progres, tombol batal (`AbortController`), deteksi ketidakpastian nominal (`isTotalUncertain`), dan formulir verifikasi wajib sebelum transaksi disimpan.
4. **Nominal Rupiah Bulat (Integer IDR) & Zona Waktu Indonesia**
   - Seluruh nominal disimpan dan dihitung sebagai bilangan bulat positif (`BIGINT` / `Safe Integer`), bebas dari bug pembulatan *floating-point*.
   - Mendukung batas tanggal lokal **WIB (`Asia/Jakarta`)**, **WITA (`Asia/Makassar`)**, dan **WIT (`Asia/Jayapura`)**.

---

## Dokumen Perencanaan & Spesifikasi Teknis (`docs/`)

- [`docs/STAGE_0_PLAN.md`](docs/STAGE_0_PLAN.md) — Rencana Implementasi, Arsitektur, Model Data & Strategi Pengujian
- [`docs/SYNC_CONTRACT.md`](docs/SYNC_CONTRACT.md) — Kontrak Sinkronisasi Push/Pull, Idempotensi & Resolusi Konflik
- [`docs/OFFLINE_ROUTE_MATRIX.md`](docs/OFFLINE_ROUTE_MATRIX.md) — Matriks Rute Offline & Strategi App Router PWA
- [`docs/PRIVACY_DATA_FLOW.md`](docs/PRIVACY_DATA_FLOW.md) — Tabel Aliran Data Privasi & Kepatuhan UU PDP
- [`docs/GOOGLE_DRIVE_DESIGN.md`](docs/GOOGLE_DRIVE_DESIGN.md) — Desain Akses Google Drive (`drive.file`) & Siklus Token di Memori
- [`docs/WHATSAPP_PHASE2.md`](docs/WHATSAPP_PHASE2.md) — Kontrak Fase 2 WhatsApp & Analisis Konflik Privasi Struk
- [`docs/DEPLOYMENT_AND_SECURITY.md`](docs/DEPLOYMENT_AND_SECURITY.md) — Panduan Deployment, Rollback, Audit Keamanan & Checklist Perangkat Android

---

## Cara Menjalankan di Lokal

```bash
# 1. Instal dependensi
npm install

# 2. Salin konfigurasi environment (opsional untuk mode lokal, wajib untuk produksi Supabase + Google Drive)
cp .env.example .env.local

# 3. Jalankan server pengembangan
npm run dev

# 4. Jalankan pemeriksaan tipe TypeScript, Linter, Unit/Integration Test, dan Build Produksi
npm run typecheck
npm run lint
npm test
npm run build

# 5. Jalankan pengujian End-to-End (Playwright Mobile 360x800)
npm run test:e2e
```

---

## Lisensi & Kredit

Dirancang dan dikembangkan oleh **Aravajordan**.
