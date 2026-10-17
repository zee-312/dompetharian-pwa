/**
 * DompetHarian — Root Layout (Next.js App Router)
 * Visual Direction: Warm Tactile Editorial (#FAF7F2 Warm Oatmeal Paper, #1C1917 Deep Espresso Ink)
 * Author / Credit: Aravajordan
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/components/layout/AppContext';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: 'DompetHarian — Catatan Keuangan Harian Android (Offline-First)',
  description:
    'Aplikasi pencatat pengeluaran dan pemasukan harian offline-first untuk pengguna Android Indonesia dengan penyimpanan struk di Google Drive pribadi.',
  applicationName: 'DompetHarian',
  authors: [{ name: 'Aravajordan' }],
  creator: 'Aravajordan',
  manifest: '/manifest.webmanifest',
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#1C1917',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-[#FAF7F2] text-[#1C1917] antialiased selection:bg-[#2E5A44]/20 selection:text-[#1C1917]">
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
