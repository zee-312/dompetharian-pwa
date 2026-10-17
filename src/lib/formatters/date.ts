/**
 * DompetHarian — Plain Local Date & Indonesian Timezone Utilities
 * Default timezone: Asia/Jakarta (WIB). User-selectable: WIB, WITA, WIT.
 * Author / Credit: Aravajordan
 */

import type { IndonesianTimezone } from '@/lib/database/types';

export const TIMEZONE_LABELS: Record<IndonesianTimezone, string> = {
  'Asia/Jakarta': 'WIB (Waktu Indonesia Barat - UTC+7)',
  'Asia/Makassar': 'WITA (Waktu Indonesia Tengah - UTC+8)',
  'Asia/Jayapura': 'WIT (Waktu Indonesia Timur - UTC+9)',
};

const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Validates that a string is a valid calendar date in YYYY-MM-DD format.
 */
export function isValidLocalDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parts = dateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return false;
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const daysInMonth = getDaysInMonth(year, month);
  return day >= 1 && day <= daysInMonth;
}

/**
 * Returns the number of days in a 1-indexed month (1 = Jan ... 12 = Dec).
 */
export function getDaysInMonth(year: number, month1Indexed: number): number {
  return new Date(Date.UTC(year, month1Indexed, 0)).getUTCDate();
}

/**
 * Returns today's plain local date (YYYY-MM-DD) in the specified Indonesian timezone.
 */
export function getTodayDateString(
  timezone: IndonesianTimezone = 'Asia/Jakarta',
  now: Date = new Date()
): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // en-CA produces YYYY-MM-DD
}

/**
 * Returns current month string YYYY-MM in the specified Indonesian timezone.
 */
export function getCurrentMonthString(
  timezone: IndonesianTimezone = 'Asia/Jakarta',
  now: Date = new Date()
): string {
  return getTodayDateString(timezone, now).slice(0, 7);
}

/**
 * Returns the previous month string YYYY-MM for a given YYYY-MM.
 */
export function getPreviousMonthString(monthStr: string): string {
  const [yearStr, monStr] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monStr);
  if (!year || !month) return monthStr;
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * Formats a YYYY-MM-DD string into Indonesian readable format, e.g. "17 Oktober 2026".
 */
export function formatIndonesianDate(dateStr: string): string {
  if (!isValidLocalDateString(dateStr)) return dateStr;
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const monthIdx = Number(monthStr) - 1;
  const monthName = INDONESIAN_MONTHS[monthIdx] ?? monthStr;
  return `${Number(dayStr)} ${monthName} ${yearStr}`;
}

/**
 * Formats a YYYY-MM string into Indonesian month title, e.g. "Oktober 2026".
 */
export function formatIndonesianMonth(monthStr: string): string {
  const [yearStr, monStr] = monthStr.split('-');
  const monthIdx = Number(monStr) - 1;
  const monthName = INDONESIAN_MONTHS[monthIdx] ?? monStr;
  return `${monthName} ${yearStr}`;
}

/**
 * Computes the divisor (elapsed days) for daily average in a given month:
 * - For past months: total calendar days in that month (28..31).
 * - For the current active month (partial month): number of elapsed days up to today in the user's timezone (1..todayDay).
 * - For future months: 0 (so division by zero protection returns 0).
 */
export function getElapsedDaysInMonth(
  monthStr: string,
  timezone: IndonesianTimezone = 'Asia/Jakarta',
  now: Date = new Date()
): number {
  const [yearStr, monStr] = monthStr.split('-');
  const year = Number(yearStr);
  const month = Number(monStr);
  if (!year || !month || month < 1 || month > 12) return 0;

  const todayStr = getTodayDateString(timezone, now);
  const currentMonthStr = todayStr.slice(0, 7);

  if (monthStr < currentMonthStr) {
    return getDaysInMonth(year, month);
  }
  if (monthStr === currentMonthStr) {
    const todayDay = Number(todayStr.slice(8, 10));
    return Math.max(1, todayDay);
  }
  return 0;
}
