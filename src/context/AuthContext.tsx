import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { apiRequest, getLocalAuthToken, setLocalAuthToken } from '../lib/apiClient.ts';
import { getSupabaseClient, isFrontendSupabaseReady, signInWithGoogleLazuardi } from '../lib/supabaseClient.ts';
import type { AppRole, SystemModeStatus, UserProfile } from '../types/lrms.ts';

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

const VALID_ROLES = new Set<AppRole>(['super_admin', 'admin_resources', 'kepala_unit', 'user']);

function normalizeUserProfile(profile: UserProfile): UserProfile {
  const rawRole = String(profile.role || 'user').trim().toLowerCase() as AppRole;
  const role: AppRole = VALID_ROLES.has(rawRole) ? rawRole : 'user';
  return {
    ...profile,
    email: profile.email.trim().toLowerCase(),
    role,
    unit_ids: Array.isArray(profile.unit_ids) ? profile.unit_ids : [],
    head_unit_ids: Array.isArray(profile.head_unit_ids) ? profile.head_unit_ids : [],
  };
}

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
  const syncSeqRef = useRef(0);

  const loadSession = useCallback(async (sessionOverride?: Session | null) => {
    const reqId = ++syncSeqRef.current;
    setLoading(true);
    try {
      const status = await apiRequest<SystemModeStatus>('/system/status');
      if (reqId !== syncSeqRef.current) return;
      setSystemStatus(status);

      if (status.mode === 'supabase' && isFrontendSupabaseReady) {
        const sb = getSupabaseClient();
        if (sb) {
          const activeSession =
            sessionOverride !== undefined ? sessionOverride : (await sb.auth.getSession()).data.session;
          if (reqId !== syncSeqRef.current) return;

          if (activeSession?.access_token) {
            setAuthError(null);
            const me = await apiRequest<{ user: UserProfile }>('/auth/me', {
              accessToken: activeSession.access_token,
            });
            if (reqId !== syncSeqRef.current) return;
            setUser(normalizeUserProfile(me.user));
            return;
          }
        }
        if (reqId === syncSeqRef.current) {
          setUser(null);
        }
      } else {
        const localToken = getLocalAuthToken();
        if (localToken) {
          try {
            const me = await apiRequest<{ user: UserProfile }>('/auth/me');
            if (reqId !== syncSeqRef.current) return;
            setUser(normalizeUserProfile(me.user));
          } catch {
            if (reqId !== syncSeqRef.current) return;
            setLocalAuthToken(null);
            setUser(null);
          }
        } else if (reqId === syncSeqRef.current) {
          setUser(null);
        }
      }
    } catch (err) {
      if (reqId === syncSeqRef.current) {
        setAuthError((err as Error).message);
        setUser(null);
      }
    } finally {
      if (reqId === syncSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSession();
    if (isFrontendSupabaseReady) {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
          if (
            event === 'INITIAL_SESSION' ||
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {
            void loadSession(session);
          } else if (event === 'SIGNED_OUT') {
            syncSeqRef.current += 1;
            setUser(null);
            setLoading(false);
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
    setUser(normalizeUserProfile(res.user));
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
