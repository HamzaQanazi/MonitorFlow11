// Workflow engine (CLAUDE.md Sections 5 + 9): the ONE module that validates
// and executes every status transition. Nothing else may write REQUEST.status
// or TASK.status. No status key appears here — the engine reasons only in
// workflow data, categories, and transition actions.
//
// Order per Section 9.2, with the Section 6 404-over-403 rule folded in:
// lock REQUEST row → ownership (404) → transition exists (409) → role (403)
// → note / completion-form requirements (422 / 409) → write both statuses +
// history + notifications in the same transaction → commit.
const pool = require('../db');
const { ownerInScope } = require('./scope');
const { pick } = require('./i18nLabel');

// An oversight employee (level grants view_all) is the two-gate stand-in for
// the old `monitor` role: it owns nothing, sees everything, and acts as the
// workflow's `monitor` actor. Field employees hold no capabilities.
function isOversightActor(user) {
  return user.role === 'employee' && user.capabilities instanceof Set && user.capabilities.has('view_all');
}

class WorkflowError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function categoryOf(statuses, key) {
  const s = statuses.find((st) => st.key === key);
  return s ? s.category : null;
}

function statusOf(statuses, key) {
  const s = statuses.find((st) => st.key === key);
  return { key, label: s ? s.label : key, category: s ? s.category : null };
}

// Transitions available to `role` from the current status. Empty while the
// category is terminated (the task lock, Section 5) — final statuses have no
// outgoing transitions anyway, but the rule is explicit in the spec.
function validTransitions(statuses, transitions, currentStatus, role) {
  if (categoryOf(statuses, currentStatus) === 'terminated') return [];
  return transitions.filter((t) => t.from === currentStatus && t.allowed_role === role);
}

// Pure validation core — everything but the I/O, so the Section 13 unit
// cells (valid, invalid, wrong role, final, terminated-locked, note) run
// without a database. Returns the matched transition or throws.
function resolveTransition({
  statuses,
  transitions,
  currentStatus,
  user,
  requestUserId,
  taskEmployeeId, // null when no task exists
  to = null,
  action = null,
  note = null,
  completionValidated = false,
}) {
  // Ownership first: a non-owner must not learn whether a transition exists
  // (404-over-403, Section 6). An oversight employee owns nothing and sees
  // everything (like the old monitor); a field employee must own the task.
  const oversight = isOversightActor(user);
  if (user.role === 'user' && requestUserId !== user.id) {
    throw new WorkflowError(404, 'Not found');
  }
  if (user.role === 'employee' && !oversight && taskEmployeeId !== user.id) {
    throw new WorkflowError(404, 'Not found');
  }

  const t = transitions.find(
    (tr) => tr.from === currentStatus && (action ? tr.action === action : tr.to === to)
  );
  if (!t) {
    throw new WorkflowError(409, 'This transition is not valid from the current status');
  }
  // Actor-role match (role→capability shim, Phase 4 renames allowed_role):
  // requester ⇒ `user` transitions, oversight employee ⇒ `monitor`, field
  // employee ⇒ `employee`. Each account acts as exactly one workflow actor.
  const actsAs =
    user.role === 'user' ? 'user' : oversight ? 'monitor' : 'employee';
  if (t.allowed_role !== actsAs) throw new WorkflowError(403, 'Forbidden');
  if (t.requires_note && !(note && note.trim())) {
    throw new WorkflowError(422, 'A note is required for this transition');
  }
  if (t.requires_completion_form && !completionValidated) {
    throw new WorkflowError(409, 'This transition requires the completion form');
  }
  return t;
}

// Monitor override (Section 7 PATCH /requests/{id}/status): bypasses the
// transition table but never the constraint — the target must be a status
// key of this workflow with category `terminated` (reject/cancel) or
// `triage`/`in_progress` (reopen). Arbitrary jumps and unknown keys are 422
// (well-formed body failing validation, must-pass #18); a note is always
// required. Returns a synthetic transition so the write path is shared.
const OVERRIDE_TARGET_CATEGORIES = ['terminated', 'triage', 'in_progress'];

function resolveOverride({ statuses, currentStatus, user, to, note }) {
  // The override endpoint requires the `override` capability specifically
  // (Gate 1), not merely oversight — a lead without it cannot force statuses.
  if (!(user.capabilities instanceof Set && user.capabilities.has('override'))) {
    throw new WorkflowError(403, 'Forbidden');
  }
  const target = statuses.find((s) => s.key === to);
  if (!target) throw new WorkflowError(422, 'Target is not a status in this workflow');
  if (!OVERRIDE_TARGET_CATEGORIES.includes(target.category)) {
    throw new WorkflowError(422, 'An override may only reject, cancel, or reopen a request');
  }
  if (to === currentStatus) {
    throw new WorkflowError(409, 'The request is already in this status');
  }
  if (!(note && note.trim())) {
    throw new WorkflowError(422, 'A note is required for a monitor override');
  }
  return { from: currentStatus, to, allowed_role: 'monitor', action: null, requires_note: true };
}

// Executes one transition. `beforeCommit(client, ctx)` runs inside the same
// transaction after the status/history writes — assignment uses it to upsert
// the TASK row, /complete to store the completion form response. With
// `override: true` the transition table is bypassed via resolveOverride; the
// locking, writes, history, and notifications are identical.
async function executeTransition({
  requestId,
  user,
  to = null,
  action = null,
  note = null,
  completionValidated = false,
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

    // Gate 2 scoping: an oversight employee acting on a request whose service
    // owner is outside their subtree must not learn it exists (404-over-403),
    // same as the user/employee ownership checks in resolveTransition.
    if (isOversightActor(user) && !(await ownerInScope(user.id, request.owner_id, client))) {
      throw new WorkflowError(404, 'Not found');
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
          to,
          action,
          note,
          completionValidated,
        });

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

    // Notification triggers (Section 7 table). `completed` is the specific
    // form of the owner's status_changed for the complete action — one
    // notification per event, not two.
    const newStatus = statusOf(request.statuses, transition.to);
    const ownerType = transition.action === 'complete' ? 'completed' : 'status_changed';
    await client.query(
      'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
      [
        request.user_id,
        request.id,
        ownerType,
        `Your request #${request.id} (${pick(request.service_name)}) is now “${pick(newStatus.label)}”.`,
      ]
    );
    if (transition.action === 'reject' && request.owner_id) {
      // Two-gate model: the rejection goes to the service's oversight owner
      // (the queue's escalation target), not a department-wide monitor list.
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
  categoryOf,
  statusOf,
  validTransitions,
  resolveTransition,
  resolveOverride,
  executeTransition,
};
