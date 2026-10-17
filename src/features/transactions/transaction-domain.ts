/**
 * DompetHarian — Channel-Agnostic Transaction Domain Service (Milestone 1)
 * Enforces business rules across manual entry, on-device OCR, and offline sync.
 * Author / Credit: Aravajordan
 */

import type {
  CreateTransactionInput,
  LocalTransactionRecord,
  TransactionFilter,
  TransactionRecord,
  UpdateTransactionInput,
} from '@/lib/database/types';
import { assertPositiveIntegerIdr } from '@/lib/formatters/currency';
import { createTransactionSchema, updateTransactionSchema } from '@/lib/validation/schemas';

export class AuthorizationError extends Error {
  public readonly statusCode = 403;
  constructor(message = 'Akses ditolak: Kamu tidak memiliki izin untuk mengakses data pengguna lain.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class DomainValidationError extends Error {
  public readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

/**
 * Generates a cryptographic UUID v4 on the client or server.
 */
export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Verifies that the authenticated user owns the target record.
 * Used on both client and server even when PostgreSQL RLS is active (defense in depth).
 */
export function assertRecordOwnership(authenticatedUserId: string, recordUserId: string): void {
  if (!authenticatedUserId || !recordUserId || authenticatedUserId !== recordUserId) {
    throw new AuthorizationError();
  }
}

export const TransactionDomainService = {
  /**
   * Validates and constructs a new transaction record (channel-agnostic: manual, OCR, or sync).
   */
  buildNewTransaction(
    userId: string,
    rawInput: CreateTransactionInput,
    nowIso: string = new Date().toISOString()
  ): LocalTransactionRecord {
    if (!userId || userId.trim().length === 0) {
      throw new AuthorizationError('Sesi pengguna diperlukan untuk membuat transaksi.');
    }

    // Strict integer IDR check before schema parsing
    assertPositiveIntegerIdr(rawInput.amount_idr);

    const parsed = createTransactionSchema.safeParse(rawInput);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new DomainValidationError(firstIssue?.message ?? 'Data transaksi tidak valid.');
    }

    const data = parsed.data;
    const id = data.id ?? generateUuidV4();

    // If created from OCR without explicit user verification, mark needs_review
    const verificationStatus =
      data.input_source === 'ocr' && !rawInput.verification_status
        ? 'needs_review'
        : data.verification_status;

    return {
      id,
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
      verification_status: verificationStatus,
      version: 1,
      change_seq: 0,
      created_at: nowIso,
      updated_at: nowIso,
      deleted_at: null,
      sync_state: 'pending',
      last_error: null,
      base_version: 0,
      has_pending_receipt_upload: Boolean(data.has_pending_receipt_upload),
    };
  },

  /**
   * Validates and applies an update to an existing transaction record.
   */
  applyTransactionUpdate(
    userId: string,
    existing: LocalTransactionRecord,
    rawUpdate: UpdateTransactionInput,
    nowIso: string = new Date().toISOString()
  ): LocalTransactionRecord {
    assertRecordOwnership(userId, existing.user_id);

    if (existing.deleted_at !== null) {
      throw new DomainValidationError('Transaksi yang sudah dihapus tidak dapat diubah.');
    }

    if (rawUpdate.amount_idr !== undefined) {
      assertPositiveIntegerIdr(rawUpdate.amount_idr);
    }

    const parsed = updateTransactionSchema.safeParse(rawUpdate);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new DomainValidationError(firstIssue?.message ?? 'Pembaruan transaksi tidak valid.');
    }

    const patch = parsed.data;

    return {
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
      has_pending_receipt_upload:
        patch.has_pending_receipt_upload !== undefined
          ? patch.has_pending_receipt_upload
          : existing.has_pending_receipt_upload,
      updated_at: nowIso,
      sync_state: 'pending',
      last_error: null,
    };
  },

  /**
   * Filters and sorts transactions (newest transaction_date first, then created_at desc).
   */
  filterAndSortTransactions<T extends TransactionRecord | LocalTransactionRecord>(
    records: readonly T[],
    filter?: TransactionFilter
  ): T[] {
    const searchLower = filter?.search?.trim().toLowerCase() ?? '';

    return records
      .filter((tx) => {
        if (tx.deleted_at !== null) return false;
        if (filter?.kind && filter.kind !== 'all' && tx.kind !== filter.kind) return false;
        if (
          filter?.category_id &&
          filter.category_id !== 'all' &&
          tx.category_id !== filter.category_id
        ) {
          return false;
        }
        if (
          filter?.payment_method &&
          filter.payment_method !== 'all' &&
          tx.payment_method !== filter.payment_method
        ) {
          return false;
        }
        if (filter?.month && !tx.transaction_date.startsWith(filter.month)) {
          return false;
        }
        if (filter?.start_date && tx.transaction_date < filter.start_date) {
          return false;
        }
        if (filter?.end_date && tx.transaction_date > filter.end_date) {
          return false;
        }
        if (
          filter?.sync_state &&
          filter.sync_state !== 'all' &&
          'sync_state' in tx &&
          tx.sync_state !== filter.sync_state
        ) {
          return false;
        }
        if (searchLower.length > 0) {
          const haystack = [
            tx.description,
            tx.merchant ?? '',
            tx.notes ?? '',
            String(tx.amount_idr),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(searchLower)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.transaction_date !== b.transaction_date) {
          return b.transaction_date.localeCompare(a.transaction_date);
        }
        return b.created_at.localeCompare(a.created_at);
      });
  },

  toServerTransactionRecord(local: LocalTransactionRecord): TransactionRecord {
    return {
      id: local.id,
      user_id: local.user_id,
      kind: local.kind,
      amount_idr: local.amount_idr,
      transaction_date: local.transaction_date,
      description: local.description,
      merchant: local.merchant,
      category_id: local.category_id,
      payment_method: local.payment_method,
      notes: local.notes,
      receipt_drive_file_id: local.receipt_drive_file_id,
      receipt_mime_type: local.receipt_mime_type,
      receipt_size_bytes: local.receipt_size_bytes,
      input_source: local.input_source,
      verification_status: local.verification_status,
      version: local.version,
      change_seq: local.change_seq,
      created_at: local.created_at,
      updated_at: local.updated_at,
      deleted_at: local.deleted_at,
    };
  },
};
