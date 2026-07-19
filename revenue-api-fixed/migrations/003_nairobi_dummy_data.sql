-- migrations/003_nairobi_dummy_data.sql
-- Dummy data for Nairobi Local Government Revenue Management System
-- Run via: pnpm migrate

-- ──────────────────────────────────────────────────────────────────────────
-- 1. ZONES - Nairobi County Hierarchy
-- ──────────────────────────────────────────────────────────────────────────

-- Nairobi County (Parent)
INSERT INTO zone (zone_name, zone_code, zone_type) VALUES
  ('Nairobi County', 'NBO-COUNTY', 'county')
ON CONFLICT (zone_code) DO NOTHING;

-- Get Nairobi County ID for references
WITH nairobi_county AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-COUNTY'
)

-- Subcounties
INSERT INTO zone (zone_name, zone_code, parent_zone_id, zone_type)
SELECT 
  v.name, v.code, nc.zone_id, 'subcounty'
FROM (VALUES
  ('Westlands', 'NBO-WEST'),
  ('Dagoretti', 'NBO-DAGO'),
  ('Langata', 'NBO-LANG'),
  ('Kasarani', 'NBO-KASA'),
  ('Embakasi', 'NBO-EMBA'),
  ('Makadara', 'NBO-MAKA'),
  ('Kamukunji', 'NBO-KAMU'),
  ('Starehe', 'NBO-STAR'),
  ('Njiru', 'NBO-NJIR'),
  ('Roysambu', 'NBO-ROYS')
) v(name, code), nairobi_county nc
WHERE NOT EXISTS (SELECT 1 FROM zone WHERE zone_code = v.code)
ON CONFLICT (zone_code) DO NOTHING;

-- Wards for each subcounty (sample - at least 25 wards)
INSERT INTO zone (zone_name, zone_code, parent_zone_id, zone_type)
SELECT v.name, v.code, z.zone_id, 'ward'
FROM (VALUES
  -- Westlands Wards
  ('Karura', 'NBO-W-KARURA', 'NBO-WEST'),
  ('Kilimani', 'NBO-W-KILIMANI', 'NBO-WEST'),
  ('Parklands', 'NBO-W-PARK', 'NBO-WEST'),
  -- Dagoretti Wards
  ('Riruta', 'NBO-D-RIRUTA', 'NBO-DAGO'),
  ('Mutuini', 'NBO-D-MUTUINI', 'NBO-DAGO'),
  ('Nairobi West', 'NBO-D-NAWEST', 'NBO-DAGO'),
  -- Langata Wards
  ('Nairobi South', 'NBO-L-NASOUTH', 'NBO-LANG'),
  ('Kibera', 'NBO-L-KIBERA', 'NBO-LANG'),
  ('Karen', 'NBO-L-KAREN', 'NBO-LANG'),
  -- Kasarani Wards
  ('Kasarani', 'NBO-K-KASARANI', 'NBO-KASA'),
  ('Mathare', 'NBO-K-MATHARE', 'NBO-KASA'),
  ('Pangani', 'NBO-K-PANGANI', 'NBO-KASA'),
  -- Embakasi Wards
  ('Embakasi', 'NBO-E-EMBAKASI', 'NBO-EMBA'),
  ('Nairobi Airport', 'NBO-E-AIRPORT', 'NBO-EMBA'),
  ('Kajiado', 'NBO-E-KAJIADO', 'NBO-EMBA'),
  -- Makadara Wards
  ('Makadara', 'NBO-M-MAKADARA', 'NBO-MAKA'),
  ('Maraka', 'NBO-M-MARAKA', 'NBO-MAKA'),
  ('Harambee', 'NBO-M-HARAMBEE', 'NBO-MAKA'),
  -- Kamukunji Wards
  ('Eastleigh', 'NBO-KMK-EASTLEIGH', 'NBO-KAMU'),
  ('Kariobangi', 'NBO-KMK-KARIOBANGI', 'NBO-KAMU'),
  ('Pumwani', 'NBO-KMK-PUMWANI', 'NBO-KAMU'),
  -- Starehe Wards
  ('Starehe', 'NBO-ST-STAREHE', 'NBO-STAR'),
  ('Ngara', 'NBO-ST-NGARA', 'NBO-STAR'),
  ('Nairobi Central', 'NBO-ST-CENTRAL', 'NBO-STAR'),
  -- Njiru Wards
  ('Njiru', 'NBO-NJ-NJIRU', 'NBO-NJIR'),
  ('Pipeline', 'NBO-NJ-PIPELINE', 'NBO-NJIR'),
  -- Roysambu Wards
  ('Roysambu', 'NBO-ROY-ROYSAMBU', 'NBO-ROYS'),
  ('Kasavini', 'NBO-ROY-KASAVINI', 'NBO-ROYS')
) v(name, code, parent_code)
JOIN zone z ON z.zone_code = v.parent_code
WHERE NOT EXISTS (SELECT 1 FROM zone WHERE zone_code = v.code)
ON CONFLICT (zone_code) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. RECORD TYPES
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO record_type (type_name, geometry_type, description, is_active) VALUES
  ('Residential Parcel', 'polygon', 'Residential land parcels', TRUE),
  ('Commercial Parcel', 'polygon', 'Commercial land parcels', TRUE),
  ('Industrial Parcel', 'polygon', 'Industrial land parcels', TRUE),
  ('Business Premises', 'point', 'Business establishments', TRUE),
  ('Market Stall', 'point', 'Market trading stalls', TRUE),
  ('Hawking Point', 'point', 'Street hawking locations', TRUE),
  ('Water Point', 'point', 'Water supply points', TRUE),
  ('Kiosk', 'point', 'Small retail kiosks', TRUE)
