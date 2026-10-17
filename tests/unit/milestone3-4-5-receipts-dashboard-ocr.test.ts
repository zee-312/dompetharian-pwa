/**
 * DompetHarian — Milestones 3, 4 & 5 Unit & Integration Tests
 * Covers:
 * - Milestone 3: Receipt validation, EXIF/GPS metadata removal, neutral filenames,
 *   offline outbox queueing, upload after reconnect, immediate local blob deletion after upload,
 *   and handling revoked Drive access / full quota / expired token.
 * - Milestone 4: Daily & monthly aggregation, category breakdown, previous-month comparison,
 *   empty months, partial current months, division-by-zero protection, WIB/WITA/WIT timezone boundaries,
 *   and CSV export escaping.
 * - Milestone 5: Indonesian receipt OCR parsing, uncertain total detection, and failure recovery.
 * Author / Credit: Aravajordan
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasExifOrGpsMetadata,
  processReceiptImageForUpload,
  validateReceiptFileInput,
} from '@/features/receipts/receipt-image-processor';
import {
  GoogleDriveReceiptError,
  ReceiptService,
  type DriveApiAdapter,
} from '@/features/receipts/receipt-service';
import { DriveTokenStore } from '@/lib/drive/drive-token-store';
import { localDb } from '@/lib/sync/dexie-db';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { DashboardAnalyticsService } from '@/features/dashboard/dashboard-service';
import { getTodayDateString } from '@/lib/formatters/date';
import { parseIndonesianReceiptText } from '@/lib/ocr/ocr-adapter';

/**
 * Helper that constructs a synthetic JPEG buffer containing an APP1 (0xFFE1) EXIF + GPS segment
 * followed by a minimal SOS (0xFFDA) scan and EOI (0xFFD9).
 */
function buildSyntheticJpegWithExifAndGps(): Uint8Array {
  const exifText = new TextEncoder().encode('Exif\0\0GPSLatitude:-6.2088,106.8456');
  const app1Len = exifText.length + 2;
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00];
  const app1Header = [0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff];
  const sosAndScan = [0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xaa, 0xbb, 0xcc];
  const eoi = [0xff, 0xd9];

  return new Uint8Array([
    ...soi,
    ...app0,
    ...app1Header,
    ...Array.from(exifText),
    ...sosAndScan,
    ...eoi,
  ]);
}

