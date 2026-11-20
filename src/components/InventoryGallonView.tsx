import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Printer,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useToast } from '../context/ToastContext.tsx';
import type {
  GallonStockKind,
  InventoryAdjustment,
  InventoryBalance,
  InventoryReceipt,
  InventoryTransaction,
  OrderRecord,
  StockOpnameRecord,
  Unit,
} from '../types/lrms.ts';
import { formatDateID, formatDateTimeID } from '../utils/calculations.ts';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils.ts';
import { OrderStatusText } from './StatusText.tsx';

type InventoryTab =
  | 'dashboard'
  | 'stok'
  | 'masuk'
  | 'distribusi'
  | 'kembali'
  | 'opname'
  | 'penyesuaian'
  | 'mutasi'
  | 'laporan';

const INV_TABS: Array<{ key: InventoryTab; label: string }> = [
  { key: 'dashboard', label: 'Dashboard Stok' },
  { key: 'stok', label: 'Stok Galon' },
  { key: 'masuk', label: 'Barang Masuk' },
  { key: 'distribusi', label: 'Distribusi Galon' },
  { key: 'kembali', label: 'Pengembalian Kosong' },
  { key: 'opname', label: 'Stock Opname' },
  { key: 'penyesuaian', label: 'Penyesuaian Stok' },
  { key: 'mutasi', label: 'Riwayat Mutasi' },
  { key: 'laporan', label: 'Laporan Persediaan' },
];

