import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  clearDriveAccessToken,
  getDriveAccessToken,
  googleDriveLogout,
  googleDriveSignIn,
  initDriveAuth,
} from '../lib/googleDriveAuth.ts';

interface GoogleDriveContextValue {
  driveUser: User | null;
  accessToken: string | null;
  needsAuth: boolean;
  isSigningIn: boolean;
  authError: string | null;
  signInWithGoogleDrive: () => Promise<string | null>;
  signOutGoogleDrive: () => Promise<void>;
  handleTokenExpired: () => void;
}

const GoogleDriveContext = createContext<GoogleDriveContextValue | null>(null);

export function GoogleDriveProvider({ children }: { children: React.ReactNode }) {
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(() => getDriveAccessToken());
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getDriveAccessToken());
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (user, token) => {
        setDriveUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      () => {
        setDriveUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const signInWithGoogleDrive = useCallback(async (): Promise<string | null> => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await googleDriveSignIn();
      setDriveUser(result.user);
      setAccessToken(result.accessToken);
      setNeedsAuth(false);
      return result.accessToken;
    } catch (err) {
      const msg = (err as Error).message || 'Gagal menghubungkan akun Google Drive.';
      setAuthError(msg);
      return null;
    } finally {
      setIsSigningIn(false);
    }
  }, []);

  const signOutGoogleDrive = useCallback(async () => {
    await googleDriveLogout();
    setDriveUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
  }, []);

  const handleTokenExpired = useCallback(() => {
    clearDriveAccessToken();
    setAccessToken(null);
    setNeedsAuth(true);
  }, []);

  return (
    <GoogleDriveContext.Provider
      value={{
        driveUser,
        accessToken,
        needsAuth,
        isSigningIn,
        authError,
        signInWithGoogleDrive,
        signOutGoogleDrive,
        handleTokenExpired,
      }}
    >
      {children}
    </GoogleDriveContext.Provider>
  );
}

export function useGoogleDrive(): GoogleDriveContextValue {
  const ctx = useContext(GoogleDriveContext);
  if (!ctx) {
    throw new Error('useGoogleDrive harus digunakan di dalam GoogleDriveProvider');
  }
  return ctx;
}
