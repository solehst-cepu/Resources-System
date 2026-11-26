import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useGoogleDrive } from '../context/GoogleDriveContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import {
  createDriveFolder,
  deleteDriveFile,
  downloadDriveFileBlob,
  DriveAuthExpiredError,
  getFriendlyDriveMimeLabel,
  isFolder,
  listDriveFiles,
  renameDriveFile,
  uploadFileToDrive,
  type DriveFileItem,
} from '../lib/googleDriveApi.ts';
import { formatBytes, formatDateTimeID } from '../utils/calculations.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';

interface FolderCrumb {
  id: string | undefined;
  name: string;
}

export function GoogleDriveView() {
  const {
    driveUser,
    accessToken,
    needsAuth,
    isSigningIn,
    authError,
    signInWithGoogleDrive,
    signOutGoogleDrive,
    handleTokenExpired,
  } = useGoogleDrive();
  const { showToast } = useToast();

  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mimeFilter, setMimeFilter] = useState<'all' | 'folders' | 'pdf' | 'docs' | 'sheets' | 'images'>('all');
  const [breadcrumbs, setBreadcrumbs] = useState<FolderCrumb[]>([{ id: undefined, name: 'My Drive' }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Upload & folder modal states
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Mandatory confirmation dialogs for mutating/destructive operations
  const [renameTarget, setRenameTarget] = useState<DriveFileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<DriveFileItem[] | null>(null);
  const [mutating, setMutating] = useState(false);

  const currentFolder = breadcrumbs[breadcrumbs.length - 1];

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchFiles = useCallback(
    async (append = false, pageToken?: string) => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const res = await listDriveFiles(accessToken, {
          search: debouncedSearch || undefined,
          mimeFilter,
          parentId: debouncedSearch ? undefined : currentFolder?.id,
          pageToken,
          pageSize: 30,
        });
        setFiles((prev) => (append ? [...prev, ...res.files] : res.files));
        setNextPageToken(res.nextPageToken);
        if (!append) setSelectedIds(new Set());
      } catch (err) {
        if (err instanceof DriveAuthExpiredError) {
          handleTokenExpired();
          showToast('Sesi Google Drive Berakhir', err.message, 'warning');
        } else {
          showToast('Gagal Memuat Google Drive', (err as Error).message, 'error');
        }
      } finally {
        setLoading(false);
      }
    },
    [accessToken, debouncedSearch, mimeFilter, currentFolder?.id, handleTokenExpired, showToast]
  );

  useEffect(() => {
    if (accessToken && !needsAuth) {
      void fetchFiles(false);
    }
  }, [accessToken, needsAuth, fetchFiles]);

  const handleOpenFolder = (folder: DriveFileItem) => {
    setSearchInput('');
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setSearchInput('');
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !accessToken) return;

    setUploading(true);
    try {
      const uploaded = await uploadFileToDrive(
        accessToken,
        file,
        file.name,
        file.type || 'application/octet-stream',
        currentFolder?.id
      );
      showToast('Berhasil Diunggah ke Google Drive', `File "${uploaded.name}" tersimpan.`);
      await fetchFiles(false);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        handleTokenExpired();
      }
      showToast('Gagal Mengunggah File', (err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !newFolderName.trim()) return;
    setMutating(true);
    try {
      const created = await createDriveFolder(accessToken, newFolderName.trim(), currentFolder?.id);
      showToast('Folder Berhasil Dibuat', `Folder "${created.name}" ditambahkan di Google Drive.`);
      setShowNewFolderModal(false);
      setNewFolderName('');
      await fetchFiles(false);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Membuat Folder', (err as Error).message, 'error');
    } finally {
      setMutating(false);
    }
  };

  const handleDownload = async (file: DriveFileItem) => {
    if (!accessToken || isFolder(file)) return;
    try {
      const { blob, fileName } = await downloadDriveFileBlob(accessToken, file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Unduhan Dimulai', `Mengunduh "${fileName}" dari Google Drive.`);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Mengunduh File', (err as Error).message, 'error');
    }
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !renameTarget || !renameValue.trim()) return;
    setMutating(true);
    try {
      await renameDriveFile(accessToken, renameTarget.id, renameValue.trim());
      showToast('Nama File Diperbarui', `Diubah menjadi "${renameValue.trim()}".`);
      setRenameTarget(null);
      setRenameValue('');
      await fetchFiles(false);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Mengubah Nama File', (err as Error).message, 'error');
    } finally {
      setMutating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!accessToken || !deleteTargets || deleteTargets.length === 0) return;
    setMutating(true);
    try {
      for (const item of deleteTargets) {
        await deleteDriveFile(accessToken, item.id);
      }
      showToast(
        'File Dihapus dari Google Drive',
        `${deleteTargets.length} item berhasil dihapus.`
      );
      setDeleteTargets(null);
      setSelectedIds(new Set());
      await fetchFiles(false);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) handleTokenExpired();
      showToast('Gagal Menghapus File', (err as Error).message, 'error');
    } finally {
      setMutating(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === files.length && files.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(files.map((f) => f.id)));
    }
  };

  const selectedItems = files.filter((f) => selectedIds.has(f.id));

  if (needsAuth || !accessToken) {
    return (
      <div className="max-w-2xl mx-auto mt-6 bg-white border border-slate-200 rounded-xl p-8 text-center space-y-5">
        <div className="w-12 h-12 rounded-xl bg-[#1755CE]/10 flex items-center justify-center mx-auto">
          <HardDrive className="w-6 h-6 text-[#1755CE]" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-slate-900">Hubungkan Google Drive</h2>
          <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
            Akses dokumen Google Drive Anda langsung dari RESERVE untuk melampirkan berkas fotokopi,
            mengarsipkan laporan PDF operasional, serta mengelola folder dan dokumen sekolah.
          </p>
        </div>

        {authError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 text-left">
            {authError}
          </div>
        )}

        <div className="flex justify-center pt-1">
          <GoogleSignInButton
            onClick={() => void signInWithGoogleDrive()}
            loading={isSigningIn}
            label="Sign in with Google"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[#1755CE]/10 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5 text-[#1755CE]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">Google Drive Workspace</h2>
            <p className="text-xs text-slate-500 truncate">
              Terhubung sebagai <span className="font-semibold text-slate-700">{driveUser?.displayName || driveUser?.email}</span>{' '}
              ({driveUser?.email})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleUploadFile}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold disabled:opacity-60"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? 'Mengunggah...' : 'Upload File'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setNewFolderName('');
              setShowNewFolderModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
          >
            <FolderPlus className="w-3.5 h-3.5 text-[#1755CE]" />
            <span>Folder Baru</span>
          </button>
          <button
            type="button"
            onClick={() => void signOutGoogleDrive()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Putuskan</span>
          </button>
        </div>
      </div>

      {/* Filter & Breadcrumbs */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 flex-wrap text-xs">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.id || 'root'}>
                {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(idx)}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    idx === breadcrumbs.length - 1
                      ? 'font-bold text-[#1755CE] bg-[#1755CE]/10'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Search & Type Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari file di Drive..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg w-48 sm:w-56 focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25"
              />
            </div>

            <select
              value={mimeFilter}
              onChange={(e) => setMimeFilter(e.target.value as typeof mimeFilter)}
              className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="all">Semua Tipe</option>
              <option value="folders">Folder</option>
              <option value="pdf">PDF</option>
              <option value="docs">Dokumen / Word</option>
              <option value="sheets">Spreadsheet / Excel</option>
              <option value="images">Gambar</option>
            </select>

            <button
              type="button"
              onClick={() => void fetchFiles(false)}
              disabled={loading}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
              title="Muat ulang daftar file"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Bulk Delete Bar */}
        {selectedItems.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-xs">
            <span className="font-semibold text-red-900">
              {selectedItems.length} item dipilih
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-700 font-medium"
              >
                Batal Pilih
              </button>
              <button
                type="button"
                onClick={() => setDeleteTargets(selectedItems)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Terpilih ({selectedItems.length})</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tabel Daftar File */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-3 px-4 w-9">
                  <input
                    type="checkbox"
                    checked={files.length > 0 && selectedIds.size === files.length}
                    onChange={toggleSelectAll}
                    aria-label="Pilih semua file"
                  />
                </th>
                <th className="py-3 px-3">Nama File / Folder</th>
                <th className="py-3 px-3">Tipe</th>
                <th className="py-3 px-3 text-right">Ukuran</th>
                <th className="py-3 px-3">Terakhir Diubah</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && files.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Memuat file dari Google Drive...
                  </td>
                </tr>
              ) : files.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    Tidak ada file yang ditemukan di folder atau filter ini.
                  </td>
                </tr>
              ) : (
                files.map((file) => {
                  const folder = isFolder(file);
                  return (
                    <tr key={file.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(file.id)}
                          onChange={() => toggleSelect(file.id)}
                          aria-label={`Pilih ${file.name}`}
                        />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {folder ? (
                            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                          ) : (
                            <FileIcon className="w-4 h-4 text-[#1755CE] shrink-0" />
                          )}
                          {folder ? (
                            <button
                              type="button"
                              onClick={() => handleOpenFolder(file)}
                              className="font-semibold text-slate-900 hover:text-[#1755CE] truncate text-left"
                            >
                              {file.name}
                            </button>
                          ) : (
                            <span className="font-medium text-slate-900 truncate">{file.name}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {getFriendlyDriveMimeLabel(file.mimeType)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {file.size ? formatBytes(Number(file.size)) : '-'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                        {file.modifiedTime ? formatDateTimeID(file.modifiedTime) : '-'}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {!folder && (
                            <button
                              type="button"
                              onClick={() => void handleDownload(file)}
                              title="Unduh file"
                              className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Buka di Google Drive"
                              className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setRenameTarget(file);
                              setRenameValue(file.name);
                            }}
                            title="Ubah nama"
                            className="p-1.5 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTargets([file])}
                            title="Hapus file"
                            className="p-1.5 rounded-md border border-red-200 hover:bg-red-50 text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {nextPageToken && (
          <div className="p-3 border-t border-slate-200 text-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchFiles(true, nextPageToken)}
              className="px-4 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              {loading ? 'Memuat...' : 'Muat Lebih Banyak'}
            </button>
          </div>
        )}
      </div>

      {/* Modal Folder Baru */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateFolder}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Buat Folder Baru di Google Drive</h3>
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Nama Folder (di {currentFolder?.name || 'My Drive'})
              </label>
              <input
                type="text"
                required
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Contoh: Arsip Laporan RESERVE 2026"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={mutating || !newFolderName.trim()}
                className="px-4 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold disabled:opacity-60"
              >
                {mutating ? 'Membuat...' : 'Buat Folder'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dialog Konfirmasi Ubah Nama File (Mandatory) */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmRename}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Konfirmasi Ubah Nama di Google Drive</h3>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Anda akan mengubah nama <span className="font-semibold text-slate-900">"{renameTarget.name}"</span> langsung di Google Drive.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Baru</label>
              <input
                type="text"
                required
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1755CE]/25"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={mutating || !renameValue.trim()}
                className="px-4 py-2 rounded-lg bg-[#1755CE] hover:bg-[#1244a8] text-white text-xs font-semibold disabled:opacity-60"
              >
                {mutating ? 'Menyimpan...' : 'Konfirmasi Ubah Nama'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dialog Konfirmasi Hapus File (Mandatory) */}
      {deleteTargets && deleteTargets.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">
                  Hapus {deleteTargets.length} item dari Google Drive?
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Tindakan ini akan menghapus file berikut secara permanen dari Google Drive dan tidak dapat dibatalkan:
                </p>
              </div>
            </div>

            <ul className="max-h-36 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 text-xs text-slate-800">
              {deleteTargets.map((item) => (
                <li key={item.id} className="truncate font-medium">
                  • {item.name}
                </li>
              ))}
            </ul>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={mutating}
                onClick={() => setDeleteTargets(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold disabled:opacity-60"
              >
                {mutating ? 'Menghapus...' : `Ya, Hapus (${deleteTargets.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
