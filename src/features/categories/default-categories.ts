/**
 * DompetHarian — Default Indonesian Categories (PRD Section 4)
 * Expense: Makanan & Minuman, Transportasi, Belanja, Tagihan & Utilitas, Kesehatan, Pendidikan, Hiburan, Rumah Tangga, Lainnya
 * Income: Gaji, Bonus, Usaha, Hadiah, Lainnya
 * Author / Credit: Aravajordan
 */

import type { CategoryRecord, LocalCategoryRecord, TransactionKind } from '@/lib/database/types';

export interface DefaultCategoryTemplate {
  slug: string;
  name: string;
  kind: TransactionKind;
  icon: string;
  color: string;
  defaultUsageRank: number;
}

export const DEFAULT_CATEGORY_TEMPLATES: readonly DefaultCategoryTemplate[] = [
  // Pengeluaran (9 kategori bawaan PRD)
  { slug: 'makanan-minuman', name: 'Makanan & Minuman', kind: 'expense', icon: 'utensils', color: '#ef4444', defaultUsageRank: 10 },
  { slug: 'transportasi', name: 'Transportasi', kind: 'expense', icon: 'car', color: '#f97316', defaultUsageRank: 9 },
  { slug: 'belanja', name: 'Belanja', kind: 'expense', icon: 'shopping-bag', color: '#eab308', defaultUsageRank: 8 },
  { slug: 'tagihan-utilitas', name: 'Tagihan & Utilitas', kind: 'expense', icon: 'zap', color: '#06b6d4', defaultUsageRank: 7 },
  { slug: 'rumah-tangga', name: 'Rumah Tangga', kind: 'expense', icon: 'home', color: '#14b8a6', defaultUsageRank: 6 },
  { slug: 'kesehatan', name: 'Kesehatan', kind: 'expense', icon: 'heart-pulse', color: '#ec4899', defaultUsageRank: 5 },
  { slug: 'pendidikan', name: 'Pendidikan', kind: 'expense', icon: 'graduation-cap', color: '#8b5cf6', defaultUsageRank: 4 },
  { slug: 'hiburan', name: 'Hiburan', kind: 'expense', icon: 'film', color: '#6366f1', defaultUsageRank: 3 },
  { slug: 'lainnya-expense', name: 'Lainnya', kind: 'expense', icon: 'more-horizontal', color: '#64748b', defaultUsageRank: 1 },
  // Pemasukan (5 kategori bawaan PRD)
  { slug: 'gaji', name: 'Gaji', kind: 'income', icon: 'wallet', color: '#10b981', defaultUsageRank: 10 },
  { slug: 'usaha', name: 'Usaha', kind: 'income', icon: 'briefcase', color: '#059669', defaultUsageRank: 8 },
  { slug: 'bonus', name: 'Bonus', kind: 'income', icon: 'award', color: '#22c55e', defaultUsageRank: 6 },
  { slug: 'hadiah', name: 'Hadiah', kind: 'income', icon: 'gift', color: '#34d399', defaultUsageRank: 4 },
  { slug: 'lainnya-income', name: 'Lainnya', kind: 'income', icon: 'plus-circle', color: '#6ee7b7', defaultUsageRank: 1 },
];

export function buildDefaultCategoryId(userId: string, slug: string): string {
  // Deterministic per-user category ID so multiple phones for the same user share default category IDs
  const cleanUser = userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  return `cat_${cleanUser}_${slug}`;
}

export function buildDefaultCategoriesForUser(
  userId: string,
  nowIso: string = new Date().toISOString()
): LocalCategoryRecord[] {
  return DEFAULT_CATEGORY_TEMPLATES.map((tpl, idx) => ({
    id: buildDefaultCategoryId(userId, tpl.slug),
    user_id: userId,
    name: tpl.name,
    kind: tpl.kind,
    icon: tpl.icon,
    color: tpl.color,
    is_default: true,
    is_archived: false,
    usage_count: tpl.defaultUsageRank,
    version: 1,
    change_seq: idx + 1,
    created_at: nowIso,
    updated_at: nowIso,
    deleted_at: null,
    sync_state: 'synced',
    base_version: 1,
    last_used_at: null,
  }));
}

export function toServerCategoryRecord(cat: LocalCategoryRecord): CategoryRecord {
  return {
    id: cat.id,
    user_id: cat.user_id,
    name: cat.name,
    kind: cat.kind,
    icon: cat.icon,
    color: cat.color,
    is_default: cat.is_default,
    is_archived: cat.is_archived,
    usage_count: cat.usage_count,
    version: cat.version,
    change_seq: cat.change_seq,
    created_at: cat.created_at,
    updated_at: cat.updated_at,
    deleted_at: cat.deleted_at,
  };
}
