'use client';

/**
 * DompetHarian — Halaman Laporan & Analitik Bulanan (Milestone 4)
 * Rules:
 * - Integer IDR arithmetic for all totals, averages, and percentages.
 * - Handles empty months, partial current months, division by zero, and timezone boundaries.
 * - Supports offline local CSV export and online server CSV export (with clear Indonesian offline notice).
 * Author / Credit: Aravajordan
 */

import React, { useMemo, useState } from 'react';
import { useApp } from '@/components/layout/AppContext';
import { DashboardAnalyticsService } from '@/features/dashboard/dashboard-service';
import { formatRupiah } from '@/lib/formatters/currency';
import {
  formatIndonesianMonth,
  getCurrentMonthString,
  getPreviousMonthString,
  TIMEZONE_LABELS,
} from '@/lib/formatters/date';

export default function LaporanPage() {
  const { session, transactions, categories, timezone, syncStatus, isOnline } = useApp();
  const defaultMonth = useMemo(() => getCurrentMonthString(timezone), [timezone]);
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isExportingServer, setIsExportingServer] = useState<boolean>(false);

  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>([
      defaultMonth,
      getPreviousMonthString(defaultMonth),
    ]);
    for (const tx of transactions) {
      if (tx.deleted_at === null && tx.transaction_date.length >= 7) {
        monthsSet.add(tx.transaction_date.slice(0, 7));
      }
    }
    return Array.from(monthsSet).sort((a, b) => b.localeCompare(a));
  }, [transactions, defaultMonth]);

  const report = useMemo(() => {
    return DashboardAnalyticsService.computeMonthlyReport({
      transactions,
      categories,
      month: selectedMonth,
      timezone,
    });
  }, [transactions, categories, selectedMonth, timezone]);

  const activeDailyTrend = useMemo(() => {
    return report.dailyTrend.filter((d) => d.expenseIdr > 0 || d.incomeIdr > 0);
  }, [report.dailyTrend]);

  const maxDailyExpense = useMemo(() => {
    return Math.max(1, ...report.dailyTrend.map((d) => d.expenseIdr));
  }, [report.dailyTrend]);

  const handleLocalCsvExport = () => {
    setExportNotice(null);
    const monthTxs = transactions.filter(
      (tx) => tx.deleted_at === null && tx.transaction_date.startsWith(selectedMonth)
    );
    const csvContent = DashboardAnalyticsService.generateTransactionsCsv(monthTxs, categories);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DompetHarian_Lokal_${selectedMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportNotice(
      `Berhasil mengunduh CSV lokal untuk bulan ${formatIndonesianMonth(selectedMonth)} (${monthTxs.length} transaksi).`
    );
  };

  const handleServerCsvExport = async () => {
    setExportNotice(null);
    if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      setExportNotice(
        'Ekspor CSV dari data server membutuhkan koneksi internet. Kamu tetap bisa menggunakan tombol "Unduh CSV dari Data Lokal" di samping saat offline.'
      );
      return;
    }
    if (!session) {
      setExportNotice('Silakan login terlebih dahulu untuk mengunduh CSV dari server.');
      return;
    }

    setIsExportingServer(true);
    try {
      const res = await fetch(`/api/export/csv?month=${encodeURIComponent(selectedMonth)}`, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'x-user-id': session.userId,
        },
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? 'Gagal mengunduh CSV dari server.');
      }
      const csvText = await res.text();
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `DompetHarian_Server_${selectedMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportNotice(
        `Berhasil mengunduh CSV dari server untuk bulan ${formatIndonesianMonth(selectedMonth)}.`
      );
    } catch (err) {
      setExportNotice(
        err instanceof Error ? err.message : 'Terjadi kesalahan saat mengunduh CSV dari server.'
      );
    } finally {
      setIsExportingServer(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight font-serif text-[#1C1917]">Laporan & Analitik</h1>
          <p className="text-xs text-[#6B635B]">
            Zona waktu perhitungan: <span className="font-semibold">{TIMEZONE_LABELS[timezone]}</span>
          </p>
        </div>

        <div>
          <label htmlFor="month-selector" className="sr-only">
            Pilih Bulan Laporan
          </label>
          <select
            id="month-selector"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            data-testid="report-month-select"
            className="min-h-touch w-full rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3.5 py-2 text-sm font-semibold text-[#1C1917] focus:border-[#2E5A44] focus:outline-none"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatIndonesianMonth(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Warning if local data may be incomplete */}
      {syncStatus.isDataPotentiallyIncomplete && (
        <div
          role="status"
          className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 text-xs text-[#7A520B]"
        >
          <p className="font-bold">Perhatian: Data Lokal Mungkin Belum Lengkap</p>
          <p className="mt-0.5">
            Sinkronisasi awal dari server belum selesai atau masih ada transaksi yang belum
            disinkronkan. Angka laporan dihitung dari catatan yang ada di HP ini.
          </p>
        </div>
      )}

      {/* Monthly Overview Cards */}
      <section className="grid grid-cols-2 gap-3" aria-label="Ringkasan Bulanan">
        <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-3.5 shadow-sm">
          <p className="text-xs font-medium text-[#6B635B]">Total Pengeluaran</p>
          <p
            data-testid="report-monthly-expense"
            className="mt-1 text-base font-extrabold font-serif tabular-nums text-[#C85A32]"
          >
            {formatRupiah(report.monthlyExpenseIdr)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B635B]">
            {report.monthlyTransactionCount} transaksi bulan ini
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-3.5 shadow-sm">
          <p className="text-xs font-medium text-[#6B635B]">Rata-rata Harian</p>
          <p
            data-testid="report-daily-average"
            className="mt-1 text-base font-extrabold font-serif tabular-nums text-[#1C1917]"
          >
            {formatRupiah(report.dailyAverageExpenseIdr)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B635B]">
            Dihitung dari {report.elapsedDays} hari berjalan
          </p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-3.5 shadow-sm">
          <p className="text-xs font-medium text-[#6B635B]">Total Pemasukan</p>
          <p className="mt-1 text-base font-extrabold text-[#2E5A44]">
            {formatRupiah(report.monthlyIncomeIdr)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B635B]">Bulan {formatIndonesianMonth(selectedMonth)}</p>
        </div>

        <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-3.5 shadow-sm">
          <p className="text-xs font-medium text-[#6B635B]">Selisih Bersih</p>
          <p
            className={`mt-1 text-base font-extrabold ${
              report.monthlyNetIdr >= 0 ? 'text-[#2E5A44]' : 'text-[#C85A32]'
            }`}
          >
            {formatRupiah(report.monthlyNetIdr)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B635B]">Pemasukan dikurangi pengeluaran</p>
        </div>
      </section>

      {/* Previous Month Comparison */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm">
        <h2 className="text-sm font-bold text-[#1C1917]">
          Perbandingan dengan Bulan Sebelumnya ({formatIndonesianMonth(report.previousMonthComparison.previousMonth)})
        </h2>
        <div className="mt-2 text-xs text-[#6B635B]">
          {report.previousMonthComparison.trendDirection === 'no_previous_data' ? (
            <p>
              Belum ada catatan pengeluaran pada bulan{' '}
              <span className="font-semibold">
                {formatIndonesianMonth(report.previousMonthComparison.previousMonth)}
              </span>{' '}
              untuk dibandingkan.
            </p>
          ) : report.previousMonthComparison.trendDirection === 'same' ? (
            <p>
              Pengeluaran bulan ini sama dengan bulan lalu (
              <span className="font-semibold">
                {formatRupiah(report.previousMonthComparison.previousMonthExpenseIdr)}
              </span>
              ).
            </p>
          ) : (
            <p>
              Pengeluaran bulan ini{' '}
              <span
                className={`font-bold ${
                  report.previousMonthComparison.trendDirection === 'up'
                    ? 'text-[#C85A32]'
                    : 'text-[#2E5A44]'
                }`}
              >
                {report.previousMonthComparison.trendDirection === 'up' ? 'naik' : 'turun'}{' '}
                {Math.abs(report.previousMonthComparison.percentageChange ?? 0)}%
              </span>{' '}
              ({formatRupiah(Math.abs(report.previousMonthComparison.differenceIdr))}) dibanding bulan
              lalu ({formatRupiah(report.previousMonthComparison.previousMonthExpenseIdr)}).
            </p>
          )}
        </div>
      </section>

      {/* Category Breakdown */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm">
        <h2 className="text-sm font-bold text-[#1C1917]">Rincian Pengeluaran per Kategori</h2>
        {report.categoryBreakdown.length === 0 ? (
          <p className="mt-3 text-xs text-[#6B635B]">
            Belum ada pengeluaran yang tercatat pada bulan {formatIndonesianMonth(selectedMonth)}.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {report.categoryBreakdown.map((item) => (
              <li key={item.categoryId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#1C1917]">
                    {item.categoryName}{' '}
                    <span className="font-normal text-[#6B635B]">
                      ({item.transactionCount}x)
                    </span>
                  </span>
                  <span className="font-bold text-[#1C1917]">
                    {formatRupiah(item.totalIdr)} ({item.percentage}%)
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F3EDE2]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(4, Math.min(100, item.percentage))}%`,
                      backgroundColor: item.color || '#047857',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Daily Spending Trend */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm">
        <h2 className="text-sm font-bold text-[#1C1917]">Tren Harian Bulan Ini</h2>
        {activeDailyTrend.length === 0 ? (
          <p className="mt-3 text-xs text-[#6B635B]">
            Belum ada aktivitas harian pada bulan {formatIndonesianMonth(selectedMonth)}.
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {activeDailyTrend.map((day) => {
              const barPct = Math.round((day.expenseIdr / maxDailyExpense) * 100);
              return (
                <div key={day.date} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#6B635B]">
                      Tanggal {day.dayOfMonth} ({day.transactionCount} transaksi)
                    </span>
                    <div className="flex gap-2">
                      {day.expenseIdr > 0 && (
                        <span className="font-semibold text-[#C85A32]">
                          -{formatRupiah(day.expenseIdr)}
                        </span>
                      )}
                      {day.incomeIdr > 0 && (
                        <span className="font-semibold text-[#2E5A44]">
                          +{formatRupiah(day.incomeIdr)}
                        </span>
                      )}
                    </div>
                  </div>
                  {day.expenseIdr > 0 && (
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#F3EDE2]">
                      <div
                        className="h-full rounded-full bg-[#2E5A44]"
                        style={{ width: `${Math.max(4, barPct)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* CSV Export Section */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#1C1917]">Ekspor Data ke CSV (Excel / Spreadsheet)</h2>
          <p className="mt-0.5 text-xs text-[#6B635B]">
            Dilindungi dari serangan CSV Formula Injection. Pilih sumber ekspor di bawah ini:
          </p>
        </div>

        {exportNotice && (
          <div
            role="status"
            data-testid="csv-export-notice"
            className="rounded-xl border border-[#B8D4C5] bg-[#E3EFE8] p-3 text-xs font-medium text-[#1E402F]"
          >
            {exportNotice}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleLocalCsvExport}
            data-testid="btn-export-local-csv"
            className="min-h-touch rounded-xl bg-[#2E5A44] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#234735]"
          >
            Unduh CSV dari Data Lokal (Bisa Offline)
          </button>

          <button
            type="button"
            onClick={() => void handleServerCsvExport()}
            disabled={isExportingServer}
            data-testid="btn-export-server-csv"
            className="min-h-touch rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-4 py-2.5 text-xs font-bold text-[#1C1917] hover:bg-[#F3EDE2] disabled:opacity-50"
          >
            {isExportingServer ? 'Mengunduh dari Server...' : 'Unduh CSV dari Server (Perlu Online)'}
          </button>
        </div>
      </section>
    </div>
  );
}
