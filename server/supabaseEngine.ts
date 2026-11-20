import crypto from 'crypto';
import type {
  AppRole,
  OrderRecord,
  OrderStatus,
  ServiceType,
  UserProfile,
} from '../src/types/lrms.js';
import { calculatePhotocopyMetrics, isLazuardiEmail } from '../src/utils/calculations.js';
import { getAllowedDomain, getSupabaseAdmin } from './supabaseAdmin.js';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

export async function verifySupabaseUser(authHeader?: string): Promise<UserProfile> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase belum dikonfigurasi');

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    const err = new Error('Sesi tidak ditemukan. Silakan login menggunakan Google SSO @lazuardi.sch.id.');
    (err as Error & { status?: number }).status = 401;
    throw err;
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    const err = new Error('Token autentikasi tidak valid atau telah kedaluwarsa.');
    (err as Error & { status?: number }).status = 401;
    throw err;
  }

  const email = (authData.user.email || '').toLowerCase();
  const allowedDomain = getAllowedDomain();
  if (!isLazuardiEmail(email, allowedDomain)) {
    const err = new Error(`Akses ditolak: hanya akun domain @${allowedDomain} yang diizinkan.`);
    (err as Error & { status?: number }).status = 403;
    throw err;
  }

  const userId = authData.user.id;
  const fullName =
    (authData.user.user_metadata?.full_name as string) ||
    (authData.user.user_metadata?.name as string) ||
    email.split('@')[0];

  // Pastikan profil & role ada (auto-provision 'user' untuk pendaftar valid baru)
  await admin.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: fullName,
      avatar_url: (authData.user.user_metadata?.avatar_url as string) || null,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  await admin
    .from('user_roles')
    .upsert({ user_id: userId, role: 'user' }, { onConflict: 'user_id', ignoreDuplicates: true });

  const [{ data: profile }, { data: roleRow }, { data: assignments }] = await Promise.all([
    admin.from('profiles').select('id,email,full_name,avatar_url,is_active,last_login_at').eq('id', userId).single(),
    admin.from('user_roles').select('role').eq('user_id', userId).single(),
    admin.from('user_unit_assignments').select('unit_id,is_primary,is_unit_head').eq('user_id', userId),
  ]);

  if (profile && !profile.is_active) {
    const err = new Error('Akun Anda dinonaktifkan. Hubungi Super Admin Divisi Resources.');
    (err as Error & { status?: number }).status = 403;
    throw err;
  }

  const unitIds = (assignments || []).map((a) => a.unit_id as string);
  const primaryUnit = (assignments || []).find((a) => a.is_primary)?.unit_id as string | undefined;
  const headUnitIds = (assignments || []).filter((a) => a.is_unit_head).map((a) => a.unit_id as string);

  // Sinkronisasi otomatis Kepala Unit berdasarkan head_email pada tabel units
  const { data: headUnitsByEmail } = await admin
    .from('units')
    .select('id')
    .eq('head_email', email)
    .eq('is_active', true);

  for (const hu of headUnitsByEmail || []) {
    if (!headUnitIds.includes(hu.id as string)) {
      headUnitIds.push(hu.id as string);
    }
    if (!unitIds.includes(hu.id as string)) {
      unitIds.push(hu.id as string);
    }
  }

  return {
    id: userId,
    email,
    full_name: profile?.full_name || fullName,
    avatar_url: profile?.avatar_url || null,
    role: ((roleRow?.role as AppRole) || 'user'),
    is_active: profile?.is_active ?? true,
    last_login_at: profile?.last_login_at || new Date().toISOString(),
    unit_ids: unitIds,
    primary_unit_id: primaryUnit || unitIds[0] || null,
    head_unit_ids: headUnitIds,
  };
}

