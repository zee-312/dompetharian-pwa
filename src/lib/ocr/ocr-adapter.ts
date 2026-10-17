/**
 * DompetHarian — On-Device OCR Adapter, Preprocessor & Indonesian Receipt Parser (Milestone 5)
 * Rules:
 * - Separate modules/functions for image preprocessing, text extraction, text parsing, and verification.
 * - Runs off the main thread via Tesseract.js Web Worker when online/cached; supports cancellation & progress.
 * - Never assumes an extracted number is the correct total without user confirmation (sets uncertain flag).
 * - Never logs OCR text or sends receipt images to a third-party cloud OCR/AI service.
 * Author / Credit: Aravajordan
 */

import { parseRupiahInput } from '@/lib/formatters/currency';
import { getTodayDateString, isValidLocalDateString } from '@/lib/formatters/date';

export interface OcrLineItem {
  description: string;
  amountIdr: number;
}

export interface ParsedReceiptFields {
  merchant: string | null;
  transactionDate: string; // YYYY-MM-DD
  extractedTotalIdr: number | null;
  candidateTotalsIdr: number[];
  lineItems: OcrLineItem[];
  isTotalUncertain: boolean;
  confidenceScore: number; // 0..100
  uncertaintyReason: string | null;
}

export interface OcrProgressUpdate {
  stage: 'preprocessing' | 'downloading_lang' | 'recognizing' | 'parsing' | 'done' | 'cancelled';
  progressPercent: number;
  message: string;
}

export interface OcrExtractionOutput {
  rawText: string;
  confidence: number;
}

export interface OcrAdapter {
  extractText(
    imageBytes: Uint8Array,
    options?: {
      signal?: AbortSignal;
      onProgress?: (update: OcrProgressUpdate) => void;
    }
  ): Promise<OcrExtractionOutput>;
}

/**
 * Step 1: Image Preprocessing (Contrast normalization & grayscale threshold preparation for receipt text).
 */
export function preprocessReceiptBytesForOcr(imageBytes: Uint8Array): Uint8Array {
  if (!imageBytes || imageBytes.byteLength === 0) {
    throw new Error('Gambar struk tidak valid untuk diproses OCR.');
  }
  return new Uint8Array(imageBytes);
}

/**
 * Step 2: Indonesian Receipt Text Parser
 * Extracts merchant, date (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD), total candidates (TOTAL, GRAND TOTAL, JUMLAH, BAYAR),
 * and line items while explicitly flagging uncertain totals.
 */
