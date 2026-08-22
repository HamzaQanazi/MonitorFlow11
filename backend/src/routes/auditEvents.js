// Audit log read surface (spec v4 Section C, admin-only). Writes happen
// inline in the monitors/employees routes via lib/audit.js — this is just the
// filterable read for the Audit Log page.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { DATE_RE } = require('../lib/requestQuery');
const { COMPANY_TZ } = require('../lib/timeClock');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

// GET /audit-events?action=&actorId=&dateFrom=&dateTo=&page=&pageSize=
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (q.actorId !== undefined && !Number.isInteger(Number(q.actorId))) bad.push('actorId');
    if (q.dateFrom !== undefined && !DATE_RE.test(q.dateFrom)) bad.push('dateFrom');
    if (q.dateTo !== undefined && !DATE_RE.test(q.dateTo)) bad.push('dateTo');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.action) add('a.action = ?', q.action);
    if (q.actorId !== undefined) add('a.actor_id = ?', Number(q.actorId));
    // Day boundaries in the company's zone, not the DB session's — the same
    // basis Time Clock buckets by, so "1 March" means one thing everywhere.
    if (q.dateFrom !== undefined) {
      params.push(q.dateFrom, COMPANY_TZ);
      where.push(`a.created_at >= ($${params.length - 1}::date)::timestamp AT TIME ZONE $${params.length}`);
    }
    if (q.dateTo !== undefined) {
      params.push(q.dateTo, COMPANY_TZ);
      where.push(`a.created_at < ($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length}`);
    }

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.detail, a.created_at,
              u.id AS actor_id, u.name AS actor_name,
              e.name AS entity_name,
              COUNT(*) OVER()::int AS total
       FROM audit_event a
       JOIN users u ON u.id = a.actor_id
       LEFT JOIN users e ON a.entity_type = 'user' AND e.id = a.entity_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    // Distinct actors present in the log, for the actor filter dropdown. Now
    // that operational events are audited, actors include managers/field staff,
    // not just the admin — so the client can't build this from the current user.
    // Unfiltered (whole table) so every actor is always selectable.
    const { rows: actors } = await pool.query(
      `SELECT DISTINCT u.id, u.name
       FROM audit_event a JOIN users u ON u.id = a.actor_id
       ORDER BY u.name`
    );

    // The action filter's options, derived from the log the same way. The
    // client used to hardcode this list and it had drifted hard: it offered
    // level.created/updated/deleted and employee.level_changed, none of which
    // any writer produces (they are employee_level.*), while every department,
    // event, knowledge-base, schedule, shift-template, time-shift and company
    // action was missing entirely. An action key is exactly the kind of thing
    // I4 says a client must not hardcode.
    const { rows: actions } = await pool.query(
      'SELECT DISTINCT action FROM audit_event ORDER BY action'
    );

    res.json({
      events: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        entityName: r.entity_name,
        detail: r.detail,
        createdAt: r.created_at,
        actor: { id: r.actor_id, name: r.actor_name },
      })),
      actors: actors.map((a) => ({ id: a.id, name: a.name })),
      actions: actions.map((a) => a.action),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