export async function sbGetMasterData(user: UserProfile) {
  const admin = getSupabaseAdmin()!;
  const isAdmin = user.role === 'super_admin' || user.role === 'admin_resources';

  const [unitsRes, servicesRes, locationsRes, invLocRes, settingsRes] = await Promise.all([
    admin.from('units').select('id,code,name,category,head_name,head_email,is_active').order('name'),
    admin.from('service_catalog').select('id,code,service_type,name,description,estimated_sla_minutes,is_active').order('code'),
    admin.from('locations').select('id,building,floor,room,unit_id,is_active,units(name)').order('building'),
    admin.from('inventory_locations').select('id,code,name,building,is_default,is_active').order('code'),
    admin.from('app_settings').select('key,value'),
  ]);

  let users: UserProfile[] = [];
  if (isAdmin) {
    const [profRes, rolesRes, assignRes] = await Promise.all([
      admin.from('profiles').select('id,email,full_name,avatar_url,is_active,last_login_at').order('full_name'),
      admin.from('user_roles').select('user_id,role'),
      admin.from('user_unit_assignments').select('user_id,unit_id,is_primary,is_unit_head'),
    ]);
    const roleMap = new Map<string, AppRole>();
    for (const r of rolesRes.data || []) roleMap.set(r.user_id as string, r.role as AppRole);

    users = (profRes.data || []).map((p) => {
      const uAssign = (assignRes.data || []).filter((a) => a.user_id === p.id);
      return {
        id: p.id as string,
        email: p.email as string,
        full_name: p.full_name as string,
        avatar_url: p.avatar_url as string | null,
        role: roleMap.get(p.id as string) || 'user',
        is_active: Boolean(p.is_active),
        last_login_at: p.last_login_at as string | null,
        unit_ids: uAssign.map((a) => a.unit_id as string),
        primary_unit_id: (uAssign.find((a) => a.is_primary)?.unit_id as string) || uAssign[0]?.unit_id || null,
        head_unit_ids: uAssign.filter((a) => a.is_unit_head).map((a) => a.unit_id as string),
      };
    });
  }

  const settingsObj: Record<string, unknown> = {};
  for (const s of settingsRes.data || []) {
    settingsObj[s.key as string] = s.value;
  }

  return {
    units: unitsRes.data || [],
    services: servicesRes.data || [],
    locations: (locationsRes.data || []).map((l: Record<string, unknown>) => ({
      id: l.id,
      building: l.building,
      floor: l.floor,
      room: l.room,
      unit_id: l.unit_id,
      unit_name: (l.units as { name?: string } | null)?.name || '-',
      is_active: l.is_active,
    })),
    inventoryLocations: invLocRes.data || [],
    settings: {
      allowed_email_domain: String(settingsObj.allowed_email_domain ?? 'lazuardi.sch.id').replace(/"/g, ''),
      gallon_min_stock: Number(settingsObj.gallon_min_stock ?? 15),
      file_retention_days: Number(settingsObj.file_retention_days ?? 90),
      monthly_report_day: Number(settingsObj.monthly_report_day ?? 1),
    },
    users,
  };
}

export async function sbListOrders(
  user: UserProfile,
  params: {
    page: number;
    pageSize: number;
    serviceType?: string;
    status?: string;
    unitId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    mineOnly?: boolean;
  }
) {
  const admin = getSupabaseAdmin()!;
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;

  let query = admin
    .from('orders')
    .select(
      `id,order_number,service_type,requester_id,requester_name,requester_email,unit_id,location_id,location_label,status,needed_date,needed_time,notes,internal_notes,cancel_reason,assigned_staff_id,assigned_staff_name,created_at,updated_at,processed_at,completed_at,cancelled_at,
       units(name),
       order_items(*),
       order_attachments(id,order_id,file_name,mime_type,file_size_bytes,storage_path,created_at)`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (params.mineOnly || user.role === 'user') {
    query = query.eq('requester_id', user.id);
  } else if (user.role === 'kepala_unit') {
    if (user.head_unit_ids.length === 0) {
      query = query.eq('requester_id', user.id);
    } else {
      query = query.or(
        `requester_id.eq.${user.id},and(service_type.eq.fotokopi,unit_id.in.(${user.head_unit_ids.join(',')}))`
      );
    }
  }

  if (params.serviceType && params.serviceType !== 'all') {
    query = query.eq('service_type', params.serviceType);
  }
  if (params.status && params.status !== 'all') {
    query = query.eq('status', params.status);
  }
  if (params.unitId && params.unitId !== 'all') {
    query = query.eq('unit_id', params.unitId);
  }
  if (params.dateFrom) {
    query = query.gte('needed_date', params.dateFrom);
  }
  if (params.dateTo) {
    query = query.lte('needed_date', params.dateTo);
  }
  if (params.search) {
    query = query.or(
      `order_number.ilike.%${params.search}%,requester_name.ilike.%${params.search}%`
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const mapped: OrderRecord[] = (data || []).map(mapSupabaseOrderRow);
  return {
    items: mapped,
    total: count || 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export function mapSupabaseOrderRow(row: Record<string, unknown>): OrderRecord {
  const itemArr = (row.order_items as Array<Record<string, unknown>>) || [];
  const item = itemArr[0] || {};
  return {
    id: row.id as string,
    order_number: row.order_number as string,
    service_type: row.service_type as ServiceType,
    requester_id: row.requester_id as string,
    requester_name: row.requester_name as string,
    requester_email: row.requester_email as string,
    unit_id: row.unit_id as string,
    unit_name: ((row.units as { name?: string } | null)?.name) || '-',
    location_id: (row.location_id as string) || null,
    location_label: (row.location_label as string) || null,
    status: row.status as OrderStatus,
    needed_date: row.needed_date as string,
    needed_time: (row.needed_time as string) || null,
    notes: (row.notes as string) || null,
    internal_notes: (row.internal_notes as string) || null,
    cancel_reason: (row.cancel_reason as string) || null,
    assigned_staff_id: (row.assigned_staff_id as string) || null,
    assigned_staff_name: (row.assigned_staff_name as string) || null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    processed_at: (row.processed_at as string) || null,
    completed_at: (row.completed_at as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    item: {
      gallon_requested_qty: item.gallon_requested_qty as number | null,
      gallon_empty_return_planned: item.gallon_empty_return_planned as number | null,
      gallon_delivered_qty: item.gallon_delivered_qty as number | null,
      gallon_empty_received_qty: item.gallon_empty_received_qty as number | null,
      document_name: item.document_name as string | null,
      page_count: item.page_count as number | null,
      copy_count: item.copy_count as number | null,
      paper_size: item.paper_size as string | null,
      print_color: item.print_color as 'Hitam Putih' | 'Warna' | null,
      print_sides: item.print_sides as 'satu_sisi' | 'dua_sisi' | null,
      finishing_notes: item.finishing_notes as string | null,
      actual_page_count: item.actual_page_count as number | null,
      actual_copy_count: item.actual_copy_count as number | null,
      total_print_sides: item.total_print_sides as number | null,
      total_paper_sheets: item.total_paper_sheets as number | null,
      laminating_size: item.laminating_size as string | null,
      laminating_type: item.laminating_type as string | null,
      laminating_sheets: item.laminating_sheets as number | null,
      laminating_actual_sheets: item.laminating_actual_sheets as number | null,
    },
    attachments: (row.order_attachments as OrderRecord['attachments']) || [],
  };
}

export async function sbCreateOrder(user: UserProfile, body: Record<string, unknown>) {
  const admin = getSupabaseAdmin()!;
  const serviceType = body.service_type as ServiceType;
  if (!['galon', 'fotokopi', 'laminating'].includes(serviceType)) {
    throw new Error('Jenis layanan tidak valid');
  }

  const { data: orderNumber, error: numErr } = await admin.rpc('generate_order_number', {
    p_service_type: serviceType,
  });
  if (numErr || !orderNumber) {
    throw new Error(numErr?.message || 'Gagal membuat nomor order');
  }

  let locationLabel = (body.location_label as string) || null;
  if (body.location_id) {
    const { data: loc } = await admin
      .from('locations')
      .select('building,floor,room')
      .eq('id', body.location_id as string)
      .single();
    if (loc) {
      locationLabel = `${loc.building} · ${loc.floor} · ${loc.room}`;
    }
  }

  const { data: orderRow, error: orderErr } = await admin
    .from('orders')
    .insert({
      order_number: orderNumber,
      service_type: serviceType,
      requester_id: user.id,
      requester_name: user.full_name,
      requester_email: user.email,
      unit_id: body.unit_id,
      location_id: body.location_id || null,
      location_label: locationLabel,
      status: 'Menunggu Diproses',
      needed_date: body.needed_date,
      needed_time: body.needed_time || null,
      notes: body.notes || null,
    })
    .select('id,order_number')
    .single();

  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message || 'Gagal menyimpan order');
  }

  const itemPayload: Record<string, unknown> = { order_id: orderRow.id };
  if (serviceType === 'galon') {
    itemPayload.gallon_requested_qty = Number(body.gallon_requested_qty);
    itemPayload.gallon_empty_return_planned = Number(body.gallon_empty_return_planned || 0);
  } else if (serviceType === 'fotokopi') {
    const calc = calculatePhotocopyMetrics(
      Number(body.page_count),
      Number(body.copy_count),
      (body.print_sides as 'satu_sisi' | 'dua_sisi') || 'satu_sisi'
    );
    itemPayload.document_name = body.document_name;
    itemPayload.page_count = calc.pageCount;
    itemPayload.copy_count = calc.copyCount;
    itemPayload.paper_size = body.paper_size || 'A4';
    itemPayload.print_color = body.print_color || 'Hitam Putih';
    itemPayload.print_sides = calc.printSide;
    itemPayload.finishing_notes = body.finishing_notes || null;
    itemPayload.total_print_sides = calc.totalPrintSides;
    itemPayload.total_paper_sheets = calc.totalPaperSheets;
  } else if (serviceType === 'laminating') {
    itemPayload.document_name = body.document_name;
    itemPayload.laminating_size = body.laminating_size || 'A4';
    itemPayload.laminating_type = body.laminating_type || 'Glossy 100 Micron';
    itemPayload.laminating_sheets = Number(body.laminating_sheets);
  }

  const { error: itemErr } = await admin.from('order_items').insert(itemPayload);
  if (itemErr) throw new Error(itemErr.message);

  await admin.from('order_status_history').insert({
    order_id: orderRow.id,
    from_status: null,
    to_status: 'Menunggu Diproses',
    changed_by: user.id,
    changed_by_name: user.full_name,
    note: 'Order dibuat dan masuk antrean Divisi Resources',
  });

  await admin.from('notifications').insert([
    {
      user_id: user.id,
      title: 'Order Berhasil Dibuat',
      message: `Order ${orderNumber} telah masuk antrean Divisi Resources.`,
      category: 'order',
      related_order_id: orderRow.id,
    },
    {
      target_role: 'admin_resources',
      title: 'Order Baru Masuk',
      message: `Order ${orderNumber} oleh ${user.full_name} menunggu diproses.`,
      category: 'order',
      related_order_id: orderRow.id,
    },
  ]);

  return orderRow;
}

export async function sbUploadAttachment(
  user: UserProfile,
  orderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
) {
  const admin = getSupabaseAdmin()!;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('Tipe file tidak didukung. Gunakan PDF, DOC/DOCX, PNG, atau JPG.');
  }
  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error('Ukuran file maksimal 25 MB.');
  }

  const { data: order } = await admin
    .from('orders')
    .select('id,requester_id,order_number')
    .eq('id', orderId)
    .single();
  if (!order) throw new Error('Order tidak ditemukan');
  if (order.requester_id !== user.id && user.role !== 'super_admin' && user.role !== 'admin_resources') {
    throw new Error('Tidak memiliki izin mengunggah dokumen ke order ini');
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${order.order_number}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;

  const { error: uploadErr } = await admin.storage
    .from('order-documents')
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) throw new Error(`Gagal upload ke private bucket: ${uploadErr.message}`);

  const { data: att, error: dbErr } = await admin
    .from('order_attachments')
    .insert({
      order_id: orderId,
      storage_bucket: 'order-documents',
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      file_size_bytes: buffer.length,
      uploaded_by: user.id,
    })
    .select('*')
    .single();

  if (dbErr) throw new Error(dbErr.message);
  return att;
}

export async function sbGetAttachmentSignedUrl(
  user: UserProfile,
  orderId: string,
  attachmentId: string
): Promise<string> {
  const admin = getSupabaseAdmin()!;
  const [{ data: order }, { data: att }] = await Promise.all([
    admin.from('orders').select('id,requester_id').eq('id', orderId).single(),
    admin.from('order_attachments').select('id,storage_path,order_id').eq('id', attachmentId).single(),
  ]);

  if (!order || !att || att.order_id !== orderId) {
    throw new Error('Dokumen tidak ditemukan');
  }

  const authorized =
    order.requester_id === user.id || user.role === 'super_admin' || user.role === 'admin_resources';
  if (!authorized) {
    throw new Error('Akses dokumen ditolak: hanya pemesan dan petugas berwenang yang diizinkan.');
  }

  const { data, error } = await admin.storage
    .from('order-documents')
    .createSignedUrl(att.storage_path as string, 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Gagal membuat signed URL');
  }
  return data.signedUrl;
}