ON CONFLICT (type_name) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. USERS (Admin, Finance Managers, and Officers)
-- ──────────────────────────────────────────────────────────────────────────

-- Get role IDs
WITH role_ids AS (
  SELECT role_id, role_name FROM role
  WHERE role_name IN ('admin', 'finance_manager', 'officer')
),
county AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-COUNTY'
),
west_zone AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-WEST'
),
dago_zone AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-DAGO'
),
lang_zone AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-LANG'
),
kasa_zone AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-KASA'
},
emba_zone AS (
  SELECT zone_id FROM zone WHERE zone_code = 'NBO-EMBA'
)

INSERT INTO users (name, email, password_hash, role_id, zone_id, auth_provider)
SELECT 
  v.name, v.email, 
  crypt(v.password, gen_salt('bf')), -- bcrypt hashing
  CASE 
    WHEN v.role = 'admin' THEN (SELECT role_id FROM role_ids WHERE role_name = 'admin')
    WHEN v.role = 'finance_manager' THEN (SELECT role_id FROM role_ids WHERE role_name = 'finance_manager')
    ELSE (SELECT role_id FROM role_ids WHERE role_name = 'officer')
  END,
  CASE 
    WHEN v.zone = 'county' THEN (SELECT zone_id FROM county)
    WHEN v.zone = 'westlands' THEN (SELECT zone_id FROM west_zone)
    WHEN v.zone = 'dagoretti' THEN (SELECT zone_id FROM dago_zone)
    WHEN v.zone = 'langata' THEN (SELECT zone_id FROM lang_zone)
    WHEN v.zone = 'kasarani' THEN (SELECT zone_id FROM kasa_zone)
    WHEN v.zone = 'embakasi' THEN (SELECT zone_id FROM emba_zone)
  END,
  'local'
