/**
 * DompetHarian — Local-First Transaction & Category Repository (Milestone 2.2)
 * Implements TransactionRepository against IndexedDB (Dexie.js).
 * Every read and write is strictly scoped by userId and enqueues sync operations atomically.
 * Author / Credit: Aravajordan
 */

import type {
  CreateTransactionInput,
  LocalCategoryRecord,
  LocalTransactionRecord,
  TransactionFilter,
  TransactionKind,
  TransactionRepository,
  UpdateTransactionInput,
} from '@/lib/database/types';
import { localDb, type SyncQueueItem, type UserSyncMeta } from '@/lib/sync/dexie-db';
import {
  AuthorizationError,
  DomainValidationError,
  TransactionDomainService,
  assertRecordOwnership,
  generateUuidV4,
} from '@/features/transactions/transaction-domain';
import { buildDefaultCategoriesForUser } from '@/features/categories/default-categories';
import { createCategorySchema } from '@/lib/validation/schemas';

export class LocalFirstTransactionRepository implements TransactionRepository {
  public async ensureUserInitialized(userId: string): Promise<UserSyncMeta> {
    if (!userId) {
      throw new AuthorizationError('Sesi pengguna diperlukan.');
    }

    let meta = await localDb.syncMeta.get(userId);
    if (!meta) {
      meta = {
        user_id: userId,
        client_id: `android_${generateUuidV4().slice(0, 8)}`,
        last_pulled_seq: 0,
        last_synced_at: null,
        initial_pull_completed: false,
        storage_persisted: false,
      };
      await localDb.syncMeta.put(meta);
    }

    const catCount = await localDb.categories.where('user_id').equals(userId).count();
    if (catCount === 0) {
      const defaults = buildDefaultCategoriesForUser(userId);
      await localDb.categories.bulkPut(defaults);
    }

    return meta;
  }

  public async listTransactions(
    userId: string,
    filter?: TransactionFilter
  ): Promise<LocalTransactionRecord[]> {
    if (!userId) throw new AuthorizationError();
    await this.ensureUserInitialized(userId);

    const userRecords = await localDb.transactions.where('user_id').equals(userId).toArray();
    return TransactionDomainService.filterAndSortTransactions(userRecords, filter);
  }

  public async getTransactionById(
    userId: string,
    id: string
  ): Promise<LocalTransactionRecord | null> {
    if (!userId) throw new AuthorizationError();
    const record = await localDb.transactions.get(id);
    if (!record) return null;
    assertRecordOwnership(userId, record.user_id);
    if (record.deleted_at !== null) return null;
    return record;
  }

  public async createTransaction(
    userId: string,
    input: CreateTransactionInput
  ): Promise<LocalTransactionRecord> {
    const meta = await this.ensureUserInitialized(userId);
    const nowIso = new Date().toISOString();
    const newTx = TransactionDomainService.buildNewTransaction(userId, input, nowIso);

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'transaction',
      record_id: newTx.id,
      kind: 'create',
      base_version: 0,
      payload: {
        id: newTx.id,
        kind: newTx.kind,
        amount_idr: newTx.amount_idr,
        transaction_date: newTx.transaction_date,
        description: newTx.description,
        merchant: newTx.merchant,
        category_id: newTx.category_id,
        payment_method: newTx.payment_method,
        notes: newTx.notes,
        receipt_drive_file_id: newTx.receipt_drive_file_id,
        receipt_mime_type: newTx.receipt_mime_type,
        receipt_size_bytes: newTx.receipt_size_bytes,
        input_source: newTx.input_source,
        verification_status: newTx.verification_status,
        created_at: newTx.created_at,
      },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction(
      'rw',
      [localDb.transactions, localDb.categories, localDb.syncQueue],
      async () => {
        await localDb.transactions.put(newTx);
        await localDb.syncQueue.put(queueItem);

        // Bump category usage_count and last_used_at for smart Android 3-tap quick add
        const cat = await localDb.categories.get(newTx.category_id);
        if (cat && cat.user_id === userId) {
          await localDb.categories.update(cat.id, {
            usage_count: (cat.usage_count ?? 0) + 1,
            last_used_at: nowIso,
          });
        }
      }
    );

    return newTx;
  }

  public async updateTransaction(
    userId: string,
    id: string,
    input: UpdateTransactionInput
  ): Promise<LocalTransactionRecord> {
    const meta = await this.ensureUserInitialized(userId);
    const existing = await localDb.transactions.get(id);
    if (!existing || existing.deleted_at !== null) {
      throw new DomainValidationError('Transaksi tidak ditemukan.');
    }
    assertRecordOwnership(userId, existing.user_id);

    const nowIso = new Date().toISOString();
    const updatedTx = TransactionDomainService.applyTransactionUpdate(
      userId,
      existing,
      input,
      nowIso
    );

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'transaction',
      record_id: updatedTx.id,
      kind: 'update',
      base_version: existing.base_version,
      payload: {
        kind: updatedTx.kind,
        amount_idr: updatedTx.amount_idr,
        transaction_date: updatedTx.transaction_date,
        description: updatedTx.description,
        merchant: updatedTx.merchant,
        category_id: updatedTx.category_id,
        payment_method: updatedTx.payment_method,
        notes: updatedTx.notes,
        receipt_drive_file_id: updatedTx.receipt_drive_file_id,
        receipt_mime_type: updatedTx.receipt_mime_type,
        receipt_size_bytes: updatedTx.receipt_size_bytes,
        verification_status: updatedTx.verification_status,
      },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction('rw', [localDb.transactions, localDb.syncQueue], async () => {
      await localDb.transactions.put(updatedTx);
      await localDb.syncQueue.put(queueItem);
    });

    return updatedTx;
  }

