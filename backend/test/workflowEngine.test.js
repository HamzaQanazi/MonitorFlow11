// Unit tests for the workflow transition validator (CLAUDE.md Section 13:
// valid, invalid, wrong role, final, terminated-locked) plus the note,
// completion-form, and ownership rules. Status keys below are test *data*,
// mirroring the shape of seeded workflow A — not keys known to the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveTransition, validTransitions, WorkflowError } = require('../src/lib/workflowEngine');

const statuses = [
  { key: 'submitted', label: 'Submitted', category: 'new', is_initial: true, is_final: false },
  { key: 'assigned', label: 'Assigned', category: 'triage', is_initial: false, is_final: false },
  { key: 'working', label: 'Working', category: 'in_progress', is_initial: false, is_final: false },
  { key: 'done', label: 'Done', category: 'done', is_initial: false, is_final: false },
  { key: 'closed', label: 'Closed', category: 'closed', is_initial: false, is_final: true },
  { key: 'cancelled', label: 'Cancelled', category: 'terminated', is_initial: false, is_final: true },
];

const transitions = [
  { from: 'submitted', to: 'assigned', allowed_role: 'monitor', action: null, requires_note: false, requires_completion_form: false },
  { from: 'submitted', to: 'cancelled', allowed_role: 'user', action: null, requires_note: true, requires_completion_form: false },
  { from: 'assigned', to: 'working', allowed_role: 'employee', action: 'accept', requires_note: false, requires_completion_form: false },
  { from: 'working', to: 'done', allowed_role: 'employee', action: 'complete', requires_note: false, requires_completion_form: true },
  { from: 'done', to: 'closed', allowed_role: 'user', action: 'confirm', requires_note: false, requires_completion_form: false },
];

const OWNER = { id: 1, role: 'user', name: 'Owner' };
const EMPLOYEE = { id: 2, role: 'employee', name: 'Emp' };
const MONITOR = { id: 3, role: 'monitor', name: 'Mon' };

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

test('valid transition by target resolves', () => {
  const t = resolveTransition({ ...base, currentStatus: 'submitted', user: MONITOR, to: 'assigned' });
  assert.equal(t.to, 'assigned');
});

test('valid transition by action resolves', () => {
  const t = resolveTransition({ ...base, currentStatus: 'assigned', user: EMPLOYEE, action: 'accept' });
  assert.equal(t.to, 'working');
});

test('invalid transition (not defined from current status) → 409', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'submitted', user: MONITOR, to: 'done' })
  );
});

test('wrong role on an existing transition → 403', () => {
  throwsWith(403, () =>
    resolveTransition({ ...base, currentStatus: 'submitted', user: OWNER, to: 'assigned' })
  );
});

test('final status has no way out → 409', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'closed', user: MONITOR, to: 'assigned' })
  );
});

test('terminated request locks the task: no transitions, accept → 409', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'cancelled', user: EMPLOYEE, action: 'accept' })
  );
});

test('requires_note without a note → 422; with note passes', () => {
  throwsWith(422, () =>
    resolveTransition({ ...base, currentStatus: 'submitted', user: OWNER, to: 'cancelled' })
  );
  const t = resolveTransition({
    ...base, currentStatus: 'submitted', user: OWNER, to: 'cancelled', note: 'changed my mind',
  });
  assert.equal(t.to, 'cancelled');
});

test('requires_completion_form outside /complete → 409; validated passes', () => {
  throwsWith(409, () =>
    resolveTransition({ ...base, currentStatus: 'working', user: EMPLOYEE, action: 'complete' })
  );
  const t = resolveTransition({
    ...base, currentStatus: 'working', user: EMPLOYEE, action: 'complete', completionValidated: true,
  });
  assert.equal(t.to, 'done');
});

test('non-owner user → 404 (before revealing whether the transition exists)', () => {
  throwsWith(404, () =>
    resolveTransition({
      ...base, currentStatus: 'submitted', user: { id: 99, role: 'user' }, to: 'cancelled',
    })
  );
});

test('employee not assigned to the task → 404', () => {
  throwsWith(404, () =>
    resolveTransition({
      ...base, currentStatus: 'assigned', user: { id: 99, role: 'employee' }, action: 'accept',
    })
  );
});

test('validTransitions filters by role and empties when terminated', () => {
  assert.deepEqual(
    validTransitions(statuses, transitions, 'submitted', 'monitor').map((t) => t.to),
    ['assigned']
  );
  assert.deepEqual(
    validTransitions(statuses, transitions, 'submitted', 'employee'),
    []
  );
  assert.deepEqual(validTransitions(statuses, transitions, 'cancelled', 'employee'), []);
});
