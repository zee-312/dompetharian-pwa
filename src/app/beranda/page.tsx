'use client';

/**
 * DompetHarian — Beranda (Home Dashboard — Warm Tactile Editorial Edition)
 * Features:
 * - Stitched Leather Hero Wallet Card (#23392D -> #17231C gradient with dashed inner stitching)
 * - Displays today's expense/income total, current month's summary, top categories, and recent 5 transactions
 * - Shows a clear Indonesian warning if local data may be incomplete (initial sync not finished or pending items)
 * - Fast 1-tap CTA to add a transaction or scan a receipt
 * Author / Credit: Aravajordan
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  Plus,
  Camera,
  ArrowUpRight,
  ArrowDownRight,
  AlertCircle,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useApp } from '@/components/layout/AppContext';
import { DashboardAnalyticsService } from '@/features/dashboard/dashboard-service';
import { formatRupiah } from '@/lib/formatters/currency';
import {
  formatIndonesianDate,
  formatIndonesianMonth,
  getCurrentMonthString,
  getTodayDateString,
  TIMEZONE_LABELS,
} from '@/lib/formatters/date';
import { SyncBadge } from '@/components/ui/SyncBadge';

export function BerandaView() {
  const {
    transactions,
    categories,
    timezone,
    syncStatus,
    navigateTo,
    session,
  } = useApp();

  const currentMonth = useMemo(() => getCurrentMonthString(timezone), [timezone]);
  const todayStr = useMemo(() => getTodayDateString(timezone), [timezone]);

  const report = useMemo(
    () =>
      DashboardAnalyticsService.computeMonthlyReport({
        transactions,
        categories,
        month: currentMonth,
        timezone,
      }),
    [transactions, categories, currentMonth, timezone]
  );

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const recentTransactions = useMemo(
    () =>
      [...transactions]
        .filter((tx) => tx.deleted_at === null)
        .sort((a, b) => {
          const d = b.transaction_date.localeCompare(a.transaction_date);
          if (d !== 0) return d;
          return b.created_at.localeCompare(a.created_at);
        })
        .slice(0, 5),
    [transactions]
  );

  return (
    <div className="space-y-4">
      {/* Incomplete Local Data Notice (Mandatory Offline Accuracy Rule) */}
      {(syncStatus.isDataPotentiallyIncomplete || syncStatus.pendingCount > 0) && (
        <div
          role="status"
          data-testid="incomplete-data-warning"
          className="rounded-2xl bg-[#FDF3DC] border border-[#EDD295] p-3.5 text-xs text-[#7A520B] flex items-start gap-2.5 shadow-sm"
        >
          <AlertCircle className="w-4 h-4 text-[#B47814] shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-bold text-[#5C3D06]">
              Perhatian: Ringkasan Berdasarkan Data Lokal HP
            </p>
            <p className="leading-relaxed">
              {!syncStatus.initialPullCompleted
                ? 'Sinkronisasi riwayat awal dari server belum selesai. Total di bawah hanya menghitung transaksi yang sudah tersimpan di HP ini.'
                : `Ada ${syncStatus.pendingCount} catatan lokal yang menunggu dikirim ke server saat internet kembali stabil.`}
            </p>
          </div>
        </div>
      )}

      {/* Stitched Leather Wallet Hero Card: Today & Monthly Summary */}
      <section
        aria-label="Ringkasan Pengeluaran Hari Ini dan Bulan Ini"
        className="dh-leather-card rounded-3xl p-1.5 text-[#FAF7F2]"
      >
        <div className="dh-leather-stitch rounded-[20px] p-4 space-y-4">
          <div className="flex items-center justify-between text-xs text-[#D5E2DA]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Sparkles className="w-3.5 h-3.5 text-[#D99B26]" aria-hidden="true" />
              <span>Hari ini • {formatIndonesianDate(todayStr)}</span>
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#FAF7F2]/10 border border-[#FAF7F2]/15 text-[11px] font-semibold text-[#E5DEC9]">
              {TIMEZONE_LABELS[timezone]}
            </span>
          </div>

          <div>
            <p className="text-xs text-[#B8D4C5] font-medium">
              Pengeluaran Hari Ini
            </p>
            <p
              data-testid="today-expense-total"
              className="text-3xl font-extrabold tracking-tight mt-0.5 font-display-serif font-mono-tabular text-[#FAF7F2]"
            >
              {formatRupiah(report.todayExpenseIdr)}
            </p>
            {report.todayIncomeIdr > 0 && (
              <p className="text-xs text-[#A3D9B8] mt-1 font-medium font-mono-tabular">
                + Pemasukan hari ini: {formatRupiah(report.todayIncomeIdr)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#FAF7F2]/15">
            <div className="bg-[#121D17]/60 border border-[#FAF7F2]/10 rounded-2xl p-3">
              <div className="flex items-center gap-1 text-[11px] text-[#E5DEC9]">
                <ArrowUpRight className="w-3.5 h-3.5 text-[#F4A28C]" aria-hidden="true" />
                <span>Keluar ({formatIndonesianMonth(currentMonth).split(' ')[0]})</span>
              </div>
              <p
                data-testid="month-expense-total"
                className="text-sm font-bold mt-1 font-mono-tabular text-[#FAF7F2]"
              >
                {formatRupiah(report.monthlyExpenseIdr)}
              </p>
            </div>

            <div className="bg-[#121D17]/60 border border-[#FAF7F2]/10 rounded-2xl p-3">
              <div className="flex items-center gap-1 text-[11px] text-[#E5DEC9]">
                <ArrowDownRight className="w-3.5 h-3.5 text-[#A3D9B8]" aria-hidden="true" />
                <span>Masuk ({formatIndonesianMonth(currentMonth).split(' ')[0]})</span>
              </div>
              <p
                data-testid="month-income-total"
                className="text-sm font-bold mt-1 font-mono-tabular text-[#A3D9B8]"
              >
                {formatRupiah(report.monthlyIncomeIdr)}
              </p>
            </div>
          </div>

          {/* Primary Quick Actions */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => navigateTo('/tambah')}
              data-testid="quick-add-btn"
              className="touch-target-48 rounded-2xl bg-[#C85A32] text-[#FAF7F2] font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:bg-[#B04B25] transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Catat Transaksi</span>
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/scan')}
              className="touch-target-48 rounded-2xl bg-[#FAF7F2]/12 hover:bg-[#FAF7F2]/20 text-[#FAF7F2] font-semibold text-xs flex items-center justify-center gap-1.5 border border-[#FAF7F2]/20 transition-colors"
            >
              <Camera className="w-4 h-4 text-[#D99B26]" aria-hidden="true" />
              <span>Scan Struk OCR</span>
            </button>
          </div>
        </div>
      </section>

      {/* Top Spending Categories This Month */}
      <section className="dh-paper-card rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1C1917] font-display-serif">
            Kategori Terbesar Bulan Ini
          </h2>
          <Link
            href="/laporan"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/laporan');
            }}
            className="text-xs font-semibold text-[#2E5A44] hover:underline flex items-center"
          >
            <span>Lihat Laporan</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        {report.categoryBreakdown.length === 0 ? (
          <p className="text-xs text-[#6B635B] py-2">
            Belum ada pengeluaran tercatat di bulan {formatIndonesianMonth(currentMonth)}.
          </p>
        ) : (
          <div className="space-y-2.5">
            {report.categoryBreakdown.slice(0, 3).map((cat) => (
              <div key={cat.categoryId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#1C1917] flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block"
                      style={{ backgroundColor: cat.color }}
                    />
                    {cat.categoryName}
                  </span>
                  <span className="font-bold text-[#1C1917] font-mono-tabular">
                    {formatRupiah(cat.totalIdr)} ({cat.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-[#F3EDE2] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(4, cat.percentage)}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Transactions List */}
      <section className="dh-paper-card rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1C1917] font-display-serif">
            Catatan Terbaru
          </h2>
          <Link
            href="/riwayat"
            onClick={(e) => {
              e.preventDefault();
              navigateTo('/riwayat');
            }}
            className="text-xs font-semibold text-[#2E5A44] hover:underline flex items-center"
          >
            <span>Semua ({transactions.filter((t) => !t.deleted_at).length})</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm font-semibold text-[#1C1917]">
              Dompetmu masih bersih hari ini
            </p>
            <p className="text-xs text-[#6B635B]">
              Ketuk tombol &quot;Catat Transaksi&quot; di atas untuk mencatat pengeluaran atau pemasukan pertamamu. Semua tersimpan aman di HP meski tanpa sinyal.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E5DEC9]">
            {recentTransactions.map((tx) => {
              const cat = categoryMap.get(tx.category_id);
              const isExpense = tx.kind === 'expense';
              return (
                <li key={tx.id} className="py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={`/transaksi/${tx.id}`}
                    className="flex items-center justify-between gap-3 group rounded-xl p-1 -mx-1 hover:bg-[#F3EDE2]/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#1C1917] truncate group-hover:text-[#2E5A44]">
                        {tx.description}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-[#6B635B]">
                        <span>{cat?.name ?? 'Lainnya'}</span>
                        <span>•</span>
                        <span>{formatIndonesianDate(tx.transaction_date)}</span>
                      </div>
                      <div className="mt-1">
                        <SyncBadge
                          syncState={tx.sync_state}
                          hasPendingReceiptUpload={tx.has_pending_receipt_upload}
                          receiptDriveFileId={tx.receipt_drive_file_id}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`text-sm font-extrabold font-mono-tabular ${
                          isExpense ? 'text-[#C85A32]' : 'text-[#2E5A44]'
                        }`}
                      >
                        {isExpense ? '-' : '+'}
                        {formatRupiah(tx.amount_idr)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Active Account & Privacy Footer Note */}
      <footer className="text-center text-[11px] text-[#6B635B] pt-1 pb-2 space-y-1">
        <p>
          Akun aktif: <strong className="text-[#1C1917]">{session?.email}</strong> • Data tersimpan lokal di IndexedDB HP
        </p>
        <p>
          DompetHarian v1.0 • Dirancang & dikembangkan oleh <strong className="text-[#1C1917]">Aravajordan</strong>
        </p>
      </footer>
    </div>
  );
}

export default function BerandaPage() {
  return <BerandaView />;
}
