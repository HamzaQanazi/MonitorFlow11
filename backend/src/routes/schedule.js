// Schedule (`schedule` onboarding key): a manager assigns a named
// shift_template to a subtree employee for a specific date (schedule_entry) —
// a flat, date-by-date roster the manager re-fills a week at a time, no
// recurrence engine (see 018_schedule.sql). This is also Time Clock's
// late/absent/overtime baseline now (lib/timeClock.js reads schedule_entry
// per date instead of the old employee_default_shift).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole, requireCapabilityOrAdmin, requireFeature } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { subtreeIds } = require('../lib/scope');
const { isBilingual } = require('../lib/i18nLabel');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('schedule'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function serializeTemplate(t) {
  return { id: t.id, name: t.name, startTime: t.start_time, endTime: t.end_time };
}

// ---- Shift templates (manager, view_all to read, manage_employees to write) ----

router.get('/templates', requireCapabilityOrAdmin('view_all'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, start_time, end_time FROM shift_template WHERE company_id = $1 ORDER BY start_time',
      [req.user.company_id]
    );
    res.json({ templates: rows.map(serializeTemplate) });
  } catch (err) {
    next(err);
  }
});

router.post('/templates', requireCapabilityOrAdmin('manage_employees'), async (req, res, next) => {
  try {
    const { name, startTime, endTime } = req.body || {};
    const errors = {};
    if (!isBilingual(name)) errors.name = 'A name is required in both languages';
    if (!TIME_RE.test(startTime || '')) errors.startTime = 'startTime must be HH:MM';
    if (!TIME_RE.test(endTime || '')) errors.endTime = 'endTime must be HH:MM';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const template = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO shift_template (company_id, name, start_time, end_time)
         VALUES ($1, $2, $3, $4) RETURNING id, name, start_time, end_time`,
        [req.user.company_id, JSON.stringify(name), startTime, endTime]
      );
      await logAudit(client, req.user.id, 'shift_template.created', 'shift_template', rows[0].id, { name });
      return rows[0];
    });
    res.status(201).json({ template: serializeTemplate(template) });
  } catch (err) {
    next(err);
  }
});

router.patch('/templates/:id', requireCapabilityOrAdmin('manage_employees'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, startTime, endTime } = req.body || {};
    const errors = {};
    if (name !== undefined && !isBilingual(name)) errors.name = 'A name is required in both languages';
    if (startTime !== undefined && !TIME_RE.test(startTime || '')) errors.startTime = 'startTime must be HH:MM';
    if (endTime !== undefined && !TIME_RE.test(endTime || '')) errors.endTime = 'endTime must be HH:MM';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const template = await withTx(async (client) => {
      const { rows } = await client.query(
        `UPDATE shift_template SET
           name = COALESCE($1, name),
           start_time = COALESCE($2, start_time),
           end_time = COALESCE($3, end_time)
         WHERE id = $4 AND company_id = $5
         RETURNING id, name, start_time, end_time`,
        [name ? JSON.stringify(name) : null, startTime || null, endTime || null, id, req.user.company_id]
      );
      if (!rows.length) return null;
      await logAudit(client, req.user.id, 'shift_template.updated', 'shift_template', id, { name, startTime, endTime });
      return rows[0];
    });
    if (!template) return res.status(404).json({ error: 'Not found' });
    res.json({ template: serializeTemplate(template) });
  } catch (err) {
    next(err);
  }
});

router.delete('/templates/:id', requireCapabilityOrAdmin('manage_employees'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rowCount: used } = await pool.query('SELECT 1 FROM schedule_entry WHERE shift_template_id = $1 LIMIT 1', [id]);
    if (used) return res.status(409).json({ error: 'Template is used by scheduled shifts' });

    const deleted = await withTx(async (client) => {
      const { rowCount } = await client.query('DELETE FROM shift_template WHERE id = $1 AND company_id = $2', [
        id,
        req.user.company_id,
      ]);
      if (rowCount) await logAudit(client, req.user.id, 'shift_template.deleted', 'shift_template', id);
      return rowCount > 0;
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Roster (manager, subtree-scoped) ----

// GET /schedule/roster?from&to — one row per subtree employee, with every
// schedule_entry in [from, to] (inclusive). The web Roster grid renders this.
router.get('/roster', requireCapabilityOrAdmin('view_all'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    }
    const ids = await subtreeIds(req.user.id);
    const [{ rows: employees }, { rows: entries }] = await Promise.all([
      pool.query(`SELECT id, name FROM users WHERE id = ANY($1::int[]) AND role = 'employee' AND is_active ORDER BY name`, [
        ids,
      ]),
      pool.query(
        `SELECT se.employee_id, se.date::text AS date, st.id AS template_id,
                st.name AS template_name, st.start_time, st.end_time
         FROM schedule_entry se
         JOIN shift_template st ON st.id = se.shift_template_id
         WHERE se.employee_id = ANY($1::int[]) AND se.date BETWEEN $2 AND $3`,
        [ids, from, to]
      ),
    ]);

    const entriesByEmployee = new Map();
    for (const e of entries) {
      if (!entriesByEmployee.has(e.employee_id)) entriesByEmployee.set(e.employee_id, []);
      entriesByEmployee.get(e.employee_id).push({
        date: e.date,
        templateId: e.template_id,
        templateName: e.template_name,
        startTime: e.start_time,
        endTime: e.end_time,
      });
    }

    res.json({
      employees: employees.map((emp) => ({
        employeeId: emp.id,
        name: emp.name,
        entries: entriesByEmployee.get(emp.id) || [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /schedule/roster — bulk upsert. { entries: [{employeeId, date, templateId}] },
// templateId: null clears that employee's day. Every employeeId must be in the
// caller's subtree (404-over-403, same shape as tasks.js) and every template
// must belong to the caller's company (422 on a bad id via the FK).
router.put('/roster', requireCapabilityOrAdmin('manage_employees'), async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries || !entries.length) return res.status(422).json({ errors: { entries: 'At least one entry is required' } });
    if (entries.length > 500) return res.status(422).json({ errors: { entries: 'Too many entries in one request' } });
    for (const e of entries) {
      if (!Number.isInteger(e.employeeId) || !DATE_RE.test(e.date || '') || (e.templateId !== null && !Number.isInteger(e.templateId))) {
        return res.status(422).json({ errors: { entries: 'Each entry needs employeeId, date, and templateId (or null)' } });
      }
    }

    const ids = new Set(await subtreeIds(req.user.id));
    if (entries.some((e) => !ids.has(e.employeeId))) return res.status(404).json({ error: 'Not found' });

    await withTx(async (client) => {
      for (const e of entries) {
        if (e.templateId === null) {
          const { rows } = await client.query('DELETE FROM schedule_entry WHERE employee_id = $1 AND date = $2 RETURNING id', [
            e.employeeId,
            e.date,
          ]);
          if (rows.length) {
            await logAudit(client, req.user.id, 'schedule_entry.cleared', 'schedule_entry', rows[0].id, {
              employeeId: e.employeeId,
              date: e.date,
            });
          }
        } else {
          const { rows } = await client.query(
            `INSERT INTO schedule_entry (employee_id, company_id, date, shift_template_id, created_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (employee_id, date)
             DO UPDATE SET shift_template_id = EXCLUDED.shift_template_id, created_by = EXCLUDED.created_by, created_at = now()
             RETURNING id`,
            [e.employeeId, req.user.company_id, e.date, e.templateId, req.user.id]
          );
          await logAudit(client, req.user.id, 'schedule_entry.set', 'schedule_entry', rows[0].id, {
            employeeId: e.employeeId,
            date: e.date,
            templateId: e.templateId,
          });
        }
      }
    });

    res.status(204).end();
  } catch (err) {
    if (err.code === '23503') return res.status(422).json({ errors: { entries: 'Invalid template id' } });
    next(err);
  }
});

// ---- Self-service ----

// GET /schedule/mine?from&to — the caller's own upcoming schedule. Employee
// only (the Owner has no schedule_entry rows of their own) — everything else
// in this router admits the admin too, see requireCapabilityOrAdmin above.
router.get('/mine', requireRole('employee'), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
      return res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    }
    const { rows } = await pool.query(
      `SELECT se.date::text AS date, st.id AS template_id, st.name AS template_name, st.start_time, st.end_time
       FROM schedule_entry se
       JOIN shift_template st ON st.id = se.shift_template_id
       WHERE se.employee_id = $1 AND se.date BETWEEN $2 AND $3
       ORDER BY se.date`,
      [req.user.id, from, to]
    );
    res.json({
      entries: rows.map((r) => ({
        date: r.date,
        templateId: r.template_id,
        templateName: r.template_name,
        startTime: r.start_time,
        endTime: r.end_time,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