FROM (VALUES
  ('James Kariuki', 'james.kariuki@nairobi.gov.ke', 'Admin@123', 'admin', 'county'),
  ('Susan Muthoni', 'susan.muthoni@nairobi.gov.ke', 'Finance@123', 'finance_manager', 'county'),
  ('David Kipchoge', 'david.kipchoge@nairobi.gov.ke', 'Finance@123', 'finance_manager', 'county'),
  ('Peter Okonkwo', 'peter.okonkwo@westlands.gov.ke', 'Officer@123', 'officer', 'westlands'),
  ('Jane Njeri', 'jane.njeri@westlands.gov.ke', 'Officer@123', 'officer', 'westlands'),
  ('Michael Mwangi', 'michael.mwangi@dagoretti.gov.ke', 'Officer@123', 'officer', 'dagoretti'),
  ('Alice Koech', 'alice.koech@dagoretti.gov.ke', 'Officer@123', 'officer', 'dagoretti'),
  ('Robert Kimani', 'robert.kimani@langata.gov.ke', 'Officer@123', 'officer', 'langata'),
  ('Grace Ayubu', 'grace.ayubu@langata.gov.ke', 'Officer@123', 'officer', 'langata'),
  ('Samuel Otieno', 'samuel.otieno@kasarani.gov.ke', 'Officer@123', 'officer', 'kasarani'),
  ('Nancy Kiplagat', 'nancy.kiplagat@kasarani.gov.ke', 'Officer@123', 'officer', 'kasarani'),
  ('Thomas Kipkemboi', 'thomas.kipkemboi@embakasi.gov.ke', 'Officer@123', 'officer', 'embakasi'),
  ('Rebecca Mwongeli', 'rebecca.mwongeli@embakasi.gov.ke', 'Officer@123', 'officer', 'embakasi')
) v(name, email, password, role, zone)
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = v.email)
ON CONFLICT (email) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. FEE SCHEDULES
-- ──────────────────────────────────────────────────────────────────────────

WITH rt_residential AS (SELECT record_type_id FROM record_type WHERE type_name = 'Residential Parcel'),
     rt_commercial AS (SELECT record_type_id FROM record_type WHERE type_name = 'Commercial Parcel'),
     rt_business AS (SELECT record_type_id FROM record_type WHERE type_name = 'Business Premises'),
     rt_market AS (SELECT record_type_id FROM record_type WHERE type_name = 'Market Stall'),
     rt_hawking AS (SELECT record_type_id FROM record_type WHERE type_name = 'Hawking Point'),
     rt_kiosk AS (SELECT record_type_id FROM record_type WHERE type_name = 'Kiosk'),
     county AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-COUNTY'),
     u1 AS (SELECT user_id FROM users WHERE email = 'james.kariuki@nairobi.gov.ke')

INSERT INTO fee_schedule (schedule_name, record_type_id, zone_id, amount, billing_period, effective_from, is_active, created_by)
SELECT * FROM (VALUES
  ('Residential Parcel - Annual 2024', (SELECT record_type_id FROM rt_residential), (SELECT zone_id FROM county), 5000.00, 'annual', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Residential Parcel - Annual 2025', (SELECT record_type_id FROM rt_residential), (SELECT zone_id FROM county), 5500.00, 'annual', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Commercial Parcel - Annual 2024', (SELECT record_type_id FROM rt_commercial), (SELECT zone_id FROM county), 15000.00, 'annual', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Commercial Parcel - Annual 2025', (SELECT record_type_id FROM rt_commercial), (SELECT zone_id FROM county), 16500.00, 'annual', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Business Premises License - Annual 2024', (SELECT record_type_id FROM rt_business), (SELECT zone_id FROM county), 2000.00, 'annual', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Business Premises License - Annual 2025', (SELECT record_type_id FROM rt_business), (SELECT zone_id FROM county), 2200.00, 'annual', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Market Stall Permit - Annual 2024', (SELECT record_type_id FROM rt_market), (SELECT zone_id FROM county), 500.00, 'annual', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Market Stall Permit - Annual 2025', (SELECT record_type_id FROM rt_market), (SELECT zone_id FROM county), 600.00, 'annual', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Hawking Permit - Monthly 2024', (SELECT record_type_id FROM rt_hawking), (SELECT zone_id FROM county), 150.00, 'monthly', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Hawking Permit - Monthly 2025', (SELECT record_type_id FROM rt_hawking), (SELECT zone_id FROM county), 175.00, 'monthly', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Kiosk License - Annual 2024', (SELECT record_type_id FROM rt_kiosk), (SELECT zone_id FROM county), 800.00, 'annual', '2024-01-01'::DATE, TRUE, (SELECT user_id FROM u1)),
  ('Kiosk License - Annual 2025', (SELECT record_type_id FROM rt_kiosk), (SELECT zone_id FROM county), 900.00, 'annual', '2025-01-01'::DATE, TRUE, (SELECT user_id FROM u1))
) v(schedule_name, record_type_id, zone_id, amount, billing_period, effective_from, is_active, created_by)
WHERE NOT EXISTS (SELECT 1 FROM fee_schedule WHERE schedule_name = v.schedule_name)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. TAXPAYER RECORDS (50+ records across different zones)
-- ──────────────────────────────────────────────────────────────────────────

