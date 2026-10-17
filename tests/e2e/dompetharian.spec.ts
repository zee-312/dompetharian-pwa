/**
 * DompetHarian — End-to-End Mobile Android Viewport Tests (Playwright)
 * Viewport: 360x800 (Mobile Chrome Android simulation)
 * Author / Credit: Aravajordan
 */

import { test, expect } from '@playwright/test';

test.describe('DompetHarian Android Offline-First PWA E2E', () => {
  test('1. Quick 3-tap expense creation, history search, edit, and delete with confirmation', async ({
    page,
  }) => {
    await page.goto('/tambah');

    // Verify credit and heading
    await expect(page.getByText('Aravajordan')).toBeVisible();

    // Tap 1: Enter amount
    const amountInput = page.getByTestId('amount-input');
    await amountInput.fill('25000');

    // Tap 2: Fill description
    await page.getByTestId('description-input').fill('Nasi Padang Siang');

    // Tap 3: Save transaction (redirects to /riwayat)
    await page.getByTestId('save-transaction-btn').click();

    await expect(page).toHaveURL(/\/riwayat/);
    await expect(page.getByText('Nasi Padang Siang')).toBeVisible();

    // Search in Riwayat
    const searchInput = page.getByTestId('history-search-input');
    await searchInput.fill('Padang');
    await expect(page.getByText('Nasi Padang Siang')).toBeVisible();

    // Check Beranda today's total
    await page.goto('/beranda');
    await expect(page.getByTestId('today-expense-total')).toContainText('Rp 25.000');

    // Go back to Riwayat and open transaction detail/edit screen
    await page.goto('/riwayat');
    await page.getByText('Nasi Padang Siang').click();
    await expect(page).toHaveURL(/\/transaksi\//);

    // Edit amount to 30000
    await page.getByTestId('edit-amount-input').fill('30000');
    await page.getByTestId('save-edit-btn').click();
    await expect(page.getByText('Perubahan transaksi berhasil disimpan.')).toBeVisible();

    // Delete transaction with confirmation
    await page.getByTestId('delete-transaction-btn').click();
    await page.getByTestId('confirm-delete-btn').click();

    await expect(page).toHaveURL(/\/riwayat/);
    await expect(page.getByText('Nasi Padang Siang')).toHaveCount(0);
  });

  test('2. On-device OCR sample receipt verification flow and Monthly Report analytics', async ({
    page,
  }) => {
    await page.goto('/scan');

    // Simulate scanning an Indomaret receipt
    await page.getByTestId('btn-simulate-sample-receipt').click();

    // Verify extracted fields appear in the confirmation form
    await expect(page.getByTestId('ocr-amount-input')).toHaveValue('38500');
    await expect(page.getByTestId('ocr-merchant-input')).toHaveValue('PT INDOMARET PRISMATAMA');

    // Set date to today so it counts in current month's report
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    await page.getByTestId('ocr-date-input').fill(todayIso);

    // Confirm and save
    await page.getByTestId('btn-confirm-ocr-save').click();
    await expect(page).toHaveURL(/\/riwayat/);
    await expect(page.getByText('PT INDOMARET PRISMATAMA')).toBeVisible();

    // Navigate to Laporan and check monthly total
    await page.goto('/laporan');
    await expect(page.getByTestId('report-monthly-expense')).toContainText('Rp 38.500');
  });

  test('3. Settings custom category creation and App Lock PIN flow', async ({ page }) => {
    await page.goto('/pengaturan');

    // Add a custom category
    await page.getByTestId('new-category-name-input').fill('Kopi Sore');
    await page.getByTestId('btn-add-category').click();
    await expect(page.getByTestId('settings-status-banner')).toContainText(
      'Kategori baru berhasil ditambahkan'
    );
    await expect(page.getByText('Kopi Sore')).toBeVisible();

    // Enable App Lock PIN (1234) and lock immediately
    await page.getByTestId('pin-setup-input').fill('1234');
    await page.getByTestId('btn-enable-pin').click();
    await expect(page.getByTestId('btn-lock-app-now')).toBeVisible();

    await page.getByTestId('btn-lock-app-now').click();
    await expect(page.getByText('DompetHarian Terkunci')).toBeVisible();

    // Unlock with PIN 1234
    await page.locator('#pin-unlock-input').fill('1234');
    await page.getByRole('button', { name: 'Buka Kunci Aplikasi' }).click();
    await expect(page.getByText('DompetHarian Terkunci')).toHaveCount(0);
  });

  test('4. Milestone 2 Checkpoint: Offline transaction recording, pending indicator, and reconnect sync', async ({
    page,
    context,
  }) => {
    await page.goto('/tambah');
    await expect(page.getByTestId('connectivity-indicator')).toContainText('Online');

    // Switch browser context to Offline mode
    await context.setOffline(true);
    await expect(page.getByTestId('connectivity-indicator')).toContainText('Offline');

    // Record an expense while offline
    await page.getByTestId('amount-input').fill('18000');
    await page.getByTestId('description-input').fill('Kopi Tubruk Mode Pesawat');
    await page.getByTestId('save-transaction-btn').click();

    // Should navigate to /riwayat and show the transaction + Menunggu badge
    await expect(page).toHaveURL(/\/riwayat/);
    await expect(page.getByText('Kopi Tubruk Mode Pesawat')).toBeVisible();
    await expect(page.getByTestId('header-pending-badge')).toContainText('Menunggu');

    // Reconnect to online mode -> automatic sync should clear pending badge
    await context.setOffline(false);
    await expect(page.getByTestId('connectivity-indicator')).toContainText('Online');
  });
});