  public async deleteTransaction(userId: string, id: string): Promise<void> {
    const meta = await this.ensureUserInitialized(userId);
    const existing = await localDb.transactions.get(id);
    if (!existing) return;
    assertRecordOwnership(userId, existing.user_id);

    const nowIso = new Date().toISOString();
    const tombstoned: LocalTransactionRecord = {
      ...existing,
      deleted_at: nowIso,
      updated_at: nowIso,
      sync_state: 'pending',
      last_error: null,
    };

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'transaction',
      record_id: id,
      kind: 'delete',
      base_version: existing.base_version,
      payload: { deleted_at: nowIso },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction(
      'rw',
      [localDb.transactions, localDb.syncQueue, localDb.receiptOutbox],
      async () => {
        await localDb.transactions.put(tombstoned);
        await localDb.syncQueue.put(queueItem);
        await localDb.receiptOutbox.delete(id);
      }
    );
  }

  /**
   * Lists categories for the user, sorted with recent and frequent categories first (Android 3-tap UX).
   */
  public async listCategories(
    userId: string,
    includeArchived = false
  ): Promise<LocalCategoryRecord[]> {
    await this.ensureUserInitialized(userId);
    const all = await localDb.categories.where('user_id').equals(userId).toArray();
    return all
      .filter((c) => c.deleted_at === null && (includeArchived || !c.is_archived))
      .sort((a, b) => {
        if (a.last_used_at && b.last_used_at && a.last_used_at !== b.last_used_at) {
          return b.last_used_at.localeCompare(a.last_used_at);
        }
        if (a.last_used_at && !b.last_used_at) return -1;
        if (!a.last_used_at && b.last_used_at) return 1;
        return (b.usage_count ?? 0) - (a.usage_count ?? 0);
      });
  }

  public async createCategory(
    userId: string,
    input: { name: string; kind: TransactionKind; icon?: string; color?: string }
  ): Promise<LocalCategoryRecord> {
    const meta = await this.ensureUserInitialized(userId);
    const parsed = createCategorySchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainValidationError(
        parsed.error.issues[0]?.message ?? 'Data kategori tidak valid.'
      );
    }

    const nowIso = new Date().toISOString();
    const id = `cat_${generateUuidV4()}`;
    const record: LocalCategoryRecord = {
      id,
      user_id: userId,
      name: parsed.data.name,
      kind: parsed.data.kind,
      icon: parsed.data.icon,
      color: parsed.data.color,
      is_default: false,
      is_archived: false,
      usage_count: 1,
      version: 1,
      change_seq: 0,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      sync_state: 'pending',
      base_version: 0,
      last_used_at: nowIso,
    };

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'category',
      record_id: id,
      kind: 'create',
      base_version: 0,
      payload: {
        name: record.name,
        kind: record.kind,
        icon: record.icon,
        color: record.color,
        is_default: false,
        is_archived: false,
        usage_count: 1,
      },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction('rw', [localDb.categories, localDb.syncQueue], async () => {
      await localDb.categories.put(record);
      await localDb.syncQueue.put(queueItem);
    });

    return record;
  }

  public async renameCategory(
    userId: string,
    categoryId: string,
    newName: string
  ): Promise<LocalCategoryRecord> {
    const meta = await this.ensureUserInitialized(userId);
    const existing = await localDb.categories.get(categoryId);
    if (!existing) throw new DomainValidationError('Kategori tidak ditemukan.');
    assertRecordOwnership(userId, existing.user_id);

    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 60) {
      throw new DomainValidationError('Nama kategori harus antara 1 hingga 60 karakter.');
    }

    const nowIso = new Date().toISOString();
    const updated: LocalCategoryRecord = {
      ...existing,
      name: trimmed,
      updated_at: nowIso,
      sync_state: 'pending',
    };

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'category',
      record_id: categoryId,
      kind: 'update',
      base_version: existing.base_version,
      payload: { name: trimmed, is_archived: existing.is_archived },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction('rw', [localDb.categories, localDb.syncQueue], async () => {
      await localDb.categories.put(updated);
      await localDb.syncQueue.put(queueItem);
    });

    return updated;
  }

  /**
   * PRD Section 4: Categories used by transactions are never permanently deleted, only archived.
   */
  public async archiveCategory(
    userId: string,
    categoryId: string,
    archived: boolean
  ): Promise<LocalCategoryRecord> {
    const meta = await this.ensureUserInitialized(userId);
    const existing = await localDb.categories.get(categoryId);
    if (!existing) throw new DomainValidationError('Kategori tidak ditemukan.');
    assertRecordOwnership(userId, existing.user_id);

    const nowIso = new Date().toISOString();
    const updated: LocalCategoryRecord = {
      ...existing,
      is_archived: archived,
      updated_at: nowIso,
      sync_state: 'pending',
    };

    const queueItem: SyncQueueItem = {
      op_id: generateUuidV4(),
      user_id: userId,
      client_id: meta.client_id,
      record_type: 'category',
      record_id: categoryId,
      kind: 'update',
      base_version: existing.base_version,
      payload: { name: existing.name, is_archived: archived },
      status: 'pending',
      retry_count: 0,
      next_retry_at_ms: 0,
      last_error: null,
      conflict_server_record: null,
      created_at_ms: Date.now(),
    };

    await localDb.transaction('rw', [localDb.categories, localDb.syncQueue], async () => {
      await localDb.categories.put(updated);
      await localDb.syncQueue.put(queueItem);
    });

    return updated;
  }
}

export const localRepository = new LocalFirstTransactionRepository();
