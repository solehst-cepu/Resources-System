-- ==============================================================================
-- LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS) — COMBINED ONE-SHOT SUPABASE SETUP
-- Run this entire script in Supabase Dashboard -> SQL Editor (Project: Resources-System)
-- ==============================================================================

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

-- ==============================================================================
-- LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS)
-- Migration 002: Auth Trigger, Row Level Security (RLS), Storage & Atomic RPCs
-- ==============================================================================

-- 1. Helper Functions for Authorization & Domain Guard
CREATE OR REPLACE FUNCTION public.auth_email_domain_valid()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() ->> 'email') ~* '@lazuardi\.sch\.id$', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.user_roles WHERE user_id = auth.uid()),
    'user'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_email_domain_valid()
     AND public.current_user_role() IN ('super_admin', 'admin_resources');
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_email_domain_valid()
     AND public.current_user_role() = 'super_admin';
$$;

CREATE OR REPLACE FUNCTION public.assigned_unit_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT unit_id FROM public.user_unit_assignments WHERE user_id = auth.uid();
$$;

-- 2. Auto-Provision Profile & Default 'user' Role on Google SSO Sign-in
-- Rejects any non-@lazuardi.sch.id account at the database layer as well.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
BEGIN
  v_email := LOWER(COALESCE(NEW.email, ''));
  IF v_email !~ '@lazuardi\.sch\.id$' THEN
    RAISE EXCEPTION 'Akses ditolak: hanya email domain @lazuardi.sch.id yang diperbolehkan.';
  END IF;

  v_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    SPLIT_PART(v_email, '@', 1)
  );

  INSERT INTO public.profiles (id, email, full_name, avatar_url, last_login_at)
  VALUES (NEW.id, v_email, v_name, NEW.raw_user_meta_data ->> 'avatar_url', NOW())
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        avatar_url = EXCLUDED.avatar_url,
        last_login_at = NOW(),
        updated_at = NOW();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. Enable RLS on All Tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_unit_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock_opnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock_opname_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies

-- Profiles
DROP POLICY IF EXISTS profiles_read_own_or_admin ON public.profiles;
CREATE POLICY profiles_read_own_or_admin ON public.profiles
  FOR SELECT USING (auth_email_domain_valid() AND (id = auth.uid() OR is_admin_or_super()));
DROP POLICY IF EXISTS profiles_super_admin_manage ON public.profiles;
CREATE POLICY profiles_super_admin_manage ON public.profiles
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- User Roles (Users can read own role; ONLY Super Admin can assign/modify roles)
DROP POLICY IF EXISTS user_roles_read ON public.user_roles;
CREATE POLICY user_roles_read ON public.user_roles
  FOR SELECT USING (auth_email_domain_valid() AND (user_id = auth.uid() OR is_admin_or_super()));
DROP POLICY IF EXISTS user_roles_super_admin_write ON public.user_roles;
CREATE POLICY user_roles_super_admin_write ON public.user_roles
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Master Data (Authenticated school domain can read active master data; Admin Resources & Super Admin manage)
DROP POLICY IF EXISTS units_read_all_valid ON public.units;
CREATE POLICY units_read_all_valid ON public.units
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS units_admin_write ON public.units;
CREATE POLICY units_admin_write ON public.units
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS user_units_read ON public.user_unit_assignments;
CREATE POLICY user_units_read ON public.user_unit_assignments
  FOR SELECT USING (auth_email_domain_valid() AND (user_id = auth.uid() OR is_admin_or_super()));
DROP POLICY IF EXISTS user_units_super_admin_write ON public.user_unit_assignments;
CREATE POLICY user_units_super_admin_write ON public.user_unit_assignments
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS services_read ON public.service_catalog;
CREATE POLICY services_read ON public.service_catalog
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS services_admin_write ON public.service_catalog;
CREATE POLICY services_admin_write ON public.service_catalog
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS locations_read ON public.locations;
CREATE POLICY locations_read ON public.locations
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS locations_admin_write ON public.locations;
CREATE POLICY locations_admin_write ON public.locations
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS settings_read ON public.app_settings;
CREATE POLICY settings_read ON public.app_settings
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS settings_super_admin_write ON public.app_settings;
CREATE POLICY settings_super_admin_write ON public.app_settings
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Orders (User reads/creates own; Kepala Unit reads service orders of assigned units; Admin reads/updates all)
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT USING (
    auth_email_domain_valid() AND (
      requester_id = auth.uid()
      OR is_admin_or_super()
      OR (current_user_role() = 'kepala_unit' AND service_type IN ('fotokopi', 'laminating', 'galon') AND unit_id IN (SELECT assigned_unit_ids()))
    )
  );