WITH status_active AS (SELECT status_id FROM status WHERE status_name = 'active'),
     status_pending AS (SELECT status_id FROM status WHERE status_name = 'pending'),
     rt_residential AS (SELECT record_type_id FROM record_type WHERE type_name = 'Residential Parcel'),
     rt_commercial AS (SELECT record_type_id FROM record_type WHERE type_name = 'Commercial Parcel'),
     rt_business AS (SELECT record_type_id FROM record_type WHERE type_name = 'Business Premises'),
     rt_market AS (SELECT record_type_id FROM record_type WHERE type_name = 'Market Stall'),
     rt_kiosk AS (SELECT record_type_id FROM record_type WHERE type_name = 'Kiosk'),
     user_peter AS (SELECT user_id FROM users WHERE email = 'peter.okonkwo@westlands.gov.ke'),
     user_michael AS (SELECT user_id FROM users WHERE email = 'michael.mwangi@dagoretti.gov.ke'),
     user_robert AS (SELECT user_id FROM users WHERE email = 'robert.kimani@langata.gov.ke'),
     user_samuel AS (SELECT user_id FROM users WHERE email = 'samuel.otieno@kasarani.gov.ke'),
     user_thomas AS (SELECT user_id FROM users WHERE email = 'thomas.kipkemboi@embakasi.gov.ke'),
     westlands AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-WEST'),
     dagoretti AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-DAGO'),
     langata AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-LANG'),
     kasarani AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-KASA'),
     embakasi AS (SELECT zone_id FROM zone WHERE zone_code = 'NBO-EMBA')

INSERT INTO taxpayer_record (record_type_id, taxpayer_name, taxpayer_phone, taxpayer_email, taxpayer_id_no, zone_id, status_id, latitude, longitude, submitted_by)
SELECT 
  v.record_type_id, v.name, v.phone, v.email, v.id_no, v.zone_id, v.status_id, v.lat, v.lon, v.user_id
