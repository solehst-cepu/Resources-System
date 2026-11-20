import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type {
  AppNotification,
  AppRole,
  AppSettingsMap,
  AuditLogRecord,
  GallonStockKind,
  InventoryAdjustment,
  InventoryBalance,
  InventoryLocation,
  InventoryReceipt,
  InventoryTransaction,
  LocationItem,
  OrderAttachment,
  OrderRecord,
  OrderStatus,
  ReportDeliveryLog,
  ServiceCatalogItem,
  ServiceType,
  StockOpnameLine,
  StockOpnameRecord,
  Unit,
  UserProfile,
} from '../src/types/lrms.js';
import { calculatePhotocopyMetrics } from '../src/utils/calculations.js';

export interface LocalDatabaseState {
  users: UserProfile[];
  units: Unit[];
  services: ServiceCatalogItem[];
  locations: LocationItem[];
  settings: AppSettingsMap;
  orderSequences: Record<string, number>;
  orders: OrderRecord[];
  inventoryLocations: InventoryLocation[];
  inventoryBalances: InventoryBalance[];
  inventoryTransactions: InventoryTransaction[];
  inventoryReceipts: InventoryReceipt[];
  stockOpnames: StockOpnameRecord[];
  inventoryAdjustments: InventoryAdjustment[];
  reportDeliveryLogs: ReportDeliveryLog[];
  notifications: Array<AppNotification & { user_id?: string | null; target_role?: AppRole | null }>;
  auditLogs: AuditLogRecord[];
}

const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'lrms-data')
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'lrms-store.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Mutex antrean sederhana agar operasi stok & nomor order bersifat atomic
let txQueue: Promise<void> = Promise.resolve();

