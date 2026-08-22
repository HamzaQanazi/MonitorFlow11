// API suite for the audit read surface. The action filter's options used to be
// hardcoded in the client and had drifted from what the writers actually
// produce; they come from the log now, so the contract is worth pinning.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('audit_events_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('the action filter options come from the log, not a hardcoded list', async () => {
  // Any admin action writes an audit row; hiring one employee is enough.
  const hire = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'Audit', lastName: 'Subject', email: 'audit.subject@example.com',
      phone: '0599123456', birthdate: '1992-02-02', gender: 'female', workerType: 'full_time',
      departmentId: fixtures.departmentId,
    },
  });
  assert.equal(hire.status, 201, JSON.stringify(hire.body));

  const res = await api('GET', '/audit-events', { token: tokens.admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Array.isArray(res.body.actions), 'actions must be returned');
  assert.ok(res.body.actions.includes('employee.created'), JSON.stringify(res.body.actions));
  // Derived, so it can only ever contain actions that really occurred.
  const seen = new Set(res.body.events.map((e) => e.action));
  for (const a of res.body.actions) {
    if (res.body.total <= res.body.events.length) assert.ok(seen.has(a), `${a} not in the log`);
  }
});

test('filtering by an action returns only that action', async () => {
  const res = await api('GET', '/audit-events?action=employee.created', { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.ok(res.body.events.length > 0);
  assert.ok(res.body.events.every((e) => e.action === 'employee.created'));
});

test('the audit log is admin-only', async () => {
  assert.equal((await api('GET', '/audit-events', { token: tokens.root })).status, 403);
});

test('a malformed date filter is refused', async () => {
  assert.equal((await api('GET', '/audit-events?dateFrom=not-a-date', { token: tokens.admin })).status, 400);
});

test('a date range still returns rows with the company-timezone boundaries', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const res = await api('GET', `/audit-events?dateFrom=${today}&dateTo=${today}`, { token: tokens.admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.events.length > 0, 'todays hire should fall inside todays range');
});
