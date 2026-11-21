import { getSupabaseClient, isFrontendSupabaseReady } from './supabaseClient.ts';

const LOCAL_TOKEN_KEY = 'lrms_local_token';

export function getLocalAuthToken(): string | null {
  return localStorage.getItem(LOCAL_TOKEN_KEY);
}

export function setLocalAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(LOCAL_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(LOCAL_TOKEN_KEY);
  }
}

let cachedSupabaseAccessToken: string | null = null;
const MASTER_CLIENT_CACHE_TTL_MS = 15_000;
let masterClientCache: { data: unknown; expiresAt: number } | null = null;
let masterClientInFlight: Promise<unknown> | null = null;

export function setCachedSupabaseAccessToken(token: string | null): void {
  if (cachedSupabaseAccessToken !== token) {
    masterClientCache = null;
    masterClientInFlight = null;
  }
  cachedSupabaseAccessToken = token;
}

export function invalidateClientMasterCache(): void {
  masterClientCache = null;
  masterClientInFlight = null;
}

async function getAuthHeaders(accessTokenOverride?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessTokenOverride) {
    headers.Authorization = `Bearer ${accessTokenOverride}`;
    return headers;
  }

  if (cachedSupabaseAccessToken) {
    headers.Authorization = `Bearer ${cachedSupabaseAccessToken}`;
    return headers;
  }

  if (isFrontendSupabaseReady) {
    const sb = getSupabaseClient();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) {
        cachedSupabaseAccessToken = data.session.access_token;
        headers.Authorization = `Bearer ${data.session.access_token}`;
        return headers;
      }
    }
  }

  const localToken = getLocalAuthToken();
  if (localToken) {
    headers.Authorization = `Bearer ${localToken}`;
  }
  return headers;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    accessToken?: string;
  } = {}
): Promise<T> {
  const method = options.method || 'GET';

  if (method !== 'GET' && path.startsWith('/master')) {
    invalidateClientMasterCache();
  }

  if (method === 'GET' && path === '/master') {
    if (masterClientCache && masterClientCache.expiresAt > Date.now()) {
      return masterClientCache.data as T;
    }
    if (masterClientInFlight) {
      return masterClientInFlight as Promise<T>;
    }
  }

  const exec = (async (): Promise<T> => {
    const headers = await getAuthHeaders(options.accessToken);
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      cache: 'no-store',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(data.error || `Permintaan gagal (${res.status})`);
    }
    if (method === 'GET' && path === '/master') {
      masterClientCache = { data, expiresAt: Date.now() + MASTER_CLIENT_CACHE_TTL_MS };
    }
    return data;
  })();

  if (method === 'GET' && path === '/master') {
    masterClientInFlight = exec.finally(() => {
      masterClientInFlight = null;
    });
    return masterClientInFlight as Promise<T>;
  }

  return exec;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Gagal membaca file'));
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas'));
    reader.readAsDataURL(file);
  });
}
