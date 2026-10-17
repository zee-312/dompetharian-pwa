# DompetHarian — Stage 0: Architecture Overview & Implementation Plan

**Author / Credit:** Aravajordan  
**Target Platform:** Android PWA (Chrome on Android, installed to Home Screen, 360px mobile-first)  
**Language & Currency:** Bahasa Indonesia (`id-ID`), Rupiah (`IDR` positive integers only)

---

## 1. Repository Inspection Result

- Working directory `D:\vscode\antigravity\apk_dompet` was inspected and confirmed empty prior to Stage 0 initialization.
- We are building a clean, modular Next.js 15 (App Router) + TypeScript (strict mode) + Tailwind CSS + Dexie.js + Supabase (Auth, PostgreSQL, RLS) + Google Identity Services (`drive.file`) + Tesseract.js application inside `D:\vscode\antigravity\apk_dompet`.

---

## 2. Official Documentation Consulted

1. **Next.js App Router & PWA (`nextjs.org/docs/app/guides/progressive-web-apps`)**:
   - Native `app/manifest.ts` metadata route.
   - Custom service worker (`public/sw.js`) served with `Cache-Control: no-cache, no-store, must-revalidate` and strict `Content-Security-Policy`.
   - **App Router Offline Navigation Solution**: Next.js Server Components require a server round-trip if not cached or if dynamic server rendering is used. To guarantee 100% offline navigation across all offline-required screens (`/beranda`, `/tambah`, `/riwayat`, `/transaksi/[id]`, `/laporan`, `/scan`, `/sinkronisasi`, `/pengaturan`), every offline-required route uses a static client shell (`'use client'`) that reads/writes directly to IndexedDB via `LocalFirstTransactionRepository`, AND the Service Worker precaches all route HTML shells, RSC payloads, and `/_next/static/*` chunks on install/visit, with an app-shell navigation fallback so any route opens even when launched cold in Airplane Mode.
2. **Supabase Auth & PostgreSQL Row Level Security (`supabase.com/docs/guides/database/postgres/row-level-security`)**:
   - All tables (`categories`, `transactions`, `receipt_metadata`, `processed_operations`, `user_sync_state`) enable RLS.
   - Policies use `(select auth.uid()) = user_id` for optimal query planning and strict per-user isolation.
   - Server endpoints also explicitly verify `user_id` ownership in application code (defense in depth).
3. **Dexie.js v4 (`dexie.org/docs/Version/Version.stores()`)**:
   - Versioned IndexedDB schema (`DompetHarianLocalDB`).
   - All local tables are indexed by `user_id` (and compound indexes `[user_id+transaction_date]`, `[user_id+sync_state]`) so multiple accounts on the same phone are strictly isolated and never see or sync each other's data.
4. **Google Identity Services & Google Drive API v3 (`developers.google.com/identity/oauth2/web/guides/use-token-model`, `developers.google.com/workspace/drive/api/guides/api-specific-auth`)**:
   - Uses `https://www.googleapis.com/auth/drive.file` (classified by Google as a **non-sensitive** per-file scope).
   - Uses the GIS Token Model (`google.accounts.oauth2.initTokenClient`) in the browser. Short-lived OAuth 2.0 access tokens (`~3600s`) live **in memory only** (`DriveTokenStore` singleton in JS memory, never written to `localStorage`, `sessionStorage`, `IndexedDB`, cookies, or server database).
5. **Tesseract.js v6 (`github.com/naptha/tesseract.js/blob/master/docs/api.md`)**:
   - Uses `createWorker(['ind', 'eng'], 1, { logger })` running in a Web Worker off the main thread.
   - Language data (`traineddata`) is downloaded on demand when online; offline state is detected beforehand and shows a clear Indonesian message with one-tap fallback to manual entry.

---

## 3. Directory Structure

