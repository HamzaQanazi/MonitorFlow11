// Time Clock (§1/§9): employee self-service — clock in/out, breaks, manual
// hours, in-shift notes/photos/tips. Manager-facing Today/Timesheets land in
// a later phase; this router is employee-only, own-shift-only (same
// ownership-by-404 shape as tasks.js).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole, requireCapability, requireFeature } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { subtreeIds, ownerInScope } = require('../lib/scope');
const { csvCell } = require('../lib/csv');
const { validateManualShift, validateClockInLocation, computeAttendance, computeTimesheetDay, round2 } = require('../lib/timeClock');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('time_clock'));
router.use(requireRole('employee'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadShiftDetail(shiftId, db = pool) {
  const [shiftRes, breaksRes, entriesRes] = await Promise.all([
    db.query(
      `SELECT id, employee_id, clock_in_at, clock_out_at, source, status,
              approval_status, note, approved_by, approved_at, created_at, location_captured
       FROM time_shift WHERE id = $1`,
      [shiftId]
    ),
    db.query(
      `SELECT id, break_start_at, break_end_at FROM time_break
       WHERE shift_id = $1 ORDER BY break_start_at`,
      [shiftId]
    ),
    db.query(
      `SELECT e.id, e.type, e.body, e.amount, e.created_at, f.id AS attachment_id
       FROM time_entry e
       LEFT JOIN file_attachment f ON f.time_entry_id = e.id
       WHERE e.shift_id = $1 ORDER BY e.created_at`,
      [shiftId]
    ),
  ]);
  if (!shiftRes.rows.length) return null;
  const s = shiftRes.rows[0];
  return {
    id: s.id,
    clockInAt: s.clock_in_at,
    clockOutAt: s.clock_out_at,
    source: s.source,
    status: s.status,
    approvalStatus: s.approval_status,
    note: s.note,
    approvedBy: s.approved_by,
    approvedAt: s.approved_at,
    createdAt: s.created_at,
    locationCaptured: s.location_captured,
    breaks: breaksRes.rows.map((b) => ({ id: b.id, breakStartAt: b.break_start_at, breakEndAt: b.break_end_at })),
    entries: entriesRes.rows.map((e) => ({
      id: e.id,
      type: e.type,
      body: e.body,
      amount: e.amount,
      attachmentId: e.attachment_id,
      createdAt: e.created_at,
    })),
    _employeeId: s.employee_id,
  };
}

// Loads the caller's own shift by id, 404 if it doesn't exist or belongs to
// someone else (must-pass "own-resource of another user → 404").
async function loadOwnShift(id, employeeId, db = pool) {
  if (!Number.isInteger(id)) return null;
  const detail = await loadShiftDetail(id, db);
  if (!detail || detail._employeeId !== employeeId) return null;
  delete detail._employeeId;
  return detail;
}

function serialize(detail) {
  const { _employeeId, ...rest } = detail;
  return rest;
}

// GET /timeclock/shifts/active — the caller's current open shift, or null.
// The one read the mobile app needs on launch to know what state to render.
router.get('/shifts/active', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM time_shift WHERE employee_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ shift: null });
    res.json({ shift: serialize(await loadShiftDetail(rows[0].id)) });
  } catch (err) {
    next(err);
  }
});