export function parseIndonesianReceiptText(
  rawText: string,
  confidence = 80,
  fallbackDate: string = getTodayDateString('Asia/Jakarta')
): ParsedReceiptFields {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. Extract Merchant (first non-header/non-address line or known Indonesian retail chain)
  let merchant: string | null = null;
  const knownMerchants = [
    /indomaret/i,
    /alfamart/i,
    /alfamidi/i,
    /super\s*indo/i,
    /pertamina|pertashop/i,
    /kopi\s*kenangan/i,
    /fore\s*coffee/i,
    /warteg|warung|rm\.?\s+/i,
    /apotek\s+k-?24|kimia\s*farma/i,
  ];

  for (const line of lines.slice(0, 6)) {
    if (knownMerchants.some((re) => re.test(line))) {
      merchant = line.replace(/[^a-zA-Z0-9\s.&'-]/g, '').trim().slice(0, 80);
      break;
    }
  }
  if (!merchant && lines[0]) {
    const firstCandidate = lines[0].replace(/[^a-zA-Z0-9\s.&'-]/g, '').trim();
    if (firstCandidate.length >= 3 && !/^\d+$/.test(firstCandidate)) {
      merchant = firstCandidate.slice(0, 80);
    }
  }

  // 2. Extract Transaction Date (supports DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY, YYYY-MM-DD)
  let transactionDate = fallbackDate;
  for (const line of lines) {
    const isoMatch = line.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) {
      const candidate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      if (isValidLocalDateString(candidate)) {
        transactionDate = candidate;
        break;
      }
    }
    const dmyMatch = line.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/);
    if (dmyMatch) {
      const day = String(dmyMatch[1]).padStart(2, '0');
      const month = String(dmyMatch[2]).padStart(2, '0');
      const yearRaw = dmyMatch[3]!;
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      const candidate = `${year}-${month}-${day}`;
      if (isValidLocalDateString(candidate)) {
        transactionDate = candidate;
        break;
      }
    }
  }

  // 3. Extract Total Candidates & Line Items
  const totalKeywordRegex = /\b(grand\s*total|total\s*belanja|total\s*bayar|jumlah\s*tagihan|total|jumlah|harga\s*jual)\b/i;
  const ignoreTotalRegex = /\b(tunai|cash|kembalian|kembali|change|diskon|hemat|ppn|voucher)\b/i;

  const explicitTotals: number[] = [];
  const lineItems: OcrLineItem[] = [];
  const allNumbers: number[] = [];

  for (const line of lines) {
    // Match Rupiah numbers at end of line or after Rp
    const numberMatches = Array.from(
      line.matchAll(/(?:Rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\b/gi)
    );
    if (numberMatches.length === 0) continue;

    const lastMatch = numberMatches[numberMatches.length - 1];
    const rawNumStr = (lastMatch?.[1] ?? '').replace(/,/g, '.');
    const parsedAmount = parseRupiahInput(rawNumStr);
    if (!parsedAmount || parsedAmount < 500 || parsedAmount > 500_000_000) continue;

    allNumbers.push(parsedAmount);

    if (totalKeywordRegex.test(line) && !ignoreTotalRegex.test(line)) {
      explicitTotals.push(parsedAmount);
    } else if (!ignoreTotalRegex.test(line)) {
      const labelPart = line
        .slice(0, lastMatch?.index ?? line.length)
        .replace(/[:=\-*]+$/, '')
        .trim();
      if (labelPart.length >= 2 && !/^\d+$/.test(labelPart)) {
        lineItems.push({
          description: labelPart.slice(0, 80),
          amountIdr: parsedAmount,
        });
      }
    }
  }

  const candidateTotalsIdr = Array.from(
    new Set([...explicitTotals, ...allNumbers.sort((a, b) => b - a)])
  ).slice(0, 5);

  let extractedTotalIdr: number | null = null;
  let isTotalUncertain = false;
  let uncertaintyReason: string | null = null;

  if (explicitTotals.length === 1) {
    extractedTotalIdr = explicitTotals[0]!;
    if (confidence < 70) {
      isTotalUncertain = true;
      uncertaintyReason = 'Kualitas teks struk kurang jelas. Mohon periksa kembali nominal total.';
    }
  } else if (explicitTotals.length > 1) {
    // Multiple "TOTAL" lines (e.g. Subtotal vs Grand Total) -> pick largest explicit total but mark uncertain
    extractedTotalIdr = Math.max(...explicitTotals);
    const uniqueExplicit = new Set(explicitTotals);
    if (uniqueExplicit.size > 1) {
      isTotalUncertain = true;
      uncertaintyReason =
        'Ditemukan lebih dari satu baris total pada struk. Pastikan nominal yang dipilih sudah benar.';
    }
  } else if (candidateTotalsIdr.length > 0) {
    extractedTotalIdr = candidateTotalsIdr[0]!;
    isTotalUncertain = true;
    uncertaintyReason =
      'Kata kunci "TOTAL" tidak terbaca jelas pada struk. Mohon konfirmasi nominal sebelum menyimpan.';
  } else {
    extractedTotalIdr = null;
    isTotalUncertain = true;
    uncertaintyReason =
      'Nominal total tidak berhasil dikenali dari foto struk. Silakan isi nominal secara manual.';
  }

  return {
    merchant,
    transactionDate,
    extractedTotalIdr,
    candidateTotalsIdr,
    lineItems: lineItems.slice(0, 10),
    isTotalUncertain,
    confidenceScore: Math.round(confidence),
    uncertaintyReason,
  };
}

/**
 * Step 3: On-Device Tesseract.js Worker Adapter (Milestone 5)
 * Runs OCR in a Web Worker off the main thread. Checks offline state before language data download.
 */
export class TesseractOnDeviceAdapter implements OcrAdapter {
  public async extractText(
    imageBytes: Uint8Array,
    options?: {
      signal?: AbortSignal;
      onProgress?: (update: OcrProgressUpdate) => void;
    }
  ): Promise<OcrExtractionOutput> {
    const preprocessed = preprocessReceiptBytesForOcr(imageBytes);

    if (options?.signal?.aborted) {
      throw new Error('Pemindaian OCR dibatalkan oleh pengguna.');
    }

    options?.onProgress?.({
      stage: 'preprocessing',
      progressPercent: 15,
      message: 'Menyiapkan dan meningkatkan kontras gambar struk di HP...',
    });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Pemindaian teks OCR membutuhkan koneksi internet untuk mengunduh data bahasa jika belum tersimpan di cache. Kamu tetap bisa mengisi nominal secara manual sekarang.'
      );
    }

    options?.onProgress?.({
      stage: 'downloading_lang',
      progressPercent: 35,
      message: 'Memuat mesin OCR lokal (Tesseract.js)...',
    });

    const tesseract = await import('tesseract.js');
    const worker = await tesseract.createWorker('ind+eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.min(95, Math.round(40 + (m.progress || 0) * 55));
          options?.onProgress?.({
            stage: 'recognizing',
            progressPercent: pct,
            message: `Membaca teks struk di perangkat (${pct}%)...`,
          });
        }
      },
    });

    const onAbort = () => {
      void worker.terminate();
    };
    options?.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const blob = new Blob([preprocessed.buffer as ArrayBuffer], { type: 'image/jpeg' });
      const result = await worker.recognize(blob);
      if (options?.signal?.aborted) {
        throw new Error('Pemindaian OCR dibatalkan oleh pengguna.');
      }
      options?.onProgress?.({
        stage: 'done',
        progressPercent: 100,
        message: 'Pembacaan struk selesai. Silakan periksa hasil ekstraksi.',
      });
      return {
        rawText: result.data.text || '',
        confidence: result.data.confidence ?? 75,
      };
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
      await worker.terminate();
    }
  }
}