```text
D:\vscode\antigravity\apk_dompet\
├── docs/
│   ├── STAGE_0_PLAN.md              # Architecture, data model, test strategy, external setup
│   ├── SYNC_CONTRACT.md             # Formal Push/Pull/Conflict/Idempotency Sync Contract
│   ├── OFFLINE_ROUTE_MATRIX.md      # Offline behavior per screen & App Router offline design
│   ├── PRIVACY_DATA_FLOW.md         # Data-flow table & UU PDP notes
│   ├── GOOGLE_DRIVE_DESIGN.md       # GIS token model, drive.file scope, EXIF strip, error handling
│   ├── WHATSAPP_PHASE2.md           # Phase 2 WhatsApp interface & privacy conflict note
│   └── DEPLOYMENT_AND_SECURITY.md   # Production deployment, rollback, security & Android checklists
├── public/
│   ├── icons/
│   │   ├── icon-192x192.png
│   │   ├── icon-512x512.png
│   │   └── icon-maskable-512x512.png
│   └── sw.js                        # Hand-written versioned Service Worker
├── supabase/
│   ├── migrations/
│   │   └── 20261017000000_init_dompetharian.sql
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/account/route.ts    # Account deletion (DB + audit)
│   │   │   ├── categories/route.ts      # Categories CRUD & archive
│   │   │   ├── export/csv/route.ts      # Server CSV export
│   │   │   ├── health/route.ts          # Health check
│   │   │   ├── sync/push/route.ts       # Idempotent batch push endpoint
│   │   │   ├── sync/pull/route.ts       # Monotonic change_seq pull endpoint
│   │   │   └── transactions/route.ts    # Server transactions endpoint
│   │   ├── beranda/page.tsx             # Home screen (today/month summary, recent, quick add)
│   │   ├── tambah/page.tsx              # 3-tap quick add / edit transaction screen
│   │   ├── riwayat/page.tsx             # Virtualized/paginated history, search, filters
│   │   ├── transaksi/[id]/page.tsx      # Transaction detail, edit, delete, receipt viewer
│   │   ├── laporan/page.tsx             # Monthly reports, category breakdown, daily trend, CSV
│   │   ├── scan/page.tsx                # Camera/gallery capture, EXIF strip, OCR & verification
│   │   ├── sinkronisasi/page.tsx        # Sync status, retry queue, interactive conflict resolver
│   │   ├── pengaturan/page.tsx          # Account, categories, timezone, PIN, Drive, data/account delete
│   │   ├── login/page.tsx               # Login & registration screen
│   │   ├── privasi/page.tsx             # Indonesian privacy notice & data flow transparency
│   │   ├── manifest.ts                  # Web App Manifest
│   │   ├── layout.tsx                   # Root layout with AppShell, PIN lock guard, SW updater
│   │   ├── page.tsx                     # Entry redirect/landing to /beranda
│   │   └── globals.css                  # Tailwind & modern CSS (:user-invalid, content-visibility)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx             # Offline-first shell, PIN gate, SW update banner, install prompt
│   │   │   ├── BottomNav.tsx            # 48px+ thumb-reachable Android bottom navigation
│   │   │   └── ConnectivityBar.tsx      # Persistent connectivity & pending sync badge
│   │   └── ui/
│   │       └── PinLockModal.tsx         # Optional App PIN lock screen with honest privacy disclosure
│   ├── features/
│   │   ├── auth/                        # Session manager (online Supabase Auth + offline session unlock)
│   │   ├── categories/                  # Default Indonesian categories + custom add/rename/archive
│   │   ├── dashboard/                   # Aggregation & analytics service (integer IDR, WIB/WITA/WIT)
│   │   ├── receipts/                    # Image validator, EXIF/GPS stripper, offline queue, Drive sync
│   │   ├── reports/                     # CSV generator & monthly comparison calculators
│   │   └── transactions/                # TransactionDomainService, Repository interface, Local repo
│   └── lib/
│       ├── database/                    # Supabase client/server + in-memory/SQLite-like server store for local/test
│       ├── drive/                       # Google Identity Services token memory store & Drive REST client
│       ├── formatters/                  # Integer IDR formatter & live input parser, timezone date utils
│       ├── ocr/                         # OcrAdapter, image preprocessor, Tesseract worker, ID receipt parser
│       ├── security/                    # Redacting logger, rate limiter, PIN WebCrypto PBKDF2/AES-GCM helper
│       ├── sync/                        # Dexie DB, SyncEngine (Push/Pull/Conflict/Backoff)
│       ├── validation/                  # Zod schemas for transactions, categories, sync ops, receipts
│       └── whatsapp/                    # Phase 2 interface & privacy note (unimplemented by design)
└── tests/
    ├── unit/                            # Vitest unit tests (currency, domain, parser, EXIF, dashboard)
    ├── integration/                     # Vitest integration tests (sync contract, RLS/isolation, repo, Drive queue)
    └── e2e/                             # Playwright Android-emulated E2E tests (offline, sync, conflict, UX)
```

