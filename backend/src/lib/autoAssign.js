// Auto-assign (CLAUDE.md §13 re-scope, deliberate — was previously on the
// "deliberately not built" list). Opt-in per service (service_type.auto_assign,
// set only by an admin building the service, routes/services.js) — every
// other service keeps today's fully-manual flow untouched.
//
// Fires right after a request is created, inside the same transaction as the
// INSERT (called by routes/requests.js). Picks the least-loaded active
// employee in the service's own subtree and fires the workflow's
// assign-capability transition through workflowEngine's applyTransition — the
// exact same writes a human assign uses (status, task, history, audit,
// notifications), so nothing here re-implements or diverges from that path.
//
// There's no human actor to check Gate 1 (a capability) against, and Gate 2
// (subtree) holds by construction: the candidate pool IS the service owner's
// own subtree (lib/scope.js's subtreeIds), so it can never reach outside it.
// Authorization for this action is the service's auto_assign flag itself.
const { subtreeIds } = require('./scope');
const { applyTransition } = require('./workflowEngine');

// `request` is the just-created row: {id, user_id, status}. `service` is what
// POST /requests already loaded: {ownerId, name, autoAssign, statuses, transitions}.
// Returns the assigned task info, or null if nothing was assigned (disabled,
// no assign-capability transition on this workflow, or no eligible employee —
// all of which just leave the request unassigned, same as the manual path).
async function maybeAutoAssign(client, { request, service }) {
  if (!service.autoAssign) return null;

  // Derived from the data, not a hardcoded status key (§9): the assign-
  // capability transition out of the request's current (just-created) status.
  const transition = service.transitions.find(
    (t) => t.from === request.status && t.required_capability === 'assign'
  );
  if (!transition) return null;

  const scope = await subtreeIds(service.ownerId, client);
  // Least-loaded active employee in scope (§13's own load-balancing pick,
  // not ranking on anything I10 would call behavioural — open task count is
  // the same outcome metric EmployeesPage already surfaces). Ties broken by
  // id for determinism, which also gives round-robin behaviour in practice.
  const { rows: candidates } = await client.query(
    `SELECT u.id, u.name,
            (SELECT COUNT(*)::int
             FROM task t
             JOIN request r ON r.id = t.request_id
             JOIN workflow_definition w ON w.service_type_id = r.service_type_id
             JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = t.status
             WHERE t.employee_id = u.id AND (s->>'is_terminal')::boolean = FALSE
            ) AS open_task_count
     FROM users u
     WHERE u.id = ANY($1) AND u.role = 'employee' AND u.is_active
     ORDER BY open_task_count ASC, u.id ASC
     LIMIT 1`,
    [scope]
  );
  const employee = candidates[0];
  if (!employee) return null;

  const requestForEngine = {
    id: request.id,
    user_id: request.user_id,
    owner_id: service.ownerId,
    status: request.status,
    service_name: service.name,
    statuses: service.statuses,
  };

  const { status, extra } = await applyTransition(client, {
    request: requestForEngine,
    transition,
    task: null,
    actorId: service.ownerId,
    note: `Auto-assigned to ${employee.name}`,
    auditAction: 'request.assigned',
    auditDetail: { assigneeId: employee.id, assignee: employee.name, to: transition.to, auto: true },
    beforeCommit: async (tx, ctx) =>
      (
        await tx.query(
          'INSERT INTO task (request_id, employee_id, status) VALUES ($1, $2, $3) RETURNING id, assigned_at',
          [ctx.request.id, employee.id, ctx.transition.to]
        )
      ).rows[0],
  });

  return {
    status,
    task: {
      id: extra.id,
      employeeId: employee.id,
      employeeName: employee.name,
      assignedAt: extra.assigned_at,
    },
  };
}

module.exports = { maybeAutoAssign };
