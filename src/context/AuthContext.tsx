import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, getLocalAuthToken, setLocalAuthToken } from '../lib/apiClient.ts';
import { getSupabaseClient, isFrontendSupabaseReady, signInWithGoogleLazuardi } from '../lib/supabaseClient.ts';
import type { SystemModeStatus, UserProfile } from '../types/lrms.ts';

interface AuthContextValue {
  user: UserProfile | null;
  systemStatus: SystemModeStatus | null;
  loading: boolean;
  authError: string | null;
  signInGoogle: () => Promise<{ externalTabUrl?: string }>;
  signInLocalEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function extractOAuthUrlError(): string | null {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const hashParams = new URLSearchParams(hashRaw);
    const rawDesc =
      searchParams.get('error_description') ||
      hashParams.get('error_description') ||
      searchParams.get('error') ||
      hashParams.get('error');

    if (!rawDesc) return null;

    const cleanUrl = `${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);

    if (rawDesc.includes('provider is not enabled')) {
      return 'Provider Google OAuth belum diaktifkan di Supabase Dashboard (Authentication → Providers → Google).';
    }
    if (rawDesc.includes('org_internal')) {
      return 'Akses Google OAuth ditolak (403 org_internal): pastikan Anda masuk menggunakan akun Google Workspace @lazuardi.sch.id, bukan akun Gmail pribadi.';
    }
    if (rawDesc.includes('access_denied')) {
      return 'Akses Google OAuth ditolak (403 access_denied): periksa Google Cloud Console → OAuth Consent Screen (pastikan status Published atau email Anda terdaftar di Test Users).';
    }
    if (rawDesc.includes('lazuardi.sch.id') || rawDesc.includes('Database error saving new user')) {
      return 'Akses ditolak: hanya akun Google Workspace @lazuardi.sch.id yang diizinkan masuk ke LRMS.';
    }
    return rawDesc;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(() => extractOAuthUrlError());

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const status = await apiRequest<SystemModeStatus>('/system/status');
      setSystemStatus(status);

      if (status.mode === 'supabase' && isFrontendSupabaseReady) {
        const sb = getSupabaseClient();
        if (sb) {
          const { data } = await sb.auth.getSession();
          if (data.session) {
            setAuthError(null);
            const me = await apiRequest<{ user: UserProfile }>('/auth/me');
            setUser(me.user);
            return;
          }
        }
        setUser(null);
      } else {
        const localToken = getLocalAuthToken();
        if (localToken) {
          try {
            const me = await apiRequest<{ user: UserProfile }>('/auth/me');
            setUser(me.user);
          } catch {
            setLocalAuthToken(null);
            setUser(null);
          }
        } else {
          setUser(null);
        }
      }
    } catch (err) {
      setAuthError((err as Error).message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
    if (isFrontendSupabaseReady) {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: sub } = sb.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
            void loadSession();
          }
        });
        return () => sub.subscription.unsubscribe();
      }
    }
  }, [loadSession]);

  const signInGoogle = useCallback(async () => {
    setAuthError(null);
    return signInWithGoogleLazuardi();
  }, []);

  const signInLocalEmail = useCallback(async (email: string) => {
    setAuthError(null);
    const res = await apiRequest<{ user: UserProfile; token: string }>('/auth/session', {
      method: 'POST',
      body: { email },
    });
    setLocalAuthToken(res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    if (isFrontendSupabaseReady) {
      const sb = getSupabaseClient();
      if (sb) await sb.auth.signOut();
    }
    setLocalAuthToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        systemStatus,
        loading,
        authError,
        signInGoogle,
        signInLocalEmail,
        signOut,
        refreshProfile: loadSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus digunakan di dalam AuthProvider');
  return ctx;
}
