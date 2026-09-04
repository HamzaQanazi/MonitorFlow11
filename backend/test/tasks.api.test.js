// API suite for /tasks (CLAUDE.md §5 "Employee limited task view" + §14
// "task action under a terminal request → 409"). Tasks is read-only —
// employee actions fire through POST /requests/{id}/transitions as the
// assignee party; this file proves that surface locks once the request is
// terminal, and that GET /tasks/{id} strips what §5 says it must.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setup, stopServer, api, loginAll, fixtures, submitRequest,
} = require('../testlib/harness');

let tokens;
let hiddenFieldServiceId;

before(async () => {
  await setup('tasks_api');
  tokens = await loginAll();

  // A service with one visible_to_employee:false field, to prove GET
  // /tasks/{id} strips it (§5's "only field-filtering mechanism").
  const svc = await api('POST', '/services', {
    token: tokens.admin,
    body: {
      name: { en: 'Sensitive Intake', ar: 'استقبال حساس' },
      departmentId: fixtures.departmentId,
      defaultPriority: 'low',
      acceptsExternalUsers: true,
      acceptsEmployeeSubmitters: false,
      featureKey: null,
      requestFields: [
        { id: 'summary', label: { en: 'Summary', ar: 'ملخص' }, type: 'text', required: true },
        {
          id: 'private_note', label: { en: 'Private Note', ar: 'ملاحظة خاصة' }, type: 'text',
          required: true, visible_to_employee: false,
        },
      ],
      completionFields: [{ id: 'result', label: { en: 'Result', ar: 'النتيجة' }, type: 'text', required: true }],
      statuses: [
        { key: 'new', label: { en: 'New', ar: 'جديد' }, is_initial: true, is_terminal: false, sla_minutes: 60 },
        { key: 'done', label: { en: 'Done', ar: 'منتهي' }, is_initial: false, is_terminal: true },
      ],
      transitions: [
        {
          key: 'assign_transition', from: 'new', to: 'done',
          label: { en: 'Assign', ar: 'إسناد' },
          required_capability: 'assign', actor: null, requires_note: false, notify: [],
        },
      ],
    },
  });
  assert.equal(svc.status, 201, JSON.stringify(svc.body));
  hiddenFieldServiceId = svc.body.serviceTypeId;
});

after(() => stopServer());

test('task action under a terminal request → 409', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200);

  const complete = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.field1,
    body: { transition_key: 'complete', form: { notes: 'done' } },
  });
  assert.equal(complete.status, 200);
  const confirm = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.resident,
    body: { transition_key: 'confirm' },
  });
  assert.equal(confirm.status, 200);

  // Request is now terminal ('confirmed') — any further assignee action 409s.
  const again = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.field1,
    body: { transition_key: 'complete', form: { notes: 'too late' } },
  });
  assert.equal(again.status, 409);
});

test('GET /tasks/{id}: no requester email, visible_to_employee:false field stripped', async () => {
  const form = await api('GET', `/services/${hiddenFieldServiceId}/forms/request`, { token: tokens.resident });
  assert.equal(form.status, 200);
  const submitRes = await api('POST', '/requests', {
    token: tokens.resident,
    body: {
      serviceTypeId: hiddenFieldServiceId,
      formResponse: { summary: 'Ordinary text', private_note: 'Should never reach the employee' },
    },
  });
  assert.equal(submitRes.status, 201);
  const requestId = submitRes.body.request.id;

  const assign = await api('PATCH', `/requests/${requestId}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field2 },
  });
  assert.equal(assign.status, 200, JSON.stringify(assign.body));
  const taskId = assign.body.task.id;

  const task = await api('GET', `/tasks/${taskId}`, { token: tokens.field2 });
  assert.equal(task.status, 200);
  assert.equal(task.body.task.request.requester.email, undefined);
  assert.equal(task.body.task.request.formResponse.summary, 'Ordinary text');
  assert.equal(task.body.task.request.formResponse.private_note, undefined);
});

test('a task belonging to another employee → 404', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200);
  const taskId = assign.body.task.id;

  const res = await api('GET', `/tasks/${taskId}`, { token: tokens.field2 });
  assert.equal(res.status, 404);
});
