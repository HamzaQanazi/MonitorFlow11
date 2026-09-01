// Escalation sweep — the one proactive notifier. Phase 5 (§10): SLAs are
// per-status `sla_minutes` in the workflow JSONB (null/absent = no SLA), and a
// breach escalates to the assignee's DEPARTMENT HEAD (re-scoped, user-
// directed — the manager tree is gone, §6/lib/scope.js), falling back to the
// service owner when the request is unassigned, the assignee has no
// department, their department has no head, or they themselves are the head
// (escalating to yourself isn't an escalation). No status key appears here
// (Section 9): the completion-target
// status (the requester's turn to confirm) is derived from the workflow's
// required_form_key transition, exactly like reports.js.
//
// Dedup, no schema needed: a request is skipped while an escalation
// notification newer than its updated_at exists — one alert per stagnation
// period; any status change re-arms the rule.
const pool = require('../db');

// Human-readable SLA duration, built as a SQL CASE so the sweep keeps composing
// its bilingual messages inside the one INSERT…SELECT. `m` is a SQL int
// expression (minutes). English gets correct singular/plural; Arabic uses the
// singular noun for 1 and the plural for the rest — right for 1 and the common
// 3–10 range, informal for the dual (2) and 11+ edge cases (ponytail: full
// Arabic number agreement isn't worth a grammar table for an SLA nudge).
function durationSql(m, lang) {
  const u =
    lang === 'en'
      ? { day: ['day', 'days'], hour: ['hour', 'hours'], min: ['minute', 'minutes'], and: ' ' }
      : { day: ['يوم', 'أيام'], hour: ['ساعة', 'ساعات'], min: ['دقيقة', 'دقائق'], and: ' و' };
  const unit = (val, pair) =>
    `${val} || ' ' || CASE WHEN ${val} = 1 THEN '${pair[0]}' ELSE '${pair[1]}' END`;
  const days = `(${m} / 1440)`;
  const hours = `(${m} / 60)`;
  const remMin = `(${m} % 60)`;
  return `CASE
            WHEN ${m} % 1440 = 0 THEN ${unit(days, u.day)}
            WHEN ${m} % 60 = 0 THEN ${unit(hours, u.hour)}
            WHEN ${m} >= 60 THEN ${unit(hours, u.hour)} || '${u.and}' || ${unit(remMin, u.min)}
            ELSE ${unit(m, u.min)}
          END`;
}

const SLA_MIN = "(s->>'sla_minutes')::int";

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
  // Rule 1: any SLA'd status breached → the assignee's department head. mgr
  // resolves only when a task exists and the assignee heads a different
  // department than themselves; otherwise the service owner.
  const tree = await pool.query(
    `INSERT INTO notification (user_id, request_id, type, message)
     SELECT COALESCE(mgr.id, own.id), r.id, 'escalation',
            jsonb_build_object(
              'en', 'Request #' || r.id || ' (' || (st.name->>'en') || ') has been in “' ||
                    (s->'label'->>'en') || '” for over ' || (${durationSql(SLA_MIN, 'en')}) ||
                    ', past its SLA.',
              'ar', 'الطلب رقم ' || r.id || ' (' || (st.name->>'ar') || ') بقي في الحالة «' ||
                    (s->'label'->>'ar') || '» لأكثر من ' || (${durationSql(SLA_MIN, 'ar')}) ||
                    '، متجاوزًا مهلته.'
            )
     FROM request r
     JOIN service_type st ON st.id = r.service_type_id
     JOIN workflow_definition w ON w.service_type_id = r.service_type_id
     JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = r.status
     LEFT JOIN task t ON t.request_id = r.id
     LEFT JOIN users emp ON emp.id = t.employee_id
     LEFT JOIN department dept ON dept.id = emp.department_id
     LEFT JOIN users mgr ON mgr.id = dept.head_user_id AND mgr.is_active AND mgr.id <> emp.id
     LEFT JOIN users own ON own.id = st.owner_id AND own.is_active
     WHERE s->>'sla_minutes' IS NOT NULL
       AND NOT (s->>'is_terminal')::bool
       AND r.status <> ${COMPLETION_TARGET}
       AND r.updated_at < now() - (s->>'sla_minutes')::int * INTERVAL '1 minute'
       AND COALESCE(mgr.id, own.id) IS NOT NULL
       AND ${NOT_ALREADY_ESCALATED}
     RETURNING request_id`
  );

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
