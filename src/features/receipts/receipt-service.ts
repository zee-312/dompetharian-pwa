/**
 * DompetHarian — Google Drive Receipt Service & Offline Outbox Queue (Milestone 3)
 * Rules:
 * - Receipts belong to the user and are uploaded to a single app folder (DompetHarian_Struk)
 *   in the user's Google Drive using ONLY the drive.file scope.
 * - Offline captures are queued in IndexedDB (localDb.receiptOutbox) as EXIF-stripped JPEG bytes.
 * - Once upload is confirmed by Drive, the local blob is immediately deleted from IndexedDB.
 * - Handles revoked access, expired token, Drive quota full, file deleted in Drive, and interrupted upload
 *   with clear Indonesian messages and zero data loss.
 * Author / Credit: Aravajordan
 */

import {
  DOMPETHARIAN_DRIVE_FOLDER_NAME,
  DriveTokenStore,
} from '@/lib/drive/drive-token-store';
import { localDb, type ReceiptOutboxItem } from '@/lib/sync/dexie-db';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import {
  processReceiptImageForUpload,
  type ProcessedReceiptImage,
} from '@/features/receipts/receipt-image-processor';
import { generateUuidV4 } from '@/features/transactions/transaction-domain';
import { SafeLogger } from '@/lib/security/logger';

export type DriveErrorKind =
  | 'revoked'
  | 'token_expired'
  | 'quota_full'
  | 'file_not_found'
  | 'network_interrupted'
  | 'offline';

export class GoogleDriveReceiptError extends Error {
  constructor(
    public readonly kind: DriveErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'GoogleDriveReceiptError';
  }
}

export interface DriveApiAdapter {
  ensureAppFolder(accessToken: string): Promise<string>;
  uploadReceiptFile(params: {
    accessToken: string;
    folderId: string;
    neutralFilename: string;
    mimeType: 'image/jpeg';
    bytes: Uint8Array;
  }): Promise<{ driveFileId: string; sizeBytes: number }>;
  fetchReceiptFileBytes(params: {
    accessToken: string;
    driveFileId: string;
  }): Promise<{ bytes: Uint8Array; mimeType: string }>;
  deleteReceiptFile(params: {
    accessToken: string;
    driveFileId: string;
  }): Promise<void>;
  deleteAppFolder(params: {
    accessToken: string;
  }): Promise<void>;
}

/**
 * Maps Google Drive HTTP status codes / error payloads to clear Indonesian messages.
 */
export function mapDriveHttpFailureToError(
  status: number,
  errorReason?: string
): GoogleDriveReceiptError {
  if (status === 401) {
    DriveTokenStore.markExpired();
    return new GoogleDriveReceiptError(
      'token_expired',
      'Sesi Google Drive sudah kedaluwarsa. Ketuk "Hubungkan Google Drive" untuk melanjutkan.'
    );
  }
  if (status === 403 && errorReason === 'storageQuotaExceeded') {
    return new GoogleDriveReceiptError(
      'quota_full',
      'Penyimpanan Google Drive kamu penuh. Kosongkan ruang di Google Drive lalu ketuk "Coba Unggah Lagi".'
    );
  }
  if (status === 403) {
    DriveTokenStore.markRevoked();
    return new GoogleDriveReceiptError(
      'revoked',
      'Akses ke Google Drive telah dicabut atau ditolak. Hubungkan kembali Google Drive di Pengaturan untuk mengunggah atau melihat struk.'
    );
  }
  if (status === 404) {
    return new GoogleDriveReceiptError(
      'file_not_found',
      'File struk ini tidak ditemukan di Google Drive (mungkin sudah dihapus langsung dari Drive).'
    );
  }
  return new GoogleDriveReceiptError(
    'network_interrupted',
    'Unggahan struk ke Google Drive terputus karena gangguan jaringan. Struk tetap tersimpan aman di antrean HP.'
  );
}

/**
 * Default Google Drive REST API v3 adapter (plus in-browser/test fallback when using local GIS token).
 */
const simulatedDriveStorage = new Map<
  string,
  { filename: string; mimeType: string; bytes: Uint8Array; folderId: string }
>();

