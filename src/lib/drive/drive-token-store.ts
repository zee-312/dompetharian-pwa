/**
 * DompetHarian — Google Drive In-Memory Token Store (Milestone 3)
 * Rules:
 * - Uses ONLY scope: https://www.googleapis.com/auth/drive.file (Non-sensitive scope)
 * - Short-lived access token is kept strictly in browser RAM (module variable).
 * - NEVER written to localStorage, sessionStorage, IndexedDB, cookies, or server database.
 * - No long-lived refresh token is ever requested or stored on the server.
 * Author / Credit: Aravajordan
 */

export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DOMPETHARIAN_DRIVE_FOLDER_NAME = 'DompetHarian_Struk';

export interface InMemoryDriveToken {
  accessToken: string;
  expiresAtMs: number;
  scope: string;
  obtainedAt: string;
}

export type DriveConnectionStatus =
  | 'disconnected'
  | 'connected'
  | 'expired'
  | 'revoked';

let inMemoryToken: InMemoryDriveToken | null = null;
let connectionStatus: DriveConnectionStatus = 'disconnected';
let cachedFolderId: string | null = null;

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: {
              access_token?: string;
              expires_in?: number;
              scope?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
          };
          revoke: (accessToken: string, done: () => void) => void;
        };
      };
    };
  }
}

export const DriveTokenStore = {
  /**
   * Sets the short-lived Drive access token in RAM only.
   */
  setToken(accessToken: string, expiresInSeconds = 3600): InMemoryDriveToken {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Token akses Google Drive tidak valid.');
    }
    inMemoryToken = {
      accessToken: accessToken.trim(),
      // Subtract 30s safety buffer
      expiresAtMs: Date.now() + Math.max(60, expiresInSeconds - 30) * 1000,
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      obtainedAt: new Date().toISOString(),
    };
    connectionStatus = 'connected';
    return inMemoryToken;
  },

  /**
   * Retrieves the active token from RAM. If expired, transitions status to 'expired' and returns null.
   */
  getValidToken(nowMs: number = Date.now()): string | null {
    if (!inMemoryToken) return null;
    if (nowMs >= inMemoryToken.expiresAtMs) {
      inMemoryToken = null;
      connectionStatus = 'expired';
      return null;
    }
    return inMemoryToken.accessToken;
  },

  getStatus(nowMs: number = Date.now()): DriveConnectionStatus {
    if (inMemoryToken && nowMs >= inMemoryToken.expiresAtMs) {
      inMemoryToken = null;
      connectionStatus = 'expired';
    }
    return connectionStatus;
  },

  markRevoked(): void {
    inMemoryToken = null;
    cachedFolderId = null;
    connectionStatus = 'revoked';
  },

  markExpired(): void {
    inMemoryToken = null;
    connectionStatus = 'expired';
  },

  getCachedFolderId(): string | null {
    return cachedFolderId;
  },

  setCachedFolderId(folderId: string | null): void {
    cachedFolderId = folderId;
  },

  /**
   * Requests a short-lived token using Google Identity Services in the browser.
   */
  async requestBrowserToken(): Promise<InMemoryDriveToken> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Menghubungkan Google Drive membutuhkan koneksi internet. Aktifkan internet HP kamu terlebih dahulu.'
      );
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
    if (
      typeof window !== 'undefined' &&
      window.google?.accounts?.oauth2 &&
      clientId &&
      !clientId.includes('your-web-client-id')
    ) {
      return new Promise<InMemoryDriveToken>((resolve, reject) => {
        const tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_DRIVE_FILE_SCOPE,
          callback: (resp) => {
            if (resp.error || !resp.access_token) {
              reject(
                new Error(
                  'Otorisasi Google Drive dibatalkan atau ditolak. Kamu tetap bisa menyimpan transaksi tanpa mengunggah struk.'
                )
              );
              return;
            }
            const token = this.setToken(resp.access_token, resp.expires_in ?? 3600);
            resolve(token);
          },
          error_callback: () => {
            reject(
              new Error(
                'Gagal membuka jendela otorisasi Google Drive. Pastikan popup tidak diblokir.'
              )
            );
          },
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });
    }

    // Local/test simulation when GIS script or production Client ID is not loaded:
    // Still keeps the token strictly in RAM and enforces the exact drive.file scope contract.
    return this.setToken(`gis_mem_token_${Date.now()}`, 3600);
  },

  /**
   * Revokes the current token via GIS and wipes it from RAM.
   */
  async revokeAndClear(): Promise<void> {
    const token = inMemoryToken?.accessToken;
    inMemoryToken = null;
    cachedFolderId = null;
    connectionStatus = 'revoked';

    if (
      token &&
      typeof window !== 'undefined' &&
      window.google?.accounts?.oauth2?.revoke
    ) {
      await new Promise<void>((resolve) => {
        window.google!.accounts!.oauth2!.revoke(token, () => resolve());
      });
    }
  },

  resetForTests(): void {
    inMemoryToken = null;
    cachedFolderId = null;
    connectionStatus = 'disconnected';
  },
};
