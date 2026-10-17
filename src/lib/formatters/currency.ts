/**
 * DompetHarian — Integer Rupiah (IDR) Arithmetic & Formatting Utilities
 * Never uses floating-point arithmetic for monetary values.
 * Author / Credit: Aravajordan
 */

export const MAX_IDR_AMOUNT = 1_000_000_000_000; // Rp 1 Triliun batas aman

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'decimal',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/**
 * Validates that a value is a safe, positive integer Rupiah amount.
 */
export function isValidPositiveIntegerIdr(amount: unknown): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    Number.isInteger(amount) &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= MAX_IDR_AMOUNT
  );
}

/**
 * Throws a descriptive Indonesian error if the amount is not a positive integer IDR.
 */
export function assertPositiveIntegerIdr(amount: unknown): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('Nominal harus berupa angka yang valid.');
  }
  if (!Number.isInteger(amount)) {
    throw new Error('Nominal Rupiah harus berupa bilangan bulat (tanpa desimal/sen).');
  }
  if (amount <= 0) {
    throw new Error('Nominal Rupiah harus lebih besar dari Rp 0.');
  }
  if (amount > MAX_IDR_AMOUNT) {
    throw new Error('Nominal melebihi batas maksimum yang diizinkan.');
  }
  return amount;
}

/**
 * Formats an integer amount into Indonesian Rupiah string, e.g. "Rp 25.000".
 * Supports zero or negative values for net balance summaries (e.g. "-Rp 15.000").
 */
export function formatRupiah(amountIdr: number, includePrefix = true): string {
  if (!Number.isFinite(amountIdr) || !Number.isInteger(amountIdr)) {
    throw new Error('Nominal untuk pemformatan Rupiah harus berupa bilangan bulat.');
  }
  const isNegative = amountIdr < 0;
  const absAmount = Math.abs(amountIdr);
  const formattedDigits = idrFormatter.format(absAmount);
  if (!includePrefix) {
    return isNegative ? `-${formattedDigits}` : formattedDigits;
  }
  return isNegative ? `-Rp ${formattedDigits}` : `Rp ${formattedDigits}`;
}

/**
 * Parses a user-typed Rupiah string (e.g. "Rp 25.000", "25.000", "25000")
 * into a strict integer number. Rejects decimal fractions (e.g. "25000,50").
 */
export function parseRupiahInput(raw: string): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject explicit comma decimals like ",50"
  if (/,\d+$/.test(trimmed) && !/,\d{3}$/.test(trimmed)) {
    return null;
  }

  // Strip "Rp", spaces, and thousand-separator dots
  const digitsOnly = trimmed.replace(/^[Rr][Pp]\s*/, '').replace(/\./g, '').replace(/\s+/g, '');
  if (!/^\d+$/.test(digitsOnly)) {
    return null;
  }

  const parsed = Number(digitsOnly);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_IDR_AMOUNT) {
    return null;
  }
  return parsed;
}

/**
 * Formats a numeric input string live as the user types on an Android numeric keypad
 * without corrupting the underlying integer value.
 * Returns { display: "25.000", value: 25000 } or { display: "", value: 0 }.
 */
export function formatRupiahLiveInput(rawInput: string): { display: string; value: number } {
  const digits = rawInput.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) {
    return { display: '', value: 0 };
  }
  const cappedDigits = digits.slice(0, 12); // max 999.999.999.999
  const intValue = Number(cappedDigits);
  if (!Number.isSafeInteger(intValue) || intValue <= 0) {
    return { display: '', value: 0 };
  }
  return {
    display: idrFormatter.format(intValue),
    value: intValue,
  };
}

/**
 * Integer-only addition across an array of IDR amounts.
 */
export function sumIntegerIdr(amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isInteger(amount)) {
      throw new Error('Operasi penjumlahan IDR menolak angka desimal floating-point.');
    }
    total += amount;
  }
  return total;
}

/**
 * Integer division for daily average (rounds to nearest integer Rupiah using integer math,
 * never returning a float, and returns 0 when divisor <= 0).
 */
export function divideIntegerIdrRounded(totalIdr: number, divisor: number): number {
  if (!Number.isInteger(totalIdr)) {
    throw new Error('Total IDR harus berupa bilangan bulat.');
  }
  if (!Number.isInteger(divisor) || divisor <= 0) {
    return 0;
  }
  if (totalIdr === 0) return 0;
  const quotient = Math.trunc(totalIdr / divisor);
  const remainder = Math.abs(totalIdr % divisor);
  if (remainder * 2 >= divisor) {
    return totalIdr > 0 ? quotient + 1 : quotient - 1;
  }
  return quotient;
}
