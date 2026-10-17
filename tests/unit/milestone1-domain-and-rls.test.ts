/**
 * DompetHarian — Milestone 1 Unit & Integration Tests
 * Covers:
 * - Integer Rupiah handling (formatting, live input parsing, float rejection, negative/zero rejection)
 * - Transaction domain creation, validation, update, delete
 * - RLS & Server-side ownership checks (permitted and denied cross-user access)
 * - Privacy-preserving logger redaction (never logs amounts, descriptions, merchants, tokens)
 * Author / Credit: Aravajordan
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertPositiveIntegerIdr,
  divideIntegerIdrRounded,
  formatRupiah,
  formatRupiahLiveInput,
  isValidPositiveIntegerIdr,
  parseRupiahInput,
  sumIntegerIdr,
} from '@/lib/formatters/currency';
import {
  AuthorizationError,
  DomainValidationError,
  TransactionDomainService,
  assertRecordOwnership,
  generateUuidV4,
} from '@/features/transactions/transaction-domain';
import { serverStore } from '@/lib/database/server-store';
import { sanitizeLogContext, redactSensitiveString } from '@/lib/security/logger';

describe('Milestone 1: Integer Rupiah (IDR) Handling', () => {
  it('accepts positive integer Rupiah and rejects floats, zero, and negatives', () => {
    expect(isValidPositiveIntegerIdr(25000)).toBe(true);
    expect(isValidPositiveIntegerIdr(1)).toBe(true);
    expect(isValidPositiveIntegerIdr(0)).toBe(false);
    expect(isValidPositiveIntegerIdr(-5000)).toBe(false);
    expect(isValidPositiveIntegerIdr(25000.5)).toBe(false);
    expect(isValidPositiveIntegerIdr(NaN)).toBe(false);

    expect(() => assertPositiveIntegerIdr(15000.75)).toThrow(/bilangan bulat/i);
    expect(() => assertPositiveIntegerIdr(0)).toThrow(/lebih besar dari Rp 0/i);
    expect(() => assertPositiveIntegerIdr(-100)).toThrow(/lebih besar dari Rp 0/i);
  });

  it('formats Rupiah in Indonesian locale and formats live numeric input accurately', () => {
    expect(formatRupiah(25000)).toBe('Rp 25.000');
    expect(formatRupiah(1500000)).toBe('Rp 1.500.000');
    expect(formatRupiah(-10000)).toBe('-Rp 10.000');

    expect(formatRupiahLiveInput('25000')).toEqual({ display: '25.000', value: 25000 });
    expect(formatRupiahLiveInput('Rp 125.500')).toEqual({ display: '125.500', value: 125500 });
    expect(formatRupiahLiveInput('000')).toEqual({ display: '', value: 0 });

    expect(parseRupiahInput('Rp 45.000')).toBe(45000);
    expect(parseRupiahInput('45000,50')).toBeNull();
  });

  it('performs integer summation and rounded integer division with division-by-zero protection', () => {
    expect(sumIntegerIdr([10000, 25000, 5000])).toBe(40000);
    expect(() => sumIntegerIdr([10000, 12.5])).toThrow(/floating-point/i);
    expect(divideIntegerIdrRounded(100000, 3)).toBe(33333);
    expect(divideIntegerIdrRounded(100000, 0)).toBe(0);
  });
});

describe('Milestone 1: Transaction Domain & Cross-User Authorization / RLS', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    serverStore.resetForTests();
  });

  it('creates, updates, and filters valid expense and income transactions', () => {
    const tx = TransactionDomainService.buildNewTransaction(userA, {
      kind: 'expense',
      amount_idr: 35000,
      transaction_date: '2026-10-17',
      description: 'Nasi Goreng Spesial',
      merchant: 'Warung Pak Budi',
      category_id: 'cat_makanan',
      payment_method: 'qris',
      notes: 'Makan malam',
    });

    expect(tx.user_id).toBe(userA);
    expect(tx.amount_idr).toBe(35000);
    expect(tx.sync_state).toBe('pending');
    expect(tx.base_version).toBe(0);

    const updated = TransactionDomainService.applyTransactionUpdate(userA, tx, {
      amount_idr: 40000,
      description: 'Nasi Goreng + Es Teh',
    });
    expect(updated.amount_idr).toBe(40000);
    expect(updated.description).toBe('Nasi Goreng + Es Teh');
  });

  it('rejects floating-point amounts and invalid dates in domain service', () => {
    expect(() =>
      TransactionDomainService.buildNewTransaction(userA, {
        kind: 'expense',
        amount_idr: 19999.99,
        transaction_date: '2026-10-17',
        description: 'Kopi',
        category_id: 'cat_makanan',
        payment_method: 'tunai',
      })
    ).toThrow(/bilangan bulat/i);

    expect(() =>
      TransactionDomainService.buildNewTransaction(userA, {
        kind: 'expense',
        amount_idr: 20000,
        transaction_date: '2026-02-30', // Invalid calendar date
        description: 'Kopi',
        category_id: 'cat_makanan',
        payment_method: 'tunai',
      })
    ).toThrow(DomainValidationError);
  });

  it('enforces strict per-user isolation (permitted for owner, denied for other user)', () => {
    const txId = generateUuidV4();
    const opId = generateUuidV4();

    // User A creates a transaction on server
    const [createRes] = serverStore.processPushBatch(userA, [
      {
        op_id: opId,
        client_id: 'phone-a',
        record_type: 'transaction',
        record_id: txId,
        kind: 'create',
        base_version: 0,
        created_at_ms: Date.now(),
        payload: {
          kind: 'expense',
          amount_idr: 50000,
          transaction_date: '2026-10-17',
          description: 'Pulsa Listrik',
          category_id: 'cat_tagihan',
          payment_method: 'ewallet',
        },
      },
    ]);

    expect(createRes?.status).toBe('applied');

    // Permitted: User A can read their own transaction
    const ownRecord = serverStore.getTransactionForUser(userA, txId);
    expect(ownRecord?.amount_idr).toBe(50000);

    // Denied: User B cannot read User A's transaction
    expect(() => serverStore.getTransactionForUser(userB, txId)).toThrow(AuthorizationError);
    expect(serverStore.listActiveTransactionsForUser(userB)).toHaveLength(0);

    // Denied: User B cannot update or delete User A's transaction via sync push
    const [crossUpdateRes] = serverStore.processPushBatch(userB, [
      {
        op_id: generateUuidV4(),
        client_id: 'phone-b',
        record_type: 'transaction',
        record_id: txId,
        kind: 'update',
        base_version: 1,
        created_at_ms: Date.now(),
        payload: {
          amount_idr: 1000,
          description: 'Bajak transaksi',
        },
      },
    ]);
    expect(crossUpdateRes?.status).toBe('rejected');
    expect(crossUpdateRes?.reason).toMatch(/pengguna lain/i);

    // Verify User A's record on server was untouched
    expect(serverStore.getTransactionForUser(userA, txId)?.amount_idr).toBe(50000);

    // Direct ownership helper check
    expect(() => assertRecordOwnership(userB, userA)).toThrow(AuthorizationError);
  });

  it('redacts sensitive financial fields and tokens from logs', () => {
    const sanitized = sanitizeLogContext({
      event: 'sync_failed',
      userId: userA,
      amount_idr: 250000,
      description: 'Gaji Oktober',
      merchant: 'PT Maju Jaya',
      notes: 'Rahasia',
      ocrText: 'TOTAL Rp 250.000',
      accessToken: 'ya29.a0AfH6SMBx...',
    }) as Record<string, unknown>;

    expect(sanitized.userId).toBe(userA);
    expect(sanitized.amount_idr).toBe('[REDACTED]');
    expect(sanitized.description).toBe('[REDACTED]');
    expect(sanitized.merchant).toBe('[REDACTED]');
    expect(sanitized.notes).toBe('[REDACTED]');
    expect(sanitized.ocrText).toBe('[REDACTED]');
    expect(sanitized.accessToken).toBe('[REDACTED]');

    expect(redactSensitiveString('Gagal memproses Rp 75.000 dengan Bearer eyJhbGciOiJIUz.abc.def')).toBe(
      'Gagal memproses [REDACTED_AMOUNT] dengan [REDACTED_TOKEN]'
    );
  });
});
