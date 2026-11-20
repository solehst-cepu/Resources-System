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
SELECT 'Gedung SD', 'Lantai 1', 'Ruang Guru SD', id, TRUE FROM public.units WHERE code = 'SD-LAZ'
UNION ALL
SELECT 'Gedung SD', 'Lantai 2', 'Tata Usaha SD', id, TRUE FROM public.units WHERE code = 'SD-LAZ'
UNION ALL
SELECT 'Gedung TK', 'Lantai 1', 'Ruang Sentra TK', id, TRUE FROM public.units WHERE code = 'TK-LAZ'
UNION ALL
SELECT 'Gedung SMP/SMA', 'Lantai 1', 'Ruang Guru SMP', id, TRUE FROM public.units WHERE code = 'SMP-LAZ'
UNION ALL
SELECT 'Gedung SMP/SMA', 'Lantai 2', 'Ruang Guru SMA', id, TRUE FROM public.units WHERE code = 'SMA-LAZ'
UNION ALL
SELECT 'Gedung Operasional', 'Lantai 1', 'Loket Divisi Resources', id, TRUE FROM public.units WHERE code = 'RES-LAZ'
UNION ALL
SELECT 'Gedung Utama', 'Lantai 2', 'Ruang Yayasan & Pimpinan', id, TRUE FROM public.units WHERE code = 'YYS-LAZ'
UNION ALL
SELECT 'Gedung Utama', 'Lantai 1', 'Ruang Keuangan & HR', id, TRUE FROM public.units WHERE code = 'FIN-LAZ';

INSERT INTO public.app_settings (key, value, description) VALUES
  ('allowed_email_domain', '"lazuardi.sch.id"', 'Domain Google Workspace yang diizinkan mengakses LRMS'),
  ('gallon_min_stock', '15', 'Batas minimum total stok galon isi sebelum peringatan stok kritis muncul'),
  ('file_retention_days', '90', 'Kebijakan retensi lampiran dokumen fotokopi dalam hari'),
  ('monthly_report_day', '1', 'Tanggal pengiriman otomatis laporan bulanan Kepala Unit setiap bulan')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.report_schedules (report_type, cron_expression, is_enabled) VALUES
  ('monthly_photocopy_unit', '0 8 1 * *', TRUE)
ON CONFLICT DO NOTHING;