DROP POLICY IF EXISTS orders_insert_own ON public.orders;
CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT WITH CHECK (
    auth_email_domain_valid() AND requester_id = auth.uid()
  );

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders
  FOR UPDATE USING (
    auth_email_domain_valid() AND (
      is_admin_or_super()
      OR (requester_id = auth.uid() AND status = 'Menunggu Diproses')
    )
  );

DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND (
        o.requester_id = auth.uid()
        OR is_admin_or_super()
        OR (current_user_role() = 'kepala_unit' AND o.service_type IN ('fotokopi', 'laminating', 'galon') AND o.unit_id IN (SELECT assigned_unit_ids()))
      )
    )
  );

DROP POLICY IF EXISTS order_history_select ON public.order_status_history;
CREATE POLICY order_history_select ON public.order_status_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND (o.requester_id = auth.uid() OR is_admin_or_super())
    )
  );

DROP POLICY IF EXISTS order_attachments_select ON public.order_attachments;
CREATE POLICY order_attachments_select ON public.order_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND (o.requester_id = auth.uid() OR is_admin_or_super())
    )
  );

DROP POLICY IF EXISTS order_assignments_admin ON public.order_assignments;
CREATE POLICY order_assignments_admin ON public.order_assignments
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

-- Inventory (Read for Admin/Super Admin; summary balances readable for authenticated availability check)
DROP POLICY IF EXISTS inv_items_read ON public.inventory_items;
CREATE POLICY inv_items_read ON public.inventory_items
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS inv_items_admin_write ON public.inventory_items;
CREATE POLICY inv_items_admin_write ON public.inventory_items
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_locations_read ON public.inventory_locations;
CREATE POLICY inv_locations_read ON public.inventory_locations
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS inv_locations_admin_write ON public.inventory_locations;
CREATE POLICY inv_locations_admin_write ON public.inventory_locations
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_balances_read ON public.inventory_balances;
CREATE POLICY inv_balances_read ON public.inventory_balances
  FOR SELECT USING (auth_email_domain_valid());
DROP POLICY IF EXISTS inv_balances_admin_write ON public.inventory_balances;
CREATE POLICY inv_balances_admin_write ON public.inventory_balances
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_tx_admin ON public.inventory_transactions;
CREATE POLICY inv_tx_admin ON public.inventory_transactions
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_receipts_admin ON public.inventory_receipts;
CREATE POLICY inv_receipts_admin ON public.inventory_receipts
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_opnames_admin ON public.inventory_stock_opnames;
CREATE POLICY inv_opnames_admin ON public.inventory_stock_opnames
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_opname_items_admin ON public.inventory_stock_opname_items;
CREATE POLICY inv_opname_items_admin ON public.inventory_stock_opname_items
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS inv_adjustments_admin ON public.inventory_adjustments;
CREATE POLICY inv_adjustments_admin ON public.inventory_adjustments
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

-- Reports, Notifications & Audit Logs
DROP POLICY IF EXISTS report_schedules_admin ON public.report_schedules;
CREATE POLICY report_schedules_admin ON public.report_schedules
  FOR ALL USING (is_admin_or_super()) WITH CHECK (is_admin_or_super());

DROP POLICY IF EXISTS report_logs_read ON public.report_delivery_logs;
CREATE POLICY report_logs_read ON public.report_delivery_logs
  FOR SELECT USING (
    auth_email_domain_valid() AND (
      is_admin_or_super()
      OR (current_user_role() = 'kepala_unit' AND unit_id IN (SELECT assigned_unit_ids()))
    )
  );

DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own ON public.notifications
  FOR SELECT USING (
    auth_email_domain_valid() AND (
      user_id = auth.uid()
      OR (target_role IS NOT NULL AND target_role = current_user_role())
    )
  );

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS audit_logs_super_admin ON public.audit_logs;
CREATE POLICY audit_logs_super_admin ON public.audit_logs
  FOR SELECT USING (is_super_admin());

-- 5. Private Storage Bucket for Order Documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-documents',
  'order-documents',
  FALSE,
  26214400,
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- 6. Atomic Database RPC Functions

CREATE OR REPLACE FUNCTION public.generate_order_number(p_service_type service_type)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_ym TEXT;
  v_seq INTEGER;
