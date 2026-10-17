/**
 * DompetHarian — Android PWA Web App Manifest (Milestone 2.1)
 * Visual Theme: Warm Tactile Editorial (#FAF7F2 background, #1C1917 theme_color)
 * Author / Credit: Aravajordan
 */

import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DompetHarian — Catatan Keuangan Harian Offline-First',
    short_name: 'DompetHarian',
    description:
      'Aplikasi pencatat pengeluaran dan pemasukan harian offline-first untuk pengguna Android Indonesia. Struk tersimpan di Google Drive pribadi.',
    start_url: '/beranda',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF7F2',
    theme_color: '#1C1917',
    lang: 'id-ID',
    categories: ['finance', 'productivity', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
