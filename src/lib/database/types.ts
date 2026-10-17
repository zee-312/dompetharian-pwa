/**
 * DompetHarian — Shared Domain & Database Types
 * Author / Credit: Aravajordan
 */

export type TransactionKind = 'expense' | 'income';

export type PaymentMethod =
  | 'tunai'
  | 'transfer_bank'
  | 'qris'
  | 'ewallet'
  | 'kartu_debit'
  | 'kartu_kredit';

export type InputSource = 'manual' | 'ocr' | 'sync_import';

export type VerificationStatus = 'verified' | 'needs_review' | 'unverified';

export type SyncState = 'pending' | 'synced' | 'failed' | 'conflict';

export type IndonesianTimezone = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

export interface CategoryRecord {
  id: string;
  user_id: string;
  name: string;
  kind: TransactionKind;
  icon: string;
  color: string;
  is_default: boolean;
  is_archived: boolean;
  usage_count: number;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LocalCategoryRecord extends CategoryRecord {
  sync_state: SyncState;
  base_version: number;
  last_used_at: string | null;
}

export interface TransactionRecord {
  id: string;
  user_id: string;
  kind: TransactionKind;
  /** Strictly positive integer Rupiah (never floating-point) */
  amount_idr: number;
  /** Plain local date YYYY-MM-DD */
  transaction_date: string;
  description: string;
  merchant: string | null;
  category_id: string;
  payment_method: PaymentMethod;
  notes: string | null;
  /** Google Drive file ID ONLY. Server never stores receipt image bytes. */
  receipt_drive_file_id: string | null;
  receipt_mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | null;
  receipt_size_bytes: number | null;
  input_source: InputSource;
  verification_status: VerificationStatus;
  version: number;
  change_seq: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface LocalTransactionRecord extends TransactionRecord {
  sync_state: SyncState;
  last_error: string | null;
  base_version: number;
  has_pending_receipt_upload: boolean;
}

export interface CreateTransactionInput {
  id?: string;
  kind: TransactionKind;
  amount_idr: number;
  transaction_date: string;
  description: string;
  merchant?: string | null;
  category_id: string;
  payment_method: PaymentMethod;
  notes?: string | null;
  receipt_drive_file_id?: string | null;
  receipt_mime_type?: 'image/jpeg' | 'image/png' | 'image/webp' | null;
  receipt_size_bytes?: number | null;
  input_source?: InputSource;
  verification_status?: VerificationStatus;
  has_pending_receipt_upload?: boolean;
}

export interface UpdateTransactionInput {
  kind?: TransactionKind;
  amount_idr?: number;
  transaction_date?: string;
  description?: string;
  merchant?: string | null;
  category_id?: string;
  payment_method?: PaymentMethod;
  notes?: string | null;
  receipt_drive_file_id?: string | null;
  receipt_mime_type?: 'image/jpeg' | 'image/png' | 'image/webp' | null;
  receipt_size_bytes?: number | null;
  verification_status?: VerificationStatus;
  has_pending_receipt_upload?: boolean;
}

export interface TransactionFilter {
  search?: string;
  kind?: TransactionKind | 'all';
  category_id?: string | 'all';
  payment_method?: PaymentMethod | 'all';
  start_date?: string;
  end_date?: string;
  month?: string; // YYYY-MM
  sync_state?: SyncState | 'all';
}

export type SyncOperationKind = 'create' | 'update' | 'delete';
export type SyncOperationResultStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';

export interface SyncPushOperation {
  op_id: string;
  client_id: string;
  record_type: 'transaction' | 'category';
  record_id: string;
  kind: SyncOperationKind;
  base_version: number;
  created_at_ms: number;
  payload: Record<string, unknown>;
}

export interface SyncOperationResult {
  op_id: string;
  record_id: string;
  status: SyncOperationResultStatus;
  server_version: number | null;
  change_seq: number | null;
  server_record: TransactionRecord | CategoryRecord | null;
  reason: string | null;
}

export interface SyncPullResponse {
  transactions: TransactionRecord[];
  categories: CategoryRecord[];
  next_cursor_seq: number;
  has_more: boolean;
}

/**
 * Repository interface decoupling UI screens from the backing store
 * (Milestone 1 server/memory repository vs Milestone 2 IndexedDB local-first repository).
 */
export interface TransactionRepository {
  listTransactions(userId: string, filter?: TransactionFilter): Promise<LocalTransactionRecord[]>;
  getTransactionById(userId: string, id: string): Promise<LocalTransactionRecord | null>;
  createTransaction(userId: string, input: CreateTransactionInput): Promise<LocalTransactionRecord>;
  updateTransaction(
    userId: string,
    id: string,
    input: UpdateTransactionInput
  ): Promise<LocalTransactionRecord>;
  deleteTransaction(userId: string, id: string): Promise<void>;
  listCategories(userId: string, includeArchived?: boolean): Promise<LocalCategoryRecord[]>;
  createCategory(
    userId: string,
    input: { name: string; kind: TransactionKind; icon?: string; color?: string }
  ): Promise<LocalCategoryRecord>;
  renameCategory(userId: string, categoryId: string, newName: string): Promise<LocalCategoryRecord>;
  archiveCategory(userId: string, categoryId: string, archived: boolean): Promise<LocalCategoryRecord>;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  tunai: 'Tunai',
  qris: 'QRIS',
  ewallet: 'E-Wallet',
  transfer_bank: 'Transfer Bank',
  kartu_debit: 'Kartu Debit',
  kartu_kredit: 'Kartu Kredit',
};
