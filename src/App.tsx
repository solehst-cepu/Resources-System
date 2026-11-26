/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Building2,
  ClipboardList,
  Copy,
  Database,
  Droplets,
  FileBarChart2,
  HardDrive,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PieChart,
  Settings,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { GoogleDriveProvider } from './context/GoogleDriveContext.tsx';
import { ToastProvider, useToast } from './context/ToastContext.tsx';
import { apiRequest } from './lib/apiClient.ts';
import type { AppNotification } from './types/lrms.ts';
import { formatDateTimeID, getRoleLabel } from './utils/calculations.ts';
import { LoginView } from './components/LoginView.tsx';
import { DashboardView, type NavSection } from './components/DashboardView.tsx';
import { ServiceOrderFormView } from './components/ServiceOrderForms.tsx';
import { OrderManagementView } from './components/OrderManagementView.tsx';
import { InventoryGallonView } from './components/InventoryGallonView.tsx';
import { KepalaUnitPhotocopyReportView } from './components/KepalaUnitPhotocopyReportView.tsx';
import { ReportsAnalyticsView } from './components/ReportsAnalyticsView.tsx';
import { MasterDataView } from './components/MasterDataView.tsx';
import { SettingsAuditView } from './components/SettingsAuditView.tsx';
import { GoogleDriveView } from './components/GoogleDriveView.tsx';

