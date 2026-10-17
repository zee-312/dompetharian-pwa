/**
 * DompetHarian — Offline-Capable Multi-User Authentication Service (Milestone 1 & 2.5)
 * Rules:
 * 1. Opening the app offline must NOT require a network call; an established local session unlocks local data.
 * 2. First login, registration, and password reset require internet and show a clear Indonesian message when offline.
 * 3. Passwords are NEVER stored in plaintext or reversible form. Only session metadata is stored for offline unlock.
 * 4. If session token is expired/invalid when connectivity returns, prompts re-login WITHOUT deleting pending operations.
 * Author / Credit: Aravajordan
 */

import { getSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/database/supabase-client';

export interface AuthUserSession {
  userId: string;
  email: string;
  displayName: string;
  accessToken: string;
  expiresAtMs: number;
  requiresReauthOnline: boolean;
  establishedAt: string;
}

interface RegisteredAccountEntry {
  userId: string;
  email: string;
  displayName: string;
  passwordSaltHex: string;
  passwordHashHex: string;
  createdAt: string;
}

const ACTIVE_SESSION_KEY = 'dh_active_session_v1';
const REGISTERED_ACCOUNTS_KEY = 'dh_registered_accounts_v1';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPasswordWithSalt(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${saltHex}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function deterministicUserIdFromEmail(email: string): string {
  // Deterministic UUID-like identifier for same email across local logins
  const clean = email.trim().toLowerCase();
  let h1 = 0xdeadbeef ^ clean.length;
  let h2 = 0x41c6ce57 ^ clean.length;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}-${hex2.slice(0, 4)}-4${hex2.slice(5, 8)}-8${hex1.slice(1, 4)}-${hex1}${hex2.slice(0, 4)}`;
}

function loadRegisteredAccounts(): Record<string, RegisteredAccountEntry> {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(REGISTERED_ACCOUNTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, RegisteredAccountEntry>;
  } catch {
    return {};
  }
}

function saveRegisteredAccounts(accounts: Record<string, RegisteredAccountEntry>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(REGISTERED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export const AuthService = {
  /**
   * Synchronously reads the previously established local session so opening the app offline
   * never blocks on a network call.
   */
  getLocalSession(): AuthUserSession | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthUserSession;
      if (!parsed.userId || !parsed.email) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  /**
   * Establishes a default demo/personal session on first visit when online so the user
   * can either immediately record expenses or switch/register their own account.
   */
  ensureDefaultSessionIfNone(): AuthUserSession | null {
    const existing = this.getLocalSession();
    if (existing) return existing;
    if (typeof window === 'undefined') return null;
    // If offline and never logged in before, cannot auto-login
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return null;
    }
    const defaultEmail = 'pengguna@dompetharian.id';
    const userId = deterministicUserIdFromEmail(defaultEmail);
    const session: AuthUserSession = {
      userId,
      email: defaultEmail,
      displayName: 'Pengguna DompetHarian',
      accessToken: `dh_session_${userId}`,
      expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000,
      requiresReauthOnline: false,
      establishedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
    return session;
  },

  async signInWithPassword(email: string, password: string): Promise<AuthUserSession> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Login pertama membutuhkan koneksi internet. Periksa jaringan HP kamu lalu coba lagi.'
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Masukkan alamat email yang valid.');
    }
    if (!password || password.length < 6) {
      throw new Error('Kata sandi minimal 6 karakter.');
    }

    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (error || !data.user || !data.session) {
        throw new Error(error?.message ?? 'Email atau kata sandi salah.');
      }
      const session: AuthUserSession = {
        userId: data.user.id,
        email: data.user.email ?? cleanEmail,
        displayName:
          (data.user.user_metadata?.display_name as string) ||
          cleanEmail.split('@')[0] ||
          'Pengguna',
        accessToken: data.session.access_token,
        expiresAtMs: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
        requiresReauthOnline: false,
        establishedAt: new Date().toISOString(),
      };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
      }
      return session;
    }

    // Local/test multi-user authentication store
    const accounts = loadRegisteredAccounts();
    const existingAccount = accounts[cleanEmail];
    if (existingAccount) {
      const candidateHash = await hashPasswordWithSalt(password, existingAccount.passwordSaltHex);
      if (candidateHash !== existingAccount.passwordHashHex) {
        throw new Error('Email atau kata sandi yang kamu masukkan tidak cocok.');
      }
      const session: AuthUserSession = {
        userId: existingAccount.userId,
        email: existingAccount.email,
        displayName: existingAccount.displayName,
        accessToken: `dh_session_${existingAccount.userId}`,
        expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000,
        requiresReauthOnline: false,
        establishedAt: new Date().toISOString(),
      };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
      }
      return session;
    }

    // First-time sign-in with this email creates or binds the deterministic account
    return this.registerAccount(cleanEmail, password, cleanEmail.split('@')[0] ?? 'Pengguna');
  },

  async registerAccount(
    email: string,
    password: string,
    displayName: string
  ): Promise<AuthUserSession> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Pendaftaran akun baru membutuhkan koneksi internet. Sambungkan HP ke internet lalu coba lagi.'
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Masukkan alamat email yang valid.');
    }
    if (!password || password.length < 8) {
      throw new Error('Kata sandi untuk pendaftaran minimal 8 karakter.');
    }

    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (error || !data.user) {
        throw new Error(error?.message ?? 'Gagal mendaftarkan akun baru.');
      }
      const session: AuthUserSession = {
        userId: data.user.id,
        email: cleanEmail,
        displayName: displayName.trim() || cleanEmail.split('@')[0] || 'Pengguna',
        accessToken: data.session?.access_token ?? `dh_session_${data.user.id}`,
        expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000,
        requiresReauthOnline: false,
        establishedAt: new Date().toISOString(),
      };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
      }
      return session;
    }

    const accounts = loadRegisteredAccounts();
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const saltHex = bytesToHex(saltBytes);
    const hashHex = await hashPasswordWithSalt(password, saltHex);
    const userId = deterministicUserIdFromEmail(cleanEmail);

    accounts[cleanEmail] = {
      userId,
      email: cleanEmail,
      displayName: displayName.trim() || cleanEmail.split('@')[0] || 'Pengguna',
      passwordSaltHex: saltHex,
      passwordHashHex: hashHex,
      createdAt: new Date().toISOString(),
    };
    saveRegisteredAccounts(accounts);

    const session: AuthUserSession = {
      userId,
      email: cleanEmail,
      displayName: accounts[cleanEmail].displayName,
      accessToken: `dh_session_${userId}`,
      expiresAtMs: Date.now() + 7 * 24 * 3600 * 1000,
      requiresReauthOnline: false,
      establishedAt: new Date().toISOString(),
    };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
    }
    return session;
  },

  async requestPasswordReset(email: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error(
        'Reset kata sandi membutuhkan koneksi internet. Sambungkan HP ke internet terlebih dahulu.'
      );
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Masukkan alamat email yang valid untuk reset kata sandi.');
    }
    const supabase = getSupabaseBrowserClient();
    if (supabase && isSupabaseConfigured()) {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) throw new Error(error.message);
    }
  },

  /**
   * Marks the current session as requiring online re-authentication WITHOUT deleting
   * any pending sync operations in IndexedDB (Milestone 2.5).
   */
  markSessionRequiresReauth(): void {
    const current = this.getLocalSession();
    if (!current || typeof window === 'undefined') return;
    const updated: AuthUserSession = {
      ...current,
      requiresReauthOnline: true,
    };
    window.localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(updated));
  },

  clearActiveSession(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  },

  removeRegisteredAccount(email: string): void {
    const accounts = loadRegisteredAccounts();
    delete accounts[email.trim().toLowerCase()];
    saveRegisteredAccounts(accounts);
  },
};
