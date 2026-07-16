// Unit tests for the workflow transition validator (CLAUDE.md Section 13:
// valid, invalid, wrong party, terminal-locked) plus the note, required-form,
// and ownership rules — Phase 4 model (§10). Status/transition keys below are
// test *data*, mirroring the shape of seeded workflow A — not keys known to
// the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveTransition,
  resolveOverride,
  validTransitions,
  WorkflowError,
} = require('../src/lib/workflowEngine');
const { CAPABILITIES } = require('../src/lib/capabilities');

const statuses = [
  { key: 'submitted', label: 'Submitted', is_initial: true, is_terminal: false },
  { key: 'assigned', label: 'Assigned', is_initial: false, is_terminal: false },
  { key: 'working', label: 'Working', is_initial: false, is_terminal: false },
  { key: 'done', label: 'Done', is_initial: false, is_terminal: false },
  { key: 'closed', label: 'Closed', is_initial: false, is_terminal: true },
  { key: 'cancelled', label: 'Cancelled', is_initial: false, is_terminal: true },
];

// Phase 4: transitions are keyed and gated by exactly one of required_capability
// (oversight) or actor (requester/assignee). required_form_key replaces
// requires_completion_form; there is no `action`.
const transitions = [
  { key: 'assign', from: 'submitted', to: 'assigned', required_capability: 'assign', actor: null, required_form_key: null, requires_note: false },
  { key: 'cancel', from: 'submitted', to: 'cancelled', required_capability: null, actor: 'requester', required_form_key: null, requires_note: true },
  { key: 'accept', from: 'assigned', to: 'working', required_capability: null, actor: 'assignee', required_form_key: null, requires_note: false },
  { key: 'complete', from: 'working', to: 'done', required_capability: null, actor: 'assignee', required_form_key: 'completion', requires_note: false },
  { key: 'confirm', from: 'done', to: 'closed', required_capability: null, actor: 'requester', required_form_key: null, requires_note: false },
];

// Two-gate model: the oversight actor is an employee whose level grants the
// capabilities (view_all + override + assign); the field employee holds none.
const OWNER = { id: 1, role: 'user', name: 'Owner' };
const EMPLOYEE = { id: 2, role: 'employee', name: 'Emp', capabilities: new Set() };
const MONITOR = { id: 3, role: 'employee', name: 'Mon', capabilities: new Set(CAPABILITIES) };

const base = { statuses, transitions, requestUserId: OWNER.id, taskEmployeeId: EMPLOYEE.id };

const throwsWith = (status, fn) => {
  try {
    fn();
    assert.fail('expected WorkflowError');
  } catch (err) {
    assert.ok(err instanceof WorkflowError, `expected WorkflowError, got ${err}`);
    assert.equal(err.status, status);
  }
};

test('capability transition (assign) resolves for an oversight actor', () => {
  const t = resolveTransition({ ...base, currentStatus: 'submitted', user: MONITOR, transitionKey: 'assign' });
  assert.equal(t.to, 'assigned');
});

test('actor transition (accept) resolves for the assignee', () => {
  const t = resolveTransition({ ...base, currentStatus: 'assigned', user: EMPLOYEE, transitionKey: 'accept' });
  assert.equal(t.to, 'working');
});

test('transition key not defined from current status → 409', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'submitted', user: MONITOR, transitionKey: 'confirm' })
  );
});

test('wrong party on an existing transition → 403', () => {
  // The requester firing the assignee's accept transition.
  throwsWith(403, () =>
    resolveTransition({ ...base, currentStatus: 'assigned', user: OWNER, transitionKey: 'accept' })
  );
});

test('capability transition without the capability → 403', () => {
  // A field employee (no caps) firing the assign transition.
  throwsWith(403, () =>
    resolveTransition({ ...base, currentStatus: 'submitted', user: EMPLOYEE, transitionKey: 'assign' })
  );
});

test('terminal request locks the task: no transition out, accept → 409', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'cancelled', user: EMPLOYEE, transitionKey: 'accept' })
  );
});

test('requires_note without a note → 422; with note passes', () => {
  const unassigned = { ...base, taskEmployeeId: null };
  throwsWith(422, () =>
    resolveTransition({ ...unassigned, currentStatus: 'submitted', user: OWNER, transitionKey: 'cancel' })
  );
  const t = resolveTransition({
    ...unassigned, currentStatus: 'submitted', user: OWNER, transitionKey: 'cancel', note: 'changed my mind',
  });
  assert.equal(t.to, 'cancelled');
});

test('requester cancel with a task present → 409 (Section 6: only while unassigned)', () => {
  // base carries taskEmployeeId — the request has been assigned (e.g. the
  // task row retained after an assignee reject back to the initial status).
  throwsWith(409, () =>
    resolveTransition({
      ...base, currentStatus: 'submitted', user: OWNER, transitionKey: 'cancel', note: 'too late',
    })
  );
  // Confirm is also requester→terminal but fires later in the flow — it must
  // work with the task present.
  const t = resolveTransition({
    ...base, currentStatus: 'done', user: OWNER, transitionKey: 'confirm',
  });
  assert.equal(t.to, 'closed');
});

