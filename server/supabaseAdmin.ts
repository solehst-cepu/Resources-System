import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SystemModeStatus } from '../src/types/lrms.js';

let cachedAdminClient: SupabaseClient | null = null;

export function normalizeSupabaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export function getSupabaseUrl(): string | undefined {
  const raw = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const cleaned = normalizeSupabaseUrl(raw);
  if (!cleaned || cleaned.includes('YOUR_PROJECT_REF')) return undefined;
  return cleaned;
}

export function hasPublicSupabaseCredentials(): boolean {
  const url = getSupabaseUrl();
  const anon = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  return Boolean(url && anon && !anon.includes('YOUR_SUPABASE_ANON_KEY'));
}

export type ServiceRoleKeyKind =
  | 'jwt_service_role'
  | 'sb_secret'
  | 'jwt_anon'
  | 'sb_publishable'
  | 'missing'
  | 'unknown';

export function getServiceRoleKeyKind(): ServiceRoleKeyKind {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey || serviceKey.includes('YOUR_SUPABASE_SERVICE_ROLE_KEY')) {
    return 'missing';
  }
  if (serviceKey.startsWith('sb_publishable_')) {
    return 'sb_publishable';
  }
  if (serviceKey.startsWith('sb_secret_')) {
    return 'sb_secret';
  }
  const parts = serviceKey.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { role?: string };
      if (payload.role === 'service_role') return 'jwt_service_role';
      if (payload.role === 'anon' || payload.role === 'authenticated') return 'jwt_anon';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

export function assertValidServiceRoleKey(): void {
  const kind = getServiceRoleKeyKind();
  if (kind === 'jwt_anon' || kind === 'sb_publishable') {
    throw new Error(
      'Konfigurasi SUPABASE_SERVICE_ROLE_KEY salah: nilai yang diisi adalah kunci publik (anon / sb_publishable), bukan kunci service_role / sb_secret dari Supabase Dashboard → Project Settings → API.'
    );
  }
}

export function hasServiceRoleKey(): boolean {
  return getServiceRoleKeyKind() !== 'missing';
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && hasServiceRoleKey());
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.RESEND_API_KEY
  );
}

export function getAllowedDomain(): string {
  return (process.env.ALLOWED_EMAIL_DOMAIN || 'lazuardi.sch.id').trim().replace(/^@+/, '').toLowerCase();
}

export function getSystemModeStatus(): SystemModeStatus {
  const supabaseConfigured = isSupabaseConfigured();
  return {
    mode: supabaseConfigured ? 'supabase' : 'local',
    supabaseConfigured,
    hasPublicCredentials: hasPublicSupabaseCredentials(),
    hasServiceRoleKey: hasServiceRoleKey(),
    serviceRoleKeyKind: getServiceRoleKeyKind(),
    supabaseProjectUrl: getSupabaseUrl() || null,
    smtpConfigured: isSmtpConfigured(),
    allowedDomain: getAllowedDomain(),
  };
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cachedAdminClient) return cachedAdminClient;

  const url = getSupabaseUrl()!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  cachedAdminClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedAdminClient;
}
