/**
 * DompetHarian — Server Request Authentication, Payload Limit & Rate Limit Guard
 * Author / Credit: Aravajordan
 */

import { NextRequest, NextResponse } from 'next/server';
import { AuthorizationError } from '@/features/transactions/transaction-domain';
import { SafeLogger, SlidingWindowRateLimiter } from '@/lib/security/logger';

export const MAX_JSON_BODY_BYTES = 256 * 1024; // 256 KB strict limit for JSON/sync payloads

export function extractAuthenticatedUserId(req: NextRequest): string {
  const headerUserId = req.headers.get('x-user-id')?.trim();
  const authHeader = req.headers.get('authorization')?.trim();

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.startsWith('dh_session_')) {
      const tokenUserId = token.slice('dh_session_'.length).trim();
      if (headerUserId && headerUserId !== tokenUserId) {
        throw new AuthorizationError('Akses ditolak: Identitas pengguna pada header tidak cocok dengan token sesi.');
      }
      if (tokenUserId) return tokenUserId;
    }
  }

  if (headerUserId && headerUserId.length >= 3 && headerUserId.length <= 128) {
    return headerUserId;
  }

  throw new AuthorizationError('Sesi otentikasi tidak ditemukan atau sudah kedaluwarsa. Silakan login kembali.');
}

export async function readBoundedJsonBody<T>(
  req: NextRequest,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<T> {
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }
  const rawText = await req.text();
  if (new TextEncoder().encode(rawText).byteLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Format JSON permintaan tidak valid.');
  }
}

export class PayloadTooLargeError extends Error {
  public readonly statusCode = 413;
  constructor(message = 'Ukuran permintaan melebihi batas maksimum yang diizinkan (256 KB).') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export function enforceRateLimit(
  req: NextRequest,
  limiter: SlidingWindowRateLimiter,
  scopeKey: string
): NextResponse | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const result = limiter.check(`${scopeKey}:${ip}`);
  if (!result.allowed) {
    SafeLogger.warn('Rate limit exceeded', { scopeKey });
    return NextResponse.json(
      {
        error: 'Terlalu banyak permintaan. Silakan tunggu beberapa saat lalu coba lagi.',
        retry_after_seconds: result.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfterSeconds),
        },
      }
    );
  }
  return null;
}

export function toErrorResponse(err: unknown, contextEvent: string): NextResponse {
  SafeLogger.error(contextEvent, err);
  if (err instanceof AuthorizationError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof PayloadTooLargeError) {
    return NextResponse.json({ error: err.message }, { status: 413 });
  }
  const message =
    err instanceof Error ? err.message : 'Terjadi kesalahan internal pada server.';
  return NextResponse.json({ error: message }, { status: 400 });
}
