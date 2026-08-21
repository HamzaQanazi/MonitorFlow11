// Reports (CLAUDE.md Section 7). Monitor-only. Reuses the ONE request query
// engine (buildRequestFilter) — no second filter implementation. GET /reports
// = the same filtered list + aggregate counts; the CSV export is the same
// filter with the frozen column set and a CSV-injection guard.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { buildRequestFilter } = require('../lib/requestQuery');
const { subtreeIds } = require('../lib/scope');
const { csvCell } = require('../lib/csv');

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
              r.status, s->'label' AS status_label, (s->>'is_terminal')::bool AS is_terminal,
              r.priority, r.created_at, r.updated_at,
              u.id AS requester_id, u.name AS requester_name,
              COUNT(*) OVER()::int AS total
       ${FROM} ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const agg = await pool.query(
      `SELECT (s->>'is_terminal')::bool AS is_terminal, r.priority, st.name->>'en' AS service_type_name,
              u.role AS requester_role, to_char(r.created_at::date, 'YYYY-MM-DD') AS day
       ${FROM} ${whereSql}`,
      params
    );
    // §10 dropped category; the cross-service aggregate is open vs closed.
    const byState = { open: 0, closed: 0 };
    const byPriority = {};
    const byService = {};
    const byRequesterRole = { user: 0, employee: 0 };
    // Trend (feature request, 2026-08-21): same open/closed-by-current-status
    // split as the dashboard's chart, but over whatever range this filtered
    // set actually spans, not a fixed 30 days — Reports has its own
    // dateFrom/dateTo filters, and there's no one "default window" for an
    // all-time custom report the way there is for a live dashboard.
    const byDay = new Map();
    for (const row of agg.rows) {
      if (row.is_terminal) byState.closed += 1;
      else byState.open += 1;
      byPriority[row.priority] = (byPriority[row.priority] || 0) + 1;
      byService[row.service_type_name] = (byService[row.service_type_name] || 0) + 1;
      byRequesterRole[row.requester_role] = (byRequesterRole[row.requester_role] || 0) + 1;
      const bucket = byDay.get(row.day) || { open: 0, closed: 0 };
      if (row.is_terminal) bucket.closed += 1;
      else bucket.open += 1;
      byDay.set(row.day, bucket);
    }
    // Zero-fill the gaps so the chart is a continuous line, not sparse dots —
    // ponytail: capped at 366 days: a report spanning more than a year skips
    // the fill and just returns the days that actually have data, so this
    // can't generate an unbounded number of columns.
    const days = [...byDay.keys()].sort();
    let chartDays = days.map((date) => ({ date, ...byDay.get(date), count: byDay.get(date).open + byDay.get(date).closed }));
    if (days.length > 1) {
      const first = new Date(`${days[0]}T00:00:00Z`);
      const last = new Date(`${days[days.length - 1]}T00:00:00Z`);
      const spanDays = Math.round((last - first) / 86400000);
      if (spanDays > 0 && spanDays <= 366) {
        chartDays = [];
        for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
          const key = d.toISOString().slice(0, 10);
          const bucket = byDay.get(key) || { open: 0, closed: 0 };
          chartDays.push({ date: key, ...bucket, count: bucket.open + bucket.closed });
        }
      }
    }

    res.json({
      requests: list.rows.map((r) => ({
        id: r.id,
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        status: { key: r.status, label: r.status_label, isTerminal: r.is_terminal },
        priority: r.priority,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        requester: { id: r.requester_id, name: r.requester_name },
      })),
      page,
      pageSize,
      total: list.rows.length ? list.rows[0].total : 0,
      aggregates: { total: agg.rows.length, byState, byPriority, byService, byRequesterRole },
      chart: chartDays,
    });
  } catch (err) {
    next(err);
  }
});

// GET /reports/export.csv — same filters, frozen columns (§10 replaced the
// `category` column with `state` = open/closed). completed_at is the first
// history row whose status is the completion transition's target (the status a
// required_form_key transition lands in), derived from the data — no category,
// no status key.
router.get('/export.csv', requireCapability('export'), async (req, res, next) => {
  try {
    const filter = buildRequestFilter(req.query, req.user, await subtreeIds(req.user.id));
    if (filter.error) return res.status(400).json({ error: filter.error });
    const { where, params } = filter;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // ponytail: exports the full filtered set unpaginated — fine at MVP scale;
    // add a cap/streaming if the request table ever grows large.
    const { rows } = await pool.query(
      `SELECT r.id, st.name->>'en' AS service_type_name,
              s->'label'->>'en' AS status_label, (s->>'is_terminal')::bool AS is_terminal,
              r.priority, u.name AS requester_name, u.role AS requester_role,
              emp.name AS employee_name, r.created_at,
              comp.completed_at
       ${FROM}
       LEFT JOIN task t ON t.request_id = r.id
       LEFT JOIN users emp ON emp.id = t.employee_id
       LEFT JOIN LATERAL (
         SELECT MIN(h.changed_at) AS completed_at
         FROM request_status_history h
         WHERE h.request_id = r.id
           AND h.status = (
             SELECT tr->>'to' FROM jsonb_array_elements(w.transitions) tr
             WHERE tr->>'required_form_key' IS NOT NULL
             LIMIT 1
           )
       ) comp ON TRUE
       ${whereSql}
       ORDER BY r.created_at DESC`,
      params
    );

    const header = ['id', 'service_type', 'status_label', 'state', 'priority',
      'requester_name', 'requester_role', 'employee_name', 'created_at', 'completed_at'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.id, r.service_type_name, r.status_label, r.is_terminal ? 'closed' : 'open', r.priority,
        r.requester_name, r.requester_role, r.employee_name,
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
