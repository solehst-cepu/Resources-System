import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (title: string, message?: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, message?: string, variant: ToastVariant = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, title, message, variant }]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none no-print"
      >
        {toasts.map((t) => {
          const borderClass =
            t.variant === 'error'
              ? 'border-red-200 bg-white'
              : t.variant === 'warning'
              ? 'border-amber-200 bg-white'
              : 'border-slate-200 bg-white';
          const Icon =
            t.variant === 'error' || t.variant === 'warning'
              ? AlertCircle
              : t.variant === 'info'
              ? Info
              : CheckCircle2;
          const iconColor =
            t.variant === 'error'
              ? 'text-red-600'
              : t.variant === 'warning'
              ? 'text-amber-600'
              : t.variant === 'info'
              ? 'text-[#1755CE]'
              : 'text-emerald-600';

          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-sm transition-all ${borderClass}`}
            >
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                {t.message && <p className="text-xs text-slate-600 mt-0.5">{t.message}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded"
                aria-label="Tutup notifikasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus digunakan di dalam ToastProvider');
  return ctx;
}
