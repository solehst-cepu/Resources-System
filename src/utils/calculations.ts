import type { PrintSide } from '../types/lrms.js';

export interface PhotocopyCalculation {
  pageCount: number;
  copyCount: number;
  printSide: PrintSide;
  totalPrintSides: number;
  sheetsPerCopy: number;
  totalPaperSheets: number;
}

/**
 * Menghitung jumlah sisi cetak aktual dan jumlah lembar kertas aktual
 * dengan penanganan akurat untuk cetakan 1 sisi maupun 2 sisi (termasuk halaman ganjil).
 *
 * Contoh:
 * - 10 halaman, 5 rangkap, 1 sisi -> 50 sisi cetak, 50 lembar kertas
 * - 10 halaman, 5 rangkap, 2 sisi -> 50 sisi cetak, 25 lembar kertas
 * - 11 halaman, 5 rangkap, 2 sisi -> 55 sisi cetak, 30 lembar kertas (6 lembar/rangkap)
 */
export function calculatePhotocopyMetrics(
  pageCount: number,
  copyCount: number,
  printSide: PrintSide
): PhotocopyCalculation {
  const safePages = Math.max(0, Math.floor(Number(pageCount) || 0));
  const safeCopies = Math.max(0, Math.floor(Number(copyCount) || 0));

  const totalPrintSides = safePages * safeCopies;
  const sheetsPerCopy = printSide === 'dua_sisi' ? Math.ceil(safePages / 2) : safePages;
  const totalPaperSheets = sheetsPerCopy * safeCopies;

  return {
    pageCount: safePages,
    copyCount: safeCopies,
    printSide,
    totalPrintSides,
    sheetsPerCopy,
    totalPaperSheets,
  };
}

export function formatDateID(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTimeID(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isLazuardiEmail(email: string, allowedDomain = 'lazuardi.sch.id'): boolean {
  const normalized = email.trim().toLowerCase();
  const cleanDomain = allowedDomain.trim().replace(/^@+/, '').toLowerCase();
  const suffix = `@${cleanDomain}`;
  return Boolean(cleanDomain) && normalized.endsWith(suffix) && normalized.length > suffix.length && !normalized.includes(' ');
}

export function getServiceLabel(serviceType: string): string {
  switch (serviceType) {
    case 'galon':
      return 'Air Galon';
    case 'fotokopi':
      return 'Fotokopi';
    case 'laminating':
      return 'Laminating';
    default:
      return serviceType;
  }
}

export function getRoleLabel(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'admin_resources':
      return 'Admin Resources';
    case 'kepala_unit':
      return 'Kepala Unit';
    case 'user':
      return 'User / Pemesan';
    default:
      return role;
  }
}
