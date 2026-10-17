# DompetHarian — Sync Contract Specification (Stage 0 / Milestone 2.3)

**Author / Credit:** Aravajordan  
**Status:** Approved before sync implementation

This document defines the exact synchronization protocol between the Android client (IndexedDB via Dexie) and the server (Supabase PostgreSQL / Sync API). Neither client nor server may deviate from this contract.

---

## 1. Core Invariants

1. **Client-Generated UUIDs:** Every transaction and custom category receives a UUID v4 on the device at creation time.
2. **Server Monotonic Sequence (`change_seq`):** The server maintains a strictly increasing integer sequence `change_seq` per `user_id` (`BIGINT`). Device clocks are **never** used to determine sync cursors or conflict winners.
3. **Optimistic Concurrency via `version`:** Every record has an integer `version` starting at `1` on creation and incremented by `+1` on every server mutation (including soft delete).
4. **Tombstone Deletions (`deleted_at`):** Deletions set `deleted_at = NOW()`, increment `version`, and assign a new `change_seq` so other phones belonging to the same user pull the deletion tombstone.
5. **Strict Per-User Isolation:** Every sync operation is authenticated and scoped to `auth.uid()`. Cross-user operations are rejected with `403 Forbidden`.
6. **Zero Silent Data Loss:**
   - Pending local operations are **never** automatically dropped.
   - Version mismatches **never** silently overwrite newer server records or silently discard local edits; they transition to `conflict` state and surface in the Indonesian Conflict Resolution UI.

---

## 2. Push Protocol (`POST /api/sync/push`)

### 2.1 Request Payload

The client sends a batch of ordered operations for the currently authenticated user:

```json
{
  "client_id": "device-uuid-v4",
  "operations": [
    {
      "op_id": "op-uuid-v4",
      "client_id": "device-uuid-v4",
      "record_type": "transaction",
      "record_id": "tx-uuid-v4",
      "kind": "create",
      "base_version": 0,
      "created_at_ms": 1760693755000,
      "payload": {
        "id": "tx-uuid-v4",
        "kind": "expense",
        "amount_idr": 25000,
        "transaction_date": "2026-10-17",
        "description": "Nasi Padang",
        "merchant": "RM Sederhana",
        "category_id": "cat-food",
        "payment_method": "qris",
        "notes": null,
        "receipt_drive_file_id": null,
        "receipt_mime_type": null,
        "receipt_size_bytes": null,
        "input_source": "manual",
        "verification_status": "verified"
      }
    }
  ]
}
```

### 2.2 Server Processing Rules (In-Order, Per-Operation)

The server processes `operations` sequentially in array order:

1. **Idempotency Check (`processed_operations` table):**
   - Look up `(user_id, op_id)` in `processed_operations`.
   - If found, return the previously recorded result with `status: "duplicate"` (if originally `applied`) and the stored `server_record`. **Never** re-apply the mutation or increment `version` twice.
2. **Server-Side Validation (Zod + Domain Rules):**
   - Validate `payload` (e.g., `amount_idr` must be a positive integer `> 0` and `<= 1_000_000_000_000`, `transaction_date` valid `YYYY-MM-DD`, `description` non-empty, ownership matches `user_id`).
   - If validation fails, record `(user_id, op_id)` with `status: "rejected"` and return `reason` in Bahasa Indonesia. The local record remains editable by the user.
3. **Operation Execution by `kind`:**
   - **`kind: "create"`**:
     - If `record_id` does not exist on the server: insert with `version = 1`, assign next `change_seq`, record `op_id` as `applied`, and return `{ op_id, status: "applied", server_version: 1, change_seq, server_record }`.
     - If `record_id` already exists on the server for the **same** `user_id` with identical core fields: treat as idempotent create (`status: "duplicate"`, return current `server_record`).
     - If `record_id` already exists on the server for the same `user_id` with different content (e.g. modified on another device): return `status: "conflict"` with `server_record`.
     - If `record_id` belongs to a different `user_id`: reject with `status: "rejected"`, reason `"Akses ditolak: ID transaksi tidak valid."`.
   - **`kind: "update"`**:
     - Fetch current server record for `(user_id, record_id)`.
     - If not found: return `status: "rejected"`, reason `"Transaksi tidak ditemukan di server."`.
     - If `server_record.deleted_at !== null` OR `server_record.version !== op.base_version`:
       - Return `status: "conflict"` with `server_record` (including whether the server record was deleted or modified). Do **not** overwrite the server record.
     - If `server_record.version === op.base_version`:
       - Apply update, set `version = server_record.version + 1`, assign next `change_seq`, record `op_id` as `applied`, return `status: "applied"` with updated `server_record`.
   - **`kind: "delete"`**:
     - Fetch current server record for `(user_id, record_id)`.
     - If not found: treat as already deleted (`status: "applied"`).
     - If `server_record.deleted_at !== null`: treat as idempotent tombstone (`status: "duplicate"`, return `server_record`).
     - If `server_record.version !== op.base_version`:
       - Return `status: "conflict"` with `server_record` (delete vs edit conflict: the server has a newer edit that the user has not seen).
     - If `server_record.version === op.base_version`:
       - Set `deleted_at = NOW()`, `version = server_record.version + 1`, assign next `change_seq`, record `op_id` as `applied`, return `status: "applied"` with tombstone `server_record`.

