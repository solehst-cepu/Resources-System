import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ReportAdminAuthorization } from '../types/lrms.ts';
import { formatDateID, formatDateTimeID } from './calculations.ts';

export interface ExportColumn<T> {
  header: string;
  accessor: (row: T) => string | number;
}

export function exportToCSV<T>(
  filename: string,
  columns: ExportColumn<T>[],
  rows: T[],
  authorization?: ReportAdminAuthorization | null
): void {
  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = columns.map((c) => escapeCsv(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCsv(c.accessor(row))).join(',')
  );

  const footerLines: string[] = [];
  if (authorization) {
    footerLines.push('');
    footerLines.push(
      `${escapeCsv('Dilaporkan Oleh (Admin)')},${escapeCsv(`${authorization.admin_name} (${authorization.admin_role})`)}`
    );
    footerLines.push(`${escapeCsv('Email Admin')},${escapeCsv(authorization.admin_email)}`);
    footerLines.push(
      `${escapeCsv('Otorisasi Digital')},${escapeCsv(`${authorization.authorization_code} · ${formatDateTimeID(authorization.authorized_at)}`)}`
    );
  }

  // UTF-8 BOM agar Excel di Windows membaca karakter Indonesia dengan benar
  const csvContent = '\uFEFF' + [headerLine, ...dataLines, ...footerLines].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export function exportToExcel<T>(
  filename: string,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryLines?: Array<[string, string | number]>,
  authorization?: ReportAdminAuthorization | null
): void {
  const sheetData: Array<Array<string | number>> = [];

  if (summaryLines && summaryLines.length > 0) {
    for (const line of summaryLines) {
      sheetData.push(line);
    }
  }

  if (authorization) {
    sheetData.push(['Dilaporkan Oleh (Admin)', `${authorization.admin_name} (${authorization.admin_role})`]);
    sheetData.push(['Email Admin Pelapor', authorization.admin_email]);
    sheetData.push(['Kode Otorisasi Admin', authorization.authorization_code]);
    sheetData.push(['Waktu Otorisasi', formatDateTimeID(authorization.authorized_at)]);
  }

  if (sheetData.length > 0) {
    sheetData.push([]);
  }

  sheetData.push(columns.map((c) => c.header));
  for (const row of rows) {
    sheetData.push(columns.map((c) => c.accessor(row)));
  }

  if (authorization) {
    sheetData.push([]);
    sheetData.push(['Disahkan & Dilaporkan oleh Admin:', authorization.admin_name]);
    sheetData.push(['Tanda Tangan Otorisasi Digital:', `TEROTORISASI (${authorization.authorization_code})`]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
  worksheet['!cols'] = columns.map((c) => ({
    wch: Math.max(c.header.length + 4, 18),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function exportToPDF<T>(
  filename: string,
  title: string,
  subtitle: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryPairs?: Array<{ label: string; value: string | number }>,
  authorization?: ReportAdminAuthorization | null
): void {
  const doc = createPDFDocument(title, subtitle, columns, rows, summaryPairs, authorization);
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export function buildPDFBlob<T>(
  title: string,
  subtitle: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryPairs?: Array<{ label: string; value: string | number }>,
  authorization?: ReportAdminAuthorization | null
): Blob {
  const doc = createPDFDocument(title, subtitle, columns, rows, summaryPairs, authorization);
  return doc.output('blob');
}

function createPDFDocument<T>(
  title: string,
  subtitle: string,
  columns: ExportColumn<T>[],
  rows: T[],
  summaryPairs?: Array<{ label: string; value: string | number }>,
  authorization?: ReportAdminAuthorization | null
): jsPDF {
  const doc = new jsPDF({
    orientation: columns.length > 6 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFillColor(23, 85, 206); // Biru Lazuardi #1755CE
  doc.rect(0, 0, pageWidth, 22, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('RESERVE - RESource & SERVice Excellence', 14, 10);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Divisi Resources Lazuardi — Portal Layanan Operasional Sekolah', 14, 16);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 31);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  const fullSubtitle = authorization
    ? `${subtitle}   ·   Admin Pelapor: ${authorization.admin_name} (${authorization.admin_role})`
    : subtitle;
  doc.text(fullSubtitle, 14, 36.5);

  let startY = 42;
  if (summaryPairs && summaryPairs.length > 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    const summaryText = summaryPairs.map((p) => `${p.label}: ${p.value}`).join('   |   ');
    doc.text(summaryText, 14, 42);
    startY = 47;
  }

  autoTable(doc, {
    startY,
    head: [columns.map((c) => c.header)],
    body: rows.map((row) => columns.map((c) => String(c.accessor(row) ?? '-'))),
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [23, 85, 206],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    margin: { left: 14, right: 14 },
  });

  if (authorization) {
    const tableFinalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY + 20;
    let sigTopY = tableFinalY + 10;
    if (sigTopY + 48 > pageHeight - 14) {
      doc.addPage();
      sigTopY = 22;
    }

    const boxWidth = 76;
    const boxX = pageWidth - 14 - boxWidth;

    // Left verification note
    doc.setDrawColor(203, 213, 225);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, sigTopY, Math.max(70, boxX - 22), 38, 2, 2, 'FD');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('OTORISASI LAPORAN RESMI ADMIN', 18, sigTopY + 7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Dilaporkan oleh : ${authorization.admin_name}`, 18, sigTopY + 13);
    doc.text(`Jabatan / Role  : ${authorization.admin_role}`, 18, sigTopY + 18.5);
    doc.text(`Email Verifikasi: ${authorization.admin_email}`, 18, sigTopY + 24);
    doc.text(`Waktu Pelaporan : ${formatDateTimeID(authorization.authorized_at)}`, 18, sigTopY + 29.5);
    doc.setTextColor(23, 85, 206);
    doc.setFont('helvetica', 'bold');
    doc.text(`Kode Otorisasi  : ${authorization.authorization_code}`, 18, sigTopY + 35);

    // Right signature block
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(`Depok, ${formatDateID(authorization.authorized_at)}`, boxX + boxWidth / 2, sigTopY + 5, {
      align: 'center',
    });
    doc.text('Dilaporkan & Diotorisasi oleh,', boxX + boxWidth / 2, sigTopY + 10, {
      align: 'center',
    });

    if (authorization.signature_data_url) {
      try {
        doc.addImage(authorization.signature_data_url, 'PNG', boxX + 16, sigTopY + 12, 44, 17);
      } catch {
        drawVectorAuthorizationMark(doc, boxX + 14, sigTopY + 13, 48, 15, authorization);
      }
    } else {
      drawVectorAuthorizationMark(doc, boxX + 14, sigTopY + 13, 48, 15, authorization);
    }

    doc.setDrawColor(15, 23, 42);
    doc.line(boxX + 6, sigTopY + 31.5, boxX + boxWidth - 6, sigTopY + 31.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(authorization.admin_name, boxX + boxWidth / 2, sigTopY + 36, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(authorization.admin_role, boxX + boxWidth / 2, sigTopY + 40, { align: 'center' });
  }

  const finalPageCount = doc.getNumberOfPages();
  for (let i = 1; i <= finalPageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Dicetak dari RESERVE pada ${new Date().toLocaleString('id-ID')} — Halaman ${i} dari ${finalPageCount}`,
      14,
      pageHeight - 8
    );
  }

  return doc;
}

function drawVectorAuthorizationMark(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  auth: ReportAdminAuthorization
): void {
  // Stempel otorisasi digital + goresan paraf vektor bersih
  doc.setDrawColor(23, 85, 206);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(23, 85, 206);
  doc.text('TEROTORISASI ADMIN', x + w / 2, y + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.text(auth.authorization_code, x + w / 2, y + 9.5, { align: 'center' });
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.line(x + 8, y + 12.5, x + w - 8, y + 11.2);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
