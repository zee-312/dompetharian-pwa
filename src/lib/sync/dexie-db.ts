/**
 * DompetHarian — Dexie.js IndexedDB Local Database (Milestone 2.2)
 * Strict per-user namespacing across all tables.
 * Versioned schema with migrations.
 * Author / Credit: Aravajordan
 */

import Dexie, { type Table } from 'dexie';
import type {
  CategoryRecord,
  LocalCategoryRecord,
  LocalTransactionRecord,
  SyncOperationKind,
  TransactionRecord,
} from '@/lib/database/types';

export type SyncQueueItemStatus = 'pending' | 'in_flight' | 'failed' | 'conflict' | 'rejected';

export interface SyncQueueItem {
  op_id: string;
  user_id: string;
  client_id: string;
  record_type: 'transaction' | 'category';
  record_id: string;
  kind: SyncOperationKind;
  base_version: number;
  payload: Record<string, unknown>;
  status: SyncQueueItemStatus;
  retry_count: number;
  next_retry_at_ms: number;
  last_error: string | null;
  conflict_server_record: TransactionRecord | CategoryRecord | null;
  created_at_ms: number;
}

export interface ReceiptOutboxItem {
  id: string; // matches transaction_id
  user_id: string;
  transaction_id: string;
  /** Compressed, EXIF/GPS-stripped JPEG bytes stored as Uint8Array for cross-env IndexedDB reliability */
  image_bytes: Uint8Array;
  mime_type: 'image/jpeg';
  size_bytes: number;
  /** Neutral random filename e.g. {uuid}.jpg — never contains merchant/amount/date */
  neutral_filename: string;
  status: 'queued' | 'uploading' | 'failed';
  retry_count: number;
  last_error: string | null;
  created_at: string;
}

export interface UserSyncMeta {
  user_id: string;
  client_id: string;
  last_pulled_seq: number;
  last_synced_at: string | null;
  initial_pull_completed: boolean;
  storage_persisted: boolean;
}

export class DompetHarianLocalDB extends Dexie {
  public transactions!: Table<LocalTransactionRecord, string>;
  public categories!: Table<LocalCategoryRecord, string>;
  public syncQueue!: Table<SyncQueueItem, string>;
  public receiptOutbox!: Table<ReceiptOutboxItem, string>;
  public syncMeta!: Table<UserSyncMeta, string>;

  constructor(dbName = 'DompetHarianLocalDB_v1') {
    super(dbName);

    // Schema Version 1: Initial tables scoped by user_id
    this.version(1).stores({
      transactions:
        'id, user_id, [user_id+transaction_date], [user_id+sync_state], [user_id+category_id], change_seq',
      categories: 'id, user_id, [user_id+kind], [user_id+is_archived], change_seq',
      syncQueue:
        'op_id, user_id, [user_id+status], [user_id+record_id], [user_id+created_at_ms]',
      receiptOutbox: 'id, user_id, [user_id+status], transaction_id',
      syncMeta: 'user_id',
    });

    // Schema Version 2: Add compound index for fast history sorting and receipt lookup
    this.version(2)
      .stores({
        transactions:
          'id, user_id, [user_id+transaction_date], [user_id+sync_state], [user_id+category_id], [user_id+deleted_at], change_seq',
        categories: 'id, user_id, [user_id+kind], [user_id+is_archived], change_seq',
        syncQueue:
          'op_id, user_id, [user_id+status], [user_id+record_id], [user_id+created_at_ms]',
        receiptOutbox: 'id, user_id, [user_id+status], transaction_id',
        syncMeta: 'user_id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transactions')
          .toCollection()
          .modify((record: LocalTransactionRecord) => {
            if (record.has_pending_receipt_upload === undefined) {
              record.has_pending_receipt_upload = false;
            }
          });
      });
  }
}

export const localDb = new DompetHarianLocalDB();

/**
 * Requests persistent storage from the Android browser so the OS does not evict IndexedDB under storage pressure.
 */
export async function requestPersistentBrowserStorage(userId?: string): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return false;
  }
  try {
    const alreadyPersisted =
      typeof navigator.storage.persisted === 'function'
        ? await navigator.storage.persisted()
        : false;
    const granted = alreadyPersisted || (await navigator.storage.persist());
    if (userId) {
      const existing = await localDb.syncMeta.get(userId);
      if (existing) {
        await localDb.syncMeta.update(userId, { storage_persisted: granted });
      }
    }
    return granted;
  } catch {
    return false;
  }
}

/**
 * Purges 100% of local IndexedDB records belonging to a specific user_id ("Hapus data lokal").
 * Never touches records belonging to any other user_id on the device.
 */
export async function clearLocalDataForUser(userId: string): Promise<void> {
  if (!userId) return;
  await localDb.transaction(
    'rw',
    [
      localDb.transactions,
      localDb.categories,
      localDb.syncQueue,
      localDb.receiptOutbox,
      localDb.syncMeta,
    ],
    async () => {
      await localDb.transactions.where('user_id').equals(userId).delete();
      await localDb.categories.where('user_id').equals(userId).delete();
      await localDb.syncQueue.where('user_id').equals(userId).delete();
      await localDb.receiptOutbox.where('user_id').equals(userId).delete();
      await localDb.syncMeta.delete(userId);
    }
  );
}
