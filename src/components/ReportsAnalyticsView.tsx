import React, { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Download, FileSpreadsheet, FileText, HardDrive, Printer } from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type {
  InventoryTransaction,
  OrderRecord,
  ReportAdminAuthorization,
  StockOpnameRecord,
  Unit,
} from '../types/lrms.ts';
import { formatDateID, formatDateTimeID, getServiceLabel } from '../utils/calculations.ts';
import { buildPDFBlob, exportToCSV, exportToExcel, exportToPDF, type ExportColumn } from '../utils/exportUtils.ts';
import { HorizontalUnitBarChart } from './Charts.tsx';
import { SaveToDriveConfirmModal } from './GoogleDrivePickerModal.tsx';
import { PrintReportHeader, ReportSignatureBlock } from './ReportSignatureBlock.tsx';

type ReportCategory =
  | 'permintaan_galon'
  | 'distribusi_galon'
  | 'stock_opname'
  | 'mutasi_persediaan'
  | 'fotokopi'
  | 'laminating'
  | 'kinerja_layanan'
  | 'penggunaan_unit';

const REPORT_MENU: Array<{ key: ReportCategory; label: string; kepalaUnitAllowed?: boolean }> = [
  { key: 'permintaan_galon', label: '1. Permintaan Air Galon', kepalaUnitAllowed: true },
  { key: 'distribusi_galon', label: '2. Distribusi Galon', kepalaUnitAllowed: true },
  { key: 'stock_opname', label: '3. Stock Opname', kepalaUnitAllowed: false },
  { key: 'mutasi_persediaan', label: '4. Mutasi Persediaan', kepalaUnitAllowed: false },
  { key: 'fotokopi', label: '5. Laporan Fotokopi', kepalaUnitAllowed: true },
  { key: 'laminating', label: '6. Laporan Laminating', kepalaUnitAllowed: true },
  { key: 'kinerja_layanan', label: '7. Kinerja Layanan', kepalaUnitAllowed: false },
  { key: 'penggunaan_unit', label: '8. Penggunaan per Unit', kepalaUnitAllowed: true },
];