FROM (VALUES
  -- Westlands Residential (10 records)
  ((SELECT record_type_id FROM rt_residential), 'Ahmed Hassan Ibrahim', '0722100001', 'ahmed.hassan@email.com', 'ID001', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2921, 36.8219, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_residential), 'Fatima Mohamed Ali', '0722100002', 'fatima.ali@email.com', 'ID002', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2925, 36.8225, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_residential), 'John Wamboi Mwangi', '0722100003', 'john.mwangi@email.com', 'ID003', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2930, 36.8230, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_residential), 'Mary Karimi Njoro', '0722100004', 'mary.njoro@email.com', 'ID004', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_pending), -1.2935, 36.8235, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_commercial), 'Priya Patel Investment Ltd', '0722100005', 'priya@patelinvest.com', 'BRN001', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2940, 36.8240, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_commercial), 'Tech Solutions Kenya', '0722100006', 'info@techsol.com', 'BRN002', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2945, 36.8245, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_business), 'Karura Supermarket', '0722100007', 'karura@supermarket.com', 'ID005', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2950, 36.8250, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_business), 'Kilimani Clinic', '0722100008', 'info@kilimani-clinic.com', 'ID006', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2955, 36.8255, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_kiosk), 'Samuel Kipchoge Kiosk', '0722100009', 'samuel.kiosk@email.com', 'ID007', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2960, 36.8260, (SELECT user_id FROM user_peter)),
  ((SELECT record_type_id FROM rt_market), 'Karura Market Stall 101', '0722100010', 'market101@email.com', 'STALL001', (SELECT zone_id FROM westlands), (SELECT status_id FROM status_active), -1.2965, 36.8265, (SELECT user_id FROM user_peter)),

  -- Dagoretti Residential & Commercial (10 records)
  ((SELECT record_type_id FROM rt_residential), 'James Ochieng Otieno', '0722200001', 'james.otieno@email.com', 'ID008', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3021, 36.7619, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_residential), 'Lucy Wanjiru Kariuki', '0722200002', 'lucy.kariuki@email.com', 'ID009', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3025, 36.7625, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_commercial), 'Riruta Shopping Centre', '0722200003', 'riruta@shopping.com', 'BRN003', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3030, 36.7630, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_business), 'Riruta Hardware Store', '0722200004', 'hardware@riruta.com', 'ID010', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3035, 36.7635, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_residential), 'David Kiplagat Chepkwony', '0722200005', 'david.chepkwony@email.com', 'ID011', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_pending), -1.3040, 36.7640, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_residential), 'Esther Nyambura Kimani', '0722200006', 'esther.kimani@email.com', 'ID012', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3045, 36.7645, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_market), 'Mutuini Market Stall 45', '0722200007', 'mutuini45@email.com', 'STALL002', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3050, 36.7650, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_kiosk), 'Francis Kipchoge Kiosk 2', '0722200008', 'francis.kiosk@email.com', 'ID013', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3055, 36.7655, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_business), 'Mutuini Pharmacy', '0722200009', 'mutuini@pharmacy.com', 'ID014', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3060, 36.7660, (SELECT user_id FROM user_michael)),
  ((SELECT record_type_id FROM rt_residential), 'Rose Mwangi Omondi', '0722200010', 'rose.omondi@email.com', 'ID015', (SELECT zone_id FROM dagoretti), (SELECT status_id FROM status_active), -1.3065, 36.7665, (SELECT user_id FROM user_michael)),

  -- Langata Residential & Commercial (10 records)
  ((SELECT record_type_id FROM rt_residential), 'Peter Njoroge Kariuki', '0722300001', 'peter.njoroge@email.com', 'ID016', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3521, 36.6619, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_residential), 'Beatrice Achieng Kipchoge', '0722300002', 'beatrice.kipchoge@email.com', 'ID017', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3525, 36.6625, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_residential), 'Charles Kipkemei Cheruyot', '0722300003', 'charles.cheruyot@email.com', 'ID018', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3530, 36.6630, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_commercial), 'Karen Shopping Mall', '0722300004', 'karen@mall.com', 'BRN004', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3535, 36.6635, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_business), 'Karen Restaurant', '0722300005', 'karen@restaurant.com', 'ID019', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3540, 36.6640, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_residential), 'Naomi Kiplagat Koech', '0722300006', 'naomi.koech@email.com', 'ID020', (SELECT zone_id FROM langata), (SELECT status_id FROM status_pending), -1.3545, 36.6645, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_market), 'Kibera Market Stall 12', '0722300007', 'kibera12@email.com', 'STALL003', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3550, 36.6650, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_business), 'Kibera Grocery', '0722300008', 'kibera@grocery.com', 'ID021', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3555, 36.6655, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_kiosk), 'Henry Kiplagat Kiosk 3', '0722300009', 'henry.kiosk@email.com', 'ID022', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3560, 36.6660, (SELECT user_id FROM user_robert)),
  ((SELECT record_type_id FROM rt_residential), 'Susan Njeri Mwangi', '0722300010', 'susan.mwangi@email.com', 'ID023', (SELECT zone_id FROM langata), (SELECT status_id FROM status_active), -1.3565, 36.6665, (SELECT user_id FROM user_robert)),

  -- Kasarani Residential & Commercial (10 records)
  ((SELECT record_type_id FROM rt_residential), 'Victor Kipchoge Sang', '0722400001', 'victor.sang@email.com', 'ID024', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2821, 36.8919, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_residential), 'Grace Mutua Ntombela', '0722400002', 'grace.ntombela@email.com', 'ID025', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2825, 36.8925, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_commercial), 'Kasarani Business Hub', '0722400003', 'kasarani@hub.com', 'BRN005', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2830, 36.8930, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_business), 'Kasarani Hospital', '0722400004', 'kasarani@hospital.com', 'ID026', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2835, 36.8935, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_residential), 'Margaret Kiplagat Sigei', '0722400005', 'margaret.sigei@email.com', 'ID027', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_pending), -1.2840, 36.8940, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_market), 'Mathare Market Stall 33', '0722400006', 'mathare33@email.com', 'STALL004', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2845, 36.8945, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_residential), 'Kenneth Kiprotich Kipchoe', '0722400007', 'kenneth.kipchoe@email.com', 'ID028', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2850, 36.8950, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_business), 'Kasarani Clinic', '0722400008', 'kasarani@clinic.com', 'ID029', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2855, 36.8955, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_kiosk), 'Prosper Kiplagat Kiosk 4', '0722400009', 'prosper.kiosk@email.com', 'ID030', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2860, 36.8960, (SELECT user_id FROM user_samuel)),
  ((SELECT record_type_id FROM rt_residential), 'Patricia Muthoni Kariuki', '0722400010', 'patricia.kariuki@email.com', 'ID031', (SELECT zone_id FROM kasarani), (SELECT status_id FROM status_active), -1.2865, 36.8965, (SELECT user_id FROM user_samuel)),

  -- Embakasi Residential & Commercial (10 records)
  ((SELECT record_type_id FROM rt_residential), 'Kamal Hassan Abdullahi', '0722500001', 'kamal.abdullahi@email.com', 'ID032', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3221, 36.9019, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_residential), 'Zainab Mohamed Ibrahim', '0722500002', 'zainab.ibrahim@email.com', 'ID033', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3225, 36.9025, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_commercial), 'Embakasi Trade Centre', '0722500003', 'embakasi@trade.com', 'BRN006', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3230, 36.9030, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_business), 'Embakasi Construction Ltd', '0722500004', 'embakasi@construction.com', 'ID034', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3235, 36.9035, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_residential), 'Mohammed Amin Ali', '0722500005', 'mohammed.ali@email.com', 'ID035', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_pending), -1.3240, 36.9040, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_market), 'Pipeline Market Stall 67', '0722500006', 'pipeline67@email.com', 'STALL005', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3245, 36.9045, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_residential), 'Amina Hassan Mohamed', '0722500007', 'amina.mohamed@email.com', 'ID036', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3250, 36.9050, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_business), 'Embakasi Supermarket', '0722500008', 'embakasi@super.com', 'ID037', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3255, 36.9055, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_kiosk), 'Hassan Kiplagat Kiosk 5', '0722500009', 'hassan.kiosk@email.com', 'ID038', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3260, 36.9060, (SELECT user_id FROM user_thomas)),
  ((SELECT record_type_id FROM rt_residential), 'Fatima Ali Hassan', '0722500010', 'fatima.hassan@email.com', 'ID039', (SELECT zone_id FROM embakasi), (SELECT status_id FROM status_active), -1.3265, 36.9065, (SELECT user_id FROM user_thomas))
) v(record_type_id, name, phone, email, id_no, zone_id, status_id, lat, lon, user_id)
WHERE NOT EXISTS (SELECT 1 FROM taxpayer_record WHERE taxpayer_email = v.email)
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. FEE ASSIGNMENTS (For all taxpayer records)
-- ──────────────────────────────────────────────────────────────────────────

