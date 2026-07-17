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
const { fireWebhook } = require('./webhooks');
const { logAudit } = require('./audit');

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
    notify: ['created_by'],
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
  // Operational audit (§6 re-scope): a request.* audit_event row written in the
  // SAME transaction as the status change (I9). The caller may override the
  // action/detail — the /assign path logs `request.assigned` with the assignee.
  auditAction = 'request.status_changed',
  auditDetail = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the request row before any validation (Section 5 locking rule).
    const { rows } = await client.query(
      `SELECT r.id, r.user_id, r.status, r.service_type_id, st.name AS service_name,
              st.key AS service_key, st.department_id, st.owner_id, w.statuses, w.transitions
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

    // Operational audit row, same transaction (I9). `request.status` here is
    // still the pre-transition value (the JS var, not re-read after the UPDATE).
    await logAudit(client, user.id, auditAction, 'request', request.id,
      auditDetail || { from: request.status, to: transition.to, transition: transition.key });

    const newStatus = statusOf(request.statuses, transition.to);

    let extra;
    if (beforeCommit) {
      extra = await beforeCommit(client, { request, task, transition, newStatus });
    }

    // Notification triggers (Section 7 table), Phase 5 model: targets are
    // RELATIONSHIPS resolved at fire time — created_by / assigned_to /
    // assignee_manager — never user ids or roles. Runs after beforeCommit so
    // `assigned_to` sees the task row /assign just wrote. Messages are
    // bilingual {en, ar} (deferred here by Phase 3).
    const svc = (l) => pick(request.service_name, l);
    for (const target of transition.notify || []) {
      let row = null; // [user_id, type, {en, ar}]
      if (target === 'created_by') {
        row = [
          request.user_id,
          // A transition carrying a required form is the "completed" event
          // (only completion transitions do); the rest are status_changed.
          transition.required_form_key ? 'completed' : 'status_changed',
          {
            en: `Your request #${request.id} (${svc('en')}) is now “${pick(newStatus.label, 'en')}”.`,
            ar: `طلبك رقم ${request.id} (${svc('ar')}) أصبح الآن «${pick(newStatus.label, 'ar')}».`,
          },
        ];
      } else {
        // assigned_to / assignee_manager both hang off the task's current
        // assignee — re-read, the row may have been written in beforeCommit.
        const { rows: a } = await client.query(
          `SELECT t.employee_id, u.manager_id FROM task t
           JOIN users u ON u.id = t.employee_id
           WHERE t.request_id = $1`,
          [request.id]
        );
        if (!a.length) continue;
        if (target === 'assigned_to') {
          row = [
            a[0].employee_id,
            'assigned',
            {
              en: `You have been assigned request #${request.id} (${svc('en')}).`,
              ar: `تم إسنادك إلى الطلب رقم ${request.id} (${svc('ar')}).`,
            },
          ];
        } else {
          // assignee_manager: one step up the tree (§10 gate); a manager-less
          // assignee falls back to the service owner so the alert never drops.
          // ponytail: the one seeded use is the reject transition, so the type
          // and wording say "rejected" — generalize both when a workflow
          // notifies managers on other transitions.
          const to = a[0].manager_id || request.owner_id;
          if (!to) continue;
          row = [
            to,
            'task_rejected',
            {
              en: `${user.name} rejected the task for request #${request.id} (${svc('en')}): ${note}`,
              ar: `رفض ${user.name} المهمة الخاصة بالطلب رقم ${request.id} (${svc('ar')}): ${note}`,
            },
          ];
        }
      }
      await client.query(
        'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
        [row[0], request.id, row[1], JSON.stringify(row[2])]
      );
    }

    await client.query('COMMIT');

    // Phase 7: outbound webhooks fire AFTER commit — a subscriber being down
    // must never roll back the transition. Fire-and-forget (fireWebhook never
    // throws). `assigned` is data-driven off the transition's notify targets
    // (the assign transition notifies assigned_to), so no status/transition key
    // is hardcoded here.
    const hook = { request_id: request.id, service_key: request.service_key, status: transition.to };
    fireWebhook('status_changed', hook);
    if ((transition.notify || []).includes('assigned_to')) fireWebhook('assigned', hook);

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