export function InventoryGallonView({
  onSelectOrder,
}: {
  onSelectOrder: (orderId: string) => void;
}) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<InventoryTab>('dashboard');
  const [loading, setLoading] = useState(true);

  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [allocated, setAllocated] = useState(0);
  const [minThreshold, setMinThreshold] = useState(15);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [receipts, setReceipts] = useState<InventoryReceipt[]>([]);
  const [opnames, setOpnames] = useState<StockOpnameRecord[]>([]);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [gallonOrders, setGallonOrders] = useState<OrderRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // Form states: Barang Masuk
  const [rcvDate, setRcvDate] = useState(new Date().toISOString().slice(0, 10));
  const [rcvSupplier, setRcvSupplier] = useState('');
  const [rcvDocNo, setRcvDocNo] = useState('');
  const [rcvLocId, setRcvLocId] = useState('');
  const [rcvFilled, setRcvFilled] = useState(20);
  const [rcvEmpty, setRcvEmpty] = useState(0);
  const [rcvNotes, setRcvNotes] = useState('');

  // Form states: Pengembalian Kosong
  const [retLocId, setRetLocId] = useState('');
  const [retUnitId, setRetUnitId] = useState('');
  const [retQty, setRetQty] = useState(1);
  const [retNotes, setRetNotes] = useState('');

  // Form states: Stock Opname
  const [opnLocId, setOpnLocId] = useState('');
  const [opnDate, setOpnDate] = useState(new Date().toISOString().slice(0, 10));
  const [opnNotes, setOpnNotes] = useState('');
  const [opnCounts, setOpnCounts] = useState<Record<GallonStockKind, number>>({
    isi: 0,
    kosong: 0,
    rusak: 0,
    hilang: 0,
  });
  const [opnReasons, setOpnReasons] = useState<Record<GallonStockKind, string>>({
    isi: '',
    kosong: '',
    rusak: '',
    hilang: '',
  });

  // Form states: Penyesuaian Stok
  const [adjLocId, setAdjLocId] = useState('');
  const [adjKind, setAdjKind] = useState<GallonStockKind>('rusak');
  const [adjQty, setAdjQty] = useState(0);
  const [adjReason, setAdjReason] = useState('');

  // Filter Mutasi
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [txLocFilter, setTxLocFilter] = useState('all');

  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [invRes, ordRes, masterRes] = await Promise.all([
        apiRequest<{
          balances: InventoryBalance[];
          allocated: number;
          minThreshold: number;
          transactions?: InventoryTransaction[];
          receipts?: InventoryReceipt[];
          opnames?: StockOpnameRecord[];
          adjustments?: InventoryAdjustment[];
        }>('/inventory/overview'),
        apiRequest<{ items: OrderRecord[] }>('/orders?serviceType=galon&page=1&pageSize=30'),
        apiRequest<{ units: Unit[] }>('/master'),
      ]);

      setBalances(invRes.balances);
      setAllocated(invRes.allocated);
      setMinThreshold(invRes.minThreshold);
      setTransactions(invRes.transactions || []);
      setReceipts(invRes.receipts || []);
      setOpnames(invRes.opnames || []);
      setAdjustments(invRes.adjustments || []);
      setGallonOrders(ordRes.items);
      setUnits(masterRes.units);

      const firstLoc = invRes.balances[0]?.location_id || '';
      if (firstLoc) {
        setRcvLocId((prev) => prev || firstLoc);
        setRetLocId((prev) => prev || firstLoc);
        setOpnLocId((prev) => prev || firstLoc);
        setAdjLocId((prev) => prev || firstLoc);
      }
      if (masterRes.units[0]?.id) {
        setRetUnitId((prev) => prev || masterRes.units[0].id);
      }
    } catch (err) {
      showToast('Gagal Memuat Data Inventaris', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Sync opname default physical values from selected location balance
  useEffect(() => {
    const bal = balances.find((b) => b.location_id === opnLocId);
    if (bal) {
      setOpnCounts({
        isi: bal.qty_filled,
        kosong: bal.qty_empty,
        rusak: bal.qty_damaged,
        hilang: bal.qty_lost,
      });
    }
  }, [opnLocId, balances]);

  const totalFilled = balances.reduce((s, b) => s + b.qty_filled, 0);
  const totalEmpty = balances.reduce((s, b) => s + b.qty_empty, 0);
  const totalDamaged = balances.reduce((s, b) => s + b.qty_damaged, 0);
  const totalLost = balances.reduce((s, b) => s + b.qty_lost, 0);
  const totalDistributed = transactions
    .filter((t) => t.transaction_type === 'DISTRIBUTION')
    .reduce((s, t) => s + Math.abs(t.qty_delta), 0);
  const totalReturned = transactions
    .filter((t) => t.transaction_type === 'EMPTY_RETURN')
    .reduce((s, t) => s + t.qty_delta, 0);

  const handleSaveMinThreshold = async () => {
    setSubmitting(true);
    try {
      await apiRequest('/master/settings', {
        method: 'PATCH',
        body: { gallon_min_stock: minThreshold },
      });
      showToast('Batas Minimum Diperbarui', `Peringatan stok kritis diatur ke ${minThreshold} galon isi.`);
      await loadData();
    } catch (err) {
      showToast('Gagal Menyimpan Pengaturan', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/inventory/receipts', {
        method: 'POST',
        body: {
          receipt_date: rcvDate,
          supplier_name: rcvSupplier,
          document_number: rcvDocNo,
          location_id: rcvLocId,
          qty_filled: rcvFilled,
          qty_empty: rcvEmpty,
          notes: rcvNotes,
        },
      });
      showToast('Barang Masuk Tercatat', 'Saldo galon berhasil ditambahkan ke gudang.');
      setRcvSupplier('');
      setRcvDocNo('');
      setRcvNotes('');
      await loadData();
    } catch (err) {
      showToast('Gagal Mencatat Barang Masuk', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitEmptyReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/inventory/empty-returns', {
        method: 'POST',
        body: {
          location_id: retLocId,
          unit_id: retUnitId,
          qty_empty: retQty,
          notes: retNotes,
        },
      });
      showToast('Pengembalian Galon Kosong Dicatat', `${retQty} galon kosong ditambahkan ke stok.`);
      setRetNotes('');
      await loadData();
    } catch (err) {
      showToast('Gagal Mencatat Pengembalian', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateOpnameDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/inventory/opnames', {
        method: 'POST',
        body: {
          location_id: opnLocId,
          opname_date: opnDate,
          notes: opnNotes,
          items: (['isi', 'kosong', 'rusak', 'hilang'] as GallonStockKind[]).map((kind) => ({
            stock_kind: kind,
            physical_qty: opnCounts[kind],
            variance_reason: opnReasons[kind] || undefined,
          })),
        },
      });
      showToast('Draft Stock Opname Disimpan', 'Periksa selisih lalu klik Finalisasi untuk memperbarui saldo sistem.');
      setOpnNotes('');
      await loadData();
    } catch (err) {
      showToast('Gagal Membuat Draft Opname', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinalizeOpname = async (opnameId: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest(`/inventory/opnames/${opnameId}/finalize`, { method: 'POST' });
      showToast(
        'Stock Opname Difinalisasi',
        'Transaksi penyesuaian dibuat dan saldo sistem diperbarui secara atomic.'
      );
      await loadData();
    } catch (err) {
      showToast('Gagal Finalisasi Stock Opname', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiRequest('/inventory/adjustments', {
        method: 'POST',
        body: {
          location_id: adjLocId,
          stock_kind: adjKind,
          adjusted_qty: adjQty,
          reason: adjReason,
        },
      });
      showToast('Penyesuaian Stok Disimpan', 'Mutasi penyesuaian dan audit log tercatat.');
      setAdjReason('');
      await loadData();
    } catch (err) {
      showToast('Gagal Menyimpan Penyesuaian', (err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredTx = transactions.filter((t) => {
    if (txTypeFilter !== 'all' && t.transaction_type !== txTypeFilter) return false;
    if (txLocFilter !== 'all' && t.location_id !== txLocFilter) return false;
    return true;
  });

  const balanceExportCols = [
    { header: 'Kode Lokasi', accessor: (b: InventoryBalance) => b.location_code },
    { header: 'Nama Penyimpanan', accessor: (b: InventoryBalance) => b.location_name },
    { header: 'Gedung', accessor: (b: InventoryBalance) => b.building },
    { header: 'Galon Isi', accessor: (b: InventoryBalance) => b.qty_filled },
    { header: 'Galon Kosong', accessor: (b: InventoryBalance) => b.qty_empty },
    { header: 'Galon Rusak', accessor: (b: InventoryBalance) => b.qty_damaged },
    { header: 'Galon Hilang', accessor: (b: InventoryBalance) => b.qty_lost },
  ];

  const txExportCols = [
    { header: 'Waktu', accessor: (t: InventoryTransaction) => formatDateTimeID(t.created_at) },
    { header: 'Lokasi', accessor: (t: InventoryTransaction) => t.location_name },
    { header: 'Jenis Transaksi', accessor: (t: InventoryTransaction) => t.transaction_type },
    { header: 'Kategori Galon', accessor: (t: InventoryTransaction) => t.stock_kind },
    { header: 'Perubahan', accessor: (t: InventoryTransaction) => t.qty_delta },
    { header: 'Saldo Akhir', accessor: (t: InventoryTransaction) => t.balance_after },
    { header: 'Referensi', accessor: (t: InventoryTransaction) => t.reference_number || '-' },
    { header: 'Petugas', accessor: (t: InventoryTransaction) => t.created_by_name },
  ];

  if (loading) {
    return <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Inventory Management — Air Galon</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kontrol persediaan multi-lokasi (Isi, Kosong, Rusak, Hilang) dengan transaksi atomic dan audit trail.
          </p>
        </div>
        {totalFilled <= minThreshold && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Stok Kritis: {totalFilled} / min {minThreshold}</span>
          </div>
        )}
      </div>

      {/* Sub-Menu Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto no-print">
        {INV_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              tab === t.key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 1. DASHBOARD STOK */}
      {tab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InvStat label="Total Galon Isi" value={totalFilled} sub={`Bebas: ${Math.max(0, totalFilled - allocated)} · Alokasi: ${allocated}`} />
            <InvStat label="Total Galon Kosong" value={totalEmpty} sub="Siap tukar ke supplier" />
            <InvStat label="Galon Rusak / Hilang" value={totalDamaged + totalLost} sub={`Rusak: ${totalDamaged} · Hilang: ${totalLost}`} tone={totalDamaged + totalLost > 0 ? 'warning' : 'default'} />
            <InvStat label="Distribusi vs Kembali" value={totalDistributed} sub={`Didistribusikan: ${totalDistributed} · Kembali: ${totalReturned}`} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Posisi Stok per Lokasi Penyimpanan</h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Batas Minimum:</span>
                <input
                  type="number"
                  min={0}
                  value={minThreshold}
                  onChange={(e) => setMinThreshold(Math.max(0, Number(e.target.value)))}
                  className="w-16 px-2 py-1 font-mono tabular-nums border border-slate-300 rounded"
                />
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveMinThreshold}
                  className="px-2.5 py-1 rounded bg-[#1755CE] text-white font-semibold"
                >
                  Simpan
                </button>
              </div>
            </div>
            <BalanceTable balances={balances} />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Mutasi Terakhir</h3>
              <button
                type="button"
                onClick={() => setTab('mutasi')}
                className="text-xs font-semibold text-[#1755CE] hover:underline"
              >
                Lihat Semua Mutasi
              </button>
            </div>
            <TransactionTable rows={transactions.slice(0, 8)} />
          </div>
        </div>
      )}

      {/* 2. STOK GALON */}
      {tab === 'stok' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Rincian Stok Galon Multi-Lokasi</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pemisahan status fisik galon: Isi, Kosong, Rusak, dan Hilang tercatat.
            </p>
          </div>
          <BalanceTable balances={balances} />
        </div>
      )}

      {/* 3. BARANG MASUK */}
      {tab === 'masuk' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSubmitReceipt}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <ArrowDownToLine className="w-4 h-4 text-[#1755CE]" />
              <h3 className="text-sm font-bold text-slate-900">Catat Penerimaan Supplier</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tanggal *</label>
                <input
                  type="date"
                  required
                  value={rcvDate}
                  onChange={(e) => setRcvDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">No. Surat Jalan</label>
                <input
                  type="text"
                  value={rcvDocNo}
                  onChange={(e) => setRcvDocNo(e.target.value)}
                  placeholder="SJ-2026-..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">Nama Supplier *</label>
              <input
                type="text"
                required
                value={rcvSupplier}
                onChange={(e) => setRcvSupplier(e.target.value)}
                placeholder="PT Tirta Investama / Depot Mitra"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">Lokasi Penyimpanan *</label>
              <select
                required
                value={rcvLocId}
                onChange={(e) => setRcvLocId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
              >
                {balances.map((b) => (
                  <option key={b.location_id} value={b.location_id}>
                    {b.location_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jumlah Galon Isi</label>
                <input
                  type="number"
                  min={0}
                  value={rcvFilled}
                  onChange={(e) => setRcvFilled(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jumlah Galon Kosong</label>
                <input
                  type="number"
                  min={0}
                  value={rcvEmpty}
                  onChange={(e) => setRcvEmpty(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">Keterangan</label>
              <input
                type="text"
                value={rcvNotes}
                onChange={(e) => setRcvNotes(e.target.value)}
                placeholder="Catatan pengiriman supplier..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold"
            >
              Simpan Barang Masuk
            </button>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Riwayat Penerimaan Barang Masuk</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">No. Penerimaan</th>
                    <th className="py-2.5 px-3">Supplier &amp; Dokumen</th>
                    <th className="py-2.5 px-3">Lokasi</th>
                    <th className="py-2.5 px-4 text-right">Isi / Kosong</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                        {r.receipt_number}
                        <div className="text-[11px] font-normal text-slate-500">
                          {formatDateID(r.receipt_date)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{r.supplier_name}</div>
                        <div className="text-[11px] text-slate-500">{r.document_number || '-'}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">{r.location_name}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        +{r.qty_filled} isi · +{r.qty_empty} kosong
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. DISTRIBUSI GALON */}
      {tab === 'distribusi' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ArrowUpFromLine className="w-4 h-4 text-[#1755CE]" />
                <span>Daftar Distribusi &amp; Order Air Galon</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Klik baris order aktif untuk membuka modal konfirmasi pengiriman &amp; penerimaan galon kosong secara atomic.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-2.5 px-4">No. Order</th>
                  <th className="py-2.5 px-3">Unit Penerima &amp; Lokasi</th>
                  <th className="py-2.5 px-3">Diminta / Dikirim</th>
                  <th className="py-2.5 px-3">Kosong Diterima</th>
                  <th className="py-2.5 px-3">Petugas</th>
                  <th className="py-2.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gallonOrders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => onSelectOrder(o.id)}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                      {o.order_number}
                      <div className="text-[11px] font-normal text-slate-400">
                        {formatDateID(o.needed_date)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{o.unit_name}</div>
                      <div className="text-[11px] text-slate-500">{o.location_label || '-'}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      {o.item.gallon_requested_qty} / {o.item.gallon_delivered_qty ?? '-'}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums">
                      {o.item.gallon_empty_received_qty ?? `rencana ${o.item.gallon_empty_return_planned || 0}`}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{o.assigned_staff_name || '-'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <OrderStatusText status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. PENGEMBALIAN GALON KOSONG */}
      {tab === 'kembali' && (
        <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <RotateCcw className="w-4 h-4 text-[#1755CE]" />
            <h3 className="text-sm font-bold text-slate-900">Catat Pengembalian Galon Kosong</h3>
          </div>
          <form onSubmit={handleSubmitEmptyReturn} className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Unit Pengembali</label>
              <select
                value={retUnitId}
                onChange={(e) => setRetUnitId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gudang Tujuan *</label>
                <select
                  required
                  value={retLocId}
                  onChange={(e) => setRetLocId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {balances.map((b) => (
                    <option key={b.location_id} value={b.location_id}>
                      {b.location_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Jumlah Galon Kosong *</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={retQty}
                  onChange={(e) => setRetQty(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Catatan</label>
              <input
                type="text"
                value={retNotes}
                onChange={(e) => setRetNotes(e.target.value)}
                placeholder="Keterangan penarikan galon kosong..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold"
            >
              Simpan Pengembalian Kosong
            </button>
          </form>
        </div>
      )}

      {/* 6. STOCK OPNAME */}
      {tab === 'opname' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleCreateOpnameDraft}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <ClipboardCheck className="w-4 h-4 text-[#1755CE]" />
              <h3 className="text-sm font-bold text-slate-900">Buat Draft Stock Opname</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lokasi Pemeriksaan *</label>
                <select
                  required
                  value={opnLocId}
                  onChange={(e) => setOpnLocId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {balances.map((b) => (
                    <option key={b.location_id} value={b.location_id}>
                      {b.location_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tanggal Opname *</label>
                <input
                  type="date"
                  required
                  value={opnDate}
                  onChange={(e) => setOpnDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {(['isi', 'kosong', 'rusak', 'hilang'] as GallonStockKind[]).map((kind) => {
              const bal = balances.find((b) => b.location_id === opnLocId);
              const sys = bal
                ? kind === 'isi'
                  ? bal.qty_filled
                  : kind === 'kosong'
                  ? bal.qty_empty
                  : kind === 'rusak'
                  ? bal.qty_damaged
                  : bal.qty_lost
                : 0;
              const diff = opnCounts[kind] - sys;
              return (
                <div key={kind} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800 capitalize">Galon {kind}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      Sistem: {sys} · Selisih:{' '}
                      <strong className={diff === 0 ? 'text-slate-700' : diff > 0 ? 'text-emerald-700' : 'text-red-700'}>
                        {diff > 0 ? `+${diff}` : diff}
                      </strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      min={0}
                      value={opnCounts[kind]}
                      onChange={(e) =>
                        setOpnCounts((prev) => ({ ...prev, [kind]: Math.max(0, Number(e.target.value)) }))
                      }
                      className="px-2.5 py-1.5 font-mono tabular-nums bg-white border border-slate-300 rounded"
                      placeholder="Fisik"
                    />
                    <input
                      type="text"
                      value={opnReasons[kind]}
                      onChange={(e) =>
                        setOpnReasons((prev) => ({ ...prev, [kind]: e.target.value }))
                      }
                      className="col-span-2 px-2.5 py-1.5 bg-white border border-slate-300 rounded"
                      placeholder="Penyebab selisih (jika ada)"
                    />
                  </div>
                </div>
              );
            })}

            <div className="text-xs">
              <label className="block font-semibold text-slate-700 mb-1">Catatan Pemeriksa</label>
              <input
                type="text"
                value={opnNotes}
                onChange={(e) => setOpnNotes(e.target.value)}
                placeholder="Catatan hasil opname..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold"
            >
              Simpan sebagai Draft Opname
            </button>
          </form>

          <div className="lg:col-span-7 space-y-4">
            {opnames.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
                Belum ada catatan Stock Opname. Buat draft di sebelah kiri untuk memulai pemeriksaan fisik.
              </div>
            ) : (
              opnames.map((op) => (
                <div key={op.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-sm font-bold text-[#1755CE]">
                          {op.opname_number}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-semibold ${
                            op.status === 'Final' ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {op.status === 'Final' ? <Lock className="w-3.5 h-3.5" /> : null}
                          <span>{op.status}</span>
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {op.location_name} · {formatDateID(op.opname_date)} · Pemeriksa: {op.inspector_name}
                      </div>
                    </div>
                    {op.status === 'Draft' && (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleFinalizeOpname(op.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Finalisasi &amp; Sesuaikan Stok</span>
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-y border-slate-200 text-[11px] text-slate-500">
                          <th className="py-2 px-3">Jenis</th>
                          <th className="py-2 px-3 text-right">Stok Sistem</th>
                          <th className="py-2 px-3 text-right">Stok Fisik</th>
                          <th className="py-2 px-3 text-right">Selisih</th>
                          <th className="py-2 px-3">Keterangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {op.items.map((line) => (
                          <tr key={line.stock_kind}>
                            <td className="py-2 px-3 capitalize font-medium text-slate-800">{line.stock_kind}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{line.system_qty}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">{line.physical_qty}</td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                                line.variance_qty === 0
                                  ? 'text-slate-600'
                                  : line.variance_qty > 0
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {line.variance_qty > 0 ? `+${line.variance_qty}` : line.variance_qty}
                            </td>
                            <td className="py-2 px-3 text-slate-500">{line.variance_reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 7. PENYESUAIAN STOK */}
      {tab === 'penyesuaian' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSubmitAdjustment}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <Sliders className="w-4 h-4 text-[#1755CE]" />
              <h3 className="text-sm font-bold text-slate-900">Penyesuaian Stok Manual</h3>
            </div>
            <div className="text-xs space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lokasi *</label>
                <select
                  required
                  value={adjLocId}
                  onChange={(e) => setAdjLocId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {balances.map((b) => (
                    <option key={b.location_id} value={b.location_id}>
                      {b.location_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori Stok *</label>
                  <select
                    value={adjKind}
                    onChange={(e) => setAdjKind(e.target.value as GallonStockKind)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="isi">Galon Isi</option>
                    <option value="kosong">Galon Kosong</option>
                    <option value="rusak">Galon Rusak</option>
                    <option value="hilang">Galon Hilang</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nilai Stok Baru *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={adjQty}
                    onChange={(e) => setAdjQty(Math.max(0, Number(e.target.value)))}
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Alasan Penyesuaian *</label>
                <textarea
                  rows={2}
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Contoh: Galon retak saat pemindahan gudang..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold"
              >
                Simpan Penyesuaian Stok
              </button>
            </div>
          </form>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900">Histori Penyesuaian Stok</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">No. Penyesuaian</th>
                    <th className="py-2.5 px-3">Lokasi &amp; Jenis</th>
                    <th className="py-2.5 px-3 text-right">Awal → Baru (Delta)</th>
                    <th className="py-2.5 px-4">Alasan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adjustments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">
                        Belum ada penyesuaian stok.
                      </td>
                    </tr>
                  ) : (
                    adjustments.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-4 font-mono tabular-nums font-semibold text-[#1755CE]">
                          {a.adjustment_number}
                          <div className="text-[11px] font-normal text-slate-400">
                            {formatDateTimeID(a.created_at)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-900">{a.location_name}</div>
                          <div className="text-[11px] text-slate-500 capitalize">Galon {a.stock_kind}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {a.previous_qty} → {a.adjusted_qty} ({a.delta_qty > 0 ? `+${a.delta_qty}` : a.delta_qty})
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{a.reason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 8. RIWAYAT MUTASI */}
      {tab === 'mutasi' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">Buku Besar Mutasi Stok Air Galon</h3>
            <div className="flex items-center gap-2 text-xs">
              <select
                value={txLocFilter}
                onChange={(e) => setTxLocFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
              >
                <option value="all">Semua Lokasi</option>
                {balances.map((b) => (
                  <option key={b.location_id} value={b.location_id}>
                    {b.location_name}
                  </option>
                ))}
              </select>
              <select
                value={txTypeFilter}
                onChange={(e) => setTxTypeFilter(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg"
              >
                <option value="all">Semua Jenis</option>
                <option value="RECEIPT">Barang Masuk</option>
                <option value="DISTRIBUTION">Distribusi</option>
                <option value="EMPTY_RETURN">Kembali Kosong</option>
                <option value="OPNAME_ADJUSTMENT">Penyesuaian Opname</option>
                <option value="MANUAL_ADJUSTMENT">Penyesuaian Manual</option>
              </select>
            </div>
          </div>
          <TransactionTable rows={filteredTx} />
        </div>
      )}

      {/* 9. LAPORAN PERSEDIAAN */}
      {tab === 'laporan' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Ekspor Laporan Persediaan &amp; Mutasi Galon</h3>
              <p className="text-xs text-slate-500">
                Unduh laporan posisi stok per lokasi maupun buku besar mutasi dalam format Excel, CSV, atau PDF.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => exportToCSV('posisi-stok-galon', balanceExportCols, balances)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV Saldo</span>
              </button>
              <button
                type="button"
                onClick={() => exportToExcel('mutasi-galon-lrms', 'Mutasi', txExportCols, filteredTx)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Excel Mutasi</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToPDF(
                    'laporan-persediaan-galon',
                    'Laporan Persediaan Air Galon Lazuardi',
                    `Total Isi: ${totalFilled} · Kosong: ${totalEmpty} · Rusak: ${totalDamaged} · Hilang: ${totalLost}`,
                    balanceExportCols,
                    balances
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium"
              >
                <FileText className="w-3.5 h-3.5 text-red-600" />
                <span>PDF Persediaan</span>
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

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <BalanceTable balances={balances} />
          </div>
        </div>
      )}
    </div>
  );
}

function InvStat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: number;
  sub: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold font-mono tabular-nums ${
          tone === 'warning' ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value.toLocaleString('id-ID')}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

function BalanceTable({ balances }: { balances: InventoryBalance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
            <th className="py-2.5 px-4">Kode</th>
            <th className="py-2.5 px-3">Lokasi Penyimpanan</th>
            <th className="py-2.5 px-3 text-right">Galon Isi</th>
            <th className="py-2.5 px-3 text-right">Galon Kosong</th>
            <th className="py-2.5 px-3 text-right">Galon Rusak</th>
            <th className="py-2.5 px-4 text-right">Galon Hilang</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {balances.map((b) => (
            <tr key={b.id}>
              <td className="py-2.5 px-4 font-mono font-semibold text-slate-700">{b.location_code}</td>
              <td className="py-2.5 px-3">
                <div className="font-medium text-slate-900">{b.location_name}</div>
                <div className="text-[11px] text-slate-500">{b.building}</div>
              </td>
              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#1755CE]">
                {b.qty_filled}
              </td>
              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">{b.qty_empty}</td>
              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">{b.qty_damaged}</td>
              <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-700">{b.qty_lost}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionTable({ rows }: { rows: InventoryTransaction[] }) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-xs text-slate-500">Belum ada mutasi stok.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
            <th className="py-2.5 px-4">Waktu</th>
            <th className="py-2.5 px-3">Lokasi &amp; Transaksi</th>
            <th className="py-2.5 px-3">Jenis Galon</th>
            <th className="py-2.5 px-3 text-right">Delta</th>
            <th className="py-2.5 px-3 text-right">Saldo Akhir</th>
            <th className="py-2.5 px-4">Referensi &amp; Catatan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                {formatDateTimeID(t.created_at)}
              </td>
              <td className="py-2.5 px-3">
                <div className="font-medium text-slate-900">{t.location_name}</div>
                <div className="text-[11px] text-slate-500">{t.transaction_type}</div>
              </td>
              <td className="py-2.5 px-3 capitalize text-slate-700">{t.stock_kind}</td>
              <td
                className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                  t.qty_delta > 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {t.qty_delta > 0 ? `+${t.qty_delta}` : t.qty_delta}
              </td>
              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                {t.balance_after}
              </td>
              <td className="py-2.5 px-4">
                <div className="font-mono text-[#1755CE]">{t.reference_number || '-'}</div>
                <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                  {t.notes} · {t.created_by_name}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
