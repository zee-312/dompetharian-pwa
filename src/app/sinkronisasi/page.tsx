'use client';

/**
 * DompetHarian — Status Sinkronisasi & Penyelesaian Konflik (/sinkronisasi — PRD Section 5.8)
 * - Displays counts of pending, failed, conflicted, and receipt-outbox items, plus last sync time.
 * - Provides manual "Sinkronkan sekarang" and "Coba lagi" actions.
 * - Shows interactive side-by-side Indonesian Conflict Resolution UI:
 *   "Gunakan Versi HP Ini", "Gunakan Versi Server", or "Edit & Gabungkan Manual".
 * Author / Credit: Aravajordan
 */

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, CloudUpload } from 'lucide-react';
import { useApp } from '@/components/layout/AppContext';
import { localDb, type SyncQueueItem } from '@/lib/sync/dexie-db';
import { syncEngine } from '@/lib/sync/sync-engine';
import { receiptService } from '@/features/receipts/receipt-service';
import { formatRupiah } from '@/lib/formatters/currency';
import type { TransactionRecord } from '@/lib/database/types';

export default function SinkronisasiPage() {
  const {
    session,
    isOnline,
    syncStatus,
    isSyncing,
    lastSyncNotice,
    triggerSyncNow,
    refreshLocalData,
  } = useApp();

  const [queueItems, setQueueItems] = useState<SyncQueueItem[]>([]);
  const [editingConflictOpId, setEditingConflictOpId] = useState<string | null>(null);
  const [customAmountStr, setCustomAmountStr] = useState<string>('');
  const [customDescription, setCustomDescription] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!session) return;
    const items = await localDb.syncQueue
      .where('user_id')
      .equals(session.userId)
      .sortBy('created_at_ms');
    setQueueItems(items);
  }, [session]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue, syncStatus]);

  const handleManualSync = async () => {
    if (!isOnline) {
      setActionMessage(
        'Kamu sedang offline. Sinkronisasi ke server membutuhkan koneksi internet. Data kamu tetap aman di HP ini.'
      );
      return;
    }
    setActionMessage(null);
    await triggerSyncNow();
    await loadQueue();
  };

  const handleRetryFailed = async () => {
    if (!session) return;
    if (!isOnline) {
      setActionMessage(
        'Tidak dapat mencoba ulang saat offline. Hubungkan HP ke internet terlebih dahulu.'
      );
      return;
    }
    await syncEngine.retryFailedOperations(session.userId);
    await receiptService.flushOutboxForUser(session.userId);
    await refreshLocalData();
    await loadQueue();
    setActionMessage('Percobaan ulang sinkronisasi selesai dijalankan.');
  };

  const handleResolveConflict = async (
    op: SyncQueueItem,
    resolution: 'keep_local' | 'keep_server' | 'custom_edit'
  ) => {
    if (!session) return;
    if (resolution === 'custom_edit') {
      const parsedAmt = Number(customAmountStr.replace(/\D/g, ''));
      if (!Number.isInteger(parsedAmt) || parsedAmt <= 0) {
        setActionMessage('Masukkan nominal Rupiah bilangan bulat yang valid.');
        return;
      }
      await syncEngine.resolveConflict(session.userId, op.op_id, 'custom_edit', {
        amount_idr: parsedAmt,
        description: customDescription.trim() || 'Transaksi Gabungan',
      });
      setEditingConflictOpId(null);
    } else {
      await syncEngine.resolveConflict(session.userId, op.op_id, resolution);
    }

    if (isOnline) {
      await syncEngine.syncNow(session.userId, { ignoreBackoffWindow: true });
    }
    await refreshLocalData();
    await loadQueue();
    setActionMessage('Konflik berhasil diselesaikan.');
  };

  const conflictItems = queueItems.filter((i) => i.status === 'conflict');
  const failedOrRejectedItems = queueItems.filter(
    (i) => i.status === 'failed' || i.status === 'rejected'
  );

  return (
    <div className="space-y-4">
      {/* Overview Counts Card */}
      <section className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E5DEC9] shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-[#1C1917]">Status Sinkronisasi</h1>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
              isOnline
                ? 'bg-[#E3EFE8] text-[#1E402F]'
                : 'bg-[#FDF3DC] text-[#7A520B]'
            }`}
          >
            {isOnline ? 'Terhubung (Online)' : 'Mode Offline'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3 rounded-xl bg-[#FDF3DC] border border-[#EDD295]">
            <p className="text-[11px] font-semibold text-[#7A520B]">Menunggu Sinkron</p>
            <p
              data-testid="sync-pending-count"
              className="text-xl font-extrabold font-serif tabular-nums text-[#7A520B] mt-0.5"
            >
              {syncStatus.pendingCount}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F9E6DF] border border-[#E8BFB0]">
            <p className="text-[11px] font-semibold text-[#9A3B1B]">Gagal / Ditolak</p>
            <p
              data-testid="sync-failed-count"
              className="text-xl font-extrabold text-[#9A3B1B] mt-0.5"
            >
              {syncStatus.failedCount + syncStatus.rejectedCount}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F3EDE2] border border-[#D8CEBE]">
            <p className="text-[11px] font-semibold text-[#6B635B]">Konflik Versi</p>
            <p
              data-testid="sync-conflict-count"
              className="text-xl font-extrabold text-[#1C1917] mt-0.5"
            >
              {syncStatus.conflictCount}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#F3EDE2] border border-[#D8CEBE]">
            <p className="text-[11px] font-semibold text-[#6B635B]">Struk Menunggu</p>
            <p
              data-testid="sync-receipt-pending-count"
              className="text-xl font-extrabold text-[#1C1917] mt-0.5"
            >
              {syncStatus.receiptPendingCount}
            </p>
          </div>
        </div>

        <div className="text-xs text-[#6B635B] bg-[#F3EDE2] p-2.5 rounded-xl border border-[#E5DEC9]">
          <p>
            <strong>Sinkronisasi berhasil terakhir:</strong>{' '}
            {syncStatus.lastSyncedAt
              ? new Date(syncStatus.lastSyncedAt).toLocaleString('id-ID')
              : 'Belum pernah (atau masih di perangkat lokal)'}
          </p>
        </div>

        {(lastSyncNotice || actionMessage) && (
          <div
            role="status"
            data-testid="sync-notice-banner"
            className="p-3 rounded-xl bg-[#F3EDE2] border border-[#D8CEBE] text-xs text-[#1C1917] font-medium"
          >
            {actionMessage || lastSyncNotice}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="sync-now-btn"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="w-full touch-target-48 rounded-xl bg-[#2E5A44] hover:bg-[#2E5A44] disabled:bg-slate-400 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isSyncing ? 'Sedang Menyinkronkan...' : 'Sinkronkan sekarang'}</span>
          </button>

          {(syncStatus.failedCount > 0 || syncStatus.receiptPendingCount > 0) && (
            <button
              type="button"
              data-testid="retry-failed-btn"
              onClick={handleRetryFailed}
              className="w-full touch-target-48 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center justify-center gap-2"
            >
              <CloudUpload className="w-4 h-4" aria-hidden="true" />
              <span>Coba lagi item yang gagal / tertunda</span>
            </button>
          )}
        </div>
      </section>

      {/* Interactive Conflict Resolution Section (Milestone 2.3) */}
      {conflictItems.length > 0 && (
        <section className="bg-[#FFFDF9] rounded-2xl p-4 border-2 border-purple-300 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-[#6B635B]">
            <AlertTriangle className="w-5 h-5 text-purple-700" aria-hidden="true" />
            <h2 className="text-sm font-bold">
              Penyelesaian Konflik Versi ({conflictItems.length})
            </h2>
          </div>
          <p className="text-xs text-[#6B635B]">
            Transaksi berikut diubah di perangkat lain sebelum perubahan di HP ini terkirim. Pilih versi mana yang ingin kamu simpan:
          </p>

          <div className="space-y-3">
            {conflictItems.map((op) => {
              const serverRec = op.conflict_server_record as TransactionRecord | null;
              const localAmt = Number(op.payload.amount_idr ?? 0);
              const localDesc = String(op.payload.description ?? '(Dihapus di HP ini)');

              return (
                <div
                  key={op.op_id}
                  data-testid={`conflict-card-${op.record_id}`}
                  className="p-3.5 rounded-xl bg-[#F3EDE2]/60 border border-[#D8CEBE] space-y-3"
                >
                  <p className="text-xs font-bold text-[#1C1917]">
                    {op.last_error || 'Konflik antara perubahan lokal dan data server'}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[#FFFDF9] p-2.5 rounded-lg border border-[#E5DEC9]">
                      <p className="font-bold text-[#1E402F] mb-1">Versi HP Kamu</p>
                      {op.kind === 'delete' ? (
                        <p className="text-red-600 font-semibold">Dihapus di HP ini</p>
                      ) : (
                        <>
                          <p className="font-bold">{formatRupiah(localAmt)}</p>
                          <p className="text-[#6B635B] truncate">{localDesc}</p>
                        </>
                      )}
                    </div>

                    <div className="bg-[#FFFDF9] p-2.5 rounded-lg border border-[#E5DEC9]">
                      <p className="font-bold text-blue-800 mb-1">Versi Server</p>
                      {!serverRec || serverRec.deleted_at !== null ? (
                        <p className="text-red-600 font-semibold">Dihapus di Server</p>
                      ) : (
                        <>
                          <p className="font-bold">{formatRupiah(serverRec.amount_idr)}</p>
                          <p className="text-[#6B635B] truncate">{serverRec.description}</p>
                        </>
                      )}
                    </div>
                  </div>

                  {editingConflictOpId === op.op_id ? (
                    <div className="bg-[#FFFDF9] p-3 rounded-xl border border-purple-300 space-y-2">
                      <div>
                        <label className="block text-[11px] font-bold text-[#6B635B] mb-1">
                          Nominal Gabungan (IDR)
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={customAmountStr}
                          onChange={(e) => setCustomAmountStr(e.target.value)}
                          className="w-full touch-target-48 px-3 py-2 rounded-lg border border-[#D8CEBE] text-xs font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#6B635B] mb-1">
                          Deskripsi Gabungan
                        </label>
                        <input
                          type="text"
                          value={customDescription}
                          onChange={(e) => setCustomDescription(e.target.value)}
                          className="w-full touch-target-48 px-3 py-2 rounded-lg border border-[#D8CEBE] text-xs"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleResolveConflict(op, 'custom_edit')}
                          className="flex-1 touch-target-48 rounded-lg bg-[#2E5A44] text-white text-xs font-bold"
                        >
                          Simpan Hasil Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingConflictOpId(null)}
                          className="touch-target-48 px-3 rounded-lg bg-[#F3EDE2] text-[#6B635B] text-xs font-semibold"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-1.5">
                      <button
                        type="button"
                        data-testid={`resolve-keep-local-${op.record_id}`}
                        onClick={() => void handleResolveConflict(op, 'keep_local')}
                        className="touch-target-48 rounded-xl bg-[#2E5A44] hover:bg-[#2E5A44] text-white text-xs font-bold"
                      >
                        Pertahankan Versi HP Ini
                      </button>
                      <button
                        type="button"
                        data-testid={`resolve-keep-server-${op.record_id}`}
                        onClick={() => void handleResolveConflict(op, 'keep_server')}
                        className="touch-target-48 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                      >
                        Gunakan Versi Server
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingConflictOpId(op.op_id);
                          setCustomAmountStr(String(localAmt || serverRec?.amount_idr || 25000));
                          setCustomDescription(
                            String(op.payload.description ?? serverRec?.description ?? '')
                          );
                        }}
                        className="touch-target-48 rounded-xl bg-[#FFFDF9] border border-purple-300 text-[#6B635B] text-xs font-bold"
                      >
                        Edit & Gabungkan Manual
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Failed / Rejected Items Detail */}
      {failedOrRejectedItems.length > 0 && (
        <section className="bg-[#FFFDF9] rounded-2xl p-4 border border-[#E8BFB0] shadow-sm space-y-2.5">
          <h2 className="text-sm font-bold text-[#9A3B1B]">
            Daftar Operasi Gagal / Ditolak ({failedOrRejectedItems.length})
          </h2>
          <ul className="space-y-2">
            {failedOrRejectedItems.map((item) => (
              <li
                key={item.op_id}
                className="p-3 rounded-xl bg-[#F9E6DF] border border-[#E8BFB0] text-xs space-y-1"
              >
                <p className="font-bold text-[#9A3B1B]">
                  Operasi {item.kind.toUpperCase()} — Status: {item.status}
                </p>
                <p className="text-red-800">{item.last_error}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Healthy Empty Queue State */}
      {queueItems.length === 0 && (
        <section className="bg-[#FFFDF9] rounded-2xl p-5 border border-[#E5DEC9] text-center space-y-2">
          <CheckCircle2 className="w-8 h-8 text-[#2E5A44] mx-auto" aria-hidden="true" />
          <p className="text-sm font-bold text-[#1C1917]">
            Semua Catatan Tersinkron
          </p>
          <p className="text-xs text-[#6B635B]">
            Tidak ada antrean perubahan atau konflik yang menunggu saat ini.
          </p>
        </section>
      )}
    </div>
  );
}
