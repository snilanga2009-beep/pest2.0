const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateJobCode, handleJobCompletion, formatDateColombo } = require('../services/recurringEngine');
const { sendSMS, buildTechDispatchMessage, getSmsSettings } = require('../services/smsGateway');
const {
  notifyJobAssigned,
  notifyJobUpdated,
  notifyJobCancelled,
  notifyJobPostponed
} = require('../services/pushNotificationService');

/**
 * Helper to dispatch unexpiring job start link via SMS to assigned technician
 */
async function dispatchTechSmsIfAssigned(jobId, techId, customUrl) {
  if (!techId) return null;
  try {
    const tech = db.prepare('SELECT * FROM staff WHERE id = ?').get(techId);
    if (!tech || !tech.phone) {
      console.warn(`[SMS Dispatch] Tech #${techId} has no phone number configured.`);
      return { success: false, error: 'Technician has no phone number' };
    }

    const job = db.prepare(`
      SELECT j.*,
             COALESCE(c.name, 'Customer') as customer_name,
             c.phone as customer_phone,
             l.location_name,
             l.address as location_address,
             COALESCE(t.code, 'TREATMENT') as treatment_code
      FROM jobs j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      LEFT JOIN treatments t ON j.treatment_id = t.id
      WHERE j.id = ?
    `).get(jobId);

    if (!job) {
      console.warn(`[SMS Dispatch] Job #${jobId} not found.`);
      return { success: false, error: 'Job not found' };
    }

    const settings = getSmsSettings();
    const baseUrl = (customUrl || settings.system_url || 'http://localhost:5000').replace(/\/$/, '');
    const messageText = buildTechDispatchMessage({ ...job, technician_name: tech.full_name }, baseUrl);

    console.log(`[SMS Dispatch] Auto-sending job link SMS to ${tech.full_name} (${tech.phone}) for Job #${job.job_code}`);
    const smsRes = await sendSMS({
      to: tech.phone,
      message: messageText,
      jobId: job.id,
      recipientName: tech.full_name
    });

    console.log(`[SMS Dispatch] Result for Job #${job.job_code}:`, JSON.stringify(smsRes));
    return smsRes;
  } catch (err) {
    console.error(`Auto dispatch SMS error for Job #${jobId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// List jobs with query filters and full database status/technician counts
router.get('/', (req, res) => {
  try {
    const cleanParam = (val) => {
      if (val === undefined || val === null || val === 'undefined' || val === 'null' || !String(val).trim()) return undefined;
      return String(val).trim();
    };

    const date = cleanParam(req.query.date);
    const from_date = cleanParam(req.query.from_date);
    const to_date = cleanParam(req.query.to_date);
    const status = cleanParam(req.query.status);
    const technician_id = cleanParam(req.query.technician_id);
    const assignment = cleanParam(req.query.assignment);
    const customer_id = cleanParam(req.query.customer_id);
    const treatment_id = cleanParam(req.query.treatment_id);
    const vehicle_no = cleanParam(req.query.vehicle_no);
    const machine_name = cleanParam(req.query.machine_name);
    const search = cleanParam(req.query.search);
    const limit = req.query.limit;
    const page = req.query.page;

    const today = formatDateColombo(new Date());
    const tomorrowObj = new Date(today);
    tomorrowObj.setDate(tomorrowObj.getDate() + 1);
    const tomorrow = formatDateColombo(tomorrowObj);

    const parsedLimit = Math.min(5000, Math.max(1, parseInt(limit, 10) || 500));
    const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * parsedLimit;

    // 1. Base filters (Date, Range, Customer, Treatment, Vehicle, Machine, Search)
    // Used for computing technician counts before technician_id is applied
    const scopeWhere = ['1=1'];
    const scopeParams = [];

    if (date) {
      scopeWhere.push(`(CASE WHEN j.status = 'POSTPONED' AND j.postponed_to_date IS NOT NULL AND j.postponed_to_date != '' THEN substr(j.postponed_to_date, 1, 10) ELSE substr(j.scheduled_date, 1, 10) END) = ?`);
      scopeParams.push(date);
    }
    if (from_date) {
      scopeWhere.push('j.scheduled_date >= ?');
      scopeParams.push(from_date);
    }
    if (to_date) {
      scopeWhere.push('j.scheduled_date <= ?');
      scopeParams.push(to_date);
    }
    if (customer_id) {
      scopeWhere.push('j.customer_id = ?');
      scopeParams.push(customer_id);
    }
    if (treatment_id) {
      scopeWhere.push('j.treatment_id = ?');
      scopeParams.push(treatment_id);
    }
    if (vehicle_no) {
      scopeWhere.push('(j.vehicle_no = ? OR v.vehicle_number = ?)');
      scopeParams.push(vehicle_no, vehicle_no);
    }
    if (machine_name) {
      scopeWhere.push('(j.machine_name = ? OR m.machine_type = ?)');
      scopeParams.push(machine_name, machine_name);
    }
    if (search && String(search).trim()) {
      scopeWhere.push(`(
        j.job_code LIKE ? OR
        c.name LIKE ? OR
        c.customer_code LIKE ? OR
        c.phone LIKE ? OR
        l.location_name LIKE ? OR
        l.address LIKE ? OR
        t.code LIKE ? OR
        t.name LIKE ? OR
        tech.full_name LIKE ? OR
        j.vehicle_no LIKE ? OR
        v.vehicle_number LIKE ? OR
        j.machine_name LIKE ?
      )`);
      const q = `%${String(search).trim()}%`;
      scopeParams.push(q, q, q, q, q, q, q, q, q, q, q, q);
    }

    const baseFromJoin = `
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      JOIN treatments t ON j.treatment_id = t.id
      LEFT JOIN staff tech ON j.technician_id = tech.id
      LEFT JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN machines m ON j.machine_id = m.id
    `;

    // Compute per-technician counts within the current date horizon scope
    const techScopeWhere = ['1=1'];
    const techScopeParams = [];
    if (date) {
      techScopeWhere.push(`(CASE WHEN j.status = 'POSTPONED' AND j.postponed_to_date IS NOT NULL AND j.postponed_to_date != '' THEN substr(j.postponed_to_date, 1, 10) ELSE substr(j.scheduled_date, 1, 10) END) = ?`);
      techScopeParams.push(date);
    }
    if (from_date) {
      techScopeWhere.push('j.scheduled_date >= ?');
      techScopeParams.push(from_date);
    }
    if (to_date) {
      techScopeWhere.push('j.scheduled_date <= ?');
      techScopeParams.push(to_date);
    }

    const activeTechnicians = db.prepare("SELECT id, full_name, username FROM staff WHERE role = 'TECHNICIAN' AND is_active = 1").all();
    const byTechnician = {};

    for (const tech of activeTechnicians) {
      const cleanName = tech.full_name ? tech.full_name.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
      const tCount = db.prepare(`
        SELECT COUNT(*) as count
        ${baseFromJoin}
        WHERE ${techScopeWhere.join(' AND ')}
        AND (
          j.technician_id = ? OR
          j.team_members LIKE ? OR
          j.team_members LIKE ? OR
          j.team_members LIKE ?
        )
      `).get(...techScopeParams, tech.id, `%${tech.full_name}%`, `%${cleanName}%`, `%${tech.username}%`).count;
      byTechnician[tech.id] = tCount;
    }

    const scopeUnassigned = db.prepare(`
      SELECT COUNT(*) as count
      ${baseFromJoin}
      WHERE ${techScopeWhere.join(' AND ')}
      AND j.technician_id IS NULL AND (j.team_members IS NULL OR trim(j.team_members) = '') AND j.status != 'CANCELLED'
    `).get(...techScopeParams).count;

    const scopeTotal = db.prepare(`
      SELECT COUNT(*) as count
      ${baseFromJoin}
      WHERE ${techScopeWhere.join(' AND ')}
    `).get(...techScopeParams).count;

    // 2. Add Technician & Assignment filters for KPI status breakdown
    const kpiWhere = [...scopeWhere];
    const kpiParams = [];

    if (technician_id) {
      const targetTech = db.prepare('SELECT id, full_name, username FROM staff WHERE id = ?').get(technician_id);
      if (targetTech) {
        const cleanName = targetTech.full_name ? targetTech.full_name.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
        kpiWhere.push('(j.technician_id = ? OR j.team_members LIKE ? OR j.team_members LIKE ? OR j.team_members LIKE ?)');
        kpiParams.push(technician_id, `%${targetTech.full_name}%`, `%${cleanName}%`, `%${targetTech.username}%`);
      } else {
        kpiWhere.push('j.technician_id = ?');
        kpiParams.push(technician_id);
      }
    }
    if (assignment === 'ASSIGNED') {
      kpiWhere.push("(j.technician_id IS NOT NULL OR (j.team_members IS NOT NULL AND trim(j.team_members) != ''))");
    } else if (assignment === 'UNASSIGNED') {
      kpiWhere.push("(j.technician_id IS NULL AND (j.team_members IS NULL OR trim(j.team_members) = '') AND j.status != 'CANCELLED')");
    }

    // Combine scopeParams and technician/assignment params for kpi query
    const allKpiFilterParams = [...scopeParams, ...kpiParams];
    const kpiSql = kpiWhere.join(' AND ');
    const kpiRow = db.prepare(`
      SELECT
        COUNT(*) as total_all,
        SUM(CASE WHEN j.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN j.status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN j.status IN ('TO_BE_DONE', 'ASSIGNED', 'CONFIRMED', 'PENDING') AND j.status NOT IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN j.status = 'ASSIGNED' OR (j.technician_id IS NOT NULL AND j.status IN ('TO_BE_DONE', 'ASSIGNED', 'CONFIRMED')) THEN 1 ELSE 0 END) as assigned,
        SUM(CASE WHEN (j.status = 'TO_BE_DONE' OR j.status = 'PENDING') AND j.technician_id IS NULL THEN 1 ELSE 0 END) as to_be_done,
        SUM(CASE WHEN j.status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN j.status = 'POSTPONED' THEN 1 ELSE 0 END) as postponed,
        SUM(CASE WHEN j.status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN j.technician_id IS NULL AND (j.team_members IS NULL OR trim(j.team_members) = '') AND j.status != 'CANCELLED' THEN 1 ELSE 0 END) as unassigned,
        SUM(CASE WHEN j.scheduled_date < ? AND j.status IN ('TO_BE_DONE', 'ASSIGNED', 'CONFIRMED', 'PENDING') THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN j.scheduled_date >= ? AND j.customer_confirmation_status = 'UNCONFIRMED' AND j.status NOT IN ('COMPLETED', 'CANCELLED') THEN 1 ELSE 0 END) as unconfirmed
      ${baseFromJoin}
      WHERE ${kpiSql}
    `).get(today, today, ...allKpiFilterParams) || {};

    // Global Today & Tomorrow counts (respecting technician_id only if explicitly in technician role)
    const isTechRole = req.query.role === 'TECHNICIAN';
    const dateCountWhere = (technician_id && isTechRole) ? 'WHERE j.technician_id = ? AND ' : 'WHERE ';
    const dateCountParams = (technician_id && isTechRole) ? [technician_id] : [];
    const todayTotalCount = db.prepare(`
      SELECT COUNT(*) as count FROM jobs j
      ${dateCountWhere} (CASE WHEN j.status = 'POSTPONED' AND j.postponed_to_date IS NOT NULL AND j.postponed_to_date != '' THEN substr(j.postponed_to_date, 1, 10) ELSE substr(j.scheduled_date, 1, 10) END) = ?
    `).get(...dateCountParams, today).count;

    const tomorrowTotalCount = db.prepare(`
      SELECT COUNT(*) as count FROM jobs j
      ${dateCountWhere} (CASE WHEN j.status = 'POSTPONED' AND j.postponed_to_date IS NOT NULL AND j.postponed_to_date != '' THEN substr(j.postponed_to_date, 1, 10) ELSE substr(j.scheduled_date, 1, 10) END) = ?
    `).get(...dateCountParams, tomorrow).count;

    const allDatesTotalCount = db.prepare(`
      SELECT COUNT(*) as count FROM jobs j
      ${(technician_id && isTechRole) ? 'WHERE j.technician_id = ?' : ''}
    `).get(...dateCountParams).count;

    // 3. Final Query Filters (including status)
    const whereClauses = [...kpiWhere];
    const params = [...allKpiFilterParams];

    if (status) {
      const st = String(status).toUpperCase();
      if (st === 'PENDING') {
        whereClauses.push("j.status IN ('TO_BE_DONE', 'ASSIGNED', 'CONFIRMED', 'PENDING')");
      } else if (st === 'ASSIGNED') {
        whereClauses.push("(j.status = 'ASSIGNED' OR (j.technician_id IS NOT NULL AND j.status NOT IN ('COMPLETED', 'CANCELLED')))");
      } else if (st === 'TO_BE_DONE') {
        whereClauses.push("(j.status = 'TO_BE_DONE' OR (j.status = 'PENDING' AND j.technician_id IS NULL))");
      } else if (st === 'OVERDUE') {
        whereClauses.push("j.scheduled_date < ? AND j.status IN ('TO_BE_DONE', 'ASSIGNED', 'CONFIRMED', 'PENDING')");
        params.push(today);
      } else if (st === 'UNCONFIRMED') {
        whereClauses.push("j.scheduled_date >= ? AND j.customer_confirmation_status = 'UNCONFIRMED' AND j.status NOT IN ('COMPLETED', 'CANCELLED')");
        params.push(today);
      } else {
        whereClauses.push('j.status = ?');
        params.push(st);
      }
    }

    const whereSql = whereClauses.join(' AND ');

    const total = db.prepare(`
      SELECT COUNT(*) as count
      ${baseFromJoin}
      WHERE ${whereSql}
    `).get(...params).count;

    const orderByClause = (status && String(status).toUpperCase() === 'COMPLETED')
      ? 'ORDER BY COALESCE(j.actual_end_time, j.completed_at, j.scheduled_date) DESC, j.id DESC'
      : `ORDER BY CASE WHEN j.status = 'IN_PROGRESS' THEN 0 ELSE 1 END ASC, j.scheduled_date ASC, j.scheduled_time ASC, j.id ASC`;

    const jobs = db.prepare(`
      SELECT j.*,
             c.name as customer_name, c.customer_code, c.phone as customer_phone,
             c.contact_person, c.special_instructions,
             l.location_name, l.address as location_address, l.latitude, l.longitude,
             t.code as treatment_code, t.name as treatment_name, t.color_hex as treatment_color,
             tech.full_name as technician_name, tech.phone as technician_phone,
             sales.full_name as salesman_name,
             r.frequency as recurring_frequency,
             v.vehicle_type, v.vehicle_number,
             m.machine_type
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      JOIN treatments t ON j.treatment_id = t.id
      LEFT JOIN staff tech ON j.technician_id = tech.id
      LEFT JOIN staff sales ON j.salesman_id = sales.id
      LEFT JOIN recurring_services r ON j.recurring_service_id = r.id
      LEFT JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN machines m ON j.machine_id = m.id
      WHERE ${whereSql}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `).all(...params, parsedLimit, offset);

    res.json({
      success: true,
      total,
      page: parseInt(page, 10),
      limit: parsedLimit,
      counts: {
        all: kpiRow.total_all || 0,
        in_progress: kpiRow.in_progress || 0,
        completed: kpiRow.completed || 0,
        pending: kpiRow.pending || 0,
        assigned: kpiRow.assigned || 0,
        to_be_done: kpiRow.to_be_done || 0,
        confirmed: kpiRow.confirmed || 0,
        postponed: kpiRow.postponed || 0,
        cancelled: kpiRow.cancelled || 0,
        unassigned: kpiRow.unassigned || 0,
        overdue: kpiRow.overdue || 0,
        unconfirmed: kpiRow.unconfirmed || 0,
        scope_total: scopeTotal,
        scope_unassigned: scopeUnassigned,
        today_jobs: todayTotalCount,
        tomorrow_jobs: tomorrowTotalCount,
        all_dates_jobs: allDatesTotalCount,
        by_technician: byTechnician
      },
      jobs
    });
  } catch (err) {
    console.error('Error in GET /api/jobs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get job details with photos and logs
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const job = db.prepare(`
    SELECT j.*,
           c.name as customer_name, c.customer_code, c.phone as customer_phone,
           c.contact_person, c.address as customer_address, c.special_instructions,
           l.location_name, l.address as location_address, l.latitude, l.longitude,
           t.code as treatment_code, t.name as treatment_name, t.color_hex as treatment_color,
           tech.full_name as technician_name, tech.phone as technician_phone,
           sales.full_name as salesman_name,
           r.frequency as recurring_frequency, r.preferred_day, r.preferred_time,
           v.vehicle_type, v.vehicle_number,
           m.machine_type
    FROM jobs j
    JOIN customers c ON j.customer_id = c.id
    LEFT JOIN customer_locations l ON j.location_id = l.id
    JOIN treatments t ON j.treatment_id = t.id
    LEFT JOIN staff tech ON j.technician_id = tech.id
    LEFT JOIN staff sales ON j.salesman_id = sales.id
    LEFT JOIN recurring_services r ON j.recurring_service_id = r.id
    LEFT JOIN vehicles v ON j.vehicle_id = v.id
    LEFT JOIN machines m ON j.machine_id = m.id
    WHERE j.id = ? OR j.job_code = ?
  `).get(id, id);

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  const photos = db.prepare('SELECT * FROM job_photos WHERE job_id = ? ORDER BY created_at ASC').all(job.id);
  const logs = db.prepare(`
    SELECT l.*, s.full_name as performed_by_name
    FROM job_logs l
    LEFT JOIN staff s ON l.performed_by_id = s.id
    WHERE l.job_id = ?
    ORDER BY l.timestamp DESC
  `).all(job.id);

  res.json({ success: true, job, photos, logs });
});

// Create manual/ad-hoc job
router.post('/', async (req, res) => {
  const {
    customer_id, location_id, treatment_id, technician_id, salesman_id,
    scheduled_date, scheduled_time, duration_minutes, crew_count, workers_info, notes,
    vehicle_id, vehicle_no, machine_id, machine_name, team_members,
    send_sms = false
  } = req.body;

  if (!customer_id || !treatment_id || !scheduled_date) {
    return res.status(400).json({ success: false, error: 'customer_id, treatment_id, and scheduled_date are required' });
  }

  // Normalize scheduled_date to prevent invalid calendar days (e.g. Sept 31 -> Sept 30)
  let cleanScheduledDate = String(scheduled_date).trim();
  const dateMatch = cleanScheduledDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const y = parseInt(dateMatch[1], 10);
    const m = parseInt(dateMatch[2], 10);
    let d = parseInt(dateMatch[3], 10);
    const maxDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > maxDays) d = maxDays;
    cleanScheduledDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Auto-resolve location if not provided
  let effectiveLocationId = location_id || null;
  if (!effectiveLocationId && customer_id) {
    try {
      const primaryLoc = db.prepare('SELECT id FROM customer_locations WHERE customer_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1').get(customer_id);
      if (primaryLoc) effectiveLocationId = primaryLoc.id;
    } catch (e) {}
  }

  const jobCode = generateJobCode(cleanScheduledDate);
  const workersJson = typeof workers_info === 'object' ? JSON.stringify(workers_info) : (workers_info || null);

  try {
    const result = db.prepare(`
      INSERT INTO jobs (
        job_code, customer_id, location_id, treatment_id, technician_id,
        salesman_id, scheduled_date, scheduled_time, duration_minutes,
        crew_count, workers_info,
        vehicle_id, vehicle_no, machine_id, machine_name, team_members,
        status, technician_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TO_BE_DONE', ?)
    `).run(
      jobCode,
      customer_id,
      effectiveLocationId,
      treatment_id,
      technician_id || null,
      salesman_id || null,
      cleanScheduledDate,
      scheduled_time || '09:00',
      duration_minutes || 60,
      crew_count ? parseInt(crew_count, 10) : 1,
      workersJson,
      vehicle_id ? parseInt(vehicle_id, 10) : null,
      vehicle_no ? String(vehicle_no).trim() : null,
      machine_id ? parseInt(machine_id, 10) : null,
      machine_name ? String(machine_name).trim() : null,
      team_members ? String(team_members).trim() : null,
      notes || ''
    );

    const newJobId = result.lastInsertRowid;
    db.prepare('INSERT INTO job_logs (job_id, action, notes) VALUES (?, ?, ?)').run(newJobId, 'CREATED', 'Manual job created by admin');

    let smsResult = null;
    if (technician_id && send_sms === true) {
      smsResult = await dispatchTechSmsIfAssigned(newJobId, technician_id, req.body.custom_base_url);
    }
    if (technician_id) {
      notifyJobAssigned(newJobId, technician_id).catch(err => console.warn('[Push] Error notifying assignment:', err.message));
    }

    const createdJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(newJobId);
    res.json({ success: true, job: createdJob, smsResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Job Details (Admin / Operations Edit Panel)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    customer_id, location_id, treatment_id, technician_id, salesman_id,
    scheduled_date, scheduled_time, duration_minutes, crew_count, workers_info,
    vehicle_id, vehicle_no, machine_id, machine_name, team_members,
    status, technician_notes,
    send_sms
  } = req.body;

  try {
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const workersJson = workers_info !== undefined
      ? (typeof workers_info === 'object' ? JSON.stringify(workers_info) : workers_info)
      : null;

    db.prepare(`
      UPDATE jobs SET
        customer_id = COALESCE(?, customer_id),
        location_id = COALESCE(?, location_id),
        treatment_id = COALESCE(?, treatment_id),
        technician_id = CASE WHEN ? IS NOT NULL THEN ? ELSE technician_id END,
        salesman_id = CASE WHEN ? IS NOT NULL THEN ? ELSE salesman_id END,
        scheduled_date = COALESCE(?, scheduled_date),
        scheduled_time = COALESCE(?, scheduled_time),
        duration_minutes = COALESCE(?, duration_minutes),
        crew_count = COALESCE(?, crew_count),
        workers_info = CASE WHEN ? IS NOT NULL THEN ? ELSE workers_info END,
        vehicle_id = CASE WHEN ? IS NOT NULL THEN ? ELSE vehicle_id END,
        vehicle_no = CASE WHEN ? IS NOT NULL THEN ? ELSE vehicle_no END,
        machine_id = CASE WHEN ? IS NOT NULL THEN ? ELSE machine_id END,
        machine_name = CASE WHEN ? IS NOT NULL THEN ? ELSE machine_name END,
        team_members = CASE WHEN ? IS NOT NULL THEN ? ELSE team_members END,
        status = COALESCE(?, status),
        technician_notes = COALESCE(?, technician_notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      customer_id || null,
      location_id || null,
      treatment_id || null,
      technician_id !== undefined ? 1 : null,
      technician_id || null,
      salesman_id !== undefined ? 1 : null,
      salesman_id || null,
      scheduled_date || null,
      scheduled_time || null,
      duration_minutes ? parseInt(duration_minutes, 10) : null,
      crew_count ? parseInt(crew_count, 10) : null,
      workers_info !== undefined ? 1 : null,
      workersJson,
      vehicle_id !== undefined ? 1 : null,
      vehicle_id ? parseInt(vehicle_id, 10) : null,
      vehicle_no !== undefined ? 1 : null,
      vehicle_no || null,
      machine_id !== undefined ? 1 : null,
      machine_id ? parseInt(machine_id, 10) : null,
      machine_name !== undefined ? 1 : null,
      machine_name || null,
      team_members !== undefined ? 1 : null,
      team_members || null,
      status ? status.toUpperCase() : null,
      technician_notes !== undefined ? technician_notes : null,
      id
    );

    db.prepare('INSERT INTO job_logs (job_id, action, notes) VALUES (?, ?, ?)')
      .run(id, 'EDITED', 'Job details updated via operations edit panel');

    const updated = db.prepare(`
      SELECT j.*,
             c.name as customer_name, c.customer_code, c.phone as customer_phone,
             c.contact_person, c.special_instructions,
             l.location_name, l.address as location_address, l.latitude, l.longitude,
             t.code as treatment_code, t.name as treatment_name, t.color_hex as treatment_color,
             tech.full_name as technician_name, tech.phone as technician_phone,
             sales.full_name as salesman_name,
             v.vehicle_number, v.vehicle_type,
             m.machine_type
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      JOIN treatments t ON j.treatment_id = t.id
      LEFT JOIN staff tech ON j.technician_id = tech.id
      LEFT JOIN staff sales ON j.salesman_id = sales.id
      LEFT JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN machines m ON j.machine_id = m.id
      WHERE j.id = ?
    `).get(id);

    let smsResult = null;
    const finalTechId = technician_id !== undefined ? (technician_id ? parseInt(technician_id, 10) : null) : existing.technician_id;
    if (finalTechId && send_sms === true) {
      smsResult = await dispatchTechSmsIfAssigned(id, finalTechId, req.body.custom_base_url);
    }
    if (finalTechId) {
      if (existing.technician_id !== finalTechId) {
        notifyJobAssigned(id, finalTechId).catch(err => console.warn('[Push] Assign error:', err.message));
      } else {
        notifyJobUpdated(id, finalTechId).catch(err => console.warn('[Push] Update error:', err.message));
      }
    }

    res.json({ success: true, job: updated, smsResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Assign or reassign technician
router.put('/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { technician_id, crew_count, workers_info, vehicle_id, vehicle_no, machine_id, machine_name, team_members, send_sms = false } = req.body;

  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    const workersJson = workers_info !== undefined
      ? (typeof workers_info === 'object' ? JSON.stringify(workers_info) : workers_info)
      : null;

    db.prepare(`
      UPDATE jobs SET
        technician_id = ?,
        crew_count = COALESCE(?, crew_count),
        workers_info = CASE WHEN ? IS NOT NULL THEN ? ELSE workers_info END,
        vehicle_id = CASE WHEN ? IS NOT NULL THEN ? ELSE vehicle_id END,
        vehicle_no = CASE WHEN ? IS NOT NULL THEN ? ELSE vehicle_no END,
        machine_id = CASE WHEN ? IS NOT NULL THEN ? ELSE machine_id END,
        machine_name = CASE WHEN ? IS NOT NULL THEN ? ELSE machine_name END,
        team_members = CASE WHEN ? IS NOT NULL THEN ? ELSE team_members END,
        status = CASE WHEN status = 'TO_BE_DONE' THEN 'ASSIGNED' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      technician_id,
      crew_count ? parseInt(crew_count, 10) : null,
      workers_info !== undefined ? 1 : null,
      workersJson,
      vehicle_id !== undefined ? 1 : null,
      vehicle_id ? parseInt(vehicle_id, 10) : null,
      vehicle_no !== undefined ? 1 : null,
      vehicle_no || null,
      machine_id !== undefined ? 1 : null,
      machine_id ? parseInt(machine_id, 10) : null,
      machine_name !== undefined ? 1 : null,
      machine_name || null,
      team_members !== undefined ? 1 : null,
      team_members || null,
      id
    );

    db.prepare(`
      INSERT INTO job_logs (job_id, action, notes)
      VALUES (?, 'ASSIGNED', ?)
    `).run(id, `Technician assigned: ${technician_id}, crew: ${crew_count || 1}`);

    // Create notification for technician
    if (technician_id) {
      db.prepare(`
        INSERT INTO notifications (title, message, type, target_user_id, job_id)
        VALUES (?, ?, 'ASSIGNMENT', ?, ?)
      `).run('New Job Assignment', `You have been assigned job ${job.job_code} scheduled for ${job.scheduled_date}`, technician_id, id);
    }

    let smsResult = null;
    if (technician_id && send_sms === true) {
      smsResult = await dispatchTechSmsIfAssigned(id, technician_id, req.body.custom_base_url);
    }
    if (technician_id) {
      notifyJobAssigned(id, technician_id).catch(err => console.warn('[Push] Assign error:', err.message));
    }

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    res.json({ success: true, job: updated, smsResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk assign technician to multiple jobs
router.post('/bulk-assign', async (req, res) => {
  const { job_ids, technician_id, send_sms = false, custom_base_url } = req.body;
  if (!Array.isArray(job_ids) || job_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'job_ids must be a non-empty array' });
  }

  const tx = db.transaction(() => {
    const updateStmt = db.prepare(`
      UPDATE jobs SET
        technician_id = ?,
        status = CASE WHEN status = 'TO_BE_DONE' THEN 'ASSIGNED' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const logStmt = db.prepare(`INSERT INTO job_logs (job_id, action, notes) VALUES (?, 'BULK_ASSIGNED', ?)`);

    for (const jid of job_ids) {
      updateStmt.run(technician_id, jid);
      logStmt.run(jid, `Technician ${technician_id} bulk assigned`);
    }
  });

  try {
    tx();

    let smsDispatchedCount = 0;
    if (technician_id) {
      for (const jid of job_ids) {
        if (send_sms === true) {
          await dispatchTechSmsIfAssigned(jid, technician_id, custom_base_url);
          smsDispatchedCount++;
        }
        notifyJobAssigned(jid, technician_id).catch(err => console.warn('[Push] Bulk assign error:', err.message));
      }
    }

    res.json({ success: true, updatedCount: job_ids.length, smsDispatchedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Job (technician clicks START JOB)
router.put('/:id/start', (req, res) => {
  const { id } = req.params;
  const now = new Date().toISOString();

  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    db.prepare(`
      UPDATE jobs SET
        status = 'IN_PROGRESS',
        actual_start_time = COALESCE(actual_start_time, ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(now, id);

    db.prepare(`INSERT INTO job_logs (job_id, action, notes) VALUES (?, 'STARTED', 'Job started by technician')`).run(id);

    const updated = db.prepare(`
      SELECT j.*,
             c.name as customer_name, c.customer_code, c.phone as customer_phone,
             c.contact_person, c.address as customer_address, c.special_instructions,
             l.location_name, l.address as location_address, l.latitude, l.longitude,
             t.code as treatment_code, t.name as treatment_name, t.color_hex as treatment_color,
             tech.full_name as technician_name, tech.phone as technician_phone,
             sales.full_name as salesman_name,
             r.frequency as recurring_frequency,
             v.vehicle_type, v.vehicle_number,
             m.machine_type
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      JOIN treatments t ON j.treatment_id = t.id
      LEFT JOIN staff tech ON j.technician_id = tech.id
      LEFT JOIN staff sales ON j.salesman_id = sales.id
      LEFT JOIN recurring_services r ON j.recurring_service_id = r.id
      LEFT JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN machines m ON j.machine_id = m.id
      WHERE j.id = ?
    `).get(id);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Complete Job (technician completes with notes, signature, photos)
// Triggers automatic calculation of next service date & generation of next job!
router.put('/:id/complete', (req, res) => {
  const { id } = req.params;
  const { actual_start_time, actual_end_time, technician_notes, customer_signature, photos } = req.body;

  try {
    const result = handleJobCompletion(id, {
      actual_start_time,
      actual_end_time: actual_end_time || new Date().toISOString(),
      technician_notes,
      customer_signature,
      photos
    });

    const updatedJob = db.prepare(`
      SELECT j.*,
             c.name as customer_name, c.customer_code, c.phone as customer_phone,
             c.contact_person, c.address as customer_address, c.special_instructions,
             l.location_name, l.address as location_address, l.latitude, l.longitude,
             t.code as treatment_code, t.name as treatment_name, t.color_hex as treatment_color,
             tech.full_name as technician_name, tech.phone as technician_phone,
             sales.full_name as salesman_name,
             r.frequency as recurring_frequency,
             v.vehicle_type, v.vehicle_number,
             m.machine_type
      FROM jobs j
      JOIN customers c ON j.customer_id = c.id
      LEFT JOIN customer_locations l ON j.location_id = l.id
      JOIN treatments t ON j.treatment_id = t.id
      LEFT JOIN staff tech ON j.technician_id = tech.id
      LEFT JOIN staff sales ON j.salesman_id = sales.id
      LEFT JOIN recurring_services r ON j.recurring_service_id = r.id
      LEFT JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN machines m ON j.machine_id = m.id
      WHERE j.id = ?
    `).get(id);

    res.json({ success: true, job: updatedJob, message: 'Job completed and next service automatically calculated!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Postpone Job
router.put('/:id/postpone', (req, res) => {
  const { id } = req.params;
  const { postponed_to_date, reason } = req.body;

  if (!postponed_to_date) {
    return res.status(400).json({ success: false, error: 'postponed_to_date is required' });
  }

  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    db.prepare(`
      UPDATE jobs SET
        status = 'POSTPONED',
        scheduled_date = ?,
        postponed_to_date = ?,
        reschedule_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(postponed_to_date, postponed_to_date, reason || 'Customer requested postponement', id);

    db.prepare(`
      INSERT INTO job_logs (job_id, action, notes)
      VALUES (?, 'POSTPONED', ?)
    `).run(id, `Job postponed from ${job.scheduled_date} to ${postponed_to_date}. Reason: ${reason || 'N/A'}`);

    // Create notification
    db.prepare(`
      INSERT INTO notifications (title, message, type, job_id, target_role)
      VALUES (?, ?, 'POSTPONED', ?, 'SUPERVISOR')
    `).run('Job Postponed', `Job ${job.job_code} postponed to ${postponed_to_date}`, id);

    if (job.technician_id) {
      notifyJobPostponed(id, job.technician_id, postponed_to_date).catch(err => console.warn('[Push] Postpone error:', err.message));
    }

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel Job
router.put('/:id/cancel', (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });

    db.prepare(`
      UPDATE jobs SET
        status = 'CANCELLED',
        reschedule_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reason || 'Cancelled by admin', id);

    db.prepare(`INSERT INTO job_logs (job_id, action, notes) VALUES (?, 'CANCELLED', ?)`).run(id, reason || 'Cancelled');

    if (job.technician_id) {
      notifyJobCancelled(id, job.technician_id).catch(err => console.warn('[Push] Cancel error:', err.message));
    }

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
