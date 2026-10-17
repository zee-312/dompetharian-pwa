import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { authRateLimiter } from '@/lib/security/logger';

export async function DELETE(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, authRateLimiter, 'account_delete');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const summary = serverStore.deleteAllUserData(userId, userId);
    return NextResponse.json(
      {
        deleted: true,
        message: 'Seluruh data akun di server berhasil dihapus secara permanen.',
        summary,
      },
      { status: 200 }
    );
  } catch (err) {
    return toErrorResponse(err, 'account_delete_error');
  }
}
