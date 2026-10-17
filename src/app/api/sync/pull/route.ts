import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { syncRateLimiter } from '@/lib/security/logger';

export async function GET(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'sync_pull');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const { searchParams } = new URL(req.url);
    const afterSeqRaw = Number(searchParams.get('after_seq') ?? '0');
    const limitRaw = Number(searchParams.get('limit') ?? '100');

    const afterSeq = Number.isFinite(afterSeqRaw) && afterSeqRaw >= 0 ? Math.floor(afterSeqRaw) : 0;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 100;

    const payload = serverStore.pullChanges(userId, afterSeq, limit);
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, 'sync_pull_error');
  }
}
