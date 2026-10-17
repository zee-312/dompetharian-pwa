import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  readBoundedJsonBody,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { syncRateLimiter } from '@/lib/security/logger';
import { syncPushBatchSchema } from '@/lib/validation/schemas';

export async function POST(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'sync_push');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const body = await readBoundedJsonBody<unknown>(req);
    const parsed = syncPushBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? 'Format batch sinkronisasi tidak valid.',
        },
        { status: 400 }
      );
    }

    const results = serverStore.processPushBatch(userId, parsed.data.operations);
    return NextResponse.json({ results }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, 'sync_push_error');
  }
}
