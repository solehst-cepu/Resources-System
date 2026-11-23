import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import {
  getAllowedDomain,
  getSupabaseAdmin,
  getSystemModeStatus,
  isSupabaseConfigured,
} from './supabaseAdmin.js';
import {
  addNotification,
  appendAudit,
  computeStockBalanceUpdate,
  createSignedFileToken,
  deletePrivateLocalUpload,
  getServicePrefix,
  getStockBalanceValue,
  loadLocalDb,
  nextSequenceNumber,
  readPrivateLocalUpload,
  saveLocalDb,
  savePrivateLocalUpload,
  verifySignedFileToken,
  withLocalLock,
} from './localStore.js';
import {
  invalidateMasterDataCache,
  invalidateSupabaseAuthCache,
  mapSupabaseOrderRow,
  sbCreateOrder,
  sbGetAttachmentSignedUrl,
  sbGetMasterData,
  sbListOrders,
  sbUploadAttachment,
  verifySupabaseUser,
} from './supabaseEngine.js';
import { sendMonthlyPhotocopyReportEmail } from './emailService.js';
import { calculatePhotocopyMetrics, getRoleLabel, isLazuardiEmail } from '../src/utils/calculations.js';
import type {
  AppRole,
  DashboardSummary,
  GallonStockKind,
  OrderRecord,
  OrderStatus,
  ReportAdminAuthorization,
  ServiceType,
  StockOpnameLine,
  UserProfile,
} from '../src/types/lrms.js';

interface AuthedRequest extends Request {
  lrmsUser?: UserProfile;
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

async function resolveRequestUser(req: AuthedRequest): Promise<UserProfile> {
  if (isSupabaseConfigured()) {
    const forceRefresh = req.path === '/auth/me' || req.path === '/auth/session';
    return verifySupabaseUser(req.headers.authorization, { forceRefresh });
  }

  // Local Mode: verifikasi header x-lrms-user-email atau Bearer local token
  const authHeader = req.headers.authorization;
  const headerEmail = (req.headers['x-lrms-email'] as string) || '';
  let email = headerEmail.trim().toLowerCase();

  if (!email && authHeader?.startsWith('Bearer local:')) {
    email = authHeader.slice('Bearer local:'.length).trim().toLowerCase();
  }

  if (!email) {
    const err = new Error('Silakan masuk menggunakan akun Google @lazuardi.sch.id terlebih dahulu.');
    (err as Error & { status?: number }).status = 401;
    throw err;
  }

  const allowedDomain = getAllowedDomain();
  if (!isLazuardiEmail(email, allowedDomain)) {
    const err = new Error(`Akses ditolak: domain email harus @${allowedDomain}.`);
    (err as Error & { status?: number }).status = 403;
    throw err;
  }

  return withLocalLock(async () => {
    const db = loadLocalDb();
    let user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      const displayName = email
        .split('@')[0]
        .split('.')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
      user = {
        id: `usr-${crypto.randomUUID()}`,
        email,
        full_name: displayName,
        role: 'user',
        is_active: true,
        last_login_at: new Date().toISOString(),
        unit_ids: [db.units[1]?.id || db.units[0]?.id].filter(Boolean) as string[],
        primary_unit_id: db.units[1]?.id || db.units[0]?.id || null,
        head_unit_ids: [],
      };
      db.users.push(user);
      appendAudit(db, { email, role: 'user' }, 'AUTO_PROVISION_USER', 'user', user.id, { email });
      saveLocalDb(db);
    } else {
      if (!user.is_active) {
        const err = new Error('Akun dinonaktifkan oleh Super Admin.');
        (err as Error & { status?: number }).status = 403;
        throw err;
      }
      user.last_login_at = new Date().toISOString();
      // Sinkronkan head_unit_ids dari master units jika email tercatat sebagai Kepala Unit
      const headUnits = db.units.filter((u) => u.is_active && u.head_email.toLowerCase() === email);
      for (const hu of headUnits) {
        if (!user.head_unit_ids.includes(hu.id)) user.head_unit_ids.push(hu.id);
        if (!user.unit_ids.includes(hu.id)) user.unit_ids.push(hu.id);
      }
      saveLocalDb(db);
    }
    return user;
  });
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  resolveRequestUser(req)
    .then((user) => {
      req.lrmsUser = user;
      next();
    })
    .catch((err: Error & { status?: number }) => {
      res.status(err.status || 401).json({ error: err.message });
    });
}

