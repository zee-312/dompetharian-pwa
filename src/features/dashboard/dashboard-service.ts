/**
 * DompetHarian — Dashboard, Aggregations, Reports & CSV Export Service (Milestone 4)
 * Rules:
 * - Integer arithmetic for all monetary amounts (no floating-point rounding bugs).
 * - Handles empty months, partial current months, division by zero, and timezone boundaries (WIB/WITA/WIT).
 * - Never shows placeholder or hardcoded metrics.
 * Author / Credit: Aravajordan
 */

import type {
  CategoryRecord,
  IndonesianTimezone,
  LocalCategoryRecord,
  LocalTransactionRecord,
  TransactionRecord,
} from '@/lib/database/types';
import {
  divideIntegerIdrRounded,
  formatRupiah,
  sumIntegerIdr,
} from '@/lib/formatters/currency';
import {
  getDaysInMonth,
  getElapsedDaysInMonth,
  getPreviousMonthString,
  getTodayDateString,
} from '@/lib/formatters/date';
import { PAYMENT_METHOD_LABELS } from '@/lib/database/types';

export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  color: string;
  totalIdr: number;
  transactionCount: number;
  /** Integer percentage 0..100 */
  percentage: number;
}

export interface DailySpendTrendItem {
  date: string; // YYYY-MM-DD
  dayOfMonth: number;
  expenseIdr: number;
  incomeIdr: number;
  transactionCount: number;
}

export interface PreviousMonthComparison {
  previousMonth: string; // YYYY-MM
  previousMonthExpenseIdr: number;
  currentMonthExpenseIdr: number;
  differenceIdr: number; // current - previous
  /** Null when previousMonthExpenseIdr === 0 to prevent division by zero */
  percentageChange: number | null;
  trendDirection: 'up' | 'down' | 'same' | 'no_previous_data';
}

export interface MonthlyDashboardReport {
  month: string; // YYYY-MM
  todayDate: string; // YYYY-MM-DD in selected timezone
  timezone: IndonesianTimezone;
  todayExpenseIdr: number;
  todayIncomeIdr: number;
  todayTransactionCount: number;
  monthlyExpenseIdr: number;
  monthlyIncomeIdr: number;
  monthlyNetIdr: number;
  monthlyTransactionCount: number;
  elapsedDays: number;
  dailyAverageExpenseIdr: number;
  categoryBreakdown: CategoryBreakdownItem[];
  dailyTrend: DailySpendTrendItem[];
  previousMonthComparison: PreviousMonthComparison;
}