function WorkspaceShell() {
  const { user, systemStatus, loading, signOut } = useAuth();
  const { showToast } = useToast();

  const [section, setSection] = useState<NavSection>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest<{ notifications: AppNotification[] }>('/notifications');
      setNotifications(res.notifications);
    } catch {
      // silent
    }
  }, [user]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications, section]);

  const handleMarkRead = async (notif: AppNotification) => {
    try {
      await apiRequest(`/notifications/${notif.id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n))
      );
      if (notif.related_order_id) {
        setSelectedOrderId(notif.related_order_id);
        setSection(
          user?.role === 'super_admin' || user?.role === 'admin_resources'
            ? 'order_management'
            : 'my_orders'
        );
        setNotifOpen(false);
      }
    } catch {
      // silent
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      showToast('Semua Notifikasi Dibaca');
    } catch {
      // silent
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Memuat sesi RESERVE - RESource &amp; SERVice Excellence...
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  const isAdmin = user.role === 'super_admin' || user.role === 'admin_resources';
  const isSuperAdmin = user.role === 'super_admin';
  const isKepalaUnit = user.role === 'kepala_unit';
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const navItems: Array<{
    key: NavSection;
    label: string;
    group: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    { key: 'dashboard', label: 'Dashboard', group: 'Utama', icon: LayoutDashboard, visible: true },
    { key: 'order_galon', label: 'Air Galon · Buat Permintaan', group: 'Layanan', icon: Droplets, visible: true },
    { key: 'order_fotokopi', label: 'Fotokopi · Buat Permintaan', group: 'Layanan', icon: Copy, visible: true },
    { key: 'order_laminating', label: 'Laminating · Buat Permintaan', group: 'Layanan', icon: Layers, visible: true },
    { key: 'my_orders', label: 'Pesanan Saya', group: 'Layanan', icon: History, visible: true },
    { key: 'order_management', label: 'Order Management', group: 'Operasional', icon: ClipboardList, visible: isAdmin },
    { key: 'inventory_galon', label: 'Inventory · Air Galon', group: 'Operasional', icon: Package, visible: isAdmin },
    {
      key: 'kepala_unit_report',
      label: 'Laporan Penggunaan Unit',
      group: 'Pelaporan',
      icon: FileBarChart2,
      visible: isKepalaUnit || isAdmin,
    },
    {
      key: 'reports_analytics',
      label: 'Reports & Analytics',
      group: 'Pelaporan',
      icon: PieChart,
      visible: isAdmin || isKepalaUnit,
    },
    { key: 'google_drive', label: 'Google Drive', group: 'Integrasi', icon: HardDrive, visible: true },
    { key: 'master_data', label: 'Master Data', group: 'Administrasi', icon: Database, visible: isAdmin },
    { key: 'settings_audit', label: 'Pengaturan & Audit Log', group: 'Administrasi', icon: Settings, visible: isSuperAdmin },
  ];

  const visibleNav = navItems.filter((item) => item.visible);
  const currentBreadcrumb = visibleNav.find((n) => n.key === section)?.label || 'Dashboard';

  const navigateTo = (next: NavSection) => {
    setSection(next);
    setMobileNavOpen(false);
  };

  const openOrderFromAnywhere = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSection(isAdmin ? 'order_management' : 'my_orders');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden no-print"
        />
      )}

      {/* Sidebar Navigasi */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 lg:translate-x-0 no-print ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#1755CE] flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-slate-900 tracking-tight truncate">
                RESERVE
              </div>
              <div className="text-[10px] text-slate-500 truncate">RESource &amp; SERVice Excellence</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {['Utama', 'Layanan', 'Operasional', 'Pelaporan', 'Integrasi', 'Administrasi'].map((grp) => {
            const items = visibleNav.filter((i) => i.group === grp);
            if (items.length === 0) return null;
            return (
              <div key={grp} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold text-slate-400">{grp}</div>
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => navigateTo(item.key)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                        active
                          ? 'bg-[#1755CE] text-white'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-500'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <div className="font-semibold text-slate-900 truncate">{user.full_name}</div>
            <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
            <div className="mt-1 text-[11px] font-medium text-[#1755CE]">
              {getRoleLabel(user.role)}
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 text-slate-600"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 truncate">
              <span>RESERVE</span>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-semibold text-slate-900">{currentBreadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {systemStatus?.mode === 'local' && (
              <span className="hidden md:inline-block text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
                {systemStatus.hasPublicCredentials
                  ? 'Mode Lokal (Menunggu SUPABASE_SERVICE_ROLE_KEY di Secrets)'
                  : 'Mode Lokal (Supabase Env Belum Diisi)'}
              </span>
            )}

            {/* Notifikasi Dalam Aplikasi */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
                aria-label="Notifikasi"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-mono font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">Notifikasi ({unreadCount} baru)</span>
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[11px] font-semibold text-[#1755CE] hover:underline"
                    >
                      Tandai semua dibaca
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Belum ada notifikasi.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleMarkRead(n)}
                          className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                            !n.is_read ? 'bg-blue-50/40' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">{n.title}</span>
                            {!n.is_read && (
                              <span className="text-[10px] font-semibold text-[#1755CE]">Baru</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">{n.message}</p>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            {formatDateTimeID(n.created_at)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Viewport Utama */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {section === 'dashboard' && (
            <DashboardView onNavigate={navigateTo} onSelectOrder={openOrderFromAnywhere} />
          )}
          {section === 'order_galon' && (
            <ServiceOrderFormView
              serviceType="galon"
              onOrderCreated={(id) => {
                setSelectedOrderId(id);
                setSection(isAdmin ? 'order_management' : 'my_orders');
              }}
            />
          )}
          {section === 'order_fotokopi' && (
            <ServiceOrderFormView
              serviceType="fotokopi"
              onOrderCreated={(id) => {
                setSelectedOrderId(id);
                setSection(isAdmin ? 'order_management' : 'my_orders');
              }}
            />
          )}
          {section === 'order_laminating' && (
            <ServiceOrderFormView
              serviceType="laminating"
              onOrderCreated={(id) => {
                setSelectedOrderId(id);
                setSection(isAdmin ? 'order_management' : 'my_orders');
              }}
            />
          )}
          {section === 'my_orders' && (
            <OrderManagementView
              mineOnly
              initialSelectedOrderId={selectedOrderId}
              onClearSelectedOrder={() => setSelectedOrderId(null)}
            />
          )}
          {section === 'order_management' && isAdmin && (
            <OrderManagementView
              mineOnly={false}
              initialSelectedOrderId={selectedOrderId}
              onClearSelectedOrder={() => setSelectedOrderId(null)}
            />
          )}
          {section === 'inventory_galon' && isAdmin && (
            <InventoryGallonView onSelectOrder={openOrderFromAnywhere} />
          )}
          {section === 'kepala_unit_report' && (isKepalaUnit || isAdmin) && (
            <KepalaUnitPhotocopyReportView />
          )}
          {section === 'reports_analytics' && (isKepalaUnit || isAdmin) && (
            <ReportsAnalyticsView />
          )}
          {section === 'google_drive' && <GoogleDriveView />}
          {section === 'master_data' && isAdmin && <MasterDataView />}
          {section === 'settings_audit' && isSuperAdmin && <SettingsAuditView />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <GoogleDriveProvider>
          <WorkspaceShell />
        </GoogleDriveProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
