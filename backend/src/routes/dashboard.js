// Dashboard stats + chart (CLAUDE.md Section 7, monitor only). Counts are
// grouped by status *category* resolved from each service's seeded workflow —
// no status key appears in this code (Section 9).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('monitor'));

router.get('/stats', async (req, res, next) => {
  try {
    const [byCategory, byService, byPriority] = await Promise.all([
      pool.query(
        `SELECT s->>'category' AS category, COUNT(*)::int AS count
         FROM request r
         JOIN workflow_definition w ON w.service_type_id = r.service_type_id
         JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
         GROUP BY 1`
      ),
      pool.query(
        `SELECT st.id, st.name, COUNT(r.id)::int AS count
         FROM service_type st
         LEFT JOIN request r ON r.service_type_id = st.id
         WHERE st.enabled
         GROUP BY st.id, st.name
         ORDER BY st.id`
      ),
      pool.query('SELECT priority, COUNT(*)::int AS count FROM request GROUP BY priority'),
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
      `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM request
       WHERE created_at >= (CURRENT_DATE - INTERVAL '29 days')
       GROUP BY 1`
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
