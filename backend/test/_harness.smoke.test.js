// Smoke test for the rebuilt v7 fixture harness (backend/testlib/harness.js).
// Proves setup() actually produces a working org + service before any suite
// is built on top of it — not a §14 negative-list test itself.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, loginAll, WHO, fixtures, submitRequest, api } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('harness_smoke');
  tokens = await loginAll();
});

after(() => stopServer());

test('every WHO role logs in', () => {
  for (const role of Object.keys(WHO)) {
    assert.ok(tokens[role], `expected a token for ${role}`);
  }
});

test('fixture service + org are usable end to end', async () => {
  assert.ok(fixtures.serviceTypeId, 'fixture service was created');

  const request = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  assert.equal(request.status.key, 'requested');

  const assign = await api('PATCH', `/requests/${request.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(assign.status, 200, `assign: ${assign.status} ${JSON.stringify(assign.body)}`);

  const forbidden = await api('GET', '/services');
  assert.equal(forbidden.status, 401);

  const scoped = await api('GET', `/requests/${request.id}`, { token: tokens.head2 });
  assert.equal(scoped.status, 404, 'a separate subtree must not reach this request');
});