### 2.3 Push Response Payload

```json
{
  "results": [
    {
      "op_id": "op-uuid-v4",
      "record_id": "tx-uuid-v4",
      "status": "applied",
      "server_version": 1,
      "change_seq": 42,
      "server_record": { "...": "..." },
      "reason": null
    }
  ]
}
```

---

## 3. Pull Protocol (`GET /api/sync/pull?after_seq={cursor}&limit={pageSize}`)

1. **Cursor (`after_seq`):** Integer defaulting to `0` on first login on a device.
2. **Ordering:** Server queries records where `user_id = auth.uid()` and `change_seq > after_seq` ordered by `change_seq ASC` with `LIMIT pageSize` (default `100`, max `500`).
3. **Tombstones Included:** Records with `deleted_at !== null` are included in the response so clients delete or mark tombstoned records locally.
4. **Pagination:** Response includes `next_cursor_seq` and `has_more: boolean`. On first login, the client loops until `has_more === false` before marking `initial_pull_completed = true`.
5. **Local Merge Rules During Pull:**
   - If the local record has **no** pending operations in `syncQueue` (`sync_state === 'synced'` or not present locally):
     - If `server_record.deleted_at !== null`, remove from active local view (or store tombstone).
     - Otherwise, upsert local record with `sync_state = 'synced'` and `base_version = server_record.version`.
   - If the local record **has** pending operations in `syncQueue`:
     - Do **not** clobber the local unpushed edit during Pull; let the subsequent Push evaluate `base_version` against `server_record.version` so any conflict is formally captured with both versions preserved.

---

## 4. Ordering & Queue Compaction Rules

- Operations for the same `record_id` are always sent and applied in strict FIFO order of `created_at_ms`.
- If a conflict occurs on operation $k$ for `record_id = X`, subsequent queued operations for `record_id = X` pause until the user resolves the conflict on `X`. Operations for other records (`record_id = Y`) continue syncing normally without head-of-line blocking.

---

## 5. Conflict Resolution Contract (UI & State Machine)

When an operation receives `status: "conflict"`:
1. Local transaction `sync_state` is set to `'conflict'`.
2. Both versions are stored locally:
   - **Versi HP Kamu (Lokal):** The user's local fields (or local deletion intent).
   - **Versi Server (Perangkat Lain):** `server_record` returned by the server (or server deletion tombstone).
3. In `/sinkronisasi` (and via banner alert), the user can choose one of three explicit actions in Bahasa Indonesia:
   - **"Gunakan Versi HP Ini" (Keep Local):** Enqueues a new `update` (or `delete` / re-create if server deleted it) with `base_version = server_record.version` and a fresh `op_id`.
   - **"Gunakan Versi Server" (Keep Server):** Discards the conflicted local operation and adopts `server_record` (or removes locally if `server_record.deleted_at !== null`) with `sync_state = 'synced'` and `base_version = server_record.version`.
   - **"Edit & Gabungkan Manual" (Edit):** Opens the transaction editor pre-filled with the user's choice of fields and saves a new operation anchored on `base_version = server_record.version`.

---

## 6. Retry & Exponential Backoff with Jitter

- Network errors, timeouts, or HTTP `5xx` / `429` responses increment `retry_count` on the operation.
- Backoff formula:
  $$\text{delay\_ms} = \min\left(300000,\; 1000 \times 2^{\text{retry\_count}}\right) + \text{random}(0, 500)$$
- Maximum automatic retries per operation: **5 attempts** (`MAX_RETRY_COUNT = 5`).
- Once `retry_count >= 5`, the operation transitions to `status = 'failed'` and the transaction's `sync_state` becomes `'failed'` with a clear Indonesian `last_error`.
- **No operation is ever dropped.** The user can tap **"Coba lagi"** (`retryFailedOperations()`) at any time, which resets `retry_count = 0` and immediately triggers a sync run.
