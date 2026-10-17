'use client';

/**
 * DompetHarian — Catat Transaksi Cepat (Warm Tactile Editorial Edition — PRD Section 5.3)
 * Rules followed:
 * - Fast 3-tap workflow: Amount -> Category chip -> Simpan
 * - Warm Tactile Paper & Soft Sand surfaces, Terracotta expense & Forest Sage income accents
 * - Integer IDR only, live thousand-separator formatting
 * - Validation hints placed ABOVE inputs so Android virtual keyboards never cover them
 * - Works 100% offline; writes immediately to IndexedDB and queues sync operation
 * Author / Credit: Aravajordan
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Camera, Paperclip, Trash2 } from 'lucide-react';
import { useApp } from '@/components/layout/AppContext';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { receiptService } from '@/features/receipts/receipt-service';
import { formatRupiah, formatRupiahLiveInput } from '@/lib/formatters/currency';
import { getTodayDateString } from '@/lib/formatters/date';
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type TransactionKind,
} from '@/lib/database/types';

const QUICK_NOMINAL_CHIPS = [10_000, 15_000, 25_000, 50_000, 100_000];

export default function TambahTransaksiPage() {
  const {
    session,
    categories,
    timezone,
    refreshLocalData,
    triggerSyncNow,
    navigateTo,
    isOnline,
  } = useApp();

  const [kind, setKind] = useState<TransactionKind>('expense');
  const [amountDisplay, setAmountDisplay] = useState<string>('');
  const [amountIdr, setAmountIdr] = useState<number>(0);
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [merchant, setMerchant] = useState<string>('');
  const [transactionDate, setTransactionDate] = useState<string>(() =>
    getTodayDateString(timezone)
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('tunai');
  const [notes, setNotes] = useState<string>('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.kind === kind && !c.is_archived),
    [categories, kind]
  );

  // Auto-select first category of the chosen kind for 3-tap speed
  useEffect(() => {
    if (visibleCategories.length > 0) {
      const exists = visibleCategories.some((c) => c.id === categoryId);
      if (!exists) {
        setCategoryId(visibleCategories[0]!.id);
      }
    }
  }, [visibleCategories, categoryId]);

  const handleAmountChange = (raw: string) => {
    const formatted = formatRupiahLiveInput(raw);
    setAmountDisplay(formatted.display);
    setAmountIdr(formatted.value);
    if (formatted.value > 0) {
      setErrorMessage(null);
    }
  };

  const handleQuickChip = (nominal: number) => {
    const nextVal = amountIdr + nominal;
    const formatted = formatRupiahLiveInput(String(nextVal));
    setAmountDisplay(formatted.display);
    setAmountIdr(formatted.value);
    setErrorMessage(null);
  };

  const handleReceiptSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    setReceiptFile(file);
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
      setErrorMessage('Masukkan nominal Rupiah bilangan bulat lebih dari Rp 0.');
      return;
    }

    const selectedCategory = visibleCategories.find((c) => c.id === categoryId);
    const finalDescription =
      description.trim() ||
      (selectedCategory ? `${selectedCategory.name}` : 'Transaksi Harian');

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const created = await localRepository.createTransaction(session.userId, {
        kind,
        amount_idr: amountIdr,
        transaction_date: transactionDate,
        description: finalDescription,
        merchant: merchant.trim() || null,
        category_id: categoryId || (visibleCategories[0]?.id ?? 'cat-lainnya'),
        payment_method: paymentMethod,
        notes: notes.trim() || null,
        input_source: 'manual',
        verification_status: 'verified',
      });

      if (receiptFile) {
        const buffer = await receiptFile.arrayBuffer();
        await receiptService.attachReceiptToTransaction({
          userId: session.userId,
          transactionId: created.id,
          rawBytes: new Uint8Array(buffer),
          mimeType: receiptFile.type || 'image/jpeg',
          originalName: receiptFile.name,
        });
      }

      await refreshLocalData();
      if (isOnline) {
        void triggerSyncNow();
      }
      navigateTo('/riwayat');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan catatan transaksi. Silakan periksa kembali isianmu.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="dh-paper-card rounded-3xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-[#1C1917] font-display-serif">
            Catat Transaksi Harian
          </h1>
          <p className="text-xs text-[#6B635B]">
            Langsung tersimpan di HP ini meski sedang tanpa internet
          </p>
        </div>
      </div>

      {/* Expense vs Income Segmented Control */}
      <div
        role="group"
        aria-label="Jenis Transaksi"
        className="grid grid-cols-2 gap-1.5 bg-[#F3EDE2] p-1 rounded-2xl border border-[#E5DEC9]"
      >
        <button
          type="button"
          onClick={() => setKind('expense')}
          data-testid="kind-expense-btn"
          className={`touch-target-48 rounded-xl text-xs font-bold transition-colors ${
            kind === 'expense'
              ? 'bg-[#C85A32] text-[#FAF7F2] shadow-sm'
              : 'text-[#6B635B] hover:text-[#1C1917]'
          }`}
        >
          Pengeluaran
        </button>
        <button
          type="button"
          onClick={() => setKind('income')}
          data-testid="kind-income-btn"
          className={`touch-target-48 rounded-xl text-xs font-bold transition-colors ${
            kind === 'income'
              ? 'bg-[#2E5A44] text-[#FAF7F2] shadow-sm'
              : 'text-[#6B635B] hover:text-[#1C1917]'
          }`}
        >
          Pemasukan
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* 1. Nominal Rupiah Field (Hint above input for mobile keyboard visibility) */}
        <div className="dh-field">
          <label
            htmlFor="amount-idr-input"
            className="block text-xs font-bold text-[#1C1917]"
          >
            Nominal Rupiah (Wajib)
          </label>
          <span
            id="amount-hint"
            className="block text-[11px] text-[#6B635B] mb-1.5"
          >
            Ketik angka saja tanpa titik atau desimal (contoh: 25000 menjadi Rp 25.000)
          </span>
          <div className="relative flex items-center">
            <span className="absolute left-3.5 text-base font-extrabold text-[#6B635B] select-none font-display-serif">
              Rp
            </span>
            <input
              id="amount-idr-input"
              name="amount_idr"
              data-testid="amount-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9.]+"
              required
              autoFocus
              aria-describedby="amount-hint"
              value={amountDisplay}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
              className="dh-input w-full touch-target-48 pl-11 pr-4 py-3 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-2xl font-extrabold text-[#1C1917] font-display-serif font-mono-tabular focus:outline-none focus:ring-2 focus:ring-[#2E5A44]"
            />
          </div>
          <span className="dh-error-text" role="alert">
            Nominal wajib diisi dengan angka Rupiah bulat positif.
          </span>

          {/* Quick Add Nominal Chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {QUICK_NOMINAL_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleQuickChip(chip)}
                className="px-2.5 py-1.5 rounded-xl bg-[#F3EDE2] hover:bg-[#E5DEC9] text-[#1C1917] border border-[#D8CEBE] text-xs font-bold font-mono-tabular transition-colors"
              >
                +{formatRupiah(chip)}
              </button>
            ))}
            {amountIdr > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAmountDisplay('');
                  setAmountIdr(0);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-[#F9E6DF] text-[#9A3B1B] border border-[#E8BFB0] text-xs font-semibold"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* 2. Category Selection Pills (Tap 2 in 3-tap flow) */}
        <div>
          <label className="block text-xs font-bold text-[#1C1917] mb-1.5">
            Pilih Kategori
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {visibleCategories.map((cat) => {
              const selected = cat.id === categoryId;
              return (
                <button
                  key={cat.id}
                  type="button"
                  data-testid={`category-pill-${cat.name}`}
                  onClick={() => setCategoryId(cat.id)}
                  className={`touch-target-48 px-3 py-2 rounded-2xl border text-left text-xs font-semibold flex items-center justify-between gap-1.5 transition-all ${
                    selected
                      ? 'border-[#2E5A44] bg-[#E3EFE8] text-[#1E402F] ring-1 ring-[#2E5A44]'
                      : 'border-[#E5DEC9] bg-[#FAF7F2] text-[#1C1917] hover:bg-[#F3EDE2]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="truncate">{cat.name}</span>
                  </span>
                  {selected && (
                    <Check className="w-3.5 h-3.5 text-[#2E5A44] shrink-0" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Description Field */}
        <div className="dh-field">
          <label
            htmlFor="tx-description-input"
            className="block text-xs font-bold text-[#1C1917]"
          >
            Deskripsi Singkat
          </label>
          <span className="block text-[11px] text-[#6B635B] mb-1">
            Contoh: Nasi Padang Siang, Bensin Pertamax, atau Kopi Susu (jika dikosongkan otomatis memakai nama kategori)
          </span>
          <input
            id="tx-description-input"
            name="description"
            data-testid="description-input"
            type="text"
            maxLength={250}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contoh: Makan siang warteg"
            className="w-full touch-target-48 px-3.5 py-2.5 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-sm text-[#1C1917] focus:outline-none focus:ring-2 focus:ring-[#2E5A44]"
          />
        </div>

        {/* 4. Date & Payment Method Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="tx-date-input"
              className="block text-xs font-bold text-[#1C1917] mb-1"
            >
              Tanggal Transaksi
            </label>
            <input
              id="tx-date-input"
              name="transaction_date"
              data-testid="date-input"
              type="date"
              required
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full touch-target-48 px-3 py-2 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-xs font-semibold text-[#1C1917]"
            />
          </div>

          <div>
            <label
              htmlFor="tx-payment-method"
              className="block text-xs font-bold text-[#1C1917] mb-1"
            >
              Metode Pembayaran
            </label>
            <select
              id="tx-payment-method"
              name="payment_method"
              data-testid="payment-method-select"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full touch-target-48 px-3 py-2 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-xs font-semibold text-[#1C1917]"
            >
              {Object.entries(PAYMENT_METHOD_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 5. Optional Merchant & Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="tx-merchant-input"
              className="block text-xs font-bold text-[#1C1917] mb-1"
            >
              Nama Toko / Merchant (Opsional)
            </label>
            <input
              id="tx-merchant-input"
              name="merchant"
              data-testid="merchant-input"
              type="text"
              maxLength={120}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Contoh: Indomaret / Warteg Bahari"
              className="w-full touch-target-48 px-3.5 py-2 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-xs text-[#1C1917]"
            />
          </div>

          <div>
            <label
              htmlFor="tx-notes-input"
              className="block text-xs font-bold text-[#1C1917] mb-1"
            >
              Catatan Tambahan (Opsional)
            </label>
            <input
              id="tx-notes-input"
              name="notes"
              type="text"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan opsional"
              className="w-full touch-target-48 px-3.5 py-2 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-xs text-[#1C1917]"
            />
          </div>
        </div>

        {/* 6. Optional Receipt Photo Attachment (Google Drive Pribadi) */}
        <div className="rounded-2xl bg-[#F3EDE2] border border-[#E5DEC9] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-[#1C1917]">
                Lampirkan Foto Struk (Opsional)
              </p>
              <p className="text-[11px] text-[#6B635B]">
                Lokasi GPS (EXIF) dihapus otomatis & disimpan di Google Drive pribadimu.
              </p>
            </div>
            <label
              htmlFor="receipt-upload-input"
              className="touch-target-48 px-3 py-2 rounded-xl bg-[#FFFDF9] border border-[#D8CEBE] text-xs font-semibold text-[#1C1917] flex items-center gap-1.5 cursor-pointer hover:bg-[#FAF7F2]"
            >
              <Camera className="w-4 h-4 text-[#2E5A44]" aria-hidden="true" />
              <span>Pilih Foto</span>
              <input
                id="receipt-upload-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={handleReceiptSelect}
                className="sr-only"
              />
            </label>
          </div>

          {receiptFile && (
            <div className="flex items-center justify-between bg-[#FFFDF9] px-3 py-2 rounded-xl border border-[#B8D4C5] text-xs">
              <span className="flex items-center gap-1.5 text-[#1E402F] font-medium truncate">
                <Paperclip className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{receiptFile.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setReceiptFile(null)}
                className="text-[#C85A32] hover:text-[#9A3B1B] p-1"
                aria-label="Hapus lampiran foto struk"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {errorMessage && (
          <div
            role="alert"
            data-testid="form-error-alert"
            className="rounded-2xl bg-[#F9E6DF] border border-[#E8BFB0] p-3 text-xs font-semibold text-[#9A3B1B]"
          >
            {errorMessage}
          </div>
        )}

        {/* Submit Button (Tap 3 in 3-tap workflow) */}
        <button
          type="submit"
          data-testid="save-transaction-btn"
          disabled={isSubmitting}
          className={`w-full touch-target-48 py-3.5 rounded-2xl text-[#FAF7F2] font-bold text-sm shadow-sm transition-colors ${
            kind === 'expense'
              ? 'bg-[#C85A32] hover:bg-[#B04B25] disabled:bg-[#D8CEBE]'
              : 'bg-[#2E5A44] hover:bg-[#234735] disabled:bg-[#D8CEBE]'
          }`}
        >
          {isSubmitting
            ? 'Menyimpan ke HP...'
            : `Simpan ${kind === 'expense' ? 'Pengeluaran' : 'Pemasukan'} ${
                amountIdr > 0 ? formatRupiah(amountIdr) : ''
              }`}
        </button>
      </form>
    </div>
  );
}
