import { NextRequest, NextResponse } from 'next/server';
import { serverStore } from '@/lib/database/server-store';
import {
  enforceRateLimit,
  extractAuthenticatedUserId,
  toErrorResponse,
} from '@/lib/database/server-auth';
import { syncRateLimiter } from '@/lib/security/logger';
import { DashboardAnalyticsService } from '@/features/dashboard/dashboard-service';

export async function GET(req: NextRequest) {
  const rateLimitRes = enforceRateLimit(req, syncRateLimiter, 'export_csv');
  if (rateLimitRes) return rateLimitRes;

  try {
    const userId = extractAuthenticatedUserId(req);
    const transactions = serverStore.listActiveTransactionsForUser(userId);
    const categories = serverStore.listCategoriesForUser(userId);
    const csvContent = DashboardAnalyticsService.generateTransactionsCsv(transactions, categories);

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dompetharian-server-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return toErrorResponse(err, 'export_csv_error');
  }
}
