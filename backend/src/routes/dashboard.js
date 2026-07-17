// Dashboard stats + chart (CLAUDE.md Section 7, oversight only). Phase 4 (§10):
// `category` is gone, so the cross-service grouping is open vs closed, resolved
// from each status's `is_terminal` flag — no status key appears here (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { subtreeIds } = require('../lib/scope');

const router = express.Router();
router.use(requireAuth, requireCapability('view_all'));

// Gate 2: every query is scoped to the services the oversight actor's subtree
// owns — the dashboard shows their board, not the whole organization's.
router.get('/stats', async (req, res, next) => {
  try {
    const dept = [await subtreeIds(req.user.id)];
    const [byState, byService, byPriority, byDepartment] = await Promise.all([
      pool.query(
        `SELECT (s->>'is_terminal')::bool AS is_terminal, COUNT(*)::int AS count
         FROM request r
         JOIN service_type st ON st.id = r.service_type_id
         JOIN workflow_definition w ON w.service_type_id = r.service_type_id
         JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
         WHERE st.owner_id = ANY($1)
         GROUP BY 1`,
        dept
      ),
      pool.query(
        `SELECT st.id, st.name, COUNT(r.id)::int AS count
         FROM service_type st
         LEFT JOIN request r ON r.service_type_id = st.id
         WHERE st.enabled AND st.owner_id = ANY($1)
         GROUP BY st.id, st.name
         ORDER BY st.id`,
        dept
      ),
      pool.query(
        `SELECT priority, COUNT(*)::int AS count
         FROM request r JOIN service_type st ON st.id = r.service_type_id
         WHERE st.owner_id = ANY($1)
         GROUP BY priority`,
        dept
      ),
      // Per-department request counts (for the distribution pie) + resolution
      // time. "Resolved" = the request reached its completion-form transition's
      // target status (same definition as the CSV export's completed_at, §7);
      // requests that never got there (e.g. rejected) are excluded from the
      // average, not counted as instant. completed_count carries the weight so
      // the overall average can be re-derived without unweighting per-dept means.
      pool.query(
        `SELECT d.id AS department_id, d.name AS department_name,
                COUNT(r.id)::int AS count,
                COUNT(comp.completed_at)::int AS completed_count,
                COALESCE(SUM(EXTRACT(EPOCH FROM (comp.completed_at - r.created_at)) / 60), 0) AS total_minutes
         FROM service_type st
         JOIN department d ON d.id = st.department_id
         LEFT JOIN request r ON r.service_type_id = st.id
         LEFT JOIN workflow_definition w ON w.service_type_id = st.id
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
         WHERE st.enabled AND st.owner_id = ANY($1)
         GROUP BY d.id, d.name
         ORDER BY d.id`,
        dept
      ),
    ]);

    // Open vs closed replaces the old six-way category breakdown (§10 dropped
    // category). `is_terminal: true` rows are closed; everything else is open.
    let open = 0;
    let closed = 0;
    for (const r of byState.rows) {
      if (r.is_terminal) closed += r.count;
      else open += r.count;
    }
    const priorityCounts = Object.fromEntries(byPriority.rows.map((r) => [r.priority, r.count]));
    const priorities = ['high', 'medium', 'low'];

    // Weighted overall average = total resolved minutes / total resolved count,
    // so it isn't skewed by departments with few resolutions. null when nothing
    // has been resolved yet (the client renders "—", not "0 min").
    let totalMinutes = 0;
    let resolvedCount = 0;
    for (const r of byDepartment.rows) {
      totalMinutes += Number(r.total_minutes);
      resolvedCount += r.completed_count;
    }

    res.json({
      total: open + closed,
      avgResolutionMinutes: resolvedCount ? Math.round(totalMinutes / resolvedCount) : null,
      byState: [
        { state: 'open', count: open },
        { state: 'closed', count: closed },
      ],
      byService: byService.rows.map((r) => ({ serviceTypeId: r.id, name: r.name, count: r.count })),
      byPriority: priorities.map((p) => ({ priority: p, count: priorityCounts[p] || 0 })),
      byDepartment: byDepartment.rows.map((r) => ({
        departmentId: r.department_id,
        name: r.department_name,
        count: r.count,
        avgResolutionMinutes: r.completed_count
          ? Math.round(Number(r.total_minutes) / r.completed_count)
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Local (server-tz) YYYY-MM-DD, matching Postgres CURRENT_DATE bucketing.
function localDayKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

router.get('/chart', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT to_char(r.created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM request r JOIN service_type st ON st.id = r.service_type_id
       WHERE r.created_at >= (CURRENT_DATE - INTERVAL '29 days')
         AND st.owner_id = ANY($1)
       GROUP BY 1`,
      [await subtreeIds(req.user.id)]
    );
    const counts = Object.fromEntries(rows.map((r) => [r.day, r.count]));
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      days.push({ date: key, count: counts[key] || 0 });
    }
    res.json({ days });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
