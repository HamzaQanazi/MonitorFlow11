// Workflow engine (CLAUDE.md Sections 5 + 9, Phase 4 model §10): the ONE module
// that validates and executes every status transition. Nothing else may write
// REQUEST.status or TASK.status. No status key appears here — the engine reasons
// only in workflow data, `is_terminal`, transition `key`s, and the two gates.
//
// Phase 4: transitions are keyed, and gated by exactly one of
//   • `required_capability` — an oversight capability (Gate 1), or
//   • `actor` ('requester' | 'assignee') — the party whose turn it is.
// The generic /requests/{id}/transitions call serves the actor-based
// transitions (the requester owns the request; the assignee owns the task);
// oversight transitions are fired by the dedicated /assign, /priority, /status
// endpoints. `category` is gone — the terminal lock is `is_terminal`.
//
// Order per Section 9.2, with the Section 6 404-over-403 rule folded in:
// lock REQUEST row → expected_status concurrency (409 stale) → ownership (404)
// → transition exists (409) → party/capability (403) → note / required-form
// (422 / 409) → write both statuses + history + notifications in the same
// transaction → commit.
const pool = require('../db');
const { ownerInScope } = require('./scope');
const { isOversight } = require('./capabilities');
const { pick } = require('./i18nLabel');

class WorkflowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function statusMeta(statuses, key) {
  return statuses.find((st) => st.key === key) || null;
}

function isTerminal(statuses, key) {
  const s = statusMeta(statuses, key);
  return !!(s && s.is_terminal);
}

function statusOf(statuses, key) {
  const s = statusMeta(statuses, key);
  // API-shaped (camelCase) — routes embed this object verbatim, and the list
  // endpoints hand-build the same {key, label, isTerminal} shape in SQL.
  return { key, label: s ? s.label : key, isTerminal: !!(s && s.is_terminal) };
}

// The party a caller acts as on this request. Oversight employees are not
// served by the generic path (they use the dedicated endpoints), so only the
// requester and the assignee resolve here.
function partyOf(user) {
  return user.role === 'user' ? 'requester' : 'assignee';
}

// Actor-based transitions available to `actor` from the current status. Empty
// while the status is terminal (the task lock, Section 5) — terminal statuses
// have no outgoing transitions anyway (seed-time enforced), but the rule is
// explicit here too.
function validTransitions(statuses, transitions, currentStatus, actor) {
  if (isTerminal(statuses, currentStatus)) return [];
  return transitions.filter(
    (t) => t.from === currentStatus && t.required_capability == null && t.actor === actor
  );
}

// Pure validation core — everything but the I/O, so the Section 13 unit cells
// (valid, invalid, wrong party, terminal-locked, note) run without a database.
// Returns the matched transition or throws.
function resolveTransition({
  statuses,
  transitions,
  currentStatus,
  user,
  requestUserId,
  taskEmployeeId, // null when no task exists
  transitionKey,
  note = null,
  formValidated = false,
}) {
  // Ownership first (404-over-403, Section 6): a requester must own the
  // request; a non-oversight employee must own the task. An oversight actor
  // owns nothing — its scope is checked as Gate 2 (subtree) in
  // executeTransition, which needs the DB.
  const oversight = isOversight(user);
  if (user.role === 'user' && requestUserId !== user.id) {
    throw new WorkflowError(404, 'Not found');
  }
  if (user.role === 'employee' && !oversight && taskEmployeeId !== user.id) {
    throw new WorkflowError(404, 'Not found');
  }

  const t = transitions.find((tr) => tr.key === transitionKey && tr.from === currentStatus);
  if (!t) {
    throw new WorkflowError(409, 'This transition is not valid from the current status');
  }
  // Two gates. A capability-gated transition (e.g. assign, fired by a
  // dedicated oversight endpoint) needs Gate 1 — the capability. An
  // actor-based transition belongs to exactly one party (requester/assignee).
  if (t.required_capability != null) {
    if (!(user.capabilities instanceof Set && user.capabilities.has(t.required_capability))) {
      throw new WorkflowError(403, 'Forbidden');
    }
  } else if (t.actor !== partyOf(user)) {
    throw new WorkflowError(403, 'Forbidden');
  }
  // Section 6: the requester may only cancel while unassigned. The cancel is
  // the requester→terminal transition OUT OF THE INITIAL status (pre-work);
  // later requester→terminal moves (confirm) legitimately fire with a task.
  // A task can exist at the initial status after an assignee reject (the row
  // is retained for reuse) — that request is claimed, so cancel is closed.
  // Enforced here so both doors — PATCH /cancel and the generic
  // POST /transitions — share the one guard.
  // ponytail: scoped to the initial status; a workflow offering requester
  // cancel from a later pre-work status would need a richer signal.
  if (
    t.actor === 'requester' &&
    isTerminal(statuses, t.to) &&
    (statusMeta(statuses, t.from) || {}).is_initial &&
    taskEmployeeId !== null
  ) {
    throw new WorkflowError(409, 'This request can no longer be cancelled — it has been assigned');
  }
  if (t.requires_note && !(note && note.trim())) {
    throw new WorkflowError(422, 'A note is required for this transition');
  }
  if (t.required_form_key && !formValidated) {
    throw new WorkflowError(409, 'This transition requires a form submission');
  }
  return t;
}

