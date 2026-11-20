import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

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

export async function signInWithGoogleLazuardi(): Promise<void> {
  const sb = getSupabaseClient();
  if (!sb) {
    throw new Error('Supabase belum dikonfigurasi pada environment frontend.');
  }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
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
}
