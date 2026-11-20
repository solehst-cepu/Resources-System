import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Eraser, PenTool, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type { ReportAdminAuthorization } from '../types/lrms.ts';
import { formatDateID, formatDateTimeID } from '../utils/calculations.ts';

interface PrintReportHeaderProps {
  title: string;
  subtitle: string;
  authorization?: ReportAdminAuthorization | null;
}

export function PrintReportHeader({ title, subtitle, authorization }: PrintReportHeaderProps) {
  return (
    <div className="hidden print-only border-b-2 border-[#1755CE] pb-3 mb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-[#1755CE] tracking-tight">
            LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS)
          </div>
          <div className="text-[11px] text-slate-500">
            Divisi Resources Lazuardi — One Portal, All Resources Services
          </div>
          <h1 className="mt-2 text-base font-bold text-slate-900">{title}</h1>
          <p className="text-xs text-slate-600">{subtitle}</p>
        </div>
        {authorization && (
          <div className="text-right text-[11px] text-slate-600">
            <div>
              Admin Pelapor: <strong className="text-slate-900">{authorization.admin_name}</strong>
            </div>
            <div>{authorization.admin_role}</div>
            <div className="font-mono text-[10px] text-[#1755CE] mt-0.5">
              {authorization.authorization_code}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ReportSignatureBlockProps {
  authorization?: ReportAdminAuthorization | null;
  onAuthorizationUpdated?: (next: ReportAdminAuthorization) => void;
}

export function ReportSignatureBlock({
  authorization,
  onAuthorizationUpdated,
}: ReportSignatureBlockProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const canManageSignature = user?.role === 'super_admin' || user?.role === 'admin_resources';

  useEffect(() => {
    if (!modalOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.4;

    if (authorization?.signature_data_url) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        setHasInk(true);
      };
      img.src = authorization.signature_data_url;
    } else {
      setHasInk(false);
    }
  }, [modalOpen, authorization?.signature_data_url]);

  if (!authorization) return null;

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    setHasInk(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPointerPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const handleGenerateSampleSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'italic 34px Georgia, "Times New Roman", serif';
    ctx.textBaseline = 'middle';
    const label = authorization.admin_name.split(',')[0] || authorization.admin_name;
    ctx.translate(28, 66);
    ctx.rotate(-0.04);
    ctx.fillText(label, 0, 0);
    ctx.beginPath();
    ctx.strokeStyle = '#1755CE';
    ctx.lineWidth = 2;
    ctx.moveTo(0, 20);
    ctx.quadraticCurveTo(110, 8, 230, 18);
    ctx.stroke();
    ctx.restore();
    setHasInk(true);
  };

  const handleSaveSignature = async (clear = false) => {
    setSaving(true);
    try {
      const dataUrl = clear || !hasInk ? null : canvasRef.current?.toDataURL('image/png') || null;
      const res = await apiRequest<{ authorization: ReportAdminAuthorization }>('/reports/authorization', {
        method: 'PUT',
        body: { signature_data_url: dataUrl },
      });
      onAuthorizationUpdated?.(res.authorization);
      setModalOpen(false);
      showToast(
        clear ? 'Tanda Tangan Direset' : 'Tanda Tangan Otorisasi Disimpan',
        clear
          ? 'Laporan kini menggunakan stempel otorisasi digital standar.'
          : 'Tanda tangan admin akan otomatis dicantumkan pada tampilan cetak dan ekspor PDF.'
      );
    } catch (err) {
      showToast('Gagal Menyimpan Tanda Tangan', (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-5 print-break-inside-avoid">
        <div className="flex flex-col md:flex-row md:items-stretch justify-between gap-6">
          {/* Kiri: Identitas Admin Pelapor & Kode Otorisasi */}
          <div className="flex-1 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-[#1755CE]" />
                <span>Otorisasi &amp; Validasi Pelaporan Admin</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                Laporan ini disusun, diverifikasi, dan dilaporkan secara resmi melalui Lazuardi Resources Management System (LRMS).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div>
                <div className="text-[11px] text-slate-500">Nama Admin Pelapor</div>
                <div className="font-semibold text-slate-900">{authorization.admin_name}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Peran / Jabatan</div>
                <div className="font-medium text-slate-800">{authorization.admin_role}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Email Verifikasi</div>
                <div className="text-slate-700 truncate">{authorization.admin_email}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Waktu Pelaporan</div>
                <div className="font-mono tabular-nums text-slate-700">
                  {formatDateTimeID(authorization.authorized_at)}
                </div>
              </div>
              <div className="sm:col-span-2 pt-1.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Terotorisasi Resmi oleh Admin Divisi Resources</span>
                </span>
                <span className="font-mono text-[11px] font-semibold text-[#1755CE]">
                  {authorization.authorization_code}
                </span>
              </div>
            </div>

            {canManageSignature && (
              <div className="no-print">
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
                >
                  <PenTool className="w-3.5 h-3.5 text-[#1755CE]" />
                  <span>
                    {authorization.signature_data_url
                      ? 'Ubah Tanda Tangan Otorisasi Admin'
                      : 'Atur / Gambar Tanda Tangan Otorisasi Admin'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Kanan: Blok Tanda Tangan Formal */}
          <div className="w-full md:w-72 shrink-0 border border-slate-200 rounded-lg p-4 flex flex-col items-center text-center justify-between bg-white">
            <div className="text-xs text-slate-600 leading-snug">
              <div>Depok, {formatDateID(authorization.authorized_at)}</div>
              <div className="font-medium text-slate-800 mt-0.5">Dilaporkan &amp; Diotorisasi oleh,</div>
              <div className="text-[11px] text-slate-500">{authorization.admin_role}</div>
            </div>

            <div className="my-3 w-full h-20 flex items-center justify-center">
              {authorization.signature_data_url ? (
                <img
                  src={authorization.signature_data_url}
                  alt={`Tanda tangan ${authorization.admin_name}`}
                  className="max-h-18 max-w-full object-contain"
                />
              ) : (
                <div className="w-full h-full border border-dashed border-[#1755CE]/40 rounded-md bg-blue-50/30 flex flex-col items-center justify-center px-3">
                  <svg
                    viewBox="0 0 220 56"
                    className="w-44 h-11 text-slate-800"
                    aria-label="Tanda tangan otorisasi digital"
                  >
                    <path
                      d="M 18 38 C 28 14, 42 12, 48 34 C 54 46, 66 16, 78 30 C 88 40, 102 22, 118 28 C 134 34, 152 18, 174 26 C 186 30, 196 22, 204 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 16 46 Q 110 38 202 44"
                      fill="none"
                      stroke="#1755CE"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="font-mono text-[9px] font-semibold text-[#1755CE] tracking-wide">
                    OTORISASI DIGITAL · {authorization.authorization_code}
                  </span>
                </div>
              )}
            </div>

            <div className="w-full pt-2 border-t border-slate-800">
              <div className="text-xs font-bold text-slate-900">{authorization.admin_name}</div>
              <div className="text-[11px] text-slate-500 truncate">{authorization.admin_email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Canvas Tanda Tangan Otorisasi Admin */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Tanda Tangan Otorisasi Admin</h3>
                <p className="text-slate-500 mt-0.5">
                  Gambar tanda tangan Anda pada area di bawah ini. Tanda tangan akan tercantum pada laporan cetak dan ekspor PDF sebagai bukti laporan dari <strong>{user?.full_name}</strong>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-slate-300 rounded-lg bg-slate-50 overflow-hidden">
              <canvas
                ref={canvasRef}
                width={460}
                height={140}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="w-full h-36 bg-white cursor-crosshair touch-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearCanvas}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  <span>Bersihkan</span>
                </button>
                <button
                  type="button"
                  onClick={handleGenerateSampleSignature}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-[#1755CE] font-medium"
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Buat Otomatis dari Nama</span>
                </button>
              </div>

              {authorization.signature_data_url && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSaveSignature(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset ke Stempel Standar</span>
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                disabled={saving}
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving || !hasInk}
                onClick={() => handleSaveSignature(false)}
                className="px-4 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan Tanda Tangan Otorisasi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
