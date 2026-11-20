import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Edit3,
  MapPin,
  Plus,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import { apiRequest } from '../lib/apiClient.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import type {
  AppRole,
  LocationItem,
  ServiceCatalogItem,
  Unit,
  UserProfile,
} from '../types/lrms.ts';
import { formatDateTimeID, getRoleLabel } from '../utils/calculations.ts';
import { ActiveStatusText } from './StatusText.tsx';

type MasterTab = 'units' | 'users' | 'services' | 'locations';

interface DeleteTarget {
  entity: 'unit' | 'user' | 'service' | 'location';
  id: string;
  label: string;
}

export function MasterDataView() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<MasterTab>('units');
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Unit form (create & edit)
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitCategory, setUnitCategory] = useState('Akademik');
  const [unitHeadName, setUnitHeadName] = useState('');
  const [unitHeadEmail, setUnitHeadEmail] = useState('');

  // Location form (create & edit)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locBuilding, setLocBuilding] = useState('');
  const [locFloor, setLocFloor] = useState('');
  const [locRoom, setLocRoom] = useState('');
  const [locUnitId, setLocUnitId] = useState('');

  // User edit modal
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserRole, setEditUserRole] = useState<AppRole>('user');
  const [editUserActive, setEditUserActive] = useState(true);
  const [editUserUnits, setEditUserUnits] = useState<string[]>([]);
  const [editUserHeadUnits, setEditUserHeadUnits] = useState<string[]>([]);

  // Service edit modal
  const [editingService, setEditingService] = useState<ServiceCatalogItem | null>(null);
  const [srvName, setSrvName] = useState('');
  const [srvDesc, setSrvDesc] = useState('');
  const [srvSla, setSrvSla] = useState(60);
  const [srvActive, setSrvActive] = useState(true);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isSuperAdmin = user?.role === 'super_admin';
  const canManageMaster = user?.role === 'super_admin' || user?.role === 'admin_resources';

  const loadMaster = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        units: Unit[];
        users: UserProfile[];
        services: ServiceCatalogItem[];
        locations: LocationItem[];
      }>('/master');
      setUnits(res.units);
      setUsers(res.users);
      setServices(res.services);
      setLocations(res.locations);
      if (res.units[0] && !locUnitId) setLocUnitId(res.units[0].id);
    } catch (err) {
      showToast('Gagal Memuat Master Data', (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [locUnitId, showToast]);

  useEffect(() => {
    void loadMaster();
  }, [loadMaster]);

  const resetUnitForm = () => {
    setEditingUnitId(null);
    setUnitCode('');
    setUnitName('');
    setUnitCategory('Akademik');
    setUnitHeadName('');
    setUnitHeadEmail('');
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUnitId) {
        await apiRequest(`/master/units/${editingUnitId}`, {
          method: 'PATCH',
          body: {
            code: unitCode,
            name: unitName,
            category: unitCategory,
            head_name: unitHeadName,
            head_email: unitHeadEmail,
          },
        });
        showToast('Unit Diperbarui', `${unitName} berhasil disimpan.`);
      } else {
        await apiRequest('/master/units', {
          method: 'POST',
          body: {
            code: unitCode,
            name: unitName,
            category: unitCategory,
            head_name: unitHeadName,
            head_email: unitHeadEmail,
          },
        });
        showToast('Unit Ditambahkan', `${unitName} telah ditambahkan ke master data.`);
      }
      resetUnitForm();
      await loadMaster();
    } catch (err) {
      showToast('Gagal Menyimpan Unit', (err as Error).message, 'error');
    }
  };

  const handleToggleUnitActive = async (u: Unit) => {
    try {
      await apiRequest(`/master/units/${u.id}`, {
        method: 'PATCH',
        body: { is_active: !u.is_active },
      });
      showToast('Status Unit Diubah', `${u.name} kini ${!u.is_active ? 'Aktif' : 'Nonaktif'}.`);
      await loadMaster();
    } catch (err) {
      showToast('Gagal Mengubah Status', (err as Error).message, 'error');
    }
  };

  const handleSaveUserAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await apiRequest(`/master/users/${editingUser.id}`, {
        method: 'PATCH',
        body: {
          full_name: editUserName,
          role: editUserRole,
          is_active: editUserActive,
          unit_ids: editUserUnits,
          head_unit_ids: editUserHeadUnits,
        },
      });
      showToast('Data User Diperbarui', `${editUserName} berhasil disimpan.`);
      setEditingUser(null);
      await loadMaster();
    } catch (err) {
      showToast('Gagal Memperbarui User', (err as Error).message, 'error');
    }
  };

  const resetLocationForm = () => {
    setEditingLocationId(null);
    setLocBuilding('');
    setLocFloor('');
    setLocRoom('');
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingLocationId) {
        await apiRequest(`/master/locations/${editingLocationId}`, {
          method: 'PATCH',
          body: {
            building: locBuilding,
            floor: locFloor,
            room: locRoom,
            unit_id: locUnitId || null,
          },
        });
        showToast('Lokasi Diperbarui', `${locBuilding} · ${locRoom} berhasil diperbarui.`);
      } else {
        await apiRequest('/master/locations', {
          method: 'POST',
          body: {
            building: locBuilding,
            floor: locFloor,
            room: locRoom,
            unit_id: locUnitId || null,
          },
        });
        showToast('Lokasi Ditambahkan', `${locBuilding} · ${locRoom} berhasil disimpan.`);
      }
      resetLocationForm();
      await loadMaster();
    } catch (err) {
      showToast('Gagal Menyimpan Lokasi', (err as Error).message, 'error');
    }
  };

  const handleToggleLocation = async (l: LocationItem) => {
    try {
      await apiRequest(`/master/locations/${l.id}`, {
        method: 'PATCH',
        body: { is_active: !l.is_active },
      });
      await loadMaster();
    } catch (err) {
      showToast('Gagal Mengubah Lokasi', (err as Error).message, 'error');
    }
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;
    try {
      await apiRequest(`/master/services/${editingService.id}`, {
        method: 'PATCH',
        body: {
          name: srvName,
          description: srvDesc,
          estimated_sla_minutes: srvSla,
          is_active: srvActive,
        },
      });
      showToast('Master Layanan Diperbarui', srvName);
      setEditingService(null);
      await loadMaster();
    } catch (err) {
      showToast('Gagal Memperbarui Layanan', (err as Error).message, 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const endpointMap: Record<DeleteTarget['entity'], string> = {
        unit: `/master/units/${deleteTarget.id}`,
        user: `/master/users/${deleteTarget.id}`,
        service: `/master/services/${deleteTarget.id}`,
        location: `/master/locations/${deleteTarget.id}`,
      };
      await apiRequest(endpointMap[deleteTarget.entity], { method: 'DELETE' });
      showToast('Data Dihapus', `${deleteTarget.label} berhasil dihapus dari master data.`);
      if (deleteTarget.entity === 'unit' && editingUnitId === deleteTarget.id) resetUnitForm();
      if (deleteTarget.entity === 'location' && editingLocationId === deleteTarget.id) resetLocationForm();
      setDeleteTarget(null);
      await loadMaster();
    } catch (err) {
      showToast('Gagal Menghapus Data', (err as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Master Data Operasional</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Kelola unit/departemen, akun &amp; penugasan peran, katalog layanan, serta lokasi distribusi sekolah.
        </p>
      </div>

      {/* Segmented Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-fit">
        <button
          type="button"
          onClick={() => setTab('units')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
            tab === 'units' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Unit / Departemen</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
            tab === 'users' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Master User</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('services')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
            tab === 'services' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Master Layanan</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('locations')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
            tab === 'locations' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          <span>Master Lokasi</span>
        </button>
      </div>

      {/* TAB 1: MASTER UNIT */}
      {tab === 'units' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {canManageMaster && (
            <form
              onSubmit={handleSaveUnit}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs h-fit"
            >
              <h3 className="text-sm font-bold text-slate-900">
                {editingUnitId ? 'Ubah Data Unit' : 'Tambah Unit / Departemen'}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Unit *</label>
                  <input
                    type="text"
                    required
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder="SD-LAZ"
                    className="w-full px-3 py-2 font-mono uppercase border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori *</label>
                  <select
                    value={unitCategory}
                    onChange={(e) => setUnitCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Akademik">Akademik</option>
                    <option value="Operasional">Operasional</option>
                    <option value="Manajemen">Manajemen</option>
                    <option value="Penunjang">Penunjang</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Unit *</label>
                <input
                  type="text"
                  required
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="SD Lazuardi"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Kepala Unit</label>
                <input
                  type="text"
                  value={unitHeadName}
                  onChange={(e) => setUnitHeadName(e.target.value)}
                  placeholder="Ahmad Fauzan, M.Pd"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Email Kepala Unit (@lazuardi.sch.id)
                </label>
                <input
                  type="email"
                  value={unitHeadEmail}
                  onChange={(e) => setUnitHeadEmail(e.target.value)}
                  placeholder="kepala@lazuardi.sch.id"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1755CE] text-white font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{editingUnitId ? 'Simpan Perubahan' : 'Tambah Unit'}</span>
                </button>
                {editingUnitId && (
                  <button
                    type="button"
                    onClick={resetUnitForm}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
                  >
                    Batal
                  </button>
                )}
              </div>
            </form>
          )}

          <div
            className={`${
              canManageMaster ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-slate-200 rounded-xl overflow-hidden`}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2.5 px-4">Kode</th>
                    <th className="py-2.5 px-3">Nama Unit &amp; Kategori</th>
                    <th className="py-2.5 px-3">Kepala Unit (Penerima Laporan)</th>
                    <th className="py-2.5 px-3">Status</th>
                    {canManageMaster && <th className="py-2.5 px-4 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-700">{u.code}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{u.name}</div>
                        <div className="text-[11px] text-slate-500">{u.category}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-slate-900">{u.head_name || '-'}</div>
                        <div className="text-[11px] text-slate-500">{u.head_email || '-'}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <ActiveStatusText active={u.is_active} />
                      </td>
                      {canManageMaster && (
                        <td className="py-2.5 px-4 text-right space-x-2.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUnitId(u.id);
                              setUnitCode(u.code);
                              setUnitName(u.name);
                              setUnitCategory(u.category);
                              setUnitHeadName(u.head_name || '');
                              setUnitHeadEmail(u.head_email || '');
                            }}
                            className="inline-flex items-center gap-1 text-[#1755CE] hover:underline font-medium"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleUnitActive(u)}
                            className="text-slate-600 hover:underline font-medium"
                          >
                            {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({
                                entity: 'unit',
                                id: u.id,
                                label: `Unit ${u.name} (${u.code})`,
                              })
                            }
                            className="inline-flex items-center gap-1 text-red-600 hover:underline font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Hapus</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MASTER USER */}
      {tab === 'users' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-bold text-slate-900">Daftar Pengguna &amp; Penugasan Role</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Admin Resources dan Super Admin dapat memperbarui atau menghapus data pengguna (Admin Resources tidak dapat mengubah atau menghapus akun Super Admin).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-2.5 px-4">Nama &amp; Email</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Unit Penugasan</th>
                  <th className="py-2.5 px-3">Login Terakhir</th>
                  <th className="py-2.5 px-3">Status</th>
                  {canManageMaster && <th className="py-2.5 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((usr) => {
                  const unitNames = usr.unit_ids
                    .map((uid) => units.find((u) => u.id === uid)?.name)
                    .filter(Boolean)
                    .join(', ');
                  const protectedFromAdmin = !isSuperAdmin && usr.role === 'super_admin';
                  const isSelf = usr.id === user?.id;
                  return (
                    <tr key={usr.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{usr.full_name}</div>
                        <div className="text-[11px] text-slate-500">{usr.email}</div>
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {getRoleLabel(usr.role)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{unitNames || '-'}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                        {formatDateTimeID(usr.last_login_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        <ActiveStatusText active={usr.is_active} />
                      </td>
                      {canManageMaster && (
                        <td className="py-2.5 px-4 text-right space-x-2.5 whitespace-nowrap">
                          {protectedFromAdmin ? (
                            <span className="text-[11px] text-slate-400">Dilindungi (Super Admin)</span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingUser(usr);
                                  setEditUserName(usr.full_name);
                                  setEditUserRole(usr.role);
                                  setEditUserActive(usr.is_active);
                                  setEditUserUnits(usr.unit_ids || []);
                                  setEditUserHeadUnits(usr.head_unit_ids || []);
                                }}
                                className="inline-flex items-center gap-1 text-[#1755CE] hover:underline font-medium"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      entity: 'user',
                                      id: usr.id,
                                      label: `User ${usr.full_name} (${usr.email})`,
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-red-600 hover:underline font-medium"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: MASTER LAYANAN */}
      {tab === 'services' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {services.map((srv) => (
            <div key={srv.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-[#1755CE]">{srv.code}</span>
                  <ActiveStatusText active={srv.is_active} />
                </div>
                <h3 className="mt-2 text-base font-bold text-slate-900">{srv.name}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{srv.description}</p>
              </div>
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs gap-2">
                <span className="font-mono tabular-nums text-slate-500">
                  SLA: {srv.estimated_sla_minutes} mnt
                </span>
                {canManageMaster && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingService(srv);
                        setSrvName(srv.name);
                        setSrvDesc(srv.description || '');
                        setSrvSla(srv.estimated_sla_minutes);
                        setSrvActive(srv.is_active);
                      }}
                      className="inline-flex items-center gap-1 text-[#1755CE] font-semibold hover:underline"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDeleteTarget({
                          entity: 'service',
                          id: srv.id,
                          label: `Layanan ${srv.name} (${srv.code})`,
                        })
                      }
                      className="inline-flex items-center gap-1 text-red-600 font-semibold hover:underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: MASTER LOKASI */}
      {tab === 'locations' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {canManageMaster && (
            <form
              onSubmit={handleSaveLocation}
              className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs h-fit"
            >
              <h3 className="text-sm font-bold text-slate-900">
                {editingLocationId ? 'Ubah Data Lokasi' : 'Tambah Lokasi Layanan'}
              </h3>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Gedung *</label>
                <input
                  type="text"
                  required
                  value={locBuilding}
                  onChange={(e) => setLocBuilding(e.target.value)}
                  placeholder="Gedung SD"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Lantai *</label>
                <input
                  type="text"
                  required
                  value={locFloor}
                  onChange={(e) => setLocFloor(e.target.value)}
                  placeholder="Lantai 1"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ruangan *</label>
                <input
                  type="text"
                  required
                  value={locRoom}
                  onChange={(e) => setLocRoom(e.target.value)}
                  placeholder="Ruang Guru SD"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Unit Terkait</label>
                <select
                  value={locUnitId}
                  onChange={(e) => setLocUnitId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- Tidak Terikat Unit --</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1755CE] text-white font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{editingLocationId ? 'Simpan Perubahan' : 'Simpan Lokasi'}</span>
                </button>
                {editingLocationId && (
                  <button
                    type="button"
                    onClick={resetLocationForm}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600"
                  >
                    Batal
                  </button>
                )}
              </div>
            </form>
          )}

          <div
            className={`${
              canManageMaster ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-slate-200 rounded-xl overflow-hidden`}
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-2.5 px-4">Gedung &amp; Lantai</th>
                  <th className="py-2.5 px-3">Ruangan</th>
                  <th className="py-2.5 px-3">Unit</th>
                  <th className="py-2.5 px-3">Status</th>
                  {canManageMaster && <th className="py-2.5 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2.5 px-4">
                      <span className="font-medium text-slate-900">{l.building}</span> · {l.floor}
                    </td>
                    <td className="py-2.5 px-3 text-slate-800">{l.room}</td>
                    <td className="py-2.5 px-3 text-slate-600">{l.unit_name || '-'}</td>
                    <td className="py-2.5 px-3">
                      <ActiveStatusText active={l.is_active} />
                    </td>
                    {canManageMaster && (
                      <td className="py-2.5 px-4 text-right space-x-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLocationId(l.id);
                            setLocBuilding(l.building);
                            setLocFloor(l.floor);
                            setLocRoom(l.room);
                            setLocUnitId(l.unit_id || '');
                          }}
                          className="inline-flex items-center gap-1 text-[#1755CE] hover:underline font-medium"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleLocation(l)}
                          className="text-slate-600 hover:underline font-medium"
                        >
                          {l.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              entity: 'location',
                              id: l.id,
                              label: `Lokasi ${l.building} · ${l.room}`,
                            })
                          }
                          className="inline-flex items-center gap-1 text-red-600 hover:underline font-medium"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Edit User Role & Unit */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveUserAccess}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-sm font-bold text-slate-900">
              Edit Data &amp; Akses User: {editingUser.email}
            </h3>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nama Lengkap *</label>
              <input
                type="text"
                required
                value={editUserName}
                onChange={(e) => setEditUserName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role Sistem</label>
                <select
                  value={editUserRole}
                  onChange={(e) => setEditUserRole(e.target.value as AppRole)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="user">User / Pemesan</option>
                  <option value="kepala_unit">Kepala Unit</option>
                  <option value="admin_resources">Admin Resources</option>
                  {isSuperAdmin && <option value="super_admin">Super Admin</option>}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status Akun</label>
                <select
                  value={String(editUserActive)}
                  onChange={(e) => setEditUserActive(e.target.value === 'true')}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="true">Aktif</option>
                  <option value="false">Nonaktif</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1.5">
                Penugasan Unit (Bisa lebih dari 1 unit)
              </label>
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {units.map((u) => {
                  const checked = editUserUnits.includes(u.id);
                  const isHead = editUserHeadUnits.includes(u.id);
                  return (
                    <div key={u.id} className="px-3 py-2 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditUserUnits((prev) => [...prev, u.id]);
                            } else {
                              setEditUserUnits((prev) => prev.filter((id) => id !== u.id));
                              setEditUserHeadUnits((prev) => prev.filter((id) => id !== u.id));
                            }
                          }}
                        />
                        <span>{u.name}</span>
                      </label>
                      {editUserRole === 'kepala_unit' && checked && (
                        <label className="flex items-center gap-1.5 text-[11px] text-[#1755CE] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isHead}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditUserHeadUnits((prev) => [...prev, u.id]);
                              } else {
                                setEditUserHeadUnits((prev) => prev.filter((id) => id !== u.id));
                              }
                            }}
                          />
                          <span>Kepala Unit</span>
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1755CE] text-white font-semibold"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Edit Layanan */}
      {editingService && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveService}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <h3 className="text-sm font-bold text-slate-900">Edit Master Layanan ({editingService.code})</h3>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Nama Layanan *</label>
              <input
                type="text"
                required
                value={srvName}
                onChange={(e) => setSrvName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Deskripsi</label>
              <textarea
                rows={2}
                value={srvDesc}
                onChange={(e) => setSrvDesc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Estimasi SLA (Menit)</label>
                <input
                  type="number"
                  min={15}
                  value={srvSla}
                  onChange={(e) => setSrvSla(Math.max(15, Number(e.target.value)))}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Status Layanan</label>
                <select
                  value={String(srvActive)}
                  onChange={(e) => setSrvActive(e.target.value === 'true')}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="true">Aktif</option>
                  <option value="false">Nonaktif</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#1755CE] text-white font-semibold"
              >
                Simpan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Konfirmasi Penghapusan Data</h3>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Apakah Anda yakin ingin menghapus <strong>{deleteTarget.label}</strong> secara permanen? Tindakan ini tercatat pada audit log.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-60"
              >
                {deleting ? 'Menghapus...' : 'Ya, Hapus Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
