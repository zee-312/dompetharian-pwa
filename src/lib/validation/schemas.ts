/**
 * DompetHarian — Server & Client Zod Validation Schemas
 * Author / Credit: Aravajordan
 */

import { z } from 'zod';
import { MAX_IDR_AMOUNT } from '@/lib/formatters/currency';
import { isValidLocalDateString } from '@/lib/formatters/date';

export const transactionKindSchema = z.enum(['expense', 'income'], {
  errorMap: () => ({ message: 'Jenis transaksi harus pengeluaran atau pemasukan.' }),
});

export const paymentMethodSchema = z.enum(
  ['tunai', 'transfer_bank', 'qris', 'ewallet', 'kartu_debit', 'kartu_kredit'],
  {
    errorMap: () => ({ message: 'Metode pembayaran tidak valid.' }),
  }
);

export const inputSourceSchema = z.enum(['manual', 'ocr', 'sync_import']);

export const verificationStatusSchema = z.enum(['verified', 'needs_review', 'unverified']);

export const positiveIntegerIdrSchema = z
  .number({
    required_error: 'Nominal Rupiah wajib diisi.',
    invalid_type_error: 'Nominal Rupiah harus berupa angka bulat.',
  })
  .int('Nominal Rupiah harus berupa bilangan bulat (tanpa desimal).')
  .positive('Nominal Rupiah harus lebih besar dari Rp 0.')
  .max(MAX_IDR_AMOUNT, 'Nominal Rupiah melebihi batas maksimum.');

export const localDateSchema = z
  .string({ required_error: 'Tanggal transaksi wajib diisi.' })
  .refine(isValidLocalDateString, {
    message: 'Format tanggal harus YYYY-MM-DD yang valid.',
  });

export const createTransactionSchema = z.object({
  id: z.string().uuid('ID transaksi harus berupa UUID yang valid.').optional(),
  kind: transactionKindSchema,
  amount_idr: positiveIntegerIdrSchema,
  transaction_date: localDateSchema,
  description: z
    .string({ required_error: 'Deskripsi transaksi wajib diisi.' })
    .trim()
    .min(1, 'Deskripsi transaksi tidak boleh kosong.')
    .max(200, 'Deskripsi maksimal 200 karakter.'),
  merchant: z
    .string()
    .trim()
    .max(120, 'Nama toko/merchant maksimal 120 karakter.')
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  category_id: z.string().min(1, 'Kategori wajib dipilih.').max(64),
  payment_method: paymentMethodSchema,
  notes: z
    .string()
    .trim()
    .max(500, 'Catatan maksimal 500 karakter.')
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  receipt_drive_file_id: z
    .string()
    .trim()
    .max(128, 'ID file Google Drive tidak valid.')
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  receipt_mime_type: z
    .enum(['image/jpeg', 'image/png', 'image/webp'])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  receipt_size_bytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'Ukuran struk maksimal 10 MB.')
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  input_source: inputSourceSchema.default('manual'),
  verification_status: verificationStatusSchema.default('verified'),
  has_pending_receipt_upload: z.boolean().optional().default(false),
});

export const updateTransactionSchema = z.object({
  kind: transactionKindSchema.optional(),
  amount_idr: positiveIntegerIdrSchema.optional(),
  transaction_date: localDateSchema.optional(),
  description: z
    .string()
    .trim()
    .min(1, 'Deskripsi transaksi tidak boleh kosong.')
    .max(200, 'Deskripsi maksimal 200 karakter.')
    .optional(),
  merchant: z
    .string()
    .trim()
    .max(120, 'Nama toko/merchant maksimal 120 karakter.')
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null)),
  category_id: z.string().min(1, 'Kategori tidak boleh kosong.').max(64).optional(),
  payment_method: paymentMethodSchema.optional(),
  notes: z
    .string()
    .trim()
    .max(500, 'Catatan maksimal 500 karakter.')
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null)),
  receipt_drive_file_id: z
    .string()
    .trim()
    .max(128)
    .nullable()
    .optional(),
  receipt_mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable().optional(),
  receipt_size_bytes: z.number().int().positive().max(10 * 1024 * 1024).nullable().optional(),
  verification_status: verificationStatusSchema.optional(),
  has_pending_receipt_upload: z.boolean().optional(),
});

export const createCategorySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z
    .string({ required_error: 'Nama kategori wajib diisi.' })
    .trim()
    .min(1, 'Nama kategori tidak boleh kosong.')
    .max(60, 'Nama kategori maksimal 60 karakter.'),
  kind: transactionKindSchema,
  icon: z.string().trim().min(1).max(40).default('tag'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus format hex #RRGGBB.')
    .default('#10b981'),
});

export const syncOperationSchema = z.object({
  op_id: z.string().uuid('op_id harus berupa UUID.'),
  client_id: z.string().min(1).max(120),
  record_type: z.enum(['transaction', 'category']).default('transaction'),
  record_id: z.string().min(1).max(64),
  kind: z.enum(['create', 'update', 'delete']),
  base_version: z.number().int().min(0),
  created_at_ms: z.number().int().nonnegative(),
  payload: z.record(z.unknown()).default({}),
});

export const syncPushBatchSchema = z.object({
  client_id: z.string().min(1).max(120),
  operations: z.array(syncOperationSchema).min(1).max(100),
});
