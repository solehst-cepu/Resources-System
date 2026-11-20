# Lazuardi Resources Management System (LRMS)

**One Portal, All Resources Services** — Sistem manajemen layanan operasional sekolah untuk Divisi Resources Lazuardi (Air Galon, Fotokopi, Laminating, Persediaan Galon, Pelaporan Kepala Unit, dan Analitik Operasional).

---

## 1. Arsitektur & Teknologi

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4
- **Backend API:** Express (`server.ts`) & Vercel Serverless Functions (`api/index.ts`)
- **Database & Auth:** Supabase PostgreSQL + Supabase Auth (Google OAuth `@lazuardi.sch.id`) + Row Level Security (RLS)
- **Storage:** Supabase Storage Private Bucket (`order-documents`) dengan short-lived Signed URL (60 detik)
- **Export & Email:** SheetJS (`xlsx`), `jsPDF` + `jspdf-autotable`, CSV (UTF-8 BOM), Nodemailer SMTP / Resend API

---

## 2. Struktur File Penting

- `supabase/migrations/001_schema.sql` — Tabel master data, order management, inventory, reporting, notifications, dan audit logs.
- `supabase/migrations/002_rls_and_rpcs.sql` — Trigger validasi domain `@lazuardi.sch.id`, kebijakan RLS seluruh tabel, private storage bucket, serta PostgreSQL RPC atomic (`generate_order_number`, `rpc_complete_gallon_delivery`, `rpc_finalize_stock_opname`).
- `supabase/migrations/003_seed_master_data.sql` — Data awal unit Lazuardi, katalog layanan, lokasi gedung, dan saldo gudang galon.
- `server/apiRouter.ts` — API router server-side (verifikasi session, RBAC, upload dokumen privat, transaksi stok atomic, email laporan bulanan).
- `api/index.ts` & `vercel.json` — Konfigurasi deployment Vercel Serverless & Cron bulanan.

---

## 3. Panduan Setup Supabase & Google SSO

1. Buat project baru di **Supabase**.
2. Buka **SQL Editor** dan jalankan secara berurutan:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_rls_and_rpcs.sql`
   - `supabase/migrations/003_seed_master_data.sql`
3. Konfigurasi **Authentication → Providers → Google**:
   - Masukkan Google OAuth Client ID & Client Secret dari Google Cloud Console (Google Workspace `lazuardi.sch.id`).
   - Tambahkan Redirect URL:
     - Development: `http://localhost:3000`
     - Production: `https://<domain-vercel-anda>`
4. Tetapkan Super Admin pertama di Supabase SQL Editor setelah login pertama:
   ```sql
   UPDATE public.user_roles
   SET role = 'super_admin'
   WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'soleh.st@lazuardi.sch.id');
   ```
5. Salin `.env.example` menjadi `.env` dan isi seluruh variabel yang diperlukan (jangan pernah menaruh `SUPABASE_SERVICE_ROLE_KEY` ke variabel `VITE_*`).

---

## 4. Deployment ke GitHub & Vercel

1. Push repository ke GitHub.
2. Import repository ke **Vercel**.
3. Isi Environment Variables di Vercel Project Settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ALLOWED_EMAIL_DOMAIN=lazuardi.sch.id`
   - `CRON_SECRET=<random-secret>`
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (atau `RESEND_API_KEY`)
4. `vercel.json` sudah mengonfigurasi SPA rewrite, `/api/*` routing, serta cron bulanan (`/api/cron/monthly-photocopy-report`).

---

## 5. Skenario Pengujian (QA Checklist)

- **Keamanan Login & Domain:** Login `@lazuardi.sch.id` berhasil; email eksternal (`@gmail.com`) ditolak `403 Forbidden` oleh endpoint server dan trigger database.
- **RBAC:** User hanya melihat/membatalkan order miliknya saat `Menunggu Diproses`; Kepala Unit hanya melihat laporan fotokopi unit yang ditugaskan; Admin Resources tidak dapat mengubah role Super Admin.
- **Perhitungan Fotokopi:** Dokumen 11 halaman × 5 rangkap, 2 sisi → 55 sisi cetak & 30 lembar kertas (`Math.ceil(11/2) * 5`).
- **Transaksi Stok Atomic:** Konfirmasi pengiriman galon mengurangi galon isi, menambah galon kosong, menolak stok negatif, dan mencegah eksekusi ganda.
- **Stock Opname:** Draft → Final menghitung selisih otomatis, mencatat penyesuaian & mutasi, dan mengunci status `Final`.
- **File Privat:** Dokumen fotokopi diunduh melalui Signed URL berumur 60 detik dan ditolak bagi pengguna tidak berwenang.
