/**
 * DompetHarian — Authoritative Server Sync & RLS Database Store
 * Implements the exact PostgreSQL schema semantics, RLS ownership checks,
 * per-user monotonic change_seq, tombstones (deleted_at), optimistic concurrency (version),
 * and per-user processed_operations idempotency table.
 * Author / Credit: Aravajordan
 */

import type {
  CategoryRecord,
  SyncOperationResult,
  SyncPullResponse,
  SyncPushOperation,
  TransactionRecord,
} from '@/lib/database/types';
import {
  AuthorizationError,
  assertRecordOwnership,
} from '@/features/transactions/transaction-domain';
import {
  buildDefaultCategoriesForUser,
  toServerCategoryRecord,
} from '@/features/categories/default-categories';
import { createTransactionSchema, updateTransactionSchema } from '@/lib/validation/schemas';

interface ProcessedOpRecord {
  user_id: string;
  op_id: string;
  client_id: string;
  record_id: string;
  kind: 'create' | 'update' | 'delete';
  result: SyncOperationResult;
  processed_at: string;
}

class DompetHarianServerStore {
  private sequences = new Map<string, number>();
  private transactions = new Map<string, TransactionRecord>(); // key: tx.id
  private categories = new Map<string, CategoryRecord>(); // key: cat.id
  private processedOps = new Map<string, ProcessedOpRecord>(); // key: `${user_id}:${op_id}`

  public ensureUserInitialized(userId: string): void {
    if (!userId) throw new AuthorizationError();
    if (!this.sequences.has(userId)) {
      this.sequences.set(userId, 0);
      const defaults = buildDefaultCategoriesForUser(userId);
      for (const localCat of defaults) {
        const seq = this.nextSeq(userId);
        const serverCat: CategoryRecord = {
          ...toServerCategoryRecord(localCat),
          change_seq: seq,
        };
        this.categories.set(serverCat.id, serverCat);
      }
    }
  }

  private nextSeq(userId: string): number {
    const current = this.sequences.get(userId) ?? 0;
    const next = current + 1;
    this.sequences.set(userId, next);
    return next;
  }

  public getCurrentSeq(userId: string): number {
    this.ensureUserInitialized(userId);
    return this.sequences.get(userId) ?? 0;
  }

  /**
   * Simulates PostgreSQL RLS + explicit server-side ownership validation for reading a single transaction.
   */
  public getTransactionForUser(authenticatedUserId: string, txId: string): TransactionRecord | null {
    if (!authenticatedUserId) throw new AuthorizationError();
    const record = this.transactions.get(txId);
    if (!record) return null;
    assertRecordOwnership(authenticatedUserId, record.user_id);
    return { ...record };
  }

