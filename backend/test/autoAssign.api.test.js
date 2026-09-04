// API suite for auto-assign (lib/autoAssign.js, CLAUDE.md §13 re-scope).
// Opt-in per service (service_type.auto_assign) — everything here runs
// against the shared fixture service ("Home Nursing Visit", owner = root,
// subtree = root/field1/field2), toggled on via PATCH /services/{id}/auto-assign,
// then off again so it can't leak into any other test in this file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures, formPayload } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('auto_assign_api');
  tokens = await loginAll();
});

after(() => stopServer());

const A_FIELD = [{ id: 'note', label: { en: 'Note', ar: 'ملاحظة' }, type: 'text', required: true }];
const CLOSED_WORKFLOW = {
  statuses: [
    { key: 'open', label: { en: 'Open', ar: 'مفتوح' }, is_initial: true, is_terminal: false },
    { key: 'closed', label: { en: 'Closed', ar: 'مغلق' }, is_initial: false, is_terminal: true },
  ],
  transitions: [
    {
      key: 'close', from: 'open', to: 'closed',
      label: { en: 'Close', ar: 'إغلاق' },
      required_capability: null, actor: 'requester', requires_note: false, notify: [],
    },
  ],
};

async function submitHomeNursing(token) {
  const form = await api('GET', `/services/${fixtures.serviceTypeId}/forms/request`, { token });
  assert.equal(form.status, 200);
  return api('POST', '/requests', {
    token,
    body: { serviceTypeId: fixtures.serviceTypeId, formResponse: formPayload(form.body.fields) },
  });
}

test('disabled by default: a fresh service submission stays unassigned', async () => {
  const res = await submitHomeNursing(tokens.resident);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.assignedTask, null);
  assert.equal(res.body.request.status.key, 'requested');
});

test('enabling auto_assign requires admin', async () => {
  const res = await api('PATCH', `/services/${fixtures.serviceTypeId}/auto-assign`, {
    token: tokens.root,
    body: { autoAssign: true },
  });
  assert.equal(res.status, 403);
});

test('enabled: picks the least-loaded active employee in the service owner subtree, load-balances across submissions', async () => {
  const toggle = await api('PATCH', `/services/${fixtures.serviceTypeId}/auto-assign`, {
    token: tokens.admin,
    body: { autoAssign: true },
  });
  assert.equal(toggle.status, 200);
  assert.equal(toggle.body.autoAssign, true);

  // owner = root, subtree = root/field1/field2 (buildFixtures). All start at
  // 0 open tasks — first pick is deterministic (lowest id) among the ties.
  const first = await submitHomeNursing(tokens.resident);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.ok(first.body.assignedTask, 'first submission should have been auto-assigned');
  assert.equal(first.body.request.status.key, 'scheduled'); // the "schedule" transition's `to`
  const firstAssignee = first.body.assignedTask.employeeId;
  assert.ok(
    [fixtures.employeeIds.root, fixtures.employeeIds.field1, fixtures.employeeIds.field2].includes(firstAssignee)
  );

  // Second submission: the first assignee now has one open task, so the
  // engine should pick a *different* employee — proves it's a real
  // load-balance, not "always employee #1".
  const second = await submitHomeNursing(tokens.resident);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.ok(second.body.assignedTask);
  assert.notEqual(second.body.assignedTask.employeeId, firstAssignee);

  // Reflected via the standard read path too, not just the create response.
  const detail = await api('GET', `/requests/${first.body.request.id}`, { token: tokens.root });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.request.task.employeeId, firstAssignee);

  // Cross-department safety: head2 (an employee in an unrelated department)
  // must never be picked — Gate 2 holds by construction (candidates come
  // only from the service's own department, service.departmentId).
  assert.notEqual(firstAssignee, fixtures.employeeIds.head2);
  assert.notEqual(second.body.assignedTask.employeeId, fixtures.employeeIds.head2);

  await api('PATCH', `/services/${fixtures.serviceTypeId}/auto-assign`, {
    token: tokens.admin,
    body: { autoAssign: false },
  });
});

test('enabled but no assign-capability transition on the workflow: stays unassigned, no error', async () => {
  const svc = await api('POST', '/services', {
    token: tokens.admin,
    body: {
      name: { en: 'No Assign Transition', ar: 'بدون انتقال إسناد' },
      departmentId: fixtures.departmentId,
      defaultPriority: 'low',
      acceptsExternalUsers: true,
      acceptsEmployeeSubmitters: false,
      autoAssign: true,
      featureKey: null,
      requestFields: A_FIELD,
      completionFields: A_FIELD,
      ...CLOSED_WORKFLOW,
    },
  });
  assert.equal(svc.status, 201, JSON.stringify(svc.body));

  const form = await api('GET', `/services/${svc.body.serviceTypeId}/forms/request`, { token: tokens.resident });
  assert.equal(form.status, 200);
  const res = await api('POST', '/requests', {
    token: tokens.resident,
    body: { serviceTypeId: svc.body.serviceTypeId, formResponse: formPayload(form.body.fields) },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.assignedTask, null);
});
