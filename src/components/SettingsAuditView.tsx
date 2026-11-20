import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Settings, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { AppSettingsMap, AuditLogRecord } from '../types/lrms.ts';
import { formatDateTimeID } from '../utils/calculations.ts';

export function SettingsAuditView() {
  const { systemStatus } = useAuth();
  const { showToast } = useToast();

  const [settings, setSettings] = useState<AppSettingsMap>({
    allowed_email_domain: 'lazuardi.sch.id',
    gallon_min_stock: 15,
    file_retention_days: 90,
    monthly_report_day: 1,
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [master, logs] = await Promise.all([
        apiRequest<{ settings: AppSettingsMap }>('/master'),
        apiRequest<{ items: AuditLogRecord[] }>('/audit-logs?page=1&pageSize=30'),
      ]);
      setSettings(master.settings);
      setAuditLogs(logs.items);
    } catch (err) {
      showToast('Gagal Memuat Pengaturan', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest('/master/settings', {
        method: 'PATCH',
        body: settings,
      });
      showToast('Pengaturan Sistem Disimpan', 'Konfigurasi operasional berhasil diperbarui.');
      await loadAll();
    } catch (err) {
      showToast('Gagal Menyimpan Pengaturan', (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Pengaturan Sistem &amp; Audit Log</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Konfigurasi ambang batas persediaan, kebijakan retensi dokumen, serta jejak audit aktivitas sistem.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSaveSettings}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs h-fit"
        >
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <Settings className="w-4 h-4 text-[#1755CE]" />
            <h3 className="text-sm font-bold text-slate-900">Konfigurasi Operasional</h3>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Domain Google SSO</label>
            <input
              type="text"
              disabled
              value={settings.allowed_email_domain}
              className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Batas Minimum Galon Isi
              </label>
              <input
                type="number"
                min={0}
                value={settings.gallon_min_stock}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, gallon_min_stock: Math.max(0, Number(e.target.value)) }))
                }
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Retensi File Fotokopi (Hari)
              </label>
              <input
                type="number"
                min={7}
                value={settings.file_retention_days}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, file_retention_days: Math.max(7, Number(e.target.value)) }))
                }
                className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Tanggal Kirim Laporan Bulanan Kepala Unit
            </label>
            <input
              type="number"
              min={1}
              max={28}
              value={settings.monthly_report_day}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  monthly_report_day: Math.min(28, Math.max(1, Number(e.target.value))),
                }))
              }
              className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-[#1755CE] text-white font-semibold"
          >
            Simpan Konfigurasi
          </button>

          <div className="pt-3 border-t border-slate-200 space-y-2 text-[11px]">
            <div className="font-semibold text-slate-700">Status Integrasi Environment</div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Database &amp; Auth Mode</span>
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-900">
                {systemStatus?.supabaseConfigured ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Supabase Production</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                    <span>Lokal (Menunggu Env Supabase)</span>
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Layanan Email Bulanan (SMTP / Resend)</span>
              <span className="font-mono font-semibold text-slate-900">
                {systemStatus?.smtpConfigured ? 'Terkonfigurasi' : 'Belum Dikonfigurasi'}
              </span>
            </div>
          </div>
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Audit Log Aktivitas Penting</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-2.5 px-4">Waktu</th>
                  <th className="py-2.5 px-3">Aktor</th>
                  <th className="py-2.5 px-3">Aksi</th>
                  <th className="py-2.5 px-4">Entitas &amp; Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatDateTimeID(log.created_at)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{log.actor_email}</div>
                      <div className="text-[11px] text-slate-500">{log.actor_role}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-[#1755CE]">{log.action}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 max-w-[260px] truncate">
                      {log.entity_type}: {JSON.stringify(log.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
