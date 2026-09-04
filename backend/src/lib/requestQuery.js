// Shared request-list query builder (CLAUDE.md Section 7). ONE query engine
// backs GET /requests, GET /reports, and the CSV export — the spec forbids a
// second one. This validates the standard list params and builds the WHERE
// clause + bound params; each caller appends its own SELECT / pagination.
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A request's requester is always a `user` or `employee` account (I2) —
// filters on who submitted it, not what it's about, so this stays generic
// across every service (I1).
const REQUESTER_ROLES = ['user', 'employee'];

// Returns { error } (a 400 message) on invalid known params, else
// { where, params, page, pageSize }. `where` refers to aliases r (request),
// st (service_type), u (requester), s (the lateral status element) — every
// caller must join those the same way. A user is always scoped to own rows
// regardless of params. An employee sees the union of: requests they
// personally submitted (a service with accepts_employee_submitters) and, if
// oversight, services whose department is inside their scope (`departmentScope`,
// an array of department ids the caller resolves via departmentSubtree/
// departmentScopeIds — service_type.owner_id is gone, 2026-09-04). A
// non-oversight employee passes departmentScope as null/empty, so that half
// of the union contributes nothing and they only ever see their own
// submissions.
function buildRequestFilter(q, user, departmentScope = null) {
  const page = q.page === undefined ? 1 : Number(q.page);
  const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
  const bad = [];
  if (!Number.isInteger(page) || page < 1) bad.push('page');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
  if (q.priority !== undefined && !PRIORITIES.includes(q.priority)) bad.push('priority');
  if (q.serviceTypeId !== undefined && !Number.isInteger(Number(q.serviceTypeId))) bad.push('serviceTypeId');
  if (q.employeeId !== undefined && !Number.isInteger(Number(q.employeeId))) bad.push('employeeId');
  if (q.dateFrom !== undefined && !DATE_RE.test(q.dateFrom)) bad.push('dateFrom');
  if (q.dateTo !== undefined && !DATE_RE.test(q.dateTo)) bad.push('dateTo');
  // Phase 4: `state` (open|closed, from is_terminal) replaces `category`.
  if (q.state !== undefined && !['open', 'closed'].includes(q.state)) bad.push('state');
  if (q.requesterRole !== undefined && !REQUESTER_ROLES.includes(q.requesterRole)) bad.push('requesterRole');
  if (q.slaBreached !== undefined && q.slaBreached !== 'true') bad.push('slaBreached');
  if (q.reopened !== undefined && q.reopened !== 'true') bad.push('reopened');
  if (bad.length) return { error: `Invalid query params: ${bad.join(', ')}` };

  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };

  if (user.role === 'user') add('r.user_id = ?', user.id);
  // Gate 2 union: an employee sees requests they own themselves, plus (if
  // oversight) any whose service's department is in their scope. No scope
  // (or an empty one) contributes nothing to the second half: fail closed,
  // not open.
  if (user.role === 'employee') {
    params.push(user.id, departmentScope || []);
    where.push(`(r.user_id = $${params.length - 1} OR st.department_id = ANY($${params.length}))`);
  }
  if (q.status !== undefined) add('r.status = ?', q.status);
  if (q.state !== undefined) add("(s->>'is_terminal')::bool = ?", q.state === 'closed');
  if (q.serviceTypeId !== undefined) add('r.service_type_id = ?', Number(q.serviceTypeId));
  // Subquery, not a join — callers share the fixed alias set (see above),
  // and a request has at most one task row (Section 5).
  if (q.employeeId !== undefined) {
    add('r.id IN (SELECT request_id FROM task WHERE employee_id = ?)', Number(q.employeeId));
  }
  if (q.priority !== undefined) add('r.priority = ?', q.priority);
  // Who submitted it — 'user' (external/self-registered) vs 'employee'
  // (internal, e.g. Time Off). Independent of the caller's own scope above:
  // an oversight employee can narrow their subtree view to just one kind.
  if (q.requesterRole !== undefined) add('u.role = ?', q.requesterRole);
  if (q.dateFrom !== undefined) add('r.created_at >= ?::date', q.dateFrom);
  if (q.dateTo !== undefined) add("r.created_at < ?::date + INTERVAL '1 day'", q.dateTo);
  // Same is_terminal + sla_minutes reasoning as the dashboard's SLA-breach
  // count and lib/escalation.js's sweep (§10) — never a status key. `s` is
  // the current-status lateral element every caller already joins.
  if (q.slaBreached === 'true') {
    where.push(
      `s->>'sla_minutes' IS NOT NULL AND NOT (s->>'is_terminal')::bool ` +
        `AND r.updated_at < now() - (s->>'sla_minutes')::int * INTERVAL '1 minute'`
    );
  }
  // Same reopen definition as the dashboard's reopen-rate metric (§10): the
  // request's history ever moved from an is_terminal status back to a
  // non-terminal one. Correlated per-request, not the dashboard's aggregate.
  if (q.reopened === 'true') {
    where.push(
      `EXISTS (
         SELECT 1 FROM (
           SELECT (s2->>'is_terminal')::bool AS is_terminal,
                  LAG((s2->>'is_terminal')::bool) OVER (ORDER BY h.changed_at) AS prev_terminal
           FROM request_status_history h
           JOIN workflow_definition w2 ON w2.service_type_id = r.service_type_id
           JOIN LATERAL jsonb_array_elements(w2.statuses) s2 ON s2->>'key' = h.status
           WHERE h.request_id = r.id
         ) hist
         WHERE hist.prev_terminal AND NOT hist.is_terminal
       )`
    );
  }
  // st.name is bilingual JSONB (Phase 3) — search both language values.
  if (q.q) add("(u.name ILIKE ? OR st.name->>'en' ILIKE ? OR st.name->>'ar' ILIKE ?)", `%${q.q}%`);

  return { where, params, page, pageSize };
}

module.exports = { buildRequestFilter, PRIORITIES, DATE_RE, REQUESTER_ROLES };
