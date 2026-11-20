import nodemailer from 'nodemailer';
import { isSmtpConfigured } from './supabaseAdmin.ts';

export interface MonthlyPhotocopyEmailPayload {
  recipientEmail: string;
  recipientName: string;
  unitName: string;
  period: string;
  totalOrders: number;
  totalSidesBW: number;
  totalSidesColor: number;
  totalSheets: number;
  requesterBreakdown: Array<{ name: string; orders: number; sheets: number }>;
  laminatingSummary?: { totalOrders: number; totalSheets: number };
  galonSummary?: { totalOrders: number; totalRequested: number; totalDelivered: number; totalEmptyReturned: number };
  reportingAdminName?: string;
  reportingAdminEmail?: string;
  reportingAdminRole?: string;
  authorizationCode?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendMonthlyPhotocopyReportEmail(
  payload: MonthlyPhotocopyEmailPayload
): Promise<EmailSendResult> {
  if (!isSmtpConfigured()) {
    return {
      success: false,
      error:
        'Layanan email server-side belum dikonfigurasi (set SMTP_HOST/SMTP_USER/SMTP_PASS atau RESEND_API_KEY di environment).',
    };
  }

  const subject = `[LRMS Lazuardi] Laporan Penggunaan Layanan Unit ${payload.unitName} — Periode ${payload.period}`;

  const breakdownRows = payload.requesterBreakdown
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(r.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.orders}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${r.sheets.toLocaleString('id-ID')}</td>
        </tr>`
    )
    .join('');

  const lam = payload.laminatingSummary || { totalOrders: 0, totalSheets: 0 };
  const gal = payload.galonSummary || { totalOrders: 0, totalRequested: 0, totalDelivered: 0, totalEmptyReturned: 0 };
  const adminName = payload.reportingAdminName || 'Admin Divisi Resources';
  const adminRole = payload.reportingAdminRole || 'Admin Resources';
  const adminEmail = payload.reportingAdminEmail || '-';
  const authCode = payload.authorizationCode || `AUTH-LRMS-${payload.period.replace('-', '')}`;

  const html = `
    <div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
      <div style="background:#1755CE;color:#ffffff;padding:20px 24px;">
        <div style="font-size:16px;font-weight:700;">Lazuardi Resources Management System</div>
        <div style="font-size:12px;opacity:0.9;margin-top:4px;">Laporan Bulanan Penggunaan Layanan Unit: Fotokopi, Laminating &amp; Air Galon</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;">Yth. <strong>${escapeHtml(payload.recipientName)}</strong>,</p>
        <p style="margin:0 0 18px;color:#475569;font-size:14px;">
          Berikut adalah ringkasan penggunaan layanan operasional untuk unit <strong>${escapeHtml(payload.unitName)}</strong> pada periode <strong>${escapeHtml(payload.period)}</strong> (tanpa lampiran file dokumen).
        </p>

        <h3 style="font-size:13px;margin:0 0 8px;color:#0f172a;">1. Layanan Fotokopi</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;">
          <tr>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Total Order Fotokopi</td>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;text-align:right;">${payload.totalOrders}</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;">Total Sisi Hitam Putih / Warna</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:700;text-align:right;">${payload.totalSidesBW.toLocaleString('id-ID')} / ${payload.totalSidesColor.toLocaleString('id-ID')} sisi</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Total Lembar Kertas Aktual</td>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;text-align:right;color:#1755CE;">${payload.totalSheets.toLocaleString('id-ID')} lembar</td>
          </tr>
        </table>

        <h3 style="font-size:13px;margin:0 0 8px;color:#0f172a;">2. Layanan Laminating &amp; Penggunaan Air Galon</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;">
          <tr>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Laminating (Order / Total Lembar)</td>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;text-align:right;">${lam.totalOrders} order / ${lam.totalSheets.toLocaleString('id-ID')} lembar</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;">Air Galon (Order / Diminta / Terkirim)</td>
            <td style="padding:8px 10px;border:1px solid #e2e8f0;font-weight:700;text-align:right;">${gal.totalOrders} order / ${gal.totalRequested} diminta / ${gal.totalDelivered} terkirim</td>
          </tr>
          <tr>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;">Galon Kosong Dikembalikan</td>
            <td style="padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:700;text-align:right;">${gal.totalEmptyReturned} galon</td>
          </tr>
        </table>

        <h3 style="font-size:13px;margin:0 0 8px;">Ringkasan Fotokopi per Pemesan</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #cbd5e1;">Pemesan</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #cbd5e1;">Order</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:1px solid #cbd5e1;">Lembar Kertas</th>
            </tr>
          </thead>
          <tbody>
            ${breakdownRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#64748b;">Tidak ada transaksi fotokopi pada periode ini.</td></tr>'}
          </tbody>
        </table>

        <div style="margin-top:22px;padding:14px 16px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;">
          <div style="color:#475569;margin-bottom:4px;">Dilaporkan &amp; Diotorisasi secara Digital oleh:</div>
          <div style="font-weight:700;font-size:13px;color:#0f172a;">${escapeHtml(adminName)} (${escapeHtml(adminRole)})</div>
          <div style="color:#475569;margin-top:2px;">Email: ${escapeHtml(adminEmail)} · Kode Otorisasi: <span style="font-family:monospace;">${escapeHtml(authCode)}</span></div>
        </div>

        <p style="margin-top:16px;font-size:12px;color:#64748b;">
          Untuk detail per nomor order dan tanda tangan otorisasi cetak PDF/Excel, silakan masuk ke portal LRMS menggunakan akun Google @lazuardi.sch.id Anda.
        </p>
      </div>
    </div>
  `;

  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Divisi Resources Lazuardi <onboarding@resend.dev>',
          to: [payload.recipientEmail],
          subject,
          html,
        }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        return { success: false, error: data.message || 'Gagal mengirim via Resend API' };
      }
      return { success: true, messageId: data.id };
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: payload.recipientEmail,
      subject,
      html,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim email laporan',
    };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
