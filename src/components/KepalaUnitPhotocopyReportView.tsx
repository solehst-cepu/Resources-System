import React, { useCallback, useEffect, useState } from 'react';
import {
  CalendarRange,
  CheckCircle2,
  Copy,
  Download,
  Droplets,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Layers,
  LayoutGrid,
  Mail,
  Printer,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type {
  OrderRecord,
  ReportAdminAuthorization,
  ReportDeliveryLog,
  Unit,
} from '../types/lrms.ts';
import { formatDateID, formatDateTimeID, getServiceLabel } from '../utils/calculations.ts';
import { buildPDFBlob, exportToCSV, exportToExcel, exportToPDF, type ExportColumn } from '../utils/exportUtils.ts';
import { PhotocopyVolumeChart } from './Charts.tsx';
import { SaveToDriveConfirmModal } from './GoogleDrivePickerModal.tsx';
import { PrintReportHeader, ReportSignatureBlock } from './ReportSignatureBlock.tsx';
import { OrderStatusText } from './StatusText.tsx';

type ServiceReportTab = 'semua' | 'fotokopi' | 'laminating' | 'galon';
type TimeRangeMode = 'month' | 'custom';

interface UnitReportResponse {
  period: string;
  rangeMode?: TimeRangeMode;
  dateFrom?: string | null;
  dateTo?: string | null;
  periodLabel?: string;
  summary: {
    totalOrders: number;
    totalSidesBW: number;
    totalSidesColor: number;
    totalSheets: number;
  };
  requesterBreakdown: Array<{
    name: string;
    email: string;
    orders: number;
    sides: number;
    sheets: number;
  }>;
  monthlyChart: Array<{ month: string; sidesBW: number; sidesColor: number; sheets: number }>;
  rows: OrderRecord[];
  laminating: {
    summary: {
      totalOrders: number;
      totalRequestedSheets: number;
      totalActualSheets: number;
    };
    requesterBreakdown: Array<{
      name: string;
      email: string;
      orders: number;
      sheets: number;
    }>;
    rows: OrderRecord[];
  };
  galon: {
    summary: {
      totalOrders: number;
      totalRequestedQty: number;
      totalDeliveredQty: number;
      totalEmptyReturnedQty: number;
    };
    requesterBreakdown: Array<{
      name: string;
      email: string;
      orders: number;
      requestedQty: number;
      deliveredQty: number;
      emptyReturnedQty: number;
    }>;
    rows: OrderRecord[];
  };
  reportAuthorization: ReportAdminAuthorization;
  deliveryLogs: ReportDeliveryLog[];
}

export function KepalaUnitPhotocopyReportView() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);

  const [serviceTab, setServiceTab] = useState<ServiceReportTab>('semua');
  const [rangeMode, setRangeMode] = useState<TimeRangeMode>('month');
  const [period, setPeriod] = useState(currentMonthStr);
  const [dateFrom, setDateFrom] = useState(`${currentMonthStr}-01`);
  const [dateTo, setDateTo] = useState(todayStr);
  const [unitId, setUnitId] = useState('all');
  const [units, setUnits] = useState<Unit[]>([]);
  const [report, setReport] = useState<UnitReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [driveSaveOpen, setDriveSaveOpen] = useState(false);

  const isAdmin = user?.role === 'super_admin' || user?.role === 'admin_resources';
  const isKepalaUnit = user?.role === 'kepala_unit';

  useEffect(() => {
    const loadUnits = async () => {
      try {
        const master = await apiRequest<{ units: Unit[] }>('/master');
        if (isKepalaUnit && user?.head_unit_ids) {
          const own = master.units.filter((u) => user.head_unit_ids.includes(u.id));
          setUnits(own);
          if (own.length === 1) setUnitId(own[0].id);
        } else {
          setUnits(master.units);
        }
      } catch {
        // ignore
      }
    };
    void loadUnits();
  }, [isKepalaUnit, user?.head_unit_ids]);

  const fetchReport = useCallback(async () => {
    if (rangeMode === 'custom' && dateFrom && dateTo && dateFrom > dateTo) {
      showToast('Rentang Tanggal Tidak Valid', 'Tanggal awal tidak boleh melebihi tanggal akhir.', 'warning');
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ period, unitId });
      if (rangeMode === 'custom') {
        if (dateFrom) qs.set('dateFrom', dateFrom);
        if (dateTo) qs.set('dateTo', dateTo);
      }
      const res = await apiRequest<UnitReportResponse>(
        `/reports/photocopy-unit?${qs.toString()}`
      );
      setReport(res);
    } catch (err) {
      showToast('Gagal Memuat Laporan Penggunaan Unit', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [rangeMode, period, dateFrom, dateTo, unitId, showToast]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const applyQuickRange = (preset: '7d' | '30d' | 'month' | 'year') => {
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
    setRangeMode('custom');
    setDateFrom(start);
    setDateTo(end);
  };

  const handleDispatchEmail = async (forceResend = false) => {
    setSending(true);
    try {
      const res = await apiRequest<{
        results: Array<{ unitName: string; recipientEmail: string; status: string; message?: string }>;
      }>('/reports/photocopy-unit/send', {
        method: 'POST',
        body: {
          period,
          unitId: unitId === 'all' ? undefined : unitId,
          forceResend,
        },
      });

      const sentCount = res.results.filter((r) => r.status === 'SENT').length;
      const failedCount = res.results.filter((r) => r.status === 'FAILED').length;
      const skippedCount = res.results.filter((r) => r.status === 'SKIPPED_DUPLICATE').length;

      showToast(
        'Proses Pengiriman Laporan Selesai',
        `Terkirim: ${sentCount} · Gagal: ${failedCount} · Dilewati (sudah terkirim): ${skippedCount}`,
        failedCount > 0 ? 'warning' : 'success'
      );
      await fetchReport();
    } catch (err) {
      showToast('Gagal Mengirim Laporan', (err as Error).message, 'error');
    } finally {
      setSending(false);
    }
  };

  const selectedUnitName =
    unitId === 'all'
      ? isKepalaUnit
        ? units.map((u) => u.name).join(', ') || 'Unit Saya'
        : 'Semua Unit'
      : units.find((u) => u.id === unitId)?.name || 'Unit';

  const activePeriodLabel =
    rangeMode === 'custom'
      ? `${dateFrom ? formatDateID(dateFrom) : 'Awal'} s/d ${dateTo ? formatDateID(dateTo) : 'Sekarang'}`
      : period;

  const exportFileSlug =
    rangeMode === 'custom' ? `${dateFrom || 'awal'}_sd_${dateTo || 'sekarang'}` : period;

  const getTabTitle = () => {
    if (serviceTab === 'fotokopi') return `Laporan Penggunaan Fotokopi Unit (${selectedUnitName})`;
    if (serviceTab === 'laminating') return `Laporan Penggunaan Laminating Unit (${selectedUnitName})`;
    if (serviceTab === 'galon') return `Laporan Penggunaan Air Galon Unit (${selectedUnitName})`;
    return `Laporan Terpadu Layanan Unit — Fotokopi, Laminating & Air Galon (${selectedUnitName})`;
  };

  const handleExport = (kind: 'csv' | 'excel' | 'pdf') => {
    if (!report) return;
    const auth = report.reportAuthorization;

    if (serviceTab === 'fotokopi') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Nama Dokumen', accessor: (r) => r.item.document_name || '-' },
        { header: 'Jenis Cetak', accessor: (r) => r.item.print_color || '-' },
        { header: 'Ukuran', accessor: (r) => r.item.paper_size || '-' },
        { header: 'Halaman', accessor: (r) => r.item.actual_page_count || r.item.page_count || 0 },
        { header: 'Rangkap', accessor: (r) => r.item.actual_copy_count || r.item.copy_count || 0 },
        { header: 'Sisi Cetak Aktual', accessor: (r) => r.item.total_print_sides || 0 },
        { header: 'Lembar Kertas Aktual', accessor: (r) => r.item.total_paper_sheets || 0 },
        { header: 'Status', accessor: (r) => r.status },
      ];
      if (kind === 'csv') exportToCSV(`laporan-fotokopi-${exportFileSlug}`, cols, report.rows, auth);
      else if (kind === 'excel')
        exportToExcel(
          `laporan-fotokopi-${exportFileSlug}`,
          'Fotokopi Unit',
          cols,
          report.rows,
          [
            ['Periode / Rentang Laporan', activePeriodLabel],
            ['Unit', selectedUnitName],
            ['Total Order Fotokopi', report.summary.totalOrders],
            ['Total Sisi Hitam Putih', report.summary.totalSidesBW],
            ['Total Sisi Warna', report.summary.totalSidesColor],
            ['Total Lembar Kertas Aktual', report.summary.totalSheets],
          ],
          auth
        );
      else
        exportToPDF(
          `laporan-fotokopi-${exportFileSlug}`,
          getTabTitle(),
          `Periode: ${activePeriodLabel} — Tanpa lampiran dokumen`,
          cols,
          report.rows,
          [
            { label: 'Total Order', value: report.summary.totalOrders },
            { label: 'Sisi Hitam Putih', value: report.summary.totalSidesBW },
            { label: 'Sisi Warna', value: report.summary.totalSidesColor },
            { label: 'Lembar Kertas', value: report.summary.totalSheets },
          ],
          auth
        );
      return;
    }

    if (serviceTab === 'laminating') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Nama Dokumen', accessor: (r) => r.item.document_name || '-' },
        { header: 'Ukuran', accessor: (r) => r.item.laminating_size || '-' },
        { header: 'Jenis Laminating', accessor: (r) => r.item.laminating_type || '-' },
        { header: 'Lembar Diajukan', accessor: (r) => r.item.laminating_sheets || 0 },
        {
          header: 'Lembar Aktual',
          accessor: (r) => r.item.laminating_actual_sheets ?? r.item.laminating_sheets ?? 0,
        },
        { header: 'Status', accessor: (r) => r.status },
      ];
      if (kind === 'csv') exportToCSV(`laporan-laminating-${exportFileSlug}`, cols, report.laminating.rows, auth);
      else if (kind === 'excel')
        exportToExcel(
          `laporan-laminating-${exportFileSlug}`,
          'Laminating Unit',
          cols,
          report.laminating.rows,
          [
            ['Periode / Rentang Laporan', activePeriodLabel],
            ['Unit', selectedUnitName],
            ['Total Order Laminating', report.laminating.summary.totalOrders],
            ['Total Lembar Diajukan', report.laminating.summary.totalRequestedSheets],
            ['Total Lembar Aktual', report.laminating.summary.totalActualSheets],
          ],
          auth
        );
      else
        exportToPDF(
          `laporan-laminating-${exportFileSlug}`,
          getTabTitle(),
          `Periode: ${activePeriodLabel} — Tanpa lampiran dokumen`,
          cols,
          report.laminating.rows,
          [
            { label: 'Total Order', value: report.laminating.summary.totalOrders },
            { label: 'Lembar Diajukan', value: report.laminating.summary.totalRequestedSheets },
            { label: 'Lembar Aktual', value: report.laminating.summary.totalActualSheets },
          ],
          auth
        );
      return;
    }

    if (serviceTab === 'galon') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Lokasi Tujuan', accessor: (r) => r.location_label || '-' },
        { header: 'Galon Diminta', accessor: (r) => r.item.gallon_requested_qty || 0 },
        { header: 'Galon Isi Terkirim', accessor: (r) => r.item.gallon_delivered_qty ?? 0 },
        { header: 'Galon Kosong Kembali', accessor: (r) => r.item.gallon_empty_received_qty ?? 0 },
        { header: 'Status', accessor: (r) => r.status },
      ];
      if (kind === 'csv') exportToCSV(`laporan-air-galon-${exportFileSlug}`, cols, report.galon.rows, auth);
      else if (kind === 'excel')
        exportToExcel(
          `laporan-air-galon-${exportFileSlug}`,
          'Air Galon Unit',
          cols,
          report.galon.rows,
          [
            ['Periode / Rentang Laporan', activePeriodLabel],
            ['Unit', selectedUnitName],
            ['Total Order Air Galon', report.galon.summary.totalOrders],
            ['Total Galon Diminta', report.galon.summary.totalRequestedQty],
            ['Total Galon Isi Terkirim', report.galon.summary.totalDeliveredQty],
            ['Total Galon Kosong Dikembalikan', report.galon.summary.totalEmptyReturnedQty],
          ],
          auth
        );
      else
        exportToPDF(
          `laporan-air-galon-${exportFileSlug}`,
          getTabTitle(),
          `Periode: ${activePeriodLabel} — Rincian Penggunaan & Distribusi Air Galon`,
          cols,
          report.galon.rows,
          [
            { label: 'Total Order', value: report.galon.summary.totalOrders },
            { label: 'Galon Diminta', value: report.galon.summary.totalRequestedQty },
            { label: 'Galon Terkirim', value: report.galon.summary.totalDeliveredQty },
            { label: 'Galon Kosong Kembali', value: report.galon.summary.totalEmptyReturnedQty },
          ],
          auth
        );
      return;
    }

    // Semua Layanan gabungan
    const combinedRows = [...report.rows, ...report.laminating.rows, ...report.galon.rows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const cols: ExportColumn<OrderRecord>[] = [
      { header: 'No. Order', accessor: (r) => r.order_number },
      { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
      { header: 'Layanan', accessor: (r) => getServiceLabel(r.service_type) },
      { header: 'Unit', accessor: (r) => r.unit_name },
      { header: 'Pemesan', accessor: (r) => r.requester_name },
      {
        header: 'Ringkasan Volume',
        accessor: (r) => {
          if (r.service_type === 'fotokopi') {
            return `${r.item.document_name || '-'} (${r.item.total_print_sides || 0} sisi / ${r.item.total_paper_sheets || 0} lbr)`;
          }
          if (r.service_type === 'laminating') {
            return `${r.item.document_name || '-'} (${r.item.laminating_size || '-'} · ${r.item.laminating_actual_sheets ?? r.item.laminating_sheets ?? 0} lbr)`;
          }
          return `Diminta: ${r.item.gallon_requested_qty || 0} · Terkirim: ${r.item.gallon_delivered_qty ?? 0} · Kosong: ${r.item.gallon_empty_received_qty ?? 0}`;
        },
      },
      { header: 'Status', accessor: (r) => r.status },
    ];
    if (kind === 'csv') exportToCSV(`laporan-penggunaan-unit-${exportFileSlug}`, cols, combinedRows, auth);
    else if (kind === 'excel')
      exportToExcel(
        `laporan-penggunaan-unit-${exportFileSlug}`,
        'Penggunaan Unit',
        cols,
        combinedRows,
        [
          ['Periode / Rentang Laporan', activePeriodLabel],
          ['Unit', selectedUnitName],
          ['Fotokopi (Order / Lembar)', `${report.summary.totalOrders} / ${report.summary.totalSheets}`],
          ['Laminating (Order / Lembar)', `${report.laminating.summary.totalOrders} / ${report.laminating.summary.totalActualSheets}`],
          ['Air Galon (Order / Terkirim)', `${report.galon.summary.totalOrders} / ${report.galon.summary.totalDeliveredQty} galon`],
        ],
        auth
      );
    else
      exportToPDF(
        `laporan-penggunaan-unit-${exportFileSlug}`,
        getTabTitle(),
        `Periode: ${activePeriodLabel} — Fotokopi, Laminating & Penggunaan Air Galon`,
        cols,
        combinedRows,
        [
          { label: 'Fotokopi', value: `${report.summary.totalOrders} ord (${report.summary.totalSheets} lbr)` },
          {
            label: 'Laminating',
            value: `${report.laminating.summary.totalOrders} ord (${report.laminating.summary.totalActualSheets} lbr)`,
          },
          {
            label: 'Air Galon',
            value: `${report.galon.summary.totalOrders} ord (${report.galon.summary.totalDeliveredQty} terkirim)`,
          },
        ],
        auth
      );
  };

  const buildActivePdfBlob = (): Blob => {
    if (!report) return new Blob();
    const auth = report.reportAuthorization;
    if (serviceTab === 'fotokopi') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Nama Dokumen', accessor: (r) => r.item.document_name || '-' },
        { header: 'Jenis Cetak', accessor: (r) => r.item.print_color || '-' },
        { header: 'Ukuran', accessor: (r) => r.item.paper_size || '-' },
        { header: 'Sisi Cetak Aktual', accessor: (r) => r.item.total_print_sides || 0 },
        { header: 'Lembar Kertas Aktual', accessor: (r) => r.item.total_paper_sheets || 0 },
        { header: 'Status', accessor: (r) => r.status },
      ];
      return buildPDFBlob(
        getTabTitle(),
        `Periode: ${activePeriodLabel} — Tanpa lampiran dokumen`,
        cols,
        report.rows,
        [
          { label: 'Total Order', value: report.summary.totalOrders },
          { label: 'Lembar Kertas', value: report.summary.totalSheets },
        ],
        auth
      );
    }
    if (serviceTab === 'laminating') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Nama Dokumen', accessor: (r) => r.item.document_name || '-' },
        { header: 'Ukuran', accessor: (r) => r.item.laminating_size || '-' },
        { header: 'Lembar Aktual', accessor: (r) => r.item.laminating_actual_sheets ?? r.item.laminating_sheets ?? 0 },
        { header: 'Status', accessor: (r) => r.status },
      ];
      return buildPDFBlob(
        getTabTitle(),
        `Periode: ${activePeriodLabel} — Tanpa lampiran dokumen`,
        cols,
        report.laminating.rows,
        [
          { label: 'Total Order', value: report.laminating.summary.totalOrders },
          { label: 'Lembar Aktual', value: report.laminating.summary.totalActualSheets },
        ],
        auth
      );
    }
    if (serviceTab === 'galon') {
      const cols: ExportColumn<OrderRecord>[] = [
        { header: 'Periode', accessor: () => activePeriodLabel },
        { header: 'No. Order', accessor: (r) => r.order_number },
        { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
        { header: 'Unit', accessor: (r) => r.unit_name },
        { header: 'Pemesan', accessor: (r) => r.requester_name },
        { header: 'Galon Diminta', accessor: (r) => r.item.gallon_requested_qty || 0 },
        { header: 'Terkirim', accessor: (r) => r.item.gallon_delivered_qty ?? 0 },
        { header: 'Kosong Kembali', accessor: (r) => r.item.gallon_empty_received_qty ?? 0 },
        { header: 'Status', accessor: (r) => r.status },
      ];
      return buildPDFBlob(
        getTabTitle(),
        `Periode: ${activePeriodLabel} — Rincian Penggunaan & Distribusi Air Galon`,
        cols,
        report.galon.rows,
        [
          { label: 'Total Order', value: report.galon.summary.totalOrders },
          { label: 'Galon Terkirim', value: report.galon.summary.totalDeliveredQty },
        ],
        auth
      );
    }
    const cols: ExportColumn<OrderRecord>[] = [
      { header: 'No. Order', accessor: (r) => r.order_number },
      { header: 'Tgl Order', accessor: (r) => formatDateID(r.created_at) },
      { header: 'Layanan', accessor: (r) => getServiceLabel(r.service_type) },
      { header: 'Unit', accessor: (r) => r.unit_name },
      { header: 'Pemesan', accessor: (r) => r.requester_name },
      { header: 'Status', accessor: (r) => r.status },
    ];
    return buildPDFBlob(
      getTabTitle(),
      `Periode: ${activePeriodLabel} — Fotokopi, Laminating & Penggunaan Air Galon`,
      cols,
      combinedRows,
      [
        { label: 'Fotokopi', value: `${report.summary.totalOrders} ord (${report.summary.totalSheets} lbr)` },
        { label: 'Laminating', value: `${report.laminating.summary.totalOrders} ord (${report.laminating.summary.totalActualSheets} lbr)` },
        { label: 'Air Galon', value: `${report.galon.summary.totalOrders} ord (${report.galon.summary.totalDeliveredQty} galon)` },
      ],
      auth
    );
  };

  const combinedRows = report
    ? [...report.rows, ...report.laminating.rows, ...report.galon.rows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    : [];

  return (
    <div className="space-y-6">
      <PrintReportHeader
        title={getTabTitle()}
        subtitle={`Periode ${activePeriodLabel} · Unit: ${selectedUnitName} · Tanpa lampiran file dokumen`}
        authorization={report?.reportAuthorization}
      />

      {/* Header & Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Laporan Penggunaan Layanan Unit
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mencakup Fotokopi, Laminating, dan Penggunaan Air Galon per unit (tanpa lampiran file dokumen) · Mendukung filter per bulan maupun rentang tanggal custom.
            </p>
          </div>

          {report && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('excel')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport('pdf')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium"
              >
                <FileText className="w-3.5 h-3.5 text-red-600" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() => setDriveSaveOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-[#1755CE]"
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
          )}
        </div>

        {/* Bar Filter Rentang Waktu & Unit */}
        <div className="pt-3 border-t border-slate-200 flex flex-col lg:flex-row lg:items-end justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block font-semibold text-slate-600 mb-1">Mode Waktu Pelaporan</label>
              <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setRangeMode('month')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                    rangeMode === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  Per Bulan
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode('custom')}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium ${
                    rangeMode === 'custom' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  <span>Rentang Tanggal Custom</span>
                </button>
              </div>
            </div>

            {rangeMode === 'month' ? (
              <div>
                <label className="block font-semibold text-slate-600 mb-1">Bulan Laporan</label>
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Dari Tanggal</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Sampai Tanggal</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyQuickRange('7d')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700"
                  >
                    7 Hari
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange('30d')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700"
                  >
                    30 Hari
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange('month')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700"
                  >
                    Bulan Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickRange('year')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[11px] font-medium text-slate-700"
                  >
                    Tahun Ini
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="min-w-[200px]">
            <label className="block font-semibold text-slate-600 mb-1">Unit / Departemen</label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={isKepalaUnit && units.length <= 1}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            >
              {(!isKepalaUnit || units.length > 1) && <option value="all">Semua Unit Berwenang</option>}
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Sub-Tab Layanan: Semua, Fotokopi, Laminating, Air Galon */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-fit no-print">
        {[
          { key: 'semua' as const, label: 'Semua Layanan', icon: LayoutGrid },
          { key: 'fotokopi' as const, label: 'Fotokopi', icon: Copy },
          { key: 'laminating' as const, label: 'Laminating', icon: Layers },
          { key: 'galon' as const, label: 'Penggunaan Air Galon', icon: Droplets },
        ].map((item) => {
          const Icon = item.icon;
          const active = serviceTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setServiceTab(item.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                active ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {loading || !report ? (
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <>
          {/* TAB SEMUA LAYANAN */}
          {serviceTab === 'semua' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Fotokopi</span>
                    <Copy className="w-4 h-4 text-[#1755CE]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#1755CE]">
                    {report.summary.totalSheets.toLocaleString('id-ID')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    lembar kertas · {report.summary.totalOrders} order (BW: {report.summary.totalSidesBW} / Warna: {report.summary.totalSidesColor} sisi)
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Laminating</span>
                    <Layers className="w-4 h-4 text-[#1755CE]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {report.laminating.summary.totalActualSheets.toLocaleString('id-ID')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    lembar laminating · {report.laminating.summary.totalOrders} order (diajukan: {report.laminating.summary.totalRequestedSheets} lbr)
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Penggunaan Air Galon</span>
                    <Droplets className="w-4 h-4 text-[#1755CE]" />
                  </div>
                  <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {report.galon.summary.totalDeliveredQty.toLocaleString('id-ID')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    galon terkirim · {report.galon.summary.totalOrders} order (diminta: {report.galon.summary.totalRequestedQty} · kosong kembali: {report.galon.summary.totalEmptyReturnedQty})
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Rekapitulasi Seluruh Layanan Unit — Periode {activePeriodLabel}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">No. Order &amp; Tgl</th>
                        <th className="py-2.5 px-3">Layanan</th>
                        <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                        <th className="py-2.5 px-3">Rincian Penggunaan</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {combinedRows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            Belum ada transaksi penggunaan layanan pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        combinedRows.map((o) => (
                          <tr key={o.id}>
                            <td className="py-2.5 px-4 font-mono tabular-nums">
                              <div className="font-semibold text-[#1755CE]">{o.order_number}</div>
                              <div className="text-[11px] text-slate-500">{formatDateID(o.created_at)}</div>
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800">
                              {getServiceLabel(o.service_type)}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{o.requester_name}</div>
                              <div className="text-[11px] text-slate-500">{o.unit_name}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700">
                              {o.service_type === 'fotokopi' &&
                                `${o.item.document_name} · ${o.item.print_color} · ${o.item.total_print_sides || 0} sisi (${o.item.total_paper_sheets || 0} lbr)`}
                              {o.service_type === 'laminating' &&
                                `${o.item.document_name} · ${o.item.laminating_size} · ${o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0} lbr`}
                              {o.service_type === 'galon' &&
                                `${o.location_label || '-'} · Diminta: ${o.item.gallon_requested_qty || 0} · Terkirim: ${o.item.gallon_delivered_qty ?? '-'} · Kosong kembali: ${o.item.gallon_empty_received_qty ?? '-'}`}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <OrderStatusText status={o.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB FOTOKOPI */}
          {serviceTab === 'fotokopi' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard label="Total Order Periode" value={report.summary.totalOrders} unit="order" />
                <SummaryCard label="Total Sisi Hitam Putih" value={report.summary.totalSidesBW} unit="sisi cetak" />
                <SummaryCard label="Total Sisi Warna" value={report.summary.totalSidesColor} unit="sisi cetak" />
                <SummaryCard
                  label="Total Lembar Kertas Aktual"
                  value={report.summary.totalSheets}
                  unit="lembar"
                  highlight
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-bold text-slate-900 mb-4">
                    Grafik Penggunaan Fotokopi Bulanan ({selectedUnitName})
                  </h3>
                  <PhotocopyVolumeChart data={report.monthlyChart} />
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900">Ringkasan Fotokopi per Pemesan</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                          <th className="py-2.5 px-4">Nama Pemesan</th>
                          <th className="py-2.5 px-3 text-right">Order</th>
                          <th className="py-2.5 px-3 text-right">Total Sisi</th>
                          <th className="py-2.5 px-4 text-right">Lembar Kertas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.requesterBreakdown.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-slate-500">
                              Belum ada penggunaan fotokopi pada periode ini.
                            </td>
                          </tr>
                        ) : (
                          report.requesterBreakdown.map((r) => (
                            <tr key={r.email}>
                              <td className="py-2.5 px-4">
                                <div className="font-medium text-slate-900">{r.name}</div>
                                <div className="text-[11px] text-slate-500">{r.email}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">{r.orders}</td>
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                                {r.sides.toLocaleString('id-ID')}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[#1755CE]">
                                {r.sheets.toLocaleString('id-ID')}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Rincian Penggunaan Fotokopi — Periode {activePeriodLabel}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">No. Order &amp; Tgl</th>
                        <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                        <th className="py-2.5 px-3">Dokumen</th>
                        <th className="py-2.5 px-3">Cetak &amp; Kertas</th>
                        <th className="py-2.5 px-3 text-right">Hal × Rkp</th>
                        <th className="py-2.5 px-3 text-right">Sisi Aktual</th>
                        <th className="py-2.5 px-3 text-right">Lembar Kertas</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.rows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-500">
                            Tidak ada order fotokopi pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        report.rows.map((o) => (
                          <tr key={o.id}>
                            <td className="py-2.5 px-4 font-mono tabular-nums">
                              <div className="font-semibold text-[#1755CE]">{o.order_number}</div>
                              <div className="text-[11px] text-slate-500">{formatDateID(o.created_at)}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{o.requester_name}</div>
                              <div className="text-[11px] text-slate-500">{o.unit_name}</div>
                            </td>
                            <td className="py-2.5 px-3 max-w-[200px] truncate font-medium text-slate-800">
                              {o.item.document_name}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-slate-600">
                              {o.item.print_color} · {o.item.paper_size} ·{' '}
                              {o.item.print_sides === 'dua_sisi' ? '2 sisi' : '1 sisi'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {o.item.actual_page_count || o.item.page_count} ×{' '}
                              {o.item.actual_copy_count || o.item.copy_count}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {(o.item.total_print_sides || 0).toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                              {(o.item.total_paper_sheets || 0).toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <OrderStatusText status={o.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB LAMINATING */}
          {serviceTab === 'laminating' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <SummaryCard
                  label="Total Order Laminating"
                  value={report.laminating.summary.totalOrders}
                  unit="order"
                />
                <SummaryCard
                  label="Total Lembar Diajukan"
                  value={report.laminating.summary.totalRequestedSheets}
                  unit="lembar"
                />
                <SummaryCard
                  label="Total Lembar Laminating Aktual"
                  value={report.laminating.summary.totalActualSheets}
                  unit="lembar"
                  highlight
                />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">Ringkasan Laminating per Pemesan</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">Nama Pemesan</th>
                        <th className="py-2.5 px-3 text-right">Jumlah Order</th>
                        <th className="py-2.5 px-4 text-right">Total Lembar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.laminating.requesterBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-6 text-center text-slate-500">
                            Belum ada penggunaan laminating pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        report.laminating.requesterBreakdown.map((r) => (
                          <tr key={r.email}>
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{r.name}</div>
                              <div className="text-[11px] text-slate-500">{r.email}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{r.orders}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[#1755CE]">
                              {r.sheets.toLocaleString('id-ID')} lbr
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Rincian Order Laminating — Periode {activePeriodLabel}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">No. Order &amp; Tgl</th>
                        <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                        <th className="py-2.5 px-3">Dokumen</th>
                        <th className="py-2.5 px-3">Ukuran &amp; Jenis</th>
                        <th className="py-2.5 px-3 text-right">Diajukan</th>
                        <th className="py-2.5 px-3 text-right">Aktual</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.laminating.rows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            Tidak ada order laminating pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        report.laminating.rows.map((o) => (
                          <tr key={o.id}>
                            <td className="py-2.5 px-4 font-mono tabular-nums">
                              <div className="font-semibold text-[#1755CE]">{o.order_number}</div>
                              <div className="text-[11px] text-slate-500">{formatDateID(o.created_at)}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{o.requester_name}</div>
                              <div className="text-[11px] text-slate-500">{o.unit_name}</div>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-800">{o.item.document_name}</td>
                            <td className="py-2.5 px-3 text-slate-600">
                              {o.item.laminating_size || '-'} · {o.item.laminating_type || '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {(o.item.laminating_sheets || 0).toLocaleString('id-ID')} lbr
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                              {(o.item.laminating_actual_sheets ?? o.item.laminating_sheets ?? 0).toLocaleString('id-ID')} lbr
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <OrderStatusText status={o.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB PENGGUNAAN AIR GALON */}
          {serviceTab === 'galon' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  label="Total Order Air Galon"
                  value={report.galon.summary.totalOrders}
                  unit="order"
                />
                <SummaryCard
                  label="Total Galon Diminta"
                  value={report.galon.summary.totalRequestedQty}
                  unit="galon"
                />
                <SummaryCard
                  label="Total Galon Isi Terkirim"
                  value={report.galon.summary.totalDeliveredQty}
                  unit="galon"
                  highlight
                />
                <SummaryCard
                  label="Galon Kosong Dikembalikan"
                  value={report.galon.summary.totalEmptyReturnedQty}
                  unit="galon"
                />
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">Ringkasan Penggunaan Air Galon per Pemesan</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">Nama Pemesan</th>
                        <th className="py-2.5 px-3 text-right">Order</th>
                        <th className="py-2.5 px-3 text-right">Diminta</th>
                        <th className="py-2.5 px-3 text-right">Terkirim</th>
                        <th className="py-2.5 px-4 text-right">Kosong Kembali</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.galon.requesterBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            Belum ada penggunaan air galon pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        report.galon.requesterBreakdown.map((r) => (
                          <tr key={r.email}>
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{r.name}</div>
                              <div className="text-[11px] text-slate-500">{r.email}</div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{r.orders}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">{r.requestedQty}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#1755CE]">
                              {r.deliveredQty}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.emptyReturnedQty}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-900">
                    Rincian Distribusi Air Galon — Periode {activePeriodLabel}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                        <th className="py-2.5 px-4">No. Order &amp; Tgl</th>
                        <th className="py-2.5 px-3">Unit &amp; Pemesan</th>
                        <th className="py-2.5 px-3">Lokasi Tujuan</th>
                        <th className="py-2.5 px-3 text-right">Diminta</th>
                        <th className="py-2.5 px-3 text-right">Isi Terkirim</th>
                        <th className="py-2.5 px-3 text-right">Kosong Kembali</th>
                        <th className="py-2.5 px-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.galon.rows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500">
                            Tidak ada order air galon pada periode {activePeriodLabel}.
                          </td>
                        </tr>
                      ) : (
                        report.galon.rows.map((o) => (
                          <tr key={o.id}>
                            <td className="py-2.5 px-4 font-mono tabular-nums">
                              <div className="font-semibold text-[#1755CE]">{o.order_number}</div>
                              <div className="text-[11px] text-slate-500">{formatDateID(o.created_at)}</div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{o.requester_name}</div>
                              <div className="text-[11px] text-slate-500">{o.unit_name}</div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">{o.location_label || '-'}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {o.item.gallon_requested_qty || 0}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#1755CE]">
                              {o.item.gallon_delivered_qty ?? '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {o.item.gallon_empty_received_qty ?? '-'}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <OrderStatusText status={o.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Blok Nama Admin Pelapor & Tanda Tangan Otorisasi Admin */}
          <ReportSignatureBlock
            authorization={report.reportAuthorization}
            onAuthorizationUpdated={(nextAuth) =>
              setReport((prev) => (prev ? { ...prev, reportAuthorization: nextAuth } : prev))
            }
          />

          {/* Pengiriman Laporan Bulanan via Email & Riwayat Pengiriman */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Riwayat Pengiriman Email Laporan Bulanan Kepala Unit
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mencakup ringkasan Fotokopi, Laminating &amp; Air Galon ke email Kepala Unit di Master Unit (tanpa lampiran file dokumen &amp; mencegah email ganda).
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => handleDispatchEmail(false)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold disabled:opacity-60"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>{sending ? 'Mengirim...' : 'Kirim Laporan Periode Ini'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => handleDispatchEmail(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
                    title="Kirim ulang secara manual walaupun sudah pernah dikirim"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Kirim Ulang</span>
                  </button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">Waktu Kirim</th>
                    <th className="py-2.5 px-3">Unit</th>
                    <th className="py-2.5 px-3">Email Kepala Unit</th>
                    <th className="py-2.5 px-3 text-right">Order / Lembar</th>
                    <th className="py-2.5 px-3">Pemicu</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.deliveryLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500">
                        Belum ada log pengiriman email untuk periode {activePeriodLabel}.
                      </td>
                    </tr>
                  ) : (
                    report.deliveryLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-600">
                          {formatDateTimeID(log.sent_at)}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">{log.unit_name}</td>
                        <td className="py-2.5 px-3 text-slate-600">{log.recipient_email}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {log.total_orders} / {log.total_sheets.toLocaleString('id-ID')} lbr
                        </td>
                        <td className="py-2.5 px-3 uppercase font-mono text-[11px] text-slate-500">
                          {log.triggered_by}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {log.delivery_status === 'SENT' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Terkirim</span>
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-red-700 font-semibold"
                              title={log.error_message || ''}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Gagal: {log.error_message}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <SaveToDriveConfirmModal
        isOpen={driveSaveOpen}
        onClose={() => setDriveSaveOpen(false)}
        defaultFileName={`laporan-penggunaan-unit-${exportFileSlug}.pdf`}
        reportTitle={getTabTitle()}
        buildPdfBlob={buildActivePdfBlob}
      />
    </div>
  );
}

function SummaryCard({
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
