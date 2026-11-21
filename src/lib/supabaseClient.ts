import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isFrontendSupabaseReady = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('YOUR_PROJECT_REF') &&
    !supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
);

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isFrontendSupabaseReady) return null;
  if (!client) {
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function signInWithGoogleLazuardi(): Promise<{ externalTabUrl?: string }> {
  const sb = getSupabaseClient();
  if (!sb || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase belum dikonfigurasi pada environment frontend.');
  }

  try {
    const settingsRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey },
    });
    if (settingsRes.ok) {
      const settings = (await settingsRes.json()) as {
        external?: Record<string, boolean>;
      };
      if (settings.external && settings.external.google === false) {
        throw new Error(
          'Provider Google OAuth belum diaktifkan di Supabase Dashboard (Authentication → Providers → Google). Aktifkan Google Sign-In terlebih dahulu dan tambahkan URL aplikasi ke Redirect URLs.'
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Google OAuth belum diaktifkan')) {
      throw err;
    }
    // Abaikan error jaringan pre-check dan lanjutkan flow OAuth normal
  }

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      skipBrowserRedirect: isInIframe,
      queryParams: {
        hd: 'lazuardi.sch.id',
        prompt: 'select_account',
      },
      redirectTo: window.location.origin,
    },
  });
  if (error) {
    throw new Error(error.message);
  }

  if (isInIframe && data?.url) {
    return { externalTabUrl: data.url };
  }
  return {};
}
