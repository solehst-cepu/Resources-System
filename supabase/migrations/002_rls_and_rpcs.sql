-- ==============================================================================
-- LAZUARDI RESOURCES MANAGEMENT SYSTEM (LRMS)
-- Migration 002: Auth Trigger, Row Level Security (RLS), Storage & Atomic RPCs
-- ==============================================================================

-- 0. Ensure Schema & Table Privileges for service_role and authenticated
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

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
  VALUES (
    NEW.id,
    CASE
      WHEN v_email = 'soleh.st@lazuardi.sch.id'
       AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin')
      THEN 'super_admin'::app_role
      ELSE 'user'::app_role
    END
  )
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