// Oversight override (Section 7 PATCH /requests/{id}/status): forces a status
// outside the transition table, gated by the `override` capability. With
// `category` gone the constraint loosens — an override may target any existing
// status that is not the initial status and not the current one (reject/cancel
// to a terminal, or reopen to a working status). Unknown keys are 422
// (must-pass #18); a note is always required.
// ponytail: override may target any non-initial status; the old category-based
// reject-vs-reopen distinction went away with `category` (§10 decision).
function resolveOverride({ statuses, currentStatus, user, to, note }) {
  if (!(user.capabilities instanceof Set && user.capabilities.has('override'))) {
    throw new WorkflowError(403, 'Forbidden');
  }
  const target = statusMeta(statuses, to);
  if (!target) throw new WorkflowError(422, 'Target is not a status in this workflow');
  if (target.is_initial) {
    throw new WorkflowError(422, 'An override cannot return a request to its initial status');
  }
  if (to === currentStatus) {
    throw new WorkflowError(409, 'The request is already in this status');
  }
  if (!(note && note.trim())) {
    throw new WorkflowError(422, 'A note is required for an override');
  }
  return {
    key: 'override',
    from: currentStatus,
    to,
    actor: null,
    required_capability: 'override',
    required_form_key: null,
    requires_note: true,
    notify_oversight: false,
  };
}

// Executes one transition. `beforeCommit(client, ctx)` runs inside the same
// transaction after the status/history writes — /complete uses it to store the
// completion form response. With `override: true` the transition table is
// bypassed via resolveOverride; the locking, writes, history, and
// notifications are identical.
async function executeTransition({
  requestId,
  user,
  transitionKey = null,
  to = null, // override only
  note = null,
  expectedStatus = null,
  formValidated = false,
  beforeCommit = null,
  override = false,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the request row before any validation (Section 5 locking rule).
    const { rows } = await client.query(
      `SELECT r.id, r.user_id, r.status, r.service_type_id, st.name AS service_name,
              st.department_id, st.owner_id, w.statuses, w.transitions
       FROM request r
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [requestId]
    );
    if (!rows.length) throw new WorkflowError(404, 'Not found');
    const request = rows[0];

    // Optimistic concurrency (Phase 4): the caller states the status it acted
    // on; if the row moved under it, the second concurrent fire loses (409).
    // This is what makes must-pass #12/#13 deterministic on the generic path.
    if (expectedStatus != null && expectedStatus !== request.status) {
      throw new WorkflowError(409, 'The request has changed — reload and try again');
    }

    const { rows: taskRows } = await client.query(
      'SELECT id, employee_id FROM task WHERE request_id = $1',
      [request.id]
    );
    const task = taskRows[0] || null;

    const transition = override
      ? resolveOverride({
          statuses: request.statuses,
          currentStatus: request.status,
          user,
          to,
          note,
        })
      : resolveTransition({
          statuses: request.statuses,
          transitions: request.transitions,
          currentStatus: request.status,
          user,
          requestUserId: request.user_id,
          taskEmployeeId: task ? task.employee_id : null,
          transitionKey,
          note,
          formValidated,
        });

    // Gate 2 (subtree) for any oversight transition — an override or a
    // capability-gated transition (e.g. assign). It needs the DB, so it runs
    // here rather than in the pure resolver; out-of-subtree looks nonexistent
    // (404-over-403, Section 6).
    if (
      (override || transition.required_capability) &&
      !(await ownerInScope(user.id, request.owner_id, client))
    ) {
      throw new WorkflowError(404, 'Not found');
    }

    await client.query('UPDATE request SET status = $1, updated_at = now() WHERE id = $2', [
      transition.to,
      request.id,
    ]);
    if (task) {
      await client.query('UPDATE task SET status = $1 WHERE id = $2', [transition.to, task.id]);
    }
    await client.query(
      `INSERT INTO request_status_history (request_id, status, changed_by, note)
       VALUES ($1, $2, $3, $4)`,
      [request.id, transition.to, user.id, note || null]
    );

    // Notification triggers (Section 7 table). A transition that carries a
    // required form is the "completed" event (only completion transitions do);
    // everything else is the owner's generic status_changed.
    const newStatus = statusOf(request.statuses, transition.to);
    const ownerType = transition.required_form_key ? 'completed' : 'status_changed';
    await client.query(
      'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
      [
        request.user_id,
        request.id,
        ownerType,
        `Your request #${request.id} (${pick(request.service_name)}) is now “${pick(newStatus.label)}”.`,
      ]
    );
    if (transition.notify_oversight && request.owner_id) {
      // The rejection goes to the service's oversight owner (the queue's
      // escalation target), not a department-wide monitor list.
      await client.query(
        `INSERT INTO notification (user_id, request_id, type, message)
         VALUES ($1, $2, 'task_rejected', $3)`,
        [
          request.owner_id,
          request.id,
          `${user.name} rejected the task for request #${request.id} (${pick(request.service_name)}): ${note}`,
        ]
      );
    }

    let extra;
    if (beforeCommit) {
      extra = await beforeCommit(client, { request, task, transition, newStatus });
    }

    await client.query('COMMIT');
    return { request, task, transition, status: newStatus, extra };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  WorkflowError,
  isTerminal,
  statusOf,
  partyOf,
  validTransitions,
  resolveTransition,
  resolveOverride,
  executeTransition,
};