export function ReportsAnalyticsView() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [reportType, setReportType] = useState<ReportCategory>('penggunaan_unit');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [unitId, setUnitId] = useState('all');
  const [status, setStatus] = useState('all');

  const [units, setUnits] = useState<Unit[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [opnames, setOpnames] = useState<StockOpnameRecord[]>([]);
  const [reportAuthorization, setReportAuthorization] = useState<ReportAdminAuthorization | null>(null);
  const [loading, setLoading] = useState(true);
  const [driveSaveOpen, setDriveSaveOpen] = useState(false);

  const isKepalaUnit = user?.role === 'kepala_unit';

  useEffect(() => {
    apiRequest<{ units: Unit[] }>('/master')
      .then((m) => {
        if (isKepalaUnit && user?.head_unit_ids) {
          const own = m.units.filter((u) => user.head_unit_ids.includes(u.id));
          setUnits(own);
          if (own.length === 1) setUnitId(own[0].id);
        } else {
          setUnits(m.units);
        }
      })
      .catch(() => undefined);
  }, [isKepalaUnit, user?.head_unit_ids]);

  const fetchAnalytics = useCallback(async () => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      showToast('Rentang Tanggal Tidak Valid', 'Tanggal awal tidak boleh melebihi tanggal akhir.', 'warning');
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        type: reportType,
        unitId,
        status,
      });
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);

      const res = await apiRequest<{
        orders: OrderRecord[];
        transactions: InventoryTransaction[];
        opnames: StockOpnameRecord[];
        reportAuthorization?: ReportAdminAuthorization;
      }>(`/reports/analytics?${qs.toString()}`);

      setOrders(res.orders);
      setTransactions(res.transactions);
      setOpnames(res.opnames);
      if (res.reportAuthorization) setReportAuthorization(res.reportAuthorization);
    } catch (err) {
      showToast('Gagal Memuat Analitik', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [reportType, unitId, status, dateFrom, dateTo, showToast]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const applyQuickRange = (preset: '7d' | '30d' | 'month' | 'year' | 'all') => {
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    let start = end;
    if (preset === '7d') {
      start = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    } else if (preset === '30d') {
      start = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
    } else if (preset === 'month') {
      start = `${end.slice(0, 7)}-01`;
    } else if (preset === 'year') {
      start = `${end.slice(0, 4)}-01-01`;
    }
    setDateFrom(start);
    setDateTo(end);
  };

  const galonOrders = orders.filter((o) => o.service_type === 'galon');
  const photocopyOrders = orders.filter((o) => o.service_type === 'fotokopi');
  const laminatingOrders = orders.filter((o) => o.service_type === 'laminating');

  const totalGalonRequested = galonOrders.reduce((acc, o) => acc + (o.item.gallon_requested_qty || 0), 0);
  const totalGalonDelivered = galonOrders.reduce((acc, o) => acc + (o.item.gallon_delivered_qty || 0), 0);
  const totalGalonEmptyReturned = galonOrders.reduce((acc, o) => acc + (o.item.gallon_empty_received_qty || 0), 0);

  const totalPhotocopySides = photocopyOrders.reduce((acc, o) => acc + (o.item.total_print_sides || 0), 0);
  const totalPhotocopySheets = photocopyOrders.reduce((acc, o) => acc + (o.item.total_paper_sheets || 0), 0);

  const totalLaminatingRequested = laminatingOrders.reduce((acc, o) => acc + (o.item.laminating_sheets || 0), 0);
  const totalLaminatingActual = laminatingOrders.reduce(
    (acc, o) => acc + (o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0),
    0
  );

  const unitAggregation = Array.from(
    orders.reduce((map, o) => {
      const cur = map.get(o.unit_name) || {
        unitName: o.unit_name,
        totalOrders: 0,
        galonQty: 0,
        galonDelivered: 0,
        photocopySheets: 0,
        laminatingSheets: 0,
      };
      cur.totalOrders += 1;
      if (o.service_type === 'galon') {
        cur.galonQty += o.item.gallon_requested_qty || 0;
        cur.galonDelivered += o.item.gallon_delivered_qty || 0;
      }
      if (o.service_type === 'fotokopi') cur.photocopySheets += o.item.total_paper_sheets || 0;
      if (o.service_type === 'laminating') {
        cur.laminatingSheets += o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0;
      }
      map.set(o.unit_name, cur);
      return map;
    }, new Map<string, { unitName: string; totalOrders: number; galonQty: number; galonDelivered: number; photocopySheets: number; laminatingSheets: number }>()).values()
  );

  const servicePerf = (['galon', 'fotokopi', 'laminating'] as const).map((st) => {
    const subset = orders.filter((o) => o.service_type === st);
    const done = subset.filter((o) => o.status === 'Selesai');
    const cancelled = subset.filter((o) => o.status === 'Dibatalkan');
    const avgMinutes =
      done.length > 0
        ? Math.round(
            done.reduce((acc, o) => {
              const start = new Date(o.created_at).getTime();
              const end = new Date(o.completed_at || o.updated_at).getTime();
              return acc + Math.max(1, (end - start) / 60000);
            }, 0) / done.length
          )
        : 0;
    return {
      service: getServiceLabel(st),
      total: subset.length,
      completed: done.length,
      cancelled: cancelled.length,
      active: subset.length - done.length - cancelled.length,
      avgResolutionMinutes: avgMinutes,
    };
  });

  const activeTitle = REPORT_MENU.find((m) => m.key === reportType)?.label || 'Laporan RESERVE';
  const selectedUnitLabel =
    unitId === 'all' ? 'Semua Unit' : units.find((u) => u.id === unitId)?.name || 'Unit Terpilih';
  const activePeriodText =
    !dateFrom && !dateTo
      ? 'Semua Periode'
      : `${dateFrom ? formatDateID(dateFrom) : 'Awal'} s/d ${dateTo ? formatDateID(dateTo) : 'Sekarang'}`;
  const activeSubtitle = `Periode: ${activePeriodText} · Unit: ${selectedUnitLabel} · Status: ${status === 'all' ? 'Semua' : status}`;

  const handleExport = (kind: 'csv' | 'excel' | 'pdf') => {
    const runExport = <T,>(
      cols: ExportColumn<T>[],
      rows: T[],
      summaryPairs?: Array<{ label: string; value: string | number }>,
      excelSummary?: Array<[string, string | number]>
    ) => {
      if (kind === 'csv') exportToCSV(`lrms-${reportType}`, cols, rows, reportAuthorization);
      else if (kind === 'excel')
        exportToExcel(
          `lrms-${reportType}`,
          'Laporan',
          cols,
          rows,
          [
            ['Judul Laporan', activeTitle],
            ['Periode', activePeriodText],
            ['Unit', selectedUnitLabel],
            ...(excelSummary || []),
          ],
          reportAuthorization
        );
      else exportToPDF(`lrms-${reportType}`, activeTitle, activeSubtitle, cols, rows, summaryPairs, reportAuthorization);
    };

    if (reportType === 'mutasi_persediaan') {
      runExport(
        [
          { header: 'Tanggal', accessor: (t) => formatDateTimeID(t.created_at) },
          { header: 'Lokasi', accessor: (t) => t.location_name },
          { header: 'Transaksi', accessor: (t) => t.transaction_type },
          { header: 'Kategori', accessor: (t) => t.stock_kind },
          { header: 'Delta', accessor: (t) => t.qty_delta },
          { header: 'Saldo Akhir', accessor: (t) => t.balance_after },
          { header: 'Referensi', accessor: (t) => t.reference_number || '-' },
        ],
        transactions
      );
      return;
    }

    if (reportType === 'stock_opname') {
      runExport(
        [
          { header: 'No. Opname', accessor: (o) => o.opname_number },
          { header: 'Tanggal', accessor: (o) => o.opname_date },
          { header: 'Lokasi', accessor: (o) => o.location_name },
          { header: 'Pemeriksa', accessor: (o) => o.inspector_name },
          { header: 'Status', accessor: (o) => o.status },
        ],
        opnames
      );
      return;
    }

    if (reportType === 'penggunaan_unit') {
      runExport(
        [
          { header: 'Unit / Departemen', accessor: (u) => u.unitName },
          { header: 'Total Order', accessor: (u) => u.totalOrders },
          { header: 'Galon Diminta', accessor: (u) => u.galonQty },
          { header: 'Galon Terkirim', accessor: (u) => u.galonDelivered },
          { header: 'Lembar Fotokopi', accessor: (u) => u.photocopySheets },
          { header: 'Lembar Laminating', accessor: (u) => u.laminatingSheets },
        ],
        unitAggregation
      );
      return;
    }

    if (reportType === 'kinerja_layanan') {
      runExport(
        [
          { header: 'Layanan', accessor: (s) => s.service },
          { header: 'Total Order', accessor: (s) => s.total },
          { header: 'Selesai', accessor: (s) => s.completed },
          { header: 'Aktif', accessor: (s) => s.active },
          { header: 'Dibatalkan', accessor: (s) => s.cancelled },
          { header: 'Rata-rata Selesai (Menit)', accessor: (s) => s.avgResolutionMinutes },
        ],
        servicePerf
      );
      return;
    }

    if (reportType === 'fotokopi') {
      runExport(
        [
          { header: 'No. Order', accessor: (o) => o.order_number },
          { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
          { header: 'Unit', accessor: (o) => o.unit_name },
          { header: 'Pemesan', accessor: (o) => o.requester_name },
          { header: 'Dokumen', accessor: (o) => o.item.document_name || '-' },
          { header: 'Cetak & Ukuran', accessor: (o) => `${o.item.print_color || '-'} · ${o.item.paper_size || '-'}` },
          { header: 'Sisi Aktual', accessor: (o) => o.item.total_print_sides || 0 },
          { header: 'Lembar Kertas', accessor: (o) => o.item.total_paper_sheets || 0 },
          { header: 'Status', accessor: (o) => o.status },
        ],
        photocopyOrders,
        [
          { label: 'Total Order', value: photocopyOrders.length },
          { label: 'Total Sisi', value: totalPhotocopySides },
          { label: 'Total Lembar', value: totalPhotocopySheets },
        ],
        [
          ['Total Order Fotokopi', photocopyOrders.length],
          ['Total Sisi Cetak', totalPhotocopySides],
          ['Total Lembar Kertas', totalPhotocopySheets],
        ]
      );
      return;
    }

    if (reportType === 'laminating') {
      runExport(
        [
          { header: 'No. Order', accessor: (o) => o.order_number },
          { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
          { header: 'Unit', accessor: (o) => o.unit_name },
          { header: 'Pemesan', accessor: (o) => o.requester_name },
          { header: 'Dokumen', accessor: (o) => o.item.document_name || '-' },
          { header: 'Ukuran', accessor: (o) => o.item.laminating_size || '-' },
          { header: 'Jenis Laminating', accessor: (o) => o.item.laminating_type || '-' },
          { header: 'Lembar Diajukan', accessor: (o) => o.item.laminating_sheets || 0 },
          {
            header: 'Lembar Aktual',
            accessor: (o) => o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0,
          },
          { header: 'Status', accessor: (o) => o.status },
        ],
        laminatingOrders,
        [
          { label: 'Total Order', value: laminatingOrders.length },
          { label: 'Diajukan', value: `${totalLaminatingRequested} lbr` },
          { label: 'Aktual', value: `${totalLaminatingActual} lbr` },
        ],
        [
          ['Total Order Laminating', laminatingOrders.length],
          ['Total Lembar Diajukan', totalLaminatingRequested],
          ['Total Lembar Aktual', totalLaminatingActual],
        ]
      );
      return;
    }

    // Permintaan Galon / Distribusi Galon
    runExport(
      [
        { header: 'No. Order', accessor: (o) => o.order_number },
        { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
        { header: 'Unit', accessor: (o) => o.unit_name },
        { header: 'Pemesan', accessor: (o) => o.requester_name },
        { header: 'Lokasi Tujuan', accessor: (o) => o.location_label || '-' },
        { header: 'Galon Diminta', accessor: (o) => o.item.gallon_requested_qty || 0 },
        { header: 'Isi Terkirim', accessor: (o) => o.item.gallon_delivered_qty ?? 0 },
        { header: 'Kosong Kembali', accessor: (o) => o.item.gallon_empty_received_qty ?? 0 },
        { header: 'Status', accessor: (o) => o.status },
      ],
      galonOrders,
      [
        { label: 'Total Order', value: galonOrders.length },
        { label: 'Diminta', value: totalGalonRequested },
        { label: 'Isi Terkirim', value: totalGalonDelivered },
        { label: 'Kosong Kembali', value: totalGalonEmptyReturned },
      ],
      [
        ['Total Order Air Galon', galonOrders.length],
        ['Total Galon Diminta', totalGalonRequested],
        ['Total Galon Isi Terkirim', totalGalonDelivered],
        ['Total Galon Kosong Kembali', totalGalonEmptyReturned],
      ]
    );
  };

  return (
    <div className="space-y-6">
      <PrintReportHeader
        title={activeTitle}
        subtitle={activeSubtitle}
        authorization={reportAuthorization}
      />

      {/* Header & Tombol Ekspor */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Reports &amp; Analytics</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Laporan operasional terhitung langsung dari database (Fotokopi, Laminating, Air Galon &amp; Inventaris) dengan otorisasi Admin pelapor.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('excel')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
          >
            <FileText className="w-3.5 h-3.5 text-red-600" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={() => setDriveSaveOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-[#1755CE]"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Simpan ke Drive</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1755CE] text-white text-xs font-semibold"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Cetak</span>
          </button>
        </div>
      </div>

      {/* Pilihan Jenis Laporan */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto no-print">
        {REPORT_MENU.filter((m) => !isKepalaUnit || m.kepalaUnitAllowed).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setReportType(m.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              reportType === m.key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Filter Periode, Unit & Status */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs no-print">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <CalendarRange className="w-4 h-4 text-[#1755CE]" />
            <span>Rentang Waktu Pelaporan:</span>
            <span className="font-mono text-[#1755CE]">{activePeriodText}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-slate-500 mr-0.5">Preset Cepat:</span>
            {(
              [
                { id: '7d', label: '7 Hari' },
                { id: '30d', label: '30 Hari' },
                { id: 'month', label: 'Bulan Ini' },
                { id: 'year', label: 'Tahun Ini' },
                { id: 'all', label: 'Semua' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyQuickRange(p.id)}
                className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                  p.id === 'all' && !dateFrom && !dateTo
                    ? 'border-[#1755CE] bg-[#1755CE]/10 text-[#1755CE]'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Dari Tanggal</label>
            <input
              type="date"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-1.5 font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Sampai Tanggal</label>
            <input
              type="date"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-1.5 font-mono border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Unit / Departemen</label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={isKepalaUnit && units.length <= 1}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
            >
              {(!isKepalaUnit || units.length > 1) && <option value="all">Semua Unit</option>}
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-600 mb-1">Status Order</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
            >
              <option value="all">Semua Status</option>
              <option value="Menunggu Diproses">Menunggu Diproses</option>
              <option value="Diproses">Diproses</option>
              <option value="Siap Diambil">Siap Diambil</option>
              <option value="Dalam Pengiriman">Dalam Pengiriman</option>
              <option value="Selesai">Selesai</option>
              <option value="Dibatalkan">Dibatalkan</option>
            </select>
          </div>
        </div>
      </div>

      {/* Konten Laporan */}
      {loading ? (
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <div className="space-y-6">
          {reportType === 'penggunaan_unit' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-bold text-slate-900 mb-4">Grafik Order per Unit</h3>
                <HorizontalUnitBarChart
                  data={unitAggregation.map((u) => ({ unitName: u.unitName, count: u.totalOrders }))}
                />
              </div>
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2.5 px-4">Unit / Departemen</th>
                      <th className="py-2.5 px-3 text-right">Total Order</th>
                      <th className="py-2.5 px-3 text-right">Galon (Diminta/Kirim)</th>
                      <th className="py-2.5 px-3 text-right">Fotokopi (lbr)</th>
                      <th className="py-2.5 px-4 text-right">Laminating (lbr)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {unitAggregation.map((u) => (
                      <tr key={u.unitName}>
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-900">{u.unitName}</td>
                        <td className="py-2.5 px-3 text-right font-bold">{u.totalOrders}</td>
                        <td className="py-2.5 px-3 text-right">
                          {u.galonQty} / {u.galonDelivered}
                        </td>
                        <td className="py-2.5 px-3 text-right">{u.photocopySheets.toLocaleString('id-ID')}</td>
                        <td className="py-2.5 px-4 text-right">{u.laminatingSheets.toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {reportType === 'kinerja_layanan' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-3 px-4">Layanan</th>
                    <th className="py-3 px-3 text-right">Total Order</th>
                    <th className="py-3 px-3 text-right">Selesai</th>
                    <th className="py-3 px-3 text-right">Dalam Antrean</th>
                    <th className="py-3 px-3 text-right">Dibatalkan</th>
                    <th className="py-3 px-4 text-right">Rata-rata Penyelesaian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {servicePerf.map((s) => (
                    <tr key={s.service}>
                      <td className="py-3 px-4 font-sans font-semibold text-slate-900">{s.service}</td>
                      <td className="py-3 px-3 text-right">{s.total}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-semibold">{s.completed}</td>
                      <td className="py-3 px-3 text-right text-amber-700">{s.active}</td>
                      <td className="py-3 px-3 text-right text-red-700">{s.cancelled}</td>
                      <td className="py-3 px-4 text-right">{s.avgResolutionMinutes} menit</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(reportType === 'permintaan_galon' || reportType === 'distribusi_galon') && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MiniStat label="Total Order Air Galon" value={galonOrders.length} unit="order" />
                <MiniStat label="Total Galon Diminta" value={totalGalonRequested} unit="galon" />
                <MiniStat label="Total Galon Isi Terkirim" value={totalGalonDelivered} unit="galon" highlight />
                <MiniStat label="Galon Kosong Kembali" value={totalGalonEmptyReturned} unit="galon" />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2.5 px-4">No. Order</th>
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                      <th className="py-2.5 px-3">Lokasi &amp; Rincian Galon</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {galonOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Tidak ada data penggunaan air galon untuk filter yang dipilih.
                        </td>
                      </tr>
                    ) : (
                      galonOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                            {o.order_number}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {formatDateID(o.created_at)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{o.unit_name}</div>
                            <div className="text-[11px] text-slate-500">{o.requester_name}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums">
                            <div>{o.location_label || '-'}</div>
                            <div className="text-[11px] text-slate-600">
                              Diminta: {o.item.gallon_requested_qty} · Dikirim: {o.item.gallon_delivered_qty ?? '-'} · Kosong: {o.item.gallon_empty_received_qty ?? '-'}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium">{o.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {reportType === 'fotokopi' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MiniStat label="Total Order Fotokopi" value={photocopyOrders.length} unit="order" />
                <MiniStat label="Total Sisi Cetak" value={totalPhotocopySides} unit="sisi" />
                <MiniStat label="Total Lembar Kertas" value={totalPhotocopySheets} unit="lembar" highlight />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2.5 px-4">No. Order</th>
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                      <th className="py-2.5 px-3">Dokumen &amp; Volume</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {photocopyOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Tidak ada data fotokopi untuk filter yang dipilih.
                        </td>
                      </tr>
                    ) : (
                      photocopyOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                            {o.order_number}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {formatDateID(o.created_at)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{o.unit_name}</div>
                            <div className="text-[11px] text-slate-500">{o.requester_name}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums">
                            {o.item.document_name} ({o.item.total_print_sides} sisi / {o.item.total_paper_sheets} lbr)
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium">{o.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {reportType === 'laminating' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MiniStat label="Total Order Laminating" value={laminatingOrders.length} unit="order" />
                <MiniStat label="Total Lembar Diajukan" value={totalLaminatingRequested} unit="lembar" />
                <MiniStat label="Total Lembar Aktual" value={totalLaminatingActual} unit="lembar" highlight />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2.5 px-4">No. Order</th>
                      <th className="py-2.5 px-3">Tanggal</th>
                      <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                      <th className="py-2.5 px-3">Dokumen &amp; Spesifikasi</th>
                      <th className="py-2.5 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {laminatingOrders.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          Tidak ada data laminating untuk filter yang dipilih.
                        </td>
                      </tr>
                    ) : (
                      laminatingOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                            {o.order_number}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600">
                            {formatDateID(o.created_at)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{o.unit_name}</div>
                            <div className="text-[11px] text-slate-500">{o.requester_name}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums">
                            {o.item.document_name} ({o.item.laminating_size} · {o.item.laminating_type} · {o.item.laminating_actual_sheets ?? o.item.laminating_sheets} lbr)
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium">{o.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {reportType === 'stock_opname' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">No. Opname</th>
                    <th className="py-2.5 px-3">Tanggal</th>
                    <th className="py-2.5 px-3">Lokasi</th>
                    <th className="py-2.5 px-3">Pemeriksa</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {opnames.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Belum ada data Stock Opname.
                      </td>
                    </tr>
                  ) : (
                    opnames.map((op) => (
                      <tr key={op.id}>
                        <td className="py-2.5 px-4 font-mono font-semibold text-[#1755CE]">{op.opname_number}</td>
                        <td className="py-2.5 px-3 font-mono">{formatDateID(op.opname_date)}</td>
                        <td className="py-2.5 px-3">{op.location_name}</td>
                        <td className="py-2.5 px-3">{op.inspector_name}</td>
                        <td className="py-2.5 px-4 text-right font-semibold">{op.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {reportType === 'mutasi_persediaan' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">Waktu</th>
                    <th className="py-2.5 px-3">Lokasi</th>
                    <th className="py-2.5 px-3">Transaksi</th>
                    <th className="py-2.5 px-3">Kategori</th>
                    <th className="py-2.5 px-3 text-right">Perubahan</th>
                    <th className="py-2.5 px-4 text-right">Saldo Akhir</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2.5 px-4 font-mono text-slate-500">{formatDateTimeID(t.created_at)}</td>
                      <td className="py-2.5 px-3">{t.location_name}</td>
                      <td className="py-2.5 px-3 font-mono">{t.transaction_type}</td>
                      <td className="py-2.5 px-3 capitalize">{t.stock_kind}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{t.qty_delta}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold">{t.balance_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Nama Admin Pelapor & Tanda Tangan Otorisasi Admin */}
          <ReportSignatureBlock
            authorization={reportAuthorization}
            onAuthorizationUpdated={(nextAuth) => setReportAuthorization(nextAuth)}
          />
        </div>
      )}

      <SaveToDriveConfirmModal
        isOpen={driveSaveOpen}
        onClose={() => setDriveSaveOpen(false)}
        defaultFileName={`lrms-${reportType}.pdf`}
        reportTitle={activeTitle}
        buildPdfBlob={() => {
          if (reportType === 'mutasi_persediaan') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'Tanggal', accessor: (t) => formatDateTimeID(t.created_at) },
                { header: 'Lokasi', accessor: (t) => t.location_name },
                { header: 'Transaksi', accessor: (t) => t.transaction_type },
                { header: 'Kategori', accessor: (t) => t.stock_kind },
                { header: 'Delta', accessor: (t) => t.qty_delta },
                { header: 'Saldo Akhir', accessor: (t) => t.balance_after },
              ],
              transactions,
              undefined,
              reportAuthorization
            );
          }
          if (reportType === 'stock_opname') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'No. Opname', accessor: (o) => o.opname_number },
                { header: 'Tanggal', accessor: (o) => o.opname_date },
                { header: 'Lokasi', accessor: (o) => o.location_name },
                { header: 'Pemeriksa', accessor: (o) => o.inspector_name },
                { header: 'Status', accessor: (o) => o.status },
              ],
              opnames,
              undefined,
              reportAuthorization
            );
          }
          if (reportType === 'penggunaan_unit') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'Unit / Departemen', accessor: (u) => u.unitName },
                { header: 'Total Order', accessor: (u) => u.totalOrders },
                { header: 'Galon Diminta', accessor: (u) => u.galonQty },
                { header: 'Galon Terkirim', accessor: (u) => u.galonDelivered },
                { header: 'Lembar Fotokopi', accessor: (u) => u.photocopySheets },
                { header: 'Lembar Laminating', accessor: (u) => u.laminatingSheets },
              ],
              unitAggregation,
              undefined,
              reportAuthorization
            );
          }
          if (reportType === 'kinerja_layanan') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'Layanan', accessor: (s) => s.service },
                { header: 'Total Order', accessor: (s) => s.total },
                { header: 'Selesai', accessor: (s) => s.completed },
                { header: 'Aktif', accessor: (s) => s.active },
                { header: 'Dibatalkan', accessor: (s) => s.cancelled },
                { header: 'Rata-rata Selesai (Menit)', accessor: (s) => s.avgResolutionMinutes },
              ],
              servicePerf,
              undefined,
              reportAuthorization
            );
          }
          if (reportType === 'fotokopi') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'No. Order', accessor: (o) => o.order_number },
                { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
                { header: 'Unit', accessor: (o) => o.unit_name },
                { header: 'Pemesan', accessor: (o) => o.requester_name },
                { header: 'Dokumen', accessor: (o) => o.item.document_name || '-' },
                { header: 'Sisi Aktual', accessor: (o) => o.item.total_print_sides || 0 },
                { header: 'Lembar Kertas', accessor: (o) => o.item.total_paper_sheets || 0 },
                { header: 'Status', accessor: (o) => o.status },
              ],
              photocopyOrders,
              [
                { label: 'Total Order', value: photocopyOrders.length },
                { label: 'Total Lembar', value: totalPhotocopySheets },
              ],
              reportAuthorization
            );
          }
          if (reportType === 'laminating') {
            return buildPDFBlob(
              activeTitle,
              activeSubtitle,
              [
                { header: 'No. Order', accessor: (o) => o.order_number },
                { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
                { header: 'Unit', accessor: (o) => o.unit_name },
                { header: 'Pemesan', accessor: (o) => o.requester_name },
                { header: 'Dokumen', accessor: (o) => o.item.document_name || '-' },
                {
                  header: 'Lembar Aktual',
                  accessor: (o) => o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0,
                },
                { header: 'Status', accessor: (o) => o.status },
              ],
              laminatingOrders,
              [
                { label: 'Total Order', value: laminatingOrders.length },
                { label: 'Aktual', value: `${totalLaminatingActual} lbr` },
              ],
              reportAuthorization
            );
          }
          return buildPDFBlob(
            activeTitle,
            activeSubtitle,
            [
              { header: 'No. Order', accessor: (o) => o.order_number },
              { header: 'Tanggal', accessor: (o) => formatDateID(o.created_at) },
              { header: 'Unit', accessor: (o) => o.unit_name },
              { header: 'Pemesan', accessor: (o) => o.requester_name },
              { header: 'Galon Diminta', accessor: (o) => o.item.gallon_requested_qty || 0 },
              { header: 'Isi Terkirim', accessor: (o) => o.item.gallon_delivered_qty ?? 0 },
              { header: 'Status', accessor: (o) => o.status },
            ],
            galonOrders,
            [
              { label: 'Total Order', value: galonOrders.length },
              { label: 'Isi Terkirim', value: totalGalonDelivered },
            ],
            reportAuthorization
          );
        }}
      />
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
  highlight = false,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
          highlight ? 'text-[#1755CE]' : 'text-slate-900'
        }`}
      >
        {value.toLocaleString('id-ID')}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">{unit}</div>
    </div>
  );
}
