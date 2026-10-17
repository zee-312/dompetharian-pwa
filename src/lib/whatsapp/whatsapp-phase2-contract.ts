/**
 * DompetHarian — Phase 2 WhatsApp Integration Contract (Out of Scope for v1)
 * Author / Credit: Aravajordan
 *
 * PRIVACY CONFLICT NOTE (See docs/WHATSAPP_PHASE2.md):
 * Sending receipt photos through WhatsApp Business Cloud API conflicts with the v1 rule
 * that receipt images are never stored on third-party/developer servers and live strictly
 * in the user's own Google Drive via browser-only tokens.
 * Therefore, Phase 2 is NOT implemented in v1 and requires an explicit architectural & privacy
 * decision before building.
 */

import type { CreateTransactionInput } from '@/lib/database/types';

export interface FutureWhatsAppTextCommand {
  senderPhoneE164: string;
  messageId: string;
  timestampIso: string;
  textBody: string;
}

export interface FutureWhatsAppWebhookAdapter {
  readonly isImplementedInV1: false;
  parseTextToTransactionDraft(cmd: FutureWhatsAppTextCommand): CreateTransactionInput | null;
}
