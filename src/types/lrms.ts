export type AppRole = 'super_admin' | 'admin_resources' | 'kepala_unit' | 'user';

export type ServiceType = 'galon' | 'fotokopi' | 'laminating';

export type OrderStatus =
  | 'Menunggu Diproses'
  | 'Diproses'
  | 'Dalam Pengiriman'
  | 'Siap Diambil'
  | 'Selesai'
  | 'Dibatalkan';

export type GallonStockKind = 'isi' | 'kosong' | 'rusak' | 'hilang';

export type PrintSide = 'satu_sisi' | 'dua_sisi';
export type PrintColor = 'Hitam Putih' | 'Warna';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  role: AppRole;
  is_active: boolean;
  last_login_at?: string | null;
  unit_ids: string[];
  primary_unit_id?: string | null;
  head_unit_ids: string[];
  signature_data_url?: string | null;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  category: string;
  head_name: string;
  head_email: string;
  is_active: boolean;
}

export interface ServiceCatalogItem {
  id: string;
  code: string;
  service_type: ServiceType;
  name: string;
  description: string;
  estimated_sla_minutes: number;
  is_active: boolean;
  operational_config?: Record<string, unknown>;
}

export interface LocationItem {
  id: string;
  building: string;
  floor: string;
  room: string;
  unit_id: string | null;
  unit_name?: string;
  is_active: boolean;
}

export interface OrderAttachment {
  id: string;
  order_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_path: string;
  created_at: string;
}

export interface OrderStatusHistoryItem {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by_name: string;
  note: string | null;
  created_at: string;
}

export interface OrderItemDetail {
  gallon_requested_qty?: number | null;
  gallon_empty_return_planned?: number | null;
  gallon_delivered_qty?: number | null;
  gallon_empty_received_qty?: number | null;
  document_name?: string | null;
  page_count?: number | null;
  copy_count?: number | null;
  paper_size?: string | null;
  print_color?: PrintColor | null;
  print_sides?: PrintSide | null;
  finishing_notes?: string | null;
  actual_page_count?: number | null;
  actual_copy_count?: number | null;
  total_print_sides?: number | null;
  total_paper_sheets?: number | null;
  laminating_size?: string | null;
  laminating_type?: string | null;
  laminating_sheets?: number | null;
  laminating_actual_sheets?: number | null;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  service_type: ServiceType;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  unit_id: string;
  unit_name: string;
  location_id?: string | null;
  location_label?: string | null;
  status: OrderStatus;
  needed_date: string;
  needed_time?: string | null;
  notes?: string | null;
  internal_notes?: string | null;
  cancel_reason?: string | null;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  created_at: string;
  updated_at: string;
  processed_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  item: OrderItemDetail;
  attachments?: OrderAttachment[];
  history?: OrderStatusHistoryItem[];
}

export interface InventoryLocation {
  id: string;
  code: string;
  name: string;
  building: string;
  is_default: boolean;
  is_active: boolean;
}

export interface InventoryBalance {
  id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  building: string;
  qty_filled: number;
  qty_empty: number;
  qty_damaged: number;
  qty_lost: number;
  updated_at: string;
}

export interface InventoryTransaction {
  id: string;
  location_id: string;
  location_name: string;
  transaction_type: string;
  stock_kind: GallonStockKind;
  qty_delta: number;
  balance_after: number;
  reference_type?: string | null;
  reference_number?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  notes?: string | null;
  created_by_name: string;
  created_at: string;
}

export interface InventoryReceipt {
  id: string;
  receipt_number: string;
  receipt_date: string;
  supplier_name: string;
  document_number?: string | null;
  location_id: string;
  location_name: string;
  qty_filled: number;
  qty_empty: number;
  notes?: string | null;
  created_by_name: string;
  created_at: string;
}

export interface StockOpnameLine {
  stock_kind: GallonStockKind;
  system_qty: number;
  physical_qty: number;
  variance_qty: number;
  variance_reason?: string | null;
}

export interface StockOpnameRecord {
  id: string;
  opname_number: string;
  opname_date: string;
  location_id: string;
  location_name: string;
  status: 'Draft' | 'Final';
  inspector_name: string;
  notes?: string | null;
  finalized_at?: string | null;
  created_at: string;
  items: StockOpnameLine[];
}

export interface InventoryAdjustment {
  id: string;
  adjustment_number: string;
  location_id: string;
  location_name: string;
  stock_kind: GallonStockKind;
  previous_qty: number;
  adjusted_qty: number;
  delta_qty: number;
  reason: string;
  source_opname_id?: string | null;
  created_by_name: string;
  created_at: string;
}

export interface ReportDeliveryLog {
  id: string;
  report_period: string;
  unit_id: string;
  unit_name: string;
  recipient_email: string;
  recipient_name?: string | null;
  total_orders: number;
  total_sides_bw: number;
  total_sides_color: number;
  total_sheets: number;
  delivery_status: 'SENT' | 'FAILED';
  error_message?: string | null;
  triggered_by: 'cron' | 'manual';
  sent_at: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: 'order' | 'inventory' | 'report' | 'system';
  related_order_id?: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AppSettingsMap {
  allowed_email_domain: string;
  gallon_min_stock: number;
  file_retention_days: number;
  monthly_report_day: number;
}

export interface SystemModeStatus {
  mode: 'supabase' | 'local';
  supabaseConfigured: boolean;
  hasPublicCredentials?: boolean;
  hasServiceRoleKey?: boolean;
  serviceRoleKeyKind?: 'jwt_service_role' | 'sb_secret' | 'jwt_anon' | 'sb_publishable' | 'missing' | 'unknown';
  supabaseProjectUrl?: string | null;
  smtpConfigured: boolean;
  allowedDomain: string;
}

export interface DashboardSummary {
  todayTotal: number;
  newOrders: number;
  inProgressOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  gallonOrders: number;
  photocopyOrders: number;
  laminatingOrders: number;
  gallonStockFilled: number;
  gallonStockEmpty: number;
  gallonStockAllocated: number;
  gallonStockAvailable: number;
  gallonMinThreshold: number;
  isCriticalStock: boolean;
  overdueOrdersCount: number;
  trendByDay: Array<{ date: string; galon: number; fotokopi: number; laminating: number }>;
  ordersByUnit: Array<{ unitName: string; count: number }>;
  photocopyVolumeByMonth: Array<{ month: string; sidesBW: number; sidesColor: number; sheets: number }>;
  recentOrders: OrderRecord[];
  pendingQueue: OrderRecord[];
}

export interface ReportAdminAuthorization {
  admin_id?: string | null;
  admin_name: string;
  admin_email: string;
  admin_role: string;
  signature_data_url?: string | null;
  authorized_at: string;
  authorization_code: string;
}

