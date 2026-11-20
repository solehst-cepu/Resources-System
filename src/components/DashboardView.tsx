import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Droplets,
  FileBarChart2,
  Layers,
  Package,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import type { DashboardSummary, OrderRecord } from '../types/lrms.ts';
import { formatDateID, formatDateTimeID, getServiceLabel } from '../utils/calculations.ts';
import { OrderStatusText } from './StatusText.tsx';
import { HorizontalUnitBarChart, OrderTrendChart, PhotocopyVolumeChart } from './Charts.tsx';

export type NavSection =
  | 'dashboard'
  | 'order_galon'
  | 'order_fotokopi'
  | 'order_laminating'
  | 'my_orders'
  | 'order_management'
  | 'inventory_galon'
  | 'kepala_unit_report'
  | 'reports_analytics'
  | 'master_data'
  | 'google_drive'
  | 'settings_audit';

export function DashboardView({
  onNavigate,
  onSelectOrder,
}: {
  onNavigate: (section: NavSection) => void;
  onSelectOrder: (orderId: string) => void;
}) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<DashboardSummary>('/dashboard/summary');
      setSummary(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-6 bg-white border border-red-200 rounded-xl text-sm text-red-700 flex items-center justify-between">
        <span>Gagal memuat ringkasan dashboard: {error}</span>
        <button
          type="button"
          onClick={loadSummary}
          className="px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-semibold"
        >
          Muat Ulang
        </button>
      </div>
    );
  }

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin_resources';
  const isKepalaUnit = user?.role === 'kepala_unit';

  if (!isAdmin) {
    const activeOrders = summary.recentOrders.filter(
      (o) => !['Selesai', 'Dibatalkan'].includes(o.status)
    );
    return (
      <div className="space-y-6">
        {/* Aksi Cepat Pemesanan */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Selamat Datang, {user?.full_name}
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Pilih layanan operasional Divisi Resources untuk membuat permintaan baru tanpa perlu persetujuan berjenjang.
              </p>
            </div>
            {isKepalaUnit && (
              <button
                type="button"
                onClick={() => onNavigate('kepala_unit_report')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                <FileBarChart2 className="w-4 h-4" />
                <span>Laporan Fotokopi Unit</span>
              </button>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => onNavigate('order_galon')}
              className="group text-left p-4 rounded-xl border border-slate-200 hover:border-[#1755CE] hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-center justify-between">
                <Droplets className="w-5 h-5 text-[#1755CE]" />
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#1755CE] transition-colors" />
              </div>
              <div className="mt-3 text-sm font-bold text-slate-900">Order Air Galon</div>
              <p className="mt-1 text-xs text-slate-600">
                Permintaan pengiriman galon isi &amp; penukaran galon kosong unit.
              </p>
              <div className="mt-2.5 text-xs font-mono tabular-nums text-slate-500">
                Stok tersedia: {summary.gallonStockAvailable} galon
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('order_fotokopi')}
              className="group text-left p-4 rounded-xl border border-slate-200 hover:border-[#1755CE] hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-center justify-between">
                <Copy className="w-5 h-5 text-[#1755CE]" />
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#1755CE] transition-colors" />
              </div>
              <div className="mt-3 text-sm font-bold text-slate-900">Order Fotokopi</div>
              <p className="mt-1 text-xs text-slate-600">
                Unggah dokumen ajar/ujian, atur rangkap, ukuran, &amp; finishing.
              </p>
              <div className="mt-2.5 text-xs text-slate-500">
                Langsung masuk antrean cetak Resources
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('order_laminating')}
              className="group text-left p-4 rounded-xl border border-slate-200 hover:border-[#1755CE] hover:bg-slate-50/70 transition-colors"
            >
              <div className="flex items-center justify-between">
                <Layers className="w-5 h-5 text-[#1755CE]" />
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-[#1755CE] transition-colors" />
              </div>
              <div className="mt-3 text-sm font-bold text-slate-900">Order Laminating</div>
              <p className="mt-1 text-xs text-slate-600">
                Pelapisan dokumen A4, F4, A3, ID Card, atau ukuran custom.
              </p>
              <div className="mt-2.5 text-xs text-slate-500">
                Estimasi penyelesaian terukur
              </div>
            </button>
          </div>
        </div>

        {/* Ringkasan Angka Pribadi / Unit */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Order Aktif" value={activeOrders.length} subtext="Sedang antre / diproses" />
          <StatCard label="Selesai" value={summary.completedOrders} subtext="Total riwayat selesai" tone="success" />
          <StatCard label="Order Fotokopi" value={summary.photocopyOrders} subtext="Tercatat dalam sistem" />
          <StatCard label="Dibatalkan" value={summary.cancelledOrders} subtext="Total pembatalan" />
        </div>

        {/* Order Aktif & Riwayat */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {isKepalaUnit ? 'Order Terbaru & Aktivitas Fotokopi Unit' : 'Pesanan Terakhir Saya'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Klik baris order untuk melihat detail, status progres, atau membatalkan pesanan yang belum diproses.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('my_orders')}
              className="text-xs font-semibold text-[#1755CE] hover:underline whitespace-nowrap shrink-0"
            >
              Lihat Semua Riwayat
            </button>
          </div>
          <OrderCompactTable orders={summary.recentOrders} onSelectOrder={onSelectOrder} />
        </div>
      </div>
    );
  }

  // Dashboard Super Admin / Admin Resources
  return (
    <div className="space-y-6">
      {/* Peringatan Stok Kritis & Order Terlambat */}
      {(summary.isCriticalStock || summary.overdueOrdersCount > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-900 space-y-0.5">
              {summary.isCriticalStock && (
                <p className="font-semibold">
                  Peringatan Stok Minimum Air Galon: Tersedia {summary.gallonStockFilled} galon isi (batas minimum{' '}
                  {summary.gallonMinThreshold} galon).
                </p>
              )}
              {summary.overdueOrdersCount > 0 && (
                <p className="text-xs text-red-800">
                  Terdapat {summary.overdueOrdersCount} order aktif melewati tanggal kebutuhan yang belum selesai.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(summary.isCriticalStock ? 'inventory_galon' : 'order_management')}
            className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
          >
            Tindak Lanjuti
          </button>
        </div>
      )}

      {/* Baris KPI Utama (Order) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <StatCard label="Order Hari Ini" value={summary.todayTotal} subtext="Masuk hari ini" />
        <StatCard label="Order Baru" value={summary.newOrders} subtext="Menunggu diproses" tone="accent" />
        <StatCard label="Dalam Proses" value={summary.inProgressOrders} subtext="Diproses / Kirim / Siap" tone="warning" />
        <StatCard label="Order Selesai" value={summary.completedOrders} subtext="Terselesaikan" tone="success" />
        <StatCard label="Dibatalkan" value={summary.cancelledOrders} subtext="Total dibatalkan" tone="danger" />
        <StatCard
          label="Stok Galon Isi"
          value={summary.gallonStockFilled}
          subtext={`Tersedia bebas: ${summary.gallonStockAvailable} · Kosong: ${summary.gallonStockEmpty}`}
          tone={summary.isCriticalStock ? 'danger' : 'default'}
        />
      </div>

      {/* Ringkasan per Layanan */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Total Permintaan Air Galon</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {summary.gallonOrders}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Dialokasikan antrean: {summary.gallonStockAllocated} galon
            </div>
          </div>
          <Droplets className="w-8 h-8 text-[#1755CE]/80" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Total Order Fotokopi</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {summary.photocopyOrders}
            </div>
            <div className="mt-1 text-xs text-slate-500">Tercatat untuk laporan unit bulanan</div>
          </div>
          <Copy className="w-8 h-8 text-amber-600/80" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Total Order Laminating</div>
            <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {summary.laminatingOrders}
            </div>
            <div className="mt-1 text-xs text-slate-500">Pelapisan dokumen &amp; ID Card</div>
          </div>
          <Layers className="w-8 h-8 text-emerald-600/80" />
        </div>
      </div>

      {/* Grafik Operasional */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-900">Tren Pesanan (7 Hari)</h3>
            <button
              type="button"
              onClick={loadSummary}
              className="text-slate-400 hover:text-slate-700 p-1 rounded"
              title="Segarkan data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <OrderTrendChart data={summary.trendByDay} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Volume Fotokopi Bulanan</h3>
          <PhotocopyVolumeChart data={summary.photocopyVolumeByMonth} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Distribusi Order per Unit</h3>
          <HorizontalUnitBarChart data={summary.ordersByUnit} />
        </div>
      </div>

      {/* Antrean Pekerjaan Belum Selesai & Permintaan Terbaru */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Antrean Belum Selesai</h3>
              <p className="text-xs text-slate-500">Order yang memerlukan tindakan Divisi Resources</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('order_management')}
              className="text-xs font-semibold text-[#1755CE] hover:underline whitespace-nowrap shrink-0"
            >
              Buka Order Management
            </button>
          </div>
          <OrderCompactTable orders={summary.pendingQueue} onSelectOrder={onSelectOrder} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Permintaan Terbaru</h3>
              <p className="text-xs text-slate-500">Aktivitas pesanan masuk lintas layanan</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory_galon')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-[#1755CE] whitespace-nowrap shrink-0"
            >
              <Package className="w-3.5 h-3.5" />
              <span>Monitor Stok Galon</span>
            </button>
          </div>
          <OrderCompactTable orders={summary.recentOrders} onSelectOrder={onSelectOrder} />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtext,
  tone = 'default',
}: {
  label: string;
  value: number;
  subtext: string;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  const valueColor =
    tone === 'accent'
      ? 'text-[#1755CE]'
      : tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
      ? 'text-amber-700'
      : tone === 'danger'
      ? 'text-red-700'
      : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500 truncate">{label}</div>
      <div className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${valueColor}`}>
        {value.toLocaleString('id-ID')}
      </div>
      <div className="mt-1 text-[11px] text-slate-500 truncate">{subtext}</div>
    </div>
  );
}

function OrderCompactTable({
  orders,
  onSelectOrder,
}: {
  orders: OrderRecord[];
  onSelectOrder: (id: string) => void;
}) {
  if (orders.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        Belum ada pesanan untuk ditampilkan.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
            <th className="py-2.5 px-4">No. Order</th>
            <th className="py-2.5 px-3">Layanan &amp; Unit</th>
            <th className="py-2.5 px-3">Kebutuhan</th>
            <th className="py-2.5 px-4 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {orders.map((o) => (
            <tr
              key={o.id}
              onClick={() => onSelectOrder(o.id)}
              className="hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE] whitespace-nowrap">
                {o.order_number}
              </td>
              <td className="py-2.5 px-3">
                <div className="font-medium text-slate-900">
                  {getServiceLabel(o.service_type)} · {o.unit_name}
                </div>
                <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                  {o.requester_name}
                </div>
              </td>
              <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                {formatDateID(o.needed_date)}
                <div className="text-[11px] text-slate-400">{formatDateTimeID(o.created_at)}</div>
              </td>
              <td className="py-2.5 px-4 text-right">
                <OrderStatusText status={o.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
