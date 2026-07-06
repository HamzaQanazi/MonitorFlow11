// Dashboard stats + chart (CLAUDE.md Section 7, monitor only). Counts are
// grouped by status *category* resolved from each service's seeded workflow —
// no status key appears in this code (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('monitor'));

// Spec v4: every query is scoped to the monitor's department — the dashboard
// shows their board, not the whole organization's.
router.get('/stats', async (req, res, next) => {
  try {
    const dept = [req.user.department_id];
    const [byCategory, byService, byPriority] = await Promise.all([
      pool.query(
        `SELECT s->>'category' AS category, COUNT(*)::int AS count
         FROM request r
         JOIN service_type st ON st.id = r.service_type_id
         JOIN workflow_definition w ON w.service_type_id = r.service_type_id
         JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
         WHERE st.department_id = $1
         GROUP BY 1`,
        dept
      ),
      pool.query(
        `SELECT st.id, st.name, COUNT(r.id)::int AS count
         FROM service_type st
         LEFT JOIN request r ON r.service_type_id = st.id
         WHERE st.enabled AND st.department_id = $1
         GROUP BY st.id, st.name
         ORDER BY st.id`,
        dept
      ),
      pool.query(
        `SELECT priority, COUNT(*)::int AS count
         FROM request r JOIN service_type st ON st.id = r.service_type_id
         WHERE st.department_id = $1
         GROUP BY priority`,
        dept
      ),
    ]);

    const categoryCounts = Object.fromEntries(byCategory.rows.map((r) => [r.category, r.count]));
    const priorityCounts = Object.fromEntries(byPriority.rows.map((r) => [r.priority, r.count]));
    const categories = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'];
    const priorities = ['high', 'medium', 'low'];

    res.json({
      total: byCategory.rows.reduce((sum, r) => sum + r.count, 0),
      byCategory: categories.map((c) => ({ category: c, count: categoryCounts[c] || 0 })),
      byService: byService.rows.map((r) => ({ serviceTypeId: r.id, name: r.name, count: r.count })),
      byPriority: priorities.map((p) => ({ priority: p, count: priorityCounts[p] || 0 })),
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
         AND st.department_id = $1
       GROUP BY 1`,
      [req.user.department_id]
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
