'use client';

/**
 * DompetHarian — Per-Transaction Sync Status & Receipt Outbox Badge
 * Styled in Warm Tactile Editorial palette (#2E5A44 Sage, #D99B26 Marigold Coin, #C85A32 Terracotta)
 * Author / Credit: Aravajordan
 */

import React from 'react';
import { Check, Clock, AlertTriangle, GitMerge, Paperclip } from 'lucide-react';
import type { SyncState } from '@/lib/database/types';

interface SyncBadgeProps {
  syncState: SyncState;
  hasPendingReceiptUpload?: boolean;
  receiptDriveFileId?: string | null;
}

export function SyncBadge({
  syncState,
  hasPendingReceiptUpload = false,
  receiptDriveFileId = null,
}: SyncBadgeProps) {
  const renderStateBadge = () => {
    switch (syncState) {
      case 'synced':
        return (
          <span
            data-testid="sync-badge-synced"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#E3EFE8] text-[#1E402F] border border-[#B8D4C5]"
          >
            <Check className="w-3 h-3" aria-hidden="true" />
            <span>Tersinkron</span>
          </span>
        );
      case 'pending':
        return (
          <span
            data-testid="sync-badge-pending"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FDF3DC] text-[#7A520B] border border-[#EDD295]"
          >
            <Clock className="w-3 h-3" aria-hidden="true" />
            <span>Menunggu</span>
          </span>
        );
      case 'conflict':
        return (
          <span
            data-testid="sync-badge-conflict"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3E8FF] text-[#581C87] border border-[#D8B4FE]"
          >
            <GitMerge className="w-3 h-3" aria-hidden="true" />
            <span>Konflik</span>
          </span>
        );
      case 'failed':
        return (
          <span
            data-testid="sync-badge-failed"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F9E6DF] text-[#9A3B1B] border border-[#E8BFB0]"
          >
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            <span>Gagal Sinkron</span>
          </span>
        );
    }
  };

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {renderStateBadge()}
      {hasPendingReceiptUpload && (
        <span
          data-testid="receipt-pending-badge"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FDF3DC] text-[#7A520B] border border-[#EDD295]"
        >
          <Paperclip className="w-3 h-3" aria-hidden="true" />
          <span>Struk menunggu</span>
        </span>
      )}
      {!hasPendingReceiptUpload && receiptDriveFileId && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3EDE2] text-[#4A433C] border border-[#D8CEBE]">
          <Paperclip className="w-3 h-3" aria-hidden="true" />
          <span>Struk di Drive</span>
        </span>
      )}
    </div>
  );
}
