import React, { useState } from 'react';
import { AlertCircle, ArrowRight, Building2, Lock, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

const QUICK_TEST_ACCOUNTS = [
  { email: 'soleh.st@lazuardi.sch.id', label: 'Super Admin', detail: 'Soleh Santoso · Akses penuh' },
  { email: 'petugas.resources@lazuardi.sch.id', label: 'Admin Resources', detail: 'Budi Hermawan · Operasional & Stok' },
  { email: 'ahmad.fauzan@lazuardi.sch.id', label: 'Kepala Unit SD', detail: 'Ahmad Fauzan · Laporan Unit SD' },
  { email: 'siti.aminah@lazuardi.sch.id', label: 'User / Guru SD', detail: 'Siti Aminah · Pemesan Layanan' },
];

export function LoginView() {
  const { systemStatus, signInGoogle, signInLocalEmail, authError } = useAuth();
  const [emailInput, setEmailInput] = useState('soleh.st@lazuardi.sch.id');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [externalOAuthUrl, setExternalOAuthUrl] = useState<string | null>(null);

  const isSupabaseMode = systemStatus?.mode === 'supabase';
  const allowedDomain = systemStatus?.allowedDomain || 'lazuardi.sch.id';

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    setLocalError(null);
    setExternalOAuthUrl(null);
    try {
      const res = await signInGoogle();
      if (res?.externalTabUrl) {
        setExternalOAuthUrl(res.externalTabUrl);
        setSubmitting(false);
      }
    } catch (err) {
      setLocalError((err as Error).message);
      setSubmitting(false);
    }
  };

  const handleLocalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await signInLocalEmail(emailInput);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Panel Kiri: Identitas Sistem */}
        <div className="lg:col-span-5 bg-[#1755CE] text-white p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center border border-white/20">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight">LRMS Portal</div>
                <div className="text-xs text-blue-100">Divisi Resources Lazuardi</div>
              </div>
            </div>

            <h1 className="mt-8 text-2xl font-bold tracking-tight leading-snug text-balance">
              Lazuardi Resources Management System
            </h1>
            <p className="mt-3 text-sm text-blue-100 leading-relaxed">
              One Portal, All Resources Services. Pengelolaan terpadu permintaan Air Galon,
              Fotokopi, Laminating, persediaan gudang, dan pelaporan operasional sekolah.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-white/15 space-y-2.5 text-xs text-blue-100">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-white shrink-0" />
              <span>Wajib akun Google Workspace @{allowedDomain}</span>
            </div>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-white shrink-0" />
              <span>Kontrol akses berbasis peran &amp; isolasi laporan unit</span>
            </div>
          </div>
        </div>

        {/* Panel Kanan: Autentikasi */}
        <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Masuk ke Portal Layanan</h2>
            <p className="mt-1.5 text-sm text-slate-600">
              Gunakan akun Google resmi sekolah (@{allowedDomain}) untuk melanjutkan.
            </p>
          </div>

          {(localError || authError) && (
            <div className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <span>{localError || authError}</span>
            </div>
          )}

          {isSupabaseMode ? (
            <div className="mt-6 space-y-4">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold text-sm transition-colors disabled:opacity-60"
              >
                <span>{submitting ? 'Mengalihkan ke Google SSO...' : 'Masuk dengan Google (@lazuardi.sch.id)'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              {externalOAuthUrl && (
                <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-slate-700 space-y-2.5">
                  <p>
                    Login Google diblokir jika dijalankan di dalam frame preview (403). Klik tombol di bawah untuk
                    membuka login Google di tab browser baru:
                  </p>
                  <a
                    href={externalOAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold text-xs transition-colors"
                  >
                    <span>Lanjutkan Login Google di Tab Baru</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Email di luar domain @{allowedDomain} akan otomatis ditolak oleh validasi server dan database Supabase.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed space-y-1.5">
                {systemStatus?.hasPublicCredentials ? (
                  <>
                    <div>
                      <strong>Supabase Terhubung (Menunggu Service Role Key):</strong> Proyek{' '}
                      <code className="font-mono">{systemStatus.supabaseProjectUrl}</code> sudah dikonfigurasi pada frontend.
                    </div>
                    <div>
                      Tambahkan <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> di panel <strong>Secrets</strong> dan jalankan{' '}
                      <code className="font-mono">supabase/setup_all.sql</code> di Supabase SQL Editor untuk mengaktifkan mode produksi penuh. Sementara itu, mode lokal persisten tetap berjalan.
                    </div>
                  </>
                ) : (
                  <div>
                    <strong>Mode Evaluasi Lokal Aktif:</strong> Variabel <code className="font-mono">VITE_SUPABASE_URL</code> dan{' '}
                    <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> belum diisi pada environment. Validasi domain{' '}
                    <code className="font-mono">@{allowedDomain}</code> dan seluruh transaksi database berjalan pada server lokal persisten.
                  </div>
                )}
              </div>

              <form onSubmit={handleLocalSubmit} className="space-y-4">
                <div>
                  <label htmlFor="sso-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Email Google Sekolah (@{allowedDomain})
                  </label>
                  <input
                    id="sso-email"
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder={`nama@${allowedDomain}`}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold text-sm transition-colors disabled:opacity-60"
                >
                  <span>{submitting ? 'Memverifikasi domain & sesi...' : 'Masuk via Simulasi Google SSO'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="pt-4 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-700 mb-2.5">
                  Akun Uji Berdasarkan Role (Pengujian RBAC)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {QUICK_TEST_ACCOUNTS.map((acc) => (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => {
                        setEmailInput(acc.email);
                        setLocalError(null);
                      }}
                      className="text-left p-2.5 rounded-lg border border-slate-200 hover:border-[#1755CE] hover:bg-slate-50 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-900">{acc.label}</div>
                      <div className="text-[11px] text-slate-500 truncate">{acc.detail}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