export const DashboardAnalyticsService = {
  computeMonthlyReport(params: {
    transactions: readonly (TransactionRecord | LocalTransactionRecord)[];
    categories: readonly (CategoryRecord | LocalCategoryRecord)[];
    month: string; // YYYY-MM
    timezone?: IndonesianTimezone;
    now?: Date;
  }): MonthlyDashboardReport {
    const timezone = params.timezone ?? 'Asia/Jakarta';
    const now = params.now ?? new Date();
    const todayDate = getTodayDateString(timezone, now);
    const prevMonth = getPreviousMonthString(params.month);

    const activeTxs = params.transactions.filter((tx) => tx.deleted_at === null);

    // 1. Today's summary (in user's selected timezone)
    const todayTxs = activeTxs.filter((tx) => tx.transaction_date === todayDate);
    const todayExpenseIdr = sumIntegerIdr(
      todayTxs.filter((tx) => tx.kind === 'expense').map((tx) => tx.amount_idr)
    );
    const todayIncomeIdr = sumIntegerIdr(
      todayTxs.filter((tx) => tx.kind === 'income').map((tx) => tx.amount_idr)
    );

    // 2. Selected month's summary
    const monthTxs = activeTxs.filter((tx) => tx.transaction_date.startsWith(params.month));
    const monthlyExpenseIdr = sumIntegerIdr(
      monthTxs.filter((tx) => tx.kind === 'expense').map((tx) => tx.amount_idr)
    );
    const monthlyIncomeIdr = sumIntegerIdr(
      monthTxs.filter((tx) => tx.kind === 'income').map((tx) => tx.amount_idr)
    );
    const monthlyNetIdr = monthlyIncomeIdr - monthlyExpenseIdr;

    // 3. Daily average over elapsed days (handles partial current month & division-by-zero)
    const elapsedDays = getElapsedDaysInMonth(params.month, timezone, now);
    const dailyAverageExpenseIdr = divideIntegerIdrRounded(monthlyExpenseIdr, elapsedDays);

    // 4. Category breakdown for expenses in the selected month
    const catMap = new Map<string, { name: string; color: string }>();
    for (const c of params.categories) {
      catMap.set(c.id, { name: c.name, color: c.color });
    }

    const spendByCat = new Map<string, { totalIdr: number; count: number }>();
    for (const tx of monthTxs) {
      if (tx.kind !== 'expense') continue;
      const cur = spendByCat.get(tx.category_id) ?? { totalIdr: 0, count: 0 };
      spendByCat.set(tx.category_id, {
        totalIdr: cur.totalIdr + tx.amount_idr,
        count: cur.count + 1,
      });
    }

    const categoryBreakdown: CategoryBreakdownItem[] = Array.from(spendByCat.entries())
      .map(([categoryId, stat]) => {
        const meta = catMap.get(categoryId) ?? { name: 'Lainnya', color: '#64748b' };
        const percentage =
          monthlyExpenseIdr > 0
            ? divideIntegerIdrRounded(stat.totalIdr * 100, monthlyExpenseIdr)
            : 0;
        return {
          categoryId,
          categoryName: meta.name,
          color: meta.color,
          totalIdr: stat.totalIdr,
          transactionCount: stat.count,
          percentage,
        };
      })
      .sort((a, b) => b.totalIdr - a.totalIdr);

    // 5. Daily spending trend across the month
    const [yearStr, monStr] = params.month.split('-');
    const year = Number(yearStr);
    const monthNum = Number(monStr);
    const totalDaysInMonth =
      year && monthNum ? getDaysInMonth(year, monthNum) : 30;

    const dailyMap = new Map<
      string,
      { expenseIdr: number; incomeIdr: number; count: number }
    >();
    for (const tx of monthTxs) {
      const cur = dailyMap.get(tx.transaction_date) ?? {
        expenseIdr: 0,
        incomeIdr: 0,
        count: 0,
      };
      if (tx.kind === 'expense') cur.expenseIdr += tx.amount_idr;
      else cur.incomeIdr += tx.amount_idr;
      cur.count += 1;
      dailyMap.set(tx.transaction_date, cur);
    }

    const dailyTrend: DailySpendTrendItem[] = [];
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dateStr = `${params.month}-${String(day).padStart(2, '0')}`;
      const stat = dailyMap.get(dateStr) ?? { expenseIdr: 0, incomeIdr: 0, count: 0 };
      dailyTrend.push({
        date: dateStr,
        dayOfMonth: day,
        expenseIdr: stat.expenseIdr,
        incomeIdr: stat.incomeIdr,
        transactionCount: stat.count,
      });
    }

    // 6. Previous month comparison with division-by-zero protection
    const prevMonthTxs = activeTxs.filter(
      (tx) => tx.kind === 'expense' && tx.transaction_date.startsWith(prevMonth)
    );
    const previousMonthExpenseIdr = sumIntegerIdr(prevMonthTxs.map((tx) => tx.amount_idr));
    const differenceIdr = monthlyExpenseIdr - previousMonthExpenseIdr;

    let percentageChange: number | null = null;
    let trendDirection: PreviousMonthComparison['trendDirection'] = 'no_previous_data';

    if (previousMonthExpenseIdr > 0) {
      percentageChange = divideIntegerIdrRounded(
        differenceIdr * 100,
        previousMonthExpenseIdr
      );
      if (differenceIdr > 0) trendDirection = 'up';
      else if (differenceIdr < 0) trendDirection = 'down';
      else trendDirection = 'same';
    } else if (monthlyExpenseIdr === 0) {
      trendDirection = 'same';
      percentageChange = 0;
    }

    return {
      month: params.month,
      todayDate,
      timezone,
      todayExpenseIdr,
      todayIncomeIdr,
      todayTransactionCount: todayTxs.length,
      monthlyExpenseIdr,
      monthlyIncomeIdr,
      monthlyNetIdr,
      monthlyTransactionCount: monthTxs.length,
      elapsedDays,
      dailyAverageExpenseIdr,
      categoryBreakdown,
      dailyTrend,
      previousMonthComparison: {
        previousMonth: prevMonth,
        previousMonthExpenseIdr,
        currentMonthExpenseIdr: monthlyExpenseIdr,
        differenceIdr,
        percentageChange,
        trendDirection,
      },
    };
  },

  /**
   * Generates a safe, formula-injection-protected CSV string of the user's transactions.
   */
  generateTransactionsCsv(
    transactions: readonly (TransactionRecord | LocalTransactionRecord)[],
    categories: readonly (CategoryRecord | LocalCategoryRecord)[]
  ): string {
    const catNameById = new Map<string, string>();
    for (const c of categories) {
      catNameById.set(c.id, c.name);
    }

    const escapeCsvCell = (raw: string | number | null | undefined): string => {
      if (raw === null || raw === undefined) return '""';
      let str = String(raw);
      // Prevent CSV spreadsheet formula injection (=, +, -, @)
      if (/^[=+\-@]/.test(str)) {
        str = `'${str}`;
      }
      return `"${str.replace(/"/g, '""')}"`;
    };

    const headers = [
      'ID Transaksi',
      'Tanggal',
      'Jenis',
      'Nominal (IDR)',
      'Nominal Terformat',
      'Kategori',
      'Deskripsi',
      'Toko/Merchant',
      'Metode Pembayaran',
      'Catatan',
      'Sumber Input',
      'Status Verifikasi',
      'ID Struk Google Drive',
    ];

    const rows = transactions
      .filter((tx) => tx.deleted_at === null)
      .map((tx) => [
        escapeCsvCell(tx.id),
        escapeCsvCell(tx.transaction_date),
        escapeCsvCell(tx.kind === 'expense' ? 'Pengeluaran' : 'Pemasukan'),
        String(tx.amount_idr),
        escapeCsvCell(formatRupiah(tx.amount_idr)),
        escapeCsvCell(catNameById.get(tx.category_id) ?? tx.category_id),
        escapeCsvCell(tx.description),
        escapeCsvCell(tx.merchant ?? ''),
        escapeCsvCell(PAYMENT_METHOD_LABELS[tx.payment_method] ?? tx.payment_method),
        escapeCsvCell(tx.notes ?? ''),
        escapeCsvCell(tx.input_source),
        escapeCsvCell(tx.verification_status),
        escapeCsvCell(tx.receipt_drive_file_id ?? ''),
      ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  },
};
