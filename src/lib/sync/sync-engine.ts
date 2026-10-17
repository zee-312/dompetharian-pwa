/**
 * DompetHarian — Offline-First Sync Engine (Milestone 2.3 & 2.4)
 * Implements the formal Sync Contract (docs/SYNC_CONTRACT.md):
 * - FIFO push ordering per record
 * - Idempotent op_id tracking
 * - Optimistic concurrency conflict detection (never silently overwrites or drops local edits)
 * - Conflict resolution actions in Indonesian (keep_local, keep_server, custom_edit)
 * - Exponential backoff with jitter and MAX_RETRY_COUNT = 5 cap
 * - Incremental cursor-based pull with initial full history pagination
 * Author / Credit: Aravajordan
 */

import type {
  LocalCategoryRecord,
  LocalTransactionRecord,
  SyncOperationResult,
  SyncPullResponse,
  SyncPushOperation,
  TransactionRecord,
  UpdateTransactionInput,
} from '@/lib/database/types';
import { localDb, type SyncQueueItem } from '@/lib/sync/dexie-db';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import { generateUuidV4 } from '@/features/transactions/transaction-domain';
import { SafeLogger } from '@/lib/security/logger';
import { AuthService } from '@/features/auth/auth-service';

export const MAX_RETRY_COUNT = 5;

export interface SyncTransport {
  push(userId: string, clientId: string, operations: SyncPushOperation[]): Promise<SyncOperationResult[]>;
  pull(userId: string, afterSeq: number, limit: number): Promise<SyncPullResponse>;
}

/**
 * Default HTTP transport calling /api/sync/push and /api/sync/pull.
 */