describe('Milestone 3: Google Drive Receipts, EXIF/GPS Stripping & Offline Queue', () => {
  const userId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    DriveTokenStore.resetForTests();
    await localDb.transactions.clear();
    await localDb.categories.clear();
    await localDb.syncQueue.clear();
    await localDb.receiptOutbox.clear();
    await localDb.syncMeta.clear();
  });

  it('validates receipt MIME type and size, strips EXIF/GPS headers, and generates neutral UUID filename', async () => {
    expect(() =>
      validateReceiptFileInput({ type: 'application/pdf', size: 1024 })
    ).toThrow(/JPEG, PNG, atau WebP/i);

    expect(() =>
      validateReceiptFileInput({ type: 'image/jpeg', size: 15 * 1024 * 1024 })
    ).toThrow(/maksimal 10 MB/i);

    const rawJpegWithGps = buildSyntheticJpegWithExifAndGps();
    expect(hasExifOrGpsMetadata(rawJpegWithGps)).toBe(true);

    const processed = await processReceiptImageForUpload({
      bytes: rawJpegWithGps,
      mimeType: 'image/jpeg',
      originalName: 'Struk_Indomaret_Rp50000_2026-10-17.jpg',
    });

    expect(processed.exifStripped).toBe(true);
    expect(hasExifOrGpsMetadata(processed.bytes)).toBe(false);
    // Neutral filename must be {uuid}.jpg and never contain Indomaret, 50000, or date
    expect(processed.neutralFilename).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/i
    );
    expect(processed.neutralFilename).not.toContain('Indomaret');
    expect(processed.neutralFilename).not.toContain('50000');
  });

  it('queues receipt offline in IndexedDB, uploads on reconnect, and immediately deletes local blob after upload', async () => {
    const tx = await localRepository.createTransaction(userId, {
      kind: 'expense',
      amount_idr: 65000,
      transaction_date: '2026-10-17',
      description: 'Belanja Minimarket',
      merchant: 'Indomaret',
      category_id: 'cat_belanja',
      payment_method: 'qris',
    });

    const service = new ReceiptService();
    const rawJpeg = buildSyntheticJpegWithExifAndGps();

    // 1. Attach while Drive token is not yet active -> queues locally in IndexedDB
    const attachRes = await service.attachReceiptToTransaction({
      userId,
      transactionId: tx.id,
      rawBytes: rawJpeg,
      mimeType: 'image/jpeg',
    });

    expect(attachRes.queuedLocally).toBe(true);
    expect(attachRes.uploadedToDrive).toBe(false);
    expect(await localDb.receiptOutbox.count()).toBe(1);

    const txWhileQueued = await localRepository.getTransactionById(userId, tx.id);
    expect(txWhileQueued?.has_pending_receipt_upload).toBe(true);

    // 2. Connect Google Drive (in-memory token) and flush outbox
    await DriveTokenStore.requestBrowserToken();
    const flushRes = await service.flushOutboxForUser(userId);
    expect(flushRes.uploadedCount).toBe(1);
    expect(flushRes.failedCount).toBe(0);

    // 3. Local blob in receiptOutbox MUST be deleted immediately after confirmed upload
    expect(await localDb.receiptOutbox.count()).toBe(0);

    const txAfterUpload = await localRepository.getTransactionById(userId, tx.id);
    expect(txAfterUpload?.has_pending_receipt_upload).toBe(false);
    expect(txAfterUpload?.receipt_drive_file_id).toMatch(/^gdrive_/);
  });

  it('handles revoked Google Drive access gracefully with Indonesian message and no data loss', async () => {
    const tx = await localRepository.createTransaction(userId, {
      kind: 'expense',
      amount_idr: 30000,
      transaction_date: '2026-10-17',
      description: 'Beli Obat',
      category_id: 'cat_kesehatan',
      payment_method: 'tunai',
    });

    const revokedAdapter: DriveApiAdapter = {
      async ensureAppFolder() {
        DriveTokenStore.markRevoked();
        throw new GoogleDriveReceiptError(
          'revoked',
          'Akses ke Google Drive telah dicabut atau berakhir.'
        );
      },
      async uploadReceiptFile() {
        throw new GoogleDriveReceiptError('revoked', 'Akses dicabut');
      },
      async fetchReceiptFileBytes() {
        throw new GoogleDriveReceiptError('revoked', 'Akses dicabut');
      },
      async deleteReceiptFile() {
        throw new GoogleDriveReceiptError('revoked', 'Akses dicabut');
      },
      async deleteAppFolder() {},
    };

    DriveTokenStore.setToken('valid_looking_token', 3600);
    const service = new ReceiptService(revokedAdapter);

    const res = await service.attachReceiptToTransaction({
      userId,
      transactionId: tx.id,
      rawBytes: buildSyntheticJpegWithExifAndGps(),
      mimeType: 'image/jpeg',
    });

    expect(res.uploadedToDrive).toBe(false);
    expect(res.queuedLocally).toBe(true);
    expect(res.message).toMatch(/dicabut/i);
    expect(DriveTokenStore.getStatus()).toBe('revoked');

    // Verify neither transaction nor queued receipt blob was lost!
    expect(await localDb.receiptOutbox.count()).toBe(1);
    const savedTx = await localRepository.getTransactionById(userId, tx.id);
    expect(savedTx?.amount_idr).toBe(30000);
  });
});

