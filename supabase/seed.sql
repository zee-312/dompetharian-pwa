-- ============================================================================
-- DompetHarian — Development Seed Data (supabase/seed.sql)
-- Author / Credit: Aravajordan
-- Catatan: Digunakan hanya untuk pengembangan lokal.
-- ============================================================================

-- Contoh fungsi bantu untuk menyemai kategori bawaan bagi pengguna baru di lingkungan dev
CREATE OR REPLACE FUNCTION public.seed_default_categories_for_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.categories (id, user_id, name, kind, icon, color, is_default, is_archived, usage_count)
  VALUES
    (gen_random_uuid(), p_user_id, 'Makanan & Minuman', 'expense', 'utensils', '#ef4444', TRUE, FALSE, 10),
    (gen_random_uuid(), p_user_id, 'Transportasi', 'expense', 'car', '#f97316', TRUE, FALSE, 8),
    (gen_random_uuid(), p_user_id, 'Belanja', 'expense', 'shopping-bag', '#eab308', TRUE, FALSE, 6),
    (gen_random_uuid(), p_user_id, 'Tagihan & Utilitas', 'expense', 'zap', '#06b6d4', TRUE, FALSE, 5),
    (gen_random_uuid(), p_user_id, 'Kesehatan', 'expense', 'heart-pulse', '#ec4899', TRUE, FALSE, 2),
    (gen_random_uuid(), p_user_id, 'Pendidikan', 'expense', 'graduation-cap', '#8b5cf6', TRUE, FALSE, 1),
    (gen_random_uuid(), p_user_id, 'Hiburan', 'expense', 'film', '#6366f1', TRUE, FALSE, 3),
    (gen_random_uuid(), p_user_id, 'Rumah Tangga', 'expense', 'home', '#14b8a6', TRUE, FALSE, 4),
    (gen_random_uuid(), p_user_id, 'Lainnya', 'expense', 'more-horizontal', '#64748b', TRUE, FALSE, 1),
    (gen_random_uuid(), p_user_id, 'Gaji', 'income', 'wallet', '#10b981', TRUE, FALSE, 5),
    (gen_random_uuid(), p_user_id, 'Bonus', 'income', 'award', '#22c55e', TRUE, FALSE, 2),
    (gen_random_uuid(), p_user_id, 'Usaha', 'income', 'briefcase', '#059669', TRUE, FALSE, 3),
    (gen_random_uuid(), p_user_id, 'Hadiah', 'income', 'gift', '#34d399', TRUE, FALSE, 1),
    (gen_random_uuid(), p_user_id, 'Lainnya', 'income', 'plus-circle', '#6ee7b7', TRUE, FALSE, 1)
  ON CONFLICT DO NOTHING;
END;
$$;
