import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      app: 'DompetHarian',
      credit: 'Aravajordan',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      checks: {
        serverStore: 'ok',
      },
    },
    { status: 200 }
  );
}
