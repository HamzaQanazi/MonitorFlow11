// API-integration + permission suite for /requests (CLAUDE.md §14 must-pass
// negatives). Uses the v7 fixture harness (backend/testlib/harness.js): one
// service ("Home Nursing Visit") owned by WHO.root, statuses
// requested(initial) -> scheduled -> visited -> confirmed/cancelled(terminal),
// transitions schedule(cap:assign) / cancel(actor:requester,notes) /
// complete(actor:assignee,completion form) / confirm(actor:requester).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setup, stopServer, api, loginAll, WHO, fixtures, submitRequest, query,
} = require('../testlib/harness');

let tokens;
let internalOnlyServiceId;

before(async () => {
  await setup('requests_api');
  tokens = await loginAll();

  // Register a second external user for the "own resource of another user"
  // test — WHO only ships one resident.
  const reg = await api('POST', '/auth/register', {
    body: { name: 'Resident Two', email: 'resident2@fixture.test', password: 'Password123!' },
  });
  assert.equal(reg.status, 201);
  tokens.resident2 = reg.body.token;

  // A second, employee-only service (mirror shape, flipped accepts flags) for
  // the "user submit to internal-only service" negative.
  const svc = await api('POST', '/services', {
    token: tokens.admin,
    body: {
      name: { en: 'Internal Only', ar: 'داخلي فقط' },
      departmentId: fixtures.departmentId,
      defaultPriority: 'low',
      acceptsExternalUsers: false,
      acceptsEmployeeSubmitters: true,
      featureKey: null,
      requestFields: [{ id: 'note', label: { en: 'Note', ar: 'ملاحظة' }, type: 'text', required: true }],
      completionFields: [{ id: 'done_note', label: { en: 'Done', ar: 'تم' }, type: 'text', required: true }],
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
    },
  });
  assert.equal(svc.status, 201, JSON.stringify(svc.body));
  internalOnlyServiceId = svc.body.serviceTypeId;
});

after(() => stopServer());

test('own-resource of another user → 404', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const res = await api('GET', `/requests/${req.id}`, { token: tokens.resident2 });
  assert.equal(res.status, 404);
});

test('confirm before done (transition not valid from current status) → 409', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const res = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.resident,
    body: { transition_key: 'confirm' },
  });
  assert.equal(res.status, 409);
});

test('wrong-capability transition → 403', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  // field1 holds no capabilities; PATCH /assign is capability-gated at the
  // route (requireCapability('assign')) — a clean, guaranteed 403.
  const res = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.field1,
    body: { employeeId: fixtures.employeeIds.field2 },
  });
  assert.equal(res.status, 403);
});

test('cross-subtree assign → refused (422)', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  // root owns the service (sees the request) but head2 is a different
  // subtree's root — not an assignable employee from root's point of view.
  const res = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.head2 },
  });
  assert.equal(res.status, 422);
});

test('override to nonexistent status → 422', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const res = await api('PATCH', `/requests/${req.id}/status`, {
    token: tokens.root,
    body: { to: 'not_a_real_status', note: 'testing' },
  });
  assert.equal(res.status, 422);
});

test('user submit to an employee-only (internal) service → 403', async () => {
  const form = await api('GET', `/services/${internalOnlyServiceId}/forms/request`, { token: tokens.resident });
  assert.equal(form.status, 200);
  const res = await api('POST', '/requests', {
    token: tokens.resident,
    body: { serviceTypeId: internalOnlyServiceId, formResponse: { note: 'x' } },
  });
  assert.equal(res.status, 403);
});

test('concurrent transitions: stale expected_status → 409, exactly one wins', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200);

  const complete = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.field1,
    body: { transition_key: 'complete', form: { notes: 'All good' }, expected_status: 'scheduled' },
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));

  // Now at 'visited'. A confirm claiming the request is still 'scheduled' is
  // stale — the engine's optimistic-concurrency check must refuse it.
  const staleConfirm = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.resident,
    body: { transition_key: 'confirm', expected_status: 'scheduled' },
  });
  assert.equal(staleConfirm.status, 409);

  const freshConfirm = await api('POST', `/requests/${req.id}/transitions`, {
    token: tokens.resident,
    body: { transition_key: 'confirm', expected_status: 'visited' },
  });
  assert.equal(freshConfirm.status, 200);
});

test('cancel-vs-assign race: assign wins, requester cancel afterward → 409', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200);

  const cancel = await api('PATCH', `/requests/${req.id}/cancel`, { token: tokens.resident });
  assert.equal(cancel.status, 409);
});