// POST /timeclock/clock-in — { location: { lat, lng } } is mandatory (a
// one-shot device fix proving presence). The coordinate itself is validated
// then discarded: only whether it was captured gets stored (I10 — no
// location history).
router.post('/clock-in', async (req, res, next) => {
  try {
    const errors = validateClockInLocation((req.body || {}).location);
    if (errors) return res.status(422).json({ errors });

    const { rows } = await pool.query(
      `INSERT INTO time_shift (employee_id, company_id, clock_in_at, source, status, approval_status, location_captured)
       VALUES ($1, $2, now(), 'clock', 'active', 'approved', true)
       RETURNING id`,
      [req.user.id, req.user.company_id]
    );
    res.status(201).json({ shift: serialize(await loadShiftDetail(rows[0].id)) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You are already clocked in' });
    next(err);
  }
});

// POST /timeclock/clock-out
router.post('/clock-out', async (req, res, next) => {
  try {
    const active = await pool.query(
      `SELECT id FROM time_shift WHERE employee_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    if (!active.rows.length) return res.status(409).json({ error: 'You are not clocked in' });
    const shiftId = active.rows[0].id;

    const openBreak = await pool.query(
      `SELECT id FROM time_break WHERE shift_id = $1 AND break_end_at IS NULL`,
      [shiftId]
    );
    if (openBreak.rows.length) {
      return res.status(409).json({ error: 'End your break before clocking out' });
    }

    await pool.query(
      `UPDATE time_shift SET clock_out_at = now(), status = 'completed' WHERE id = $1`,
      [shiftId]
    );
    res.json({ shift: serialize(await loadShiftDetail(shiftId)) });
  } catch (err) {
    next(err);
  }
});

// POST /timeclock/breaks/start
router.post('/breaks/start', async (req, res, next) => {
  try {
    const active = await pool.query(
      `SELECT id FROM time_shift WHERE employee_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    if (!active.rows.length) return res.status(409).json({ error: 'You are not clocked in' });

    await pool.query(`INSERT INTO time_break (shift_id, break_start_at) VALUES ($1, now())`, [
      active.rows[0].id,
    ]);
    res.status(201).json({ shift: serialize(await loadShiftDetail(active.rows[0].id)) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'You already have an active break' });
    next(err);
  }
});

// POST /timeclock/breaks/end
router.post('/breaks/end', async (req, res, next) => {
  try {
    const active = await pool.query(
      `SELECT id FROM time_shift WHERE employee_id = $1 AND status = 'active'`,
      [req.user.id]
    );
    if (!active.rows.length) return res.status(409).json({ error: 'You are not clocked in' });

    const openBreak = await pool.query(
      `SELECT id FROM time_break WHERE shift_id = $1 AND break_end_at IS NULL`,
      [active.rows[0].id]
    );
    if (!openBreak.rows.length) return res.status(409).json({ error: 'No active break to end' });

    await pool.query(`UPDATE time_break SET break_end_at = now() WHERE id = $1`, [openBreak.rows[0].id]);
    res.json({ shift: serialize(await loadShiftDetail(active.rows[0].id)) });
  } catch (err) {
    next(err);
  }
});

// POST /timeclock/shifts/manual — backdated hours entry, always lands
// pending a manager's approval (approve/edit ship in the manager phase).
router.post('/shifts/manual', async (req, res, next) => {
  try {
    const { clockInAt, clockOutAt, note } = req.body || {};
    const errors = validateManualShift({ clockInAt, clockOutAt });
    if (errors) return res.status(422).json({ errors });

    const { rows } = await pool.query(
      `INSERT INTO time_shift (employee_id, company_id, clock_in_at, clock_out_at, source, status, approval_status, note)
       VALUES ($1, $2, $3, $4, 'manual', 'completed', 'pending', $5)
       RETURNING id`,
      [req.user.id, req.user.company_id, clockInAt, clockOutAt, note || null]
    );
    res.status(201).json({ shift: serialize(await loadShiftDetail(rows[0].id)) });
  } catch (err) {
    next(err);
  }
});

// POST /timeclock/shifts/:id/entries — note/photo/tip, active shift only.
router.post('/shifts/:id/entries', async (req, res, next) => {
  try {
    const shift = await loadOwnShift(Number(req.params.id), req.user.id);
    if (!shift) return res.status(404).json({ error: 'Not found' });
    if (shift.status !== 'active') {
      return res.status(409).json({ error: 'Entries can only be added to an active shift' });
    }

    const { type, body, amount, fileAttachmentId } = req.body || {};
    if (!['note', 'photo', 'tip'].includes(type)) {
      return res.status(422).json({ errors: { type: 'Must be one of note, photo, tip' } });
    }
    if (type === 'note' && (typeof body !== 'string' || !body.trim())) {
      return res.status(422).json({ errors: { body: 'A note requires text' } });
    }
    if (type === 'tip' && !(typeof amount === 'number' && amount > 0)) {
      return res.status(422).json({ errors: { amount: 'A tip requires a positive amount' } });
    }
    if (type === 'photo' && !UUID_RE.test(fileAttachmentId || '')) {
      return res.status(422).json({ errors: { fileAttachmentId: 'A valid uploaded file id is required' } });
    }

    const entryId = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO time_entry (shift_id, type, body, amount, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [shift.id, type, type === 'note' ? body.trim() : null, type === 'tip' ? amount : null, req.user.id]
      );
      const id = rows[0].id;
      if (type === 'photo') {
        // Same two-step contract as request photos (§7): the file was
        // uploaded pending (no parent) and must belong to the caller.
        const linked = await client.query(
          `UPDATE file_attachment SET time_entry_id = $1
           WHERE id = $2 AND uploaded_by = $3
             AND request_id IS NULL AND task_id IS NULL AND time_entry_id IS NULL`,
          [id, fileAttachmentId, req.user.id]
        );
        if (linked.rowCount === 0) {
          const err = new Error('Upload not found or already used');
          err.status = 422;
          err.field = 'fileAttachmentId';
          throw err;
        }
      }
      return id;
    });

    res.status(201).json({ shift: serialize(await loadShiftDetail(shift.id)) });
  } catch (err) {
    if (err.status === 422) return res.status(422).json({ errors: { [err.field]: err.message } });
    next(err);
  }
});

// ---- Manager surface (Gate 1: view_all to read, manage_employees to write;
// Gate 2: subtree via subtreeIds/ownerInScope). Employees only (I2) — an
// oversight employee is one whose level grants view_all, same as reports.js.

// GET /timeclock/today?date=YYYY-MM-DD — one row per subtree employee: their
// most recent shift that day, plus the 5 counters the web Today tab renders
// as clickable filters. Filtering itself is client-side over this one payload
// (thin renderer, I4) — no separate filter param.
router.get('/today', requireCapability('view_all'), async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const ids = await subtreeIds(req.user.id);

    const { rows } = await pool.query(
      `SELECT u.id AS employee_id, u.name,
              st.start_time AS expected_start_time, st.end_time AS expected_end_time,
              sh.id AS shift_id, sh.clock_in_at, sh.clock_out_at, sh.status, sh.approval_status, sh.source,
              COALESCE(brk.break_seconds, 0) AS break_seconds,
              fb.break_start_at, fb.break_end_at
       FROM users u
       LEFT JOIN schedule_entry se ON se.employee_id = u.id AND se.date = $2::date
       LEFT JOIN shift_template st ON st.id = se.shift_template_id
       -- AT TIME ZONE 'UTC' forces the day boundary to match the UTC calendar
       -- math in lib/timeClock.js — a bare ::date cast uses the DB session's
       -- timezone (this deployment runs Asia/Gaza), which silently shifts
       -- shifts near midnight onto the wrong day.
       LEFT JOIN LATERAL (
         SELECT * FROM time_shift s
         WHERE s.employee_id = u.id AND (s.clock_in_at AT TIME ZONE 'UTC')::date = $2::date
         ORDER BY s.clock_in_at DESC LIMIT 1
       ) sh ON true
       LEFT JOIN LATERAL (
         SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(b.break_end_at, now()) - b.break_start_at)))::int AS break_seconds
         FROM time_break b WHERE b.shift_id = sh.id
       ) brk ON true
       -- First break of the shift, for the Today tab's break-in/break-out
       -- columns. A second break on the same shift isn't surfaced here — the
       -- self-service GET /shifts/active endpoint has the full list.
       LEFT JOIN LATERAL (
         SELECT break_start_at, break_end_at FROM time_break b2
         WHERE b2.shift_id = sh.id ORDER BY b2.break_start_at LIMIT 1
       ) fb ON true
       WHERE u.id = ANY($1::int[]) AND u.role = 'employee' AND u.is_active
       ORDER BY u.name`,
      [ids, date]
    );

    const employees = rows.map((r) => {
      const shift = r.shift_id
        ? { clockInAt: r.clock_in_at, clockOutAt: r.clock_out_at, status: r.status }
        : null;
      const defaultShift = r.expected_start_time
        ? { expectedStartTime: r.expected_start_time, expectedEndTime: r.expected_end_time }
        : null;
      const attendance = computeAttendance({ shift, breakSeconds: r.break_seconds, defaultShift });
      return {
        employeeId: r.employee_id,
        name: r.name,
        shiftId: r.shift_id,
        clockInAt: r.clock_in_at,
        clockOutAt: r.clock_out_at,
        breakStartAt: r.break_start_at,
        breakEndAt: r.break_end_at,
        breakSeconds: r.break_seconds,
        approvalStatus: r.approval_status,
        source: r.source,
        ...attendance,
      };
    });

    res.json({
      date,
      employees,
      counters: {
        lateClockIns: employees.filter((e) => e.lateClockIn).length,
        lateClockOuts: employees.filter((e) => e.lateClockOut).length,
        attendance: employees.filter((e) => e.shiftId).length,
        absences: employees.filter((e) => e.absent).length,
        currentlyWorking: employees.filter((e) => e.currentlyWorking).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Shared by GET /timesheets and its CSV export — one weekly grid, two renderings.
async function buildTimesheets(weekStart, ids) {
  const [{ rows: employees }, { rows: shiftRows }, { rows: scheduleRows }] = await Promise.all([
    pool.query(
      `SELECT id, name FROM users WHERE id = ANY($1::int[]) AND role = 'employee' AND is_active ORDER BY name`,
      [ids]
    ),
    pool.query(
      `SELECT s.id, s.employee_id, s.clock_in_at, s.clock_out_at, s.approval_status, s.source,
              COALESCE(b.break_seconds, 0) AS break_seconds
       FROM time_shift s
       LEFT JOIN LATERAL (
         SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(break_end_at, now()) - break_start_at)))::int AS break_seconds
         FROM time_break WHERE shift_id = s.id
       ) b ON true
       -- Same UTC-boundary fix as /today: $2::date compared straight against a
       -- timestamptz would cast through the DB session's local timezone.
       WHERE s.employee_id = ANY($1::int[])
         AND s.clock_in_at >= ($2::date)::timestamp AT TIME ZONE 'UTC'
         AND s.clock_in_at < ($2::date + 7)::timestamp AT TIME ZONE 'UTC'`,
      [ids, weekStart]
    ),
    pool.query(
      `SELECT se.employee_id, se.date::text AS date, st.start_time AS expected_start_time, st.end_time AS expected_end_time
       FROM schedule_entry se
       JOIN shift_template st ON st.id = se.shift_template_id
       WHERE se.employee_id = ANY($1::int[])
         AND se.date >= $2::date AND se.date < ($2::date + 7)`,
      [ids, weekStart]
    ),
  ]);

  const weekStartMs = new Date(`${weekStart}T00:00:00Z`).getTime();
  const shiftsByEmployeeDay = new Map();
  for (const s of shiftRows) {
    const dayIndex = Math.floor((new Date(s.clock_in_at).getTime() - weekStartMs) / 86400000);
    const key = `${s.employee_id}:${dayIndex}`;
    if (!shiftsByEmployeeDay.has(key)) shiftsByEmployeeDay.set(key, []);
    shiftsByEmployeeDay.get(key).push({
      id: s.id,
      clockInAt: s.clock_in_at,
      clockOutAt: s.clock_out_at,
      breakSeconds: s.break_seconds,
      approvalStatus: s.approval_status,
      source: s.source,
    });
  }
  const scheduleByEmployeeDay = new Map();
  for (const d of scheduleRows) {
    const dayIndex = Math.round((new Date(`${d.date}T00:00:00Z`).getTime() - weekStartMs) / 86400000);
    scheduleByEmployeeDay.set(`${d.employee_id}:${dayIndex}`, {
      expectedStartTime: d.expected_start_time,
      expectedEndTime: d.expected_end_time,
    });
  }

  return employees.map((emp) => {
    let weeklyTotal = 0;
    let weeklyOvertime = 0;
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayShifts = shiftsByEmployeeDay.get(`${emp.id}:${i}`) || [];
      const defaultShift = scheduleByEmployeeDay.get(`${emp.id}:${i}`) || null;
      const { totalHours, overtimeHours } = computeTimesheetDay({ shifts: dayShifts, defaultShift });
      days.push({
        totalHours,
        overtimeHours,
        shifts: dayShifts.map((s) => ({
          id: s.id,
          clockInAt: s.clockInAt,
          clockOutAt: s.clockOutAt,
          approvalStatus: s.approvalStatus,
          source: s.source,
        })),
      });
      weeklyTotal += totalHours;
      weeklyOvertime += overtimeHours;
    }
    return {
      employeeId: emp.id,
      name: emp.name,
      days,
      weeklyTotalHours: round2(weeklyTotal),
      weeklyOvertimeHours: round2(weeklyOvertime),
    };
  });
}

// GET /timeclock/timesheets?weekStart=YYYY-MM-DD — weekStart is the grid's
// first day, taken as given (no forced Monday-alignment; the web tab picks it).
router.get('/timesheets', requireCapability('view_all'), async (req, res, next) => {
  try {
    const { weekStart } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) {
      return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
    }
    const timesheets = await buildTimesheets(weekStart, await subtreeIds(req.user.id));
    res.json({ weekStart, timesheets });
  } catch (err) {
    next(err);
  }
});

// GET /timeclock/timesheets/export.csv — same grid, frozen columns, payroll export.
router.get(
  '/timesheets/export.csv',
  requireCapability('view_all'),
  requireCapability('export'),
  async (req, res, next) => {
    try {
      const { weekStart } = req.query;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart || '')) {
        return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
      }
      const timesheets = await buildTimesheets(weekStart, await subtreeIds(req.user.id));

      const header = ['employee_name', 'day_1', 'day_2', 'day_3', 'day_4', 'day_5', 'day_6', 'day_7', 'weekly_total_hours', 'weekly_overtime_hours'];
      const lines = [header.join(',')];
      for (const t of timesheets) {
        lines.push(
          [t.name, ...t.days.map((d) => d.totalHours), t.weeklyTotalHours, t.weeklyOvertimeHours].map(csvCell).join(',')
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="timesheets-${weekStart}.csv"`);
      res.send(lines.join('\r\n'));
    } catch (err) {
      next(err);
    }
  }
);

// Loads a shift for a manager acting on a subtree member (not necessarily
// themselves) — same 404-over-403 shape as loadOwnShift, scoped by Gate 2
// instead of strict self-ownership.
async function loadScopedShift(id, actorId, db = pool) {
  if (!Number.isInteger(id)) return null;
  const detail = await loadShiftDetail(id, db);
  if (!detail || !(await ownerInScope(actorId, detail._employeeId, db))) return null;
  return detail;
}

// PATCH /timeclock/shifts/:id — manager correction. Requires both timestamps
// (same shape/validation as a manual entry) and always lands 'edited'/'completed'.
router.patch('/shifts/:id', requireCapability('manage_employees'), async (req, res, next) => {
  try {
    const detail = await loadScopedShift(Number(req.params.id), req.user.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });

    const { clockInAt, clockOutAt, note } = req.body || {};
    const errors = validateManualShift({ clockInAt, clockOutAt });
    if (errors) return res.status(422).json({ errors });

    await withTx(async (client) => {
      await client.query(
        `UPDATE time_shift
         SET clock_in_at = $1, clock_out_at = $2, note = COALESCE($3, note),
             status = 'completed', approval_status = 'edited'
         WHERE id = $4`,
        [clockInAt, clockOutAt, note || null, detail.id]
      );
      await logAudit(client, req.user.id, 'time_shift.edited', 'time_shift', detail.id, {
        employeeId: detail._employeeId,
        before: { clockInAt: detail.clockInAt, clockOutAt: detail.clockOutAt },
        after: { clockInAt, clockOutAt },
      });
    });

    res.json({ shift: serialize(await loadShiftDetail(detail.id)) });
  } catch (err) {
    next(err);
  }
});

// POST /timeclock/shifts/:id/approve — clears a manual entry's 'pending' approval.
router.post('/shifts/:id/approve', requireCapability('manage_employees'), async (req, res, next) => {
  try {
    const detail = await loadScopedShift(Number(req.params.id), req.user.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    if (detail.approvalStatus !== 'pending') {
      return res.status(409).json({ error: 'Shift is not pending approval' });
    }

    await withTx(async (client) => {
      await client.query(
        `UPDATE time_shift SET approval_status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2`,
        [req.user.id, detail.id]
      );
      await logAudit(client, req.user.id, 'time_shift.approved', 'time_shift', detail.id, {
        employeeId: detail._employeeId,
      });
    });

    res.json({ shift: serialize(await loadShiftDetail(detail.id)) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
