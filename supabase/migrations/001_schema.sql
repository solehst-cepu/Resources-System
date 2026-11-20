-- ==============================================================================
-- LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS)
-- Migration 001: Core Relational Schema (Supabase PostgreSQL)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum Types
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('super_admin', 'admin_resources', 'kepala_unit', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE service_type AS ENUM ('galon', 'fotokopi', 'laminating');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'Menunggu Diproses',
    'Diproses',
    'Dalam Pengiriman',
    'Siap Diambil',
    'Selesai',
    'Dibatalkan'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE gallon_stock_kind AS ENUM ('isi', 'kosong', 'rusak', 'hilang');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE opname_status AS ENUM ('Draft', 'Final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 1. Authentication & Master Data
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_profiles_domain CHECK (email ~* '@lazuardi\.sch\.id$')
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_roles_user UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- Akademik, Operasional, Manajemen, Penunjang
  head_name TEXT,
  head_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_unit_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_unit_head BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_unit UNIQUE (user_id, unit_id)
);

CREATE TABLE IF NOT EXISTS public.service_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  service_type service_type NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  estimated_sla_minutes INTEGER NOT NULL DEFAULT 60,
  operational_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building TEXT NOT NULL,
  floor TEXT NOT NULL,
  room TEXT NOT NULL,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. Order Management
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_number_sequences (
  prefix TEXT NOT NULL,
  year_month TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year_month)
);

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  service_type service_type NOT NULL,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL,
  location_label TEXT,
  status order_status NOT NULL DEFAULT 'Menunggu Diproses',
  needed_date DATE NOT NULL,
  needed_time TEXT,
  notes TEXT,
  internal_notes TEXT,
  cancel_reason TEXT,
  assigned_staff_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_staff_name TEXT,
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- Air Galon fields
  gallon_requested_qty INTEGER CHECK (gallon_requested_qty IS NULL OR gallon_requested_qty > 0),
  gallon_empty_return_planned INTEGER CHECK (gallon_empty_return_planned IS NULL OR gallon_empty_return_planned >= 0),
  gallon_delivered_qty INTEGER CHECK (gallon_delivered_qty IS NULL OR gallon_delivered_qty >= 0),
  gallon_empty_received_qty INTEGER CHECK (gallon_empty_received_qty IS NULL OR gallon_empty_received_qty >= 0),
  -- Fotokopi fields
  document_name TEXT,
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  copy_count INTEGER CHECK (copy_count IS NULL OR copy_count > 0),
  paper_size TEXT,
  print_color TEXT, -- Hitam Putih | Warna
  print_sides TEXT, -- satu_sisi | dua_sisi
  finishing_notes TEXT,
  actual_page_count INTEGER,
  actual_copy_count INTEGER,
  total_print_sides INTEGER,
  total_paper_sheets INTEGER,
  -- Laminating fields
  laminating_size TEXT, -- A4 | F4 | A3 | ID Card | Custom
  laminating_type TEXT, -- Glossy | Matte | Tebal 100mic | dll
  laminating_sheets INTEGER CHECK (laminating_sheets IS NULL OR laminating_sheets > 0),
  laminating_actual_sheets INTEGER CHECK (laminating_actual_sheets IS NULL OR laminating_actual_sheets >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_name TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'order-documents',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 26214400),
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------------------------
-- 3. Inventory Management (Air Galon & Ekstensibel)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'air_galon',
  unit_of_measure TEXT NOT NULL DEFAULT 'Galon',
  min_stock_threshold INTEGER NOT NULL DEFAULT 15 CHECK (min_stock_threshold >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  building TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  qty_filled INTEGER NOT NULL DEFAULT 0 CHECK (qty_filled >= 0),
  qty_empty INTEGER NOT NULL DEFAULT 0 CHECK (qty_empty >= 0),
  qty_damaged INTEGER NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  qty_lost INTEGER NOT NULL DEFAULT 0 CHECK (qty_lost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_balance_loc UNIQUE (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL, -- RECEIPT, DISTRIBUTION, EMPTY_RETURN, OPNAME_ADJUSTMENT, MANUAL_ADJUSTMENT
  stock_kind gallon_stock_kind NOT NULL,
  qty_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT, -- order, receipt, opname, adjustment
  reference_id UUID,
  reference_number TEXT,
  unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  receipt_date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  document_number TEXT,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  qty_filled INTEGER NOT NULL DEFAULT 0 CHECK (qty_filled >= 0),
  qty_empty INTEGER NOT NULL DEFAULT 0 CHECK (qty_empty >= 0),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_stock_opnames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_number TEXT NOT NULL UNIQUE,
  opname_date DATE NOT NULL,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  status opname_status NOT NULL DEFAULT 'Draft',
  inspector_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  inspector_name TEXT NOT NULL,
  notes TEXT,
  finalized_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_stock_opname_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_id UUID NOT NULL REFERENCES public.inventory_stock_opnames(id) ON DELETE CASCADE,
  stock_kind gallon_stock_kind NOT NULL,
  system_qty INTEGER NOT NULL CHECK (system_qty >= 0),
  physical_qty INTEGER NOT NULL CHECK (physical_qty >= 0),
  variance_qty INTEGER GENERATED ALWAYS AS (physical_qty - system_qty) STORED,
  variance_reason TEXT,
  CONSTRAINT uq_opname_item_kind UNIQUE (opname_id, stock_kind)
);

CREATE TABLE IF NOT EXISTS public.inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number TEXT NOT NULL UNIQUE,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  stock_kind gallon_stock_kind NOT NULL,
  previous_qty INTEGER NOT NULL CHECK (previous_qty >= 0),
  adjusted_qty INTEGER NOT NULL CHECK (adjusted_qty >= 0),
  delta_qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source_opname_id UUID REFERENCES public.inventory_stock_opnames(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 4. Reporting, Notifications & Audit Trail
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL DEFAULT 'monthly_photocopy_unit',
  cron_expression TEXT NOT NULL DEFAULT '0 8 1 * *',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.report_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_period TEXT NOT NULL, -- YYYY-MM
  unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  unit_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_sides_bw INTEGER NOT NULL DEFAULT 0,
  total_sides_color INTEGER NOT NULL DEFAULT 0,
  total_sheets INTEGER NOT NULL DEFAULT 0,
  delivery_status TEXT NOT NULL, -- SENT | FAILED
  provider_message_id TEXT,
  error_message TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'cron', -- cron | manual
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_report_period_unit UNIQUE (report_period, unit_id, delivery_status)
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_role app_role,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'order', -- order | inventory | report | system
  related_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 5. Performance Indexes (Optimized for Supabase Free Plan)
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_orders_requester_created ON public.orders (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_service_status_created ON public.orders (service_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_unit_created ON public.orders (unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_needed_date ON public.orders (needed_date, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON public.order_status_history (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_tx_loc_created ON public.inventory_transactions (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_tx_ref ON public.inventory_transactions (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_logs_period_unit ON public.report_delivery_logs (report_period, unit_id);
