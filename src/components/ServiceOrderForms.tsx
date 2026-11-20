import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Droplets,
  FileUp,
  HardDrive,
  Layers,
  Paperclip,
} from 'lucide-react';
import { GoogleDriveFilePickerModal } from './GoogleDrivePickerModal.tsx';
import { apiRequest, fileToBase64 } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type {
  InventoryBalance,
  LocationItem,
  OrderRecord,
  PrintColor,
  PrintSide,
  ServiceType,
  Unit,
} from '../types/lrms.ts';
import { calculatePhotocopyMetrics, formatBytes } from '../utils/calculations.ts';

interface MasterSnapshot {
  units: Unit[];
  locations: LocationItem[];
}

export function ServiceOrderFormView({
  serviceType,
  onOrderCreated,
}: {
  serviceType: ServiceType;
  onOrderCreated: (orderId: string) => void;
}) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [units, setUnits] = useState<Unit[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [stockInfo, setStockInfo] = useState<{
    filled: number;
    allocated: number;
    available: number;
  } | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [unitId, setUnitId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [neededDate, setNeededDate] = useState(today);
  const [neededTime, setNeededTime] = useState('09:00');
  const [notes, setNotes] = useState('');

  // Air Galon fields
  const [gallonQty, setGallonQty] = useState(1);
  const [gallonEmptyPlanned, setGallonEmptyPlanned] = useState(1);

  // Fotokopi fields
  const [documentName, setDocumentName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [pageCount, setPageCount] = useState(10);
  const [copyCount, setCopyCount] = useState(5);
  const [paperSize, setPaperSize] = useState('A4');
  const [printColor, setPrintColor] = useState<PrintColor>('Hitam Putih');
  const [printSides, setPrintSides] = useState<PrintSide>('dua_sisi');
  const [finishingNotes, setFinishingNotes] = useState('');

  // Laminating fields
  const [laminatingSize, setLaminatingSize] = useState('A4');
  const [laminatingType, setLaminatingType] = useState('Glossy 100 Micron');
  const [laminatingSheets, setLaminatingSheets] = useState(5);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingMaster(true);
      try {
        const master = await apiRequest<MasterSnapshot>('/master');
        if (!active) return;
        const activeUnits = master.units.filter((u) => u.is_active);
        const activeLocs = master.locations.filter((l) => l.is_active);
        setUnits(activeUnits);
        setLocations(activeLocs);

        const defaultUnit =
          user?.primary_unit_id && activeUnits.some((u) => u.id === user.primary_unit_id)
            ? user.primary_unit_id
            : activeUnits[0]?.id || '';
        setUnitId(defaultUnit);
        const matchingLoc = activeLocs.find((l) => l.unit_id === defaultUnit) || activeLocs[0];
        if (matchingLoc) setLocationId(matchingLoc.id);

        if (serviceType === 'galon') {
          const inv = await apiRequest<{
            balances: InventoryBalance[];
            allocated: number;
          }>('/inventory/overview');
          if (!active) return;
          const totalFilled = inv.balances.reduce((s, b) => s + b.qty_filled, 0);
          setStockInfo({
            filled: totalFilled,
            allocated: inv.allocated,
            available: Math.max(0, totalFilled - inv.allocated),
          });
        }
      } catch (err) {
        if (active) setFormError((err as Error).message);
      } finally {
        if (active) setLoadingMaster(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [serviceType, user?.primary_unit_id]);

  const photoCalc = calculatePhotocopyMetrics(pageCount, copyCount, printSides);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setFormError('Ukuran dokumen melebihi batas maksimal 25 MB.');
      e.target.value = '';
      return;
    }
    setFormError(null);
    setSelectedFile(file);
    if (!documentName.trim()) {
      setDocumentName(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!unitId || !neededDate) {
      setFormError('Unit/Departemen dan tanggal kebutuhan wajib diisi.');
      return;
    }

    if (serviceType === 'galon') {
      if (gallonQty <= 0) {
        setFormError('Jumlah galon yang diminta minimal 1.');
        return;
      }
      if (gallonEmptyPlanned < 0) {
        setFormError('Jumlah galon kosong ditukar tidak boleh negatif.');
        return;
      }
    } else if (serviceType === 'fotokopi') {
      if (!documentName.trim()) {
        setFormError('Nama dokumen wajib diisi.');
        return;
      }
      if (pageCount <= 0 || copyCount <= 0) {
        setFormError('Jumlah halaman dan rangkap harus lebih dari 0.');
        return;
      }
    } else if (serviceType === 'laminating') {
      if (!documentName.trim() || laminatingSheets <= 0) {
        setFormError('Nama dokumen dan jumlah lembar laminating wajib valid.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        service_type: serviceType,
        unit_id: unitId,
        location_id: locationId || null,
        needed_date: neededDate,
        needed_time: serviceType === 'galon' ? neededTime || null : null,
        notes: notes.trim() || null,
      };

      if (serviceType === 'galon') {
        payload.gallon_requested_qty = gallonQty;
        payload.gallon_empty_return_planned = gallonEmptyPlanned;
      } else if (serviceType === 'fotokopi') {
        payload.document_name = documentName.trim();
        payload.page_count = pageCount;
        payload.copy_count = copyCount;
        payload.paper_size = paperSize;
        payload.print_color = printColor;
        payload.print_sides = printSides;
        payload.finishing_notes = finishingNotes.trim() || null;
      } else {
        payload.document_name = documentName.trim();
        payload.laminating_size = laminatingSize;
        payload.laminating_type = laminatingType;
        payload.laminating_sheets = laminatingSheets;
      }

      const res = await apiRequest<{ order: OrderRecord }>('/orders', {
        method: 'POST',
        body: payload,
      });

      if (serviceType === 'fotokopi' && selectedFile) {
        const base64 = await fileToBase64(selectedFile);
        await apiRequest(`/orders/${res.order.id}/attachments`, {
          method: 'POST',
          body: {
            fileName: selectedFile.name,
            mimeType: selectedFile.type || 'application/pdf',
            base64,
          },
        });
      }

      showToast(
        'Permintaan Berhasil Dikirim',
        `Nomor order ${res.order.order_number} langsung masuk antrean Divisi Resources.`
      );
      onOrderCreated(res.order.id);
    } catch (err) {
      const msg = (err as Error).message;
      setFormError(msg);
      showToast('Gagal Membuat Permintaan', msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    serviceType === 'galon'
      ? 'Buat Permintaan Air Galon'
      : serviceType === 'fotokopi'
      ? 'Buat Permintaan Fotokopi'
      : 'Buat Permintaan Laminating';

  const Icon =
    serviceType === 'galon' ? Droplets : serviceType === 'fotokopi' ? Copy : Layers;

  const filteredLocations = locations.filter((l) => !unitId || l.unit_id === unitId || !l.unit_id);

  if (loadingMaster) {
    return <div className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#1755CE]/10 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-[#1755CE]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nomor order dibuat otomatis oleh server · Tanpa persetujuan berjenjang · Langsung masuk antrean Admin Resources.
              </p>
            </div>
          </div>
          {serviceType === 'galon' && stockInfo && (
            <div className="text-right shrink-0">
              <div className="text-[11px] font-medium text-slate-500">Ketersediaan Galon Isi</div>
              <div className="text-base font-bold font-mono tabular-nums text-[#1755CE]">
                {stockInfo.available} tersedia
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400">
                Fisik {stockInfo.filled} · Dialokasi {stockInfo.allocated}
              </div>
            </div>
          )}
        </div>

        {formError && (
          <div className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          {/* Informasi Pemesan & Lokasi */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nama Pemesan (Otomatis)
              </label>
              <input
                type="text"
                disabled
                value={`${user?.full_name || ''} (${user?.email || ''})`}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Tanggal Permintaan
              </label>
              <input
                type="text"
                disabled
                value={new Date().toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                })}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-600 font-mono tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="ord-unit" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Unit / Departemen *
              </label>
              <select
                id="ord-unit"
                required
                value={unitId}
                onChange={(e) => {
                  const nextU = e.target.value;
                  setUnitId(nextU);
                  const loc = locations.find((l) => l.unit_id === nextU);
                  if (loc) setLocationId(loc.id);
                }}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ord-loc" className="block text-xs font-semibold text-slate-700 mb-1.5">
                {serviceType === 'galon' ? 'Lokasi Pengiriman *' : 'Lokasi Pengambilan / Unit'}
              </label>
              <select
                id="ord-loc"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
              >
                {(filteredLocations.length > 0 ? filteredLocations : locations).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.building} · {l.floor} · {l.room}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Field Spesifik Layanan */}
          {serviceType === 'galon' && (
            <div className="pt-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="gal-qty" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jumlah Galon Diminta *
                </label>
                <input
                  id="gal-qty"
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={gallonQty}
                  onChange={(e) => setGallonQty(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                />
                {stockInfo && gallonQty > stockInfo.available && (
                  <p className="mt-1 text-xs text-amber-700">
                    Catatan: Permintaan melebihi stok bebas saat ini ({stockInfo.available} galon). Admin akan meninjau pasokan sebelum pengiriman.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="gal-emp" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jumlah Galon Kosong Akan Ditukar
                </label>
                <input
                  id="gal-emp"
                  type="number"
                  min={0}
                  max={50}
                  value={gallonEmptyPlanned}
                  onChange={(e) => setGallonEmptyPlanned(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                />
              </div>

              <div>
                <label htmlFor="ord-date" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tanggal Kebutuhan *
                </label>
                <input
                  id="ord-date"
                  type="date"
                  required
                  value={neededDate}
                  onChange={(e) => setNeededDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                />
              </div>

              <div>
                <label htmlFor="ord-time" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jam Kebutuhan (Opsional)
                </label>
                <input
                  id="ord-time"
                  type="time"
                  value={neededTime}
                  onChange={(e) => setNeededTime(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                />
              </div>
            </div>
          )}

          {serviceType === 'fotokopi' && (
            <div className="pt-5 border-t border-slate-200 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fcp-doc" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Nama Dokumen *
                  </label>
                  <input
                    id="fcp-doc"
                    type="text"
                    required
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    placeholder="Contoh: Modul IPA Kelas 5 Bab 3"
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                  />
                </div>

                <div>
                  <label htmlFor="fcp-date" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Tanggal Dibutuhkan *
                  </label>
                  <input
                    id="fcp-date"
                    type="date"
                    required
                    value={neededDate}
                    onChange={(e) => setNeededDate(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
                  />
                </div>
              </div>

              {/* Upload Dokumen Privat */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Upload File Dokumen (PDF, DOC/DOCX, PNG/JPG — Maks. 25 MB, Bucket Privat)
                  </label>
                  <button
                    type="button"
                    onClick={() => setDrivePickerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#1755CE]"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Ambil dari Google Drive</span>
                  </button>
                </div>
                <label className="flex items-center justify-between gap-4 p-4 rounded-lg border border-dashed border-slate-300 hover:border-[#1755CE] bg-slate-50/70 cursor-pointer transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileUp className="w-5 h-5 text-[#1755CE] shrink-0" />
                    <div className="min-w-0">
                      {selectedFile ? (
                        <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{selectedFile.name}</span>
                          <span className="text-xs font-mono text-slate-500 shrink-0">
                            ({formatBytes(selectedFile.size)})
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-600">
                          Klik untuk memilih dokumen dari perangkat Anda atau ambil langsung dari Google Drive
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="px-3 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0">
                    Pilih File
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <label htmlFor="fcp-pages" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Jumlah Halaman *
                  </label>
                  <input
                    id="fcp-pages"
                    type="number"
                    min={1}
                    required
                    value={pageCount}
                    onChange={(e) => setPageCount(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label htmlFor="fcp-copies" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Jumlah Rangkap *
                  </label>
                  <input
                    id="fcp-copies"
                    type="number"
                    min={1}
                    required
                    value={copyCount}
                    onChange={(e) => setCopyCount(Math.max(1, Number(e.target.value)))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label htmlFor="fcp-size" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Ukuran Kertas
                  </label>
                  <select
                    id="fcp-size"
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="A4">A4</option>
                    <option value="F4">F4</option>
                    <option value="A3">A3</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="fcp-color" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Jenis Cetak
                  </label>
                  <select
                    id="fcp-color"
                    value={printColor}
                    onChange={(e) => setPrintColor(e.target.value as PrintColor)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Hitam Putih">Hitam Putih</option>
                    <option value="Warna">Warna</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="fcp-sides" className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Sisi Cetak
                  </label>
                  <select
                    id="fcp-sides"
                    value={printSides}
                    onChange={(e) => setPrintSides(e.target.value as PrintSide)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="satu_sisi">Satu Sisi (1-Side)</option>
                    <option value="dua_sisi">Dua Sisi (Bolak-Balik)</option>
                  </select>
                </div>
              </div>

              {/* Kalkulasi Otomatis Sisi Cetak vs Lembar Kertas */}
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-[11px] text-slate-500">Halaman × Rangkap</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {photoCalc.pageCount} hal × {photoCalc.copyCount} rkp
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Lembar per Rangkap</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                    {photoCalc.sheetsPerCopy} lbr ({printSides === 'dua_sisi' ? 'Bolak-balik' : '1 sisi'})
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Total Sisi Cetak Aktual</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-[#1755CE] mt-0.5">
                    {photoCalc.totalPrintSides.toLocaleString('id-ID')} sisi
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Total Lembar Kertas Aktual</div>
                  <div className="text-sm font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                    {photoCalc.totalPaperSheets.toLocaleString('id-ID')} lembar
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="fcp-finishing" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Keterangan Finishing
                </label>
                <input
                  id="fcp-finishing"
                  type="text"
                  value={finishingNotes}
                  onChange={(e) => setFinishingNotes(e.target.value)}
                  placeholder="Contoh: Staples pojok kiri atas, jilid lakban hitam, atau potong tengah"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          {serviceType === 'laminating' && (
            <div className="pt-5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="lam-doc" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nama Dokumen *
                </label>
                <input
                  id="lam-doc"
                  type="text"
                  required
                  value={documentName}
                  onChange={(e) => setDocumentName(e.target.value)}
                  placeholder="Contoh: Kartu Pengawas Ujian & Poster Kelas"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="lam-date" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tanggal Dibutuhkan *
                </label>
                <input
                  id="lam-date"
                  type="date"
                  required
                  value={neededDate}
                  onChange={(e) => setNeededDate(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="lam-size" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Ukuran Laminating
                </label>
                <select
                  id="lam-size"
                  value={laminatingSize}
                  onChange={(e) => setLaminatingSize(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="A4">A4</option>
                  <option value="F4">F4</option>
                  <option value="A3">A3</option>
                  <option value="ID Card">ID Card</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>

              <div>
                <label htmlFor="lam-type" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jenis Laminating
                </label>
                <select
                  id="lam-type"
                  value={laminatingType}
                  onChange={(e) => setLaminatingType(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Glossy 100 Micron">Glossy 100 Micron</option>
                  <option value="Glossy Tebal 250 Micron">Glossy Tebal 250 Micron</option>
                  <option value="Matte / Doff">Matte / Doff</option>
                </select>
              </div>

              <div>
                <label htmlFor="lam-sheets" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jumlah Lembar *
                </label>
                <input
                  id="lam-sheets"
                  type="number"
                  min={1}
                  required
                  value={laminatingSheets}
                  onChange={(e) => setLaminatingSheets(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          {/* Catatan Tambahan */}
          <div className="pt-4 border-t border-slate-200">
            <label htmlFor="ord-notes" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Catatan Tambahan
            </label>
            <textarea
              id="ord-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instruksi tambahan untuk petugas Divisi Resources..."
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25 focus:border-[#1755CE]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{submitting ? 'Menyimpan Permintaan...' : 'Kirim Permintaan'}</span>
            </button>
          </div>
        </form>
      </div>

      <GoogleDriveFilePickerModal
        isOpen={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        onFilePicked={(file) => {
          setFormError(null);
          setSelectedFile(file);
          if (!documentName.trim()) {
            setDocumentName(file.name.replace(/\.[^/.]+$/, ''));
          }
          showToast('Dokumen Terlampir dari Drive', `File "${file.name}" siap dikirim bersama order.`);
        }}
      />
    </div>
  );
}
