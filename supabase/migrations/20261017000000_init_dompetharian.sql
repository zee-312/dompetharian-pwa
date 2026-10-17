-- ============================================================================
-- DompetHarian (Android Offline-First Edition) — Initial Schema & Sync DDL
-- Migration: 20261017000000_init_dompetharian.sql
-- Author / Credit: Aravajordan
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Per-User Monotonic Change Sequence (Never rely on device clocks for sync)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sync_sequences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_change_seq BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_sync_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_sync_sequences_select_own"
  ON public.user_sync_sequences FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_sync_sequences_insert_own"
  ON public.user_sync_sequences FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_sync_sequences_update_own"
  ON public.user_sync_sequences FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "user_sync_sequences_delete_own"
  ON public.user_sync_sequences FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Atomic helper function to allocate the next monotonic change_seq for a user
CREATE OR REPLACE FUNCTION public.next_user_change_seq(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_seq BIGINT;
BEGIN
  INSERT INTO public.user_sync_sequences (user_id, last_change_seq, updated_at)
  VALUES (p_user_id, 1, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    last_change_seq = public.user_sync_sequences.last_change_seq + 1,
    updated_at = NOW()
  RETURNING last_change_seq INTO v_next_seq;

  RETURN v_next_seq;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Categories Table (Supports custom categories & archiving instead of hard delete)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 60),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  icon TEXT NOT NULL DEFAULT 'tag',
  color TEXT NOT NULL DEFAULT '#10b981',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  change_seq BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_user_seq
  ON public.categories (user_id, change_seq);

CREATE INDEX IF NOT EXISTS idx_categories_user_kind
  ON public.categories (user_id, kind)
  WHERE deleted_at IS NULL;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select_own"
  ON public.categories FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "categories_insert_own"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "categories_update_own"
  ON public.categories FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "categories_delete_own"
  ON public.categories FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 3. Transactions Table (Sync-ready from Migration 1: UUID PK, version, deleted_at, change_seq)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
  amount_idr BIGINT NOT NULL CHECK (amount_idr > 0 AND amount_idr <= 1000000000000),
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (char_length(trim(description)) BETWEEN 1 AND 200),
  merchant TEXT NULL CHECK (merchant IS NULL OR char_length(merchant) <= 120),
  category_id UUID NOT NULL,
  payment_method TEXT NOT NULL CHECK (
    payment_method IN ('tunai', 'transfer_bank', 'qris', 'ewallet', 'kartu_debit', 'kartu_kredit')
  ),
  notes TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 500),
  -- Receipt reference stores ONLY the user's Google Drive File ID, never image content
  receipt_drive_file_id TEXT NULL CHECK (receipt_drive_file_id IS NULL OR char_length(receipt_drive_file_id) <= 128),
  receipt_mime_type TEXT NULL CHECK (receipt_mime_type IS NULL OR receipt_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  receipt_size_bytes INTEGER NULL CHECK (receipt_size_bytes IS NULL OR (receipt_size_bytes > 0 AND receipt_size_bytes <= 10485760)),
  input_source TEXT NOT NULL DEFAULT 'manual' CHECK (input_source IN ('manual', 'ocr', 'sync_import')),
  verification_status TEXT NOT NULL DEFAULT 'verified' CHECK (
    verification_status IN ('verified', 'needs_review', 'unverified')
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  change_seq BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date
  ON public.transactions (user_id, transaction_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_user_seq
  ON public.transactions (user_id, change_seq ASC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_category
  ON public.transactions (user_id, category_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_select_own"
  ON public.transactions FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "transactions_insert_own"
  ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "transactions_update_own"
  ON public.transactions FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "transactions_delete_own"
  ON public.transactions FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 4. Receipt Metadata Table (Stores Drive file ID, MIME type, size, owner ONLY)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.receipt_metadata (
  drive_file_id TEXT PRIMARY KEY CHECK (char_length(drive_file_id) BETWEEN 1 AND 128),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_metadata_user
  ON public.receipt_metadata (user_id, transaction_id);

ALTER TABLE public.receipt_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_metadata_select_own"
  ON public.receipt_metadata FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "receipt_metadata_insert_own"
  ON public.receipt_metadata FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "receipt_metadata_update_own"
  ON public.receipt_metadata FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "receipt_metadata_delete_own"
  ON public.receipt_metadata FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 5. Processed Operations Table (Per-User Idempotency for Offline Sync Push)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_operations (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  op_id UUID NOT NULL,
  client_id TEXT NOT NULL CHECK (char_length(client_id) BETWEEN 1 AND 120),
  record_type TEXT NOT NULL CHECK (record_type IN ('transaction', 'category')),
  record_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
  result_status TEXT NOT NULL CHECK (result_status IN ('applied', 'duplicate', 'conflict', 'rejected')),
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, op_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_operations_user_time
  ON public.processed_operations (user_id, processed_at DESC);

ALTER TABLE public.processed_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "processed_operations_select_own"
  ON public.processed_operations FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "processed_operations_insert_own"
  ON public.processed_operations FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "processed_operations_delete_own"
  ON public.processed_operations FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ----------------------------------------------------------------------------
-- 6. Triggers to Auto-Assign Monotonic change_seq & Increment version on Server
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_sync_seq_and_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := COALESCE(NEW.version, 1);
    NEW.change_seq := public.next_user_change_seq(NEW.user_id);
    NEW.updated_at := NOW();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.change_seq := public.next_user_change_seq(NEW.user_id);
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_sync ON public.transactions;
CREATE TRIGGER trg_transactions_sync
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_seq_and_version();

DROP TRIGGER IF EXISTS trg_categories_sync ON public.categories;
CREATE TRIGGER trg_categories_sync
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_seq_and_version();