WITH assignments AS (
  SELECT 
    tr.record_id,
    fs.schedule_id,
    u.user_id,
    fs.amount,
    (CURRENT_DATE + INTERVAL '12 months')::DATE as due_date,
    2025 as billing_year
  FROM taxpayer_record tr
  JOIN fee_schedule fs ON fs.record_type_id = tr.record_type_id 
    AND fs.zone_id = (SELECT zone_id FROM zone WHERE zone_code = 'NBO-COUNTY')
    AND fs.schedule_name LIKE '%2025%'
  JOIN users u ON u.email = 'susan.muthoni@nairobi.gov.ke'
  WHERE NOT EXISTS (
    SELECT 1 FROM fee_assignment fa 
    WHERE fa.record_id = tr.record_id AND fa.schedule_id = fs.schedule_id
  )
)
INSERT INTO fee_assignment (record_id, schedule_id, assigned_by, amount_due, due_date, billing_year)
SELECT record_id, schedule_id, user_id, amount, due_date, billing_year
FROM assignments;

-- ──────────────────────────────────────────────────────────────────────────
-- 7. DEMAND NOTICES (Generate for all fee assignments)
-- ──────────────────────────────────────────────────────────────────────────

WITH notice_gen AS (
  SELECT 
    fa.assignment_id,
    fa.record_id,
    fa.amount_due,
    CURRENT_DATE::DATE as issued_date,
    fa.due_date,
    u.user_id,
    'NBO-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(ROW_NUMBER() OVER (ORDER BY fa.assignment_id)::TEXT, 6, '0') as notice_number
  FROM fee_assignment fa
  JOIN users u ON u.email = 'susan.muthoni@nairobi.gov.ke'
  WHERE NOT EXISTS (
    SELECT 1 FROM demand_notice dn 
    WHERE dn.assignment_id = fa.assignment_id
  )
)
INSERT INTO demand_notice (record_id, assignment_id, notice_number, amount_due, issued_date, due_date, notice_status, generated_by)
SELECT record_id, assignment_id, notice_number, amount_due, issued_date, due_date, 'issued', user_id
FROM notice_gen;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. PAYMENTS (Record payments for some notices)
-- ──────────────────────────────────────────────────────────────────────────

