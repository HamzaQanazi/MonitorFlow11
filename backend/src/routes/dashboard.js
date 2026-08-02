// Dashboard stats + chart (CLAUDE.md Section 7, oversight only). Phase 4 (§10):
// `category` is gone, so the cross-service grouping is open vs closed, resolved
// from each status's `is_terminal` flag — no status key appears here (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin } = require('../middleware/auth');
const { ownerScopeIds } = require('../lib/scope');

const router = express.Router();
router.use(requireAuth, requireCapabilityOrAdmin('view_all'));

router.get('/stats', async (req, res, next) => {
  try {
    const dept = [await ownerScopeIds(req.user)];
    const [byState, byService, byPriority, byDepartment, byRequesterRole, slaBreach, reopen, workload] = await Promise.all([
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
      // Who submitted it — 'user' (external/self-registered) vs 'employee'
      // (internal, e.g. Time Off). Generic across every service (I1): this
      // reads the requester's role, never a service key.
      pool.query(
        `SELECT u.role, COUNT(*)::int AS count
         FROM request r
         JOIN service_type st ON st.id = r.service_type_id
         JOIN users u ON u.id = r.user_id
         WHERE st.owner_id = ANY($1)
         GROUP BY u.role`,
        dept
      ),
      // SLA breaches (I10 outcome metric, §10/§14): same is_terminal + sla_minutes
      // reasoning as lib/escalation.js's sweep, just counted instead of notified —
      // a currently-open request whose time in its current status has passed that
      // status's sla_minutes. No status key involved (§8/§9).
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM request r
         JOIN service_type st ON st.id = r.service_type_id
         JOIN workflow_definition w ON w.service_type_id = r.service_type_id
         JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
         WHERE st.owner_id = ANY($1)
           AND s->>'sla_minutes' IS NOT NULL
           AND NOT (s->>'is_terminal')::bool
           AND r.updated_at < now() - (s->>'sla_minutes')::int * INTERVAL '1 minute'`,
        dept
      ),
      // Reopen rate (I10 outcome metric): a request "reopened" if its status
      // history ever moves from an is_terminal status back to a non-terminal one
      // (LAG over the timeline, same is_terminal-only reasoning — never a status
      // key). Rate is of requests that were ever closed at least once.
      pool.query(
        `WITH hist AS (
           SELECT h.request_id, h.changed_at,
                  (s->>'is_terminal')::bool AS is_terminal,
                  LAG((s->>'is_terminal')::bool) OVER (
                    PARTITION BY h.request_id ORDER BY h.changed_at
                  ) AS prev_terminal
           FROM request_status_history h
           JOIN request r ON r.id = h.request_id
           JOIN service_type st ON st.id = r.service_type_id
           JOIN workflow_definition w ON w.service_type_id = r.service_type_id
           JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = h.status
           WHERE st.owner_id = ANY($1)
         )
         SELECT
           COUNT(DISTINCT request_id) FILTER (WHERE is_terminal)::int AS ever_closed,
           COUNT(DISTINCT request_id) FILTER (WHERE prev_terminal AND NOT is_terminal)::int AS reopened
         FROM hist`,
        dept
      ),
      // Open workload per employee (I10 outcome metric: "open workload", not
      // behaviour) — count of each employee's non-terminal tasks, scoped to the
      // actor's subtree (Gate 2, same `dept` scope array as everything above).
      // Top 8 by load; employees with zero open tasks just don't appear.
      pool.query(
        `SELECT u.id AS employee_id, u.name AS employee_name, COUNT(*)::int AS open_count
         FROM task t
         JOIN request r ON r.id = t.request_id
         JOIN workflow_definition w ON w.service_type_id = r.service_type_id
         JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = t.status
         JOIN users u ON u.id = t.employee_id
         WHERE NOT (s->>'is_terminal')::bool
           AND u.id = ANY($1)
         GROUP BY u.id, u.name
         ORDER BY open_count DESC
         LIMIT 8`,
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
    const requesterRoleCounts = Object.fromEntries(byRequesterRole.rows.map((r) => [r.role, r.count]));
    const requesterRoles = ['user', 'employee'];

    // Weighted overall average = total resolved minutes / total resolved count,
    // so it isn't skewed by departments with few resolutions. null when nothing
    // has been resolved yet (the client renders "—", not "0 min").
    let totalMinutes = 0;
    let resolvedCount = 0;
    for (const r of byDepartment.rows) {
      totalMinutes += Number(r.total_minutes);
      resolvedCount += r.completed_count;
    }

    const slaBreachCount = slaBreach.rows[0].count;
    const { ever_closed: everClosed, reopened } = reopen.rows[0];

    res.json({
      total: open + closed,
      avgResolutionMinutes: resolvedCount ? Math.round(totalMinutes / resolvedCount) : null,
      byState: [
        { state: 'open', count: open },
        { state: 'closed', count: closed },
      ],
      byService: byService.rows.map((r) => ({ serviceTypeId: r.id, name: r.name, count: r.count })),
      byPriority: priorities.map((p) => ({ priority: p, count: priorityCounts[p] || 0 })),
      byRequesterRole: requesterRoles.map((role) => ({ role, count: requesterRoleCounts[role] || 0 })),
      byDepartment: byDepartment.rows.map((r) => ({
        departmentId: r.department_id,
        name: r.department_name,
        count: r.count,
        avgResolutionMinutes: r.completed_count
          ? Math.round(Number(r.total_minutes) / r.completed_count)
          : null,
      })),
      slaBreaches: { count: slaBreachCount, rate: open ? slaBreachCount / open : null },
      reopenRate: { reopened, everClosed, rate: everClosed ? reopened / everClosed : null },
      workload: workload.rows.map((r) => ({
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        openCount: r.open_count,
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
    // Per day, split by the request's CURRENT status is_terminal (same
    // reasoning as byState above) — of what was created that day, how much has
    // since been resolved vs is still open. Never a status key (§8/§9).
    const { rows } = await pool.query(
      `SELECT to_char(r.created_at::date, 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE (s->>'is_terminal')::bool)::int AS closed,
              COUNT(*) FILTER (WHERE NOT (s->>'is_terminal')::bool)::int AS open
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
       WHERE r.created_at >= (CURRENT_DATE - INTERVAL '29 days')
         AND st.owner_id = ANY($1)
       GROUP BY 1`,
      [await ownerScopeIds(req.user)]
    );
    const byDay = Object.fromEntries(rows.map((r) => [r.day, { open: r.open, closed: r.closed }]));
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      const { open = 0, closed = 0 } = byDay[key] || {};
      days.push({ date: key, open, closed, count: open + closed });
    }
    res.json({ days });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
