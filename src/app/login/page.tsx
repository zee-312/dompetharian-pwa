'use client';

/**
 * DompetHarian — Halaman Masuk, Daftar & Reset Kata Sandi (Milestone 1 & 2.5)
 * Rules:
 * - Follows modern-web-guidance: autofill-sign-in-form & validate-input-after-interaction.
 * - Uses semantic <form>, type="email", autocomplete="email", autocomplete="current-password" / "new-password".
 * - Places hints and validation rules ABOVE the input so mobile keyboards do not obscure them.
 * - Never blocks password pasting.
 * - Shows a clear Indonesian message when offline instead of failing silently.
 * Author / Credit: Aravajordan
 */

import React, { useState } from 'react';
import { useApp } from '@/components/layout/AppContext';
import { AuthService } from '@/features/auth/auth-service';

type AuthMode = 'login' | 'register' | 'reset';

export default function LoginPage() {
  const { isOnline, switchOrUpdateSession, navigateTo } = useApp();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      setErrorMsg(
        mode === 'login'
          ? 'Login akun baru membutuhkan koneksi internet. Jika kamu sudah pernah login di HP ini, kembali ke Beranda untuk menggunakan sesi offline.'
          : mode === 'register'
            ? 'Pendaftaran akun baru membutuhkan koneksi internet. Periksa koneksi HP kamu lalu coba lagi.'
            : 'Reset kata sandi membutuhkan koneksi internet.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        const newSession = await AuthService.signInWithPassword(email, password);
        await switchOrUpdateSession(newSession);
        navigateTo('/beranda');
      } else if (mode === 'register') {
        const newSession = await AuthService.registerAccount(email, password, displayName);
        await switchOrUpdateSession(newSession);
        navigateTo('/beranda');
      } else {
        await AuthService.requestPasswordReset(email);
        setInfoMsg(
          'Jika alamat email terdaftar, tautan instruksi reset kata sandi telah dikirimkan ke email kamu.'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses permintaan autentikasi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4 pb-8">
      <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-5 shadow-sm space-y-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight font-serif text-[#1C1917]">
            {mode === 'login'
              ? 'Masuk ke DompetHarian'
              : mode === 'register'
                ? 'Daftar Akun DompetHarian'
                : 'Reset Kata Sandi'}
          </h1>
          <p className="mt-1 text-xs text-[#6B635B]">
            Setiap akun memiliki ruang penyimpanan lokal (IndexedDB) yang terpisah dan terisolasi
            sepenuhnya di HP ini.
          </p>
        </div>

        {/* Mode Switch Tabs */}
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#F3EDE2] p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            data-testid="tab-auth-login"
            className={`min-h-touch rounded-lg py-2 text-xs font-bold ${
              mode === 'login' ? 'bg-[#FFFDF9] text-[#1E402F] shadow-sm' : 'text-[#6B635B]'
            }`}
          >
            Masuk
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            data-testid="tab-auth-register"
            className={`min-h-touch rounded-lg py-2 text-xs font-bold ${
              mode === 'register' ? 'bg-[#FFFDF9] text-[#1E402F] shadow-sm' : 'text-[#6B635B]'
            }`}
          >
            Daftar Baru
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('reset');
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            data-testid="tab-auth-reset"
            className={`min-h-touch rounded-lg py-2 text-xs font-bold ${
              mode === 'reset' ? 'bg-[#FFFDF9] text-[#1E402F] shadow-sm' : 'text-[#6B635B]'
            }`}
          >
            Lupa Sandi
          </button>
        </div>

        {!isOnline && (
          <div
            role="status"
            data-testid="auth-offline-warning"
            className="rounded-xl border border-[#EDD295] bg-[#FDF3DC] p-3 text-xs text-[#7A520B]"
          >
            <p className="font-bold">Perangkat Sedang Offline</p>
            <p className="mt-0.5">
              Login pertama, pendaftaran akun, dan reset kata sandi membutuhkan koneksi internet.
            </p>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-error-message"
            className="rounded-xl border border-[#E8BFB0] bg-[#F9E6DF] p-3 text-xs font-medium text-[#9A3B1B]"
          >
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            data-testid="auth-info-message"
            className="rounded-xl border border-[#B8D4C5] bg-[#E3EFE8] p-3 text-xs font-medium text-[#1E402F]"
          >
            {infoMsg}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'register' && (
            <div className="field-group">
              <label htmlFor="auth-display-name" className="block text-xs font-bold text-[#1C1917]">
                Nama Panggilan
              </label>
              <span id="name-rules" className="block text-[11px] text-[#6B635B]">
                Nama yang ditampilkan di beranda aplikasi (minimal 2 karakter).
              </span>
              <input
                id="auth-display-name"
                name="name"
                type="text"
                autoComplete="name"
                required
                minLength={2}
                maxLength={60}
                aria-describedby="name-rules"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Contoh: Budi Santoso"
                data-testid="auth-name-input"
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
            </div>
          )}

          <div className="field-group">
            <label htmlFor="auth-email" className="block text-xs font-bold text-[#1C1917]">
              Alamat Email
            </label>
            <span id="email-rules" className="block text-[11px] text-[#6B635B]">
              Gunakan alamat email aktif (contoh: nama@domain.com).
            </span>
            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-describedby="email-rules email-error"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@email.com"
              data-testid="auth-email-input"
              className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3.5 py-2.5 text-sm text-[#1C1917]"
            />
            <span id="email-error" className="error-message" role="alert">
              Masukkan format alamat email yang valid.
            </span>
          </div>

          {mode !== 'reset' && (
            <div className="field-group">
              <label htmlFor="auth-password" className="block text-xs font-bold text-[#1C1917]">
                Kata Sandi
              </label>
              <span id="password-rules" className="block text-[11px] text-[#6B635B]">
                {mode === 'register'
                  ? 'Minimal 8 karakter. Mendukung tempel (paste) dari pengelola kata sandi.'
                  : 'Masukkan kata sandi akun kamu (minimal 6 karakter).'}
              </span>
              <input
                id="auth-password"
                name="password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'register' ? 8 : 6}
                aria-describedby="password-rules password-error"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                data-testid="auth-password-input"
                className="mt-1 min-h-touch w-full rounded-xl border border-[#D8CEBE] px-3.5 py-2.5 text-sm text-[#1C1917]"
              />
              <span id="password-error" className="error-message" role="alert">
                Kata sandi belum memenuhi panjang karakter minimum.
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid="btn-auth-submit"
            className="min-h-touch w-full rounded-xl bg-[#2E5A44] px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#234735] disabled:opacity-50"
          >
            {isSubmitting
              ? 'Memproses...'
              : mode === 'login'
                ? 'Masuk Sekarang'
                : mode === 'register'
                  ? 'Daftar & Buat Ruang Lokal'
                  : 'Kirim Tautan Reset Sandi'}
          </button>
        </form>
      </div>
    </div>
  );
}