export function withLocalLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = txQueue.then(fn, fn);
  txQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function createInitialState(): LocalDatabaseState {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgoStr = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);

  const units: Unit[] = [
    {
      id: 'unit-tk',
      code: 'TK-LAZ',
      name: 'TK Lazuardi',
      category: 'Akademik',
      head_name: 'Rina Kartika, S.Pd',
      head_email: 'rina.kartika@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-sd',
      code: 'SD-LAZ',
      name: 'SD Lazuardi',
      category: 'Akademik',
      head_name: 'Ahmad Fauzan, M.Pd',
      head_email: 'ahmad.fauzan@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-smp',
      code: 'SMP-LAZ',
      name: 'SMP Lazuardi',
      category: 'Akademik',
      head_name: 'Dian Permata, M.Pd',
      head_email: 'dian.permata@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-sma',
      code: 'SMA-LAZ',
      name: 'SMA Lazuardi',
      category: 'Akademik',
      head_name: 'Hendra Wijaya, M.Si',
      head_email: 'hendra.wijaya@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-res',
      code: 'RES-LAZ',
      name: 'Divisi Resources',
      category: 'Operasional',
      head_name: 'Soleh Santoso',
      head_email: 'soleh.st@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-yys',
      code: 'YYS-LAZ',
      name: 'Yayasan & Manajemen',
      category: 'Manajemen',
      head_name: 'Nadia Kusuma',
      head_email: 'nadia.kusuma@lazuardi.sch.id',
      is_active: true,
    },
    {
      id: 'unit-fin',
      code: 'FIN-LAZ',
      name: 'Keuangan & HR',
      category: 'Penunjang',
      head_name: 'Ratna Dewi',
      head_email: 'ratna.dewi@lazuardi.sch.id',
      is_active: true,
    },
  ];

  const users: UserProfile[] = [
    {
      id: 'usr-super-1',
      email: 'soleh.st@lazuardi.sch.id',
      full_name: 'Soleh Santoso',
      role: 'super_admin',
      is_active: true,
      last_login_at: now.toISOString(),
      unit_ids: ['unit-res'],
      primary_unit_id: 'unit-res',
      head_unit_ids: ['unit-res'],
    },
    {
      id: 'usr-admin-1',
      email: 'petugas.resources@lazuardi.sch.id',
      full_name: 'Budi Hermawan',
      role: 'admin_resources',
      is_active: true,
      last_login_at: new Date(now.getTime() - 3600000).toISOString(),
      unit_ids: ['unit-res'],
      primary_unit_id: 'unit-res',
      head_unit_ids: [],
    },
    {
      id: 'usr-head-sd',
      email: 'ahmad.fauzan@lazuardi.sch.id',
      full_name: 'Ahmad Fauzan, M.Pd',
      role: 'kepala_unit',
      is_active: true,
      last_login_at: new Date(now.getTime() - 7200000).toISOString(),
      unit_ids: ['unit-sd'],
      primary_unit_id: 'unit-sd',
      head_unit_ids: ['unit-sd'],
    },
    {
      id: 'usr-guru-sd',
      email: 'siti.aminah@lazuardi.sch.id',
      full_name: 'Siti Aminah, S.Pd',
      role: 'user',
      is_active: true,
      last_login_at: new Date(now.getTime() - 10800000).toISOString(),
      unit_ids: ['unit-sd'],
      primary_unit_id: 'unit-sd',
      head_unit_ids: [],
    },
    {
      id: 'usr-guru-smp',
      email: 'rizky.akbar@lazuardi.sch.id',
      full_name: 'Rizky Akbar, M.Pd',
      role: 'user',
      is_active: true,
      last_login_at: new Date(now.getTime() - 14400000).toISOString(),
      unit_ids: ['unit-smp'],
      primary_unit_id: 'unit-smp',
      head_unit_ids: [],
    },
  ];

  const services: ServiceCatalogItem[] = [
    {
      id: 'srv-gal',
      code: 'SRV-GAL',
      service_type: 'galon',
      name: 'Air Galon',
      description: 'Pengiriman air mineral galon 19L dan penukaran galon kosong antar unit sekolah.',
      estimated_sla_minutes: 45,
      is_active: true,
    },
    {
      id: 'srv-fcp',
      code: 'SRV-FCP',
      service_type: 'fotokopi',
      name: 'Fotokopi',
      description: 'Penggandaan modul ajar, lembar ujian, dan dokumen resmi (Hitam Putih / Warna).',
      estimated_sla_minutes: 120,
      is_active: true,
    },
    {
      id: 'srv-lam',
      code: 'SRV-LAM',
      service_type: 'laminating',
      name: 'Laminating',
      description: 'Pelapisan dokumen pembelajaran, sertifikat, dan ID Card berbagai ukuran.',
      estimated_sla_minutes: 90,
      is_active: true,
    },
  ];

  const locations: LocationItem[] = [
    { id: 'loc-1', building: 'Gedung SD', floor: 'Lantai 1', room: 'Ruang Guru SD', unit_id: 'unit-sd', unit_name: 'SD Lazuardi', is_active: true },
    { id: 'loc-2', building: 'Gedung SD', floor: 'Lantai 2', room: 'Tata Usaha SD', unit_id: 'unit-sd', unit_name: 'SD Lazuardi', is_active: true },
    { id: 'loc-3', building: 'Gedung TK', floor: 'Lantai 1', room: 'Ruang Sentra TK', unit_id: 'unit-tk', unit_name: 'TK Lazuardi', is_active: true },
    { id: 'loc-4', building: 'Gedung SMP/SMA', floor: 'Lantai 1', room: 'Ruang Guru SMP', unit_id: 'unit-smp', unit_name: 'SMP Lazuardi', is_active: true },
    { id: 'loc-5', building: 'Gedung SMP/SMA', floor: 'Lantai 2', room: 'Ruang Guru SMA', unit_id: 'unit-sma', unit_name: 'SMA Lazuardi', is_active: true },
    { id: 'loc-6', building: 'Gedung Utama', floor: 'Lantai 2', room: 'Ruang Yayasan & Pimpinan', unit_id: 'unit-yys', unit_name: 'Yayasan & Manajemen', is_active: true },
    { id: 'loc-7', building: 'Gedung Operasional', floor: 'Lantai 1', room: 'Loket Divisi Resources', unit_id: 'unit-res', unit_name: 'Divisi Resources', is_active: true },
  ];

  const inventoryLocations: InventoryLocation[] = [
    { id: 'invloc-main', code: 'GUD-UTAMA', name: 'Gudang Utama Resources', building: 'Gedung Operasional', is_default: true, is_active: true },
    { id: 'invloc-sd', code: 'PNT-SD', name: 'Pantry Lantai 1 SD', building: 'Gedung SD', is_default: false, is_active: true },
    { id: 'invloc-mid', code: 'PNT-SMPSMA', name: 'Pantry Gedung Menengah', building: 'Gedung SMP/SMA', is_default: false, is_active: true },
  ];

  const inventoryBalances: InventoryBalance[] = [
    {
      id: 'bal-main',
      location_id: 'invloc-main',
      location_code: 'GUD-UTAMA',
      location_name: 'Gudang Utama Resources',
      building: 'Gedung Operasional',
      qty_filled: 38,
      qty_empty: 16,
      qty_damaged: 2,
      qty_lost: 0,
      updated_at: now.toISOString(),
    },
    {
      id: 'bal-sd',
      location_id: 'invloc-sd',
      location_code: 'PNT-SD',
      location_name: 'Pantry Lantai 1 SD',
      building: 'Gedung SD',
      qty_filled: 11,
      qty_empty: 5,
      qty_damaged: 0,
      qty_lost: 0,
      updated_at: now.toISOString(),
    },
    {
      id: 'bal-mid',
      location_id: 'invloc-mid',
      location_code: 'PNT-SMPSMA',
      location_name: 'Pantry Gedung Menengah',
      building: 'Gedung SMP/SMA',
      qty_filled: 9,
      qty_empty: 4,
      qty_damaged: 1,
      qty_lost: 0,
      updated_at: now.toISOString(),
    },
  ];

  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fcp1 = calculatePhotocopyMetrics(11, 28, 'dua_sisi');
  const fcp2 = calculatePhotocopyMetrics(4, 35, 'satu_sisi');
  const fcp3 = calculatePhotocopyMetrics(18, 12, 'dua_sisi');

  const orders: OrderRecord[] = [
    {
      id: 'ord-gal-1',
      order_number: `GAL-${ym}-0001`,
      service_type: 'galon',
      requester_id: 'usr-guru-sd',
      requester_name: 'Siti Aminah, S.Pd',
      requester_email: 'siti.aminah@lazuardi.sch.id',
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      location_id: 'loc-1',
      location_label: 'Gedung SD · Lantai 1 · Ruang Guru SD',
      status: 'Selesai',
      needed_date: twoDaysAgoStr,
      needed_time: '08:30',
      notes: 'Mohon dikirim sebelum jam istirahat pertama.',
      assigned_staff_id: 'usr-admin-1',
      assigned_staff_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
      updated_at: new Date(now.getTime() - 2 * 86400000 + 3600000).toISOString(),
      processed_at: new Date(now.getTime() - 2 * 86400000 + 900000).toISOString(),
      completed_at: new Date(now.getTime() - 2 * 86400000 + 3600000).toISOString(),
      item: {
        gallon_requested_qty: 3,
        gallon_empty_return_planned: 3,
        gallon_delivered_qty: 3,
        gallon_empty_received_qty: 3,
      },
      history: [
        {
          id: 'hist-1',
          order_id: 'ord-gal-1',
          from_status: null,
          to_status: 'Menunggu Diproses',
          changed_by_name: 'Siti Aminah, S.Pd',
          note: 'Order dibuat oleh pemesan',
          created_at: new Date(now.getTime() - 2 * 86400000).toISOString(),
        },
        {
          id: 'hist-2',
          order_id: 'ord-gal-1',
          from_status: 'Menunggu Diproses',
          to_status: 'Selesai',
          changed_by_name: 'Budi Hermawan',
          note: 'Dikirim 3 galon isi, diterima 3 galon kosong.',
          created_at: new Date(now.getTime() - 2 * 86400000 + 3600000).toISOString(),
        },
      ],
    },
    {
      id: 'ord-gal-2',
      order_number: `GAL-${ym}-0002`,
      service_type: 'galon',
      requester_id: 'usr-guru-smp',
      requester_name: 'Rizky Akbar, M.Pd',
      requester_email: 'rizky.akbar@lazuardi.sch.id',
      unit_id: 'unit-smp',
      unit_name: 'SMP Lazuardi',
      location_id: 'loc-4',
      location_label: 'Gedung SMP/SMA · Lantai 1 · Ruang Guru SMP',
      status: 'Menunggu Diproses',
      needed_date: todayStr,
      needed_time: '10:00',
      notes: 'Dispenser ruang guru selatan sudah kosong.',
      created_at: new Date(now.getTime() - 3600000).toISOString(),
      updated_at: new Date(now.getTime() - 3600000).toISOString(),
      item: {
        gallon_requested_qty: 2,
        gallon_empty_return_planned: 2,
      },
      history: [
        {
          id: 'hist-3',
          order_id: 'ord-gal-2',
          from_status: null,
          to_status: 'Menunggu Diproses',
          changed_by_name: 'Rizky Akbar, M.Pd',
          note: 'Order dibuat oleh pemesan',
          created_at: new Date(now.getTime() - 3600000).toISOString(),
        },
      ],
    },
    {
      id: 'ord-fcp-1',
      order_number: `FCP-${ym}-0001`,
      service_type: 'fotokopi',
      requester_id: 'usr-guru-sd',
      requester_name: 'Siti Aminah, S.Pd',
      requester_email: 'siti.aminah@lazuardi.sch.id',
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      location_id: 'loc-1',
      location_label: 'Gedung SD · Lantai 1 · Ruang Guru SD',
      status: 'Selesai',
      needed_date: yesterdayStr,
      notes: 'Mohon distaples di pojok kiri atas.',
      assigned_staff_id: 'usr-admin-1',
      assigned_staff_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 86400000).toISOString(),
      updated_at: new Date(now.getTime() - 72000000).toISOString(),
      completed_at: new Date(now.getTime() - 72000000).toISOString(),
      item: {
        document_name: 'Modul Tematik Kelas 4 Bab Ekosistem',
        page_count: 11,
        copy_count: 28,
        paper_size: 'A4',
        print_color: 'Hitam Putih',
        print_sides: 'dua_sisi',
        finishing_notes: 'Staples pojok kiri atas',
        actual_page_count: 11,
        actual_copy_count: 28,
        total_print_sides: fcp1.totalPrintSides,
        total_paper_sheets: fcp1.totalPaperSheets,
      },
      history: [
        {
          id: 'hist-4',
          order_id: 'ord-fcp-1',
          from_status: null,
          to_status: 'Menunggu Diproses',
          changed_by_name: 'Siti Aminah, S.Pd',
          note: 'Order dibuat oleh pemesan',
          created_at: new Date(now.getTime() - 86400000).toISOString(),
        },
        {
          id: 'hist-5',
          order_id: 'ord-fcp-1',
          from_status: 'Menunggu Diproses',
          to_status: 'Selesai',
          changed_by_name: 'Budi Hermawan',
          note: 'Sudah diserahkan ke Ruang Guru SD',
          created_at: new Date(now.getTime() - 72000000).toISOString(),
        },
      ],
    },
    {
      id: 'ord-fcp-2',
      order_number: `FCP-${ym}-0002`,
      service_type: 'fotokopi',
      requester_id: 'usr-head-sd',
      requester_name: 'Ahmad Fauzan, M.Pd',
      requester_email: 'ahmad.fauzan@lazuardi.sch.id',
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      location_id: 'loc-2',
      location_label: 'Gedung SD · Lantai 2 · Tata Usaha SD',
      status: 'Diproses',
      needed_date: todayStr,
      notes: 'Undangan rapat komite orang tua murid.',
      assigned_staff_id: 'usr-admin-1',
      assigned_staff_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 5400000).toISOString(),
      updated_at: new Date(now.getTime() - 1800000).toISOString(),
      processed_at: new Date(now.getTime() - 1800000).toISOString(),
      item: {
        document_name: 'Surat Undangan & Agenda Komite SD',
        page_count: 4,
        copy_count: 35,
        paper_size: 'F4',
        print_color: 'Warna',
        print_sides: 'satu_sisi',
        finishing_notes: 'Lipat tiga rapi',
        total_print_sides: fcp2.totalPrintSides,
        total_paper_sheets: fcp2.totalPaperSheets,
      },
      history: [
        {
          id: 'hist-6',
          order_id: 'ord-fcp-2',
          from_status: null,
          to_status: 'Menunggu Diproses',
          changed_by_name: 'Ahmad Fauzan, M.Pd',
          note: 'Order dibuat oleh pemesan',
          created_at: new Date(now.getTime() - 5400000).toISOString(),
        },
        {
          id: 'hist-7',
          order_id: 'ord-fcp-2',
          from_status: 'Menunggu Diproses',
          to_status: 'Diproses',
          changed_by_name: 'Budi Hermawan',
          note: 'Sedang dicetak warna di mesin produksi',
          created_at: new Date(now.getTime() - 1800000).toISOString(),
        },
      ],
    },
    {
      id: 'ord-fcp-3',
      order_number: `FCP-${ym}-0003`,
      service_type: 'fotokopi',
      requester_id: 'usr-guru-smp',
      requester_name: 'Rizky Akbar, M.Pd',
      requester_email: 'rizky.akbar@lazuardi.sch.id',
      unit_id: 'unit-smp',
      unit_name: 'SMP Lazuardi',
      location_id: 'loc-4',
      location_label: 'Gedung SMP/SMA · Lantai 1 · Ruang Guru SMP',
      status: 'Siap Diambil',
      needed_date: todayStr,
      notes: 'Lembar kerja praktikum IPA.',
      assigned_staff_id: 'usr-admin-1',
      assigned_staff_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 10800000).toISOString(),
      updated_at: new Date(now.getTime() - 1200000).toISOString(),
      processed_at: new Date(now.getTime() - 7200000).toISOString(),
      item: {
        document_name: 'LKS Praktikum Fisika Terpadu SMP',
        page_count: 18,
        copy_count: 12,
        paper_size: 'A4',
        print_color: 'Hitam Putih',
        print_sides: 'dua_sisi',
        finishing_notes: 'Jilid lakban hitam',
        actual_page_count: 18,
        actual_copy_count: 12,
        total_print_sides: fcp3.totalPrintSides,
        total_paper_sheets: fcp3.totalPaperSheets,
      },
      history: [],
    },
    {
      id: 'ord-lam-1',
      order_number: `LAM-${ym}-0001`,
      service_type: 'laminating',
      requester_id: 'usr-guru-sd',
      requester_name: 'Siti Aminah, S.Pd',
      requester_email: 'siti.aminah@lazuardi.sch.id',
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      location_id: 'loc-1',
      location_label: 'Gedung SD · Lantai 1 · Ruang Guru SD',
      status: 'Menunggu Diproses',
      needed_date: todayStr,
      notes: 'Kartu piket siswa dan jadwal pelajaran.',
      created_at: new Date(now.getTime() - 2400000).toISOString(),
      updated_at: new Date(now.getTime() - 2400000).toISOString(),
      item: {
        document_name: 'Kartu Piket Kelas & Poster Tata Tertib',
        laminating_size: 'A4',
        laminating_type: 'Glossy 100 Micron',
        laminating_sheets: 15,
      },
      history: [],
    },
  ];

  const inventoryTransactions: InventoryTransaction[] = [
    {
      id: 'tx-1',
      location_id: 'invloc-main',
      location_name: 'Gudang Utama Resources',
      transaction_type: 'RECEIPT',
      stock_kind: 'isi',
      qty_delta: 41,
      balance_after: 41,
      reference_type: 'receipt',
      reference_number: `RCV-${ym}-0001`,
      notes: 'Pengisian stok mingguan supplier Aqua/Lazuardi',
      created_by_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
    {
      id: 'tx-2',
      location_id: 'invloc-main',
      location_name: 'Gudang Utama Resources',
      transaction_type: 'DISTRIBUTION',
      stock_kind: 'isi',
      qty_delta: -3,
      balance_after: 38,
      reference_type: 'order',
      reference_number: `GAL-${ym}-0001`,
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      notes: 'Pengiriman galon isi ke Ruang Guru SD',
      created_by_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 2 * 86400000 + 3600000).toISOString(),
    },
    {
      id: 'tx-3',
      location_id: 'invloc-main',
      location_name: 'Gudang Utama Resources',
      transaction_type: 'EMPTY_RETURN',
      stock_kind: 'kosong',
      qty_delta: 3,
      balance_after: 16,
      reference_type: 'order',
      reference_number: `GAL-${ym}-0001`,
      unit_id: 'unit-sd',
      unit_name: 'SD Lazuardi',
      notes: 'Penerimaan galon kosong kembali dari SD Lazuardi',
      created_by_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 2 * 86400000 + 3600000).toISOString(),
    },
  ];

  const inventoryReceipts: InventoryReceipt[] = [
    {
      id: 'rcv-1',
      receipt_number: `RCV-${ym}-0001`,
      receipt_date: twoDaysAgoStr,
      supplier_name: 'PT Tirta Investama Distributor',
      document_number: 'SJ-2026-8841',
      location_id: 'invloc-main',
      location_name: 'Gudang Utama Resources',
      qty_filled: 41,
      qty_empty: 0,
      notes: 'Penerimaan batch rutin minggu berjalan',
      created_by_name: 'Budi Hermawan',
      created_at: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
  ];

  const notifications: LocalDatabaseState['notifications'] = [
    {
      id: 'notif-1',
      target_role: 'admin_resources',
      title: 'Permintaan Air Galon Baru',
      message: `Order GAL-${ym}-0002 dari SMP Lazuardi (2 galon) menunggu diproses.`,
      category: 'order',
      related_order_id: 'ord-gal-2',
      is_read: false,
      created_at: new Date(now.getTime() - 3600000).toISOString(),
    },
    {
      id: 'notif-2',
      user_id: 'usr-guru-smp',
      title: 'Dokumen Fotokopi Siap Diambil',
      message: `Order FCP-${ym}-0003 (LKS Praktikum Fisika Terpadu SMP) sudah siap diambil di Loket Resources.`,
      category: 'order',
      related_order_id: 'ord-fcp-3',
      is_read: false,
      created_at: new Date(now.getTime() - 1200000).toISOString(),
    },
  ];

  return {
    users,
    units,
    services,
    locations,
    settings: {
      allowed_email_domain: 'lazuardi.sch.id',
      gallon_min_stock: 15,
      file_retention_days: 90,
      monthly_report_day: 1,
    },
    orderSequences: {
      [`GAL-${ym}`]: 2,
      [`FCP-${ym}`]: 3,
      [`LAM-${ym}`]: 1,
      [`RCV-${ym}`]: 1,
      [`OPN-${ym}`]: 0,
      [`ADJ-${ym}`]: 0,
    },
    orders,
    inventoryLocations,
    inventoryBalances,
    inventoryTransactions,
    inventoryReceipts,
    stockOpnames: [],
    inventoryAdjustments: [],
    reportDeliveryLogs: [],
    notifications,
    auditLogs: [
      {
        id: 'aud-1',
        actor_email: 'soleh.st@lazuardi.sch.id',
        actor_role: 'super_admin',
        action: 'SYSTEM_INITIALIZED',
        entity_type: 'system',
        details: { note: 'Inisialisasi master data LRMS' },
        created_at: now.toISOString(),
      },
    ],
  };
}