function requireRoles(...roles: AppRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.lrmsUser || !roles.includes(req.lrmsUser.role)) {
      res.status(403).json({ error: 'Anda tidak memiliki hak akses untuk tindakan ini.' });
      return;
    }
    next();
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: '35mb' }));

  // 1. Public system status
  router.get('/system/status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getSystemModeStatus());
  });

  // 2. Local SSO simulation / validation endpoint (rejected if Supabase mode is active or non-school domain)
  router.post('/auth/session', async (req: AuthedRequest, res) => {
    try {
      if (isSupabaseConfigured()) {
        const user = await verifySupabaseUser(req.headers.authorization, { forceRefresh: true });
        res.json({ user });
        return;
      }

      const email = String(req.body?.email || '').trim().toLowerCase();
      const allowedDomain = getAllowedDomain();
      if (!isLazuardiEmail(email, allowedDomain)) {
        res.status(403).json({
          error: `Login ditolak oleh server: hanya email Google Workspace @${allowedDomain} yang diizinkan masuk ke LRMS.`,
        });
        return;
      }

      req.headers['x-lrms-email'] = email;
      const user = await resolveRequestUser(req);
      res.json({ user, token: `local:${user.email}` });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ user: req.lrmsUser });
  });

  // 3. Private file download (short-lived signed token for local storage)
  router.get('/files/download', (req, res) => {
    const token = String(req.query.token || '');
    const verified = verifySignedFileToken(token);
    if (!verified) {
      res.status(403).json({ error: 'Signed URL tidak valid atau sudah kedaluwarsa.' });
      return;
    }

    const db = loadLocalDb();
    let targetAtt: { file_name: string; mime_type: string; storage_path: string } | null = null;
    for (const o of db.orders) {
      const found = (o.attachments || []).find((a) => a.id === verified.attachmentId);
      if (found) {
        targetAtt = found;
        break;
      }
    }

    if (!targetAtt) {
      res.status(404).json({ error: 'File dokumen tidak ditemukan.' });
      return;
    }

    const buf = readPrivateLocalUpload(targetAtt.storage_path);
    if (!buf) {
      res.status(404).json({ error: 'Berkas fisik tidak ditemukan di penyimpanan privat.' });
      return;
    }

    res.setHeader('Content-Type', targetAtt.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(targetAtt.file_name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  });

  // 4. Master Data (otomatis invalidasi cache saat ada mutasi data master/role)
  router.use('/master', (req, res, next) => {
    if (req.method !== 'GET') {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          invalidateMasterDataCache();
          invalidateSupabaseAuthCache();
        }
      });
    }
    next();
  });

  router.get('/master', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      if (isSupabaseConfigured()) {
        const data = await sbGetMasterData(user);
        res.json(data);
        return;
      }

      const db = loadLocalDb();
      const isAdmin = user.role === 'super_admin' || user.role === 'admin_resources';
      res.json({
        units: db.units,
        services: db.services,
        locations: db.locations,
        inventoryLocations: db.inventoryLocations,
        settings: db.settings,
        users: isAdmin ? db.users : [],
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/master/units', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { code, name, category, head_name, head_email } = req.body;
      if (!code || !name || !category) {
        res.status(400).json({ error: 'Kode, nama unit, dan kategori wajib diisi.' });
        return;
      }
      if (head_email && !isLazuardiEmail(String(head_email), getAllowedDomain())) {
        res.status(400).json({ error: `Email Kepala Unit harus menggunakan domain @${getAllowedDomain()}` });
        return;
      }

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data, error } = await admin
          .from('units')
          .insert({ code, name, category, head_name, head_email, is_active: true })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        res.status(201).json({ unit: data });
        return;
      }

      const unit = await withLocalLock(async () => {
        const db = loadLocalDb();
        if (db.units.some((u) => u.code.toLowerCase() === String(code).toLowerCase())) {
          throw new Error(`Kode unit ${code} sudah digunakan.`);
        }
        const created = {
          id: `unit-${crypto.randomUUID()}`,
          code: String(code).toUpperCase(),
          name: String(name),
          category: String(category),
          head_name: String(head_name || ''),
          head_email: String(head_email || '').toLowerCase(),
          is_active: true,
        };
        db.units.push(created);
        appendAudit(db, req.lrmsUser!, 'CREATE_UNIT', 'unit', created.id, created);
        saveLocalDb(db);
        return created;
      });
      res.status(201).json({ unit });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/master/units/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { code, name, category, head_name, head_email, is_active } = req.body;
      if (head_email && !isLazuardiEmail(String(head_email), getAllowedDomain())) {
        res.status(400).json({ error: `Email Kepala Unit harus domain @${getAllowedDomain()}` });
        return;
      }

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data, error } = await admin
          .from('units')
          .update({ code, name, category, head_name, head_email, is_active, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        res.json({ unit: data });
        return;
      }

      const unit = await withLocalLock(async () => {
        const db = loadLocalDb();
        const target = db.units.find((u) => u.id === id);
        if (!target) throw new Error('Unit tidak ditemukan.');
        if (code !== undefined) target.code = String(code).toUpperCase();
        if (name !== undefined) {
          target.name = String(name);
          for (const loc of db.locations) {
            if (loc.unit_id === target.id) loc.unit_name = target.name;
          }
        }
        if (category !== undefined) target.category = String(category);
        if (head_name !== undefined) target.head_name = String(head_name);
        if (head_email !== undefined) target.head_email = String(head_email).toLowerCase();
        if (is_active !== undefined) target.is_active = Boolean(is_active);
        appendAudit(db, req.lrmsUser!, 'UPDATE_UNIT', 'unit', target.id, target as unknown as Record<string, unknown>);
        saveLocalDb(db);
        return target;
      });
      res.json({ unit });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/master/units/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { count } = await admin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('unit_id', id);
        if ((count || 0) > 0) {
          res.status(400).json({
            error: 'Unit tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan unit ini sebagai gantinya.',
          });
          return;
        }
        const { error } = await admin.from('units').delete().eq('id', id);
        if (error) throw new Error(error.message);
        res.json({ success: true });
        return;
      }

      await withLocalLock(async () => {
        const db = loadLocalDb();
        const idx = db.units.findIndex((u) => u.id === id);
        if (idx === -1) throw new Error('Unit tidak ditemukan.');
        const hasOrders = db.orders.some((o) => o.unit_id === id);
        if (hasOrders) {
          throw new Error(
            'Unit tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan unit ini sebagai gantinya.'
          );
        }
        const [removed] = db.units.splice(idx, 1);
        for (const loc of db.locations) {
          if (loc.unit_id === id) {
            loc.unit_id = null;
            loc.unit_name = '-';
          }
        }
        for (const usr of db.users) {
          usr.unit_ids = usr.unit_ids.filter((uid) => uid !== id);
          usr.head_unit_ids = usr.head_unit_ids.filter((uid) => uid !== id);
          if (usr.primary_unit_id === id) usr.primary_unit_id = usr.unit_ids[0] || null;
        }
        appendAudit(db, req.lrmsUser!, 'DELETE_UNIT', 'unit', removed.id, {
          code: removed.code,
          name: removed.name,
        });
        saveLocalDb(db);
      });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/master/users/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const actor = req.lrmsUser!;
      const { full_name, role, is_active, unit_ids, head_unit_ids } = req.body as {
        full_name?: string;
        role?: AppRole;
        is_active?: boolean;
        unit_ids?: string[];
        head_unit_ids?: string[];
      };

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data: targetRoleRow } = await admin.from('user_roles').select('role').eq('user_id', id).maybeSingle();
        const currentTargetRole = (targetRoleRow?.role as AppRole) || 'user';

        if (actor.role !== 'super_admin') {
          if (currentTargetRole === 'super_admin' || role === 'super_admin') {
            res.status(403).json({
              error: 'Admin Resources tidak diperbolehkan mengubah atau menetapkan role Super Admin.',
            });
            return;
          }
        }

        if (is_active !== undefined || full_name !== undefined) {
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (is_active !== undefined) patch.is_active = is_active;
          if (full_name !== undefined && full_name.trim()) patch.full_name = full_name.trim();
          await admin.from('profiles').update(patch).eq('id', id);
        }
        if (role) {
          await admin.from('user_roles').upsert({ user_id: id, role, assigned_by: actor.id }, { onConflict: 'user_id' });
        }
        if (Array.isArray(unit_ids)) {
          await admin.from('user_unit_assignments').delete().eq('user_id', id);
          if (unit_ids.length > 0) {
            const headSet = new Set(head_unit_ids || []);
            await admin.from('user_unit_assignments').insert(
              unit_ids.map((uid, idx) => ({
                user_id: id,
                unit_id: uid,
                is_primary: idx === 0,
                is_unit_head: headSet.has(uid),
              }))
            );
          }
        }
        res.json({ success: true });
        return;
      }

      const updatedUser = await withLocalLock(async () => {
        const db = loadLocalDb();
        const target = db.users.find((u) => u.id === id);
        if (!target) throw new Error('User tidak ditemukan.');
        if (actor.role !== 'super_admin' && (target.role === 'super_admin' || role === 'super_admin')) {
          const err = new Error('Admin Resources tidak diperbolehkan mengubah atau menetapkan role Super Admin.');
          (err as Error & { status?: number }).status = 403;
          throw err;
        }
        if (full_name !== undefined && full_name.trim()) target.full_name = full_name.trim();
        if (role) target.role = role;
        if (is_active !== undefined) target.is_active = Boolean(is_active);
        if (Array.isArray(unit_ids)) {
          target.unit_ids = unit_ids;
          target.primary_unit_id = unit_ids[0] || null;
        }
        if (Array.isArray(head_unit_ids)) {
          target.head_unit_ids = head_unit_ids;
        }
        appendAudit(db, actor, 'UPDATE_USER_ACCESS', 'user', target.id, {
          email: target.email,
          full_name: target.full_name,
          role: target.role,
          is_active: target.is_active,
          unit_ids: target.unit_ids,
          head_unit_ids: target.head_unit_ids,
        });
        saveLocalDb(db);
        return target;
      });

      res.json({ user: updatedUser });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  router.delete('/master/users/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const actor = req.lrmsUser!;
      if (actor.id === id) {
        res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.' });
        return;
      }

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data: targetRoleRow } = await admin.from('user_roles').select('role').eq('user_id', id).maybeSingle();
        if (actor.role !== 'super_admin' && targetRoleRow?.role === 'super_admin') {
          res.status(403).json({ error: 'Admin Resources tidak diperbolehkan menghapus akun Super Admin.' });
          return;
        }
        const { count } = await admin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('requester_id', id);
        if ((count || 0) > 0) {
          res.status(400).json({
            error: 'Akun user tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan akun sebagai gantinya.',
          });
          return;
        }
        await admin.from('profiles').delete().eq('id', id);
        await admin.auth.admin.deleteUser(id).catch(() => undefined);
        res.json({ success: true });
        return;
      }

      await withLocalLock(async () => {
        const db = loadLocalDb();
        const idx = db.users.findIndex((u) => u.id === id);
        if (idx === -1) throw new Error('User tidak ditemukan.');
        const target = db.users[idx];
        if (actor.role !== 'super_admin' && target.role === 'super_admin') {
          const err = new Error('Admin Resources tidak diperbolehkan menghapus akun Super Admin.');
          (err as Error & { status?: number }).status = 403;
          throw err;
        }
        const hasOrders = db.orders.some((o) => o.requester_id === id);
        if (hasOrders) {
          throw new Error(
            'Akun user tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan akun sebagai gantinya.'
          );
        }
        db.users.splice(idx, 1);
        appendAudit(db, actor, 'DELETE_USER', 'user', target.id, {
          email: target.email,
          full_name: target.full_name,
        });
        saveLocalDb(db);
      });
      res.json({ success: true });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status || 400).json({ error: e.message });
    }
  });

  router.post('/master/locations', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { building, floor, room, unit_id } = req.body;
      if (!building || !floor || !room) {
        res.status(400).json({ error: 'Gedung, lantai, dan ruangan wajib diisi.' });
        return;
      }

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data, error } = await admin
          .from('locations')
          .insert({ building, floor, room, unit_id: unit_id || null, is_active: true })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        res.status(201).json({ location: data });
        return;
      }

      const loc = await withLocalLock(async () => {
        const db = loadLocalDb();
        const unit = db.units.find((u) => u.id === unit_id);
        const created = {
          id: `loc-${crypto.randomUUID()}`,
          building: String(building),
          floor: String(floor),
          room: String(room),
          unit_id: unit ? unit.id : null,
          unit_name: unit ? unit.name : '-',
          is_active: true,
        };
        db.locations.push(created);
        appendAudit(db, req.lrmsUser!, 'CREATE_LOCATION', 'location', created.id, created);
        saveLocalDb(db);
        return created;
      });
      res.status(201).json({ location: loc });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/master/locations/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { building, floor, room, unit_id, is_active } = req.body;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data, error } = await admin
          .from('locations')
          .update({ building, floor, room, unit_id: unit_id || null, is_active, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        res.json({ location: data });
        return;
      }

      const loc = await withLocalLock(async () => {
        const db = loadLocalDb();
        const target = db.locations.find((l) => l.id === id);
        if (!target) throw new Error('Lokasi tidak ditemukan.');
        if (building !== undefined) target.building = String(building);
        if (floor !== undefined) target.floor = String(floor);
        if (room !== undefined) target.room = String(room);
        if (unit_id !== undefined) {
          const unit = db.units.find((u) => u.id === unit_id);
          target.unit_id = unit ? unit.id : null;
          target.unit_name = unit ? unit.name : '-';
        }
        if (is_active !== undefined) target.is_active = Boolean(is_active);
        appendAudit(db, req.lrmsUser!, 'UPDATE_LOCATION', 'location', target.id, target as unknown as Record<string, unknown>);
        saveLocalDb(db);
        return target;
      });
      res.json({ location: loc });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/master/locations/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { error } = await admin.from('locations').delete().eq('id', id);
        if (error) throw new Error(error.message);
        res.json({ success: true });
        return;
      }

      await withLocalLock(async () => {
        const db = loadLocalDb();
        const idx = db.locations.findIndex((l) => l.id === id);
        if (idx === -1) throw new Error('Lokasi tidak ditemukan.');
        const [removed] = db.locations.splice(idx, 1);
        appendAudit(db, req.lrmsUser!, 'DELETE_LOCATION', 'location', removed.id, {
          building: removed.building,
          room: removed.room,
        });
        saveLocalDb(db);
      });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/master/services/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      const { name, description, estimated_sla_minutes, is_active } = req.body;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data, error } = await admin
          .from('service_catalog')
          .update({ name, description, estimated_sla_minutes, is_active, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        res.json({ service: data });
        return;
      }

      const srv = await withLocalLock(async () => {
        const db = loadLocalDb();
        const target = db.services.find((s) => s.id === id);
        if (!target) throw new Error('Layanan tidak ditemukan.');
        if (name !== undefined && String(name).trim()) target.name = String(name).trim();
        if (description !== undefined) target.description = String(description);
        if (estimated_sla_minutes !== undefined) target.estimated_sla_minutes = Number(estimated_sla_minutes);
        if (is_active !== undefined) target.is_active = Boolean(is_active);
        appendAudit(db, req.lrmsUser!, 'UPDATE_SERVICE', 'service', target.id, target as unknown as Record<string, unknown>);
        saveLocalDb(db);
        return target;
      });
      res.json({ service: srv });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/master/services/:id', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { id } = req.params;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data: srv } = await admin.from('service_catalog').select('service_type').eq('id', id).single();
        if (!srv) {
          res.status(404).json({ error: 'Layanan tidak ditemukan.' });
          return;
        }
        const { count } = await admin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('service_type', srv.service_type);
        if ((count || 0) > 0) {
          res.status(400).json({
            error: 'Layanan tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan layanan sebagai gantinya.',
          });
          return;
        }
        const { error } = await admin.from('service_catalog').delete().eq('id', id);
        if (error) throw new Error(error.message);
        res.json({ success: true });
        return;
      }

      await withLocalLock(async () => {
        const db = loadLocalDb();
        const idx = db.services.findIndex((s) => s.id === id);
        if (idx === -1) throw new Error('Layanan tidak ditemukan.');
        const target = db.services[idx];
        const hasOrders = db.orders.some((o) => o.service_type === target.service_type);
        if (hasOrders) {
          throw new Error(
            'Layanan tidak dapat dihapus karena masih memiliki riwayat order. Nonaktifkan layanan sebagai gantinya.'
          );
        }
        db.services.splice(idx, 1);
        appendAudit(db, req.lrmsUser!, 'DELETE_SERVICE', 'service', target.id, {
          code: target.code,
          name: target.name,
        });
        saveLocalDb(db);
      });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.patch('/master/settings', requireAuth, requireRoles('super_admin', 'admin_resources'), async (req: AuthedRequest, res) => {
    try {
      const { gallon_min_stock, file_retention_days, monthly_report_day } = req.body;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const updates: Array<{ key: string; value: unknown; updated_by: string }> = [];
        if (gallon_min_stock !== undefined) updates.push({ key: 'gallon_min_stock', value: Number(gallon_min_stock), updated_by: req.lrmsUser!.id });
        if (file_retention_days !== undefined && req.lrmsUser!.role === 'super_admin') {
          updates.push({ key: 'file_retention_days', value: Number(file_retention_days), updated_by: req.lrmsUser!.id });
        }
        if (monthly_report_day !== undefined && req.lrmsUser!.role === 'super_admin') {
          updates.push({ key: 'monthly_report_day', value: Number(monthly_report_day), updated_by: req.lrmsUser!.id });
        }
        for (const u of updates) {
          await admin.from('app_settings').upsert(u, { onConflict: 'key' });
        }
        res.json({ success: true });
        return;
      }

      const settings = await withLocalLock(async () => {
        const db = loadLocalDb();
        if (gallon_min_stock !== undefined) db.settings.gallon_min_stock = Math.max(0, Number(gallon_min_stock));
        if (file_retention_days !== undefined && req.lrmsUser!.role === 'super_admin') {
          db.settings.file_retention_days = Math.max(7, Number(file_retention_days));
        }
        if (monthly_report_day !== undefined && req.lrmsUser!.role === 'super_admin') {
          db.settings.monthly_report_day = Math.min(28, Math.max(1, Number(monthly_report_day)));
        }
        appendAudit(db, req.lrmsUser!, 'UPDATE_SETTINGS', 'settings', 'app_settings', db.settings as unknown as Record<string, unknown>);
        saveLocalDb(db);
        return db.settings;
      });
      res.json({ settings });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // 5. Dashboard Summary
  router.get('/dashboard/summary', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const todayStr = new Date().toISOString().slice(0, 10);

      let orders: OrderRecord[] = [];
      let gallonStockFilled = 0;
      let gallonStockEmpty = 0;
      let gallonMinThreshold = 15;

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        let orderQuery = admin
          .from('orders')
          .select('id,order_number,service_type,requester_id,requester_name,requester_email,unit_id,location_label,status,needed_date,created_at,updated_at,units(name),order_items(*)')
          .order('created_at', { ascending: false })
          .limit(200);

        if (user.role === 'user') {
          orderQuery = orderQuery.eq('requester_id', user.id);
        } else if (user.role === 'kepala_unit') {
          orderQuery = orderQuery.or(
            `requester_id.eq.${user.id},and(service_type.eq.fotokopi,unit_id.in.(${(user.head_unit_ids.length ? user.head_unit_ids : ['00000000-0000-0000-0000-000000000000']).join(',')}))`
          );
        }

        const [oRes, balRes, setRes] = await Promise.all([
          orderQuery,
          admin.from('inventory_balances').select('qty_filled,qty_empty'),
          admin.from('app_settings').select('value').eq('key', 'gallon_min_stock').single(),
        ]);
        orders = (oRes.data || []).map(mapSupabaseOrderRow);
        for (const b of balRes.data || []) {
          gallonStockFilled += Number(b.qty_filled || 0);
          gallonStockEmpty += Number(b.qty_empty || 0);
        }
        gallonMinThreshold = Number(setRes.data?.value ?? 15);
      } else {
        const db = loadLocalDb();
        orders = db.orders.filter((o) => {
          if (user.role === 'super_admin' || user.role === 'admin_resources') return true;
          if (user.role === 'kepala_unit') {
            return o.requester_id === user.id || (o.service_type === 'fotokopi' && user.head_unit_ids.includes(o.unit_id));
          }
          return o.requester_id === user.id;
        });
        for (const b of db.inventoryBalances) {
          gallonStockFilled += b.qty_filled;
          gallonStockEmpty += b.qty_empty;
        }
        gallonMinThreshold = db.settings.gallon_min_stock;
      }

      const allocated = orders
        .filter(
          (o) =>
            o.service_type === 'galon' &&
            ['Menunggu Diproses', 'Diproses', 'Dalam Pengiriman'].includes(o.status)
        )
        .reduce((acc, o) => acc + (o.item.gallon_requested_qty || 0), 0);

      // Trend 7 hari terakhir
      const trendMap = new Map<string, { date: string; galon: number; fotokopi: number; laminating: number }>();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        trendMap.set(d, { date: d.slice(5), galon: 0, fotokopi: 0, laminating: 0 });
      }
      for (const o of orders) {
        const d = o.created_at.slice(0, 10);
        const bucket = trendMap.get(d);
        if (bucket) {
          bucket[o.service_type] += 1;
        }
      }

      // Distribusi per unit
      const unitCounter = new Map<string, number>();
      for (const o of orders) {
        unitCounter.set(o.unit_name, (unitCounter.get(o.unit_name) || 0) + 1);
      }

      // Volume fotokopi per bulan
      const monthCounter = new Map<string, { month: string; sidesBW: number; sidesColor: number; sheets: number }>();
      for (const o of orders) {
        if (o.service_type !== 'fotokopi' || o.status === 'Dibatalkan') continue;
        const ym = o.created_at.slice(0, 7);
        const cur = monthCounter.get(ym) || { month: ym, sidesBW: 0, sidesColor: 0, sheets: 0 };
        const sides = o.item.total_print_sides || 0;
        if (o.item.print_color === 'Warna') cur.sidesColor += sides;
        else cur.sidesBW += sides;
        cur.sheets += o.item.total_paper_sheets || 0;
        monthCounter.set(ym, cur);
      }

      const overdueOrdersCount = orders.filter(
        (o) =>
          o.needed_date < todayStr &&
          !['Selesai', 'Dibatalkan'].includes(o.status)
      ).length;

      const summary: DashboardSummary = {
        todayTotal: orders.filter((o) => o.created_at.slice(0, 10) === todayStr).length,
        newOrders: orders.filter((o) => o.status === 'Menunggu Diproses').length,
        inProgressOrders: orders.filter((o) => ['Diproses', 'Dalam Pengiriman', 'Siap Diambil'].includes(o.status)).length,
        completedOrders: orders.filter((o) => o.status === 'Selesai').length,
        cancelledOrders: orders.filter((o) => o.status === 'Dibatalkan').length,
        gallonOrders: orders.filter((o) => o.service_type === 'galon').length,
        photocopyOrders: orders.filter((o) => o.service_type === 'fotokopi').length,
        laminatingOrders: orders.filter((o) => o.service_type === 'laminating').length,
        gallonStockFilled,
        gallonStockEmpty,
        gallonStockAllocated: allocated,
        gallonStockAvailable: Math.max(0, gallonStockFilled - allocated),
        gallonMinThreshold,
        isCriticalStock: gallonStockFilled <= gallonMinThreshold,
        overdueOrdersCount,
        trendByDay: Array.from(trendMap.values()),
        ordersByUnit: Array.from(unitCounter.entries())
          .map(([unitName, count]) => ({ unitName, count }))
          .sort((a, b) => b.count - a.count),
        photocopyVolumeByMonth: Array.from(monthCounter.values()).sort((a, b) => a.month.localeCompare(b.month)),
        recentOrders: orders.slice(0, 6),
        pendingQueue: orders
          .filter((o) => !['Selesai', 'Dibatalkan'].includes(o.status))
          .slice(0, 8),
      };

      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 6. Orders CRUD & Workflow
  router.get('/orders', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 12)));
      const serviceType = String(req.query.serviceType || 'all');
      const status = String(req.query.status || 'all');
      const unitId = String(req.query.unitId || 'all');
      const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
      const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
      const search = req.query.search ? String(req.query.search).trim() : undefined;
      const mineOnly = req.query.mineOnly === 'true';

      if (isSupabaseConfigured()) {
        const result = await sbListOrders(user, {
          page,
          pageSize,
          serviceType,
          status,
          unitId,
          dateFrom,
          dateTo,
          search,
          mineOnly,
        });
        res.json(result);
        return;
      }

      const db = loadLocalDb();
      let filtered = db.orders.filter((o) => {
        if (mineOnly || user.role === 'user') return o.requester_id === user.id;
        if (user.role === 'kepala_unit') {
          return o.requester_id === user.id || (o.service_type === 'fotokopi' && user.head_unit_ids.includes(o.unit_id));
        }
        return true;
      });

      if (serviceType !== 'all') filtered = filtered.filter((o) => o.service_type === serviceType);
      if (status !== 'all') filtered = filtered.filter((o) => o.status === status);
      if (unitId !== 'all') filtered = filtered.filter((o) => o.unit_id === unitId);
      if (dateFrom) filtered = filtered.filter((o) => o.needed_date >= dateFrom);
      if (dateTo) filtered = filtered.filter((o) => o.needed_date <= dateTo);
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (o) =>
            o.order_number.toLowerCase().includes(q) ||
            o.requester_name.toLowerCase().includes(q) ||
            (o.item.document_name || '').toLowerCase().includes(q) ||
            o.unit_name.toLowerCase().includes(q)
        );
      }

      filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const total = filtered.length;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);
      res.json({ items, total, page, pageSize });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get('/orders/:id', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const { id } = req.params;

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const [{ data: orderRow, error }, { data: histRows }] = await Promise.all([
          admin
            .from('orders')
            .select('*,units(name),order_items(*),order_attachments(*)')
            .eq('id', id)
            .single(),
          admin
            .from('order_status_history')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false }),
        ]);
        if (error || !orderRow) {
          res.status(404).json({ error: 'Order tidak ditemukan.' });
          return;
        }
        const mapped = mapSupabaseOrderRow(orderRow);
        const canAccess =
          mapped.requester_id === user.id ||
          user.role === 'super_admin' ||
          user.role === 'admin_resources' ||
          (user.role === 'kepala_unit' &&
            mapped.service_type === 'fotokopi' &&
            user.head_unit_ids.includes(mapped.unit_id));

        if (!canAccess) {
          res.status(403).json({ error: 'Tidak memiliki akses ke detail order ini.' });
          return;
        }
        mapped.history = (histRows || []) as OrderRecord['history'];
        res.json({ order: mapped });
        return;
      }

      const db = loadLocalDb();
      const order = db.orders.find((o) => o.id === id);
      if (!order) {
        res.status(404).json({ error: 'Order tidak ditemukan.' });
        return;
      }

      const canAccess =
        order.requester_id === user.id ||
        user.role === 'super_admin' ||
        user.role === 'admin_resources' ||
        (user.role === 'kepala_unit' &&
          order.service_type === 'fotokopi' &&
          user.head_unit_ids.includes(order.unit_id));

      if (!canAccess) {
        res.status(403).json({ error: 'Tidak memiliki akses ke order ini.' });
        return;
      }

      res.json({ order });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/orders', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const body = req.body as Record<string, unknown>;
      const serviceType = body.service_type as ServiceType;

      if (!['galon', 'fotokopi', 'laminating'].includes(serviceType)) {
        res.status(400).json({ error: 'Jenis layanan tidak valid.' });
        return;
      }
      if (!body.unit_id || !body.needed_date) {
        res.status(400).json({ error: 'Unit/Departemen dan tanggal kebutuhan wajib diisi.' });
        return;
      }

      if (serviceType === 'galon') {
        const reqQty = Number(body.gallon_requested_qty || 0);
        const empQty = Number(body.gallon_empty_return_planned || 0);
        if (reqQty <= 0 || !Number.isFinite(reqQty)) {
          res.status(400).json({ error: 'Jumlah galon yang diminta harus lebih dari 0.' });
          return;
        }
        if (empQty < 0) {
          res.status(400).json({ error: 'Jumlah galon kosong ditukar tidak boleh negatif.' });
          return;
        }
      } else if (serviceType === 'fotokopi') {
        if (!body.document_name || Number(body.page_count) <= 0 || Number(body.copy_count) <= 0) {
          res.status(400).json({ error: 'Nama dokumen, jumlah halaman, dan jumlah rangkap wajib valid (> 0).' });
          return;
        }
      } else if (serviceType === 'laminating') {
        if (!body.document_name || Number(body.laminating_sheets) <= 0) {
          res.status(400).json({ error: 'Nama dokumen dan jumlah lembar laminating wajib diisi (> 0).' });
          return;
        }
      }

      if (isSupabaseConfigured()) {
        const created = await sbCreateOrder(user, body);
        res.status(201).json({ order: created });
        return;
      }

      const created = await withLocalLock(async () => {
        const db = loadLocalDb();
        const unit = db.units.find((u) => u.id === body.unit_id);
        if (!unit) throw new Error('Unit/Departemen tidak ditemukan.');

        const loc = db.locations.find((l) => l.id === body.location_id);
        const locationLabel = loc
          ? `${loc.building} · ${loc.floor} · ${loc.room}`
          : String(body.location_label || '');

        const orderNumber = nextSequenceNumber(db, getServicePrefix(serviceType));
        const nowIso = new Date().toISOString();

        const item: OrderRecord['item'] = {};
        if (serviceType === 'galon') {
          item.gallon_requested_qty = Number(body.gallon_requested_qty);
          item.gallon_empty_return_planned = Number(body.gallon_empty_return_planned || 0);
        } else if (serviceType === 'fotokopi') {
          const calc = calculatePhotocopyMetrics(
            Number(body.page_count),
            Number(body.copy_count),
            (body.print_sides as 'satu_sisi' | 'dua_sisi') || 'satu_sisi'
          );
          item.document_name = String(body.document_name);
          item.page_count = calc.pageCount;
          item.copy_count = calc.copyCount;
          item.paper_size = String(body.paper_size || 'A4');
          item.print_color = (body.print_color as 'Hitam Putih' | 'Warna') || 'Hitam Putih';
          item.print_sides = calc.printSide;
          item.finishing_notes = body.finishing_notes ? String(body.finishing_notes) : null;
          item.total_print_sides = calc.totalPrintSides;
          item.total_paper_sheets = calc.totalPaperSheets;
        } else {
          item.document_name = String(body.document_name);
          item.laminating_size = String(body.laminating_size || 'A4');
          item.laminating_type = String(body.laminating_type || 'Glossy 100 Micron');
          item.laminating_sheets = Number(body.laminating_sheets);
        }

        const newOrder: OrderRecord = {
          id: `ord-${crypto.randomUUID()}`,
          order_number: orderNumber,
          service_type: serviceType,
          requester_id: user.id,
          requester_name: user.full_name,
          requester_email: user.email,
          unit_id: unit.id,
          unit_name: unit.name,
          location_id: loc?.id || null,
          location_label: locationLabel || null,
          status: 'Menunggu Diproses',
          needed_date: String(body.needed_date),
          needed_time: body.needed_time ? String(body.needed_time) : null,
          notes: body.notes ? String(body.notes) : null,
          created_at: nowIso,
          updated_at: nowIso,
          item,
          attachments: [],
          history: [
            {
              id: `hist-${crypto.randomUUID()}`,
              order_id: '',
              from_status: null,
              to_status: 'Menunggu Diproses',
              changed_by_name: user.full_name,
              note: 'Permintaan dibuat dan langsung masuk antrean Divisi Resources',
              created_at: nowIso,
            },
          ],
        };
        newOrder.history![0].order_id = newOrder.id;

        db.orders.unshift(newOrder);
        addNotification(db, {
          user_id: user.id,
          title: 'Order Berhasil Dibuat',
          message: `Permintaan ${orderNumber} telah masuk antrean Divisi Resources.`,
          category: 'order',
          related_order_id: newOrder.id,
        });
        addNotification(db, {
          target_role: 'admin_resources',
          title: 'Order Baru Masuk',
          message: `Order ${orderNumber} (${unit.name}) menunggu diproses.`,
          category: 'order',
          related_order_id: newOrder.id,
        });
        appendAudit(db, user, 'CREATE_ORDER', 'order', newOrder.id, {
          order_number: orderNumber,
          service_type: serviceType,
          unit_id: unit.id,
        });
        saveLocalDb(db);
        return newOrder;
      });

      res.status(201).json({ order: created });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Upload attachment (private bucket / local private folder)
  router.post('/orders/:id/attachments', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const { id } = req.params;
      const { fileName, mimeType, base64 } = req.body as {
        fileName?: string;
        mimeType?: string;
        base64?: string;
      };

      if (!fileName || !mimeType || !base64) {
        res.status(400).json({ error: 'Data file tidak lengkap.' });
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        res.status(400).json({ error: 'Tipe file tidak diizinkan. Gunakan PDF, DOC, DOCX, PNG, atau JPG.' });
        return;
      }

      const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
        res.status(400).json({ error: 'Ukuran file harus antara 1 byte hingga maksimal 25 MB.' });
        return;
      }

      if (isSupabaseConfigured()) {
        const attachment = await sbUploadAttachment(user, id, fileName, mimeType, buffer);
        res.status(201).json({ attachment });
        return;
      }

      const attachment = await withLocalLock(async () => {
        const db = loadLocalDb();
        const order = db.orders.find((o) => o.id === id);
        if (!order) throw new Error('Order tidak ditemukan.');
        if (
          order.requester_id !== user.id &&
          user.role !== 'super_admin' &&
          user.role !== 'admin_resources'
        ) {
          throw new Error('Tidak berwenang mengunggah dokumen untuk order ini.');
        }

        const { storagePath, safeName } = savePrivateLocalUpload(fileName, mimeType, buffer);
        const att = {
          id: `att-${crypto.randomUUID()}`,
          order_id: order.id,
          file_name: safeName,
          mime_type: mimeType,
          file_size_bytes: buffer.length,
          storage_path: storagePath,
          created_at: new Date().toISOString(),
        };
        order.attachments = order.attachments || [];
        order.attachments.push(att);
        saveLocalDb(db);
        return att;
      });

      res.status(201).json({ attachment });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Short-lived Signed URL for authorized document download
  router.get('/orders/:id/attachments/:attachmentId/signed-url', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const { id, attachmentId } = req.params;

      if (isSupabaseConfigured()) {
        const signedUrl = await sbGetAttachmentSignedUrl(user, id, attachmentId);
        res.json({ signedUrl, expiresInSeconds: 60 });
        return;
      }

      const db = loadLocalDb();
      const order = db.orders.find((o) => o.id === id);
      if (!order) {
        res.status(404).json({ error: 'Order tidak ditemukan.' });
        return;
      }
      const authorized =
        order.requester_id === user.id || user.role === 'super_admin' || user.role === 'admin_resources';
      if (!authorized) {
        res.status(403).json({
          error: 'Akses ditolak: dokumen fotokopi hanya dapat dibuka oleh pemesan atau petugas berwenang.',
        });
        return;
      }

      const att = (order.attachments || []).find((a) => a.id === attachmentId);
      if (!att) {
        res.status(404).json({ error: 'Lampiran dokumen tidak ditemukan.' });
        return;
      }

      const token = createSignedFileToken(att.id, user.id, 60);
      res.json({
        signedUrl: `/api/files/download?token=${encodeURIComponent(token)}`,
        expiresInSeconds: 60,
      });
    } catch (err) {
      res.status(403).json({ error: (err as Error).message });
    }
  });

  // Update order status / cancel / assign / update actual photocopy or laminating counts
  router.patch('/orders/:id/status', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const { id } = req.params;
      const {
        status,
        note,
        internal_notes,
        cancel_reason,
        assigned_staff_id,
        actual_page_count,
        actual_copy_count,
        laminating_actual_sheets,
      } = req.body as {
        status?: OrderStatus;
        note?: string;
        internal_notes?: string;
        cancel_reason?: string;
        assigned_staff_id?: string;
        actual_page_count?: number;
        actual_copy_count?: number;
        laminating_actual_sheets?: number;
      };

      const isAdmin = user.role === 'super_admin' || user.role === 'admin_resources';

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data: existing } = await admin
          .from('orders')
          .select('*,order_items(*)')
          .eq('id', id)
          .single();

        if (!existing) {
          res.status(404).json({ error: 'Order tidak ditemukan.' });
          return;
        }

        if (!isAdmin) {
          if (existing.requester_id !== user.id || status !== 'Dibatalkan') {
            res.status(403).json({ error: 'Anda tidak berwenang mengubah status order ini.' });
            return;
          }
          if (existing.status !== 'Menunggu Diproses') {
            res.status(400).json({ error: 'Order yang sudah diproses tidak dapat dibatalkan.' });
            return;
          }
        }

        if (existing.service_type === 'galon' && status === 'Selesai') {
          res.status(400).json({
            error: 'Penyelesaian order Air Galon harus melalui konfirmasi pengiriman agar stok diperbarui secara atomic.',
          });
          return;
        }

        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = { updated_at: nowIso };
        if (status) {
          patch.status = status;
          if (status === 'Diproses' && !existing.processed_at) patch.processed_at = nowIso;
          if (status === 'Selesai') patch.completed_at = nowIso;
          if (status === 'Dibatalkan') {
            patch.cancelled_at = nowIso;
            patch.cancel_reason = cancel_reason || note || 'Dibatalkan';
          }
        }
        if (isAdmin && internal_notes !== undefined) patch.internal_notes = internal_notes;
        if (isAdmin && assigned_staff_id) {
          const { data: staff } = await admin.from('profiles').select('full_name').eq('id', assigned_staff_id).single();
          patch.assigned_staff_id = assigned_staff_id;
          patch.assigned_staff_name = staff?.full_name || null;
        }

        await admin.from('orders').update(patch).eq('id', id);

        if (isAdmin && (actual_page_count || actual_copy_count || laminating_actual_sheets !== undefined)) {
          const curItem = ((existing.order_items as Array<Record<string, unknown>>) || [])[0] || {};
          const itemPatch: Record<string, unknown> = { updated_at: nowIso };
          if (existing.service_type === 'fotokopi') {
            const pCount = actual_page_count || Number(curItem.page_count);
            const cCount = actual_copy_count || Number(curItem.copy_count);
            const calc = calculatePhotocopyMetrics(
              pCount,
              cCount,
              (curItem.print_sides as 'satu_sisi' | 'dua_sisi') || 'satu_sisi'
            );
            itemPatch.actual_page_count = pCount;
            itemPatch.actual_copy_count = cCount;
            itemPatch.total_print_sides = calc.totalPrintSides;
            itemPatch.total_paper_sheets = calc.totalPaperSheets;
          }
          if (existing.service_type === 'laminating' && laminating_actual_sheets !== undefined) {
            itemPatch.laminating_actual_sheets = Number(laminating_actual_sheets);
          }
          await admin.from('order_items').update(itemPatch).eq('order_id', id);
        }

        if (status && status !== existing.status) {
          await admin.from('order_status_history').insert({
            order_id: id,
            from_status: existing.status,
            to_status: status,
            changed_by: user.id,
            changed_by_name: user.full_name,
            note: cancel_reason || note || `Status diperbarui ke ${status}`,
          });

          await admin.from('notifications').insert({
            user_id: existing.requester_id,
            title: `Order ${existing.order_number}: ${status}`,
            message: cancel_reason
              ? `Order dibatalkan dengan alasan: ${cancel_reason}`
              : `Status pesanan Anda sekarang: ${status}.`,
            category: 'order',
            related_order_id: id,
          });
        }

        res.json({ success: true });
        return;
      }

      const updated = await withLocalLock(async () => {
        const db = loadLocalDb();
        const order = db.orders.find((o) => o.id === id);
        if (!order) throw new Error('Order tidak ditemukan.');

        if (!isAdmin) {
          if (order.requester_id !== user.id || status !== 'Dibatalkan') {
            throw new Error('Tidak memiliki izin untuk mengubah status order ini.');
          }
          if (order.status !== 'Menunggu Diproses') {
            throw new Error('Order hanya dapat dibatalkan selama masih Menunggu Diproses.');
          }
        }

        if (order.service_type === 'galon' && status === 'Selesai') {
          throw new Error(
            'Penyelesaian order Air Galon harus melalui konfirmasi pengiriman agar stok galon terupdate secara atomic.'
          );
        }

        const nowIso = new Date().toISOString();
        const prevStatus = order.status;

        if (isAdmin && internal_notes !== undefined) {
          order.internal_notes = internal_notes;
        }
        if (isAdmin && assigned_staff_id) {
          const staff = db.users.find((u) => u.id === assigned_staff_id);
          order.assigned_staff_id = assigned_staff_id;
          order.assigned_staff_name = staff?.full_name || null;
        }
        if (isAdmin && order.service_type === 'fotokopi' && (actual_page_count || actual_copy_count)) {
          const pCount = actual_page_count || order.item.page_count || 1;
          const cCount = actual_copy_count || order.item.copy_count || 1;
          const calc = calculatePhotocopyMetrics(
            pCount,
            cCount,
            order.item.print_sides || 'satu_sisi'
          );
          order.item.actual_page_count = pCount;
          order.item.actual_copy_count = cCount;
          order.item.total_print_sides = calc.totalPrintSides;
          order.item.total_paper_sheets = calc.totalPaperSheets;
        }
        if (isAdmin && order.service_type === 'laminating' && laminating_actual_sheets !== undefined) {
          order.item.laminating_actual_sheets = Math.max(0, Number(laminating_actual_sheets));
        }

        if (status && status !== prevStatus) {
          order.status = status;
          if (status === 'Diproses' && !order.processed_at) order.processed_at = nowIso;
          if (status === 'Selesai') order.completed_at = nowIso;
          if (status === 'Dibatalkan') {
            order.cancelled_at = nowIso;
            order.cancel_reason = cancel_reason || note || 'Dibatalkan oleh pengguna';
          }

          order.history = order.history || [];
          order.history.unshift({
            id: `hist-${crypto.randomUUID()}`,
            order_id: order.id,
            from_status: prevStatus,
            to_status: status,
            changed_by_name: user.full_name,
            note: cancel_reason || note || `Status berubah dari ${prevStatus} ke ${status}`,
            created_at: nowIso,
          });

          addNotification(db, {
            user_id: order.requester_id,
            title: `Order ${order.order_number}: ${status}`,
            message:
              status === 'Dibatalkan'
                ? `Order dibatalkan: ${order.cancel_reason}`
                : `Status order Anda kini: ${status}.`,
            category: 'order',
            related_order_id: order.id,
          });
        }

        order.updated_at = nowIso;
        appendAudit(db, user, 'UPDATE_ORDER_STATUS', 'order', order.id, {
          order_number: order.order_number,
          from: prevStatus,
          to: order.status,
        });
        saveLocalDb(db);
        return order;
      });

      res.json({ order: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Delete order permanently (Hanya Super Admin & Admin Resources)
  router.delete(
    '/orders/:id',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { id } = req.params;
        const rawReason = typeof req.body?.reason === 'string'
          ? req.body.reason
          : typeof req.query.reason === 'string'
          ? req.query.reason
          : '';
        const reason = rawReason.trim().slice(0, 300) || null;

        if (!id || typeof id !== 'string') {
          res.status(400).json({ error: 'ID order tidak valid.' });
          return;
        }

        if (isSupabaseConfigured()) {
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!uuidRegex.test(id)) {
            res.status(400).json({ error: 'Format ID order tidak valid.' });
            return;
          }

          const admin = getSupabaseAdmin()!;
          const { data: existing, error: fetchErr } = await admin
            .from('orders')
            .select(
              'id,order_number,service_type,status,requester_id,requester_name,requester_email,unit_id,order_attachments(storage_bucket,storage_path)'
            )
            .eq('id', id)
            .maybeSingle();

          if (fetchErr) {
            throw new Error(fetchErr.message);
          }
          if (!existing) {
            res.status(404).json({ error: 'Order tidak ditemukan.' });
            return;
          }

          await admin.from('notifications').delete().eq('related_order_id', id);

          const { error: deleteErr } = await admin.from('orders').delete().eq('id', id);
          if (deleteErr) {
            throw new Error(deleteErr.message);
          }

          const attachments =
            (existing.order_attachments as Array<{ storage_bucket?: string; storage_path?: string }>) || [];
          const byBucket = new Map<string, string[]>();
          for (const att of attachments) {
            if (!att.storage_path) continue;
            const bucket = att.storage_bucket || 'order-documents';
            const list = byBucket.get(bucket) || [];
            list.push(att.storage_path);
            byBucket.set(bucket, list);
          }
          for (const [bucket, paths] of byBucket.entries()) {
            if (paths.length > 0) {
              await admin.storage.from(bucket).remove(paths).catch(() => undefined);
            }
          }

          await admin
            .from('audit_logs')
            .insert({
              actor_id: user.id,
              actor_email: user.email,
              actor_role: user.role,
              action: 'DELETE_ORDER',
              entity_type: 'order',
              entity_id: id,
              details: {
                order_number: existing.order_number,
                service_type: existing.service_type,
                status: existing.status,
                requester_name: existing.requester_name,
                requester_email: existing.requester_email,
                reason,
              },
            })
            .then(
              () => undefined,
              () => undefined
            );

          res.json({ success: true, deletedOrderNumber: existing.order_number });
          return;
        }

        const removed = await withLocalLock(async () => {
          const db = loadLocalDb();
          const idx = db.orders.findIndex((o) => o.id === id);
          if (idx === -1) {
            const err = new Error('Order tidak ditemukan.');
            (err as Error & { status?: number }).status = 404;
            throw err;
          }

          const [target] = db.orders.splice(idx, 1);
          db.notifications = db.notifications.filter((n) => n.related_order_id !== id);
          appendAudit(db, user, 'DELETE_ORDER', 'order', target.id, {
            order_number: target.order_number,
            service_type: target.service_type,
            status: target.status,
            requester_name: target.requester_name,
            requester_email: target.requester_email,
            reason,
          });
          saveLocalDb(db);

          for (const att of target.attachments || []) {
            if (att.storage_path) {
              deletePrivateLocalUpload(att.storage_path);
            }
          }

          return target;
        });

        res.json({ success: true, deletedOrderNumber: removed.order_number });
      } catch (err) {
        const e = err as Error & { status?: number };
        res.status(e.status || 400).json({ error: e.message });
      }
    }
  );

  // 7. Atomic Gallon Delivery & Empty Return Completion
  router.post(
    '/orders/:id/complete-gallon',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { id } = req.params;
        const { location_id, delivered_qty, empty_received_qty, notes } = req.body as {
          location_id: string;
          delivered_qty: number;
          empty_received_qty: number;
          notes?: string;
        };

        const dQty = Number(delivered_qty);
        const eQty = Number(empty_received_qty);
        if (!location_id || !Number.isFinite(dQty) || !Number.isFinite(eQty) || dQty < 0 || eQty < 0) {
          res.status(400).json({ error: 'Lokasi gudang dan jumlah kirim/terima harus valid (>= 0).' });
          return;
        }

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data, error } = await admin.rpc('rpc_complete_gallon_delivery', {
            p_order_id: id,
            p_location_id: location_id,
            p_delivered_qty: dQty,
            p_empty_received_qty: eQty,
            p_actor_id: user.id,
            p_actor_name: user.full_name,
            p_notes: notes || null,
          });
          if (error) throw new Error(error.message);
          res.json({ result: data });
          return;
        }

        const result = await withLocalLock(async () => {
          const db = loadLocalDb();
          const order = db.orders.find((o) => o.id === id);
          if (!order) throw new Error('Order tidak ditemukan.');
          if (order.service_type !== 'galon') throw new Error('Order bukan layanan Air Galon.');
          if (order.status === 'Selesai') {
            throw new Error('Order sudah berstatus Selesai. Pengurangan stok ganda dicegah.');
          }
          if (order.status === 'Dibatalkan') {
            throw new Error('Order yang dibatalkan tidak dapat diselesaikan.');
          }

          const bal = db.inventoryBalances.find((b) => b.location_id === location_id);
          if (!bal) throw new Error('Lokasi penyimpanan stok tidak ditemukan.');
          if (bal.qty_filled < dQty) {
            throw new Error(
              `Stok galon isi di ${bal.location_name} tidak mencukupi (tersedia ${bal.qty_filled}, akan dikirim ${dQty}).`
            );
          }

          const nowIso = new Date().toISOString();
          bal.qty_filled -= dQty;
          bal.qty_empty += eQty;
          bal.updated_at = nowIso;

          if (dQty > 0) {
            db.inventoryTransactions.unshift({
              id: `tx-${crypto.randomUUID()}`,
              location_id: bal.location_id,
              location_name: bal.location_name,
              transaction_type: 'DISTRIBUTION',
              stock_kind: 'isi',
              qty_delta: -dQty,
              balance_after: bal.qty_filled,
              reference_type: 'order',
              reference_number: order.order_number,
              unit_id: order.unit_id,
              unit_name: order.unit_name,
              notes: notes || `Pengiriman galon isi ke ${order.unit_name}`,
              created_by_name: user.full_name,
              created_at: nowIso,
            });
          }

          if (eQty > 0) {
            db.inventoryTransactions.unshift({
              id: `tx-${crypto.randomUUID()}`,
              location_id: bal.location_id,
              location_name: bal.location_name,
              transaction_type: 'EMPTY_RETURN',
              stock_kind: 'kosong',
              qty_delta: eQty,
              balance_after: bal.qty_empty,
              reference_type: 'order',
              reference_number: order.order_number,
              unit_id: order.unit_id,
              unit_name: order.unit_name,
              notes: notes || `Penerimaan galon kosong kembali dari ${order.unit_name}`,
              created_by_name: user.full_name,
              created_at: nowIso,
            });
          }

          const prevStatus = order.status;
          order.item.gallon_delivered_qty = dQty;
          order.item.gallon_empty_received_qty = eQty;
          order.status = 'Selesai';
          order.completed_at = nowIso;
          order.updated_at = nowIso;
          order.assigned_staff_id = order.assigned_staff_id || user.id;
          order.assigned_staff_name = order.assigned_staff_name || user.full_name;
          order.history = order.history || [];
          order.history.unshift({
            id: `hist-${crypto.randomUUID()}`,
            order_id: order.id,
            from_status: prevStatus,
            to_status: 'Selesai',
            changed_by_name: user.full_name,
            note: `Dikirim ${dQty} galon isi dari ${bal.location_name}, diterima ${eQty} galon kosong.`,
            created_at: nowIso,
          });

          addNotification(db, {
            user_id: order.requester_id,
            title: `Pengiriman Galon ${order.order_number} Selesai`,
            message: `${dQty} galon isi telah dikirim ke ${order.unit_name}.`,
            category: 'order',
            related_order_id: order.id,
          });

          const totalFilled = db.inventoryBalances.reduce((s, b) => s + b.qty_filled, 0);
          if (totalFilled <= db.settings.gallon_min_stock) {
            addNotification(db, {
              target_role: 'admin_resources',
              title: 'Peringatan Stok Galon Minimum',
              message: `Total stok galon isi tersisa ${totalFilled} galon (batas minimum ${db.settings.gallon_min_stock}).`,
              category: 'inventory',
            });
          }

          appendAudit(db, user, 'COMPLETE_GALLON_DELIVERY', 'order', order.id, {
            order_number: order.order_number,
            location_id,
            delivered_qty: dQty,
            empty_received_qty: eQty,
          });

          saveLocalDb(db);
          return { order, balance: bal };
        });

        res.json(result);
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // 8. Inventory Management (Air Galon)
  router.get('/inventory/overview', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      const isAdmin = user.role === 'super_admin' || user.role === 'admin_resources';

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const [balRes, setRes, ordersRes] = await Promise.all([
          admin.from('inventory_balances').select('*,inventory_locations(code,name,building)'),
          admin.from('app_settings').select('value').eq('key', 'gallon_min_stock').single(),
          admin
            .from('orders')
            .select('status,order_items(gallon_requested_qty)')
            .eq('service_type', 'galon')
            .in('status', ['Menunggu Diproses', 'Diproses', 'Dalam Pengiriman']),
        ]);

        const balances = (balRes.data || []).map((b: Record<string, unknown>) => ({
          id: b.id,
          location_id: b.location_id,
          location_code: (b.inventory_locations as { code?: string })?.code || '-',
          location_name: (b.inventory_locations as { name?: string })?.name || '-',
          building: (b.inventory_locations as { building?: string })?.building || '-',
          qty_filled: Number(b.qty_filled || 0),
          qty_empty: Number(b.qty_empty || 0),
          qty_damaged: Number(b.qty_damaged || 0),
          qty_lost: Number(b.qty_lost || 0),
          updated_at: b.updated_at,
        }));

        const allocated = (ordersRes.data || []).reduce((acc: number, row: Record<string, unknown>) => {
          const items = (row.order_items as Array<{ gallon_requested_qty?: number }>) || [];
          return acc + Number(items[0]?.gallon_requested_qty || 0);
        }, 0);

        if (!isAdmin) {
          res.json({ balances, allocated, minThreshold: Number(setRes.data?.value ?? 15) });
          return;
        }

        const [txRes, rcvRes, opnRes, adjRes] = await Promise.all([
          admin
            .from('inventory_transactions')
            .select('*,inventory_locations(name),units(name)')
            .order('created_at', { ascending: false })
            .limit(100),
          admin
            .from('inventory_receipts')
            .select('*,inventory_locations(name)')
            .order('created_at', { ascending: false })
            .limit(50),
          admin
            .from('inventory_stock_opnames')
            .select('*,inventory_locations(name),inventory_stock_opname_items(*)')
            .order('created_at', { ascending: false })
            .limit(30),
          admin
            .from('inventory_adjustments')
            .select('*,inventory_locations(name)')
            .order('created_at', { ascending: false })
            .limit(50),
        ]);

        res.json({
          balances,
          allocated,
          minThreshold: Number(setRes.data?.value ?? 15),
          transactions: (txRes.data || []).map((t: Record<string, unknown>) => ({
            ...t,
            location_name: (t.inventory_locations as { name?: string })?.name || '-',
            unit_name: (t.units as { name?: string } | null)?.name || null,
          })),
          receipts: (rcvRes.data || []).map((r: Record<string, unknown>) => ({
            ...r,
            location_name: (r.inventory_locations as { name?: string })?.name || '-',
          })),
          opnames: (opnRes.data || []).map((o: Record<string, unknown>) => ({
            ...o,
            location_name: (o.inventory_locations as { name?: string })?.name || '-',
            items: o.inventory_stock_opname_items || [],
          })),
          adjustments: (adjRes.data || []).map((a: Record<string, unknown>) => ({
            ...a,
            location_name: (a.inventory_locations as { name?: string })?.name || '-',
          })),
        });
        return;
      }

      const db = loadLocalDb();
      const allocated = db.orders
        .filter(
          (o) =>
            o.service_type === 'galon' &&
            ['Menunggu Diproses', 'Diproses', 'Dalam Pengiriman'].includes(o.status)
        )
        .reduce((acc, o) => acc + (o.item.gallon_requested_qty || 0), 0);

      if (!isAdmin) {
        res.json({
          balances: db.inventoryBalances,
          allocated,
          minThreshold: db.settings.gallon_min_stock,
        });
        return;
      }

      res.json({
        balances: db.inventoryBalances,
        allocated,
        minThreshold: db.settings.gallon_min_stock,
        transactions: db.inventoryTransactions.slice(0, 100),
        receipts: db.inventoryReceipts.slice(0, 50),
        opnames: db.stockOpnames.slice(0, 30),
        adjustments: db.inventoryAdjustments.slice(0, 50),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Barang Masuk
  router.post(
    '/inventory/receipts',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { receipt_date, supplier_name, document_number, location_id, qty_filled, qty_empty, notes } = req.body;
        const filled = Number(qty_filled || 0);
        const empty = Number(qty_empty || 0);
        if (!supplier_name || !location_id || (filled <= 0 && empty <= 0) || filled < 0 || empty < 0) {
          res.status(400).json({ error: 'Supplier, lokasi, dan minimal satu jumlah galon (> 0) wajib valid.' });
          return;
        }

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data: item } = await admin.from('inventory_items').select('id').eq('sku', 'GALON-19L').single();
          const { data: bal } = await admin
            .from('inventory_balances')
            .select('*')
            .eq('item_id', item!.id)
            .eq('location_id', location_id)
            .single();
          if (!bal) throw new Error('Saldo lokasi tidak ditemukan.');

          const ym = new Date().toISOString().slice(0, 7).replace('-', '');
          const rcvNum = `RCV-${ym}-${String(Math.floor(1000 + Math.random() * 9000))}`;
          const newFilled = Number(bal.qty_filled) + filled;
          const newEmpty = Number(bal.qty_empty) + empty;

          await admin
            .from('inventory_balances')
            .update({ qty_filled: newFilled, qty_empty: newEmpty, updated_at: new Date().toISOString() })
            .eq('id', bal.id);

          const { data: rcv } = await admin
            .from('inventory_receipts')
            .insert({
              receipt_number: rcvNum,
              receipt_date,
              supplier_name,
              document_number,
              location_id,
              qty_filled: filled,
              qty_empty: empty,
              notes,
              created_by: user.id,
              created_by_name: user.full_name,
            })
            .select('*')
            .single();

          if (filled > 0) {
            await admin.from('inventory_transactions').insert({
              item_id: item!.id,
              location_id,
              transaction_type: 'RECEIPT',
              stock_kind: 'isi',
              qty_delta: filled,
              balance_after: newFilled,
              reference_type: 'receipt',
              reference_id: rcv?.id,
              reference_number: rcvNum,
              notes: notes || `Penerimaan dari ${supplier_name}`,
              created_by: user.id,
              created_by_name: user.full_name,
            });
          }
          if (empty > 0) {
            await admin.from('inventory_transactions').insert({
              item_id: item!.id,
              location_id,
              transaction_type: 'RECEIPT',
              stock_kind: 'kosong',
              qty_delta: empty,
              balance_after: newEmpty,
              reference_type: 'receipt',
              reference_id: rcv?.id,
              reference_number: rcvNum,
              notes: notes || `Penerimaan galon kosong dari ${supplier_name}`,
              created_by: user.id,
              created_by_name: user.full_name,
            });
          }
          res.status(201).json({ receipt: rcv });
          return;
        }

        const receipt = await withLocalLock(async () => {
          const db = loadLocalDb();
          const bal = db.inventoryBalances.find((b) => b.location_id === location_id);
          if (!bal) throw new Error('Lokasi penyimpanan tidak ditemukan.');
          const rcvNum = nextSequenceNumber(db, 'RCV');
          const nowIso = new Date().toISOString();

          bal.qty_filled += filled;
          bal.qty_empty += empty;
          bal.updated_at = nowIso;

          const created = {
            id: `rcv-${crypto.randomUUID()}`,
            receipt_number: rcvNum,
            receipt_date: String(receipt_date || nowIso.slice(0, 10)),
            supplier_name: String(supplier_name),
            document_number: document_number ? String(document_number) : null,
            location_id: bal.location_id,
            location_name: bal.location_name,
            qty_filled: filled,
            qty_empty: empty,
            notes: notes ? String(notes) : null,
            created_by_name: user.full_name,
            created_at: nowIso,
          };
          db.inventoryReceipts.unshift(created);

          if (filled > 0) {
            db.inventoryTransactions.unshift({
              id: `tx-${crypto.randomUUID()}`,
              location_id: bal.location_id,
              location_name: bal.location_name,
              transaction_type: 'RECEIPT',
              stock_kind: 'isi',
              qty_delta: filled,
              balance_after: bal.qty_filled,
              reference_type: 'receipt',
              reference_number: rcvNum,
              notes: notes || `Penerimaan barang masuk dari ${supplier_name}`,
              created_by_name: user.full_name,
              created_at: nowIso,
            });
          }
          if (empty > 0) {
            db.inventoryTransactions.unshift({
              id: `tx-${crypto.randomUUID()}`,
              location_id: bal.location_id,
              location_name: bal.location_name,
              transaction_type: 'RECEIPT',
              stock_kind: 'kosong',
              qty_delta: empty,
              balance_after: bal.qty_empty,
              reference_type: 'receipt',
              reference_number: rcvNum,
              notes: notes || `Penerimaan galon kosong dari ${supplier_name}`,
              created_by_name: user.full_name,
              created_at: nowIso,
            });
          }

          appendAudit(db, user, 'INVENTORY_RECEIPT', 'receipt', created.id, created);
          saveLocalDb(db);
          return created;
        });
        res.status(201).json({ receipt });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Pengembalian Galon Kosong Mandiri
  router.post(
    '/inventory/empty-returns',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { location_id, unit_id, qty_empty, notes } = req.body;
        const qty = Number(qty_empty || 0);
        if (!location_id || qty <= 0) {
          res.status(400).json({ error: 'Lokasi gudang dan jumlah galon kosong (> 0) wajib diisi.' });
          return;
        }

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data: item } = await admin.from('inventory_items').select('id').eq('sku', 'GALON-19L').single();
          const { data: bal } = await admin
            .from('inventory_balances')
            .select('*')
            .eq('item_id', item!.id)
            .eq('location_id', location_id)
            .single();
          if (!bal) throw new Error('Saldo lokasi tidak ditemukan.');
          const newEmpty = Number(bal.qty_empty) + qty;
          await admin
            .from('inventory_balances')
            .update({ qty_empty: newEmpty, updated_at: new Date().toISOString() })
            .eq('id', bal.id);
          await admin.from('inventory_transactions').insert({
            item_id: item!.id,
            location_id,
            transaction_type: 'EMPTY_RETURN',
            stock_kind: 'kosong',
            qty_delta: qty,
            balance_after: newEmpty,
            unit_id: unit_id || null,
            notes: notes || 'Pengembalian galon kosong dari unit',
            created_by: user.id,
            created_by_name: user.full_name,
          });
          res.status(201).json({ success: true });
          return;
        }

        const tx = await withLocalLock(async () => {
          const db = loadLocalDb();
          const bal = db.inventoryBalances.find((b) => b.location_id === location_id);
          if (!bal) throw new Error('Lokasi penyimpanan tidak ditemukan.');
          const unit = db.units.find((u) => u.id === unit_id);
          const nowIso = new Date().toISOString();
          bal.qty_empty += qty;
          bal.updated_at = nowIso;

          const created = {
            id: `tx-${crypto.randomUUID()}`,
            location_id: bal.location_id,
            location_name: bal.location_name,
            transaction_type: 'EMPTY_RETURN',
            stock_kind: 'kosong' as const,
            qty_delta: qty,
            balance_after: bal.qty_empty,
            reference_type: 'manual_return',
            unit_id: unit?.id || null,
            unit_name: unit?.name || null,
            notes: notes || `Pengembalian galon kosong${unit ? ` dari ${unit.name}` : ''}`,
            created_by_name: user.full_name,
            created_at: nowIso,
          };
          db.inventoryTransactions.unshift(created);
          appendAudit(db, user, 'EMPTY_GALLON_RETURN', 'inventory', bal.id, created);
          saveLocalDb(db);
          return created;
        });

        res.status(201).json({ transaction: tx });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Stock Opname Draft
  router.post(
    '/inventory/opnames',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { location_id, opname_date, notes, items } = req.body as {
          location_id: string;
          opname_date: string;
          notes?: string;
          items: Array<{ stock_kind: GallonStockKind; physical_qty: number; variance_reason?: string }>;
        };

        if (!location_id || !Array.isArray(items) || items.length === 0) {
          res.status(400).json({ error: 'Lokasi dan rincian hasil hitung fisik wajib diisi.' });
          return;
        }
        for (const it of items) {
          if (Number(it.physical_qty) < 0) {
            res.status(400).json({ error: 'Jumlah fisik tidak boleh negatif.' });
            return;
          }
        }

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data: bal } = await admin
            .from('inventory_balances')
            .select('*')
            .eq('location_id', location_id)
            .single();
          if (!bal) throw new Error('Lokasi stok tidak ditemukan.');

          const ym = new Date().toISOString().slice(0, 7).replace('-', '');
          const opNum = `OPN-${ym}-${String(Math.floor(1000 + Math.random() * 9000))}`;
          const { data: opRow, error: opErr } = await admin
            .from('inventory_stock_opnames')
            .insert({
              opname_number: opNum,
              opname_date: opname_date || new Date().toISOString().slice(0, 10),
              location_id,
              status: 'Draft',
              inspector_id: user.id,
              inspector_name: user.full_name,
              notes,
            })
            .select('*')
            .single();
          if (opErr || !opRow) throw new Error(opErr?.message || 'Gagal membuat draft opname.');

          const lines = items.map((it) => {
            const sys =
              it.stock_kind === 'isi'
                ? Number(bal.qty_filled)
                : it.stock_kind === 'kosong'
                ? Number(bal.qty_empty)
                : it.stock_kind === 'rusak'
                ? Number(bal.qty_damaged)
                : Number(bal.qty_lost);
            return {
              opname_id: opRow.id,
              stock_kind: it.stock_kind,
              system_qty: sys,
              physical_qty: Number(it.physical_qty),
              variance_reason: it.variance_reason || null,
            };
          });
          await admin.from('inventory_stock_opname_items').insert(lines);
          res.status(201).json({ opname: opRow });
          return;
        }

        const opname = await withLocalLock(async () => {
          const db = loadLocalDb();
          const bal = db.inventoryBalances.find((b) => b.location_id === location_id);
          if (!bal) throw new Error('Lokasi penyimpanan tidak ditemukan.');
          const opNum = nextSequenceNumber(db, 'OPN');
          const nowIso = new Date().toISOString();

          const mappedLines: StockOpnameLine[] = items.map((it) => {
            const sys = getStockBalanceValue(bal, it.stock_kind);
            const phy = Number(it.physical_qty);
            return {
              stock_kind: it.stock_kind,
              system_qty: sys,
              physical_qty: phy,
              variance_qty: phy - sys,
              variance_reason: it.variance_reason || null,
            };
          });

          const created = {
            id: `opn-${crypto.randomUUID()}`,
            opname_number: opNum,
            opname_date: opname_date || nowIso.slice(0, 10),
            location_id: bal.location_id,
            location_name: bal.location_name,
            status: 'Draft' as const,
            inspector_name: user.full_name,
            notes: notes || null,
            created_at: nowIso,
            items: mappedLines,
          };

          db.stockOpnames.unshift(created);
          appendAudit(db, user, 'CREATE_OPNAME_DRAFT', 'stock_opname', created.id, {
            opname_number: opNum,
            location: bal.location_name,
          });
          saveLocalDb(db);
          return created;
        });

        res.status(201).json({ opname });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Finalize Stock Opname
  router.post(
    '/inventory/opnames/:id/finalize',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { id } = req.params;

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data, error } = await admin.rpc('rpc_finalize_stock_opname', {
            p_opname_id: id,
            p_actor_id: user.id,
            p_actor_name: user.full_name,
          });
          if (error) throw new Error(error.message);
          res.json({ result: data });
          return;
        }

        const finalized = await withLocalLock(async () => {
          const db = loadLocalDb();
          const opname = db.stockOpnames.find((o) => o.id === id);
          if (!opname) throw new Error('Stock opname tidak ditemukan.');
          if (opname.status === 'Final') {
            throw new Error('Stock opname sudah berstatus Final dan tidak dapat diubah lagi.');
          }
          const bal = db.inventoryBalances.find((b) => b.location_id === opname.location_id);
          if (!bal) throw new Error('Saldo lokasi opname tidak ditemukan.');

          const nowIso = new Date().toISOString();
          let hasVariance = false;

          for (const line of opname.items) {
            const currentSys = getStockBalanceValue(bal, line.stock_kind);
            line.system_qty = currentSys;
            line.variance_qty = line.physical_qty - currentSys;

            if (line.variance_qty !== 0) {
              hasVariance = true;
              const adjNum = nextSequenceNumber(db, 'ADJ');
              db.inventoryAdjustments.unshift({
                id: `adj-${crypto.randomUUID()}`,
                adjustment_number: adjNum,
                location_id: bal.location_id,
                location_name: bal.location_name,
                stock_kind: line.stock_kind,
                previous_qty: currentSys,
                adjusted_qty: line.physical_qty,
                delta_qty: line.variance_qty,
                reason: line.variance_reason || `Penyesuaian finalisasi ${opname.opname_number}`,
                source_opname_id: opname.id,
                created_by_name: user.full_name,
                created_at: nowIso,
              });

              computeStockBalanceUpdate(bal, line.stock_kind, line.physical_qty);

              db.inventoryTransactions.unshift({
                id: `tx-${crypto.randomUUID()}`,
                location_id: bal.location_id,
                location_name: bal.location_name,
                transaction_type: 'OPNAME_ADJUSTMENT',
                stock_kind: line.stock_kind,
                qty_delta: line.variance_qty,
                balance_after: line.physical_qty,
                reference_type: 'opname',
                reference_number: opname.opname_number,
                notes: line.variance_reason || `Finalisasi stock opname ${opname.opname_number}`,
                created_by_name: user.full_name,
                created_at: nowIso,
              });
            }
          }

          opname.status = 'Final';
          opname.finalized_at = nowIso;

          if (hasVariance) {
            addNotification(db, {
              target_role: 'super_admin',
              title: `Selisih Stock Opname ${opname.opname_number}`,
              message: `Finalisasi opname pada ${opname.location_name} mencatat penyesuaian stok fisik.`,
              category: 'inventory',
            });
          }

          appendAudit(db, user, 'FINALIZE_STOCK_OPNAME', 'stock_opname', opname.id, {
            opname_number: opname.opname_number,
            has_variance: hasVariance,
          });
          saveLocalDb(db);
          return opname;
        });

        res.json({ opname: finalized });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Penyesuaian Stok Manual (termasuk galon rusak/hilang)
  router.post(
    '/inventory/adjustments',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { location_id, stock_kind, adjusted_qty, reason } = req.body as {
          location_id: string;
          stock_kind: GallonStockKind;
          adjusted_qty: number;
          reason: string;
        };

        const targetQty = Number(adjusted_qty);
        if (!location_id || !stock_kind || !reason || targetQty < 0 || !Number.isFinite(targetQty)) {
          res.status(400).json({ error: 'Lokasi, jenis stok, jumlah baru (>= 0), dan alasan wajib diisi.' });
          return;
        }

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data: item } = await admin.from('inventory_items').select('id').eq('sku', 'GALON-19L').single();
          const { data: bal } = await admin
            .from('inventory_balances')
            .select('*')
            .eq('item_id', item!.id)
            .eq('location_id', location_id)
            .single();
          if (!bal) throw new Error('Saldo lokasi tidak ditemukan.');

          const prevQty =
            stock_kind === 'isi'
              ? Number(bal.qty_filled)
              : stock_kind === 'kosong'
              ? Number(bal.qty_empty)
              : stock_kind === 'rusak'
              ? Number(bal.qty_damaged)
              : Number(bal.qty_lost);

          const col =
            stock_kind === 'isi'
              ? 'qty_filled'
              : stock_kind === 'kosong'
              ? 'qty_empty'
              : stock_kind === 'rusak'
              ? 'qty_damaged'
              : 'qty_lost';

          await admin.from('inventory_balances').update({ [col]: targetQty, updated_at: new Date().toISOString() }).eq('id', bal.id);
          const adjNum = `ADJ-${Date.now()}`;
          const { data: adj } = await admin
            .from('inventory_adjustments')
            .insert({
              adjustment_number: adjNum,
              location_id,
              stock_kind,
              previous_qty: prevQty,
              adjusted_qty: targetQty,
              delta_qty: targetQty - prevQty,
              reason,
              created_by: user.id,
              created_by_name: user.full_name,
            })
            .select('*')
            .single();

          await admin.from('inventory_transactions').insert({
            item_id: item!.id,
            location_id,
            transaction_type: 'MANUAL_ADJUSTMENT',
            stock_kind,
            qty_delta: targetQty - prevQty,
            balance_after: targetQty,
            reference_type: 'adjustment',
            reference_id: adj?.id,
            reference_number: adjNum,
            notes: reason,
            created_by: user.id,
            created_by_name: user.full_name,
          });
          res.status(201).json({ adjustment: adj });
          return;
        }

        const adj = await withLocalLock(async () => {
          const db = loadLocalDb();
          const bal = db.inventoryBalances.find((b) => b.location_id === location_id);
          if (!bal) throw new Error('Lokasi penyimpanan tidak ditemukan.');
          const prevQty = getStockBalanceValue(bal, stock_kind);
          const delta = targetQty - prevQty;
          const nowIso = new Date().toISOString();
          const adjNum = nextSequenceNumber(db, 'ADJ');

          computeStockBalanceUpdate(bal, stock_kind, targetQty);
          const created = {
            id: `adj-${crypto.randomUUID()}`,
            adjustment_number: adjNum,
            location_id: bal.location_id,
            location_name: bal.location_name,
            stock_kind,
            previous_qty: prevQty,
            adjusted_qty: targetQty,
            delta_qty: delta,
            reason,
            created_by_name: user.full_name,
            created_at: nowIso,
          };
          db.inventoryAdjustments.unshift(created);
          db.inventoryTransactions.unshift({
            id: `tx-${crypto.randomUUID()}`,
            location_id: bal.location_id,
            location_name: bal.location_name,
            transaction_type: 'MANUAL_ADJUSTMENT',
            stock_kind,
            qty_delta: delta,
            balance_after: targetQty,
            reference_type: 'adjustment',
            reference_number: adjNum,
            notes: reason,
            created_by_name: user.full_name,
            created_at: nowIso,
          });
          appendAudit(db, user, 'MANUAL_STOCK_ADJUSTMENT', 'adjustment', created.id, created);
          saveLocalDb(db);
          return created;
        });

        res.status(201).json({ adjustment: adj });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // 9. Laporan Penggunaan Unit (Fotokopi, Laminating & Air Galon) + Otorisasi Admin
  router.get(
    '/reports/authorization',
    requireAuth,
    requireRoles('super_admin', 'admin_resources', 'kepala_unit'),
    async (req: AuthedRequest, res) => {
      try {
        const auth = await resolveReportAuthorization(req.lrmsUser);
        res.json({ authorization: auth });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  router.put(
    '/reports/authorization',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const { signature_data_url } = req.body as { signature_data_url?: string | null };

        if (signature_data_url !== null && signature_data_url !== undefined) {
          if (
            typeof signature_data_url !== 'string' ||
            (signature_data_url.length > 0 && !signature_data_url.startsWith('data:image/'))
          ) {
            res.status(400).json({ error: 'Format tanda tangan tidak valid (harus berupa gambar PNG/Data URL).' });
            return;
          }
          if (signature_data_url.length > 400000) {
            res.status(400).json({ error: 'Ukuran gambar tanda tangan terlalu besar.' });
            return;
          }
        }

        const cleanSig = signature_data_url || null;

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          const { data: existing } = await admin
            .from('app_settings')
            .select('value')
            .eq('key', 'report_admin_signatures')
            .maybeSingle();
          const map = ((existing?.value as Record<string, string | null>) || {});
          map[user.email.toLowerCase()] = cleanSig;
          await admin.from('app_settings').upsert(
            {
              key: 'report_admin_signatures',
              value: map,
              updated_by: user.id,
            },
            { onConflict: 'key' }
          );
          const auth = await resolveReportAuthorization({ ...user, signature_data_url: cleanSig });
          res.json({ authorization: auth });
          return;
        }

        const updatedUser = await withLocalLock(async () => {
          const db = loadLocalDb();
          const target = db.users.find((u) => u.id === user.id);
          if (!target) throw new Error('User admin tidak ditemukan.');
          target.signature_data_url = cleanSig;
          appendAudit(db, user, 'UPDATE_REPORT_SIGNATURE', 'user', target.id, {
            email: target.email,
            has_signature: Boolean(cleanSig),
          });
          saveLocalDb(db);
          return target;
        });

        const auth = await resolveReportAuthorization(updatedUser);
        res.json({ authorization: auth });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  router.get(
    '/reports/photocopy-unit',
    requireAuth,
    requireRoles('super_admin', 'admin_resources', 'kepala_unit'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const period = String(req.query.period || new Date().toISOString().slice(0, 7)); // YYYY-MM
        const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
        const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
        const requestedUnitId = req.query.unitId ? String(req.query.unitId) : 'all';

        if (dateFrom && dateTo && dateFrom > dateTo) {
          res.status(400).json({ error: 'Tanggal awal tidak boleh melebihi tanggal akhir.' });
          return;
        }

        // Strict isolation: Kepala Unit HANYA boleh melihat unit yang ditugaskan kepadanya
        let allowedUnitIds: string[] | null = null;
        if (user.role === 'kepala_unit') {
          allowedUnitIds = user.head_unit_ids;
          if (requestedUnitId !== 'all' && !allowedUnitIds.includes(requestedUnitId)) {
            res.status(403).json({ error: 'Akses ditolak: Anda hanya dapat melihat laporan unit Anda sendiri.' });
            return;
          }
        }

        const report = await buildPhotocopyUnitReport(period, requestedUnitId, allowedUnitIds, user, {
          dateFrom,
          dateTo,
        });
        res.json(report);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  router.post(
    '/reports/photocopy-unit/send',
    requireAuth,
    requireRoles('super_admin', 'admin_resources'),
    async (req: AuthedRequest, res) => {
      try {
        const { period, unitId, forceResend } = req.body as {
          period?: string;
          unitId?: string;
          forceResend?: boolean;
        };
        const targetPeriod = period || new Date().toISOString().slice(0, 7);
        const results = await dispatchMonthlyUnitReports(
          targetPeriod,
          unitId,
          Boolean(forceResend),
          'manual',
          req.lrmsUser
        );
        res.json({ results });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  // Scheduled Cron Endpoint (Vercel Cron / External Scheduler)
  const cronHandler = async (req: Request, res: Response) => {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || '';
    if (cronSecret && auth !== `Bearer ${cronSecret}`) {
      res.status(401).json({ error: 'Unauthorized cron trigger' });
      return;
    }

    // Default mengirim laporan bulan sebelumnya pada tanggal 1
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const period = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
    const results = await dispatchMonthlyUnitReports(period, undefined, false, 'cron');
    res.json({ period, results });
  };
  router.get('/cron/monthly-photocopy-report', cronHandler);
  router.post('/cron/monthly-photocopy-report', cronHandler);

  // 10. General Reports & Analytics (Fotokopi, Laminating, Air Galon & Inventaris)
  router.get(
    '/reports/analytics',
    requireAuth,
    requireRoles('super_admin', 'admin_resources', 'kepala_unit'),
    async (req: AuthedRequest, res) => {
      try {
        const user = req.lrmsUser!;
        const reportType = String(req.query.type || 'usage_by_unit');
        const dateFrom = req.query.dateFrom ? String(req.query.dateFrom) : undefined;
        const dateTo = req.query.dateTo ? String(req.query.dateTo) : undefined;
        const unitId = req.query.unitId ? String(req.query.unitId) : 'all';
        const status = req.query.status ? String(req.query.status) : 'all';

        if (dateFrom && dateTo && dateFrom > dateTo) {
          res.status(400).json({ error: 'Tanggal awal tidak boleh melebihi tanggal akhir.' });
          return;
        }

        if (user.role === 'kepala_unit' && unitId !== 'all' && !user.head_unit_ids.includes(unitId)) {
          res.status(403).json({ error: 'Kepala Unit hanya dapat mengakses laporan unitnya sendiri.' });
          return;
        }

        let orders: OrderRecord[] = [];
        let transactions: Array<{ created_at?: string; [key: string]: unknown }> = [];
        let opnames: Array<{ opname_date?: string; created_at?: string; [key: string]: unknown }> = [];
        let balances: unknown[] = [];

        if (isSupabaseConfigured()) {
          const admin = getSupabaseAdmin()!;
          let oQ = admin
            .from('orders')
            .select('*,units(name),order_items(*)')
            .order('created_at', { ascending: false })
            .limit(500);
          if (user.role === 'kepala_unit') {
            oQ = oQ
              .in('service_type', ['fotokopi', 'laminating', 'galon'])
              .in('unit_id', user.head_unit_ids.length ? user.head_unit_ids : ['00000000-0000-0000-0000-000000000000']);
          }
          if (user.role === 'kepala_unit') {
            const oRes = await oQ;
            orders = (oRes.data || []).map(mapSupabaseOrderRow);
          } else {
            const [oRes, txRes, opnRes, balRes] = await Promise.all([
              oQ,
              admin.from('inventory_transactions').select('*,inventory_locations(name),units(name)').order('created_at', { ascending: false }).limit(300),
              admin.from('inventory_stock_opnames').select('*,inventory_locations(name),inventory_stock_opname_items(*)').order('created_at', { ascending: false }).limit(100),
              admin.from('inventory_balances').select('*,inventory_locations(name)'),
            ]);
            orders = (oRes.data || []).map(mapSupabaseOrderRow);
            transactions = (txRes.data || []) as Array<{ created_at?: string }>;
            opnames = (opnRes.data || []) as Array<{ opname_date?: string; created_at?: string }>;
            balances = balRes.data || [];
          }
        } else {
          const db = loadLocalDb();
          orders =
            user.role === 'kepala_unit'
              ? db.orders.filter(
                  (o) =>
                    ['fotokopi', 'laminating', 'galon'].includes(o.service_type) &&
                    user.head_unit_ids.includes(o.unit_id)
                )
              : db.orders;
          if (user.role !== 'kepala_unit') {
            transactions = db.inventoryTransactions as unknown as Array<{ created_at?: string }>;
            opnames = db.stockOpnames as unknown as Array<{ opname_date?: string; created_at?: string }>;
            balances = db.inventoryBalances;
          }
        }

        if (unitId !== 'all') orders = orders.filter((o) => o.unit_id === unitId);
        if (status !== 'all') orders = orders.filter((o) => o.status === status);
        if (dateFrom) {
          orders = orders.filter((o) => o.created_at.slice(0, 10) >= dateFrom);
          transactions = transactions.filter((t) => String(t.created_at || '').slice(0, 10) >= dateFrom);
          opnames = opnames.filter((op) => String(op.opname_date || op.created_at || '').slice(0, 10) >= dateFrom);
        }
        if (dateTo) {
          orders = orders.filter((o) => o.created_at.slice(0, 10) <= dateTo);
          transactions = transactions.filter((t) => String(t.created_at || '').slice(0, 10) <= dateTo);
          opnames = opnames.filter((op) => String(op.opname_date || op.created_at || '').slice(0, 10) <= dateTo);
        }

        const reportAuthorization = await resolveReportAuthorization(user);

        res.json({
          reportType,
          orders,
          transactions,
          opnames,
          balances,
          reportAuthorization,
        });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    }
  );

  // 11. Notifications & Audit Logs
  router.get('/notifications', requireAuth, async (req: AuthedRequest, res) => {
    try {
      const user = req.lrmsUser!;
      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const { data } = await admin
          .from('notifications')
          .select('id,title,message,category,related_order_id,is_read,created_at')
          .or(`user_id.eq.${user.id},target_role.eq.${user.role}`)
          .order('created_at', { ascending: false })
          .limit(30);
        res.json({ notifications: data || [] });
        return;
      }

      const db = loadLocalDb();
      const list = db.notifications
        .filter((n) => n.user_id === user.id || n.target_role === user.role)
        .slice(0, 30);
      res.json({ notifications: list });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.patch('/notifications/:id/read', requireAuth, async (req: AuthedRequest, res) => {
    const { id } = req.params;
    if (isSupabaseConfigured()) {
      const admin = getSupabaseAdmin()!;
      await admin.from('notifications').update({ is_read: true }).eq('id', id);
      res.json({ success: true });
      return;
    }
    await withLocalLock(async () => {
      const db = loadLocalDb();
      const target = db.notifications.find((n) => n.id === id);
      if (target) target.is_read = true;
      saveLocalDb(db);
    });
    res.json({ success: true });
  });

  router.post('/notifications/read-all', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.lrmsUser!;
    if (isSupabaseConfigured()) {
      const admin = getSupabaseAdmin()!;
      await admin.from('notifications').update({ is_read: true }).or(`user_id.eq.${user.id},target_role.eq.${user.role}`);
      res.json({ success: true });
      return;
    }
    await withLocalLock(async () => {
      const db = loadLocalDb();
      for (const n of db.notifications) {
        if (n.user_id === user.id || n.target_role === user.role) n.is_read = true;
      }
      saveLocalDb(db);
    });
    res.json({ success: true });
  });

  router.get('/audit-logs', requireAuth, requireRoles('super_admin'), async (req: AuthedRequest, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 20)));

      if (isSupabaseConfigured()) {
        const admin = getSupabaseAdmin()!;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const { data, count } = await admin
          .from('audit_logs')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(from, to);
        res.json({ items: data || [], total: count || 0, page, pageSize });
        return;
      }

      const db = loadLocalDb();
      const start = (page - 1) * pageSize;
      res.json({
        items: db.auditLogs.slice(start, start + pageSize),
        total: db.auditLogs.length,
        page,
        pageSize,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  return router;
}

async function resolveReportAuthorization(actor?: UserProfile): Promise<ReportAdminAuthorization> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isActorAdmin = actor && (actor.role === 'admin_resources' || actor.role === 'super_admin');

  if (isSupabaseConfigured()) {
    const admin = getSupabaseAdmin()!;
    const { data: sigRow } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'report_admin_signatures')
      .maybeSingle();
    const sigMap = (sigRow?.value as Record<string, string | null>) || {};

    if (isActorAdmin) {
      const sig = actor.signature_data_url ?? sigMap[actor.email.toLowerCase()] ?? null;
      const hash = crypto.createHash('sha1').update(`${actor.email}:${ym}`).digest('hex').slice(0, 6).toUpperCase();
      return {
        admin_id: actor.id,
        admin_name: actor.full_name,
        admin_email: actor.email,
        admin_role: getRoleLabel(actor.role),
        signature_data_url: sig,
        authorized_at: now.toISOString(),
        authorization_code: `AUTH-LRMS-${ym}-${hash}`,
      };
    }

    const { data: roleRows } = await admin
      .from('user_roles')
      .select('user_id,role')
      .in('role', ['admin_resources', 'super_admin']);
    const sorted = (roleRows || []).sort((a, b) => (a.role === 'admin_resources' ? -1 : b.role === 'admin_resources' ? 1 : 0));
    const chosenId = sorted[0]?.user_id;
    if (chosenId) {
      const { data: prof } = await admin.from('profiles').select('id,full_name,email').eq('id', chosenId).maybeSingle();
      if (prof) {
        const email = String(prof.email || '').toLowerCase();
        const role = (sorted[0]?.role as AppRole) || 'admin_resources';
        const hash = crypto.createHash('sha1').update(`${email}:${ym}`).digest('hex').slice(0, 6).toUpperCase();
        return {
          admin_id: String(prof.id),
          admin_name: String(prof.full_name || 'Admin Resources'),
          admin_email: email,
          admin_role: getRoleLabel(role),
          signature_data_url: sigMap[email] ?? null,
          authorized_at: now.toISOString(),
          authorization_code: `AUTH-LRMS-${ym}-${hash}`,
        };
      }
    }

    return {
      admin_name: 'Admin Divisi Resources',
      admin_email: 'resources@lazuardi.sch.id',
      admin_role: 'Admin Resources',
      signature_data_url: null,
      authorized_at: now.toISOString(),
      authorization_code: `AUTH-LRMS-${ym}-SYS`,
    };
  }

  const db = loadLocalDb();
  let chosen: UserProfile | undefined;
  if (isActorAdmin) {
    chosen = db.users.find((u) => u.id === actor.id) || actor;
  } else {
    // Prioritaskan Admin Resources yang aktif dan sudah memiliki tanda tangan, lalu Admin Resources aktif, lalu Super Admin
    const candidates = db.users.filter((u) => u.is_active && (u.role === 'admin_resources' || u.role === 'super_admin'));
    chosen =
      candidates.find((u) => u.role === 'admin_resources' && u.signature_data_url) ||
      candidates.find((u) => u.role === 'admin_resources') ||
      candidates.find((u) => u.role === 'super_admin');
  }

  const adminName = chosen?.full_name || 'Admin Divisi Resources';
  const adminEmail = chosen?.email || 'resources@lazuardi.sch.id';
  const adminRole = getRoleLabel(chosen?.role || 'admin_resources');
  const hash = crypto.createHash('sha1').update(`${adminEmail}:${ym}`).digest('hex').slice(0, 6).toUpperCase();

  return {
    admin_id: chosen?.id || null,
    admin_name: adminName,
    admin_email: adminEmail,
    admin_role: adminRole,
    signature_data_url: chosen?.signature_data_url || null,
    authorized_at: now.toISOString(),
    authorization_code: `AUTH-LRMS-${ym}-${hash}`,
  };
}

async function buildPhotocopyUnitReport(
  period: string,
  requestedUnitId: string,
  allowedUnitIds: string[] | null,
  actor?: UserProfile,
  dateRange?: { dateFrom?: string; dateTo?: string }
) {
  const dateFrom = dateRange?.dateFrom?.trim() || undefined;
  const dateTo = dateRange?.dateTo?.trim() || undefined;
  const isCustomRange = Boolean(dateFrom || dateTo);

  const matchesTimeRange = (isoDate: string): boolean => {
    if (!isCustomRange) {
      return isoDate.slice(0, 7) === period;
    }
    const day = isoDate.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  };

  let orders: OrderRecord[] = [];
  let deliveryLogs: unknown[] = [];

  if (isSupabaseConfigured()) {
    const admin = getSupabaseAdmin()!;
    let q = admin
      .from('orders')
      .select('*,units(name),order_items(*)')
      .in('service_type', ['fotokopi', 'laminating', 'galon'])
      .neq('status', 'Dibatalkan')
      .order('created_at', { ascending: false })
      .limit(800);

    if (allowedUnitIds) {
      q = q.in('unit_id', allowedUnitIds.length ? allowedUnitIds : ['00000000-0000-0000-0000-000000000000']);
    } else if (requestedUnitId !== 'all') {
      q = q.eq('unit_id', requestedUnitId);
    }

    let logQ = admin
      .from('report_delivery_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);
    if (!isCustomRange) {
      logQ = logQ.eq('report_period', period);
    }
    if (allowedUnitIds) {
      logQ = logQ.in('unit_id', allowedUnitIds.length ? allowedUnitIds : ['00000000-0000-0000-0000-000000000000']);
    }

    const [oRes, lRes] = await Promise.all([q, logQ]);
    orders = (oRes.data || []).map(mapSupabaseOrderRow);
    deliveryLogs = lRes.data || [];
  } else {
    const db = loadLocalDb();
    orders = db.orders.filter((o) => {
      if (o.status === 'Dibatalkan') return false;
      if (allowedUnitIds && !allowedUnitIds.includes(o.unit_id)) return false;
      if (requestedUnitId !== 'all' && o.unit_id !== requestedUnitId) return false;
      return true;
    });
    deliveryLogs = db.reportDeliveryLogs.filter((l) => {
      if (allowedUnitIds && !allowedUnitIds.includes(l.unit_id)) return false;
      if (!isCustomRange) return l.report_period === period;
      const sentDay = l.sent_at.slice(0, 10);
      if (dateFrom && sentDay < dateFrom) return false;
      if (dateTo && sentDay > dateTo) return false;
      return true;
    });
  }

  // 1. Fotokopi
  const fcpOrders = orders.filter((o) => o.service_type === 'fotokopi');
  const monthlySeriesMap = new Map<string, { month: string; sidesBW: number; sidesColor: number; sheets: number }>();
  for (const o of fcpOrders) {
    if (isCustomRange && !matchesTimeRange(o.created_at)) continue;
    const ym = o.created_at.slice(0, 7);
    const cur = monthlySeriesMap.get(ym) || { month: ym, sidesBW: 0, sidesColor: 0, sheets: 0 };
    const sides = o.item.total_print_sides || 0;
    if (o.item.print_color === 'Warna') cur.sidesColor += sides;
    else cur.sidesBW += sides;
    cur.sheets += o.item.total_paper_sheets || 0;
    monthlySeriesMap.set(ym, cur);
  }

  const periodRows = fcpOrders.filter((o) => matchesTimeRange(o.created_at));
  let totalSidesBW = 0;
  let totalSidesColor = 0;
  let totalSheets = 0;
  const requesterMap = new Map<string, { name: string; email: string; orders: number; sides: number; sheets: number }>();

  for (const r of periodRows) {
    const sides = r.item.total_print_sides || 0;
    const sheets = r.item.total_paper_sheets || 0;
    if (r.item.print_color === 'Warna') totalSidesColor += sides;
    else totalSidesBW += sides;
    totalSheets += sheets;

    const reqEntry = requesterMap.get(r.requester_email) || {
      name: r.requester_name,
      email: r.requester_email,
      orders: 0,
      sides: 0,
      sheets: 0,
    };
    reqEntry.orders += 1;
    reqEntry.sides += sides;
    reqEntry.sheets += sheets;
    requesterMap.set(r.requester_email, reqEntry);
  }

  // 2. Laminating
  const lamOrders = orders.filter((o) => o.service_type === 'laminating');
  const lamPeriodRows = lamOrders.filter((o) => matchesTimeRange(o.created_at));
  let lamRequestedSheets = 0;
  let lamActualSheets = 0;
  const lamRequesterMap = new Map<string, { name: string; email: string; orders: number; sheets: number }>();

  for (const r of lamPeriodRows) {
    const reqS = r.item.laminating_sheets || 0;
    const actS = r.item.laminating_actual_sheets ?? r.item.laminating_sheets ?? 0;
    lamRequestedSheets += reqS;
    lamActualSheets += actS;
    const entry = lamRequesterMap.get(r.requester_email) || {
      name: r.requester_name,
      email: r.requester_email,
      orders: 0,
      sheets: 0,
    };
    entry.orders += 1;
    entry.sheets += actS;
    lamRequesterMap.set(r.requester_email, entry);
  }

  // 3. Air Galon
  const galOrders = orders.filter((o) => o.service_type === 'galon');
  const galPeriodRows = galOrders.filter((o) => matchesTimeRange(o.created_at));
  let galRequestedQty = 0;
  let galDeliveredQty = 0;
  let galEmptyReturnedQty = 0;
  const galRequesterMap = new Map<
    string,
    { name: string; email: string; orders: number; requestedQty: number; deliveredQty: number; emptyReturnedQty: number }
  >();

  for (const r of galPeriodRows) {
    const reqQ = r.item.gallon_requested_qty || 0;
    const delQ = r.item.gallon_delivered_qty ?? 0;
    const empQ = r.item.gallon_empty_received_qty ?? 0;
    galRequestedQty += reqQ;
    galDeliveredQty += delQ;
    galEmptyReturnedQty += empQ;

    const entry = galRequesterMap.get(r.requester_email) || {
      name: r.requester_name,
      email: r.requester_email,
      orders: 0,
      requestedQty: 0,
      deliveredQty: 0,
      emptyReturnedQty: 0,
    };
    entry.orders += 1;
    entry.requestedQty += reqQ;
    entry.deliveredQty += delQ;
    entry.emptyReturnedQty += empQ;
    galRequesterMap.set(r.requester_email, entry);
  }

  const reportAuthorization = await resolveReportAuthorization(actor);
  const periodLabel = isCustomRange ? `${dateFrom || 'Awal'} s/d ${dateTo || 'Sekarang'}` : period;

  return {
    period,
    rangeMode: isCustomRange ? 'custom' : 'month',
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    periodLabel,
    summary: {
      totalOrders: periodRows.length,
      totalSidesBW,
      totalSidesColor,
      totalSheets,
    },
    requesterBreakdown: Array.from(requesterMap.values()).sort((a, b) => b.sheets - a.sheets),
    monthlyChart: Array.from(monthlySeriesMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    rows: periodRows,
    laminating: {
      summary: {
        totalOrders: lamPeriodRows.length,
        totalRequestedSheets: lamRequestedSheets,
        totalActualSheets: lamActualSheets,
      },
      requesterBreakdown: Array.from(lamRequesterMap.values()).sort((a, b) => b.sheets - a.sheets),
      rows: lamPeriodRows,
    },
    galon: {
      summary: {
        totalOrders: galPeriodRows.length,
        totalRequestedQty: galRequestedQty,
        totalDeliveredQty: galDeliveredQty,
        totalEmptyReturnedQty: galEmptyReturnedQty,
      },
      requesterBreakdown: Array.from(galRequesterMap.values()).sort((a, b) => b.requestedQty - a.requestedQty),
      rows: galPeriodRows,
    },
    reportAuthorization,
    deliveryLogs,
  };
}

async function dispatchMonthlyUnitReports(
  period: string,
  onlyUnitId: string | undefined,
  forceResend: boolean,
  triggeredBy: 'cron' | 'manual',
  actor?: UserProfile
) {
  const results: Array<{ unitName: string; recipientEmail: string; status: string; message?: string }> = [];

  if (isSupabaseConfigured()) {
    const admin = getSupabaseAdmin()!;
    let uQ = admin.from('units').select('id,name,head_name,head_email').eq('is_active', true);
    if (onlyUnitId) uQ = uQ.eq('id', onlyUnitId);
    const { data: units } = await uQ;

    for (const u of units || []) {
      if (!u.head_email) continue;
      if (!forceResend) {
        const { data: already } = await admin
          .from('report_delivery_logs')
          .select('id')
          .eq('report_period', period)
          .eq('unit_id', u.id)
          .eq('delivery_status', 'SENT')
          .maybeSingle();
        if (already) {
          results.push({
            unitName: u.name as string,
            recipientEmail: u.head_email as string,
            status: 'SKIPPED_DUPLICATE',
            message: 'Laporan periode ini sudah terkirim sebelumnya.',
          });
          continue;
        }
      }

      const report = await buildPhotocopyUnitReport(period, u.id as string, null, actor);
      const sendRes = await sendMonthlyPhotocopyReportEmail({
        recipientEmail: u.head_email as string,
        recipientName: (u.head_name as string) || 'Kepala Unit',
        unitName: u.name as string,
        period,
        totalOrders: report.summary.totalOrders,
        totalSidesBW: report.summary.totalSidesBW,
        totalSidesColor: report.summary.totalSidesColor,
        totalSheets: report.summary.totalSheets,
        requesterBreakdown: report.requesterBreakdown,
        laminatingSummary: {
          totalOrders: report.laminating.summary.totalOrders,
          totalSheets: report.laminating.summary.totalActualSheets,
        },
        galonSummary: {
          totalOrders: report.galon.summary.totalOrders,
          totalRequested: report.galon.summary.totalRequestedQty,
          totalDelivered: report.galon.summary.totalDeliveredQty,
          totalEmptyReturned: report.galon.summary.totalEmptyReturnedQty,
        },
        reportingAdminName: report.reportAuthorization.admin_name,
        reportingAdminEmail: report.reportAuthorization.admin_email,
        reportingAdminRole: report.reportAuthorization.admin_role,
        authorizationCode: report.reportAuthorization.authorization_code,
      });

      await admin.from('report_delivery_logs').insert({
        report_period: period,
        unit_id: u.id,
        unit_name: u.name,
        recipient_email: u.head_email,
        recipient_name: u.head_name,
        total_orders: report.summary.totalOrders,
        total_sides_bw: report.summary.totalSidesBW,
        total_sides_color: report.summary.totalSidesColor,
        total_sheets: report.summary.totalSheets,
        delivery_status: sendRes.success ? 'SENT' : 'FAILED',
        provider_message_id: sendRes.messageId || null,
        error_message: sendRes.error || null,
        triggered_by: triggeredBy,
      });

      results.push({
        unitName: u.name as string,
        recipientEmail: u.head_email as string,
        status: sendRes.success ? 'SENT' : 'FAILED',
        message: sendRes.error,
      });
    }
    return results;
  }

  return withLocalLock(async () => {
    const db = loadLocalDb();
    const targetUnits = db.units.filter((u) => u.is_active && u.head_email && (!onlyUnitId || u.id === onlyUnitId));
    for (const u of targetUnits) {
      const alreadySent = db.reportDeliveryLogs.some(
        (l) => l.report_period === period && l.unit_id === u.id && l.delivery_status === 'SENT'
      );
      if (alreadySent && !forceResend) {
        results.push({
          unitName: u.name,
          recipientEmail: u.head_email,
          status: 'SKIPPED_DUPLICATE',
          message: 'Laporan periode ini sudah terkirim (cegah email ganda).',
        });
        continue;
      }

      const report = await buildPhotocopyUnitReport(period, u.id, null, actor);
      const sendRes = await sendMonthlyPhotocopyReportEmail({
        recipientEmail: u.head_email,
        recipientName: u.head_name || 'Kepala Unit',
        unitName: u.name,
        period,
        totalOrders: report.summary.totalOrders,
        totalSidesBW: report.summary.totalSidesBW,
        totalSidesColor: report.summary.totalSidesColor,
        totalSheets: report.summary.totalSheets,
        requesterBreakdown: report.requesterBreakdown,
        laminatingSummary: {
          totalOrders: report.laminating.summary.totalOrders,
          totalSheets: report.laminating.summary.totalActualSheets,
        },
        galonSummary: {
          totalOrders: report.galon.summary.totalOrders,
          totalRequested: report.galon.summary.totalRequestedQty,
          totalDelivered: report.galon.summary.totalDeliveredQty,
          totalEmptyReturned: report.galon.summary.totalEmptyReturnedQty,
        },
        reportingAdminName: report.reportAuthorization.admin_name,
        reportingAdminEmail: report.reportAuthorization.admin_email,
        reportingAdminRole: report.reportAuthorization.admin_role,
        authorizationCode: report.reportAuthorization.authorization_code,
      });

      db.reportDeliveryLogs.unshift({
        id: `rdl-${crypto.randomUUID()}`,
        report_period: period,
        unit_id: u.id,
        unit_name: u.name,
        recipient_email: u.head_email,
        recipient_name: u.head_name,
        total_orders: report.summary.totalOrders,
        total_sides_bw: report.summary.totalSidesBW,
        total_sides_color: report.summary.totalSidesColor,
        total_sheets: report.summary.totalSheets,
        delivery_status: sendRes.success ? 'SENT' : 'FAILED',
        error_message: sendRes.error || null,
        triggered_by: triggeredBy,
        sent_at: new Date().toISOString(),
      });

      results.push({
        unitName: u.name,
        recipientEmail: u.head_email,
        status: sendRes.success ? 'SENT' : 'FAILED',
        message: sendRes.error,
      });
    }
    saveLocalDb(db);
    return results;
  });
}
