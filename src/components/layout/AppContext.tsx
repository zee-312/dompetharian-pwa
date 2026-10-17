'use client';

/**
 * DompetHarian — Offline-First Application Context & Sync Coordinator
 * Author / Credit: Aravajordan
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import type {
  IndonesianTimezone,
  LocalCategoryRecord,
  LocalTransactionRecord,
} from '@/lib/database/types';
import { AuthService, type AuthUserSession } from '@/features/auth/auth-service';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { syncEngine, type SyncStatusSummary } from '@/lib/sync/sync-engine';
import { receiptService } from '@/features/receipts/receipt-service';
import { requestPersistentBrowserStorage } from '@/lib/sync/dexie-db';
import { DriveTokenStore, type DriveConnectionStatus } from '@/lib/drive/drive-token-store';
import { getPinConfig } from '@/lib/security/pin-lock';

interface AppContextValue {
  session: AuthUserSession | null;
  isOnline: boolean;
  activePath: string;
  navigateTo: (href: string) => void;
  timezone: IndonesianTimezone;
  setTimezone: (tz: IndonesianTimezone) => void;
  transactions: LocalTransactionRecord[];
  categories: LocalCategoryRecord[];
  syncStatus: SyncStatusSummary;
  isSyncing: boolean;
  lastSyncNotice: string | null;
  driveStatus: DriveConnectionStatus;
  storagePersisted: boolean;
  isPinLocked: boolean;
  unlockWithPin: () => void;
  lockAppNow: () => void;
  refreshLocalData: () => Promise<void>;
  triggerSyncNow: () => Promise<void>;
  switchOrUpdateSession: (newSession: AuthUserSession | null) => Promise<void>;
  connectGoogleDrive: () => Promise<void>;
  disconnectGoogleDrive: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const TIMEZONE_STORAGE_KEY = 'dh_user_timezone_v1';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const nextPathname = usePathname();
  const [activePath, setActivePath] = useState<string>(nextPathname || '/beranda');
  const [session, setSession] = useState<AuthUserSession | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [timezone, setTimezoneState] = useState<IndonesianTimezone>('Asia/Jakarta');
  const [transactions, setTransactions] = useState<LocalTransactionRecord[]>([]);
  const [categories, setCategories] = useState<LocalCategoryRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusSummary>({
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    rejectedCount: 0,
    receiptPendingCount: 0,
    lastSyncedAt: null,
    initialPullCompleted: false,
    isDataPotentiallyIncomplete: false,
  });
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncNotice, setLastSyncNotice] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveConnectionStatus>('disconnected');
  const [storagePersisted, setStoragePersisted] = useState<boolean>(false);
  const [isPinLocked, setIsPinLocked] = useState<boolean>(false);
  const hiddenTimestampRef = useRef<number | null>(null);

  const setTimezone = useCallback((tz: IndonesianTimezone) => {
    setTimezoneState(tz);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TIMEZONE_STORAGE_KEY, tz);
    }
  }, []);

  const refreshLocalData = useCallback(async (overrideUserId?: string) => {
    const activeUserId = overrideUserId ?? session?.userId;
    if (!activeUserId) {
      setTransactions([]);
      setCategories([]);
      return;
    }
    const [txs, cats, summary] = await Promise.all([
      localRepository.listTransactions(activeUserId),
      localRepository.listCategories(activeUserId, true),
      syncEngine.getSyncStatusSummary(activeUserId),
    ]);
    setTransactions(txs);
    setCategories(cats);
    setSyncStatus(summary);
    setDriveStatus(DriveTokenStore.getStatus());
  }, [session?.userId]);

  const triggerSyncNow = useCallback(async () => {
    const activeUserId = session?.userId;
    if (!activeUserId) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setLastSyncNotice(
        'Kamu sedang offline. Transaksi disimpan di HP ini dan akan disinkronkan saat internet kembali aktif.'
      );
      await refreshLocalData(activeUserId);
      return;
    }

    setIsSyncing(true);
    try {
      const outcome = await syncEngine.syncNow(activeUserId, { ignoreBackoffWindow: true });
      if (DriveTokenStore.getValidToken()) {
        await receiptService.flushOutboxForUser(activeUserId);
      }
      await refreshLocalData(activeUserId);
      if (outcome.error) {
        setLastSyncNotice(outcome.error);
      } else if (outcome.conflictCount > 0) {
        setLastSyncNotice(
          `Ditemukan ${outcome.conflictCount} konflik sinkronisasi. Silakan tinjau di halaman Sinkronisasi.`
        );
      } else {
        setLastSyncNotice('Sinkronisasi berhasil.');
      }
    } finally {
      setIsSyncing(false);
    }
  }, [session?.userId, refreshLocalData]);

  // Initialize session, timezone, persistent storage, and PIN check on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);
    const savedTz = window.localStorage.getItem(TIMEZONE_STORAGE_KEY) as IndonesianTimezone | null;
    if (
      savedTz === 'Asia/Jakarta' ||
      savedTz === 'Asia/Makassar' ||
      savedTz === 'Asia/Jayapura'
    ) {
      setTimezoneState(savedTz);
    }

    const initialSession = AuthService.ensureDefaultSessionIfNone();
    setSession(initialSession);

    if (initialSession) {
      const pinCfg = getPinConfig(initialSession.userId);
      if (pinCfg?.enabled) {
        setIsPinLocked(true);
      }
      void requestPersistentBrowserStorage(initialSession.userId).then((persisted) => {
        setStoragePersisted(persisted);
      });
      void refreshLocalData(initialSession.userId).then(() => {
        if (navigator.onLine) {
          void syncEngine.syncNow(initialSession.userId).then(() => {
            void refreshLocalData(initialSession.userId);
          });
        }
      });
    }
  }, [refreshLocalData]);

  // Sync triggers: online event, visibilitychange event, Service Worker postMessage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      setLastSyncNotice('Koneksi internet kembali aktif. Menyinkronkan data...');
      void triggerSyncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastSyncNotice('Mode Offline aktif — Semua catatan disimpan aman di HP ini.');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimestampRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (session?.userId) {
          const pinCfg = getPinConfig(session.userId);
          if (pinCfg?.enabled && hiddenTimestampRef.current !== null) {
            const elapsedSec = (Date.now() - hiddenTimestampRef.current) / 1000;
            if (elapsedSec >= pinCfg.timeoutSeconds) {
              setIsPinLocked(true);
            }
          }
          if (navigator.onLine) {
            void triggerSyncNow();
          } else {
            void refreshLocalData(session.userId);
          }
        }
      }
    };

    const handleSwMessage = (ev: MessageEvent) => {
      if (ev.data && ev.data.type === 'TRIGGER_FOREGROUND_SYNC') {
        void triggerSyncNow();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [session?.userId, triggerSyncNow, refreshLocalData]);

  //Sync ARIA invalid states per modern-web-guidance (validate-input-after-interaction)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncAria = (el: EventTarget | null) => {
      if (el instanceof HTMLInputElement) {
        try {
          el.setAttribute('aria-invalid', el.matches(':user-invalid') ? 'true' : 'false');
        } catch {
          // Ignore if selector unsupported
        }
      }
    };
    const onBlur = (e: Event) => syncAria(e.target);
    const onInput = (e: Event) => {
      if (e.target instanceof HTMLInputElement && e.target.hasAttribute('aria-invalid')) {
        syncAria(e.target);
      }
    };
    document.addEventListener('blur', onBlur, true);
    document.addEventListener('input', onInput);
    return () => {
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('input', onInput);
    };
  }, []);

  const switchOrUpdateSession = useCallback(
    async (newSession: AuthUserSession | null) => {
      setSession(newSession);
      setIsPinLocked(false);
      if (newSession) {
        await refreshLocalData(newSession.userId);
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          await syncEngine.syncNow(newSession.userId, { ignoreBackoffWindow: true });
          await refreshLocalData(newSession.userId);
        }
      } else {
        setTransactions([]);
        setCategories([]);
      }
    },
    [refreshLocalData]
  );

  const connectGoogleDrive = useCallback(async () => {
    await DriveTokenStore.requestBrowserToken();
    setDriveStatus(DriveTokenStore.getStatus());
    if (session?.userId) {
      await receiptService.flushOutboxForUser(session.userId);
      await refreshLocalData(session.userId);
    }
  }, [session?.userId, refreshLocalData]);

  const disconnectGoogleDrive = useCallback(async () => {
    await DriveTokenStore.revokeAndClear();
    setDriveStatus(DriveTokenStore.getStatus());
  }, []);

  useEffect(() => {
    if (nextPathname) {
      setActivePath(nextPathname);
    }
  }, [nextPathname]);

  const navigateTo = useCallback((href: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', href);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
    setActivePath(href);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setActivePath(window.location.pathname || '/beranda');
    };
    const onDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/') || href.startsWith('/api/')) return;
      e.preventDefault();
      e.stopPropagation();
      navigateTo(href);
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('click', onDocumentClick, true);
    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('click', onDocumentClick, true);
    };
  }, [navigateTo]);

  const unlockWithPin = useCallback(() => {
    setIsPinLocked(false);
    hiddenTimestampRef.current = null;
  }, []);

  const lockAppNow = useCallback(() => {
    setIsPinLocked(true);
  }, []);

  return (
    <AppContext.Provider
      value={{
        session,
        isOnline,
        activePath,
        navigateTo,
        timezone,
        setTimezone,
        transactions,
        categories,
        syncStatus,
        isSyncing,
        lastSyncNotice,
        driveStatus,
        storagePersisted,
        isPinLocked,
        unlockWithPin,
        lockAppNow,
        refreshLocalData,
        triggerSyncNow,
        switchOrUpdateSession,
        connectGoogleDrive,
        disconnectGoogleDrive,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp harus digunakan di dalam AppProvider.');
  }
  return ctx;
}
