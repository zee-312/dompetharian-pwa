# DompetHarian — Offline Route Matrix & App Router Architecture (Stage 0 / Milestone 2.1)

**Author / Credit:** Aravajordan

---

## 1. How Next.js App Router Works Offline in DompetHarian

A standard Next.js App Router application relies on Server Components and RSC (`?_rsc=...`) network fetches during client-side navigation, which fail when the phone has no internet.

DompetHarian solves this through three coordinated layers:

1. **Client-Rendered Offline-First Pages (`'use client'`):**
   - Every offline-required page (`/beranda`, `/tambah`, `/riwayat`, `/transaksi/[id]`, `/laporan`, `/scan`, `/sinkronisasi`, `/pengaturan`) is a Client Component tree backed by `LocalFirstTransactionRepository` (Dexie / IndexedDB).
   - No `async` Server Component database queries block rendering on any page.
2. **Service Worker App-Shell Precaching (`public/sw.js`):**
   - On install and activation, the Service Worker precaches `/`, `/beranda`, `/tambah`, `/riwayat`, `/laporan`, `/scan`, `/sinkronisasi`, `/pengaturan`, `/login`, `/privasi`, `/manifest.webmanifest`, and static `/_next/static/*` bundles using versioned cache names (`dompetharian-shell-v1`, `dompetharian-assets-v1`).
   - For document navigation requests (`request.mode === 'navigate'`) when offline: serves the cached route HTML if available, or falls back to the cached root `/beranda` shell which mounts the client router and renders the requested route from IndexedDB.
   - For Next.js RSC requests (`Accept: text/x-component` or `_rsc` query parameter) when offline: serves cached RSC payload or returns a graceful client-navigation response so Next.js router never crashes offline.
3. **Instant Client Tab Navigation inside `AppShell`:**
   - Primary bottom navigation transitions preserve client state and read directly from IndexedDB in `< 16ms` without waiting on the network.

---

## 2. Offline Route & Feature Matrix

| Route / Screen | Works Offline? | Data Source | Why / Technical Mechanism | Offline UI / Indonesian Message When Unavailable |
| :--- | :--- | :--- | :--- | :--- |
| **`/beranda` (Beranda)** | **Ya (Penuh)** | IndexedDB (`Dexie`) | Client component aggregates today & current month totals from local IndexedDB. | Shows persistent banner: *"Mode Offline — Data disimpan di HP ini."* If initial server sync has not completed or conflicts exist, displays warning: *"Catatan: Data lokal mungkin belum lengkap karena sinkronisasi belum selesai."* |
| **`/tambah` (Tambah Transaksi)** | **Ya (Penuh)** | IndexedDB (`Dexie`) + `syncQueue` | Generates UUID v4 on device, writes transaction with `sync_state: 'pending'`, enqueues `create` op in `syncQueue`. | Saves immediately and shows badge *"Menunggu"* (`Menunggu sinkronisasi saat internet aktif`). |
| **`/riwayat` (Riwayat & Cari)** | **Ya (Penuh)** | IndexedDB (`Dexie`) | Client-side search (description, merchant, notes), date range, category, type, and payment method filtering over IndexedDB. | Full search & filter work offline. Each item displays its live badge: *"Menunggu"*, *"Tersinkron"*, *"Gagal"*, or *"Konflik"*. |
| **`/transaksi/[id]` (Detail, Edit, Hapus)** | **Ya (Transaksi) / Parsial (Foto Drive)** | IndexedDB (`Dexie`) + `syncQueue` | Viewing, editing, and soft-deleting transactions work 100% offline via `syncQueue`. Viewing full image already uploaded to Google Drive requires internet. | Edit/Delete work offline. If receipt is queued locally: *"Struk menunggu diunggah ke Google Drive."* If receipt is in Drive and phone is offline: *"Tidak dapat memuat foto struk dari Google Drive saat offline. Hubungkan ke internet untuk melihat gambar struk."* |
| **`/sinkronisasi` (Status Sinkronisasi & Konflik)** | **Ya (Lihat Antrean) / Butuh Internet untuk Kirim** | IndexedDB (`syncQueue`, `syncMeta`, `receiptOutbox`) | Displays pending count, failed count, conflict count, last sync timestamp, and conflict comparison cards from IndexedDB. | If user taps *"Sinkronkan sekarang"* while offline, displays: *"Kamu sedang offline. Sinkronisasi ke server membutuhkan koneksi internet. Data kamu tetap aman di HP ini."* |
| **`/laporan` (Laporan & Ekspor CSV)** | **Ya (Laporan & CSV Lokal) / Tidak (CSV Server)** | IndexedDB (`Dexie`) | Monthly totals, daily averages, category breakdown, daily trend, and previous-month comparison are computed from IndexedDB. | Shows incomplete-data notice if initial sync is incomplete or items are in conflict. Local CSV export works offline; Server CSV export button shows: *"Ekspor data langsung dari server membutuhkan koneksi internet. Kamu tetap bisa mengekspor data lokal yang ada di HP ini."* |
| **`/scan` (Scan Struk & OCR)** | **Parsial (Kamera & Antrean Struk Bekerja Offline; Unduh Bahasa OCR Butuh Internet)** | Camera/Gallery + Canvas EXIF Stripper + `receiptOutbox` | Taking a photo, stripping EXIF/GPS, compressing JPEG, queueing the receipt blob in IndexedDB, and saving the transaction work offline. | If Tesseract language data is not cached and phone is offline: *"Unduhan data bahasa OCR membutuhkan koneksi internet. Kamu tetap bisa menyimpan foto struk ke antrean dan mengisi nominal secara manual sekarang."* |
| **`/pengaturan` (Pengaturan)** | **Ya (Kategori, Zona Waktu, PIN, Hapus Lokal) / Tidak (Sambung Drive, Hapus Akun)** | IndexedDB + `localStorage` prefs | Managing categories, changing timezone (`WIB`/`WITA`/`WIT`), setting/locking PIN, and exporting/clearing local data work offline. | Connecting Google Drive or deleting account while offline shows: *"Fitur ini membutuhkan koneksi internet. Silakan sambungkan HP ke internet terlebih dahulu."* |
| **`/login` (Login Pertama, Daftar, Reset Kata Sandi)** | **Tidak (Login Pertama) / Ya (Buka Sesi Lama)** | Supabase Auth + Local Session Store | Subsequent app launches offline unlock using the established local session in `localStorage`/`IndexedDB`. First login, sign-up, and password reset require Supabase Auth over the network. | When offline on `/login`: *"Login pertama, pendaftaran akun baru, dan reset kata sandi membutuhkan koneksi internet. Periksa jaringan kamu lalu coba lagi."* |
| **`/privasi` (Kebijakan & Alur Privasi)** | **Ya (Penuh)** | Static Client Route | Precached in Service Worker app shell. | Opens full Indonesian privacy notice and data-flow table offline. |
