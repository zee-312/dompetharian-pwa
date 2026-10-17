import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  readBoundedJsonBody,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { syncRateLimiter } from '@/lib/security/logger';
import { createCategorySchema } from '@/lib/validation/schemas';
import { generateUuidV4 } from '@/features/transactions/transaction-domain';

export async function GET(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'categories_get');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const categories = serverStore.listCategoriesForUser(userId);
    return NextResponse.json({ categories }, { status: 200 });
  } catch (err) {
    return toErrorResponse(err, 'categories_get_error');
  }
}

export async function POST(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'categories_post');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const body = await readBoundedJsonBody<unknown>(req);
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Data kategori tidak valid.' },
        { status: 400 }
      );
    }

    const recordId = parsed.data.id ?? generateUuidV4();
    const [result] = serverStore.processPushBatch(userId, [
      {
        op_id: generateUuidV4(),
        client_id: 'server-api',
        record_type: 'category',
        record_id: recordId,
        kind: 'create',
        base_version: 0,
        created_at_ms: Date.now(),
        payload: parsed.data,
      },
    ]);

    return NextResponse.json({ category: result?.server_record }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err, 'categories_post_error');
  }
}
