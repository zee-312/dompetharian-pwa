'use client';

/**
 * DompetHarian — Halaman Pemberitahuan Privasi & Pelindungan Data Pribadi (UU PDP)
 * Author / Credit: Aravajordan
 */

import React from 'react';
import Link from 'next/link';

export default function PrivasiPage() {
  return (
    <div className="space-y-4 pb-8">
      <div className="rounded-2xl border border-[#E5DEC9] bg-[#FFFDF9] p-5 shadow-sm space-y-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight font-serif text-[#1C1917]">
            Pemberitahuan Privasi & Pelindungan Data Pribadi
          </h1>
          <p className="mt-1 text-xs text-[#6B635B]">
            Disusun selaras dengan Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data
            Pribadi (UU PDP) Republik Indonesia. Dikembangkan oleh <strong>Aravajordan</strong>.
          </p>
        </div>

        <section className="space-y-2 text-xs text-[#6B635B]">
          <h2 className="text-sm font-bold text-[#1C1917]">1. Prinsip Utama Privasi DompetHarian</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Local-First (Utamakan Perangkat Pengguna):</strong> Catatan transaksi harian
              ditulis terlebih dahulu ke database IndexedDB di HP Android kamu dan disinkronkan ke
              database PostgreSQL (Supabase) yang dilindungi Row-Level Security (RLS) per pengguna.
            </li>
            <li>
              <strong>Foto Struk Milik Pengguna Sendiri:</strong> Foto struk belanja{' '}
              <strong>tidak pernah disimpan di server pengembang</strong>. Foto struk diunggah
              langsung dari browser HP kamu ke folder khusus <code>DompetHarian_Struk</code> di
              Google Drive milikmu menggunakan izin non-sensitif <code>drive.file</code>.
            </li>
            <li>
              <strong>Penghapusan Lokasi GPS (EXIF Stripping):</strong> Sebelum foto struk disimpan
              di antrean lokal atau diunggah ke Google Drive, DompetHarian secara otomatis menghapus
              metadata EXIF (termasuk koordinat lokasi GPS dan informasi kamera) serta mengganti
              nama file menjadi UUID netral.
            </li>
            <li>
              <strong>OCR 100% di Perangkat:</strong> Pembacaan teks struk dilakukan di dalam HP
              menggunakan Web Worker Tesseract.js. Gambar struk tidak pernah dikirim ke layanan AI
              atau OCR pihak ketiga.
            </li>
          </ul>
        </section>

        <section className="space-y-2 text-xs text-[#6B635B]">
          <h2 className="text-sm font-bold text-[#1C1917]">2. Ringkasan Aliran & Retensi Data</h2>
          <div className="overflow-x-auto rounded-xl border border-[#E5DEC9]">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#F3EDE2] text-[#1C1917]">
                <tr>
                  <th className="p-2.5 font-bold">Jenis Data</th>
                  <th className="p-2.5 font-bold">Lokasi Penyimpanan</th>
                  <th className="p-2.5 font-bold">Cara Menghapus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="p-2.5 font-semibold">Transaksi & Kategori</td>
                  <td className="p-2.5">IndexedDB di HP & PostgreSQL (RLS per user_id)</td>
                  <td className="p-2.5">Hapus Transaksi, Hapus Data Lokal, atau Hapus Akun</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold">File Gambar Struk</td>
                  <td className="p-2.5">
                    Antrean sementara IndexedDB (dihapus segera setelah terunggah) & Google Drive
                    pribadi pengguna
                  </td>
                  <td className="p-2.5">Hapus Struk di detail transaksi atau langsung di Drive</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold">Token Google Drive</td>
                  <td className="p-2.5">
                    Hanya di RAM JavaScript browser (tidak pernah disimpan di database/localStorage)
                  </td>
                  <td className="p-2.5">Otomatis hilang saat tab ditutup atau klik Cabut Akses</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold">PIN Kunci Aplikasi</td>
                  <td className="p-2.5">
                    Hash PBKDF2-SHA256 (100.000 iterasi) di localStorage. Memblokir UI, tidak
                    mengenkripsi IndexedDB pada sistem file.
                  </td>
                  <td className="p-2.5">Nonaktifkan PIN di Pengaturan</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2 text-xs text-[#6B635B]">
          <h2 className="text-sm font-bold text-[#1C1917]">
            3. Hak Subjek Data Berdasarkan UU PDP (UU No. 27 Tahun 2022)
          </h2>
          <p>
            Kamu memiliki hak penuh untuk mengakses, memperbaiki, mengekspor (melalui fitur Unduh
            CSV), menarik persetujuan akses Google Drive kapan saja, menghapus seluruh data lokal di
            perangkat, serta menghapus akun beserta seluruh data di server secara permanen melalui
            halaman Pengaturan.
          </p>
        </section>

        <div className="pt-2">
          <Link
            href="/pengaturan"
            className="min-h-touch inline-flex items-center rounded-xl bg-[#2E5A44] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#234735]"
          >
            Kembali ke Pengaturan
          </Link>
        </div>
      </div>
    </div>
  );
}