WITH payment_records AS (
  SELECT 
    dn.notice_id,
    dn.record_id,
    dn.amount_due * 0.8 as amount_paid,  -- 80% payment
    u.user_id,
    'NBO-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(ROW_NUMBER() OVER (ORDER BY dn.notice_id)::TEXT, 6, '0') as receipt_number
  FROM demand_notice dn
  JOIN users u ON u.email = 'susan.muthoni@nairobi.gov.ke'
  WHERE NOT EXISTS (
    SELECT 1 FROM payment p 
    WHERE p.notice_id = dn.notice_id
  )
  LIMIT 25  -- Record payments for first 25 notices
)
INSERT INTO payment (notice_id, record_id, amount_paid, payment_method, payment_date, receipt_number, recorded_by, notes)
SELECT 
  notice_id, 
  record_id, 
  amount_paid, 
  'mpesa'::VARCHAR(30), 
  (CURRENT_DATE - INTERVAL '5 days')::TIMESTAMPTZ,
  receipt_number,
  user_id,
  'Payment recorded via M-Pesa'
FROM payment_records;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. RECORD ATTRIBUTES (Add flexible attributes to selected records)
-- ──────────────────────────────────────────────────────────────────────────

INSERT INTO record_attributes (record_id, attribute_key, attribute_val)
SELECT DISTINCT
  tr.record_id,
  v.attr_key,
  v.attr_val
FROM taxpayer_record tr
CROSS JOIN (VALUES
  ('property_size_sqm', '500'),
  ('building_stories', '2'),
  ('construction_year', '2015'),
  ('owner_type', 'individual')
) v(attr_key, attr_val)
WHERE NOT EXISTS (
  SELECT 1 FROM record_attributes ra 
  WHERE ra.record_id = tr.record_id AND ra.attribute_key = v.attr_key
)
LIMIT 40;

-- ──────────────────────────────────────────────────────────────────────────
-- Summary Statistics
-- ──────────────────────────────────────────────────────────────────────────
-- Run these queries to verify data has been inserted:

-- SELECT 'Zones' as table_name, COUNT(*) as record_count FROM zone
-- UNION ALL
-- SELECT 'Record Types', COUNT(*) FROM record_type
-- UNION ALL
-- SELECT 'Users', COUNT(*) FROM users
-- UNION ALL
-- SELECT 'Taxpayer Records', COUNT(*) FROM taxpayer_record
-- UNION ALL
-- SELECT 'Fee Schedules', COUNT(*) FROM fee_schedule
-- UNION ALL
-- SELECT 'Fee Assignments', COUNT(*) FROM fee_assignment
-- UNION ALL
-- SELECT 'Demand Notices', COUNT(*) FROM demand_notice
-- UNION ALL
-- SELECT 'Payments', COUNT(*) FROM payment
-- UNION ALL
-- SELECT 'Record Attributes', COUNT(*) FROM record_attributes;