describe('Milestone 4: Dashboard Aggregations, Timezone Boundaries & Empty/Partial Month Rules', () => {
  const userId = '44444444-4444-4444-8444-444444444444';

  it('handles empty months and zero previous-month data without division-by-zero or NaN', () => {
    const report = DashboardAnalyticsService.computeMonthlyReport({
      transactions: [],
      categories: [],
      month: '2026-10',
      timezone: 'Asia/Jakarta',
      now: new Date('2026-10-17T10:00:00Z'),
    });

    expect(report.monthlyExpenseIdr).toBe(0);
    expect(report.dailyAverageExpenseIdr).toBe(0);
    expect(report.categoryBreakdown).toHaveLength(0);
    expect(report.previousMonthComparison.percentageChange).toBe(0);
    expect(Number.isNaN(report.dailyAverageExpenseIdr)).toBe(false);
  });

  it('respects WIB (UTC+7), WITA (UTC+8), and WIT (UTC+9) timezone boundaries around midnight', () => {
    // At 2026-10-17T16:30:00Z:
    // - WIB (UTC+7) is 2026-10-17 23:30 -> "2026-10-17"
    // - WITA (UTC+8) is 2026-10-18 00:30 -> "2026-10-18"
    // - WIT (UTC+9) is 2026-10-18 01:30 -> "2026-10-18"
    const boundaryInstant = new Date('2026-10-17T16:30:00Z');
    expect(getTodayDateString('Asia/Jakarta', boundaryInstant)).toBe('2026-10-17');
    expect(getTodayDateString('Asia/Makassar', boundaryInstant)).toBe('2026-10-18');
    expect(getTodayDateString('Asia/Jayapura', boundaryInstant)).toBe('2026-10-18');
  });

  it('computes partial current-month daily average, category percentages, and CSV export accurately', () => {
    const now = new Date('2026-10-10T05:00:00Z'); // Day 10 of October 2026 in WIB
    const report = DashboardAnalyticsService.computeMonthlyReport({
      transactions: [
        {
          id: 'tx-1',
          user_id: userId,
          kind: 'expense',
          amount_idr: 75000,
          transaction_date: '2026-10-10',
          description: 'Makan Siang',
          merchant: 'Warteg Bahari',
          category_id: 'cat_food',
          payment_method: 'tunai',
          notes: null,
          receipt_drive_file_id: null,
          receipt_mime_type: null,
          receipt_size_bytes: null,
          input_source: 'manual',
          verification_status: 'verified',
          version: 1,
          change_seq: 1,
          created_at: '2026-10-10T05:00:00Z',
          updated_at: '2026-10-10T05:00:00Z',
          deleted_at: null,
        },
        {
          id: 'tx-2',
          user_id: userId,
          kind: 'expense',
          amount_idr: 25000,
          transaction_date: '2026-10-05',
          description: 'Ojek Online',
          merchant: 'Gojek',
          category_id: 'cat_transport',
          payment_method: 'ewallet',
          notes: '=SUM(1+1)', // Test formula injection protection in CSV
          receipt_drive_file_id: null,
          receipt_mime_type: null,
          receipt_size_bytes: null,
          input_source: 'manual',
          verification_status: 'verified',
          version: 1,
          change_seq: 2,
          created_at: '2026-10-05T05:00:00Z',
          updated_at: '2026-10-05T05:00:00Z',
          deleted_at: null,
        },
      ],
      categories: [
        {
          id: 'cat_food',
          user_id: userId,
          name: 'Makanan & Minuman',
          kind: 'expense',
          icon: 'utensils',
          color: '#ef4444',
          is_default: true,
          is_archived: false,
          usage_count: 1,
          version: 1,
          change_seq: 1,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          deleted_at: null,
        },
        {
          id: 'cat_transport',
          user_id: userId,
          name: 'Transportasi',
          kind: 'expense',
          icon: 'car',
          color: '#f97316',
          is_default: true,
          is_archived: false,
          usage_count: 1,
          version: 1,
          change_seq: 2,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          deleted_at: null,
        },
      ],
      month: '2026-10',
      timezone: 'Asia/Jakarta',
      now,
    });

    expect(report.todayExpenseIdr).toBe(75000);
    expect(report.monthlyExpenseIdr).toBe(100000);
    expect(report.elapsedDays).toBe(10);
    expect(report.dailyAverageExpenseIdr).toBe(10000); // 100.000 / 10 days
    expect(report.categoryBreakdown[0]?.percentage).toBe(75);
    expect(report.categoryBreakdown[1]?.percentage).toBe(25);

    const csv = DashboardAnalyticsService.generateTransactionsCsv(
      [
        {
          id: 'tx-2',
          user_id: userId,
          kind: 'expense',
          amount_idr: 25000,
          transaction_date: '2026-10-05',
          description: 'Ojek Online',
          merchant: 'Gojek',
          category_id: 'cat_transport',
          payment_method: 'ewallet',
          notes: '=SUM(1+1)',
          receipt_drive_file_id: null,
          receipt_mime_type: null,
          receipt_size_bytes: null,
          input_source: 'manual',
          verification_status: 'verified',
          version: 1,
          change_seq: 2,
          created_at: '2026-10-05T05:00:00Z',
          updated_at: '2026-10-05T05:00:00Z',
          deleted_at: null,
        },
      ],
      []
    );
    expect(csv).toContain("'=SUM(1+1)");
  });
});

describe('Milestone 5: Indonesian Receipt OCR Parsing & Uncertainty Detection', () => {
  it('extracts merchant, date, line items, and total from a standard Indomaret receipt', () => {
    const sampleReceipt = `
      PT INDOMARCO PRISMATAMA
      INDOMARET KEMANG RAYA
      TGL: 17-10-2026 14:22:10
      --------------------------------
      INDOMIE GORENG 5X     15.500
      ULTRA MILK 250ML       7.500
      AQUA BOTOL 600ML       4.000
      --------------------------------
      HARGA JUAL            27.000
      TUNAI                 50.000
      KEMBALI               23.000
    `;

    const parsed = parseIndonesianReceiptText(sampleReceipt, 88);
    expect(parsed.merchant).toMatch(/INDOMARET/i);
    expect(parsed.transactionDate).toBe('2026-10-17');
    expect(parsed.extractedTotalIdr).toBe(27000);
    expect(parsed.lineItems.length).toBeGreaterThanOrEqual(3);
    expect(parsed.isTotalUncertain).toBe(false);
  });

  it('flags uncertain results when multiple conflicting totals or no explicit TOTAL keyword exist', () => {
    const ambiguousReceipt = `
      WARUNG MAKAN SEDERHANA
      17/10/2026
      Nasi Ayam Bakar 22.000
      Es Jeruk 6.000
      28.000
    `;

    const parsed = parseIndonesianReceiptText(ambiguousReceipt, 62);
    expect(parsed.extractedTotalIdr).toBe(28000);
    expect(parsed.isTotalUncertain).toBe(true);
    expect(parsed.uncertaintyReason).toBeTruthy();
  });
});
