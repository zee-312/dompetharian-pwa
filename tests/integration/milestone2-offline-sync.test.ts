/**
 * DompetHarian — Milestone 2 Integration Tests (Offline-First Core, Sync Contract & Account Isolation)
 * Uses real IndexedDB (Dexie + fake-indexeddb) and real Server Sync Store (no mocked business logic).
 * Author / Credit: Aravajordan
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { localDb, clearLocalDataForUser } from '@/lib/sync/dexie-db';
import { localRepository } from '@/features/transactions/local-transaction-repository';
import {
  SyncEngine,
  type SyncTransport,
  MAX_RETRY_COUNT,
  computeBackoffDelayMs,
} from '@/lib/sync/sync-engine';
import { serverStore } from '@/lib/database/server-store';
import { generateUuidV4 } from '@/features/transactions/transaction-domain';
import { setPinConfig, verifyUserPin, clearPinConfig } from '@/lib/security/pin-lock';

const directServerTransport: SyncTransport = {
  async push(userId, _clientId, operations) {
    return serverStore.processPushBatch(userId, operations);
  },
  async pull(userId, afterSeq, limit) {
    return serverStore.pullChanges(userId, afterSeq, limit);
  },
};

describe('Milestone 2: Offline-First Core, Sync Contract & Multi-Account Isolation', () => {
  const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let engine: SyncEngine;

  beforeEach(async () => {
    serverStore.resetForTests();
    await localDb.transactions.clear();
    await localDb.categories.clear();
    await localDb.syncQueue.clear();
    await localDb.receiptOutbox.clear();
    await localDb.syncMeta.clear();
    engine = new SyncEngine(directServerTransport);
  });

  it('creates, edits, searches, and deletes transactions while offline in IndexedDB', async () => {
    const tx1 = await localRepository.createTransaction(userA, {
      kind: 'expense',
      amount_idr: 25000,
      transaction_date: '2026-10-17',
      description: 'Kopi Susu Gula Aren',
      merchant: 'Kopi Kenangan',
      category_id: 'cat_makanan',
      payment_method: 'qris',
    });

    expect(tx1.sync_state).toBe('pending');

    // Edit offline
    const edited = await localRepository.updateTransaction(userA, tx1.id, {
      amount_idr: 28000,
      description: 'Kopi Susu + Roti Bakar',
    });
    expect(edited.amount_idr).toBe(28000);
    expect(edited.sync_state).toBe('pending');

    // Search offline
    const searchHits = await localRepository.listTransactions(userA, {
      search: 'roti bakar',
    });
    expect(searchHits).toHaveLength(1);
    expect(searchHits[0]?.id).toBe(tx1.id);

    // Delete offline
    await localRepository.deleteTransaction(userA, tx1.id);
    const afterDelete = await localRepository.listTransactions(userA);
    expect(afterDelete).toHaveLength(0);
  });

  it('syncs pending offline operations on reconnect and ensures idempotent retries produce 1 record', async () => {
    const tx = await localRepository.createTransaction(userA, {
      kind: 'expense',
      amount_idr: 45000,
      transaction_date: '2026-10-17',
      description: 'Makan Siang Padang',
      merchant: 'RM Sederhana',
      category_id: 'cat_makanan',
      payment_method: 'tunai',
    });

    const queueBefore = await localDb.syncQueue.where('user_id').equals(userA).toArray();
    expect(queueBefore).toHaveLength(1);
    const originalOp = queueBefore[0]!;

    // Sync to server
    const outcome = await engine.syncNow(userA);
    expect(outcome.appliedCount).toBe(1);
    expect(outcome.error).toBeNull();

    // Local transaction is now marked 'synced' with version 1
    const syncedLocal = await localRepository.getTransactionById(userA, tx.id);
    expect(syncedLocal?.sync_state).toBe('synced');
    expect(syncedLocal?.version).toBe(1);

    // Replay the exact same op_id 5 times to the server to verify idempotency
    for (let i = 0; i < 5; i++) {
      const [replayRes] = serverStore.processPushBatch(userA, [
        {
          op_id: originalOp.op_id,
          client_id: originalOp.client_id,
          record_type: 'transaction',
          record_id: originalOp.record_id,
          kind: 'create',
          base_version: 0,
          created_at_ms: originalOp.created_at_ms,
          payload: originalOp.payload,
        },
      ]);
      expect(replayRes?.status).toBe('duplicate');
      expect(replayRes?.server_version).toBe(1);
    }

    // Server still has strictly 1 record for User A
    const serverRecords = serverStore.listActiveTransactionsForUser(userA);
    expect(serverRecords).toHaveLength(1);
    expect(serverRecords[0]?.amount_idr).toBe(45000);
  });

  it('detects optimistic concurrency conflicts (never silently overwrites newer server data) and resolves them', async () => {
    // 1. Create and sync initial transaction (version 1)
    const tx = await localRepository.createTransaction(userA, {
      kind: 'expense',
      amount_idr: 30000,
      transaction_date: '2026-10-17',
      description: 'Bensin Motor',
      merchant: 'Pertamina',
      category_id: 'cat_transport',
      payment_method: 'tunai',
    });
    await engine.syncNow(userA);

    // 2. Another phone (Phone 2) updates the same transaction on the server to version 2
    const [phone2Update] = serverStore.processPushBatch(userA, [
      {
        op_id: generateUuidV4(),
        client_id: 'phone-2',
        record_type: 'transaction',
        record_id: tx.id,
        kind: 'update',
        base_version: 1,
        created_at_ms: Date.now(),
        payload: {
          amount_idr: 50000,
          description: 'Bensin Pertamax (Diubah dari HP 2)',
        },
      },
    ]);
    expect(phone2Update?.status).toBe('applied');
    expect(phone2Update?.server_version).toBe(2);

    // 3. Phone 1 (offline, still at base_version = 1) edits the transaction locally
    await localRepository.updateTransaction(userA, tx.id, {
      amount_idr: 35000,
      description: 'Bensin Pertalite (Diubah dari HP 1)',
    });

    // 4. Phone 1 syncs -> must detect conflict and NOT overwrite Phone 2's version 2 on server
    const syncOutcome = await engine.syncNow(userA);
    expect(syncOutcome.conflictCount).toBe(1);

    const serverAfterConflict = serverStore.getTransactionForUser(userA, tx.id);
    expect(serverAfterConflict?.amount_idr).toBe(50000); // Server data preserved!
    expect(serverAfterConflict?.version).toBe(2);

    const localAfterConflict = await localRepository.getTransactionById(userA, tx.id);
    expect(localAfterConflict?.sync_state).toBe('conflict');
    expect(localAfterConflict?.amount_idr).toBe(35000); // Local edit also preserved!

    // 5. User resolves conflict by choosing 'keep_local' -> anchors on base_version = 2 and syncs to version 3
    const conflictedOps = await localDb.syncQueue
      .where('[user_id+status]')
      .equals([userA, 'conflict'])
      .toArray();
    expect(conflictedOps).toHaveLength(1);

    await engine.resolveConflict(userA, conflictedOps[0]!.op_id, 'keep_local');
    const resolvedOutcome = await engine.syncNow(userA, { ignoreBackoffWindow: true });
    expect(resolvedOutcome.appliedCount).toBe(1);

    const finalServer = serverStore.getTransactionForUser(userA, tx.id);
    expect(finalServer?.amount_idr).toBe(35000);
    expect(finalServer?.version).toBe(3);
  });

  it('keeps failed operations visible after retry cap and recovers via manual Coba Lagi', async () => {
    const tx = await localRepository.createTransaction(userA, {
      kind: 'expense',
      amount_idr: 15000,
      transaction_date: '2026-10-17',
      description: 'Parkir Mall',
      category_id: 'cat_transport',
      payment_method: 'tunai',
    });

    // Configure failing transport
    const failingEngine = new SyncEngine({
      async push() {
        throw new Error('Jaringan terputus saat mengirim data');
      },
      async pull() {
        throw new Error('Jaringan terputus');
      },
    });

    // Exhaust MAX_RETRY_COUNT (5) retries
    let simulatedNow = Date.now();
    for (let attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
      simulatedNow += 400_000;
      await failingEngine.syncNow(userA, { nowMs: simulatedNow });
    }

    const failedTx = await localRepository.getTransactionById(userA, tx.id);
    expect(failedTx?.sync_state).toBe('failed');
    expect(failedTx?.last_error).toMatch(/Jaringan terputus/i);

    const summary = await failingEngine.getSyncStatusSummary(userA);
    expect(summary.failedCount).toBe(1);

    // Switch back to working transport and trigger manual "Coba lagi"
    failingEngine.setTransport(directServerTransport);
    const retryOutcome = await failingEngine.retryFailedOperations(userA);
    expect(retryOutcome.appliedCount).toBe(1);

    const recoveredTx = await localRepository.getTransactionById(userA, tx.id);
    expect(recoveredTx?.sync_state).toBe('synced');
    expect(computeBackoffDelayMs(2, () => 0.5)).toBe(4250);
  });

  it('strictly isolates local data when switching accounts on the same phone', async () => {
    // User A creates local unsynced transaction
    await localRepository.createTransaction(userA, {
      kind: 'expense',
      amount_idr: 120000,
      transaction_date: '2026-10-17',
      description: 'Belanja Bulanan User A',
      category_id: 'cat_belanja',
      payment_method: 'kartu_debit',
    });

    // User B logs in on the same phone and lists transactions
    const userBTransactions = await localRepository.listTransactions(userB);
    expect(userBTransactions).toHaveLength(0);

    // User B creates their own transaction and syncs
    await localRepository.createTransaction(userB, {
      kind: 'income',
      amount_idr: 5000000,
      transaction_date: '2026-10-17',
      description: 'Gaji User B',
      category_id: 'cat_gaji',
      payment_method: 'transfer_bank',
    });

    await engine.syncNow(userB);

    // Verify User A's unsynced transaction was NEVER uploaded under User B's sync!
    expect(serverStore.listActiveTransactionsForUser(userA)).toHaveLength(0);
    expect(serverStore.listActiveTransactionsForUser(userB)).toHaveLength(1);

    // Clearing User A's local data leaves User B's local data completely intact
    await clearLocalDataForUser(userA);
    expect(await localRepository.listTransactions(userA)).toHaveLength(0);
    expect(await localRepository.listTransactions(userB)).toHaveLength(1);
  });

  it('hashes and verifies App Lock PIN using WebCrypto PBKDF2-SHA256', async () => {
    await setPinConfig(userA, '1234', 60);
    expect(await verifyUserPin(userA, '1234')).toBe(true);
    expect(await verifyUserPin(userA, '9999')).toBe(false);
    clearPinConfig(userA);
  });
});