export const defaultDriveApiAdapter: DriveApiAdapter = {
  async ensureAppFolder(accessToken: string): Promise<string> {
    if (accessToken.startsWith('gis_mem_token_')) {
      const folderId = DriveTokenStore.getCachedFolderId() ?? `drive_folder_${DOMPETHARIAN_DRIVE_FOLDER_NAME}`;
      DriveTokenStore.setCachedFolderId(folderId);
      return folderId;
    }

    const cached = DriveTokenStore.getCachedFolderId();
    if (cached) return cached;

    const query = encodeURIComponent(
      `name = '${DOMPETHARIAN_DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!searchRes.ok) {
      const errBody = await searchRes.json().catch(() => ({}));
      const reason = errBody?.error?.errors?.[0]?.reason;
      throw mapDriveHttpFailureToError(searchRes.status, reason);
    }

    const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (searchData.files && searchData.files[0]?.id) {
      DriveTokenStore.setCachedFolderId(searchData.files[0].id);
      return searchData.files[0].id;
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: DOMPETHARIAN_DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.json().catch(() => ({}));
      const reason = errBody?.error?.errors?.[0]?.reason;
      throw mapDriveHttpFailureToError(createRes.status, reason);
    }

    const created = (await createRes.json()) as { id: string };
    DriveTokenStore.setCachedFolderId(created.id);
    return created.id;
  },

  async uploadReceiptFile({ accessToken, folderId, neutralFilename, mimeType, bytes }) {
    if (accessToken.startsWith('gis_mem_token_')) {
      const driveFileId = `gdrive_${generateUuidV4().replace(/-/g, '')}`;
      simulatedDriveStorage.set(driveFileId, {
        filename: neutralFilename,
        mimeType,
        bytes: new Uint8Array(bytes),
        folderId,
      });
      return { driveFileId, sizeBytes: bytes.byteLength };
    }

    const metadata = {
      name: neutralFilename,
      parents: [folderId],
      mimeType,
    };

    const boundary = `dompetharian_${generateUuidV4().replace(/-/g, '')}`;
    const metaPart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;
    const closePart = `\r\n--${boundary}--`;

    const enc = new TextEncoder();
    const metaBytes = enc.encode(metaPart);
    const closeBytes = enc.encode(closePart);
    const bodyBytes = new Uint8Array(metaBytes.length + bytes.byteLength + closeBytes.length);
    bodyBytes.set(metaBytes, 0);
    bodyBytes.set(bytes, metaBytes.length);
    bodyBytes.set(closeBytes, metaBytes.length + bytes.byteLength);

    let res: Response;
    try {
      res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: bodyBytes,
        }
      );
    } catch {
      throw new GoogleDriveReceiptError(
        'network_interrupted',
        'Unggahan struk terputus karena koneksi jaringan. Struk disimpan aman di antrean HP dan akan diunggah saat koneksi stabil.'
      );
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const reason = errBody?.error?.errors?.[0]?.reason;
      throw mapDriveHttpFailureToError(res.status, reason);
    }

    const uploaded = (await res.json()) as { id: string; size?: string };
    return {
      driveFileId: uploaded.id,
      sizeBytes: uploaded.size ? Number(uploaded.size) : bytes.byteLength,
    };
  },

  async fetchReceiptFileBytes({ accessToken, driveFileId }) {
    if (accessToken.startsWith('gis_mem_token_')) {
      const item = simulatedDriveStorage.get(driveFileId);
      if (!item) {
        throw mapDriveHttpFailureToError(404);
      }
      return { bytes: item.bytes, mimeType: item.mimeType };
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const reason = errBody?.error?.errors?.[0]?.reason;
      throw mapDriveHttpFailureToError(res.status, reason);
    }
    const buf = await res.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
  },

  async deleteReceiptFile({ accessToken, driveFileId }) {
    if (accessToken.startsWith('gis_mem_token_')) {
      if (!simulatedDriveStorage.has(driveFileId)) {
        throw mapDriveHttpFailureToError(404);
      }
      simulatedDriveStorage.delete(driveFileId);
      return;
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok && res.status !== 404) {
      const errBody = await res.json().catch(() => ({}));
      const reason = errBody?.error?.errors?.[0]?.reason;
      throw mapDriveHttpFailureToError(res.status, reason);
    }
  },

  async deleteAppFolder({ accessToken }) {
    if (accessToken.startsWith('gis_mem_token_')) {
      simulatedDriveStorage.clear();
      DriveTokenStore.setCachedFolderId(null);
      return;
    }
    const folderId = await this.ensureAppFolder(accessToken);
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    DriveTokenStore.setCachedFolderId(null);
  },
};

export class ReceiptService {
  constructor(private adapter: DriveApiAdapter = defaultDriveApiAdapter) {}

  public setAdapter(adapter: DriveApiAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Validates, strips EXIF/GPS, and queues a receipt image in IndexedDB for a transaction.
   * If online and Drive token is active, immediately attempts upload to Drive and removes the local blob.
   */
  public async attachReceiptToTransaction(params: {
    userId: string;
    transactionId: string;
    rawBytes: Uint8Array;
    mimeType: string;
    originalName?: string;
  }): Promise<{
    queuedLocally: boolean;
    uploadedToDrive: boolean;
    driveFileId: string | null;
    processedImage: ProcessedReceiptImage;
    message: string;
  }> {
    const processed = await processReceiptImageForUpload({
      bytes: params.rawBytes,
      mimeType: params.mimeType,
      originalName: params.originalName,
    });

    const outboxItem: ReceiptOutboxItem = {
      id: params.transactionId,
      user_id: params.userId,
      transaction_id: params.transactionId,
      image_bytes: processed.bytes,
      mime_type: 'image/jpeg',
      size_bytes: processed.sizeBytes,
      neutral_filename: processed.neutralFilename,
      status: 'queued',
      retry_count: 0,
      last_error: null,
      created_at: new Date().toISOString(),
    };

    await localDb.receiptOutbox.put(outboxItem);
    await localRepository.updateTransaction(params.userId, params.transactionId, {
      has_pending_receipt_upload: true,
      receipt_mime_type: 'image/jpeg',
      receipt_size_bytes: processed.sizeBytes,
    });

    // Attempt immediate upload if online and token is available
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    const activeToken = DriveTokenStore.getValidToken();

    if (isOnline && activeToken) {
      const uploadRes = await this.flushOutboxForUser(params.userId);
      const uploadedFileId = uploadRes.uploadedByTxId.get(params.transactionId) ?? null;
      if (uploadedFileId) {
        return {
          queuedLocally: false,
          uploadedToDrive: true,
          driveFileId: uploadedFileId,
          processedImage: processed,
          message: 'Foto struk berhasil diunggah ke Google Drive kamu (metadata lokasi GPS telah dihapus).',
        };
      }
      if (uploadRes.lastError) {
        return {
          queuedLocally: true,
          uploadedToDrive: false,
          driveFileId: null,
          processedImage: processed,
          message: uploadRes.lastError,
        };
      }
    }

    return {
      queuedLocally: true,
      uploadedToDrive: false,
      driveFileId: null,
      processedImage: processed,
      message:
        'Struk menunggu diunggah ke Google Drive saat HP terhubung ke internet dan Google Drive aktif.',
    };
  }

  /**
   * Uploads all queued receipts for `userId` to their Google Drive and deletes each local blob
   * immediately after Drive confirms the upload.
   */
  public async flushOutboxForUser(userId: string): Promise<{
    uploadedCount: number;
    failedCount: number;
    uploadedByTxId: Map<string, string>;
    lastError: string | null;
  }> {
    const uploadedByTxId = new Map<string, string>();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        uploadedCount: 0,
        failedCount: 0,
        uploadedByTxId,
        lastError:
          'Kamu sedang offline. Unggahan foto struk ke Google Drive membutuhkan koneksi internet.',
      };
    }

    const status = DriveTokenStore.getStatus();
    const token = DriveTokenStore.getValidToken();

    if (!token) {
      const msg =
        status === 'revoked'
          ? 'Akses ke Google Drive telah dicabut. Hubungkan kembali Google Drive untuk mengunggah struk yang tertunda.'
          : status === 'expired'
            ? 'Sesi Google Drive sudah kedaluwarsa. Ketuk "Hubungkan Google Drive" untuk melanjutkan unggahan struk.'
            : 'Google Drive belum terhubung. Hubungkan Google Drive untuk mengunggah struk yang menunggu.';
      return {
        uploadedCount: 0,
        failedCount: 0,
        uploadedByTxId,
        lastError: msg,
      };
    }

    const queuedItems = await localDb.receiptOutbox.where('user_id').equals(userId).toArray();
    if (queuedItems.length === 0) {
      return { uploadedCount: 0, failedCount: 0, uploadedByTxId, lastError: null };
    }

    let uploadedCount = 0;
    let failedCount = 0;
    let lastError: string | null = null;

    try {
      const folderId = await this.adapter.ensureAppFolder(token);

      for (const item of queuedItems) {
        try {
          await localDb.receiptOutbox.update(item.id, { status: 'uploading' });
          const { driveFileId, sizeBytes } = await this.adapter.uploadReceiptFile({
            accessToken: token,
            folderId,
            neutralFilename: item.neutral_filename,
            mimeType: item.mime_type,
            bytes: item.image_bytes,
          });

          // Update transaction with Drive file ID and mark pending upload false
          await localRepository.updateTransaction(userId, item.transaction_id, {
            receipt_drive_file_id: driveFileId,
            receipt_mime_type: item.mime_type,
            receipt_size_bytes: sizeBytes,
            has_pending_receipt_upload: false,
          });

          // CRITICAL REQUIREMENT: Immediately delete the local blob after upload is confirmed
          await localDb.receiptOutbox.delete(item.id);
          uploadedCount++;
          uploadedByTxId.set(item.transaction_id, driveFileId);
        } catch (err) {
          failedCount++;
          const msg =
            err instanceof Error
              ? err.message
              : 'Gagal mengunggah struk ke Google Drive.';
          lastError = msg;
          await localDb.receiptOutbox.update(item.id, {
            status: 'failed',
            retry_count: item.retry_count + 1,
            last_error: msg,
          });
          SafeLogger.warn('Receipt upload error', { transactionId: item.transaction_id });
        }
      }
    } catch (folderErr) {
      failedCount = queuedItems.length;
      lastError =
        folderErr instanceof Error
          ? folderErr.message
          : 'Gagal menyiapkan folder DompetHarian_Struk di Google Drive.';
      for (const item of queuedItems) {
        await localDb.receiptOutbox.update(item.id, {
          status: 'failed',
          retry_count: item.retry_count + 1,
          last_error: lastError,
        });
      }
    }

    return { uploadedCount, failedCount, uploadedByTxId, lastError };
  }

  /**
   * Fetches receipt image bytes from local outbox (if still pending upload) or from Google Drive on demand.
   */
  public async loadReceiptImageForTransaction(
    userId: string,
    transactionId: string
  ): Promise<{ bytes: Uint8Array; mimeType: string; source: 'local_outbox' | 'google_drive' }> {
    const localOutbox = await localDb.receiptOutbox.get(transactionId);
    if (localOutbox && localOutbox.user_id === userId) {
      return {
        bytes: localOutbox.image_bytes,
        mimeType: localOutbox.mime_type,
        source: 'local_outbox',
      };
    }

    const tx = await localRepository.getTransactionById(userId, transactionId);
    if (!tx || !tx.receipt_drive_file_id) {
      throw new Error('Transaksi ini tidak memiliki lampiran struk.');
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new GoogleDriveReceiptError(
        'offline',
        'Tidak dapat memuat foto struk dari Google Drive saat offline. Hubungkan HP ke internet untuk melihat gambar struk.'
      );
    }

    const token = DriveTokenStore.getValidToken();
    if (!token) {
      const status = DriveTokenStore.getStatus();
      throw new GoogleDriveReceiptError(
        status === 'revoked' ? 'revoked' : 'token_expired',
        status === 'revoked'
          ? 'Akses ke Google Drive telah dicabut. Hubungkan kembali Google Drive untuk melihat foto struk.'
          : 'Sesi Google Drive sudah kedaluwarsa. Ketuk "Hubungkan Google Drive" untuk melihat foto struk.'
      );
    }

    const fetched = await this.adapter.fetchReceiptFileBytes({
      accessToken: token,
      driveFileId: tx.receipt_drive_file_id,
    });

    return {
      bytes: fetched.bytes,
      mimeType: fetched.mimeType,
      source: 'google_drive',
    };
  }

  /**
   * Deletes the receipt from local outbox and/or Google Drive (with user confirmation in UI)
   * and clears the receipt reference on the transaction.
   */
  public async deleteReceiptFromTransaction(
    userId: string,
    transactionId: string
  ): Promise<void> {
    await localDb.receiptOutbox.delete(transactionId);
    const tx = await localRepository.getTransactionById(userId, transactionId);
    if (!tx) return;

    if (tx.receipt_drive_file_id) {
      const token = DriveTokenStore.getValidToken();
      if (token && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        try {
          await this.adapter.deleteReceiptFile({
            accessToken: token,
            driveFileId: tx.receipt_drive_file_id,
          });
        } catch (err) {
          // If 404 already deleted in Drive, still unlink cleanly
          if (!(err instanceof GoogleDriveReceiptError && err.kind === 'file_not_found')) {
            throw err;
          }
        }
      }
    }

    await localRepository.updateTransaction(userId, transactionId, {
      receipt_drive_file_id: null,
      receipt_mime_type: null,
      receipt_size_bytes: null,
      has_pending_receipt_upload: false,
    });
  }
}

export const receiptService = new ReceiptService();
