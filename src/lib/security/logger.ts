/**
 * DompetHarian — Privacy-Preserving Logger, Error Handler & Sliding-Window Rate Limiter
 * Rule: Never log amounts, descriptions, merchants, notes, receipt content, OCR text, passwords, or tokens.
 * Author / Credit: Aravajordan
 */

const SENSITIVE_FIELD_PATTERNS = [
  /amount/i,
  /nominal/i,
  /description/i,
  /deskripsi/i,
  /merchant/i,
  /toko/i,
  /notes/i,
  /catatan/i,
  /receipt/i,
  /struk/i,
  /ocr/i,
  /token/i,
  /password/i,
  /sandi/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /pin/i,
  /blob/i,
  /payload/i,
];

const BEARER_OR_JWT_REGEX = /(Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*|ya29\.[A-Za-z0-9\-_]+)/gi;
const RUPIAH_INLINE_REGEX = /\bRp\.?\s*[\d.,]+/gi;

export function redactSensitiveString(input: string): string {
  return input
    .replace(BEARER_OR_JWT_REGEX, '[REDACTED_TOKEN]')
    .replace(RUPIAH_INLINE_REGEX, '[REDACTED_AMOUNT]');
}

export function sanitizeLogContext(context: unknown): unknown {
  if (context === null || context === undefined) return context;
  if (typeof context === 'string') {
    return redactSensitiveString(context);
  }
  if (typeof context === 'number' || typeof context === 'boolean') {
    return context;
  }
  if (Array.isArray(context)) {
    return context.map((item) => sanitizeLogContext(item));
  }
  if (typeof context === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(context as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeLogContext(val);
      }
    }
    return out;
  }
  return '[REDACTED]';
}

export const SafeLogger = {
  info(event: string, meta?: Record<string, unknown>): void {
    const safeMeta = meta ? sanitizeLogContext(meta) : undefined;
    console.info(`[DompetHarian:INFO] ${redactSensitiveString(event)}`, safeMeta ?? '');
  },
  warn(event: string, meta?: Record<string, unknown>): void {
    const safeMeta = meta ? sanitizeLogContext(meta) : undefined;
    console.warn(`[DompetHarian:WARN] ${redactSensitiveString(event)}`, safeMeta ?? '');
  },
  error(event: string, err?: unknown, meta?: Record<string, unknown>): void {
    const safeMeta = meta ? sanitizeLogContext(meta) : undefined;
    const errMsg =
      err instanceof Error
        ? redactSensitiveString(err.message)
        : typeof err === 'string'
          ? redactSensitiveString(err)
          : 'UnknownError';
    console.error(`[DompetHarian:ERROR] ${redactSensitiveString(event)} | ${errMsg}`, safeMeta ?? '');
  },
};

/**
 * In-memory sliding window rate limiter for API endpoints (Sync, Auth, Transactions).
 */
export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  public check(key: string, nowMs: number = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const cutoff = nowMs - this.windowMs;
    const existing = (this.windows.get(key) ?? []).filter((ts) => ts > cutoff);

    if (existing.length >= this.maxRequests) {
      const oldest = existing[0] ?? nowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.windows.set(key, existing);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    existing.push(nowMs);
    this.windows.set(key, existing);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - existing.length),
      retryAfterSeconds: 0,
    };
  }

  public reset(): void {
    this.windows.clear();
  }
}

export const syncRateLimiter = new SlidingWindowRateLimiter(60, 60_000);
export const authRateLimiter = new SlidingWindowRateLimiter(15, 60_000);