export function loadLocalDb(): LocalDatabaseState {
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialState();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw) as LocalDatabaseState;
}

export function saveLocalDb(state: LocalDatabaseState): void {
  ensureDirectories();
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

export function nextSequenceNumber(state: LocalDatabaseState, prefix: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const key = `${prefix}-${ym}`;
  const next = (state.orderSequences[key] || 0) + 1;
  state.orderSequences[key] = next;
  return `${key}-${String(next).padStart(4, '0')}`;
}

export function getServicePrefix(serviceType: ServiceType): string {
  switch (serviceType) {
    case 'galon':
      return 'GAL';
    case 'fotokopi':
      return 'FCP';
    case 'laminating':
      return 'LAM';
  }
}

export function savePrivateLocalUpload(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): { storagePath: string; safeName: string } {
  ensureDirectories();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
  const fullPath = path.join(UPLOAD_DIR, uniqueName);
  fs.writeFileSync(fullPath, buffer);
  return { storagePath: uniqueName, safeName };
}

export function readPrivateLocalUpload(storagePath: string): Buffer | null {
  const safeBasename = path.basename(storagePath);
  const fullPath = path.join(UPLOAD_DIR, safeBasename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

// Signed URL Token untuk akses file privat berumur pendek (60 detik)
function getSigningSecret(): string {
  return process.env.SIGNED_URL_SECRET || 'lrms-local-ephemeral-signing-key-2026';
}

export function createSignedFileToken(attachmentId: string, userId: string, ttlSeconds = 60): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${attachmentId}:${userId}:${exp}`;
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifySignedFileToken(token: string): { attachmentId: string; userId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [attachmentId, userId, expStr, sig] = decoded.split(':');
    if (!attachmentId || !userId || !expStr || !sig) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;
    const expected = crypto
      .createHmac('sha256', getSigningSecret())
      .update(`${attachmentId}:${userId}:${expStr}`)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { attachmentId, userId };
  } catch {
    return null;
  }
}

export function appendAudit(
  state: LocalDatabaseState,
  actor: { email: string; role: string },
  action: string,
  entityType: string,
  entityId: string | undefined,
  details: Record<string, unknown>
): void {
  state.auditLogs.unshift({
    id: `aud-${crypto.randomUUID()}`,
    actor_email: actor.email,
    actor_role: actor.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    created_at: new Date().toISOString(),
  });
  if (state.auditLogs.length > 500) {
    state.auditLogs = state.auditLogs.slice(0, 500);
  }
}

export function addNotification(
  state: LocalDatabaseState,
  notif: {
    user_id?: string | null;
    target_role?: AppRole | null;
    title: string;
    message: string;
    category: 'order' | 'inventory' | 'report' | 'system';
    related_order_id?: string | null;
  }
): void {
  state.notifications.unshift({
    id: `notif-${crypto.randomUUID()}`,
    user_id: notif.user_id ?? null,
    target_role: notif.target_role ?? null,
    title: notif.title,
    message: notif.message,
    category: notif.category,
    related_order_id: notif.related_order_id ?? null,
    is_read: false,
    created_at: new Date().toISOString(),
  });
}

export function computeStockBalanceUpdate(
  bal: InventoryBalance,
  kind: GallonStockKind,
  newQty: number
): void {
  if (newQty < 0) throw new Error('Stok tidak boleh bernilai negatif');
  if (kind === 'isi') bal.qty_filled = newQty;
  if (kind === 'kosong') bal.qty_empty = newQty;
  if (kind === 'rusak') bal.qty_damaged = newQty;
  if (kind === 'hilang') bal.qty_lost = newQty;
  bal.updated_at = new Date().toISOString();
}

export function getStockBalanceValue(bal: InventoryBalance, kind: GallonStockKind): number {
  if (kind === 'isi') return bal.qty_filled;
  if (kind === 'kosong') return bal.qty_empty;
  if (kind === 'rusak') return bal.qty_damaged;
  return bal.qty_lost;
}
