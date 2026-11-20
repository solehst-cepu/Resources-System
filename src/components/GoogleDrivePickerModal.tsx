import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  File as FileIcon,
  Folder,
  HardDrive,
  RefreshCw,
  Search,
  UploadCloud,
  X,
} from 'lucide-react';
import { useGoogleDrive } from '../context/GoogleDriveContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import {
  downloadDriveFileBlob,
  DriveAuthExpiredError,
  getFriendlyDriveMimeLabel,
  isFolder,
  listDriveFiles,
  uploadFileToDrive,
  type DriveFileItem,
} from '../lib/googleDriveApi.ts';
import { formatBytes, formatDateTimeID } from '../utils/calculations.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

export function GoogleDriveFilePickerModal({
  isOpen,
  onClose,
  onFilePicked,
}: {
  isOpen: boolean;
  onClose: () => void;
  onFilePicked: (file: File, driveItem: DriveFileItem) => void;
}) {
  const {
    accessToken,
    needsAuth,
    isSigningIn,
    authError,
    signInWithGoogleDrive,
    handleTokenExpired,
  } = useGoogleDrive();
  const { showToast } = useToast();

  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadFiles = useCallback(async () => {
    if (!accessToken || !isOpen) return;
    setLoading(true);
    try {
      const res = await listDriveFiles(accessToken, {
        search: search.trim() || undefined,
        pageSize: 25,
      });
      setFiles(res.files.filter((f) => !isFolder(f)));
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        handleTokenExpired();
      } else {
        showToast('Gagal Membuka Google Drive', (err as Error).message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, isOpen, search, handleTokenExpired, showToast]);

  useEffect(() => {
    if (isOpen && accessToken && !needsAuth) {
      void loadFiles();
    }
  }, [isOpen, accessToken, needsAuth, loadFiles]);

  if (!isOpen) return null;

  const handleSelectFile = async (item: DriveFileItem) => {
    if (!accessToken) return;
    setDownloadingId(item.id);
    try {
      const { blob, fileName, mimeType } = await downloadDriveFileBlob(accessToken, item);
      if (blob.size > 25 * 1024 * 1024) {
        showToast('Ukuran File Terlalu Besar', 'Maksimal dokumen lampiran adalah 25 MB.', 'error');
        return;
      }
      const pickedFile = new File([blob], fileName, { type: mimeType });
      onFilePicked(pickedFile, item);
      onClose();
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Mengambil File dari Drive', (err as Error).message, 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-[#1755CE]" />
            <h3 className="text-sm font-bold text-slate-900">Pilih Dokumen dari Google Drive</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {needsAuth || !accessToken ? (
          <div className="p-8 text-center space-y-4">
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Masuk dengan akun Google Anda untuk menelusuri dan melampirkan dokumen langsung dari Google Drive ke pesanan fotokopi.
            </p>
            {authError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {authError}
              </div>
            )}
            <div className="flex justify-center">
              <GoogleSignInButton
                onClick={() => void signInWithGoogleDrive()}
                loading={isSigningIn}
                label="Sign in with Google"
              />
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void loadFiles();
                    }
                  }}
                  placeholder="Cari nama file di Google Drive..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadFiles()}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Cari</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Memuat daftar dokumen dari Google Drive...
                </div>
              ) : files.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Tidak ada dokumen yang cocok ditemukan di Google Drive.
                </div>
              ) : (
                files.map((item) => (
                  <div
                    key={item.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileIcon className="w-4 h-4 text-[#1755CE] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{item.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {getFriendlyDriveMimeLabel(item.mimeType)}
                          {item.size ? ` · ${formatBytes(Number(item.size))}` : ''}
                          {item.modifiedTime ? ` · ${formatDateTimeID(item.modifiedTime)}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={downloadingId !== null}
                      onClick={() => void handleSelectFile(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold shrink-0 disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{downloadingId === item.id ? 'Mengambil...' : 'Lampirkan'}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SaveToDriveConfirmModal({
  isOpen,
  onClose,
  defaultFileName,
  reportTitle,
  buildPdfBlob,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultFileName: string;
  reportTitle: string;
  buildPdfBlob: () => Blob;
}) {
  const {
    driveUser,
    accessToken,
    needsAuth,
    isSigningIn,
    authError,
    signInWithGoogleDrive,
    handleTokenExpired,
  } = useGoogleDrive();
  const { showToast } = useToast();

  const [fileName, setFileName] = useState(defaultFileName);
  const [folders, setFolders] = useState<DriveFileItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFileName(defaultFileName.endsWith('.pdf') ? defaultFileName : `${defaultFileName}.pdf`);
    }
  }, [isOpen, defaultFileName]);

  useEffect(() => {
    if (!isOpen || !accessToken || needsAuth) return;
    listDriveFiles(accessToken, { mimeFilter: 'folders', pageSize: 20 })
      .then((res) => setFolders(res.files))
      .catch(() => setFolders([]));
  }, [isOpen, accessToken, needsAuth]);

  if (!isOpen) return null;

  const handleConfirmUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !fileName.trim()) return;
    setSaving(true);
    try {
      const pdfBlob = buildPdfBlob();
      const uploaded = await uploadFileToDrive(
        accessToken,
        pdfBlob,
        fileName.trim().endsWith('.pdf') ? fileName.trim() : `${fileName.trim()}.pdf`,
        'application/pdf',
        selectedFolderId || undefined
      );
      showToast(
        'Laporan Tersimpan di Google Drive',
        `File "${uploaded.name}" berhasil diunggah ke Google Drive.`
      );
      onClose();
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Menyimpan ke Google Drive', (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4 text-[#1755CE]" />
            <h3 className="text-sm font-bold text-slate-900">Simpan Laporan ke Google Drive</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        {needsAuth || !accessToken ? (
          <div className="py-4 text-center space-y-4">
            <p className="text-xs text-slate-600">
              Hubungkan akun Google Anda terlebih dahulu untuk menyimpan laporan <span className="font-semibold">{reportTitle}</span> ke Google Drive.
            </p>
            {authError && (
              <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {authError}
              </div>
            )}
            <div className="flex justify-center">
              <GoogleSignInButton
                onClick={() => void signInWithGoogleDrive()}
                loading={isSigningIn}
                label="Sign in with Google"
              />
            </div>
          </div>
        ) : (
          <form onSubmit={handleConfirmUpload} className="space-y-3.5 text-xs">
            <p className="text-slate-600">
              Konfirmasi unggah file PDF laporan <span className="font-semibold text-slate-900">{reportTitle}</span> ke Google Drive milik{' '}
              <span className="font-semibold text-slate-900">{driveUser?.email}</span>.
            </p>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nama File PDF</label>
              <input
                type="text"
                required
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Folder Tujuan</label>
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                <select
                  value={selectedFolderId}
                  onChange={(e) => setSelectedFolderId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">My Drive (Utama)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-slate-200 font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || !fileName.trim()}
                className="px-4 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white font-semibold disabled:opacity-60"
              >
                {saving ? 'Mengunggah...' : 'Konfirmasi & Simpan ke Drive'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