export const httpSyncTransport: SyncTransport = {
  async push(userId, clientId, operations) {
    const session = AuthService.getLocalSession();
    const res = await fetch('/api/sync/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
        ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: JSON.stringify({ client_id: clientId, operations }),
    });
    if (res.status === 401 || res.status === 403) {
      AuthService.markSessionRequiresReauth();
      throw new Error('AUTH_EXPIRED: Sesi login kedaluwarsa. Silakan login kembali untuk melanjutkan sinkronisasi.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error || `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { results: SyncOperationResult[] };
    return data.results;
  },

  async pull(userId, afterSeq, limit) {
    const session = AuthService.getLocalSession();
    const res = await fetch(
      `/api/sync/pull?after_seq=${encodeURIComponent(String(afterSeq))}&limit=${encodeURIComponent(String(limit))}`,
      {
        method: 'GET',
        headers: {
          'x-user-id': userId,
          ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        },
      }
    );
    if (res.status === 401 || res.status === 403) {
      AuthService.markSessionRequiresReauth();
      throw new Error('AUTH_EXPIRED: Sesi login kedaluwarsa. Silakan login kembali.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error || `HTTP ${res.status}`);
    }
    return (await res.json()) as SyncPullResponse;
  },
};

/**
 * Computes exponential backoff delay with jitter: min(300_000, 1000 * 2^retryCount) + random(0..500)
 */
export function computeBackoffDelayMs(retryCount: number, randomFn: () => number = Math.random): number {
  const exp = Math.min(300_000, 1000 * Math.pow(2, Math.max(0, retryCount)));
  const jitter = Math.floor(randomFn() * 500);
  return exp + jitter;
}

export interface SyncStatusSummary {
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  rejectedCount: number;
  receiptPendingCount: number;
  lastSyncedAt: string | null;
  initialPullCompleted: boolean;
  isDataPotentiallyIncomplete: boolean;
}

export interface SyncRunOutcome {
  pushedCount: number;
  appliedCount: number;
  conflictCount: number;
  failedCount: number;
  rejectedCount: number;
  pulledCount: number;
  error: string | null;
}

export class SyncEngine {
  private isRunning = false;

  constructor(private transport: SyncTransport = httpSyncTransport) {}

  public setTransport(transport: SyncTransport): void {
    this.transport = transport;
  }

  public async getSyncStatusSummary(userId: string): Promise<SyncStatusSummary> {
    if (!userId) {
      return {
        pendingCount: 0,
        failedCount: 0,
        conflictCount: 0,
        rejectedCount: 0,
        receiptPendingCount: 0,
        lastSyncedAt: null,
        initialPullCompleted: false,
        isDataPotentiallyIncomplete: true,
      };
    }

    const meta = await localRepository.ensureUserInitialized(userId);
    const queueItems = await localDb.syncQueue.where('user_id').equals(userId).toArray();
    const receiptItems = await localDb.receiptOutbox.where('user_id').equals(userId).toArray();

    let pendingCount = 0;
    let failedCount = 0;
    let conflictCount = 0;
    let rejectedCount = 0;

    for (const item of queueItems) {
      if (item.status === 'pending' || item.status === 'in_flight') pendingCount++;
      else if (item.status === 'failed') failedCount++;
      else if (item.status === 'conflict') conflictCount++;
      else if (item.status === 'rejected') rejectedCount++;
    }

    const isDataPotentiallyIncomplete =
      !meta.initial_pull_completed || conflictCount > 0 || failedCount > 0;

    return {
      pendingCount,
      failedCount,
      conflictCount,
      rejectedCount,
      receiptPendingCount: receiptItems.length,
      lastSyncedAt: meta.last_synced_at,
      initialPullCompleted: meta.initial_pull_completed,
      isDataPotentiallyIncomplete,
    };
  }

  /**
   * Executes a full synchronization cycle (Push pending operations in FIFO order, then Pull incremental changes).
   */
  public async syncNow(
    userId: string,
    options: { ignoreBackoffWindow?: boolean; nowMs?: number } = {}
  ): Promise<SyncRunOutcome> {
    if (!userId) {
      return {
        pushedCount: 0,
        appliedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        rejectedCount: 0,
        pulledCount: 0,
        error: 'Sesi pengguna tidak ditemukan.',
      };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return {
        pushedCount: 0,
        appliedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        rejectedCount: 0,
        pulledCount: 0,
        error: 'Kamu sedang offline. Sinkronisasi akan dilanjutkan saat internet aktif.',
      };
    }

    if (this.isRunning) {
      return {
        pushedCount: 0,
        appliedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        rejectedCount: 0,
        pulledCount: 0,
        error: null,
      };
    }

    this.isRunning = true;
    const nowMs = options.nowMs ?? Date.now();

    try {
      const meta = await localRepository.ensureUserInitialized(userId);
      const allQueue = await localDb.syncQueue.where('user_id').equals(userId).toArray();
      allQueue.sort((a, b) => a.created_at_ms - b.created_at_ms);

      // Identify records that currently have a conflict or rejected operation blocking subsequent ops for that same record
      const blockedRecordIds = new Set<string>();
      const eligibleOps: SyncQueueItem[] = [];

      for (const item of allQueue) {
        if (item.status === 'conflict' || item.status === 'rejected') {
          blockedRecordIds.add(item.record_id);
          continue;
        }
        if (item.status === 'failed' && !options.ignoreBackoffWindow) {
          blockedRecordIds.add(item.record_id);
          continue;
        }
        if (blockedRecordIds.has(item.record_id)) {
          continue;
        }
        if (!options.ignoreBackoffWindow && item.next_retry_at_ms > nowMs) {
          blockedRecordIds.add(item.record_id);
          continue;
        }
        eligibleOps.push(item);
      }

      let appliedCount = 0;
      let conflictCount = 0;
      let failedCount = 0;
      let rejectedCount = 0;

      if (eligibleOps.length > 0) {
        const pushPayload: SyncPushOperation[] = eligibleOps.map((item) => ({
          op_id: item.op_id,
          client_id: item.client_id,
          record_type: item.record_type,
          record_id: item.record_id,
          kind: item.kind,
          base_version: item.base_version,
          created_at_ms: item.created_at_ms,
          payload: item.payload,
        }));

        try {
          const results = await this.transport.push(userId, meta.client_id, pushPayload);
          const resultByOpId = new Map<string, SyncOperationResult>();
          for (const r of results) {
            resultByOpId.set(r.op_id, r);
          }

          for (const item of eligibleOps) {
            const res = resultByOpId.get(item.op_id);
            if (!res) continue;

            if (res.status === 'applied' || res.status === 'duplicate') {
              appliedCount++;
              await this.handleAppliedOrDuplicate(userId, item, res);
            } else if (res.status === 'conflict') {
              conflictCount++;
              await this.handleConflict(userId, item, res);
            } else if (res.status === 'rejected') {
              rejectedCount++;
              await this.handleRejected(userId, item, res);
            }
          }
        } catch (pushErr) {
          // Network/transport failure: increment retry_count with exponential backoff & jitter, cap at MAX_RETRY_COUNT
          const errMessage =
            pushErr instanceof Error
              ? pushErr.message
              : 'Gagal menghubungi server sinkronisasi.';

          for (const item of eligibleOps) {
            const nextRetryCount = item.retry_count + 1;
            const reachedCap = nextRetryCount >= MAX_RETRY_COUNT;
            const delayMs = computeBackoffDelayMs(nextRetryCount);
            const newStatus = reachedCap ? 'failed' : 'pending';
            if (reachedCap) failedCount++;

            await localDb.syncQueue.update(item.op_id, {
              retry_count: nextRetryCount,
              status: newStatus,
              next_retry_at_ms: nowMs + delayMs,
              last_error: reachedCap
                ? `Gagal sinkronisasi setelah ${MAX_RETRY_COUNT} percobaan: ${errMessage}`
                : `Menunggu percobaan ulang (${nextRetryCount}/${MAX_RETRY_COUNT}): ${errMessage}`,
            });

            if (item.record_type === 'transaction') {
              await localDb.transactions.update(item.record_id, {
                sync_state: reachedCap ? 'failed' : 'pending',
                last_error: errMessage,
              });
            }
          }

          SafeLogger.warn('Push batch network failure handled with backoff', {
            userId,
            eligibleCount: eligibleOps.length,
          });

          return {
            pushedCount: eligibleOps.length,
            appliedCount,
            conflictCount,
            failedCount,
            rejectedCount,
            pulledCount: 0,
            error: errMessage,
          };
        }
      }

      // Now Pull changes in pages using server monotonic change_seq cursor
      let pulledCount = 0;
      let cursor = meta.last_pulled_seq;
      let hasMore = true;
      let pageGuard = 0;

      while (hasMore && pageGuard < 25) {
        pageGuard++;
        const pullRes = await this.transport.pull(userId, cursor, 100);
        pulledCount += pullRes.transactions.length;
        await this.applyPulledChanges(userId, pullRes);
        cursor = pullRes.next_cursor_seq;
        hasMore = pullRes.has_more;
      }

      const syncedIso = new Date().toISOString();
      await localDb.syncMeta.update(userId, {
        last_pulled_seq: cursor,
        last_synced_at: syncedIso,
        initial_pull_completed: true,
      });

      return {
        pushedCount: eligibleOps.length,
        appliedCount,
        conflictCount,
        failedCount,
        rejectedCount,
        pulledCount,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menjalankan sinkronisasi.';
      SafeLogger.error('syncNow error', err, { userId });
      return {
        pushedCount: 0,
        appliedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        rejectedCount: 0,
        pulledCount: 0,
        error: msg,
      };
    } finally {
      this.isRunning = false;
    }
  }

  private async handleAppliedOrDuplicate(
    userId: string,
    item: SyncQueueItem,
    res: SyncOperationResult
  ): Promise<void> {
    await localDb.syncQueue.delete(item.op_id);

    // Check if there are still subsequent queued operations for the same record_id
    const remainingForRecord = await localDb.syncQueue
      .where('[user_id+record_id]')
      .equals([userId, item.record_id])
      .count();

    const serverVersion = res.server_version ?? item.base_version + 1;

    // Update base_version of the next queued operation for the same record if one exists
    if (remainingForRecord > 0) {
      const nextOps = await localDb.syncQueue
        .where('[user_id+record_id]')
        .equals([userId, item.record_id])
        .sortBy('created_at_ms');
      const nextOp = nextOps[0];
      if (nextOp && nextOp.base_version === item.base_version) {
        await localDb.syncQueue.update(nextOp.op_id, {
          base_version: serverVersion,
        });
      }
    }

    if (item.record_type === 'transaction') {
      const localTx = await localDb.transactions.get(item.record_id);
      if (!localTx || localTx.user_id !== userId) return;

      if (item.kind === 'delete' && remainingForRecord === 0) {
        await localDb.transactions.delete(item.record_id);
        return;
      }

      const serverTx = res.server_record as TransactionRecord | null;
      await localDb.transactions.update(item.record_id, {
        version: serverVersion,
        base_version: serverVersion,
        change_seq: res.change_seq ?? localTx.change_seq,
        sync_state: remainingForRecord === 0 ? 'synced' : 'pending',
        last_error: null,
        updated_at: serverTx?.updated_at ?? localTx.updated_at,
      });
    } else if (item.record_type === 'category') {
      const localCat = await localDb.categories.get(item.record_id);
      if (!localCat || localCat.user_id !== userId) return;
      await localDb.categories.update(item.record_id, {
        version: serverVersion,
        base_version: serverVersion,
        change_seq: res.change_seq ?? localCat.change_seq,
        sync_state: remainingForRecord === 0 ? 'synced' : 'pending',
      });
    }
  }

  private async handleConflict(
    userId: string,
    item: SyncQueueItem,
    res: SyncOperationResult
  ): Promise<void> {
    const conflictReason =
      res.reason ?? 'Konflik versi terdeteksi: data di server telah berubah dari perangkat lain.';

    await localDb.syncQueue.update(item.op_id, {
      status: 'conflict',
      last_error: conflictReason,
      conflict_server_record: res.server_record ?? null,
    });

    if (item.record_type === 'transaction') {
      await localDb.transactions.update(item.record_id, {
        sync_state: 'conflict',
        last_error: conflictReason,
      });
    }
  }

  private async handleRejected(
    userId: string,
    item: SyncQueueItem,
    res: SyncOperationResult
  ): Promise<void> {
    const rejectReason = res.reason ?? 'Operasi ditolak oleh validasi server.';
    await localDb.syncQueue.update(item.op_id, {
      status: 'rejected',
      last_error: rejectReason,
      conflict_server_record: res.server_record ?? null,
    });

    if (item.record_type === 'transaction') {
      await localDb.transactions.update(item.record_id, {
        sync_state: 'failed',
        last_error: rejectReason,
      });
    }
  }

  private async applyPulledChanges(userId: string, pullRes: SyncPullResponse): Promise<void> {
    // Merge categories
    for (const serverCat of pullRes.categories) {
      if (serverCat.user_id !== userId) continue;
      const pendingOps = await localDb.syncQueue
        .where('[user_id+record_id]')
        .equals([userId, serverCat.id])
        .count();
      if (pendingOps > 0) continue;

      const existing = await localDb.categories.get(serverCat.id);
      const merged: LocalCategoryRecord = {
        ...serverCat,
        sync_state: 'synced',
        base_version: serverCat.version,
        last_used_at: existing?.last_used_at ?? null,
      };
      await localDb.categories.put(merged);
    }

    // Merge transactions (never overwrite unpushed local changes)
    for (const serverTx of pullRes.transactions) {
      if (serverTx.user_id !== userId) continue;
      const pendingOps = await localDb.syncQueue
        .where('[user_id+record_id]')
        .equals([userId, serverTx.id])
        .count();

      if (pendingOps > 0) {
        // Do NOT clobber local pending/conflicted edits; Push handles optimistic concurrency
        continue;
      }

      if (serverTx.deleted_at !== null) {
        await localDb.transactions.delete(serverTx.id);
      } else {
        const existing = await localDb.transactions.get(serverTx.id);
        const merged: LocalTransactionRecord = {
          ...serverTx,
          sync_state: 'synced',
          last_error: null,
          base_version: serverTx.version,
          has_pending_receipt_upload: existing?.has_pending_receipt_upload ?? false,
        };
        await localDb.transactions.put(merged);
      }
    }
  }

  /**
   * Manual "Coba lagi" action for failed or rejected operations.
   * Resets retry_count to 0 and immediately triggers syncNow.
   */
  public async retryFailedOperations(userId: string): Promise<SyncRunOutcome> {
    const queue = await localDb.syncQueue.where('user_id').equals(userId).toArray();
    for (const item of queue) {
      if (item.status === 'failed' || item.status === 'pending') {
        await localDb.syncQueue.update(item.op_id, {
          status: 'pending',
          retry_count: 0,
          next_retry_at_ms: 0,
          last_error: null,
        });
        if (item.record_type === 'transaction') {
          await localDb.transactions.update(item.record_id, {
            sync_state: 'pending',
            last_error: null,
          });
        }
      }
    }
    return this.syncNow(userId, { ignoreBackoffWindow: true });
  }

  /**
   * Resolves a sync conflict per Milestone 2.3:
   * - 'keep_local': Re-queues local state anchored on server_record.version
   * - 'keep_server': Adopts server_record and clears conflicted local operation
   * - 'custom_edit': Saves user-edited fields anchored on server_record.version
   */
  public async resolveConflict(
    userId: string,
    opId: string,
    resolution: 'keep_local' | 'keep_server' | 'custom_edit',
    customPatch?: UpdateTransactionInput
  ): Promise<void> {
    const item = await localDb.syncQueue.get(opId);
    if (!item || item.user_id !== userId) return;

    const serverRec = item.conflict_server_record as TransactionRecord | null;
    const serverVersion = serverRec?.version ?? item.base_version + 1;
    const serverDeleted = serverRec?.deleted_at !== null && serverRec?.deleted_at !== undefined;

    if (resolution === 'keep_server') {
      // Remove all queued ops for this record and adopt server version
      await localDb.syncQueue
        .where('[user_id+record_id]')
        .equals([userId, item.record_id])
        .delete();

      if (!serverRec || serverDeleted) {
        await localDb.transactions.delete(item.record_id);
      } else {
        await localDb.transactions.put({
          ...serverRec,
          sync_state: 'synced',
          last_error: null,
          base_version: serverRec.version,
          has_pending_receipt_upload: false,
        });
      }
      return;
    }

    const localTx = await localDb.transactions.get(item.record_id);
    await localDb.syncQueue.delete(opId);

    // If the user originally intended a delete and chooses keep_local:
    if (item.kind === 'delete' && resolution === 'keep_local') {
      if (serverDeleted) {
        await localDb.transactions.delete(item.record_id);
        return;
      }
      await localDb.syncQueue.put({
        ...item,
        op_id: generateUuidV4(),
        base_version: serverVersion,
        status: 'pending',
        retry_count: 0,
        next_retry_at_ms: 0,
        last_error: null,
        conflict_server_record: null,
        created_at_ms: Date.now(),
      });
      return;
    }

    if (!localTx) return;
    const nowIso = new Date().toISOString();
    const mergedTx: LocalTransactionRecord = {
      ...localTx,
      ...(customPatch ?? {}),
      deleted_at: null,
      updated_at: nowIso,
      base_version: serverVersion,
      version: serverVersion,
      sync_state: 'pending',
      last_error: null,
    };

    // If server had deleted the record, re-create with a new op or update against serverVersion
    const nextKind = serverDeleted ? 'create' : 'update';
    const nextId = serverDeleted ? generateUuidV4() : mergedTx.id;
    if (serverDeleted) {
      await localDb.transactions.delete(mergedTx.id);
      mergedTx.id = nextId;
      mergedTx.base_version = 0;
    }

    await localDb.transactions.put(mergedTx);
    await localDb.syncQueue.put({
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: item.client_id,
      record_type: 'transaction',
      record_id: mergedTx.id,
      kind: nextKind,
      base_version: serverDeleted ? 0 : serverVersion,
      payload: {
        id: mergedTx.id,
        kind: mergedTx.kind,
        amount_idr: mergedTx.amount_idr,
        transaction_date: mergedTx.transaction_date,
        description: mergedTx.description,
        merchant: mergedTx.merchant,
        category_id: mergedTx.category_id,
        payment_method: mergedTx.payment_method,
        notes: mergedTx.notes,
        receipt_drive_file_id: mergedTx.receipt_drive_file_id,
        receipt_mime_type: mergedTx.receipt_mime_type,
        receipt_size_bytes: mergedTx.receipt_size_bytes,
        input_source: mergedTx.input_source,
        verification_status: mergedTx.verification_status,
      },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    });
  }
}

export const syncEngine = new SyncEngine();
