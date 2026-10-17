'use client';

/**
 * DompetHarian — Mobile Android PWA Shell (Warm Tactile Editorial Edition)
 * Features:
 * - Origami 'D' Wallet + Golden Coin + Sage Sprout BrandLogo
 * - Tactile Warm Oatmeal Paper (#FAF7F2) & Soft Sand (#F3EDE2) surfaces
 * - Persistent Online / Offline + Sync Queue Status Header
 * - Visible "Pasang aplikasi" Android PWA install button
 * - Safe Service Worker update banner ("Versi baru tersedia")
 * - Optional App Lock PIN screen with honest security disclosure
 * - Offline Client-Side Router Switcher so every route works with 0 network round-trips
 * Author / Credit: Aravajordan
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Home,
  PlusCircle,
  Clock,
  BarChart3,
  Camera,
  Settings,
  Wifi,
  WifiOff,
  RefreshCw,
  Download,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from './AppContext';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { verifyUserPin } from '@/lib/security/pin-lock';

// Client screen components for instant offline switching without server round-trips
import BerandaScreen from '@/app/beranda/page';
import TambahScreen from '@/app/tambah/page';
import RiwayatScreen from '@/app/riwayat/page';
import LaporanScreen from '@/app/laporan/page';
import ScanScreen from '@/app/scan/page';
import SinkronisasiScreen from '@/app/sinkronisasi/page';
import PengaturanScreen from '@/app/pengaturan/page';
import LoginScreen from '@/app/login/page';
import PrivasiScreen from '@/app/privasi/page';
import TransaksiDetailScreen from '@/app/transaksi/[id]/page';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const NAV_ITEMS = [
  { href: '/beranda', label: 'Beranda', icon: Home },
  { href: '/riwayat', label: 'Riwayat', icon: Clock },
  { href: '/tambah', label: 'Catat', icon: PlusCircle, isPrimary: true },
  { href: '/scan', label: 'Struk', icon: Camera },
  { href: '/laporan', label: 'Laporan', icon: BarChart3 },
  { href: '/pengaturan', label: 'Setelan', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    session,
    activePath,
    navigateTo,
    isOnline,
    syncStatus,
    isSyncing,
    isPinLocked,
    unlockWithPin,
  } = useApp();

  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [installPromptEvent, setInstallPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPromptEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          if (reg.waiting) {
            setWaitingWorker(reg.waiting);
          }
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                setWaitingWorker(newWorker);
              }
            });
          });
        })
        .catch(() => {
          // Ignore SW registration error in non-HTTPS test environments
        });
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, []);

  const canInstallPwa = installPromptEvent !== null;
  const promptInstallPwa = async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  const swUpdateAvailable = waitingWorker !== null;
  const applySwUpdate = () => {
    if (!waitingWorker) return;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    setWaitingWorker(null);
    window.location.reload();
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      unlockWithPin();
      return;
    }
    const ok = await verifyUserPin(session.userId, pinInput);
    if (!ok) {
      setPinError('PIN tidak sesuai. Silakan coba kembali.');
    } else {
      setPinInput('');
      setPinError(null);
      unlockWithPin();
    }
  };

  if (isPinLocked) {
    return (
      <div className="min-h-screen bg-[#1C1917] text-[#FAF7F2] flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-[#26221F] border border-[#3E3833] rounded-3xl p-6 space-y-5 shadow-2xl">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#2E5A44]/30 border border-[#69B58C]/30 flex items-center justify-center text-[#A3D9B8]">
              <Lock className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-bold font-display-serif tracking-tight text-[#FAF7F2]">
                DompetHarian Terkunci
              </h1>
              <p className="text-xs text-[#B8AFA6]">
                Masukkan PIN keamanan untuk membuka catatan
              </p>
            </div>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="pin-unlock-input"
                className="block text-xs font-semibold text-[#E5DEC9] mb-1.5"
              >
                PIN Aplikasi (4–6 digit angka)
              </label>
              <input
                id="pin-unlock-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                className="w-full touch-target-48 px-4 py-3 rounded-2xl bg-[#1C1917] border border-[#4A433C] text-center text-2xl tracking-widest font-mono-tabular font-bold text-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#D99B26]"
                placeholder="••••"
              />
              {pinError && (
                <p role="alert" className="text-xs text-[#F4A28C] mt-2 font-medium">
                  {pinError}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="w-full touch-target-48 rounded-2xl bg-[#2E5A44] hover:bg-[#234735] text-[#FAF7F2] font-bold text-sm transition-colors shadow-md"
            >
              Buka Kunci Aplikasi
            </button>
          </form>

          <p className="text-[11px] text-[#9E9489] leading-relaxed border-t border-[#3E3833] pt-3">
            Catatan Keamanan: Kunci PIN ini melindungi layar aplikasi dari akses langsung, namun tidak mengenkripsi database lokal (IndexedDB) pada penyimpanan perangkat.
          </p>
        </div>
      </div>
    );
  }

  const totalPendingOrAttention =
    syncStatus.pendingCount +
    syncStatus.failedCount +
    syncStatus.conflictCount +
    syncStatus.receiptPendingCount;

  const renderOfflineCapableScreen = () => {
    if (activePath.startsWith('/transaksi/')) {
      return <TransaksiDetailScreen />;
    }
    switch (activePath) {
      case '/':
      case '/beranda':
        return <BerandaScreen />;
      case '/tambah':
        return <TambahScreen />;
      case '/riwayat':
        return <RiwayatScreen />;
      case '/laporan':
        return <LaporanScreen />;
      case '/scan':
        return <ScanScreen />;
      case '/sinkronisasi':
        return <SinkronisasiScreen />;
      case '/pengaturan':
        return <PengaturanScreen />;
      case '/login':
        return <LoginScreen />;
      case '/privasi':
        return <PrivasiScreen />;
      default:
        return children;
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1C1917] flex flex-col max-w-md mx-auto shadow-sm border-x border-[#E5DEC9]">
      {/* Top App Bar — Warm Tactile Editorial Header */}
      <header className="sticky top-0 z-30 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#E5DEC9] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => navigateTo('/beranda')}
            className="flex items-center gap-2.5 text-left focus:outline-none group"
          >
            <BrandLogo
              size={40}
              variant="tile"
              className="transition-transform group-active:scale-95"
            />
            <div>
              <span className="text-base font-extrabold tracking-tight text-[#1C1917] block leading-none font-display-serif">
                DompetHarian
              </span>
              <span className="text-[11px] text-[#6B635B] font-medium">
                Oleh Aravajordan
              </span>
            </div>
          </button>

          {/* Right Status Pills: Connectivity + Sync Queue */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigateTo('/sinkronisasi')}
              data-testid="connectivity-indicator"
              className={`touch-target-48 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                isOnline
                  ? 'bg-[#E3EFE8] text-[#1E402F] border border-[#B8D4C5]'
                  : 'bg-[#FDF3DC] text-[#7A520B] border border-[#EDD295]'
              }`}
              title="Lihat detail status sinkronisasi"
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-[#2E5A44]" aria-hidden="true" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-[#B47814]" aria-hidden="true" />
                  <span>Offline</span>
                </>
              )}
            </button>

            {totalPendingOrAttention > 0 && (
              <button
                type="button"
                onClick={() => navigateTo('/sinkronisasi')}
                data-testid="header-pending-badge"
                className={`touch-target-48 px-2.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                  syncStatus.conflictCount > 0 || syncStatus.failedCount > 0
                    ? 'bg-[#F9E6DF] text-[#9A3B1B] border border-[#E8BFB0]'
                    : 'bg-[#FDF3DC] text-[#7A520B] border border-[#EDD295]'
                }`}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{totalPendingOrAttention} Menunggu</span>
              </button>
            )}
          </div>
        </div>

        {/* Visible Install Android PWA Banner */}
        {canInstallPwa && (
          <div className="mt-2.5 flex items-center justify-between bg-[#F3EDE2] text-[#1C1917] rounded-2xl px-3.5 py-2.5 text-xs border border-[#D8CEBE]">
            <div className="flex items-center gap-2">
              <Download className="w-4 h-4 text-[#2E5A44] shrink-0" aria-hidden="true" />
              <span className="font-medium">
                Pasang DompetHarian di layar utama HP agar siap dipakai tanpa sinyal
              </span>
            </div>
            <button
              type="button"
              onClick={promptInstallPwa}
              className="ml-2 px-3 py-1.5 rounded-xl bg-[#2E5A44] hover:bg-[#234735] text-[#FAF7F2] font-bold shrink-0"
            >
              Pasang aplikasi
            </button>
          </div>
        )}

        {/* Safe Service Worker Update Available Banner */}
        {swUpdateAvailable && (
          <div
            role="status"
            className="mt-2.5 flex items-center justify-between bg-[#FDF3DC] border border-[#EDD295] text-[#7A520B] rounded-2xl px-3.5 py-2 text-xs"
          >
            <span>Versi baru tersedia. Data lokal kamu tetap aman.</span>
            <button
              type="button"
              onClick={applySwUpdate}
              className="ml-2 px-3 py-1.5 rounded-xl bg-[#D99B26] text-[#1C1917] font-bold shrink-0"
            >
              Muat Ulang
            </button>
          </div>
        )}

        {/* Conflict / Sync Attention Banner */}
        {syncStatus.conflictCount > 0 && (
          <div
            role="alert"
            className="mt-2.5 flex items-center justify-between bg-[#F9E6DF] border border-[#E8BFB0] text-[#9A3B1B] rounded-2xl px-3.5 py-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#C85A32] shrink-0" aria-hidden="true" />
              <span>
                Ada {syncStatus.conflictCount} konflik perubahan data yang perlu kamu tinjau.
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigateTo('/sinkronisasi')}
              className="ml-2 px-2.5 py-1 rounded-xl bg-[#C85A32] text-[#FAF7F2] font-bold shrink-0"
            >
              Selesaikan
            </button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 px-4 py-4 pb-28" id="main-content">
        {renderOfflineCapableScreen()}
      </main>

      {/* Bottom Mobile Navigation Bar (48x48dp accessible touch targets, Warm Tactile Pill Bar) */}
      <nav
        aria-label="Navigasi Utama"
        className="fixed bottom-0 left-0 right-0 z-30 max-w-md mx-auto bg-[#FAF7F2]/95 backdrop-blur-md border-t border-[#E5DEC9] px-1.5 py-1.5 shadow-[0_-4px_16px_rgba(28,25,23,0.06)]"
      >
        <ul className="grid grid-cols-6 gap-0.5 items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              activePath === item.href ||
              (activePath === '/' && item.href === '/beranda');

            return (
              <li key={item.href} className="flex justify-center">
                <Link
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo(item.href);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`touch-target-48 w-full flex flex-col items-center justify-center rounded-2xl py-1.5 text-[11px] font-semibold transition-all ${
                    item.isPrimary
                      ? 'bg-[#C85A32] text-[#FAF7F2] shadow-sm hover:bg-[#B04B25]'
                      : isActive
                        ? 'text-[#1E402F] bg-[#E3EFE8] font-bold'
                        : 'text-[#6B635B] hover:text-[#1C1917] hover:bg-[#F3EDE2]/60'
                  }`}
                >
                  <Icon className="w-5 h-5 mb-0.5" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
