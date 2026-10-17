# DompetHarian — Phase 2: WhatsApp Integration Design & Privacy Conflict Note

**Author / Credit:** Aravajordan  
**Status:** Out of Scope for v1 (Not Implemented by Design)

---

## 1. Scope Status

Per the DompetHarian v1 PRD and Build Specification:
- WhatsApp integration is **Phase 2** and is **not implemented or faked** in v1.
- Only the architectural contract (`src/lib/whatsapp/whatsapp-phase2-contract.ts`) and this documentation are provided so future contributors understand how text-based transactions could map into `TransactionDomainService` and why receipt images over WhatsApp present a fundamental privacy conflict.

---

## 2. CRITICAL PRIVACY CONFLICT NOTE

> **Konflik Arsitektur Privasi (Wajib Diputuskan Sebelum Fase 2 Dibangun):**
>
> Aturan privasi inti DompetHarian v1 menetapkan bahwa:
> 1. **Foto struk adalah milik pengguna dan disimpan langsung di Google Drive pribadi pengguna (`drive.file` scope).**
> 2. **Server pengembang tidak pernah menerima, menyimpan, atau memproses gambar struk, serta tidak menyimpan *refresh token* Google Drive milik pengguna.**
>
> **Mengapa WhatsApp Bertentangan dengan Aturan Ini:**
> - Jika pengguna mengirim foto struk melalui **WhatsApp Business Cloud API**, gambar tersebut terlebih dahulu disimpan di server **Meta (WhatsApp)**, lalu harus diunduh oleh **server backend DompetHarian** melalui *webhook* (`GET https://graph.facebook.com/v20.0/{media-id}`).
> - Agar server backend DompetHarian dapat mengunggah foto struk tersebut ke Google Drive pengguna secara otomatis di latar belakang (saat aplikasi sedang ditutup), server DompetHarian juga harus menyimpan **long-lived Google OAuth Refresh Token** milik pengguna, dan menjalankan OCR di sisi server.
> - Hal ini melanggar tiga prinsip privasi v1 sekaligus: (a) struk melewati server pihak ketiga (Meta) dan server DompetHarian, (b) OCR tidak lagi berjalan murni di perangkat pengguna (*on-device*), dan (c) server harus memegang kunci akses (*refresh token*) ke Google Drive pengguna.
>
> **Keputusan yang Harus Diambil Sebelum Fase 2:**
> 1. **Opsi A (Ketat Privasi — Hanya Teks via WhatsApp):** Batasi bot WhatsApp Fase 2 **hanya untuk pesan teks** (misalnya `"makan siang 25000 qris"`), dan tolak kiriman gambar struk dengan pesan balasan yang mengarahkan pengguna membuka PWA DompetHarian untuk memindai struk secara privat di HP mereka.
> 2. **Opsi B (Opt-In Eksplisit dengan Perubahan Kebijakan Privasi):** Jika pengguna ingin mengirim foto struk lewat WhatsApp, minta persetujuan khusus (*explicit opt-in*) bahwa gambar struk yang dikirim lewat WhatsApp akan diproses sementara di memori server dan membutuhkan penyimpanan token otorisasi Google Drive di server.

---

## 3. Prerequisites for Future Phase 2 Implementation

1. Explicit product & privacy decision between Option A and Option B above, plus updated UU PDP privacy notice.
2. Meta Developer App with WhatsApp Business Cloud API configured (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` for `X-Hub-Signature-256` HMAC-SHA256 verification).
3. Verified link table mapping a user's WhatsApp phone number (`E.164` format, verified via OTP) to their `auth.uid()` in Supabase.
4. Webhook endpoint routing parsed text inputs through the existing channel-agnostic `TransactionDomainService.validateCreateInput()` and inserting with `input_source: 'sync_import'` and incremented `change_seq` so the user's Android PWA pulls the transaction on its next sync.
