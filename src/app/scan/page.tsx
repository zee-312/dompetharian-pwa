'use client';

/**
 * DompetHarian — Halaman Scan Struk & OCR di Perangkat (Milestone 3 & Milestone 5)
 * Rules:
 * - On-device OCR via Tesseract.js Web Worker; never sends receipt images to any third-party AI/OCR server.
 * - Progress indicator and cancel button so the user is never stuck waiting.
 * - Never assumes an extracted number is the correct total without user confirmation; highlights uncertain fields.
 * - Strips EXIF/GPS metadata and queues receipt for upload to the user's own Google Drive (drive.file).
 * Author / Credit: Aravajordan
 */

import React, { useRef, useState } from 'react';
import { useApp } from '@/components/layout/AppContext';
import {
  parseIndonesianReceiptText,
  TesseractOnDeviceAdapter,
  type OcrProgressUpdate,
  type ParsedReceiptFields,
} from '@/lib/ocr/ocr-adapter';
import { createSyntheticTestJpegBytes } from '@/features/receipts/receipt-image-processor';
import { receiptService } from '@/features/receipts/receipt-service';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { formatRupiah, parseRupiahInput } from '@/lib/formatters/currency';
import { getTodayDateString } from '@/lib/formatters/date';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/database/types';

const SAMPLE_INDOMARET_RECEIPT_TEXT = `PT INDOMARET PRISMATAMA
JL. SUDIRMAN NO. 45 JAKARTA
TGL: 17/10/2026 14:22:10
--------------------------------
ROTI TAWAR KUPAS        15.500
SUSU UHT FULL CREAM     19.000
AIR MINERAL 600ML        4.000
--------------------------------
HARGA JUAL              38.500
TOTAL BELANJA        Rp 38.500
TUNAI                   50.000
KEMBALI                 11.500`;

