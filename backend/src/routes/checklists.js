// Forms & Checklists dashboard (oversight only). A checklist is just a
// service_type tagged feature_key = 'forms_checklists' (lib/onboardingOptions.js)
// — this file adds nothing to the engine, it only aggregates existing
// request/workflow_definition data per template. "Done" means the request
// reached an is_terminal status (resolved from workflow_definition.statuses,
// same pattern as dashboard.js's byState — never a hardcoded status key).
//
// No due-date/cadence engine exists (documented gap — see docs), so this
// reports real counts (submitted vs logged, today and all-time), not an
// invented "expected count" ratio.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin, requireFeature } = require('../middleware/auth');
const { ownerScopeIds } = require('../lib/scope');
const { COMPANY_TZ, companyDate } = require('../lib/timeClock');

const router = express.Router();
router.use(requireAuth, requireFeature('forms_checklists'), requireCapabilityOrAdmin('view_all'));

router.get('/stats', async (req, res, next) => {
  try {
    const scope = await ownerScopeIds(req.user);
    const { rows } = await pool.query(
      `SELECT st.id, st.name,
              COUNT(r.id) FILTER (WHERE (r.created_at AT TIME ZONE $2)::date = $3::date)::int AS submitted_today,
              COUNT(r.id) FILTER (WHERE (r.created_at AT TIME ZONE $2)::date = $3::date AND lat.is_terminal)::int AS logged_today,
              COUNT(r.id)::int AS submitted_total,
              COUNT(r.id) FILTER (WHERE lat.is_terminal)::int AS logged_total,
              MAX(r.created_at) AS last_submitted_at
       FROM service_type st
       LEFT JOIN workflow_definition w ON w.service_type_id = st.id
       LEFT JOIN request r ON r.service_type_id = st.id
       LEFT JOIN LATERAL (
         SELECT (s->>'is_terminal')::bool AS is_terminal
         FROM jsonb_array_elements(w.statuses) s
         WHERE s->>'key' = r.status
         LIMIT 1
       ) lat ON TRUE
       WHERE st.enabled AND st.feature_key = 'forms_checklists' AND st.owner_id = ANY($1)
       GROUP BY st.id, st.name
       ORDER BY st.id`,
      // "Today" in the company's zone rather than the DB session's — the same
      // basis lib/timeClock.js uses, so a submission near midnight lands on
      // the day the company thinks it did.
      [scope, COMPANY_TZ, companyDate(new Date())]
    );
    res.json({
      templates: rows.map((r) => ({
        serviceTypeId: r.id,
        name: r.name,
        submittedToday: r.submitted_today,
        loggedToday: r.logged_today,
        submittedTotal: r.submitted_total,
        loggedTotal: r.logged_total,
        lastSubmittedAt: r.last_submitted_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
