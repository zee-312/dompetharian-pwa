# DompetHarian — Privacy Data-Flow Table & Protection Design (Stage 0 / Milestone 2.6 & 6)

**Author / Credit:** Aravajordan

---

## 1. Privacy Architecture Principles

1. **Zero Server-Side Receipt Storage:** DompetHarian's servers **never** receive, process, cache, or store receipt image files. Receipt photos go directly from the user's Android browser to the user's own Google Drive (`drive.file` scope).
2. **Mandatory Client-Side EXIF & GPS Removal:** Before any receipt image is queued in IndexedDB or uploaded to Google Drive, it is decoded onto an offscreen HTML5 Canvas, downscaled to at most `1600px` on its longest edge, and re-encoded as a fresh JPEG (`quality: 0.82`), stripping 100% of EXIF, IPTC, XMP, and GPS location headers. In environments without Canvas (or as a pre-stage), a binary JPEG APP1/EXIF parser explicitly removes `0xFFE1`—`0xFFEF` metadata segments.
3. **Neutral Filenames in Google Drive:** Files uploaded to the user's Drive folder (`DompetHarian_Struk`) are named `{random_uuid}.jpg` (e.g., `f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg`). Filenames **never** contain merchant names, rupiah amounts, or transaction dates.
4. **On-Device OCR Only:** Tesseract.js runs locally inside a Web Worker on the user's Android phone. Receipt images and extracted OCR text are **never** sent to any third-party AI or cloud OCR API, and OCR text is **never** written to application logs.
5. **Strict Per-User Namespacing:** Both PostgreSQL (via RLS `auth.uid() = user_id`) and local IndexedDB (via `user_id` keys on every table) isolate users. Switching accounts on the same phone never exposes or syncs the previous user's records.

---

## 2. Privacy Data-Flow Table

| Data Type | Where It Is Stored | Who Can Read It | How Long It Is Kept | How It Is Deleted |
| :--- | :--- | :--- | :--- | :--- |
| **Transactions** (amount, date, description, merchant, category, payment method, notes) | **Local:** IndexedDB (`DompetHarianLocalDB.transactions`), scoped by `user_id`.<br>**Server:** Supabase PostgreSQL `transactions` table (RLS-protected). | Only the authenticated owner (`user_id = auth.uid()`). Never logged by server or client logger. | Kept until the user deletes the transaction, clears local data, or deletes their account. Soft-deleted tombstones (`deleted_at`) are kept for multi-device sync and purged on account deletion. |1. Individual delete in app (soft-delete tombstone synced to server).<br>2. *"Hapus data lokal"* in Pengaturan clears IndexedDB for that user.<br>3. *"Hapus Akun Permanen"* hard-deletes all user rows on server and local IndexedDB. |
| **Receipt Image (Pending Offline Upload)** | **Local Only:** IndexedDB `receiptOutbox` table as an EXIF-stripped, compressed JPEG Blob (max 2 MB after compression, max 20 queued blobs). **Never** stored in Service Worker cache or server. | Only the local browser session of `user_id` on that physical phone. | Temporary: kept **only** while waiting for internet + Google Drive connection. Deleted **immediately and automatically** as soon as Google Drive confirms upload (`file.id` received). | 1. Automatically deleted from IndexedDB immediately after Drive upload succeeds.<br>2. Deleted when user deletes the transaction/receipt.<br>3. Deleted on *"Hapus data lokal"* or *"Hapus Akun"*. |
| **Receipt Image (Uploaded)** | **User's Own Google Drive:** Inside the `DompetHarian_Struk` folder created by the app under `drive.file` scope, named `{uuid}.jpg`. **Never** on DompetHarian servers. | Only the user in their Google Drive, and the DompetHarian client browser when holding an active in-memory GIS access token. | Kept in the user's Google Drive until the user deletes the receipt in the app, deletes the file in Google Drive, or chooses to delete the Drive folder during account deletion. | 1. Deleting a receipt or its transaction in the app calls `DELETE https://www.googleapis.com/drive/v3/files/{fileId}` (after user confirmation).<br>2. Direct deletion by user inside Google Drive.<br>3. Optional Drive folder deletion during *"Hapus Akun Permanen"*. |
| **Receipt Metadata** (`receipt_drive_file_id`, `mime_type`, `size_bytes`) | **Local:** IndexedDB `transactions` record.<br>**Server:** Columns on `transactions` (and `receipt_metadata` table) in Supabase PostgreSQL. | Only the authenticated owner (`user_id = auth.uid()`). | Same lifecycle as the parent transaction. | Cleared when the receipt is removed, transaction is deleted, or account is deleted. |
| **OCR Extracted Text** | **In-Memory Only** (React component state during the `/scan` verification step). **Never** stored in IndexedDB or server database; **never** logged. | Only the active user viewing the `/scan` verification screen. | Ephemeral (seconds): discarded as soon as the user saves the verified transaction, cancels scan, or leaves `/scan`. | Automatically garbage-collected from RAM on form submit, cancel, or navigation. |
| **Auth Session (Supabase)** | **Local:** Browser `localStorage` (`dh_auth_session` / Supabase client storage) to allow offline app launch after first online login.<br>**Server:** HTTP-only / SSR cookies when online. **Never** cached by Service Worker. | Only the local browser origin and Supabase Auth verification endpoint. Passwords are **never** stored locally. | Access JWT expires per Supabase config (e.g., 1h); refresh token rotates when online. Offline session unlocks local IndexedDB for the same `user_id` until explicit logout. | Cleared upon Logout (with unsynced-data warning) or Account Deletion. |
| **Google Drive Access Token** | **Browser RAM Only** (`DriveTokenStore` JavaScript module variable). **Never** stored in `localStorage`, `sessionStorage`, `IndexedDB`, cookies, or server database. No Drive refresh token is ever requested or stored on the server. | Only the active browser tab's Drive client module while making `googleapis.com/drive/v3` calls. | Short-lived (`~3600` seconds) or until page reload / tab close / explicit disconnect. | 1. Cleared automatically on tab close or page refresh.<br>2. User clicks *"Putuskan Google Drive"* which calls `google.accounts.oauth2.revoke(token)` and zeroes memory.<br>3. User revokes access at `myaccount.google.com/permissions`. |
| **App Lock PIN** | **Local:** PBKDF2-SHA256 salted hash (`100,000` iterations + random 16-byte salt) in `localStorage` scoped to `user_id`. Plaintext PIN is **never** stored. | Verified locally in the browser using WebCrypto (`crypto.subtle`). | Until user disables PIN in Pengaturan, clears local data, or logs out with local wipe. | User disables PIN in `/pengaturan` or runs *"Hapus data lokal"*. |

