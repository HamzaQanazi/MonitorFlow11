// Reports (CLAUDE.md Section 7). Monitor-only. Reuses the ONE request query
// engine (buildRequestFilter) — no second filter implementation. GET /reports
// = the same filtered list + aggregate counts; the CSV export is the same
// filter with the frozen column set and a CSV-injection guard.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { buildRequestFilter } = require('../lib/requestQuery');
const { subtreeIds } = require('../lib/scope');

const router = express.Router();
router.use(requireAuth);
router.use(requireCapability('view_all'));

// Shared FROM/JOINs so list, aggregate, and export all resolve status
// label/category from the workflow data identically. `s` is the current
// status element the WHERE clause references.
const FROM = `
  FROM request r
  JOIN service_type st ON st.id = r.service_type_id
  JOIN users u ON u.id = r.user_id
  JOIN workflow_definition w ON w.service_type_id = r.service_type_id
  JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status`;

// GET /reports — filtered list (paginated) + aggregate counts over the whole
// filtered set (category is a category, not a status key — allowed in code).
router.get('/', async (req, res, next) => {
  try {
    const filter = buildRequestFilter(req.query, req.user, await subtreeIds(req.user.id));
    if (filter.error) return res.status(400).json({ error: filter.error });
    const { where, params, page, pageSize } = filter;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const listParams = [...params, pageSize, (page - 1) * pageSize];
    const list = await pool.query(
      `SELECT r.id, r.service_type_id, st.name AS service_type_name,
              r.status, s->>'label' AS status_label, s->>'category' AS category,
              r.priority, r.created_at, r.updated_at,
              u.id AS requester_id, u.name AS requester_name,
              COUNT(*) OVER()::int AS total
       ${FROM} ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const agg = await pool.query(
      `SELECT s->>'category' AS category, r.priority, st.name AS service_type_name
       ${FROM} ${whereSql}`,
      params
    );
    const byCategory = {};
    const byPriority = {};
    const byService = {};
    for (const row of agg.rows) {
      byCategory[row.category] = (byCategory[row.category] || 0) + 1;
      byPriority[row.priority] = (byPriority[row.priority] || 0) + 1;
      byService[row.service_type_name] = (byService[row.service_type_name] || 0) + 1;
    }

    res.json({
      requests: list.rows.map((r) => ({
        id: r.id,
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        status: { key: r.status, label: r.status_label, category: r.category },
        priority: r.priority,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        requester: { id: r.requester_id, name: r.requester_name },
      })),
      page,
      pageSize,
      total: list.rows.length ? list.rows[0].total : 0,
      aggregates: { total: agg.rows.length, byCategory, byPriority, byService },
    });
  } catch (err) {
    next(err);
  }
});

// A leading =, +, -, or @ makes a spreadsheet treat the cell as a formula;
// prefix with ' to neutralize (Section 7). Then apply normal CSV quoting.
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
  return s;
}

// GET /reports/export.csv — same filters, frozen columns. completed_at is
// derived from the first history row whose status is a `done` category (the
// completion moment), not a stored column.
router.get('/export.csv', requireCapability('export'), async (req, res, next) => {
  try {
    const filter = buildRequestFilter(req.query, req.user, await subtreeIds(req.user.id));
    if (filter.error) return res.status(400).json({ error: filter.error });
    const { where, params } = filter;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // ponytail: exports the full filtered set unpaginated — fine at MVP scale;
    // add a cap/streaming if the request table ever grows large.
    const { rows } = await pool.query(
      `SELECT r.id, st.name AS service_type_name,
              s->>'label' AS status_label, s->>'category' AS category,
              r.priority, u.name AS requester_name,
              emp.name AS employee_name, r.created_at,
              comp.completed_at
       ${FROM}
       LEFT JOIN task t ON t.request_id = r.id
       LEFT JOIN users emp ON emp.id = t.employee_id
       LEFT JOIN LATERAL (
         SELECT MIN(h.changed_at) AS completed_at
         FROM request_status_history h
         JOIN LATERAL jsonb_array_elements(w.statuses) ds ON ds->>'key' = h.status
         WHERE h.request_id = r.id AND ds->>'category' = 'done'
       ) comp ON TRUE
       ${whereSql}
       ORDER BY r.created_at DESC`,
      params
    );

    const header = ['id', 'service_type', 'status_label', 'category', 'priority',
      'requester_name', 'employee_name', 'created_at', 'completed_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.id, r.service_type_name, r.status_label, r.category, r.priority,
        r.requester_name, r.employee_name,
        r.created_at ? r.created_at.toISOString() : '',
        r.completed_at ? r.completed_at.toISOString() : '',
      ].map(csvCell).join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="requests.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
