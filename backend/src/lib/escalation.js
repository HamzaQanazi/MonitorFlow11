// Escalation sweep — the one proactive notifier. Phase 5 (§10): SLAs are
// per-status `sla_minutes` in the workflow JSONB (null/absent = no SLA), and a
// breach escalates UP THE MANAGER TREE — the assignee's manager, falling back
// to the service owner when the request is unassigned or the assignee has no
// manager. No status key appears here (Section 9): the completion-target
// status (the requester's turn to confirm) is derived from the workflow's
// required_form_key transition, exactly like reports.js.
//
// Dedup, no schema needed: a request is skipped while an escalation
// notification newer than its updated_at exists — one alert per stagnation
// period; any status change re-arms the rule.
const pool = require('../db');
const { fireWebhook } = require('./webhooks');

const NOT_ALREADY_ESCALATED = `NOT EXISTS (
         SELECT 1 FROM notification n
         WHERE n.request_id = r.id AND n.type = 'escalation'
           AND n.created_at > r.updated_at
       )`;

// The status a completion transition lands on — while there, the ball is in
// the requester's court, so the breach nudges them instead of the tree.
const COMPLETION_TARGET = `COALESCE((
         SELECT tr->>'to' FROM jsonb_array_elements(w.transitions) tr
         WHERE tr->>'required_form_key' IS NOT NULL LIMIT 1
       ), '')`;

async function runEscalationSweep() {
  // Rule 1: any SLA'd status breached → up the manager tree. mgr resolves only
  // when a task exists (assignee's manager); otherwise the service owner.
  const tree = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT COALESCE(mgr.id, own.id), r.id, 'escalation',
            jsonb_build_object(
              'en', 'Request #' || r.id || ' (' || (st.name->>'en') || ') has exceeded its ' ||
                    (s->>'sla_minutes') || '-minute SLA in status “' || (s->'label'->>'en') || '”.',
              'ar', 'الطلب رقم ' || r.id || ' (' || (st.name->>'ar') || ') تجاوز مهلته البالغة ' ||
                    (s->>'sla_minutes') || ' دقيقة في الحالة «' || (s->'label'->>'ar') || '».'
            )
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     LEFT JOIN task t ON t.request_id = r.id
     LEFT JOIN users emp ON emp.id = t.employee_id
     LEFT JOIN users mgr ON mgr.id = emp.manager_id AND mgr.is_active
     LEFT JOIN users own ON own.id = st.owner_id AND own.is_active
     WHERE s->>'sla_minutes' IS NOT NULL
       AND NOT (s->>'is_terminal')::bool
       AND r.status <> ${COMPLETION_TARGET}
       AND r.updated_at < now() - (s->>'sla_minutes')::int * INTERVAL '1 minute'
       AND COALESCE(mgr.id, own.id) IS NOT NULL
       AND ${NOT_ALREADY_ESCALATED}
     RETURNING request_id`
  );

  // Phase 7: an SLA breach fires the sla_breached webhook, once per newly
  // escalated request (the query's dedup guarantees no repeats within a
  // stagnation period). After the notification INSERT, fire-and-forget.
  if (tree.rowCount) {
    const ids = tree.rows.map((r) => r.request_id);
    const { rows: hooks } = await pool.query(
      `SELECT r.id AS request_id, st.key AS service_key, r.status
       FROM request r JOIN service_type st ON st.id = r.service_type_id
       WHERE r.id = ANY($1)`,
      [ids]
    );
    for (const h of hooks) fireWebhook('sla_breached', h);
  }

  // Rule 2: completion-target status breached → nudge the requester
  // (created_by) to confirm or dispute.
  const confirm = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT r.user_id, r.id, 'escalation',
            jsonb_build_object(
              'en', 'Your request #' || r.id || ' (' || (st.name->>'en') ||
                    ') was completed a while ago — please confirm or dispute the result.',
              'ar', 'اكتمل طلبك رقم ' || r.id || ' (' || (st.name->>'ar') ||
                    ') منذ فترة — يرجى تأكيد النتيجة أو الاعتراض عليها.'
            )
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     WHERE r.status = ${COMPLETION_TARGET}
       AND s->>'sla_minutes' IS NOT NULL
       AND r.updated_at < now() - (s->>'sla_minutes')::int * INTERVAL '1 minute'
       AND ${NOT_ALREADY_ESCALATED}`
  );

  return { tree: tree.rowCount, confirm: confirm.rowCount };
}

module.exports = { runEscalationSweep };