---

## 4. Data Model Summary

### 4.1 Server PostgreSQL (`supabase/migrations/20261017000000_init_dompetharian.sql`)
- `user_sync_sequences`: `user_id (PK)`, `last_change_seq (BIGINT)` — per-user monotonically increasing sequence incremented by database trigger on every change to `transactions` or `categories`.
- `categories`: `id (UUID PK)`, `user_id (UUID)`, `name (TEXT)`, `kind ('expense' | 'income')`, `icon (TEXT)`, `color (TEXT)`, `is_default (BOOLEAN)`, `is_archived (BOOLEAN)`, `usage_count (INT)`, `version (INT)`, `change_seq (BIGINT)`, `created_at (TIMESTAMPTZ)`, `updated_at (TIMESTAMPTZ)`, `deleted_at (TIMESTAMPTZ NULL)`.
- `transactions`:
  - `id (UUID PK, client-generated)`
  - `user_id (UUID NOT NULL)`
  - `kind ('expense' | 'income')`
  - `amount_idr (BIGINT NOT NULL CHECK (amount_idr > 0))` — strictly positive integer rupiah.
  - `transaction_date (DATE NOT NULL)` — plain local date `YYYY-MM-DD`.
  - `description (TEXT NOT NULL)`
  - `merchant (TEXT NULL)`
  - `category_id (UUID NOT NULL)`
  - `payment_method ('tunai' | 'transfer_bank' | 'qris' | 'ewallet' | 'kartu_debit' | 'kartu_kredit')`
  - `notes (TEXT NULL)`
  - `receipt_drive_file_id (TEXT NULL)` — Google Drive file ID only, never image bytes.
  - `receipt_mime_type (TEXT NULL)`
  - `receipt_size_bytes (INT NULL)`
  - `input_source ('manual' | 'ocr' | 'sync_import')`
  - `verification_status ('verified' | 'needs_review' | 'unverified')`
  - `version (INT NOT NULL DEFAULT 1)` — incremented on every server mutation.
  - `change_seq (BIGINT NOT NULL)` — assigned from user's monotonic sequence on insert/update/soft-delete.
  - `created_at (TIMESTAMPTZ NOT NULL)`
  - `updated_at (TIMESTAMPTZ NOT NULL)`
  - `deleted_at (TIMESTAMPTZ NULL)` — tombstone for soft deletion.
