'use client';

/**
 * DompetHarian — Detail, Edit, Delete & Receipt Viewer Screen (/transaksi/[id] — PRD Section 5.5)
 * - Works offline for viewing, editing, and deleting (with confirmation).
 * - Fetches receipt from local outbox or Google Drive on demand using the in-memory token.
 * Author / Credit: Aravajordan
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Trash2,
  Save,
  Image as ImageIcon,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '@/components/layout/AppContext';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { receiptService } from '@/features/receipts/receipt-service';
import { formatRupiah, formatRupiahLiveInput } from '@/lib/formatters/currency';
import { SyncBadge } from '@/components/ui/SyncBadge';
import {
  PAYMENT_METHOD_LABELS,
  type LocalTransactionRecord,
  type PaymentMethod,
  type TransactionKind,
} from '@/lib/database/types';

export default function TransaksiDetailPage() {
  const params = useParams<{ id: string }>();
  const {
    session,
    activePath,
    navigateTo,
    transactions,
    categories,
    refreshLocalData,
    triggerSyncNow,
    isOnline,
    connectGoogleDrive,
  } = useApp();

  const txId =
    params?.id ||
    (activePath.startsWith('/transaksi/') ? activePath.split('/')[2] ?? '' : '');

  const existingTx = useMemo<LocalTransactionRecord | undefined>(
    () => transactions.find((t) => t.id === txId),
    [transactions, txId]
  );

  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amountIdr, setAmountIdr] = useState<number>(0);
  const [transactionDate, setTransactionDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [merchant, setMerchant] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('tunai');
  const [notes, setNotes] = useState<string>('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);
  const [showReceiptDeleteConfirm, setShowReceiptDeleteConfirm] = useState<boolean>(false);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!existingTx) return;
    setKind(existingTx.kind);
    const formatted = formatRupiahLiveInput(String(existingTx.amount_idr));
    setAmountDisplay(formatted.display);
    setAmountIdr(formatted.value);
    setTransactionDate(existingTx.transaction_date);
    setDescription(existingTx.description);
    setMerchant(existingTx.merchant ?? '');
    setCategoryId(existingTx.category_id);
    setPaymentMethod(existingTx.payment_method);
    setNotes(existingTx.notes ?? '');
  }, [existingTx]);

  const handleAmountChange = (raw: string) => {
    const formatted = formatRupiahLiveInput(raw);
    setAmountDisplay(formatted.display);
    setAmountIdr(formatted.value);
  };

  const handleSaveUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !existingTx) return;
    if (amountIdr <= 0) {
      setErrorMessage('Nominal Rupiah harus lebih besar dari Rp 0.');
      return;
    }

    try {
      await localRepository.updateTransaction(session.userId, existingTx.id, {
        kind,
        amount_idr: amountIdr,
        transaction_date: transactionDate,
        description: description.trim() || 'Transaksi',
        merchant: merchant.trim() || null,
        category_id: categoryId,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        verification_status: 'verified',
      });
      await refreshLocalData();
      if (isOnline) {
        void triggerSyncNow();
      }
      setStatusMessage('Perubahan transaksi berhasil disimpan.');
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Gagal memperbarui transaksi.'
      );
    }
  };

  const handleConfirmDeleteTransaction = async () => {
    if (!session || !existingTx) return;
    await localRepository.deleteTransaction(session.userId, existingTx.id);
    await refreshLocalData();
    if (isOnline) {
      void triggerSyncNow();
    }
    navigateTo('/riwayat');
  };

  const handleLoadReceiptImage = async () => {
    if (!session || !existingTx) return;
    setReceiptMessage(null);
    try {
      const loaded = await receiptService.loadReceiptImageForTransaction(
        session.userId,
        existingTx.id
      );
      const blob = new Blob([loaded.bytes.buffer as ArrayBuffer], { type: loaded.mimeType });
      const url = URL.createObjectURL(blob);
      setReceiptPreviewUrl(url);
      setReceiptMessage(
        loaded.source === 'local_outbox'
          ? 'Menampilkan struk dari antrean lokal HP (menunggu diunggah ke Google Drive).'
          : 'Menampilkan struk langsung dari Google Drive pribadimu.'
      );
    } catch (err) {
      setReceiptMessage(
        err instanceof Error ? err.message : 'Gagal memuat foto struk.'
      );
    }
  };

  const handleUploadNewReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session || !existingTx) return;
    try {
      const buf = await file.arrayBuffer();
      const res = await receiptService.attachReceiptToTransaction({
        userId: session.userId,
        transactionId: existingTx.id,
        rawBytes: new Uint8Array(buf),
        mimeType: file.type || 'image/jpeg',
        originalName: file.name,
      });
      setReceiptMessage(res.message);
      await refreshLocalData();
    } catch (err) {
      setReceiptMessage(
        err instanceof Error ? err.message : 'Gagal melampirkan foto struk.'
      );
    }
  };

  const handleConfirmDeleteReceipt = async () => {
    if (!session || !existingTx) return;
    try {
      await receiptService.deleteReceiptFromTransaction(session.userId, existingTx.id);
      setReceiptPreviewUrl(null);
      setShowReceiptDeleteConfirm(false);
      setReceiptMessage('Foto struk berhasil dihapus.');
      await refreshLocalData();
    } catch (err) {
      setReceiptMessage(
        err instanceof Error ? err.message : 'Gagal menghapus foto struk.'
      );
    }
  };

  if (!existingTx) {
    return (
      <div className="bg-[#FFFDF9] rounded-2xl p-5 border border-[#E5DEC9] text-center space-y-3">
        <p className="text-sm font-semibold text-[#1C1917]">
          Transaksi tidak ditemukan atau sudah dihapus.
        </p>
        <Link
          href="/riwayat"
          className="inline-flex items-center justify-center touch-target-48 px-4 py-2 rounded-xl bg-[#2E5A44] text-white text-xs font-bold"
        >
          Kembali ke Riwayat
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E5DEC9] shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/riwayat"
          className="touch-target-48 inline-flex items-center gap-1.5 text-xs font-bold text-[#6B635B] hover:text-[#1C1917]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Kembali</span>
        </Link>
        <SyncBadge
          syncState={existingTx.sync_state}
          hasPendingReceiptUpload={existingTx.has_pending_receipt_upload}
          receiptDriveFileId={existingTx.receipt_drive_file_id}
        />
      </div>

      <h1 className="text-base font-bold text-[#1C1917]">Detail & Edit Transaksi</h1>

      {existingTx.last_error && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-[#F9E6DF] border border-[#E8BFB0] text-xs text-[#9A3B1B] flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold">Pesan Sinkronisasi:</p>
            <p>{existingTx.last_error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSaveUpdate} className="space-y-3">
        <div className="grid grid-cols-2 gap-2 bg-[#F3EDE2] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setKind('expense')}
            className={`touch-target-48 rounded-lg text-xs font-bold ${
              kind === 'expense' ? 'bg-red-600 text-white' : 'text-[#6B635B]'
            }`}
          >
            Pengeluaran
          </button>
          <button
            type="button"
            onClick={() => setKind('income')}
            className={`touch-target-48 rounded-lg text-xs font-bold ${
              kind === 'income' ? 'bg-[#2E5A44] text-white' : 'text-[#6B635B]'
            }`}
          >
            Pemasukan
          </button>
        </div>

        <div>
          <label htmlFor="edit-amount" className="block text-xs font-bold text-[#6B635B] mb-1">
            Nominal Rupiah ({formatRupiah(amountIdr || 0)})
          </label>
          <input
            id="edit-amount"
            data-testid="edit-amount-input"
            type="text"
            inputMode="numeric"
            required
            value={amountDisplay}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="w-full touch-target-48 px-3.5 py-2.5 rounded-xl border border-[#D8CEBE] text-lg font-extrabold"
          />
        </div>

        <div>
          <label htmlFor="edit-description" className="block text-xs font-bold text-[#6B635B] mb-1">
            Deskripsi
          </label>
          <input
            id="edit-description"
            data-testid="edit-description-input"
            type="text"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full touch-target-48 px-3.5 py-2 rounded-xl border border-[#D8CEBE] text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="edit-date" className="block text-xs font-bold text-[#6B635B] mb-1">
              Tanggal
            </label>
            <input
              id="edit-date"
              type="date"
              required
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full touch-target-48 px-3 py-2 rounded-xl border border-[#D8CEBE] text-xs font-semibold"
            />
          </div>
          <div>
            <label htmlFor="edit-category" className="block text-xs font-bold text-[#6B635B] mb-1">
              Kategori
            </label>
            <select
              id="edit-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full touch-target-48 px-3 py-2 rounded-xl border border-[#D8CEBE] text-xs font-semibold bg-[#FFFDF9]"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="edit-merchant" className="block text-xs font-bold text-[#6B635B] mb-1">
              Toko / Merchant
            </label>
            <input
              id="edit-merchant"
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full touch-target-48 px-3 py-2 rounded-xl border border-[#D8CEBE] text-xs"
            />
          </div>
          <div>
            <label htmlFor="edit-payment" className="block text-xs font-bold text-[#6B635B] mb-1">
              Metode Bayar
            </label>
            <select
              id="edit-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full touch-target-48 px-3 py-2 rounded-xl border border-[#D8CEBE] text-xs font-semibold bg-[#FFFDF9]"
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="edit-notes" className="block text-xs font-bold text-[#6B635B] mb-1">
            Catatan
          </label>
          <textarea
            id="edit-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-[#D8CEBE] text-xs"
          />
        </div>

        {statusMessage && (
          <p role="status" className="text-xs font-semibold text-[#2E5A44] bg-[#E3EFE8] p-2.5 rounded-xl">
            {statusMessage}
          </p>
        )}
        {errorMessage && (
          <p role="alert" className="text-xs font-semibold text-red-700 bg-[#F9E6DF] p-2.5 rounded-xl">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          data-testid="save-edit-btn"
          className="w-full touch-target-48 rounded-xl bg-[#2E5A44] hover:bg-[#2E5A44] text-white font-bold text-sm flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" aria-hidden="true" />
          <span>Simpan Perubahan</span>
        </button>
      </form>

      {/* Google Drive Receipt Section */}
      <div className="pt-3 border-t border-[#E5DEC9] space-y-2.5">
        <h2 className="text-xs font-bold text-[#1C1917]">
          Foto Struk (Google Drive Pribadi)
        </h2>

        {existingTx.has_pending_receipt_upload || existingTx.receipt_drive_file_id ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleLoadReceiptImage}
                className="touch-target-48 px-3 py-2 rounded-xl bg-[#F3EDE2] hover:bg-slate-200 text-xs font-semibold text-[#1C1917] inline-flex items-center gap-1.5"
              >
                <ImageIcon className="w-4 h-4 text-[#2E5A44]" aria-hidden="true" />
                <span>Lihat Foto Struk</span>
              </button>
              <button
                type="button"
                onClick={() => void connectGoogleDrive()}
                className="touch-target-48 px-3 py-2 rounded-xl bg-[#E3EFE8] hover:bg-[#E3EFE8] text-xs font-semibold text-[#1E402F]"
              >
                Hubungkan / Unggah ke Drive
              </button>
              <button
                type="button"
                onClick={() => setShowReceiptDeleteConfirm(true)}
                className="touch-target-48 px-3 py-2 rounded-xl bg-[#F9E6DF] hover:bg-red-100 text-xs font-semibold text-red-700"
              >
                Hapus Struk
              </button>
            </div>

            {showReceiptDeleteConfirm && (
              <div className="p-3 rounded-xl bg-[#F9E6DF] border border-[#E8BFB0] space-y-2">
                <p className="text-xs font-semibold text-[#9A3B1B]">
                  Hapus foto struk ini dari aplikasi dan dari folder Google Drive kamu?
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmDeleteReceipt}
                    className="touch-target-48 px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-bold"
                  >
                    Ya, Hapus Struk
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReceiptDeleteConfirm(false)}
                    className="touch-target-48 px-3 py-2 rounded-xl bg-[#FFFDF9] border border-[#D8CEBE] text-xs font-semibold"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label
              htmlFor="detail-upload-receipt"
              className="touch-target-48 px-3 py-2.5 rounded-xl bg-[#F3EDE2] hover:bg-slate-200 text-xs font-semibold text-[#1C1917] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Camera className="w-4 h-4 text-[#2E5A44]" aria-hidden="true" />
              <span>Lampirkan Foto Struk Baru</span>
            </label>
            <input
              id="detail-upload-receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleUploadNewReceipt}
              className="sr-only"
            />
          </div>
        )}

        {receiptMessage && (
          <p className="text-xs text-[#6B635B] bg-[#F3EDE2] p-2.5 rounded-xl border border-[#E5DEC9]">
            {receiptMessage}
          </p>
        )}

        {receiptPreviewUrl && (
          <div className="rounded-xl overflow-hidden border border-[#E5DEC9] bg-slate-900 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={receiptPreviewUrl}
              alt="Pratinjau foto struk transaksi"
              className="max-h-72 mx-auto object-contain rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Delete Transaction Section with Confirmation */}
      <div className="pt-3 border-t border-[#E5DEC9]">
        {!showDeleteConfirm ? (
          <button
            type="button"
            data-testid="delete-transaction-btn"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full touch-target-48 rounded-xl bg-[#F9E6DF] hover:bg-red-100 text-red-700 border border-[#E8BFB0] font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Hapus Transaksi Ini</span>
          </button>
        ) : (
          <div className="p-3.5 rounded-xl bg-[#F9E6DF] border border-red-300 space-y-2.5">
            <p className="text-xs font-bold text-[#9A3B1B]">
              Yakin ingin menghapus transaksi &quot;{existingTx.description}&quot; ({formatRupiah(existingTx.amount_idr)})?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="confirm-delete-btn"
                onClick={handleConfirmDeleteTransaction}
                className="touch-target-48 rounded-xl bg-red-600 text-white font-bold text-xs"
              >
                Ya, Hapus
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="touch-target-48 rounded-xl bg-[#FFFDF9] border border-[#D8CEBE] text-[#6B635B] font-semibold text-xs"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
