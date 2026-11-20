import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SystemModeStatus } from '../src/types/lrms.ts';

let cachedAdminClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(
    url &&
      serviceKey &&
      !url.includes('YOUR_PROJECT_REF') &&
      !serviceKey.includes('YOUR_SUPABASE_SERVICE_ROLE_KEY')
  );
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
    smtpConfigured: isSmtpConfigured(),
    allowedDomain: getAllowedDomain(),
  };
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cachedAdminClient) return cachedAdminClient;

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  cachedAdminClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedAdminClient;
}
