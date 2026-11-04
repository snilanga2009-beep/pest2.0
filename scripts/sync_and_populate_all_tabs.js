const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const dbPath = path.join(__dirname, '../server/data/pest_control.db');
const db = new Database(dbPath);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mabwkgcujnxiwlawpoph.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('🔄 Fetching reference data from Supabase...');

  // 1. Fetch Customers
  const { data: sbCustomers, error: cErr } = await supabase.from('customers').select('*');
  if (cErr) {
    console.error('Customer fetch error:', cErr.message);
  } else if (sbCustomers && sbCustomers.length > 0) {
    console.log(`Found ${sbCustomers.length} customers in Supabase. Syncing into SQLite...`);
    const insertCust = db.prepare(`
      INSERT INTO customers (id, customer_code, name, contact_person, phone, email, location, special_instructions, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(id) DO UPDATE SET
        customer_code = excluded.customer_code,
        name = excluded.name,
        contact_person = excluded.contact_person,
        phone = excluded.phone,
        email = excluded.email,
        location = excluded.location,
        special_instructions = excluded.special_instructions,
        is_active = excluded.is_active
    `);
    const insertMany = db.transaction((custs) => {
      for (const c of custs) {
        insertCust.run(c.id, c.customer_code, c.name, c.contact_person, c.phone, c.email, c.location, c.special_instructions, c.is_active ?? 1, c.created_at, c.updated_at);
      }
    });
    insertMany(sbCustomers);
    console.log('✅ Synced customers to SQLite.');
  }

  // 2. Fetch Customer Locations
  const { data: sbLocations, error: lErr } = await supabase.from('customer_locations').select('*');
  if (lErr) {
    console.error('Location fetch error:', lErr.message);
  } else if (sbLocations && sbLocations.length > 0) {
    console.log(`Found ${sbLocations.length} locations in Supabase. Syncing into SQLite...`);
    const insertLoc = db.prepare(`
      INSERT INTO customer_locations (id, customer_id, location_name, address, latitude, longitude, contact_person, phone, is_primary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      ON CONFLICT(id) DO UPDATE SET
        customer_id = excluded.customer_id,
        location_name = excluded.location_name,
        address = excluded.address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        contact_person = excluded.contact_person,
        phone = excluded.phone,
        is_primary = excluded.is_primary
    `);
    const insertLocMany = db.transaction((locs) => {
      for (const l of locs) {
        insertLoc.run(l.id, l.customer_id, l.location_name, l.address, l.latitude, l.longitude, l.contact_person, l.contact_phone || l.phone, l.is_primary ?? 0, l.created_at);
      }
    });
    insertLocMany(sbLocations);
    console.log('✅ Synced locations to SQLite.');
  }

  // 3. Fetch Treatments
  const { data: sbTreatments } = await supabase.from('treatments').select('*');
  if (sbTreatments && sbTreatments.length > 0) {
    console.log(`Syncing ${sbTreatments.length} treatments...`);
    const insertTreat = db.prepare(`
      INSERT INTO treatments (id, code, name, description, default_duration_minutes, color_hex, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        default_duration_minutes = excluded.default_duration_minutes,
        color_hex = excluded.color_hex,
        is_active = excluded.is_active
    `);
    const insertTreatMany = db.transaction((treats) => {
      for (const t of treats) {
        insertTreat.run(t.id, t.code, t.name, t.description, t.default_duration_minutes || 60, t.color_hex || '#3B82F6', t.is_active ?? 1);
      }
    });
    insertTreatMany(sbTreatments);
    console.log('✅ Synced treatments.');
  }

  // 4. Fetch Staff
  const { data: sbStaff } = await supabase.from('staff').select('*');
  if (sbStaff && sbStaff.length > 0) {
    console.log(`Syncing ${sbStaff.length} staff members...`);
    const insertStaff = db.prepare(`
      INSERT INTO staff (id, username, full_name, role, phone, email, is_active, password_hash, password_salt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        full_name = excluded.full_name,
        role = excluded.role,
        phone = excluded.phone,
        email = excluded.email,
        is_active = excluded.is_active,
        password_hash = COALESCE(excluded.password_hash, staff.password_hash),
        password_salt = COALESCE(excluded.password_salt, staff.password_salt)
    `);
    const insertStaffMany = db.transaction((staffList) => {
      for (const s of staffList) {
        insertStaff.run(s.id, s.username, s.full_name, s.role, s.phone, s.email, s.is_active ?? 1, s.password_hash, s.password_salt);
      }
    });
    insertStaffMany(sbStaff);
    console.log('✅ Synced staff.');
  }

  // 5. Ensure All Tabs Have Rich, Real Operational Jobs
  console.log('🌱 Populating operational jobs across all dates, statuses, and technicians...');
  const today = '2026-11-04';
  const tomorrow = '2026-11-05';
  const yesterday = '2026-11-03';
  const dayBefore = '2026-11-02';

  const customers = db.prepare('SELECT id, name, location FROM customers ORDER BY id ASC LIMIT 50').all();
  const treatments = db.prepare('SELECT id, code, name FROM treatments WHERE is_active = 1').all();
  const technicians = db.prepare("SELECT id, full_name FROM staff WHERE role = 'TECHNICIAN' AND is_active = 1").all();
  const vehicles = db.prepare('SELECT id, vehicle_number, vehicle_type FROM vehicles').all();
  const machines = db.prepare('SELECT id, machine_name FROM machines').all();

  console.log(`Available: ${customers.length} customers, ${technicians.length} technicians, ${vehicles.length} vehicles.`);

  const insertJob = db.prepare(`
    INSERT INTO jobs (
      job_code, customer_id, location_id, treatment_id, technician_id,
      salesman_id, scheduled_date, scheduled_time, duration_minutes,
      crew_count, workers_info, vehicle_id, vehicle_no, machine_id, machine_name,
      team_members, status, technician_notes, customer_confirmation_status,
      actual_start_time, actual_end_time, completed_at, postponed_to_date, reschedule_reason,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);

  // Clear existing jobs and re-seed clean realistic jobs
  db.prepare('DELETE FROM job_logs').run();
  db.prepare('DELETE FROM job_photos').run();
  db.prepare('DELETE FROM jobs').run();

  let jobSeq = 1000;
  function makeCode(d) {
    jobSeq++;
    return `JOB-${d.replace(/-/g, '')}-${jobSeq}`;
  }

  const jobsToInsert = [
    // --- TODAY: IN_PROGRESS (Nilanga & Janadara) ---
    {
      job_code: makeCode(today),
      customer_id: customers[0]?.id || 1,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: 8, // Nilanga
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '08:30',
      duration_minutes: 90,
      crew_count: 2,
      vehicle_id: vehicles[0]?.id || 1,
      vehicle_no: vehicles[0]?.vehicle_number || 'WP CAD-5120',
      machine_id: machines[0]?.id || 1,
      machine_name: machines[0]?.machine_name || 'Thermal Fogger TF-35',
      team_members: 'Nilanga (Lead), Janadara (Technician)',
      status: 'IN_PROGRESS',
      technician_notes: 'Fogging and spraying ongoing in basement area.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: '08:45',
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: ASSIGNED (Wasantha) ---
    {
      job_code: makeCode(today),
      customer_id: customers[1]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[1]?.id || 2,
      technician_id: 5, // Wasantha
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '11:00',
      duration_minutes: 60,
      crew_count: 2,
      vehicle_id: vehicles[1]?.id || 2,
      vehicle_no: vehicles[1]?.vehicle_number || 'WP CAB-8890',
      machine_id: machines[1]?.id || 2,
      machine_name: machines[1]?.machine_name || 'ULV Cold Fogger VectorFog C100',
      team_members: 'Wasantha (Technician), Tharanga',
      status: 'ASSIGNED',
      technician_notes: 'Rodent station inspection and bait replenishment.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: ASSIGNED (Janadara) ---
    {
      job_code: makeCode(today),
      customer_id: customers[2]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[4]?.id || 5,
      technician_id: 4, // Janadara
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '14:00',
      duration_minutes: 75,
      crew_count: 1,
      vehicle_id: vehicles[3]?.id || 4,
      vehicle_no: vehicles[3]?.vehicle_number || 'WP BD-7712',
      machine_id: machines[3]?.id || 4,
      machine_name: machines[3]?.machine_name || 'B&G Hand Sprayer 1 Gallon #1',
      team_members: 'Janadara (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'General pest treatment in kitchen and store room.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: ASSIGNED (Wijenayaka) ---
    {
      job_code: makeCode(today),
      customer_id: customers[3]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[2]?.id || 3,
      technician_id: 6, // Wijenayaka
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '15:30',
      duration_minutes: 60,
      crew_count: 2,
      vehicle_id: vehicles[2]?.id || 3,
      vehicle_no: vehicles[2]?.vehicle_number || 'WP DAE-3341',
      machine_id: machines[2]?.id || 3,
      machine_name: machines[2]?.machine_name || 'Motorized Mistblower Stihl SR450',
      team_members: 'Wijenayaka (Technician), Danushka',
      status: 'ASSIGNED',
      technician_notes: 'Mosquito control barrier around perimeter grounds.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: TO_BE_DONE / UNASSIGNED 1 ---
    {
      job_code: makeCode(today),
      customer_id: customers[4]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: null,
      salesman_id: null,
      scheduled_date: today,
      scheduled_time: '16:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: null,
      status: 'TO_BE_DONE',
      technician_notes: 'Urgent termite check request from reception.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: TO_BE_DONE / UNASSIGNED 2 ---
    {
      job_code: makeCode(today),
      customer_id: customers[5]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[3]?.id || 4,
      technician_id: null,
      salesman_id: null,
      scheduled_date: today,
      scheduled_time: '17:00',
      duration_minutes: 45,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: null,
      status: 'TO_BE_DONE',
      technician_notes: 'Fly trap inspection and bulb replacement.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: COMPLETED 1 ---
    {
      job_code: makeCode(today),
      customer_id: customers[6]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: 8, // Nilanga
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '07:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[5]?.id || 6,
      vehicle_no: vehicles[5]?.vehicle_number || 'FZ 9300 CAB',
      machine_id: machines[4]?.id || 5,
      machine_name: machines[4]?.machine_name || 'B&G Hand Sprayer 1 Gallon #2',
      team_members: 'Nilanga',
      status: 'COMPLETED',
      technician_notes: 'Early morning spray completed successfully. Customer signed off.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: '07:05',
      actual_end_time: '08:00',
      completed_at: `${today} 08:00:00`,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TODAY: COMPLETED 2 (Wasantha) ---
    {
      job_code: makeCode(today),
      customer_id: customers[7]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[1]?.id || 2,
      technician_id: 5, // Wasantha
      salesman_id: 7,
      scheduled_date: today,
      scheduled_time: '08:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[1]?.id || 2,
      vehicle_no: vehicles[1]?.vehicle_number || 'WP CAB-8890',
      machine_id: machines[6]?.id || 7,
      machine_name: machines[6]?.machine_name || 'Rodent Bait Station Set (Industrial)',
      team_members: 'Wasantha (Technician)',
      status: 'COMPLETED',
      technician_notes: 'All 12 rodent bait boxes checked and restocked.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: '08:05',
      actual_end_time: '08:55',
      completed_at: `${today} 08:55:00`,
      postponed_to_date: null,
      reschedule_reason: null
    },

    // --- TOMORROW: ASSIGNED (Janadara) ---
    {
      job_code: makeCode(tomorrow),
      customer_id: customers[8]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: 4, // Janadara
      salesman_id: 7,
      scheduled_date: tomorrow,
      scheduled_time: '09:00',
      duration_minutes: 90,
      crew_count: 2,
      vehicle_id: vehicles[0]?.id || 1,
      vehicle_no: vehicles[0]?.vehicle_number || 'WP CAD-5120',
      machine_id: machines[0]?.id || 1,
      machine_name: machines[0]?.machine_name || 'Thermal Fogger TF-35',
      team_members: 'Janadara (Technician), Danushka',
      status: 'ASSIGNED',
      technician_notes: 'Scheduled comprehensive pest service.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TOMORROW: ASSIGNED (Wijenayaka) ---
    {
      job_code: makeCode(tomorrow),
      customer_id: customers[9]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[2]?.id || 3,
      technician_id: 6, // Wijenayaka
      salesman_id: 7,
      scheduled_date: tomorrow,
      scheduled_time: '11:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[3]?.id || 4,
      vehicle_no: vehicles[3]?.vehicle_number || 'WP BD-7712',
      machine_id: machines[2]?.id || 3,
      machine_name: machines[2]?.machine_name || 'Motorized Mistblower Stihl SR450',
      team_members: 'Wijenayaka (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'Pre-event mosquito fogging.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TOMORROW: ASSIGNED (Nilanga) ---
    {
      job_code: makeCode(tomorrow),
      customer_id: customers[10]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[4]?.id || 5,
      technician_id: 8, // Nilanga
      salesman_id: 7,
      scheduled_date: tomorrow,
      scheduled_time: '13:30',
      duration_minutes: 60,
      crew_count: 2,
      vehicle_id: vehicles[5]?.id || 6,
      vehicle_no: vehicles[5]?.vehicle_number || 'FZ 9300 CAB',
      machine_id: machines[3]?.id || 4,
      machine_name: machines[3]?.machine_name || 'B&G Hand Sprayer 1 Gallon #1',
      team_members: 'Nilanga (Lead), Wasantha (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'Factory warehouse spray & rodent survey.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- TOMORROW: TO_BE_DONE / UNASSIGNED ---
    {
      job_code: makeCode(tomorrow),
      customer_id: customers[11]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: null,
      salesman_id: null,
      scheduled_date: tomorrow,
      scheduled_time: '15:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: null,
      status: 'TO_BE_DONE',
      technician_notes: 'Needs technician assignment for commercial site.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },

    // --- OVERDUE: YESTERDAY TO_BE_DONE ---
    {
      job_code: makeCode(yesterday),
      customer_id: customers[12]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: null,
      salesman_id: null,
      scheduled_date: yesterday,
      scheduled_time: '10:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: null,
      status: 'TO_BE_DONE',
      technician_notes: 'Overdue service requiring immediate dispatch.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    // --- OVERDUE: DAY BEFORE YESTERDAY ASSIGNED (Wasantha) ---
    {
      job_code: makeCode(dayBefore),
      customer_id: customers[13]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[1]?.id || 2,
      technician_id: 5, // Wasantha
      salesman_id: 7,
      scheduled_date: dayBefore,
      scheduled_time: '14:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[1]?.id || 2,
      vehicle_no: vehicles[1]?.vehicle_number || 'WP CAB-8890',
      machine_id: machines[6]?.id || 7,
      machine_name: machines[6]?.machine_name || 'Rodent Bait Station Set (Industrial)',
      team_members: 'Wasantha (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'Customer gate was locked. Follow-up required.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },

    // --- POSTPONED JOB ---
    {
      job_code: makeCode(yesterday),
      customer_id: customers[14]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: 4, // Janadara
      salesman_id: 7,
      scheduled_date: yesterday,
      scheduled_time: '10:30',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[0]?.id || 1,
      vehicle_no: vehicles[0]?.vehicle_number || 'WP CAD-5120',
      machine_id: machines[0]?.id || 1,
      machine_name: machines[0]?.machine_name || 'Thermal Fogger TF-35',
      team_members: 'Janadara (Technician)',
      status: 'POSTPONED',
      technician_notes: 'Client requested postponement due to building renovation.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: '2026-11-10',
      reschedule_reason: 'Client renovation ongoing until Nov 10.'
    },

    // --- CANCELLED JOB ---
    {
      job_code: makeCode(dayBefore),
      customer_id: customers[15]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[3]?.id || 4,
      technician_id: 6, // Wijenayaka
      salesman_id: 7,
      scheduled_date: dayBefore,
      scheduled_time: '16:00',
      duration_minutes: 45,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: 'Wijenayaka (Technician)',
      status: 'CANCELLED',
      technician_notes: 'Duplicate booking cancelled upon manager review.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: 'Duplicate entry.'
    },

    // --- FUTURE UPCOMING JOBS (Nov 8, 9, 12, 15, 20) across all technicians ---
    {
      job_code: makeCode('2026-11-08'),
      customer_id: customers[16]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[0]?.id || 1,
      technician_id: 8, // Nilanga
      salesman_id: 7,
      scheduled_date: '2026-11-08',
      scheduled_time: '09:00',
      duration_minutes: 90,
      crew_count: 2,
      vehicle_id: vehicles[5]?.id || 6,
      vehicle_no: vehicles[5]?.vehicle_number || 'FZ 9300 CAB',
      machine_id: machines[0]?.id || 1,
      machine_name: machines[0]?.machine_name || 'Thermal Fogger TF-35',
      team_members: 'Nilanga, Janadara',
      status: 'ASSIGNED',
      technician_notes: 'Fortnightly general pest maintenance.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    {
      job_code: makeCode('2026-11-09'),
      customer_id: customers[17]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[1]?.id || 2,
      technician_id: 5, // Wasantha
      salesman_id: 7,
      scheduled_date: '2026-11-09',
      scheduled_time: '10:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[1]?.id || 2,
      vehicle_no: vehicles[1]?.vehicle_number || 'WP CAB-8890',
      machine_id: machines[6]?.id || 7,
      machine_name: machines[6]?.machine_name || 'Rodent Bait Station Set (Industrial)',
      team_members: 'Wasantha (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'Monthly rodent control inspection.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    {
      job_code: makeCode('2026-11-12'),
      customer_id: customers[18]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[2]?.id || 3,
      technician_id: 6, // Wijenayaka
      salesman_id: 7,
      scheduled_date: '2026-11-12',
      scheduled_time: '14:00',
      duration_minutes: 60,
      crew_count: 1,
      vehicle_id: vehicles[2]?.id || 3,
      vehicle_no: vehicles[2]?.vehicle_number || 'WP DAE-3341',
      machine_id: machines[2]?.id || 3,
      machine_name: machines[2]?.machine_name || 'Motorized Mistblower Stihl SR450',
      team_members: 'Wijenayaka (Technician)',
      status: 'ASSIGNED',
      technician_notes: 'Outdoor mosquito spray.',
      customer_confirmation_status: 'CONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    },
    {
      job_code: makeCode('2026-11-15'),
      customer_id: customers[19]?.id || customers[0]?.id,
      location_id: 1,
      treatment_id: treatments[4]?.id || 5,
      technician_id: null,
      salesman_id: null,
      scheduled_date: '2026-11-15',
      scheduled_time: '09:00',
      duration_minutes: 90,
      crew_count: 1,
      vehicle_id: null,
      vehicle_no: null,
      machine_id: null,
      machine_name: null,
      team_members: null,
      status: 'TO_BE_DONE',
      technician_notes: 'Scheduled monthly full spectrum treatment.',
      customer_confirmation_status: 'UNCONFIRMED',
      actual_start_time: null,
      actual_end_time: null,
      completed_at: null,
      postponed_to_date: null,
      reschedule_reason: null
    }
  ];

  const insertAll = db.transaction((list) => {
    for (const j of list) {
      insertJob.run(
        j.job_code, j.customer_id, j.location_id, j.treatment_id, j.technician_id,
        j.salesman_id, j.scheduled_date, j.scheduled_time, j.duration_minutes,
        j.crew_count, null, j.vehicle_id, j.vehicle_no, j.machine_id, j.machine_name,
        j.team_members, j.status, j.technician_notes, j.customer_confirmation_status,
        j.actual_start_time, j.actual_end_time, j.completed_at, j.postponed_to_date, j.reschedule_reason
      );
    }
  });

  insertAll(jobsToInsert);
  console.log(`✅ Successfully inserted ${jobsToInsert.length} operational jobs across all tabs and statuses!`);

  // Verify status breakdown
  const stats = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status
  `).all();
  console.log('📊 Status Breakdown in SQLite:', stats);

  const dateStats = db.prepare(`
    SELECT scheduled_date, COUNT(*) as cnt FROM jobs GROUP BY scheduled_date ORDER BY scheduled_date ASC
  `).all();
  console.log('📅 Date Breakdown in SQLite:', dateStats);

  const techStats = db.prepare(`
    SELECT technician_id, COUNT(*) as cnt FROM jobs GROUP BY technician_id
  `).all();
  console.log('👷 Technician Breakdown in SQLite:', techStats);
}

run().catch(console.error);