---

## 3. Honest Disclosure on App Lock PIN vs. At-Rest Encryption

As required by Milestone 2.6:
- **What the PIN Protects:** The App Lock PIN blocks the DompetHarian user interface when the app is opened or resumes from the background after the configured timeout (e.g. immediately, 1 minute, 5 minutes), protecting against casual snooping if someone borrows your unlocked phone.
- **What the PIN Does Not Protect:** IndexedDB records are stored in standard browser storage and are **not** encrypted at rest with the PIN (because background/foreground sync and indexed date/category queries in IndexedDB require readable index keys). An attacker with root/ADB debugging access to the operating system or physical forensic access to an unencrypted phone filesystem could inspect raw IndexedDB files. Users should always enable Android system screen lock and full-disk encryption. This exact disclosure is shown in Bahasa Indonesia inside the app's PIN settings and `/privasi` screen.

---

## 4. Note for Application Owner: Indonesian Personal Data Protection Law (UU PDP)

> **Catatan Kepatuhan UU PDP (UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi):**  
> Dokumentasi ini bersifat teknis dan bukan merupakan nasihat hukum (*not legal advice*). Pemilik/pengelola aplikasi DompetHarian yang mengoperasikan layanan untuk pengguna di Indonesia wajib meninjau kewajiban sebagai **Pengendali Data Pribadi** berdasarkan UU No. 27 Tahun 2022 (UU PDP), antara lain:
> 1. Menyediakan pemberitahuan privasi yang transparan dalam bahasa Indonesia dan memperoleh persetujuan eksplisit (*explicit consent*) sebelum memproses data keuangan pribadi.
> 2. Memenuhi hak subjek data untuk mengakses, memperbaiki, mengekspor (portabilitas data melalui CSV), menarik persetujuan, dan menghapus seluruh data pribadi (*hak untuk dilupakan / penghapusan akun*).
> 3. Melaksanakan pengamanan teknis yang memadai (RLS, TLS/HTTPS, minimisasi data dengan menyimpan foto struk di Google Drive milik pengguna sendiri).
> 4. Memberitahukan secara tertulis kepada subjek data dan otoritas terkait maksimal 3 x 24 jam apabila terjadi kegagalan pelindungan data pribadi.
