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

export function hasServiceRoleKey(): boolean {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return Boolean(serviceKey && !serviceKey.includes('YOUR_SUPABASE_SERVICE_ROLE_KEY'));
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
  return (process.env.ALLOWED_EMAIL_DOMAIN || 'lazuardi.sch.id').toLowerCase();
}

export function getSystemModeStatus(): SystemModeStatus {
  const supabaseConfigured = isSupabaseConfigured();
  return {
    mode: supabaseConfigured ? 'supabase' : 'local',
    supabaseConfigured,
    hasPublicCredentials: hasPublicSupabaseCredentials(),
    hasServiceRoleKey: hasServiceRoleKey(),
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
