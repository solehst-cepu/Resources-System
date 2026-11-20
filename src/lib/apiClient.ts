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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isFrontendSupabaseReady) {
    const sb = getSupabaseClient();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) {
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
  } = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Permintaan gagal (${res.status})`);
  }
  return data;
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