test('required_form_key without a validated form → 409; validated passes', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'working', user: EMPLOYEE, transitionKey: 'complete' })
  );
  const t = resolveTransition({
    ...base, currentStatus: 'working', user: EMPLOYEE, transitionKey: 'complete', formValidated: true,
  });
  assert.equal(t.to, 'done');
});

test('non-owner user → 404 (before revealing whether the transition exists)', () => {
  throwsWith(404, () =>
    resolveTransition({
      ...base, currentStatus: 'submitted', user: { id: 99, role: 'user' }, transitionKey: 'cancel',
    })
  );
});

test('employee not assigned to the task → 404', () => {
  throwsWith(404, () =>
    resolveTransition({
      ...base,
      currentStatus: 'assigned',
      user: { id: 99, role: 'employee', capabilities: new Set() },
      transitionKey: 'accept',
    })
  );
});

test('override: cancel and reopen resolve; task-lock release follows is_terminal', () => {
  const cancel = resolveOverride({
    statuses, currentStatus: 'working', user: MONITOR, to: 'cancelled', note: 'duplicate request',
  });
  assert.equal(cancel.to, 'cancelled');
  // Reopen: from a terminal status back to a working one. Once the current
  // status is no longer terminal the task lock disappears with it.
  const reopen = resolveOverride({
    statuses, currentStatus: 'cancelled', user: MONITOR, to: 'working', note: 'cancelled in error',
  });
  assert.equal(reopen.to, 'working');
  assert.deepEqual(
    validTransitions(statuses, transitions, reopen.to, 'assignee').map((t) => t.key),
    ['complete']
  );
});

test('override to a key not in the workflow → 422 (must-pass #18)', () => {
  throwsWith(422, () =>
    resolveOverride({ statuses, currentStatus: 'working', user: MONITOR, to: 'nonexistent', note: 'x' })
  );
});

test('override to the initial status → 422 (§10 loosened: any other non-current status is allowed)', () => {
  throwsWith(422, () =>
    resolveOverride({ statuses, currentStatus: 'working', user: MONITOR, to: 'submitted', note: 'x' })
  );
  // done/closed are now valid override targets (non-initial, non-current).
  assert.equal(
    resolveOverride({ statuses, currentStatus: 'working', user: MONITOR, to: 'done', note: 'x' }).to,
    'done'
  );
});

test('override without a note → 422; same status → 409; without the capability → 403', () => {
  throwsWith(422, () =>
    resolveOverride({ statuses, currentStatus: 'working', user: MONITOR, to: 'cancelled', note: '  ' })
  );
  throwsWith(409, () =>
    resolveOverride({ statuses, currentStatus: 'cancelled', user: MONITOR, to: 'cancelled', note: 'x' })
  );
  throwsWith(403, () =>
    resolveOverride({ statuses, currentStatus: 'working', user: EMPLOYEE, to: 'cancelled', note: 'x' })
  );
});

test('workflowSchema rejects bad notify targets and bad sla_minutes (Phase 5)', () => {
  const { validateWorkflowDefinition } = require('../src/lib/workflowSchema');
  const L = { en: 'x', ar: 'س' };
  const errors = validateWorkflowDefinition({
    statuses: [
      { key: 'a', label: L, is_initial: true, is_terminal: false, sla_minutes: -5 },
      { key: 'z', label: L, is_initial: false, is_terminal: true },
    ],
    transitions: [
      { key: 't', from: 'a', to: 'z', required_capability: null, actor: 'requester',
        required_form_key: null, requires_note: false, label: L, notify: ['created_by', 'the_ceo'] },
    ],
  });
  assert.ok(errors.some((e) => e.includes('sla_minutes')));
  assert.ok(errors.some((e) => e.includes('notify target "the_ceo"')));
  // Valid shape passes both new rules.
  const ok = validateWorkflowDefinition({
    statuses: [
      { key: 'a', label: L, is_initial: true, is_terminal: false, sla_minutes: 240 },
      { key: 'z', label: L, is_initial: false, is_terminal: true },
    ],
    transitions: [
      { key: 't', from: 'a', to: 'z', required_capability: null, actor: 'requester',
        required_form_key: null, requires_note: false, label: L, notify: ['assignee_manager'] },
    ],
  });
  assert.deepEqual(ok, []);
});

test('validTransitions filters by actor and empties when terminal', () => {
  assert.deepEqual(
    validTransitions(statuses, transitions, 'submitted', 'requester').map((t) => t.to),
    ['cancelled']
  );
  assert.deepEqual(validTransitions(statuses, transitions, 'submitted', 'assignee'), []);
  assert.deepEqual(validTransitions(statuses, transitions, 'cancelled', 'assignee'), []);
});
