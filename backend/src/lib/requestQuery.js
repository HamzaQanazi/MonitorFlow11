// Shared request-list query builder (CLAUDE.md Section 7). ONE query engine
// backs GET /requests, GET /reports, and the CSV export — the spec forbids a
// second one. This validates the standard list params and builds the WHERE
// clause + bound params; each caller appends its own SELECT / pagination.
const CATEGORIES = ['new', 'triage', 'in_progress', 'done', 'closed', 'terminated'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Returns { error } (a 400 message) on invalid known params, else
// { where, params, page, pageSize }. `where` refers to aliases r (request),
// st (service_type), u (requester), s (the lateral status element) — every
// caller must join those the same way. A user is always scoped to own rows
// regardless of params; monitor sees all.
function buildRequestFilter(q, user) {
  const page = q.page === undefined ? 1 : Number(q.page);
  const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
  const bad = [];
  if (!Number.isInteger(page) || page < 1) bad.push('page');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
  if (q.category !== undefined && !CATEGORIES.includes(q.category)) bad.push('category');
  if (q.priority !== undefined && !PRIORITIES.includes(q.priority)) bad.push('priority');
  if (q.serviceTypeId !== undefined && !Number.isInteger(Number(q.serviceTypeId))) bad.push('serviceTypeId');
  if (q.employeeId !== undefined && !Number.isInteger(Number(q.employeeId))) bad.push('employeeId');
  if (q.dateFrom !== undefined && !DATE_RE.test(q.dateFrom)) bad.push('dateFrom');
  if (q.dateTo !== undefined && !DATE_RE.test(q.dateTo)) bad.push('dateTo');
  if (bad.length) return { error: `Invalid query params: ${bad.join(', ')}` };

  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };

  if (user.role === 'user' || q.userId === 'me') add('r.user_id = ?', user.id);
  // Spec v4: monitors are department-scoped — they see only requests whose
  // service type belongs to their department. A monitor with no department
  // (should not exist) matches nothing: fail closed, not open.
  if (user.role === 'monitor') add('st.department_id = ?', user.department_id);
  if (q.status !== undefined) add('r.status = ?', q.status);
  if (q.category !== undefined) add("s->>'category' = ?", q.category);
  if (q.serviceTypeId !== undefined) add('r.service_type_id = ?', Number(q.serviceTypeId));
  // Subquery, not a join — callers share the fixed alias set (see above),
  // and a request has at most one task row (Section 5).
  if (q.employeeId !== undefined) {
    add('r.id IN (SELECT request_id FROM task WHERE employee_id = ?)', Number(q.employeeId));
  }
  if (q.priority !== undefined) add('r.priority = ?', q.priority);
  if (q.dateFrom !== undefined) add('r.created_at >= ?::date', q.dateFrom);
  if (q.dateTo !== undefined) add("r.created_at < ?::date + INTERVAL '1 day'", q.dateTo);
  if (q.q) add('(u.name ILIKE ? OR st.name ILIKE ?)', `%${q.q}%`);

  return { where, params, page, pageSize };
}

module.exports = { buildRequestFilter, CATEGORIES, PRIORITIES, DATE_RE };