// Dashboard's SLA-breach / reopen-rate tiles link to GET /requests with these
// two filters (requestQuery.js) — same definitions as GET /dashboard/stats'
// slaBreaches count and reopenRate.
test('GET /requests?slaBreached=true — only open requests past their sla_minutes', async () => {
  const fresh = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const stale = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  // "requested" carries sla_minutes: 240 (harness.js) — backdate past it.
  await query('UPDATE request SET updated_at = now() - INTERVAL \'5 hours\' WHERE id = $1', [stale.id]);

  const res = await api('GET', '/requests?slaBreached=true', { token: tokens.root });
  assert.equal(res.status, 200);
  const ids = res.body.requests.map((r) => r.id);
  assert.ok(ids.includes(stale.id));
  assert.ok(!ids.includes(fresh.id));
});

test('GET /requests?reopened=true — only requests that went terminal back to non-terminal', async () => {
  // The workflow schema forbids authoring a transition out of a terminal
  // status (workflowSchema.js) — the only way a request actually moves
  // terminal → non-terminal is the oversight override endpoint (§7's
  // "reopening past a terminal status" comment on PATCH /:id/status).
  const reopened = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const stillOpen = await submitRequest(tokens.resident, fixtures.serviceTypeId);

  const cancel = await api('PATCH', `/requests/${reopened.id}/cancel`, {
    token: tokens.resident,
    body: { note: 'changed my mind' },
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

  // 'requested' is the initial status — override refuses a target that's
  // initial, so reopen onto 'scheduled' instead.
  const override = await api('PATCH', `/requests/${reopened.id}/status`, {
    token: tokens.root,
    body: { to: 'scheduled', note: 'reopening after all' },
  });
  assert.equal(override.status, 200, JSON.stringify(override.body));

  const res = await api('GET', '/requests?reopened=true', { token: tokens.root });
  assert.equal(res.status, 200);
  const ids = res.body.requests.map((r) => r.id);
  assert.ok(ids.includes(reopened.id));
  assert.ok(!ids.includes(stillOpen.id));
});

// Internal employee chat (POST/GET /requests/{id}/comments/internal): a
// request's current assignees + its department's oversight employees only,
// never the requester. One test per §14-style allowed/denied combination.
test('internal chat: requester → 404, always', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const post = await api('POST', `/requests/${req.id}/comments/internal`, {
    token: tokens.resident,
    body: { body: 'hello?' },
  });
  assert.equal(post.status, 404);
  const get = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.resident });
  assert.equal(get.status, 404);
});

test('internal chat: a non-assigned, non-oversight employee → 404', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  // field2 is neither assigned nor oversight — must not reach the thread.
  const res = await api('POST', `/requests/${req.id}/comments/internal`, {
    token: tokens.field2,
    body: { body: 'let me in' },
  });
  assert.equal(res.status, 404);
});

test('internal chat: oversight out of department scope → 404', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  // head2 holds oversight capabilities but is scoped to otherDepartmentId —
  // the service lives in fixtures.departmentId.
  const res = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.head2 });
  assert.equal(res.status, 404);
});

test('internal chat: a current assignee and in-scope oversight can post and read; the customer thread and the internal thread never mix', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200);

  const fromAssignee = await api('POST', `/requests/${req.id}/comments/internal`, {
    token: tokens.field1,
    body: { body: 'starting the visit now' },
  });
  assert.equal(fromAssignee.status, 201, JSON.stringify(fromAssignee.body));

  const fromOversight = await api('POST', `/requests/${req.id}/comments/internal`, {
    token: tokens.root,
    body: { body: 'thanks, ping me if anything comes up' },
  });
  assert.equal(fromOversight.status, 201);

  const asAssignee = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.field1 });
  assert.equal(asAssignee.status, 200);
  assert.equal(asAssignee.body.comments.length, 2);

  const asOversight = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.root });
  assert.equal(asOversight.status, 200);
  assert.equal(asOversight.body.comments.length, 2);

  // A customer-facing comment must never appear in the internal thread, and
  // vice versa — the two are separated by the visibility column, not by
  // caller-side filtering.
  const customerComment = await api('POST', `/requests/${req.id}/comments`, {
    token: tokens.resident,
    body: { body: 'any update?' },
  });
  assert.equal(customerComment.status, 201);

  const internalAfter = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.root });
  assert.equal(internalAfter.body.comments.length, 2);
  assert.ok(!internalAfter.body.comments.some((c) => c.body === 'any update?'));

  const detail = await api('GET', `/requests/${req.id}`, { token: tokens.root });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.request.comments.length, 1);
  assert.ok(!detail.body.request.comments.some((c) => c.body === 'starting the visit now'));
});

test('internal chat: removing an assignee revokes access immediately', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  const before = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.field1 });
  assert.equal(before.status, 200);

  const remove = await api('DELETE', `/requests/${req.id}/assign/${fixtures.employeeIds.field1}`, {
    token: tokens.root,
  });
  assert.equal(remove.status, 204, JSON.stringify(remove.body));

  const after = await api('GET', `/requests/${req.id}/comments/internal`, { token: tokens.field1 });
  assert.equal(after.status, 404);
});
