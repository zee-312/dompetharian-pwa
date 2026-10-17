# DompetHarian — Google Drive Access Design (Stage 0 / Milestone 3)

**Author / Credit:** Aravajordan

---

## 1. Scope Selection & Official Google Classification

- **Requested Scope:** `https://www.googleapis.com/auth/drive.file`
- **No Broader Scopes:** We never request `drive`, `drive.readonly`, or `drive.appdata`.
- **Official Google Scope Classification (Verified against Google Workspace Drive API Auth Guide):**
  - `https://www.googleapis.com/auth/drive.file` is classified by Google as a **Non-Sensitive** scope because it grants per-file access restricted strictly to files and folders that the user creates or explicitly opens with DompetHarian.
  - Because it is non-sensitive, it does **not** require a restricted-scope CASA security audit.
- **OAuth Consent Screen Modes & Limits:**
  - **Testing Mode:** While the Google Cloud OAuth Consent Screen publishing status is set to **Testing**, up to **100 test users** explicitly listed in the Google Cloud Console can authorize the app without Google brand verification. (Note: In authorization-code flows, testing-mode refresh tokens expire after 7 days; in our browser-only GIS Token Model, access tokens are already short-lived ~1 hour and refreshed on-demand in the browser).
  - **Production Mode:** To allow any Google user beyond the 100-test-user list without an "Unverified app" warning, submit the OAuth Consent Screen for basic brand verification (App name, logo, homepage URL, and link to `/privasi` Privacy Policy URL).

---

## 2. Token Architecture (Browser-Only In-Memory GIS Token Model)

### 2.1 How Access Tokens Are Obtained
- We use **Google Identity Services (GIS)** `google.accounts.oauth2.initTokenClient({ client_id, scope: 'https://www.googleapis.com/auth/drive.file', callback })`.
- When the user connects Google Drive or triggers a receipt upload/view while the token is missing or expired, the client requests an access token via `tokenClient.requestAccessToken()`.

### 2.2 Where Tokens Live (RAM Only)
- The resulting OAuth 2.0 `access_token` and its expiry timestamp (`Date.now() + expires_in * 1000`) are stored **exclusively in a private module-scoped variable in browser memory** (`src/lib/drive/drive-token-store.ts`).
- The token is **never** written to:
  - `localStorage` or `sessionStorage`
  - `IndexedDB`
  - Cookies
  - Application logs
  - DompetHarian backend servers
- **Why No Server-Side Refresh Token:** Storing a long-lived OAuth refresh token on our server would give our backend persistent unilateral access to the user's Drive folder even when the user is offline. Keeping short-lived access tokens strictly in browser RAM guarantees our server can **never** access the user's Google Drive.

---

## 3. Folder Structure & Neutral Filenames

1. **Single App Folder (`DompetHarian_Struk`):**
   - Before uploading, the client checks for an existing non-trashed folder named `DompetHarian_Struk` with `mimeType = 'application/vnd.google-apps.folder'` created by this app (`GET https://www.googleapis.com/drive/v3/files?q=...`).
   - If none exists, it creates one (`POST https://www.googleapis.com/drive/v3/files`).
2. **Neutral Random Filenames:**
   - Every uploaded receipt uses a random UUID v4 filename: `{uuid}.jpg` (for example, `a981f32c-41d0-4b2e-9a61-71d29c4b0012.jpg`).
   - Filenames **never** include merchant names, transaction descriptions, rupiah amounts, or dates, preventing metadata leakage in Drive file listings or notifications.

---

## 4. Client-Side Image Preprocessing & EXIF/GPS Stripping

Before a receipt photo enters the local `receiptOutbox` in IndexedDB or is uploaded to Google Drive:
1. **Validation:**
   - Allowed input MIME types: `image/jpeg`, `image/png`, `image/webp`.
   - Maximum input file size: `10 MB` raw capture (`MAX_RAW_RECEIPT_BYTES = 10 * 1024 * 1024`).
2. **EXIF/GPS Stripping & Downscaling:**
   - Binary JPEG segment sanitizer removes `APP1` (`0xFFE1`, which holds EXIF and GPS IFD tags) through `APP15` (`0xFFEF`) and `COM` (`0xFFFE`) markers.
   - Image is rendered onto an HTML5 `<canvas>` downscaled proportionally so `max(width, height) <= 1600px`, then re-encoded via `canvas.toBlob(..., 'image/jpeg', 0.82)`.
   - Re-encoding pixels to a clean JPEG bitstream guarantees zero surviving EXIF/GPS tags and reduces typical 4–8 MB phone camera photos to `~150–400 KB`.

---

## 5. Offline Queue & Upload Lifecycle

1. User captures or selects a receipt photo on `/scan` or `/tambah`.
2. Image is validated, downscaled, and stripped of EXIF/GPS on the device.
3. The transaction can be saved **immediately** (online or offline).
4. If offline or Drive is not yet connected:
   - The compressed JPEG blob is stored in `DompetHarianLocalDB.receiptOutbox` (scoped to `user_id`, capped at `2 MB` per compressed blob and `25 MB` total outbox size).
   - The transaction displays the badge: **"Struk menunggu diunggah"**.
5. When the phone is online and a valid in-memory Drive token is available:
   - `ReceiptUploadWorker` uploads the queued blob via `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`.
   - On HTTP `200 OK` with `{ id: driveFileId }`:
     - Updates the local transaction with `receipt_drive_file_id = driveFileId`, `has_pending_receipt_upload = false`, and enqueues a transaction sync update so the `receipt_drive_file_id` syncs to Supabase PostgreSQL.
     - **Immediately deletes the blob** from `DompetHarianLocalDB.receiptOutbox`.

---

## 6. Failure & Edge-Case Handling (Indonesian User Messages)

| Failure Scenario | HTTP / Error Signal | Behavior & Recovery | Indonesian Message Shown to User |
| :--- | :--- | :--- | :--- |
| **User revokes Drive access** | `401 Unauthorized` / `403 invalid_grant` or token revocation | Clears in-memory token, marks Drive status as disconnected, keeps pending receipt blobs safely in `receiptOutbox` (no data loss). | *"Akses ke Google Drive telah dicabut atau berakhir. Hubungkan kembali Google Drive untuk mengunggah atau melihat foto struk."* |
| **Access token expired** | `Date.now() >= expiresAt` or HTTP `401` | Marks token expired and prompts user to tap *"Hubungkan ulang Google Drive"* to obtain a fresh in-memory token. | *"Sesi Google Drive sudah kedaluwarsa. Ketuk 'Hubungkan Google Drive' untuk melanjutkan."* |
| **Google Drive quota full** | HTTP `403` with `reason: "storageQuotaExceeded"` | Keeps receipt blob in `receiptOutbox`, pauses automatic upload retries, leaves transaction data intact. | *"Penyimpanan Google Drive kamu penuh. Kosongkan ruang di Google Drive lalu ketuk 'Coba Unggah Lagi'."* |
| **File deleted by user in Drive** | HTTP `404 Not Found` when viewing or deleting `fileId` | Shows clear placeholder in receipt viewer and allows user to unlink the missing Drive reference or attach a new photo. | *"File struk ini tidak ditemukan di Google Drive (mungkin sudah dihapus langsung dari Drive). Kamu bisa melepas tautan struk atau mengunggah foto baru."* |
| **Upload interrupted / network drop** | `TypeError: Failed to fetch` / `5xx` | Leaves compressed blob in `receiptOutbox`, increments retry counter, retries automatically when back online. | *"Unggahan struk terputus karena koneksi jaringan. Struk disimpan aman di antrean HP dan akan diunggah saat koneksi stabil."* |