  public listActiveTransactionsForUser(authenticatedUserId: string): TransactionRecord[] {
    if (!authenticatedUserId) throw new AuthorizationError();
    this.ensureUserInitialized(authenticatedUserId);
    const out: TransactionRecord[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.user_id === authenticatedUserId && tx.deleted_at === null) {
        out.push({ ...tx });
      }
    }
    return out.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  }

  public listCategoriesForUser(authenticatedUserId: string): CategoryRecord[] {
    if (!authenticatedUserId) throw new AuthorizationError();
    this.ensureUserInitialized(authenticatedUserId);
    const out: CategoryRecord[] = [];
    for (const cat of this.categories.values()) {
      if (cat.user_id === authenticatedUserId && cat.deleted_at === null) {
        out.push({ ...cat });
      }
    }
    return out;
  }

  /**
   * Processes a batch of SyncPushOperations in strict sequential order per Sync Contract (docs/SYNC_CONTRACT.md).
   */
  public processPushBatch(
    authenticatedUserId: string,
    operations: readonly SyncPushOperation[]
  ): SyncOperationResult[] {
    if (!authenticatedUserId) {
      throw new AuthorizationError('Otentikasi diperlukan untuk sinkronisasi.');
    }
    this.ensureUserInitialized(authenticatedUserId);

    const results: SyncOperationResult[] = [];
    for (const op of operations) {
      const res = this.processSinglePushOp(authenticatedUserId, op);
      results.push(res);
    }
    return results;
  }

  private processSinglePushOp(
    userId: string,
    op: SyncPushOperation
  ): SyncOperationResult {
    const opKey = `${userId}:${op.op_id}`;
    const alreadyProcessed = this.processedOps.get(opKey);
    if (alreadyProcessed) {
      // Idempotent retry of same op_id: return identical result with status 'duplicate' if originally applied
      const currentServerRec =
        op.record_type === 'category'
          ? this.categories.get(op.record_id) ?? alreadyProcessed.result.server_record
          : this.transactions.get(op.record_id) ?? alreadyProcessed.result.server_record;

      return {
        ...alreadyProcessed.result,
        status:
          alreadyProcessed.result.status === 'applied'
            ? 'duplicate'
            : alreadyProcessed.result.status,
        server_record: currentServerRec ? { ...currentServerRec } : null,
      };
    }

    if (op.record_type === 'category') {
      return this.processCategoryOp(userId, op, opKey);
    }

    return this.processTransactionOp(userId, op, opKey);
  }

  private recordAndReturn(
    userId: string,
    op: SyncPushOperation,
    opKey: string,
    result: SyncOperationResult
  ): SyncOperationResult {
    this.processedOps.set(opKey, {
      user_id: userId,
      op_id: op.op_id,
      client_id: op.client_id,
      record_id: op.record_id,
      kind: op.kind,
      result,
      processed_at: new Date().toISOString(),
    });
    return result;
  }

  private processTransactionOp(
    userId: string,
    op: SyncPushOperation,
    opKey: string
  ): SyncOperationResult {
    const existing = this.transactions.get(op.record_id);

    // Cross-user collision / tampering check (RLS + server ownership enforcement)
    if (existing && existing.user_id !== userId) {
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: op.record_id,
        status: 'rejected',
        server_version: null,
        change_seq: null,
        server_record: null,
        reason: 'Akses ditolak: Transaksi dimiliki oleh pengguna lain.',
      });
    }

    const nowIso = new Date().toISOString();

    if (op.kind === 'create') {
      const parsed = createTransactionSchema.safeParse({
        ...op.payload,
        id: op.record_id,
      });
      if (!parsed.success) {
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'rejected',
          server_version: null,
          change_seq: null,
          server_record: null,
          reason: parsed.error.issues[0]?.message ?? 'Validasi transaksi gagal di server.',
        });
      }

      const data = parsed.data;
      if (existing) {
        // Idempotent create by client UUID if core fields match
        const isSameContent =
          existing.deleted_at === null &&
          existing.amount_idr === data.amount_idr &&
          existing.description === data.description &&
          existing.transaction_date === data.transaction_date &&
          existing.kind === data.kind;

        if (isSameContent) {
          return this.recordAndReturn(userId, op, opKey, {
            op_id: op.op_id,
            record_id: op.record_id,
            status: 'duplicate',
            server_version: existing.version,
            change_seq: existing.change_seq,
            server_record: { ...existing },
            reason: null,
          });
        }

        // Different content with same UUID on server -> conflict
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'conflict',
          server_version: existing.version,
          change_seq: existing.change_seq,
          server_record: { ...existing },
          reason: 'Transaksi dengan ID yang sama telah dimodifikasi di server.',
        });
      }

      const seq = this.nextSeq(userId);
      const created: TransactionRecord = {
        id: op.record_id,
        user_id: userId,
        kind: data.kind,
        amount_idr: data.amount_idr,
        transaction_date: data.transaction_date,
        description: data.description,
        merchant: data.merchant ?? null,
        category_id: data.category_id,
        payment_method: data.payment_method,
        notes: data.notes ?? null,
        receipt_drive_file_id: data.receipt_drive_file_id ?? null,
        receipt_mime_type: data.receipt_mime_type ?? null,
        receipt_size_bytes: data.receipt_size_bytes ?? null,
        input_source: data.input_source,
        verification_status: data.verification_status,
        version: 1,
        change_seq: seq,
        created_at: (op.payload.created_at as string) || nowIso,
        updated_at: nowIso,
        deleted_at: null,
      };
      this.transactions.set(created.id, created);

      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: created.id,
        status: 'applied',
        server_version: 1,
        change_seq: seq,
        server_record: { ...created },
        reason: null,
      });
    }

    if (op.kind === 'update') {
      if (!existing) {
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'rejected',
          server_version: null,
          change_seq: null,
          server_record: null,
          reason: 'Transaksi tidak ditemukan di server.',
        });
      }

      const parsed = updateTransactionSchema.safeParse(op.payload);
      if (!parsed.success) {
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'rejected',
          server_version: existing.version,
          change_seq: existing.change_seq,
          server_record: { ...existing },
          reason: parsed.error.issues[0]?.message ?? 'Pembaruan transaksi tidak valid.',
        });
      }

      // Optimistic concurrency check: base_version must match server version and record must not be deleted
      if (existing.deleted_at !== null || existing.version !== op.base_version) {
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'conflict',
          server_version: existing.version,
          change_seq: existing.change_seq,
          server_record: { ...existing },
          reason:
            existing.deleted_at !== null
              ? 'Transaksi ini telah dihapus di perangkat lain.'
              : `Konflik versi: versi dasar lokal (${op.base_version}) berbeda dengan versi server (${existing.version}).`,
        });
      }

      const patch = parsed.data;
      const seq = this.nextSeq(userId);
      const nextVersion = existing.version + 1;
      const updated: TransactionRecord = {
        ...existing,
        kind: patch.kind ?? existing.kind,
        amount_idr: patch.amount_idr ?? existing.amount_idr,
        transaction_date: patch.transaction_date ?? existing.transaction_date,
        description: patch.description ?? existing.description,
        merchant: patch.merchant !== undefined ? patch.merchant : existing.merchant,
        category_id: patch.category_id ?? existing.category_id,
        payment_method: patch.payment_method ?? existing.payment_method,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
        receipt_drive_file_id:
          patch.receipt_drive_file_id !== undefined
            ? patch.receipt_drive_file_id
            : existing.receipt_drive_file_id,
        receipt_mime_type:
          patch.receipt_mime_type !== undefined
            ? patch.receipt_mime_type
            : existing.receipt_mime_type,
        receipt_size_bytes:
          patch.receipt_size_bytes !== undefined
            ? patch.receipt_size_bytes
            : existing.receipt_size_bytes,
        verification_status: patch.verification_status ?? existing.verification_status,
        version: nextVersion,
        change_seq: seq,
        updated_at: nowIso,
      };
      this.transactions.set(updated.id, updated);

      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: updated.id,
        status: 'applied',
        server_version: nextVersion,
        change_seq: seq,
        server_record: { ...updated },
        reason: null,
      });
    }

    // op.kind === 'delete'
    if (!existing) {
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: op.record_id,
        status: 'applied',
        server_version: null,
        change_seq: null,
        server_record: null,
        reason: null,
      });
    }

    if (existing.deleted_at !== null) {
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: op.record_id,
        status: 'duplicate',
        server_version: existing.version,
        change_seq: existing.change_seq,
        server_record: { ...existing },
        reason: null,
      });
    }

    // Delete vs Edit conflict check
    if (existing.version !== op.base_version) {
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: op.record_id,
        status: 'conflict',
        server_version: existing.version,
        change_seq: existing.change_seq,
        server_record: { ...existing },
        reason: `Konflik hapus vs ubah: transaksi telah diubah di perangkat lain (versi server ${existing.version}).`,
      });
    }

    const seq = this.nextSeq(userId);
    const nextVersion = existing.version + 1;
    const tombstoned: TransactionRecord = {
      ...existing,
      version: nextVersion,
      change_seq: seq,
      updated_at: nowIso,
      deleted_at: nowIso,
    };
    this.transactions.set(tombstoned.id, tombstoned);

    return this.recordAndReturn(userId, op, opKey, {
      op_id: op.op_id,
      record_id: tombstoned.id,
      status: 'applied',
      server_version: nextVersion,
      change_seq: seq,
      server_record: { ...tombstoned },
      reason: null,
    });
  }

  private processCategoryOp(
    userId: string,
    op: SyncPushOperation,
    opKey: string
  ): SyncOperationResult {
    const existing = this.categories.get(op.record_id);
    if (existing && existing.user_id !== userId) {
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: op.record_id,
        status: 'rejected',
        server_version: null,
        change_seq: null,
        server_record: null,
        reason: 'Akses ditolak: Kategori dimiliki oleh pengguna lain.',
      });
    }

    const nowIso = new Date().toISOString();
    const seq = this.nextSeq(userId);

    if (op.kind === 'create' || !existing) {
      const name = String(op.payload.name ?? '').trim();
      const kind = op.payload.kind === 'income' ? 'income' : 'expense';
      if (!name) {
        return this.recordAndReturn(userId, op, opKey, {
          op_id: op.op_id,
          record_id: op.record_id,
          status: 'rejected',
          server_version: null,
          change_seq: null,
          server_record: null,
          reason: 'Nama kategori wajib diisi.',
        });
      }
      const created: CategoryRecord = {
        id: op.record_id,
        user_id: userId,
        name,
        kind,
        icon: String(op.payload.icon ?? 'tag'),
        color: String(op.payload.color ?? '#10b981'),
        is_default: Boolean(op.payload.is_default),
        is_archived: Boolean(op.payload.is_archived),
        usage_count: Number(op.payload.usage_count ?? 0),
        version: 1,
        change_seq: seq,
        created_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      };
      this.categories.set(created.id, created);
      return this.recordAndReturn(userId, op, opKey, {
        op_id: op.op_id,
        record_id: created.id,
        status: 'applied',
        server_version: 1,
        change_seq: seq,
        server_record: { ...created },
        reason: null,
      });
    }

    const nextVersion = existing.version + 1;
    const updated: CategoryRecord = {
      ...existing,
      name: op.payload.name ? String(op.payload.name).trim() : existing.name,
      is_archived:
        op.payload.is_archived !== undefined
          ? Boolean(op.payload.is_archived)
          : existing.is_archived,
      version: nextVersion,
      change_seq: seq,
      updated_at: nowIso,
    };
    this.categories.set(updated.id, updated);

    return this.recordAndReturn(userId, op, opKey, {
      op_id: op.op_id,
      record_id: updated.id,
      status: 'applied',
      server_version: nextVersion,
      change_seq: seq,
      server_record: { ...updated },
      reason: null,
    });
  }

  /**
   * Pulls changes after `afterSeq` ordered by server change_seq ASC, including tombstones.
   */
  public pullChanges(
    authenticatedUserId: string,
    afterSeq = 0,
    limit = 100
  ): SyncPullResponse {
    if (!authenticatedUserId) {
      throw new AuthorizationError('Otentikasi diperlukan untuk menarik data sinkronisasi.');
    }
    this.ensureUserInitialized(authenticatedUserId);

    const safeLimit = Math.max(1, Math.min(500, limit));
    const userTxs: TransactionRecord[] = [];
    for (const tx of this.transactions.values()) {
      if (tx.user_id === authenticatedUserId && tx.change_seq > afterSeq) {
        userTxs.push({ ...tx });
      }
    }
    userTxs.sort((a, b) => a.change_seq - b.change_seq);

    const userCats: CategoryRecord[] = [];
    for (const cat of this.categories.values()) {
      if (cat.user_id === authenticatedUserId && cat.change_seq > afterSeq) {
        userCats.push({ ...cat });
      }
    }
    userCats.sort((a, b) => a.change_seq - b.change_seq);

    const pagedTxs = userTxs.slice(0, safeLimit);
    const hasMore = userTxs.length > safeLimit;

    let maxSeq = afterSeq;
    for (const tx of pagedTxs) {
      if (tx.change_seq > maxSeq) maxSeq = tx.change_seq;
    }
    if (!hasMore) {
      for (const cat of userCats) {
        if (cat.change_seq > maxSeq) maxSeq = cat.change_seq;
      }
    }

    return {
      transactions: pagedTxs,
      categories: userCats,
      next_cursor_seq: maxSeq,
      has_more: hasMore,
    };
  }

  /**
   * Permanently deletes all database records for a user (Account Deletion — Milestone 6).
   */
  public deleteAllUserData(authenticatedUserId: string, targetUserId: string): {
    deletedTransactions: number;
    deletedCategories: number;
    deletedProcessedOps: number;
  } {
    assertRecordOwnership(authenticatedUserId, targetUserId);
    let deletedTransactions = 0;
    let deletedCategories = 0;
    let deletedProcessedOps = 0;

    for (const [id, tx] of this.transactions.entries()) {
      if (tx.user_id === targetUserId) {
        this.transactions.delete(id);
        deletedTransactions++;
      }
    }
    for (const [id, cat] of this.categories.entries()) {
      if (cat.user_id === targetUserId) {
        this.categories.delete(id);
        deletedCategories++;
      }
    }
    for (const [key, op] of this.processedOps.entries()) {
      if (op.user_id === targetUserId) {
        this.processedOps.delete(key);
        deletedProcessedOps++;
      }
    }
    this.sequences.delete(targetUserId);

    return {
      deletedTransactions,
      deletedCategories,
      deletedProcessedOps,
    };
  }

  public resetForTests(): void {
    this.sequences.clear();
    this.transactions.clear();
    this.categories.clear();
    this.processedOps.clear();
  }
}

// Global singleton so Next.js API routes in the same process share state
const globalForServerStore = globalThis as unknown as {
  __dompetHarianServerStore?: DompetHarianServerStore;
};

export const serverStore =
  globalForServerStore.__dompetHarianServerStore ?? new DompetHarianServerStore();

if (!globalForServerStore.__dompetHarianServerStore) {
  globalForServerStore.__dompetHarianServerStore = serverStore;
}
