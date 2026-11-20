import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiRequest, getLocalAuthToken, setLocalAuthToken } from '../lib/apiClient.ts';
import { getSupabaseClient, isFrontendSupabaseReady, signInWithGoogleLazuardi } from '../lib/supabaseClient.ts';
import type { SystemModeStatus, UserProfile } from '../types/lrms.ts';

interface AuthContextValue {
  user: UserProfile | null;
  systemStatus: SystemModeStatus | null;
  loading: boolean;
  authError: string | null;
  signInGoogle: () => Promise<void>;
  signInLocalEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemModeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const status = await apiRequest<SystemModeStatus>('/system/status');
      setSystemStatus(status);

      if (status.mode === 'supabase' && isFrontendSupabaseReady) {
        const sb = getSupabaseClient();
        if (sb) {
          const { data } = await sb.auth.getSession();
          if (data.session) {
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
    await signInWithGoogleLazuardi();
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
