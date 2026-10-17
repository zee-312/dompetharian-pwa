'use client';

/**
 * DompetHarian — Riwayat & Pencarian Transaksi (Warm Tactile Editorial Edition — PRD Section 5.4)
 * Features:
 * - Works 100% offline from IndexedDB
 * - Instant search by description, merchant, or notes
 * - Filters by month, category, kind (expense/income), and sync state
 * - Grouped by date with daily subtotals and CSS `content-visibility: auto` for long lists
 * Author / Credit: Aravajordan
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Filter, Plus, X } from 'lucide-react';
import { useApp } from '@/components/layout/AppContext';
import { formatRupiah } from '@/lib/formatters/currency';
import { formatIndonesianDate } from '@/lib/formatters/date';
import { SyncBadge } from '@/components/ui/SyncBadge';
import {
  PAYMENT_METHOD_LABELS,
  type SyncState,
  type LocalTransactionRecord,
  type TransactionKind,
} from '@/lib/database/types';

export default function RiwayatPage() {
  const { transactions, categories, navigateTo } = useApp();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedKind, setSelectedKind] = useState<'all' | TransactionKind>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [selectedSyncState, setSelectedSyncState] = useState<'all' | SyncState>('all');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((tx) => tx.deleted_at === null)
      .filter((tx) => {
        if (selectedKind !== 'all' && tx.kind !== selectedKind) return false;
        if (selectedCategoryId !== 'all' && tx.category_id !== selectedCategoryId) {
          return false;
        }
        if (selectedSyncState !== 'all' && tx.sync_state !== selectedSyncState) {
          return false;
        }
        if (q.length > 0) {
          const hay = `${tx.description} ${tx.merchant ?? ''} ${tx.notes ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const d = b.transaction_date.localeCompare(a.transaction_date);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [
    transactions,
    searchQuery,
    selectedKind,
    selectedCategoryId,
    selectedSyncState,
  ]);

  const groupedByDate = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: string;
        items: LocalTransactionRecord[];
        dailyExpenseIdr: number;
        dailyIncomeIdr: number;
      }
    >();

    for (const tx of filteredTransactions) {
      const existing = groups.get(tx.transaction_date) ?? {
        date: tx.transaction_date,
        items: [],
        dailyExpenseIdr: 0,
        dailyIncomeIdr: 0,
      };
      existing.items.push(tx);
      if (tx.kind === 'expense') {
        existing.dailyExpenseIdr += tx.amount_idr;
      } else {
        existing.dailyIncomeIdr += tx.amount_idr;
      }
      groups.set(tx.transaction_date, existing);
    }

    return Array.from(groups.values());
  }, [filteredTransactions]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedKind !== 'all' ||
    selectedCategoryId !== 'all' ||
    selectedSyncState !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedKind('all');
    setSelectedCategoryId('all');
    setSelectedSyncState('all');
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Header Card */}
      <div className="dh-paper-card rounded-3xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-[#1C1917] font-display-serif">
            Riwayat Transaksi
          </h1>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`touch-target-48 px-3 py-1.5 rounded-2xl text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
              showFilters || hasActiveFilters
                ? 'bg-[#E3EFE8] border-[#B8D4C5] text-[#1E402F]'
                : 'bg-[#F3EDE2] border-[#E5DEC9] text-[#1C1917]'
            }`}
          >
            <Filter className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Filter</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative flex items-center">
          <Search
            className="w-4 h-4 text-[#6B635B] absolute left-3.5 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            data-testid="history-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari makan siang, toko, atau catatan..."
            aria-label="Cari riwayat transaksi"
            className="w-full touch-target-48 pl-9 pr-9 py-2 rounded-2xl border border-[#D8CEBE] bg-[#FAF7F2] text-xs text-[#1C1917] placeholder:text-[#6B635B] focus:outline-none focus:ring-2 focus:ring-[#2E5A44]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 p-1 text-[#6B635B] hover:text-[#1C1917]"
              aria-label="Hapus kata kunci pencarian"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Collapsible Filter Controls */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#E5DEC9]">
            <div>
              <label
                htmlFor="filter-kind"
                className="block text-[11px] font-bold text-[#1C1917] mb-1"
              >
                Jenis
              </label>
              <select
                id="filter-kind"
                value={selectedKind}
                onChange={(e) =>
                  setSelectedKind(e.target.value as 'all' | TransactionKind)
                }
                className="w-full touch-target-48 px-2.5 py-1.5 rounded-xl border border-[#D8CEBE] text-xs bg-[#FAF7F2] text-[#1C1917]"
              >
                <option value="all">Semua Jenis</option>
                <option value="expense">Pengeluaran</option>
                <option value="income">Pemasukan</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-category"
                className="block text-[11px] font-bold text-[#1C1917] mb-1"
              >
                Kategori
              </label>
              <select
                id="filter-category"
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full touch-target-48 px-2.5 py-1.5 rounded-xl border border-[#D8CEBE] text-xs bg-[#FAF7F2] text-[#1C1917]"
              >
                <option value="all">Semua Kategori</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="filter-sync"
                className="block text-[11px] font-bold text-[#1C1917] mb-1"
              >
                Status Sinkron
              </label>
              <select
                id="filter-sync"
                value={selectedSyncState}
                onChange={(e) =>
                  setSelectedSyncState(e.target.value as 'all' | SyncState)
                }
                className="w-full touch-target-48 px-2.5 py-1.5 rounded-xl border border-[#D8CEBE] text-xs bg-[#FAF7F2] text-[#1C1917]"
              >
                <option value="all">Semua Status</option>
                <option value="pending">Menunggu Sinkron</option>
                <option value="synced">Tersinkron</option>
                <option value="conflict">Konflik</option>
                <option value="failed">Gagal</option>
              </select>
            </div>
          </div>
        )}

        {hasActiveFilters && (
          <div className="flex items-center justify-between text-xs text-[#6B635B] pt-1">
            <span>Menampilkan {filteredTransactions.length} transaksi</span>
            <button
              type="button"
              onClick={resetFilters}
              className="font-bold text-[#2E5A44] hover:underline"
            >
              Reset Filter
            </button>
          </div>
        )}
      </div>

      {/* Grouped Transaction List */}
      {groupedByDate.length === 0 ? (
        <div className="dh-paper-card rounded-3xl p-6 text-center space-y-3">
          <p className="text-sm font-bold text-[#1C1917] font-display-serif">
            {hasActiveFilters
              ? 'Tidak ada transaksi yang cocok dengan filter pencarianmu'
              : 'Belum ada riwayat transaksi tercatat'}
          </p>
          <p className="text-xs text-[#6B635B]">
            {hasActiveFilters
              ? 'Coba ubah kata kunci atau reset filter untuk melihat semua catatan.'
              : 'Semua transaksi yang kamu catat akan langsung muncul di sini dan siap diakses kapan saja secara offline.'}
          </p>
          {!hasActiveFilters && (
            <button
              type="button"
              onClick={() => navigateTo('/tambah')}
              className="inline-flex items-center gap-1.5 touch-target-48 px-4 py-2.5 rounded-2xl bg-[#C85A32] text-[#FAF7F2] text-xs font-bold shadow-sm hover:bg-[#B04B25]"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Catat Transaksi Pertama</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="history-transaction-list">
          {groupedByDate.map((group) => (
            <section
              key={group.date}
              className="history-day-group-deferred dh-paper-card rounded-3xl overflow-hidden"
            >
              {/* Date Group Header */}
              <div className="bg-[#F3EDE2] px-4 py-2.5 border-b border-[#E5DEC9] flex items-center justify-between text-xs">
                <h2 className="font-bold text-[#1C1917]">
                  {formatIndonesianDate(group.date)}
                </h2>
                <div className="flex items-center gap-2 font-bold font-mono-tabular">
                  {group.dailyExpenseIdr > 0 && (
                    <span className="text-[#C85A32]">
                      -{formatRupiah(group.dailyExpenseIdr)}
                    </span>
                  )}
                  {group.dailyIncomeIdr > 0 && (
                    <span className="text-[#2E5A44]">
                      +{formatRupiah(group.dailyIncomeIdr)}
                    </span>
                  )}
                </div>
              </div>

              {/* Day's Transactions */}
              <ul className="divide-y divide-[#E5DEC9] px-4">
                {group.items.map((tx) => {
                  const cat = categoryMap.get(tx.category_id);
                  const isExpense = tx.kind === 'expense';
                  return (
                    <li key={tx.id} className="py-3">
                      <Link
                        href={`/transaksi/${tx.id}`}
                        data-testid={`tx-item-${tx.id}`}
                        className="flex items-start justify-between gap-3 group"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: cat?.color ?? '#6B635B' }}
                            />
                            <p className="text-sm font-bold text-[#1C1917] truncate group-hover:text-[#2E5A44]">
                              {tx.description}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B635B]">
                            <span>{cat?.name ?? 'Lainnya'}</span>
                            <span>•</span>
                            <span>{PAYMENT_METHOD_LABELS[tx.payment_method]}</span>
                            {tx.merchant && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-[#1C1917]">
                                  {tx.merchant}
                                </span>
                              </>
                            )}
                          </div>

                          <SyncBadge
                            syncState={tx.sync_state}
                            hasPendingReceiptUpload={tx.has_pending_receipt_upload}
                            receiptDriveFileId={tx.receipt_drive_file_id}
                          />
                        </div>

                        <div className="text-right shrink-0">
                          <p
                            className={`text-sm font-extrabold font-mono-tabular ${
                              isExpense ? 'text-[#C85A32]' : 'text-[#2E5A44]'
                            }`}
                          >
                            {isExpense ? '-' : '+'}
                            {formatRupiah(tx.amount_idr)}
                          </p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