BEGIN
  v_prefix := CASE p_service_type
    WHEN 'galon' THEN 'GAL'
    WHEN 'fotokopi' THEN 'FCP'
    WHEN 'laminating' THEN 'LAM'
  END;
  v_ym := TO_CHAR(NOW() AT TIME ZONE 'Asia/Jakarta', 'YYYYMM');

  INSERT INTO public.order_number_sequences (prefix, year_month, last_seq)
  VALUES (v_prefix, v_ym, 1)
  ON CONFLICT (prefix, year_month)
  DO UPDATE SET last_seq = public.order_number_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_prefix || '-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_complete_gallon_delivery(
  p_order_id UUID,
  p_location_id UUID,
  p_delivered_qty INTEGER,
  p_empty_received_qty INTEGER,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item_id UUID;
  v_bal RECORD;
  v_new_filled INTEGER;
  v_new_empty INTEGER;
BEGIN
  IF p_delivered_qty < 0 OR p_empty_received_qty < 0 THEN
    RAISE EXCEPTION 'Jumlah tidak boleh negatif';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan';
  END IF;
  IF v_order.service_type <> 'galon' THEN
    RAISE EXCEPTION 'Order bukan layanan Air Galon';
  END IF;
  IF v_order.status = 'Selesai' THEN
    RAISE EXCEPTION 'Order sudah selesai diproses (mencegah pengurangan stok ganda)';
  END IF;
  IF v_order.status = 'Dibatalkan' THEN
    RAISE EXCEPTION 'Order yang dibatalkan tidak dapat diselesaikan';
  END IF;

  SELECT id INTO v_item_id FROM public.inventory_items WHERE sku = 'GALON-19L' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Master item GALON-19L belum tersedia';
  END IF;

  SELECT * INTO v_bal
  FROM public.inventory_balances
  WHERE item_id = v_item_id AND location_id = p_location_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saldo inventaris pada lokasi ini tidak ditemukan';
  END IF;

  IF v_bal.qty_filled < p_delivered_qty THEN
    RAISE EXCEPTION 'Stok galon isi tidak mencukupi (tersedia %, diminta %)', v_bal.qty_filled, p_delivered_qty;
  END IF;

  v_new_filled := v_bal.qty_filled - p_delivered_qty;
  v_new_empty := v_bal.qty_empty + p_empty_received_qty;

  UPDATE public.inventory_balances
  SET qty_filled = v_new_filled,
      qty_empty = v_new_empty,
      updated_at = NOW()
  WHERE id = v_bal.id;

  IF p_delivered_qty > 0 THEN
    INSERT INTO public.inventory_transactions (
      item_id, location_id, transaction_type, stock_kind, qty_delta, balance_after,
      reference_type, reference_id, reference_number, unit_id, notes, created_by, created_by_name
    ) VALUES (
      v_item_id, p_location_id, 'DISTRIBUTION', 'isi', -p_delivered_qty, v_new_filled,
      'order', v_order.id, v_order.order_number, v_order.unit_id,
      COALESCE(p_notes, 'Pengiriman galon isi ke unit'), p_actor_id, p_actor_name
    );
  END IF;

  IF p_empty_received_qty > 0 THEN
    INSERT INTO public.inventory_transactions (
      item_id, location_id, transaction_type, stock_kind, qty_delta, balance_after,
      reference_type, reference_id, reference_number, unit_id, notes, created_by, created_by_name
    ) VALUES (
      v_item_id, p_location_id, 'EMPTY_RETURN', 'kosong', p_empty_received_qty, v_new_empty,
      'order', v_order.id, v_order.order_number, v_order.unit_id,
      COALESCE(p_notes, 'Penerimaan galon kosong kembali'), p_actor_id, p_actor_name
    );
  END IF;

  UPDATE public.order_items
  SET gallon_delivered_qty = p_delivered_qty,
      gallon_empty_received_qty = p_empty_received_qty,
      updated_at = NOW()
  WHERE order_id = v_order.id;

  UPDATE public.orders
  SET status = 'Selesai',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_order.id;

  INSERT INTO public.order_status_history (
    order_id, from_status, to_status, changed_by, changed_by_name, note
  ) VALUES (
    v_order.id, v_order.status, 'Selesai', p_actor_id, p_actor_name,
    FORMAT('Dikirim %s galon isi, diterima %s galon kosong.', p_delivered_qty, p_empty_received_qty)
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'qty_filled', v_new_filled,
    'qty_empty', v_new_empty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_finalize_stock_opname(
  p_opname_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opname RECORD;
  v_item_id UUID;
  v_bal RECORD;
  v_line RECORD;
  v_adj_num TEXT;
  v_idx INTEGER := 0;
BEGIN
  SELECT * INTO v_opname FROM public.inventory_stock_opnames WHERE id = p_opname_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock opname tidak ditemukan';
  END IF;
  IF v_opname.status = 'Final' THEN
    RAISE EXCEPTION 'Stock opname sudah berstatus Final dan tidak dapat diubah';
  END IF;

  SELECT id INTO v_item_id FROM public.inventory_items WHERE sku = 'GALON-19L' LIMIT 1;
  SELECT * INTO v_bal FROM public.inventory_balances
  WHERE item_id = v_item_id AND location_id = v_opname.location_id
  FOR UPDATE;

  FOR v_line IN SELECT * FROM public.inventory_stock_opname_items WHERE opname_id = p_opname_id LOOP
    IF v_line.physical_qty <> v_line.system_qty THEN
      v_idx := v_idx + 1;
      v_adj_num := 'ADJ-' || v_opname.opname_number || '-' || v_idx;

      INSERT INTO public.inventory_adjustments (
        adjustment_number, location_id, stock_kind, previous_qty, adjusted_qty,
        delta_qty, reason, source_opname_id, created_by, created_by_name
      ) VALUES (
        v_adj_num, v_opname.location_id, v_line.stock_kind, v_line.system_qty, v_line.physical_qty,
        (v_line.physical_qty - v_line.system_qty),
        COALESCE(v_line.variance_reason, 'Penyesuaian finalisasi Stock Opname'),
        p_opname_id, p_actor_id, p_actor_name
      );

      INSERT INTO public.inventory_transactions (
        item_id, location_id, transaction_type, stock_kind, qty_delta, balance_after,
        reference_type, reference_id, reference_number, notes, created_by, created_by_name
      ) VALUES (
        v_item_id, v_opname.location_id, 'OPNAME_ADJUSTMENT', v_line.stock_kind,
        (v_line.physical_qty - v_line.system_qty), v_line.physical_qty,
        'opname', p_opname_id, v_opname.opname_number,
        COALESCE(v_line.variance_reason, 'Finalisasi Stock Opname'), p_actor_id, p_actor_name
      );

      IF v_line.stock_kind = 'isi' THEN
        UPDATE public.inventory_balances SET qty_filled = v_line.physical_qty, updated_at = NOW() WHERE id = v_bal.id;
      ELSIF v_line.stock_kind = 'kosong' THEN
        UPDATE public.inventory_balances SET qty_empty = v_line.physical_qty, updated_at = NOW() WHERE id = v_bal.id;
      ELSIF v_line.stock_kind = 'rusak' THEN
        UPDATE public.inventory_balances SET qty_damaged = v_line.physical_qty, updated_at = NOW() WHERE id = v_bal.id;
      ELSIF v_line.stock_kind = 'hilang' THEN
        UPDATE public.inventory_balances SET qty_lost = v_line.physical_qty, updated_at = NOW() WHERE id = v_bal.id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.inventory_stock_opnames
  SET status = 'Final',
      finalized_at = NOW(),
      finalized_by = p_actor_id,
      updated_at = NOW()
  WHERE id = p_opname_id;

  RETURN jsonb_build_object('opname_id', p_opname_id, 'status', 'Final', 'adjustments_created', v_idx);
END;
$$;

-- ==============================================================================
-- LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS)
-- Migration 003: Master Data Seed
-- ==============================================================================

INSERT INTO public.units (code, name, category, head_name, head_email, is_active) VALUES
  ('TK-LAZ', 'TK Lazuardi', 'Akademik', 'Rina Kartika, S.Pd', 'rina.kartika@lazuardi.sch.id', TRUE),
  ('SD-LAZ', 'SD Lazuardi', 'Akademik', 'Ahmad Fauzan, M.Pd', 'ahmad.fauzan@lazuardi.sch.id', TRUE),
  ('SMP-LAZ', 'SMP Lazuardi', 'Akademik', 'Dian Permata, M.Pd', 'dian.permata@lazuardi.sch.id', TRUE),
  ('SMA-LAZ', 'SMA Lazuardi', 'Akademik', 'Hendra Wijaya, M.Si', 'hendra.wijaya@lazuardi.sch.id', TRUE),
  ('RES-LAZ', 'Divisi Resources', 'Operasional', 'Soleh Santoso', 'soleh.st@lazuardi.sch.id', TRUE),
  ('YYS-LAZ', 'Yayasan & Manajemen', 'Manajemen', 'Nadia Kusuma', 'nadia.kusuma@lazuardi.sch.id', TRUE),
  ('FIN-LAZ', 'Keuangan & HR', 'Penunjang', 'Ratna Dewi', 'ratna.dewi@lazuardi.sch.id', TRUE),
  ('IT-LAZ', 'IT & Media Center', 'Penunjang', 'Bagus Pratama', 'bagus.pratama@lazuardi.sch.id', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.service_catalog (code, service_type, name, description, estimated_sla_minutes, operational_config, is_active) VALUES
  ('SRV-GAL', 'galon', 'Air Galon', 'Permintaan pengiriman air minum galon 19L dan penukaran galon kosong antar gedung.', 45, '{"allow_empty_exchange": true, "default_unit": "Galon"}', TRUE),
  ('SRV-FCP', 'fotokopi', 'Fotokopi', 'Layanan penggandaan dokumen akademik dan operasional (Hitam Putih / Warna, 1 atau 2 sisi).', 120, '{"max_file_mb": 25, "allowed_sizes": ["A4", "F4", "A3", "Lainnya"]}', TRUE),
  ('SRV-LAM', 'laminating', 'Laminating', 'Pelapisan dokumen dan kartu identitas berbagai ukuran (A4, F4, A3, ID Card, Custom).', 90, '{"allowed_sizes": ["A4", "F4", "A3", "ID Card", "Custom"]}', TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.inventory_items (sku, name, category, unit_of_measure, min_stock_threshold, is_active) VALUES
  ('GALON-19L', 'Air Mineral Galon 19L', 'air_galon', 'Galon', 15, TRUE)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.inventory_locations (code, name, building, is_default, is_active) VALUES
  ('GUD-UTAMA', 'Gudang Utama Resources', 'Gedung Operasional', TRUE, TRUE),
  ('PNT-SD', 'Pantry Lantai 1 SD', 'Gedung SD', FALSE, TRUE),
  ('PNT-SMPSMA', 'Pantry Gedung Menengah', 'Gedung SMP/SMA', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.inventory_balances (item_id, location_id, qty_filled, qty_empty, qty_damaged, qty_lost)
SELECT i.id, l.id,
  CASE l.code WHEN 'GUD-UTAMA' THEN 42 WHEN 'PNT-SD' THEN 12 ELSE 10 END,
  CASE l.code WHEN 'GUD-UTAMA' THEN 18 WHEN 'PNT-SD' THEN 6 ELSE 5 END,
  CASE l.code WHEN 'GUD-UTAMA' THEN 2 ELSE 0 END,
  0
FROM public.inventory_items i
CROSS JOIN public.inventory_locations l
WHERE i.sku = 'GALON-19L'
ON CONFLICT (item_id, location_id) DO NOTHING;

INSERT INTO public.locations (building, floor, room, unit_id, is_active)
SELECT v.building, v.floor, v.room, u.id, TRUE
FROM (
  VALUES
    ('Gedung SD', 'Lantai 1', 'Ruang Guru SD', 'SD-LAZ'),
    ('Gedung SD', 'Lantai 2', 'Tata Usaha SD', 'SD-LAZ'),
    ('Gedung TK', 'Lantai 1', 'Ruang Sentra TK', 'TK-LAZ'),
    ('Gedung SMP/SMA', 'Lantai 1', 'Ruang Guru SMP', 'SMP-LAZ'),
    ('Gedung SMP/SMA', 'Lantai 2', 'Ruang Guru SMA', 'SMA-LAZ'),
    ('Gedung Operasional', 'Lantai 1', 'Loket Divisi Resources', 'RES-LAZ'),
    ('Gedung Utama', 'Lantai 2', 'Ruang Yayasan & Pimpinan', 'YYS-LAZ'),
    ('Gedung Utama', 'Lantai 1', 'Ruang Keuangan & HR', 'FIN-LAZ')
) AS v(building, floor, room, unit_code)
JOIN public.units u ON u.code = v.unit_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.locations loc
  WHERE loc.building = v.building AND loc.floor = v.floor AND loc.room = v.room
);

INSERT INTO public.app_settings (key, value, description) VALUES
  ('allowed_email_domain', '"lazuardi.sch.id"', 'Domain Google Workspace yang diizinkan mengakses LRMS'),
  ('gallon_min_stock', '15', 'Batas minimum total stok galon isi sebelum peringatan stok kritis muncul'),
  ('file_retention_days', '90', 'Kebijakan retensi lampiran dokumen fotokopi dalam hari'),
  ('monthly_report_day', '1', 'Tanggal pengiriman otomatis laporan bulanan Kepala Unit setiap bulan')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.report_schedules (report_type, cron_expression, is_enabled)
SELECT 'monthly_photocopy_unit', '0 8 1 * *', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM public.report_schedules WHERE report_type = 'monthly_photocopy_unit'
);