- `processed_operations`:
  - `user_id (UUID NOT NULL)`
  - `op_id (UUID NOT NULL)`
  - `client_id (TEXT NOT NULL)`
  - `record_id (UUID NOT NULL)`
  - `kind ('create' | 'update' | 'delete')`
  - `result_status ('applied' | 'duplicate' | 'conflict' | 'rejected')`
  - `result_payload (JSONB NOT NULL)`
  - `processed_at (TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  - `PRIMARY KEY (user_id, op_id)`

### 4.2 Local IndexedDB (`Dexie.js`)
- Namespaced by `user_id` across all tables:
  - `transactions`: mirrors server fields + `sync_state ('pending' | 'synced' | 'failed' | 'conflict')`, `last_error (string | null)`, `base_version (number)`, `has_pending_receipt_upload (boolean)`.
  - `categories`: mirrors server fields + `sync_state`, `base_version`, `last_used_at`.
  - `syncQueue`: `{ op_id, user_id, client_id, record_type, record_id, kind, base_version, payload, status ('pending' | 'in_flight' | 'failed' | 'conflict' | 'rejected'), retry_count, next_retry_at, last_error, conflict_server_record, created_at_ms }`.
  - `receiptOutbox`: `{ id, user_id, transaction_id, blob (JPEG EXIF-stripped), mime_type, size_bytes, random_filename, status ('queued' | 'uploading' | 'failed'), retry_count, last_error, created_at }` — deleted immediately once Drive upload succeeds.
  - `syncMeta`: `{ user_id (PK), client_id, last_pulled_seq, last_synced_at, initial_pull_completed, storage_persisted }`.

---

## 5. External Setup Requiring Credentials

1. **Supabase Project**:
   - Create project at `https://supabase.com/dashboard`.
   - Enable Email/Password Auth under Authentication -> Providers.
   - Run `supabase/migrations/20261017000000_init_dompetharian.sql` in SQL Editor.
   - Copy `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
2. **Google Cloud Project (for User's Google Drive Receipts)**:
   - Enable **Google Drive API** in Google Cloud Console (`APIs & Services -> Library`).
   - Configure **OAuth Consent Screen**:
     - App name: `DompetHarian`
     - Scope: `https://www.googleapis.com/auth/drive.file` (Non-sensitive scope: "See, edit, create, and delete only the specific Google Drive files you use with this app").
     - Add test users while in Testing mode (up to 100 users).
   - Create **OAuth 2.0 Client ID** of type **Web application**:
     - Authorized JavaScript origins: `http://localhost:3000` (dev) and `https://your-production-domain.com` (prod).
     - Copy Client ID into `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`. (No client secret is used or stored because we use the browser-only GIS Token Model).
3. **HTTPS Hosting**:
   - Deploy on Vercel, Cloud Run, or a reverse-proxied Node server with TLS/HTTPS (required for Service Worker installation, `navigator.storage.persist()`, camera access, and Google Identity Services).

---

## 6. Test Strategy

- **Unit Tests (Vitest)**:
  - Rupiah integer formatting, live typing parser, floating-point rejection, negative/zero rejection.
  - Transaction & Category Zod validation and domain service rules.
  - Dashboard aggregations: daily total, monthly total, daily average, category breakdown percentages, previous-month comparison, empty months, partial current month, division-by-zero protection, and WIB/WITA/WIT (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`) date boundaries.
  - EXIF/GPS metadata stripper verification (verifies APP1/EXIF JPEG segments including GPS tags are stripped and image is downscaled).
  - Indonesian receipt OCR parser (Indomaret, Alfamart, warteg/warung, Pertashop, uncertain total detection).
  - Safe logger redaction (verifies amounts, descriptions, merchants, tokens, and OCR text are never logged).
- **Integration Tests (Vitest with Real Server Sync Store + Real IndexedDB via `fake-indexeddb`)**:
  - Full Sync Contract verification: Push (`create`, `update`, `delete`), Pull with `change_seq` cursor & tombstones, idempotency on repeated `op_id` retries, optimistic concurrency conflict detection (`base_version` mismatch), conflict resolution (`keep_local`, `keep_server`, `custom_edit`), rejected validation handling, exponential backoff & retry cap.
  - Cross-user authorization & RLS isolation: User A cannot read, update, delete, or sync User B's records; account switch on the same device never leaks or uploads the previous user's local records.
  - Offline receipt queue lifecycle: validate type/size, strip EXIF, queue blob while offline, upload to Drive adapter when online, delete local blob upon confirmation, and handle revoked Drive access / expired token / full quota without data loss.
- **End-to-End Tests (Playwright on Android 360x800 Mobile Emulation)**:
  - Installable PWA manifest & Service Worker registration.
  - Offline operation: toggle browser context offline, navigate across screens, create/edit/delete/search transactions, verify sync badges ("Menunggu", "Tersinkron").
  - Reconnect & sync, conflict resolution UI in Indonesian, logout warning with unsynced transactions, and mobile touch targets (>= 48px).
