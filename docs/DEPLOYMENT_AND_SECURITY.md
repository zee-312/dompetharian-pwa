# DompetHarian — Deployment Guide, Security Hardening & Physical Device Checklist

**Author / Credit:** Aravajordan

---

## 1. Environment Variables (`.env.example` -> `.env.local` / Production)

| Variable | Exposure | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_APP_URL` | Client & Server | Yes | Canonical HTTPS origin (e.g. `https://dompetharian.example.com` or `http://localhost:3000`). |
| `NEXT_PUBLIC_SUPABASE_URL` | Client & Server | Yes (Prod) | Supabase project URL (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client & Server | Yes (Prod) | Supabase public anonymous key (enforces PostgreSQL RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server Only** | Optional (Admin) | Supabase service role key. **Never** prefix with `NEXT_PUBLIC_` or expose to client bundles. |
| `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` | Client | Yes (for Drive) | Google Cloud OAuth 2.0 Web Client ID for GIS Token Model (`drive.file` scope). |

> **Development / Automated Test Fallback:** When `NEXT_PUBLIC_SUPABASE_URL` is not configured, the server API routes (`/api/sync/push`, `/api/sync/pull`, `/api/transactions`, `/api/categories`, `/api/export/csv`, `/api/auth/account`) use the built-in multi-user isolated server store (`src/lib/database/server-store.ts`), which enforces the exact same ownership checks, version counters, monotonic `change_seq`, and `processed_operations` idempotency table.

---

## 2. Database Migration & Setup Instructions (Supabase)

1. Create a new Supabase project at [https://supabase.com/dashboard](https://supabase.com/dashboard) (Region: **Southeast Asia (Singapore)** `ap-southeast-1` recommended for lowest latency from Indonesia).
2. Enable **Email** provider under **Authentication -> Providers**.
3. Open **SQL Editor** and execute the migration file:
   - [`supabase/migrations/20261017000000_init_dompetharian.sql`](../supabase/migrations/20261017000000_init_dompetharian.sql)
4. (Optional, development only) Execute [`supabase/seed.sql`](../supabase/seed.sql) to populate sample development categories/records.
5. Verify in **Database -> Policies** that Row Level Security (RLS) is **ENABLED** on:
   - `public.user_sync_sequences`
   - `public.categories`
   - `public.transactions`
   - `public.receipt_metadata`
   - `public.processed_operations`

---

## 3. Google Cloud & Google Drive API Manual Setup Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (`DompetHarian`).
2. Navigate to **APIs & Services -> Library**, search for **Google Drive API**, and click **Enable**.
3. Navigate to **APIs & Services -> OAuth consent screen**:
   - User Type: **External**.
   - App Information: Name `DompetHarian`, user support email, and developer contact email.
   - Privacy Policy link: `https://<your-domain>/privasi`.
   - Scopes: Click **Add or Remove Scopes** and select **only** `https://www.googleapis.com/auth/drive.file` (*Non-sensitive scope*).
   - Test Users: While in **Testing** mode, add the Google accounts (up to 100) that will test the app.
4. Navigate to **APIs & Services -> Credentials**:
   - Click **Create Credentials -> OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins:
     - `http://localhost:3000` (for local development)
     - `https://<your-production-domain>` (for production)
   - Copy the generated **Client ID** (`xxxx.apps.googleusercontent.com`) into `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`.

---

## 4. Production Build, Verification & Deployment Commands

Run all commands inside `D:\vscode\antigravity\apk_dompet`:

```powershell
# 1. Install dependencies from lockfile
npm ci

# 2. Type-check (TypeScript strict mode)
npm run typecheck

# 3. Lint check
npm run lint

# 4. Run Unit & Integration tests (Vitest)
npm test

# 5. Build production bundle
npm run build

# 6. Run End-to-End tests (Playwright Android emulation)
npm run test:e2e

# 7. Start production server
npm start
```

### HTTPS Requirement
- Android Chrome requires **HTTPS** (except on `http://localhost`) for:
  - Service Worker registration (`navigator.serviceWorker.register`)
  - PWA Home Screen installation (`beforeinstallprompt`)
  - Persistent storage (`navigator.storage.persist()`)
  - Camera capture (`getUserMedia` / secure context)
  - Google Identity Services OAuth popup

---

## 5. Backup, Recovery, Monitoring & Rollback Guide

### 5.1 Database Backup & Recovery
- **Automated Daily Backups:** Enable Supabase Point-in-Time Recovery (PITR) or run scheduled `pg_dump`:
  ```bash
  pg_dump "$SUPABASE_DB_URL" --format=custom --file="dompetharian_$(date +%Y%m%d_%H%M).dump"
  ```
- **Restore Procedure:**
  ```bash
  pg_restore --dbname="$SUPABASE_DB_URL" --clean --if-exists "dompetharian_YYYYMMDD_HHMM.dump"
  ```
- **Client-Side Resilience:** Because DompetHarian is local-first, each active user's Android phone holds a complete copy of their transactions in IndexedDB and can export a full CSV backup offline from `/laporan` or `/pengaturan`.

### 5.2 Health Check & Monitoring
- **Health Endpoint:** `GET /api/health` returns HTTP `200` with `{ status: "healthy", version: "1.0.0", timestamp, checks: { serverStore: "ok" } }`.
- **Recommended Alerts:** Monitor HTTP `5xx` rate on `/api/sync/push` and `/api/sync/pull`, rate-limit `429` spikes, and Supabase database CPU/connection pool saturation.
- **Privacy-Preserving Logs:** All server and client logs pass through `SafeLogger` (`src/lib/security/logger.ts`), which strips amounts, descriptions, merchants, notes, OCR text, and bearer/OAuth tokens.

### 5.3 Application & Database Rollback
1. **Application Rollback:** Redeploy the previous immutable container image or Vercel deployment snapshot. When the client loads the rolled-back `/sw.js`, the Service Worker version banner prompts the user to reload while keeping all IndexedDB `syncQueue` items intact.
2. **Database Migration Rollback:** All migrations in `supabase/migrations/` must be additive (`ADD COLUMN IF NOT EXISTS`) so the previous application version continues operating during a rollback.

---

## 6. Security Review Checklist

- [x] **Row Level Security (RLS):** Enabled on all tables (`user_sync_sequences`, `categories`, `transactions`, `receipt_metadata`, `processed_operations`) with `auth.uid() = user_id` policies.
- [x] **Server-Side Ownership Enforcement:** Every API route independently validates authenticated `user_id` ownership before reading or mutating data.
- [x] **Strict Input Validation & Size Limits:** Request bodies capped at `256 KB` on sync/JSON endpoints; Zod schemas enforce positive integer `amount_idr`, valid dates, bounded string lengths, and valid UUIDs.
- [x] **Rate Limiting:** Sliding-window rate limiter protects `/api/sync/push`, `/api/sync/pull`, `/api/auth/account`, and `/api/transactions`.
- [x] **Content Security Policy (CSP) & Security Headers:** Configured in `next.config.ts` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, strict `Content-Security-Policy`).
- [x] **No Server Receipt Storage:** Receipt photos are uploaded directly from browser to user's Google Drive (`drive.file` scope) after client-side EXIF/GPS stripping.
- [x] **In-Memory Drive Token Only:** Google OAuth access token is kept only in JS RAM, never in `localStorage`, `IndexedDB`, or on the server.
- [x] **Log Sanitization:** Financial amounts, descriptions, merchants, OCR text, passwords, and tokens are redacted from all logs.

---

## 7. Physical Android Device Manual Test Checklist

> **Status Kejujuran Pengujian (Execution Honesty):**  
> Pengujian otomatis di bawah dijalankan menggunakan Vitest dan Playwright (emulasi mobile Android Chrome `360x800`). Daftar periksa perangkat fisik Android di bawah ini **BELUM DIEKSEKUSI PADA HP ANDROID FISIK (`Not Executed on Physical Phone`)** dan wajib dijalankan secara manual oleh pemilik sebelum rilis produksi:

- [ ] **[Belum Dieksekusi]** **Instalasi PWA di Chrome Android:** Buka URL HTTPS di Chrome pada HP Android fisik, ketuk tombol *"Pasang Aplikasi"* di dalam aplikasi, dan pastikan ikon DompetHarian muncul di layar utama (*Home Screen*) serta terbuka tanpa bilah alamat (*standalone*).
- [ ] **[Belum Dieksekusi]** **Uji Mode Pesawat (*Airplane Mode*):** Tutup paksa aplikasi dari *Recent Apps*, aktifkan Mode Pesawat di HP Android, buka kembali ikon DompetHarian dari *Home Screen*. Pastikan Beranda, Tambah Transaksi, Riwayat, Laporan, Sinkronisasi, dan Pengaturan terbuka tanpa layar putih/error.
- [ ] **[Belum Dieksekusi]** **Catat, Edit, Hapus, & Cari Saat Offline:** Dalam Mode Pesawat, catat pengeluaran baru dengan 3 ketukan, edit nominalnya, cari berdasarkan nama toko, dan hapus satu transaksi. Matikan Mode Pesawat dan pastikan status berubah dari *"Menunggu"* menjadi *"Tersinkron"*.
- [ ] **[Belum Dieksekusi]** **Kamera Fisik & Penghapusan Lokasi GPS (EXIF):** Ambil foto struk menggunakan kamera belakang HP Android dengan fitur *Location Tags* kamera aktif. Setelah terunggah ke folder `DompetHarian_Struk` di Google Drive, unduh file `.jpg` dari Drive dan periksa properti EXIF untuk memastikan koordinat GPS tidak ada dan nama file berupa `{uuid}.jpg`.
- [ ] **[Belum Dieksekusi]** **Sambung & Cabut Akses Google Drive:** Hubungkan Google Drive melalui popup GIS di Chrome Android, unggah 1 struk, lalu buka `myaccount.google.com/permissions`, cabut akses DompetHarian, dan coba unggah struk lagi di aplikasi. Pastikan muncul pesan bahasa Indonesia bahwa akses Drive dicabut dan data transaksi tidak hilang.
- [ ] **[Belum Dieksekusi]** **Kondisi Penyimpanan HP Rendah (*Low Storage*):** Verifikasi status `navigator.storage.persist()` di halaman Pengaturan pada perangkat Android fisik dan pastikan peringatan kehilangan data lokal saat *Clear Site Data* terbaca jelas.
