// API suite for /auth (CLAUDE.md §14): deactivated account rejected at both
// login and JWT validation, login rate limiting.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, login, loginAll, WHO, fixtures } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('auth_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('a deactivated employee cannot sign in', async () => {
  const deactivate = await api('PATCH', `/employees/${fixtures.employeeIds.field2}/deactivate`, {
    token: tokens.root,
  });
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.body));

  const res = await api('POST', '/auth/login', {
    body: { identifier: WHO.field2, password: 'Password123!' },
  });
  assert.equal(res.status, 401);
});

test('deactivated account: an already-issued JWT is rejected on the next call', async () => {
  const staleToken = await login(WHO.field1);
  const deactivate = await api('PATCH', `/employees/${fixtures.employeeIds.field1}/deactivate`, {
    token: tokens.root,
  });
  assert.equal(deactivate.status, 200);

  const res = await api('GET', '/requests', { token: staleToken });
  assert.equal(res.status, 401);
});

test('login rate limit: 6th rapid failure → 429', async () => {
  const identifier = WHO.head2;
  let last;
  for (let i = 0; i < 6; i++) {
    last = await api('POST', '/auth/login', { body: { identifier, password: 'wrong-password' } });
  }
  assert.equal(last.status, 429);
});