export default function ScanStrukPage() {
  const { session, categories, timezone, isOnline, refreshLocalData, triggerSyncNow, navigateTo } = useApp();

  const [selectedImageBytes, setSelectedImageBytes] = useState<Uint8Array | null>(null);
  const [selectedMimeType, setSelectedMimeType] = useState<string>('image/jpeg');
  const [selectedFileName, setSelectedFileName] = useState<string>('struk.jpg');

  const [ocrProgress, setOcrProgress] = useState<OcrProgressUpdate | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<ParsedReceiptFields | null>(null);

  // Editable verification form fields
  const [amountInput, setAmountInput] = useState<string>('');
  const [merchantInput, setMerchantInput] = useState<string>('');
  const [descriptionInput, setDescriptionInput] = useState<string>('');
  const [dateInput, setDateInput] = useState<string>(() => getTodayDateString(timezone));
  const [categoryId, setCategoryId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('tunai');
  const [notesInput, setNotesInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const expenseCategories = categories.filter((c) => c.kind === 'expense' && !c.is_archived);
  const activeCategoryId = categoryId || expenseCategories[0]?.id || '';

  const populateVerificationForm = (parsed: ParsedReceiptFields) => {
    setParsedResult(parsed);
    setAmountInput(parsed.extractedTotalIdr ? String(parsed.extractedTotalIdr) : '');
    setMerchantInput(parsed.merchant ?? '');
    setDateInput(parsed.transactionDate || getTodayDateString(timezone));
    const defaultDesc =
      parsed.lineItems.length > 0
        ? parsed.lineItems.map((li) => li.description).slice(0, 2).join(', ')
        : parsed.merchant
          ? `Belanja di ${parsed.merchant}`
          : 'Belanja dari Scan Struk';
    setDescriptionInput(defaultDesc);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOcrError(null);
    setSaveMessage(null);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    setSelectedImageBytes(bytes);
    setSelectedMimeType(file.type || 'image/jpeg');
    setSelectedFileName(file.name || 'struk.jpg');

    await runOnDeviceOcr(bytes);
  };

  const runOnDeviceOcr = async (bytes: Uint8Array) => {
    setIsScanning(true);
    setOcrError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const adapter = new TesseractOnDeviceAdapter();
    try {
      const output = await adapter.extractText(bytes, {
        signal: controller.signal,
        onProgress: (upd) => setOcrProgress(upd),
      });
      const parsed = parseIndonesianReceiptText(
        output.rawText,
        output.confidence,
        getTodayDateString(timezone)
      );
      populateVerificationForm(parsed);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal membaca teks struk. Silakan isi nominal secara manual.';
      setOcrError(msg);
      // Still allow manual entry with the captured receipt photo attached
      populateVerificationForm({
        merchant: null,
        transactionDate: getTodayDateString(timezone),
        extractedTotalIdr: null,
        candidateTotalsIdr: [],
        lineItems: [],
        isTotalUncertain: true,
        confidenceScore: 0,
        uncertaintyReason: msg,
      });
    } finally {
      setIsScanning(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelOcr = () => {
    abortControllerRef.current?.abort();
    setIsScanning(false);
    setOcrProgress({
      stage: 'cancelled',
      progressPercent: 0,
      message: 'Pemindaian OCR dibatalkan. Kamu bisa mengisi atau memperbaiki data secara manual di bawah.',
    });
    if (!parsedResult) {
      populateVerificationForm({
        merchant: null,
        transactionDate: getTodayDateString(timezone),
        extractedTotalIdr: null,
        candidateTotalsIdr: [],
        lineItems: [],
        isTotalUncertain: true,
        confidenceScore: 0,
        uncertaintyReason: 'Pemindaian dibatalkan oleh pengguna. Silakan isi nominal secara manual.',
      });
    }
  };

  const handleSimulateSampleReceipt = () => {
    setOcrError(null);
    setSaveMessage(null);
    const sampleBytes = createSyntheticTestJpegBytes(true);
    setSelectedImageBytes(sampleBytes);
    setSelectedMimeType('image/jpeg');
    setSelectedFileName('CONTOH_STRUK_INDOMARET.jpg');
    setOcrProgress({
      stage: 'done',
      progressPercent: 100,
      message: 'Contoh struk berhasil diekstrak di perangkat. Silakan periksa dan konfirmasi.',
    });
    const parsed = parseIndonesianReceiptText(
      SAMPLE_INDOMARET_RECEIPT_TEXT,
      91,
      getTodayDateString(timezone)
    );
    populateVerificationForm(parsed);
  };

  const handleConfirmAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    const amountIdr = parseRupiahInput(amountInput);
    if (!amountIdr || amountIdr <= 0) {
      setOcrError('Nominal total wajib diisi dengan angka Rupiah bulat positif sebelum menyimpan.');
      return;
    }
    if (!activeCategoryId) {
      setOcrError('Pilih kategori pengeluaran terlebih dahulu.');
      return;
    }

    setIsSaving(true);
    setOcrError(null);
    try {
      const createdTx = await localRepository.createTransaction(session.userId, {
        kind: 'expense',
        amount_idr: amountIdr,
        transaction_date: dateInput,
        description: descriptionInput.trim() || 'Belanja dari Scan Struk',
        merchant: merchantInput.trim() || null,
        category_id: activeCategoryId,
        payment_method: paymentMethod,
        notes: notesInput.trim() || null,
        input_source: 'ocr',
        verification_status: 'verified',
      });

      if (selectedImageBytes) {
        const receiptRes = await receiptService.attachReceiptToTransaction({
          userId: session.userId,
          transactionId: createdTx.id,
          rawBytes: selectedImageBytes,
          mimeType: selectedMimeType,
          originalName: selectedFileName,
        });
        setSaveMessage(receiptRes.message);
      }

      await refreshLocalData();
      if (isOnline) {
        void triggerSyncNow();
      }
      navigateTo('/riwayat');
    } catch (err) {
      setOcrError(
        err instanceof Error ? err.message : 'Gagal menyimpan transaksi dari hasil scan struk.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div>
        <h1 className="text-lg font-bold tracking-tight font-serif text-[#1C1917]">Scan Struk Belanja (OCR di HP)</h1>
        <p className="mt-0.5 text-xs text-[#6B635B]">
          Pembacaan teks berjalan di perangkat menggunakan Tesseract.js. Foto struk tidak pernah
          dikirim ke layanan OCR pihak ketiga dan lokasi GPS dihapus otomatis.
        </p>
      </div>

      {/* Step 1: Capture / Pick Image or Simulate */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <label
            htmlFor="receipt-camera-input"
            className="min-h-touch flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#2E5A44] px-4 py-3 text-center text-xs font-bold text-white shadow-sm hover:bg-[#234735]"
          >
            <span>Ambil Foto / Pilih Gambar Struk</span>
            <input
              id="receipt-camera-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => void handleFileChange(e)}
              className="sr-only"
            />
          </label>

          <button
            type="button"
            onClick={handleSimulateSampleReceipt}
            data-testid="btn-simulate-sample-receipt"
            className="min-h-touch rounded-xl border border-emerald-700 bg-[#E3EFE8] px-4 py-3 text-xs font-bold text-[#1E402F] hover:bg-[#E3EFE8]"
          >
            Gunakan Contoh Struk Indomaret
          </button>
        </div>

        <p className="text-[11px] text-[#6B635B]">
          Format didukung: JPEG, PNG, WebP (maks. 10 MB). Nama file asli dan koordinat lokasi EXIF
          GPS dihapus sebelum disimpan.
        </p>
      </section>

      {/* Progress & Cancel UI */}
      {(isScanning || ocrProgress) && (
        <section
          aria-live="polite"
          className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-2.5"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#1C1917]">
              {ocrProgress?.message ?? 'Memproses gambar struk...'}
            </span>
            <span className="font-bold text-[#2E5A44]">
              {ocrProgress?.progressPercent ?? 0}%
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F3EDE2]">
            <div
              className="h-full rounded-full bg-[#2E5A44] transition-all"
              style={{ width: `${ocrProgress?.progressPercent ?? 10}%` }}
            />
          </div>
          {isScanning && (
            <button
              type="button"
              onClick={handleCancelOcr}
              data-testid="btn-cancel-ocr"
              className="min-h-touch w-full rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] px-3 py-2 text-xs font-bold text-[#9A3B1B] hover:bg-[#F9E6DF]"
            >
              Batalkan OCR & Isi Manual
            </button>
          )}
        </section>
      )}

      {ocrError && (
        <div
          role="alert"
          className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 text-xs font-medium text-[#7A520B]"
        >
          {ocrError}
        </div>
      )}

      {saveMessage && (
        <div
          role="status"
          className="rounded-xl border border-[#B8D4C5] bg-[#E3EFE8] p-3 text-xs font-medium text-[#1E402F]"
        >
          {saveMessage}
        </div>
      )}

      {/* Verification Form (Always requires user confirmation before saving) */}
      {parsedResult && (
        <form
          onSubmit={(e) => void handleConfirmAndSave(e)}
          className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-4"
        >
          <div className="border-b border-slate-100 pb-2">
            <h2 className="text-sm font-bold text-[#1C1917]">
              Verifikasi Hasil Pembacaan Struk
            </h2>
            <p className="text-xs text-[#6B635B]">
              Periksa nominal dan detail di bawah sebelum menyimpan transaksi.
            </p>
          </div>

          {parsedResult.isTotalUncertain && (
            <div
              role="status"
              data-testid="ocr-uncertainty-banner"
              className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 text-xs text-[#7A520B]"
            >
              <p className="font-bold">Periksa Kembali Nominal Total</p>
              <p className="mt-0.5">
                {parsedResult.uncertaintyReason ??
                  'Mesin OCR kurang yakin dengan angka total pada struk. Pastikan nominal di bawah sudah sesuai.'}
              </p>
            </div>
          )}

          {/* Candidate Total Chips */}
          {parsedResult.candidateTotalsIdr.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#6B635B]">
                Angka yang terdeteksi di struk (ketuk untuk memilih):
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {parsedResult.candidateTotalsIdr.map((cand) => (
                  <button
                    key={cand}
                    type="button"
                    onClick={() => setAmountInput(String(cand))}
                    className={`min-h-touch rounded-xl border px-3 py-1.5 text-xs font-bold ${
                      parseRupiahInput(amountInput) === cand
                        ? 'border-emerald-700 bg-[#2E5A44] text-white'
                        : 'border-[#D8CEBE] bg-[#F3EDE2] text-[#1C1917] hover:bg-[#F3EDE2]'
                    }`}
                  >
                    {formatRupiah(cand)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="ocr-amount" className="block text-xs font-bold text-[#1C1917]">
              Nominal Total (IDR) *
            </label>
            <span className="block text-[11px] text-[#6B635B]">
              Masukkan angka Rupiah bulat tanpa desimal (contoh: 38500).
            </span>
            <input
              id="ocr-amount"
              type="text"
              inputMode="numeric"
              required
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              data-testid="ocr-amount-input"
              className={`mt-1 min-h-touch w-full rounded-xl border px-3.5 py-2.5 text-base font-extrabold font-serif tabular-nums text-[#1C1917] focus:outline-none ${
                parsedResult.isTotalUncertain
                  ? 'border-amber-500 bg-[#FDF3DC]/40 focus:border-amber-600'
                  : 'border-[#D8CEBE] bg-[#FFFDF9] focus:border-[#2E5A44]'
              }`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ocr-merchant" className="block text-xs font-bold text-[#1C1917]">
                Nama Toko / Merchant
              </label>
              <input
                id="ocr-merchant"
                type="text"
                value={merchantInput}
                onChange={(e) => setMerchantInput(e.target.value)}
                data-testid="ocr-merchant-input"
                placeholder="Contoh: Indomaret"
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3 py-2 text-sm text-[#1C1917]"
              />
            </div>

            <div>
              <label htmlFor="ocr-date" className="block text-xs font-bold text-[#1C1917]">
                Tanggal Transaksi *
              </label>
              <input
                id="ocr-date"
                type="date"
                required
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                data-testid="ocr-date-input"
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3 py-2 text-sm text-[#1C1917]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ocr-description" className="block text-xs font-bold text-[#1C1917]">
              Deskripsi Transaksi *
            </label>
            <input
              id="ocr-description"
              type="text"
              required
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
              data-testid="ocr-description-input"
              className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ocr-category" className="block text-xs font-bold text-[#1C1917]">
                Kategori *
              </label>
              <select
                id="ocr-category"
                value={activeCategoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1C1917]"
              >
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ocr-payment" className="block text-xs font-bold text-[#1C1917]">
                Metode Pembayaran
              </label>
              <select
                id="ocr-payment"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1C1917]"
              >
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {parsedResult.lineItems.length > 0 && (
            <div className="rounded-xl bg-[#F3EDE2] p-3 text-xs">
              <p className="font-bold text-[#6B635B]">Item Terbaca di Struk:</p>
              <ul className="mt-1 space-y-1 text-[#6B635B]">
                {parsedResult.lineItems.map((item, idx) => (
                  <li key={`${item.description}-${idx}`} className="flex justify-between">
                    <span>{item.description}</span>
                    <span className="font-semibold">{formatRupiah(item.amountIdr)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label htmlFor="ocr-notes" className="block text-xs font-bold text-[#1C1917]">
              Catatan Tambahan (Opsional)
            </label>
            <input
              id="ocr-notes"
              type="text"
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="Catatan tambahan..."
              className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3 py-2 text-sm text-[#1C1917]"
            />
          </div>

          <button
            type="submit"
            disabled={isSaving}
            data-testid="btn-confirm-ocr-save"
            className="min-h-touch w-full rounded-xl bg-[#2E5A44] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#234735] disabled:opacity-50"
          >
            {isSaving ? 'Menyimpan...' : 'Konfirmasi & Simpan Transaksi'}
          </button>
        </form>
      )}
    </div>
  );
}
