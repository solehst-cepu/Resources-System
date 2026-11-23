import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Printer,
  Search,
  Trash2,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type {
  InventoryLocation,
  OrderRecord,
  OrderStatus,
  Unit,
  UserProfile,
} from '../types/lrms.ts';
import {
  calculatePhotocopyMetrics,
  formatBytes,
  formatDateID,
  formatDateTimeID,
  getServiceLabel,
} from '../utils/calculations.ts';
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils.ts';
import { OrderStatusText } from './StatusText.tsx';

const STATUS_TABS = [
  { key: 'all', label: 'Semua Order' },
  { key: 'Menunggu Diproses', label: 'Order Baru' },
  { key: 'Diproses', label: 'Dalam Proses' },
  { key: 'Siap Diambil', label: 'Siap Diambil' },
  { key: 'Dalam Pengiriman', label: 'Dalam Pengiriman' },
  { key: 'Selesai', label: 'Selesai' },
  { key: 'Dibatalkan', label: 'Dibatalkan' },
];

export function OrderManagementView({
  mineOnly = false,
  initialSelectedOrderId,
  onClearSelectedOrder,
}: {
  mineOnly?: boolean;
  initialSelectedOrderId?: string | null;
  onClearSelectedOrder?: () => void;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [unitFilter, setUnitFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [units, setUnits] = useState<Unit[]>([]);
  const [invLocations, setInvLocations] = useState<InventoryLocation[]>([]);
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Admin action states inside detail modal
  const [internalNotes, setInternalNotes] = useState('');
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [actualPages, setActualPages] = useState<number>(0);
  const [actualCopies, setActualCopies] = useState<number>(0);
  const [actualLamSheets, setActualLamSheets] = useState<number>(0);

  // Gallon completion modal state
  const [gallonLocId, setGallonLocId] = useState('');
  const [gallonDelivered, setGallonDelivered] = useState(0);
  const [gallonEmptyReceived, setGallonEmptyReceived] = useState(0);
  const [gallonCompleteNotes, setGallonCompleteNotes] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

  // Cancel modal state
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Admin delete order modal state
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<OrderRecord | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deletingOrder, setDeletingOrder] = useState(false);

  const isAdmin = !mineOnly && (user?.role === 'super_admin' || user?.role === 'admin_resources');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const loadMaster = async () => {
      try {
        const master = await apiRequest<{
          units: Unit[];
          inventoryLocations: InventoryLocation[];
          users: UserProfile[];
        }>('/master');
        setUnits(master.units);
        setInvLocations(master.inventoryLocations);
        setStaffList(
          master.users.filter((u) => u.role === 'admin_resources' || u.role === 'super_admin')
        );
        const defLoc = master.inventoryLocations.find((l) => l.is_default) || master.inventoryLocations[0];
        if (defLoc) setGallonLocId(defLoc.id);
      } catch {
        // silent fallback
      }
    };
    void loadMaster();
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        serviceType: serviceFilter,
        status: statusFilter,
        unitId: unitFilter,
        mineOnly: String(mineOnly),
      });
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      if (debouncedSearch) qs.set('search', debouncedSearch);

      const res = await apiRequest<{ items: OrderRecord[]; total: number }>(`/orders?${qs.toString()}`);
      setOrders(res.items);
      setTotal(res.total);
    } catch (err) {
      showToast('Gagal Memuat Order', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [page, serviceFilter, statusFilter, unitFilter, dateFrom, dateTo, debouncedSearch, mineOnly, showToast]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const openOrderDetail = useCallback(async (orderId: string) => {
    setDetailLoading(true);
    setShowCancelConfirm(false);
    setCancelReason('');
    try {
      const res = await apiRequest<{ order: OrderRecord }>(`/orders/${orderId}`);
      const ord = res.order;
      setSelectedOrder(ord);
      setInternalNotes(ord.internal_notes || '');
      setAssignedStaffId(ord.assigned_staff_id || '');
      setActualPages(ord.item.actual_page_count || ord.item.page_count || 1);
      setActualCopies(ord.item.actual_copy_count || ord.item.copy_count || 1);
      setActualLamSheets(ord.item.laminating_actual_sheets ?? ord.item.laminating_sheets ?? 1);
      setGallonDelivered(ord.item.gallon_requested_qty || 1);
      setGallonEmptyReceived(ord.item.gallon_empty_return_planned || 0);
      setGallonCompleteNotes('');
    } catch (err) {
      showToast('Gagal Membuka Detail Order', (err as Error).message, 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (initialSelectedOrderId) {
      void openOrderDetail(initialSelectedOrderId);
      onClearSelectedOrder?.();
    }
  }, [initialSelectedOrderId, openOrderDetail, onClearSelectedOrder]);

  const handleStatusChange = async (newStatus: OrderStatus, note?: string) => {
    if (!selectedOrder) return;
    setProcessingAction(true);
    try {
      await apiRequest(`/orders/${selectedOrder.id}/status`, {
        method: 'PATCH',
        body: {
          status: newStatus,
          note,
          internal_notes: isAdmin ? internalNotes : undefined,
          assigned_staff_id: isAdmin && assignedStaffId ? assignedStaffId : undefined,
          actual_page_count:
            isAdmin && selectedOrder.service_type === 'fotokopi' ? actualPages : undefined,
          actual_copy_count:
            isAdmin && selectedOrder.service_type === 'fotokopi' ? actualCopies : undefined,
          laminating_actual_sheets:
            isAdmin && selectedOrder.service_type === 'laminating' ? actualLamSheets : undefined,
        },
      });
      showToast('Status Order Diperbarui', `${selectedOrder.order_number} kini berstatus ${newStatus}.`);
      await openOrderDetail(selectedOrder.id);
      await fetchOrders();
    } catch (err) {
      showToast('Gagal Memperbarui Status', (err as Error).message, 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleCompleteGallonDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || processingAction) return;
    setProcessingAction(true);
    try {
      await apiRequest(`/orders/${selectedOrder.id}/complete-gallon`, {
        method: 'POST',
        body: {
          location_id: gallonLocId,
          delivered_qty: gallonDelivered,
          empty_received_qty: gallonEmptyReceived,
          notes: gallonCompleteNotes || undefined,
        },
      });
      showToast(
        'Pengiriman Galon Dikonfirmasi',
        `Stok gudang diperbarui secara atomic & order ${selectedOrder.order_number} selesai.`
      );
      await openOrderDetail(selectedOrder.id);
      await fetchOrders();
    } catch (err) {
      showToast('Gagal Konfirmasi Pengiriman', (err as Error).message, 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleUserCancel = async () => {
    if (!selectedOrder) return;
    setProcessingAction(true);
    try {
      await apiRequest(`/orders/${selectedOrder.id}/status`, {
        method: 'PATCH',
        body: {
          status: 'Dibatalkan',
          cancel_reason: cancelReason.trim() || 'Dibatalkan oleh pemesan',
        },
      });
      showToast('Order Dibatalkan', `Permintaan ${selectedOrder.order_number} berhasil dibatalkan.`);
      setShowCancelConfirm(false);
      await openOrderDetail(selectedOrder.id);
      await fetchOrders();
    } catch (err) {
      showToast('Gagal Membatalkan Order', (err as Error).message, 'error');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleConfirmDeleteOrder = async () => {
    if (!deleteTargetOrder || deletingOrder) return;
    setDeletingOrder(true);
    try {
      await apiRequest(`/orders/${deleteTargetOrder.id}`, {
        method: 'DELETE',
        body: deleteReason.trim() ? { reason: deleteReason.trim() } : undefined,
      });
      showToast(
        'Order Dihapus',
        `Data order ${deleteTargetOrder.order_number} berhasil dihapus permanen.`
      );
      if (selectedOrder?.id === deleteTargetOrder.id) {
        setSelectedOrder(null);
      }
      setDeleteTargetOrder(null);
      setDeleteReason('');
      await fetchOrders();
    } catch (err) {
      showToast('Gagal Menghapus Order', (err as Error).message, 'error');
    } finally {
      setDeletingOrder(false);
    }
  };

  const handleDownloadAttachment = async (orderId: string, attachmentId: string) => {
    try {
      const res = await apiRequest<{ signedUrl: string }>(
        `/orders/${orderId}/attachments/${attachmentId}/signed-url`
      );
      const link = document.createElement('a');
      link.href = res.signedUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Akses Dokumen Diberikan', 'Signed URL aktif selama 60 detik.');
    } catch (err) {
      showToast('Akses Dokumen Ditolak', (err as Error).message, 'error');
    }
  };

  const exportColumns = [
    { header: 'No. Order', accessor: (o: OrderRecord) => o.order_number },
    { header: 'Layanan', accessor: (o: OrderRecord) => getServiceLabel(o.service_type) },
    { header: 'Unit', accessor: (o: OrderRecord) => o.unit_name },
    { header: 'Pemesan', accessor: (o: OrderRecord) => o.requester_name },
    { header: 'Tgl Kebutuhan', accessor: (o: OrderRecord) => o.needed_date },
    {
      header: 'Rincian',
      accessor: (o: OrderRecord) =>
        o.service_type === 'galon'
          ? `${o.item.gallon_requested_qty} galon`
          : o.service_type === 'fotokopi'
          ? `${o.item.document_name} (${o.item.total_paper_sheets} lbr)`
          : `${o.item.document_name} (${o.item.laminating_sheets} lbr)`,
    },
    { header: 'Status', accessor: (o: OrderRecord) => o.status },
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {/* Header & Ekspor */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {mineOnly ? 'Riwayat & Status Pesanan Saya' : 'Order Management Pusat'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {mineOnly
              ? 'Pantau progres pesanan Anda atau batalkan order yang masih menunggu diproses.'
              : 'Kelola antrean order Air Galon, Fotokopi, dan Laminating lintas unit sekolah.'}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => exportToCSV('daftar-order-lrms', exportColumns, orders)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={() => exportToExcel('daftar-order-lrms', 'Orders', exportColumns, orders)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportToPDF(
                'daftar-order-lrms',
                'Daftar Order Layanan Resources',
                `Dicetak oleh ${user?.full_name || ''} · Total ${orders.length} baris pada halaman ini`,
                exportColumns,
                orders
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5 text-red-600" />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Segmented Filter Status Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto no-print">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setStatusFilter(tab.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              statusFilter === tab.key
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Toolbar Pencarian & Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <div className="relative lg:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari no. order (GAL/FCP/LAM), pemesan, dokumen..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
          />
        </div>

        <select
          value={serviceFilter}
          onChange={(e) => {
            setServiceFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
        >
          <option value="all">Semua Layanan</option>
          <option value="galon">Air Galon</option>
          <option value="fotokopi">Fotokopi</option>
          <option value="laminating">Laminating</option>
        </select>

        {!mineOnly && (
          <select
            value={unitFilter}
            onChange={(e) => {
              setUnitFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
          >
            <option value="all">Semua Unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            title="Tanggal kebutuhan dari"
            className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            title="Tanggal kebutuhan sampai"
            className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg"
          />
        </div>
      </div>

      {/* Tabel Order */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden no-print">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-slate-700">Tidak ada order ditemukan</p>
            <p className="text-xs text-slate-500 mt-1">
              Ubah filter pencarian atau buat permintaan layanan baru.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-3">No. Order</th>
                  <th className="py-3 px-2.5">Layanan</th>
                  <th className="py-3 px-2.5">Pemesan &amp; Unit</th>
                  <th className="py-3 px-2.5">Ringkasan Item</th>
                  <th className="py-3 px-2.5">Tgl Dibutuhkan</th>
                  <th className="py-3 px-2.5">Status</th>
                  <th className="py-3 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => openOrderDetail(o.id)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3 font-mono tabular-nums font-semibold text-[#1755CE] whitespace-nowrap">
                      {o.order_number}
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap font-medium text-slate-800">
                      {getServiceLabel(o.service_type)}
                    </td>
                    <td className="py-3 px-2.5">
                      <div className="font-medium text-slate-900">{o.requester_name}</div>
                      <div className="text-[11px] text-slate-500">{o.unit_name}</div>
                    </td>
                    <td className="py-3 px-2.5 max-w-[180px]">
                      {o.service_type === 'galon' && (
                        <span className="font-mono tabular-nums text-slate-700">
                          {o.item.gallon_requested_qty} galon isi · tukar{' '}
                          {o.item.gallon_empty_return_planned || 0} kosong
                        </span>
                      )}
                      {o.service_type === 'fotokopi' && (
                        <div>
                          <div className="truncate font-medium text-slate-800">{o.item.document_name}</div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            {o.item.page_count} hal × {o.item.copy_count} rkp ·{' '}
                            {o.item.total_paper_sheets} lbr ({o.item.print_color})
                          </div>
                        </div>
                      )}
                      {o.service_type === 'laminating' && (
                        <div>
                          <div className="truncate font-medium text-slate-800">{o.item.document_name}</div>
                          <div className="text-[11px] font-mono tabular-nums text-slate-500">
                            {o.item.laminating_size} · {o.item.laminating_sheets} lembar
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {formatDateID(o.needed_date)}
                      {o.needed_time ? ` · ${o.needed_time}` : ''}
                    </td>
                    <td className="py-3 px-2.5">
                      <OrderStatusText status={o.status} />
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openOrderDetail(o.id);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 hover:border-[#1755CE] text-xs font-medium text-slate-700 hover:text-[#1755CE]"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Detail</span>
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            title={`Hapus order ${o.order_number}`}
                            aria-label={`Hapus order ${o.order_number}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteReason('');
                              setDeleteTargetOrder(o);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-red-50/60 hover:bg-red-100 hover:border-red-300 text-xs font-medium text-red-700 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            Total {total} order · Halaman {page} dari {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        </div>
      </div>

      {/* Modal Detail Order & Cetak Work Order */}
      {(selectedOrder || detailLoading) && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            {detailLoading || !selectedOrder ? (
              <div className="p-8 text-center text-sm text-slate-500">Memuat detail order...</div>
            ) : (
              <div>
                {/* Header Cetak / Modal */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold font-mono tabular-nums text-[#1755CE]">
                        {selectedOrder.order_number}
                      </span>
                      <OrderStatusText status={selectedOrder.status} />
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {getServiceLabel(selectedOrder.service_type)} · {selectedOrder.unit_name} · Dibuat{' '}
                      {formatDateTimeID(selectedOrder.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 no-print">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteReason('');
                          setDeleteTargetOrder(selectedOrder);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-medium text-red-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Order</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Cetak Work Order</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(null)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Informasi Utama */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-slate-500">Pemesan</div>
                      <div className="font-semibold text-slate-900 mt-0.5">{selectedOrder.requester_name}</div>
                      <div className="text-slate-500">{selectedOrder.requester_email}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Unit &amp; Lokasi</div>
                      <div className="font-semibold text-slate-900 mt-0.5">{selectedOrder.unit_name}</div>
                      <div className="text-slate-600">{selectedOrder.location_label || '-'}</div>
                    </div>
                    <div>
                      <div className="text-slate-500">Tanggal Kebutuhan</div>
                      <div className="font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
                        {formatDateID(selectedOrder.needed_date)}{' '}
                        {selectedOrder.needed_time ? `(${selectedOrder.needed_time})` : ''}
                      </div>
                      {selectedOrder.assigned_staff_name && (
                        <div className="text-slate-500 mt-0.5">
                          Petugas: {selectedOrder.assigned_staff_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detail Spesifik Layanan */}
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
                    {selectedOrder.service_type === 'galon' && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <div className="text-slate-500">Diminta</div>
                          <div className="font-bold font-mono tabular-nums text-slate-900">
                            {selectedOrder.item.gallon_requested_qty} galon
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Rencana Tukar Kosong</div>
                          <div className="font-bold font-mono tabular-nums text-slate-900">
                            {selectedOrder.item.gallon_empty_return_planned || 0} galon
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Aktual Dikirim</div>
                          <div className="font-bold font-mono tabular-nums text-emerald-700">
                            {selectedOrder.item.gallon_delivered_qty ?? '-'} galon
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Kosong Diterima</div>
                          <div className="font-bold font-mono tabular-nums text-slate-900">
                            {selectedOrder.item.gallon_empty_received_qty ?? '-'} galon
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedOrder.service_type === 'fotokopi' && (
                      <div className="space-y-2">
                        <div className="font-semibold text-slate-900 text-sm">
                          Dokumen: {selectedOrder.item.document_name}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                          <div>
                            <span className="text-slate-500 block font-sans">Spesifikasi</span>
                            {selectedOrder.item.paper_size} · {selectedOrder.item.print_color}
                          </div>
                          <div>
                            <span className="text-slate-500 block font-sans">Sisi Cetak</span>
                            {selectedOrder.item.print_sides === 'dua_sisi' ? 'Dua Sisi' : 'Satu Sisi'}
                          </div>
                          <div>
                            <span className="text-slate-500 block font-sans">Total Sisi Aktual</span>
                            {selectedOrder.item.total_print_sides} sisi
                          </div>
                          <div>
                            <span className="text-slate-500 block font-sans">Total Lembar Kertas</span>
                            <strong>{selectedOrder.item.total_paper_sheets} lembar</strong>
                          </div>
                        </div>
                        {selectedOrder.item.finishing_notes && (
                          <div className="text-slate-600">
                            Finishing: <strong>{selectedOrder.item.finishing_notes}</strong>
                          </div>
                        )}
                        {(selectedOrder.attachments || []).length > 0 && (
                          <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-2 no-print">
                            {selectedOrder.attachments!.map((att) => (
                              <button
                                key={att.id}
                                type="button"
                                onClick={() => handleDownloadAttachment(selectedOrder.id, att.id)}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-[#1755CE] text-xs font-medium text-[#1755CE]"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>
                                  Unduh {att.file_name} ({formatBytes(att.file_size_bytes)})
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {selectedOrder.service_type === 'laminating' && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="col-span-2">
                          <div className="text-slate-500">Dokumen</div>
                          <div className="font-semibold text-slate-900">{selectedOrder.item.document_name}</div>
                        </div>
                        <div>
                          <div className="text-slate-500">Ukuran &amp; Jenis</div>
                          <div className="font-semibold text-slate-900">
                            {selectedOrder.item.laminating_size} · {selectedOrder.item.laminating_type}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Jumlah Lembar</div>
                          <div className="font-bold font-mono tabular-nums text-slate-900">
                            {selectedOrder.item.laminating_actual_sheets ?? selectedOrder.item.laminating_sheets} lembar
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedOrder.notes && (
                      <div className="pt-2 border-t border-slate-200 text-slate-600">
                        Catatan Pemesan: {selectedOrder.notes}
                      </div>
                    )}
                    {selectedOrder.cancel_reason && (
                      <div className="pt-2 border-t border-red-200 text-red-700 font-medium">
                        Alasan Pembatalan: {selectedOrder.cancel_reason}
                      </div>
                    )}
                  </div>

                  {/* Aksi User Pemesan: Batalkan Order (hanya jika Menunggu Diproses) */}
                  {selectedOrder.requester_id === user?.id &&
                    selectedOrder.status === 'Menunggu Diproses' &&
                    !isAdmin && (
                      <div className="pt-2 border-t border-slate-200 no-print">
                        {!showCancelConfirm ? (
                          <button
                            type="button"
                            onClick={() => setShowCancelConfirm(true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Batalkan Permintaan</span>
                          </button>
                        ) : (
                          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 space-y-2.5">
                            <div className="text-xs font-semibold text-red-900">
                              Konfirmasi Pembatalan Order
                            </div>
                            <input
                              type="text"
                              value={cancelReason}
                              onChange={(e) => setCancelReason(e.target.value)}
                              placeholder="Alasan pembatalan (opsional)..."
                              className="w-full px-3 py-1.5 text-xs bg-white border border-red-200 rounded-lg"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={processingAction}
                                onClick={handleUserCancel}
                                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                              >
                                Ya, Batalkan Order
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowCancelConfirm(false)}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700"
                              >
                                Kembali
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                  {/* Panel Proses Admin Resources */}
                  {isAdmin && !['Selesai', 'Dibatalkan'].includes(selectedOrder.status) && (
                    <div className="pt-4 border-t border-slate-200 space-y-4 no-print">
                      <h4 className="text-xs font-bold text-slate-900">Tindakan Petugas Resources</h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="block font-medium text-slate-600 mb-1">Tetapkan Petugas</label>
                          <select
                            value={assignedStaffId}
                            onChange={(e) => setAssignedStaffId(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                          >
                            <option value="">-- Pilih Petugas --</option>
                            {staffList.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.full_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block font-medium text-slate-600 mb-1">Catatan Internal Admin</label>
                          <input
                            type="text"
                            value={internalNotes}
                            onChange={(e) => setInternalNotes(e.target.value)}
                            placeholder="Catatan koordinasi tim..."
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                          />
                        </div>
                      </div>

                      {/* Penyesuaian Jumlah Aktual Fotokopi / Laminating */}
                      {selectedOrder.service_type === 'fotokopi' && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div>
                            <label className="block font-medium text-slate-600 mb-1">Halaman Aktual</label>
                            <input
                              type="number"
                              min={1}
                              value={actualPages}
                              onChange={(e) => setActualPages(Math.max(1, Number(e.target.value)))}
                              className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-white border border-slate-200 rounded"
                            />
                          </div>
                          <div>
                            <label className="block font-medium text-slate-600 mb-1">Rangkap Aktual</label>
                            <input
                              type="number"
                              min={1}
                              value={actualCopies}
                              onChange={(e) => setActualCopies(Math.max(1, Number(e.target.value)))}
                              className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-white border border-slate-200 rounded"
                            />
                          </div>
                          <div className="flex flex-col justify-end">
                            <span className="text-[11px] text-slate-500">Kalkulasi Aktual:</span>
                            <span className="font-mono font-bold text-[#1755CE]">
                              {
                                calculatePhotocopyMetrics(
                                  actualPages,
                                  actualCopies,
                                  selectedOrder.item.print_sides || 'satu_sisi'
                                ).totalPaperSheets
                              }{' '}
                              lembar kertas
                            </span>
                          </div>
                        </div>
                      )}

                      {selectedOrder.service_type === 'laminating' && (
                        <div className="max-w-xs text-xs">
                          <label className="block font-medium text-slate-600 mb-1">
                            Jumlah Lembar Aktual Laminating
                          </label>
                          <input
                            type="number"
                            min={1}
                            value={actualLamSheets}
                            onChange={(e) => setActualLamSheets(Math.max(1, Number(e.target.value)))}
                            className="w-full px-3 py-1.5 font-mono tabular-nums border border-slate-200 rounded-lg"
                          />
                        </div>
                      )}

                      {/* Tombol Alur Status */}
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedOrder.status === 'Menunggu Diproses' && (
                          <button
                            type="button"
                            disabled={processingAction}
                            onClick={() => handleStatusChange('Diproses')}
                            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                          >
                            Mulai Proses Order
                          </button>
                        )}
                        {selectedOrder.service_type === 'galon' &&
                          ['Menunggu Diproses', 'Diproses'].includes(selectedOrder.status) && (
                            <button
                              type="button"
                              disabled={processingAction}
                              onClick={() => handleStatusChange('Dalam Pengiriman')}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              <span>Tandai Dalam Pengiriman</span>
                            </button>
                          )}
                        {selectedOrder.service_type !== 'galon' &&
                          ['Menunggu Diproses', 'Diproses'].includes(selectedOrder.status) && (
                            <button
                              type="button"
                              disabled={processingAction}
                              onClick={() => handleStatusChange('Siap Diambil')}
                              className="px-3.5 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold"
                            >
                              Tandai Siap Diambil
                            </button>
                          )}
                        {selectedOrder.service_type !== 'galon' && (
                          <button
                            type="button"
                            disabled={processingAction}
                            onClick={() => handleStatusChange('Selesai')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Selesaikan Order</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={processingAction}
                          onClick={() => handleStatusChange('Dibatalkan', 'Dibatalkan oleh Admin Resources')}
                          className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold"
                        >
                          Batalkan
                        </button>
                        <button
                          type="button"
                          disabled={processingAction}
                          onClick={() => {
                            setDeleteReason('');
                            setDeleteTargetOrder(selectedOrder);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus Order</span>
                        </button>
                      </div>

                      {/* Konfirmasi Pengiriman & Penerimaan Galon Kosong (Atomic) */}
                      {selectedOrder.service_type === 'galon' && (
                        <form
                          onSubmit={handleCompleteGallonDelivery}
                          className="p-4 rounded-xl bg-blue-50/60 border border-blue-200 space-y-3"
                        >
                          <div className="text-xs font-bold text-slate-900">
                            Konfirmasi Pengiriman Galon &amp; Update Stok Atomic
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                              <label className="block font-medium text-slate-700 mb-1">
                                Lokasi Gudang Sumber
                              </label>
                              <select
                                required
                                value={gallonLocId}
                                onChange={(e) => setGallonLocId(e.target.value)}
                                className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                              >
                                {invLocations.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block font-medium text-slate-700 mb-1">
                                Galon Isi Dikirim
                              </label>
                              <input
                                type="number"
                                min={0}
                                required
                                value={gallonDelivered}
                                onChange={(e) => setGallonDelivered(Math.max(0, Number(e.target.value)))}
                                className="w-full px-2.5 py-2 font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                            <div>
                              <label className="block font-medium text-slate-700 mb-1">
                                Galon Kosong Diterima
                              </label>
                              <input
                                type="number"
                                min={0}
                                required
                                value={gallonEmptyReceived}
                                onChange={(e) =>
                                  setGallonEmptyReceived(Math.max(0, Number(e.target.value)))
                                }
                                className="w-full px-2.5 py-2 font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={gallonCompleteNotes}
                              onChange={(e) => setGallonCompleteNotes(e.target.value)}
                              placeholder="Catatan serah terima pengiriman..."
                              className="flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                            />
                            <button
                              type="submit"
                              disabled={processingAction}
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-60"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              <span>Konfirmasi Kirim &amp; Selesaikan</span>
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  )}

                  {isAdmin && ['Selesai', 'Dibatalkan'].includes(selectedOrder.status) && (
                    <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 no-print">
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">Administrasi Data Order:</span>{' '}
                        Jika order ini salah input atau perlu dibersihkan, Admin Resources &amp; Super Admin dapat menghapusnya secara permanen.
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteReason('');
                          setDeleteTargetOrder(selectedOrder);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Order Permanen</span>
                      </button>
                    </div>
                  )}

                  {/* Riwayat Aktivitas Status */}
                  <div className="pt-4 border-t border-slate-200">
                    <h4 className="text-xs font-bold text-slate-900 mb-3">Riwayat Aktivitas Order</h4>
                    <div className="space-y-2.5">
                      {(selectedOrder.history || []).length === 0 ? (
                        <p className="text-xs text-slate-500">Belum ada log perubahan status.</p>
                      ) : (
                        selectedOrder.history!.map((h) => (
                          <div
                            key={h.id}
                            className="flex items-start justify-between gap-4 text-xs pb-2 border-b border-slate-100 last:border-0"
                          >
                            <div>
                              <span className="font-semibold text-slate-800">{h.to_status}</span>
                              {h.from_status && (
                                <span className="text-slate-400"> (dari {h.from_status})</span>
                              )}
                              <div className="text-slate-600 mt-0.5">{h.note}</div>
                            </div>
                            <div className="text-right shrink-0 text-[11px] text-slate-500">
                              <div>{h.changed_by_name}</div>
                              <div className="font-mono tabular-nums">
                                {formatDateTimeID(h.created_at)}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus Order (Admin Resources & Super Admin) */}
      {deleteTargetOrder && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 text-xs shadow-lg">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Hapus Data Order</h3>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Apakah Anda yakin ingin menghapus order{' '}
                  <strong className="font-mono text-slate-900">{deleteTargetOrder.order_number}</strong>{' '}
                  ({getServiceLabel(deleteTargetOrder.service_type)} · {deleteTargetOrder.requester_name}) secara permanen?
                  Lampiran dan riwayat order ini juga akan ikut dihapus dan dicatat pada audit log.
                </p>
              </div>
            </div>

            {deleteTargetOrder.service_type === 'galon' && deleteTargetOrder.status === 'Selesai' && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 leading-relaxed">
                <strong>Catatan Stok Galon:</strong> Order ini berstatus <em>Selesai</em>. Penghapusan hanya menghapus data order dan tidak otomatis mengembalikan saldo stok gudang—lakukan penyesuaian di menu Inventaris Galon bila diperlukan.
              </div>
            )}

            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Alasan Penghapusan (opsional)
              </label>
              <input
                type="text"
                maxLength={300}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Contoh: Salah input unit / order ganda / dibatalkan..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingOrder}
                onClick={() => {
                  setDeleteTargetOrder(null);
                  setDeleteReason('');
                }}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingOrder}
                onClick={handleConfirmDeleteOrder}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingOrder ? 'Menghapus...' : 'Ya, Hapus Order'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
