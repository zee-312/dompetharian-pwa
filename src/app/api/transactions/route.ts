import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  readBoundedJsonBody,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { syncRateLimiter } from '@/lib/security/logger';
import { generateUuidV4 } from '@/features/transactions/transaction-domain';

export async function GET(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'transactions_get');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const transactions = serverStore.listActiveTransactionsForUser(userId);
    return NextResponse.json({ transactions }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, 'transactions_get_error');
  }
}

export async function POST(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'transactions_post');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const body = await readBoundedJsonBody<Record<string, unknown>>(req);
    const recordId = typeof body.id === 'string' && body.id ? body.id : generateUuidV4();
    const opId = typeof body.op_id === 'string' && body.op_id ? body.op_id : generateUuidV4();

    const [result] = serverStore.processPushBatch(userId, [
      {
        op_id: opId,
        client_id: 'server-api',
        record_type: 'transaction',
        record_id: recordId,
        kind: 'create',
        base_version: 0,
        created_at_ms: Date.now(),
        payload: body,
      },
    ]);

    if (!result || result.status === 'rejected') {
      return NextResponse.json(
        { error: result?.reason ?? 'Data transaksi ditolak.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ transaction: result.server_record, status: result.status }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err, 'transactions_post_error');
  }
}
