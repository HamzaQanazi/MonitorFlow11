// Escalation sweep (spec v4 Section E1) — the one proactive notifier. Each
// run scans for requests that have sat too long, per service-type thresholds
// (NULL = rule off for that service), and inserts `escalation` notifications.
// Category-driven only — no status key appears here (Section 9).
//
// Dedup, no schema needed: a request is skipped while an escalation
// notification newer than its updated_at exists — one alert per stagnation
// period; any status change re-arms the rule.
const pool = require('../db');

const NOT_ALREADY_ESCALATED = `NOT EXISTS (
         SELECT 1 FROM notification n
         WHERE n.request_id = r.id AND n.type = 'escalation'
           AND n.created_at > r.updated_at
       )`;

async function runEscalationSweep() {
  // Rule 1: unassigned too long (new/triage, no task) → the service owner.
  const unassigned = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT m.id, r.id, 'escalation',
            'Request #' || r.id || ' (' || st.name || ') has been waiting unassigned for over ' ||
            st.escalate_unassigned_hours || ' hours.'
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     JOIN users m ON m.id = st.owner_id AND m.is_active
     WHERE s->>'category' IN ('new', 'triage')
       AND NOT EXISTS (SELECT 1 FROM task t WHERE t.request_id = r.id)
       AND st.escalate_unassigned_hours IS NOT NULL
       AND r.updated_at < now() - st.escalate_unassigned_hours * INTERVAL '1 hour'
       AND ${NOT_ALREADY_ESCALATED}`
  );

  // Rule 2: in_progress with no status change too long → the service owner.
  const stale = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT m.id, r.id, 'escalation',
            'Request #' || r.id || ' (' || st.name || ') has had no progress for over ' ||
            st.escalate_stale_hours || ' hours.'
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     JOIN users m ON m.id = st.owner_id AND m.is_active
     WHERE s->>'category' = 'in_progress'
       AND st.escalate_stale_hours IS NOT NULL
       AND r.updated_at < now() - st.escalate_stale_hours * INTERVAL '1 hour'
       AND ${NOT_ALREADY_ESCALATED}`
  );

  // Rule 3: done but unconfirmed too long → nudge the request owner.
  const confirm = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT r.user_id, r.id, 'escalation',
            'Your request #' || r.id || ' (' || st.name || ') was completed over ' ||
            st.escalate_confirm_hours || ' hours ago — please confirm or dispute the result.'
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     WHERE s->>'category' = 'done'
       AND st.escalate_confirm_hours IS NOT NULL
       AND r.updated_at < now() - st.escalate_confirm_hours * INTERVAL '1 hour'
       AND ${NOT_ALREADY_ESCALATED}`
  );

  return { unassigned: unassigned.rowCount, stale: stale.rowCount, confirm: confirm.rowCount };
}

module.exports = { runEscalationSweep };
