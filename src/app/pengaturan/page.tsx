'use client';

/**
 * DompetHarian — Halaman Pengaturan, Kategori Kustom, Google Drive, PIN & Privasi
 * Rules:
 * - Category management: add custom category, rename, archive (never hard-delete categories used by transactions).
 * - Google Drive: connect/disconnect using drive.file scope, tokens in memory only.
 * - App Lock PIN: PBKDF2-SHA256 with honest disclosure that it blocks UI and does not encrypt IndexedDB at rest.
 * - Logout warning when unsynced local operations or queued receipts exist, with backup export option.
 * - Account deletion: deletes server records, clears local IndexedDB, and optionally deletes the Drive folder.
 * Author / Credit: Aravajordan
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/layout/AppContext';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { clearLocalDataForUser } from '@/lib/sync/dexie-db';
import { clearPinConfig, getPinConfig, setPinConfig } from '@/lib/security/pin-lock';
import { AuthService } from '@/features/auth/auth-service';
import { DashboardAnalyticsService } from '@/features/dashboard/dashboard-service';
import { defaultDriveApiAdapter } from '@/features/receipts/receipt-service';
import { DriveTokenStore } from '@/lib/drive/drive-token-store';
import { TIMEZONE_LABELS } from '@/lib/formatters/date';
import type { IndonesianTimezone, TransactionKind } from '@/lib/database/types';

export default function PengaturanPage() {
  const {
    session,
    isOnline,
    navigateTo,
    timezone,
    setTimezone,
    transactions,
    categories,
    syncStatus,
    driveStatus,
    storagePersisted,
    lockAppNow,
    refreshLocalData,
    triggerSyncNow,
    switchOrUpdateSession,
    connectGoogleDrive,
    disconnectGoogleDrive,
  } = useApp();

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Category form state
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatKind, setNewCatKind] = useState<TransactionKind>('expense');
  const [newCatColor, setNewCatColor] = useState<string>('#047857');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState<string>('');

  // PIN form state
  const [pinEnabled, setPinEnabled] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinTimeoutSec, setPinTimeoutSec] = useState<number>(60);

  // Logout & Delete confirmation modals
  const [showLogoutConfirm, setShowLogoutConfirm] = useState<boolean>(false);
  const [showWipeLocalConfirm, setShowWipeLocalConfirm] = useState<boolean>(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState<boolean>(false);
  const [alsoDeleteDriveFolder, setAlsoDeleteDriveFolder] = useState<boolean>(false);

  useEffect(() => {
    if (session?.userId) {
      const cfg = getPinConfig(session.userId);
      setPinEnabled(Boolean(cfg?.enabled));
      if (cfg?.timeoutSeconds !== undefined) {
        setPinTimeoutSec(cfg.timeoutSeconds);
      }
    }
  }, [session?.userId]);

  const totalUnsyncedItems =
    syncStatus.pendingCount +
    syncStatus.failedCount +
    syncStatus.conflictCount +
    syncStatus.receiptPendingCount;

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await localRepository.createCategory(session.userId, {
        name: newCatName,
        kind: newCatKind,
        color: newCatColor,
      });
      setNewCatName('');
      await refreshLocalData();
      setStatusMessage('Kategori baru berhasil ditambahkan.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal membuat kategori.');
    }
  };

  const handleRenameCategory = async (catId: string) => {
    if (!session) return;
    setErrorMessage(null);
    try {
      await localRepository.renameCategory(session.userId, catId, editingCatName);
      setEditingCatId(null);
      setEditingCatName('');
      await refreshLocalData();
      setStatusMessage('Nama kategori berhasil diperbarui.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah nama kategori.');
    }
  };

  const handleToggleArchiveCategory = async (catId: string, currentlyArchived: boolean) => {
    if (!session) return;
    setErrorMessage(null);
    try {
      await localRepository.archiveCategory(session.userId, catId, !currentlyArchived);
      await refreshLocalData();
      setStatusMessage(
        !currentlyArchived
          ? 'Kategori diarsipkan (tetap terjaga untuk riwayat transaksi lama).'
          : 'Kategori diaktifkan kembali.'
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memperbarui status kategori.');
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await setPinConfig(session.userId, pinInput.trim(), pinTimeoutSec);
      setPinEnabled(true);
      setPinInput('');
      setStatusMessage('PIN Kunci Aplikasi berhasil diaktifkan.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'PIN harus terdiri dari 4–6 angka.');
    }
  };

  const handleDisablePin = () => {
    if (!session) return;
    clearPinConfig(session.userId);
    setPinEnabled(false);
    setStatusMessage('PIN Kunci Aplikasi dinonaktifkan.');
  };

  const handleDownloadBackupBeforeLogout = () => {
    const csv = DashboardAnalyticsService.generateTransactionsCsv(transactions, categories);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Cadangan_DompetHarian_${session?.userId.slice(0, 8) ?? 'lokal'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleConfirmLogout = async () => {
    await disconnectGoogleDrive();
    AuthService.clearActiveSession();
    await switchOrUpdateSession(null);
    setShowLogoutConfirm(false);
    navigateTo('/login');
  };

  const handleWipeLocalData = async () => {
    if (!session) return;
    await clearLocalDataForUser(session.userId);
    await refreshLocalData();
    setShowWipeLocalConfirm(false);
    setStatusMessage('Seluruh data lokal akun ini di HP telah dihapus dan direset ke awal.');
  };

  const handleDeleteAccountPermanently = async () => {
    if (!session) return;
    if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      setErrorMessage(
        'Penghapusan akun permanen membutuhkan koneksi internet agar data di server dapat dihapus sepenuhnya.'
      );
      return;
    }

    setErrorMessage(null);
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'x-user-id': session.userId,
        },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Gagal menghapus data akun di server.');
      }

      if (alsoDeleteDriveFolder) {
        const token = DriveTokenStore.getValidToken();
        if (token) {
          await defaultDriveApiAdapter.deleteAppFolder({ accessToken: token }).catch(() => null);
        }
      }

      await disconnectGoogleDrive();
      await clearLocalDataForUser(session.userId);
      clearPinConfig(session.userId);
      AuthService.removeRegisteredAccount(session.email);
      AuthService.clearActiveSession();
      await switchOrUpdateSession(null);
      setShowDeleteAccountConfirm(false);
      navigateTo('/login');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal menghapus akun.');
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-lg font-bold tracking-tight font-serif text-[#1C1917]">Pengaturan & Keamanan</h1>
        <p className="text-xs text-[#6B635B]">
          Kelola akun, kategori, Google Drive, zona waktu, dan kunci privasi DompetHarian.
        </p>
      </div>

      {statusMessage && (
        <div
          role="status"
          data-testid="settings-status-banner"
          className="rounded-xl border border-[#B8D4C5] bg-[#E3EFE8] p-3 text-xs font-medium text-[#1E402F]"
        >
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          data-testid="settings-error-banner"
          className="rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] p-3 text-xs font-medium text-[#9A3B1B]"
        >
          {errorMessage}
        </div>
      )}

      {/* 1. Account & Session Section */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#1C1917]">Akun Pengguna</h2>
            {session ? (
              <div className="mt-1 text-xs text-[#6B635B] space-y-0.5">
                <p className="font-semibold text-[#1C1917]">{session.displayName}</p>
                <p data-testid="active-user-email">{session.email}</p>
                <p className="text-[11px] text-[#6B635B]">
                  Namespace Lokal: <code>{session.userId.slice(0, 12)}...</code>
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-[#6B635B]">Belum ada sesi login aktif.</p>
            )}
          </div>

          <Link
            href="/login"
            data-testid="link-switch-account"
            className="min-h-touch inline-flex items-center rounded-xl border border-[#D8CEBE] bg-[#F3EDE2] px-3 py-2 text-xs font-bold text-[#1C1917] hover:bg-[#F3EDE2]"
          >
            Ganti / Masuk Akun
          </Link>
        </div>

        {session && (
          <div className="pt-1">
            {!showLogoutConfirm ? (
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                data-testid="btn-logout-prompt"
                className="min-h-touch w-full rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] px-3 py-2 text-xs font-bold text-[#9A3B1B] hover:bg-[#F9E6DF]"
              >
                Keluar dari Akun (Logout)
              </button>
            ) : (
              <div className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 space-y-2.5 text-xs">
                <p className="font-bold text-[#7A520B]">Konfirmasi Keluar Akun</p>
                {totalUnsyncedItems > 0 ? (
                  <p className="text-[#7A520B]">
                    Perhatian: Kamu memiliki <strong>{totalUnsyncedItems} item</strong> yang belum
                    disinkronkan ke server atau Google Drive. Disarankan menyinkronkan atau
                    mengunduh cadangan CSV terlebih dahulu.
                  </p>
                ) : (
                  <p className="text-[#7A520B]">
                    Semua data transaksi lokal sudah tersinkron. Apakah kamu yakin ingin keluar?
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {totalUnsyncedItems > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => void triggerSyncNow()}
                        className="min-h-touch rounded-lg bg-[#2E5A44] px-3 py-2 font-bold text-white"
                      >
                        Sinkronkan Sekarang
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadBackupBeforeLogout}
                        className="min-h-touch rounded-lg border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 font-bold text-[#1C1917]"
                      >
                        Unduh Cadangan CSV
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleConfirmLogout()}
                    data-testid="btn-confirm-logout"
                    className="min-h-touch rounded-lg bg-[#C85A32] px-3 py-2 font-bold text-white"
                  >
                    Tetap Keluar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(false)}
                    className="min-h-touch rounded-lg border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 font-semibold text-[#6B635B]"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Google Drive Receipt Integration */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#1C1917]">
            Penyimpanan Struk Google Drive Pribadi
          </h2>
          <p className="mt-0.5 text-xs text-[#6B635B]">
            Menggunakan izin terbatas <code>drive.file</code>. DompetHarian hanya dapat mengakses
            folder <code>DompetHarian_Struk</code> yang dibuatnya dan tidak bisa membaca file Drive
            kamu yang lain. Token akses hanya disimpan di RAM browser.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-[#F3EDE2] px-3 py-2.5 text-xs">
          <span className="font-medium text-[#6B635B]">Status Koneksi:</span>
          <span
            data-testid="drive-connection-status"
            className={`font-bold ${
              driveStatus === 'connected'
                ? 'text-[#2E5A44]'
                : driveStatus === 'revoked' || driveStatus === 'expired'
                  ? 'text-[#C85A32]'
                  : 'text-[#6B635B]'
            }`}
          >
            {driveStatus === 'connected'
              ? 'Terhubung (Token Aktif di Memori)'
              : driveStatus === 'expired'
                ? 'Sesi Kedaluwarsa'
                : driveStatus === 'revoked'
                  ? 'Akses Dicabut'
                  : 'Belum Terhubung'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              void connectGoogleDrive().then(() =>
                setStatusMessage('Google Drive terhubung. Antrean struk sedang disinkronkan.')
              )
            }
            data-testid="btn-connect-drive"
            className="min-h-touch flex-1 rounded-xl bg-[#2E5A44] px-3.5 py-2.5 text-xs font-bold text-white hover:bg-[#234735]"
          >
            {driveStatus === 'connected'
              ? 'Perbarui Sesi Google Drive'
              : 'Hubungkan Google Drive'}
          </button>

          {driveStatus === 'connected' && (
            <button
              type="button"
              onClick={() =>
                void disconnectGoogleDrive().then(() =>
                  setStatusMessage('Akses Google Drive telah diputus dan token dihapus dari memori.')
                )
              }
              data-testid="btn-disconnect-drive"
              className="min-h-touch rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] px-3.5 py-2.5 text-xs font-bold text-[#9A3B1B] hover:bg-[#F9E6DF]"
            >
              Cabut Akses Drive
            </button>
          )}
        </div>
      </section>

      {/* 3. Timezone Selector (WIB / WITA / WIT) */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-2.5">
        <label htmlFor="timezone-select" className="block text-sm font-bold text-[#1C1917]">
          Zona Waktu Indonesia (Batas Hari Ini & Bulan Ini)
        </label>
        <p className="text-xs text-[#6B635B]">
          Menentukan batas pergantian tanggal lokal untuk ringkasan Hari Ini dan Laporan Bulanan.
        </p>
        <select
          id="timezone-select"
          value={timezone}
          onChange={(e) => {
            setTimezone(e.target.value as IndonesianTimezone);
            setStatusMessage(
              `Zona waktu diubah ke ${TIMEZONE_LABELS[e.target.value as IndonesianTimezone]}.`
            );
          }}
          data-testid="timezone-select"
          className="min-h-touch w-full rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3.5 py-2.5 text-sm font-semibold text-[#1C1917]"
        >
          {(Object.keys(TIMEZONE_LABELS) as IndonesianTimezone[]).map((tz) => (
            <option key={tz} value={tz}>
              {TIMEZONE_LABELS[tz]}
            </option>
          ))}
        </select>
      </section>

      {/* 4. App Lock PIN (PBKDF2-SHA256) */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#1C1917]">Kunci Aplikasi dengan PIN</h2>
          <p className="mt-1 rounded-xl border border-[#E5DEC9] bg-[#F3EDE2] p-2.5 text-[11px] text-[#6B635B]">
            <strong>Keterbukaan Keamanan:</strong> PIN Kunci Aplikasi memblokir tampilan antarmuka
            (UI) saat aplikasi dibuka atau kembali dari latar belakang, namun{' '}
            <strong>tidak mengenkripsi database IndexedDB pada sistem file perangkat</strong>.
            Gunakan kunci layar bawaan Android untuk enkripsi perangkat penuh.
          </p>
        </div>

        {pinEnabled ? (
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-[#1E402F]">
              Status: PIN Kunci Aplikasi Aktif (Batas waktu latar belakang: {pinTimeoutSec} detik)
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={lockAppNow}
                data-testid="btn-lock-app-now"
                className="min-h-touch rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white"
              >
                Kunci Layar Sekarang
              </button>
              <button
                type="button"
                onClick={handleDisablePin}
                data-testid="btn-disable-pin"
                className="min-h-touch rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] px-3.5 py-2 text-xs font-bold text-[#9A3B1B]"
              >
                Nonaktifkan PIN
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSavePin(e)} className="space-y-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label htmlFor="pin-setup-input" className="block text-xs font-bold text-[#1C1917]">
                  Buat PIN Baru (4–6 angka)
                </label>
                <span className="block text-[11px] text-[#6B635B]">
                  Hanya angka 0–9, minimal 4 digit.
                </span>
                <input
                  id="pin-setup-input"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,6}"
                  maxLength={6}
                  required
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="Contoh: 1234"
                  data-testid="pin-setup-input"
                  className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3 py-2 text-sm text-[#1C1917]"
                />
              </div>

              <div>
                <label htmlFor="pin-timeout-select" className="block text-xs font-bold text-[#1C1917]">
                  Kunci Otomatis Setelah di Latar Belakang
                </label>
                <span className="block text-[11px] text-[#6B635B]">
                  Waktu jeda sebelum PIN diminta kembali.
                </span>
                <select
                  id="pin-timeout-select"
                  value={pinTimeoutSec}
                  onChange={(e) => setPinTimeoutSec(Number(e.target.value))}
                  className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 text-sm text-[#1C1917]"
                >
                  <option value={0}>Segera (0 detik)</option>
                  <option value={60}>1 Menit</option>
                  <option value={300}>5 Menit</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              data-testid="btn-enable-pin"
              className="min-h-touch rounded-xl bg-[#2E5A44] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#234735]"
            >
              Aktifkan PIN Kunci Aplikasi
            </button>
          </form>
        )}
      </section>

      {/* 5. Category Management */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-[#1C1917]">Kelola Kategori</h2>
          <p className="text-xs text-[#6B635B]">
            Tambahkan kategori kustom, ubah nama, atau arsipkan kategori yang jarang dipakai.
            Kategori yang memiliki riwayat transaksi diarsipkan (bukan dihapus permanen) agar
            laporan historis tetap akurat.
          </p>
        </div>

        <form onSubmit={(e) => void handleAddCategory(e)} className="space-y-2.5 border-b border-slate-100 pb-4">
          <p className="text-xs font-bold text-[#1C1917]">Tambah Kategori Kustom</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              type="text"
              required
              maxLength={60}
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Nama kategori baru..."
              data-testid="new-category-name-input"
              className="min-h-touch rounded-xl border border-[#D8CEBE] px-3 py-2 text-xs text-[#1C1917]"
            />
            <select
              value={newCatKind}
              onChange={(e) => setNewCatKind(e.target.value as TransactionKind)}
              data-testid="new-category-kind-select"
              className="min-h-touch rounded-xl border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 text-xs text-[#1C1917]"
            >
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
            <div className="flex gap-2">
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                aria-label="Warna Kategori"
                className="min-h-touch h-12 w-14 cursor-pointer rounded-xl border border-[#D8CEBE] p-1"
              />
              <button
                type="submit"
                data-testid="btn-add-category"
                className="min-h-touch flex-1 rounded-xl bg-[#2E5A44] px-3 py-2 text-xs font-bold text-white hover:bg-[#234735]"
              >
                Tambah
              </button>
            </div>
          </div>
        </form>

        <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {categories.map((cat) => (
            <li key={cat.id} className="flex items-center justify-between gap-2 py-2.5 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
                {editingCatId === cat.id ? (
                  <input
                    type="text"
                    value={editingCatName}
                    onChange={(e) => setEditingCatName(e.target.value)}
                    className="min-h-touch rounded-lg border border-[#D8CEBE] px-2 py-1 text-xs"
                  />
                ) : (
                  <span
                    className={`truncate font-semibold ${
                      cat.is_archived ? 'line-through text-slate-400' : 'text-[#1C1917]'
                    }`}
                  >
                    {cat.name}{' '}
                    <span className="font-normal text-[#6B635B]">
                      ({cat.kind === 'expense' ? 'Pengeluaran' : 'Pemasukan'})
                    </span>
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {editingCatId === cat.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleRenameCategory(cat.id)}
                      className="min-h-touch rounded-lg bg-[#2E5A44] px-2.5 py-1 font-bold text-white"
                    >
                      Simpan
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCatId(null)}
                      className="min-h-touch rounded-lg border border-[#D8CEBE] px-2.5 py-1 text-[#6B635B]"
                    >
                      Batal
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(cat.id);
                        setEditingCatName(cat.name);
                      }}
                      className="min-h-touch rounded-lg border border-[#E5DEC9] px-2.5 py-1 font-semibold text-[#6B635B] hover:bg-[#F3EDE2]"
                    >
                      Ubah Nama
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleArchiveCategory(cat.id, cat.is_archived)}
                      className="min-h-touch rounded-lg border border-[#E5DEC9] px-2.5 py-1 font-semibold text-[#6B635B] hover:bg-[#F3EDE2]"
                    >
                      {cat.is_archived ? 'Aktifkan' : 'Arsipkan'}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 6. Storage Persistence & Local Data Wipe / Account Deletion */}
      <section className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-[#1C1917]">Penyimpanan Lokal & Privasi Data</h2>
          <p className="mt-0.5 text-xs text-[#6B635B]">
            Status Penyimpanan Persisten Browser:{' '}
            <span className="font-semibold text-[#1C1917]">
              {storagePersisted ? 'Aktif (Dilindungi dari pembersihan otomatis)' : 'Standar Browser'}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[#7A520B] bg-[#FDF3DC] border border-[#EDD295] rounded-lg p-2">
            <strong>Penting:</strong> Menghapus data situs/aplikasi melalui pengaturan Chrome atau
            Android akan menghapus transaksi lokal yang belum disinkronkan ke server.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            href="/privasi"
            className="min-h-touch inline-flex items-center rounded-xl border border-[#D8CEBE] bg-[#F3EDE2] px-3.5 py-2 text-xs font-bold text-[#1C1917] hover:bg-[#F3EDE2]"
          >
            Baca Pemberitahuan Privasi (UU PDP)
          </Link>

          <button
            type="button"
            onClick={() => setShowWipeLocalConfirm(true)}
            data-testid="btn-wipe-local-prompt"
            className="min-h-touch rounded-xl border border-[#EDD295] bg-[#FDF3DC] px-3.5 py-2 text-xs font-bold text-[#7A520B] hover:bg-[#FDF3DC]"
          >
            Hapus Data Lokal di HP Ini
          </button>

          <button
            type="button"
            onClick={() => setShowDeleteAccountConfirm(true)}
            data-testid="btn-delete-account-prompt"
            className="min-h-touch rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] px-3.5 py-2 text-xs font-bold text-[#9A3B1B] hover:bg-[#F9E6DF]"
          >
            Hapus Akun Permanen
          </button>
        </div>

        {showWipeLocalConfirm && (
          <div className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 text-xs space-y-2">
            <p className="font-bold text-[#7A520B]">
              Yakin ingin menghapus seluruh data lokal akun ini di HP ini?
            </p>
            <p className="text-[#7A520B]">
              Data yang sudah disinkronkan di server tetap aman, namun catatan yang belum
              disinkronkan di HP ini akan hilang.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleWipeLocalData()}
                data-testid="btn-confirm-wipe-local"
                className="min-h-touch rounded-lg bg-[#D99B26] px-3 py-2 font-bold text-white"
              >
                Ya, Hapus Data Lokal
              </button>
              <button
                type="button"
                onClick={() => setShowWipeLocalConfirm(false)}
                className="min-h-touch rounded-lg border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 font-semibold text-[#6B635B]"
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {showDeleteAccountConfirm && (
          <div className="rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] p-3 text-xs space-y-2.5">
            <p className="font-bold text-[#9A3B1B]">
              Konfirmasi Penghapusan Akun & Data Secara Permanen
            </p>
            <p className="text-[#9A3B1B]">
              Tindakan ini akan menghapus seluruh transaksi, kategori, dan log sinkronisasi kamu di
              server Supabase serta menghapus database lokal di HP ini.
            </p>
            <label className="flex items-center gap-2 font-medium text-[#9A3B1B]">
              <input
                type="checkbox"
                checked={alsoDeleteDriveFolder}
                onChange={(e) => setAlsoDeleteDriveFolder(e.target.checked)}
                className="h-4 w-4 rounded border-[#E8BFB0]"
              />
              <span>
                Hapus juga folder <code>DompetHarian_Struk</code> beserta foto struk di Google Drive
                saya (jika terhubung)
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleDeleteAccountPermanently()}
                data-testid="btn-confirm-delete-account"
                className="min-h-touch rounded-lg bg-[#C85A32] px-3 py-2 font-bold text-white"
              >
                Hapus Akun Saya Sekarang
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteAccountConfirm(false)}
                className="min-h-touch rounded-lg border border-[#D8CEBE] bg-[#FFFDF9] px-3 py-2 font-semibold text-[#6B635B]"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
