// Audit log read surface (spec v4 Section C, admin-only). Writes happen
// inline in the monitors/employees routes via lib/audit.js — this is just the
// filterable read for the Audit Log page.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { DATE_RE } = require('../lib/requestQuery');

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
    if (q.dateFrom !== undefined) add('a.created_at >= ?::date', q.dateFrom);
    if (q.dateTo !== undefined) add("a.created_at < ?::date + INTERVAL '1 day'", q.dateTo);

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
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
