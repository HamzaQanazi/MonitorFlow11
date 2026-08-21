// API suite for /employees (CLAUDE.md §14 must-pass negatives): duplicate
// assign, deactivate-with-open-task, deactivated JWT rejected everywhere (not
// just login), hire past the plan's employee cap.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setup, stopServer, api, loginAll, fixtures, submitRequest, query,
} = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('employees_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('duplicate assign (same employee twice) → 409', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const first = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(first.status, 200);

  const again = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(again.status, 409);
});

test('deactivate an employee holding an open task → 409; reassign then deactivate succeeds', async () => {
  const req = await submitRequest(tokens.resident, fixtures.serviceTypeId);
  const assign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field2 },
  });
  assert.equal(assign.status, 200);

  const blocked = await api('PATCH', `/employees/${fixtures.employeeIds.field2}/deactivate`, {
    token: tokens.root,
  });
  assert.equal(blocked.status, 409);

  const reassign = await api('PATCH', `/requests/${req.id}/assign`, {
    token: tokens.root,
    body: { employeeId: fixtures.employeeIds.field1 },
  });
  assert.equal(reassign.status, 200);

  const ok = await api('PATCH', `/employees/${fixtures.employeeIds.field2}/deactivate`, {
    token: tokens.root,
  });
  assert.equal(ok.status, 200);
});

test('deactivated account: JWT rejected on the next call, not just at login', async () => {
  // head2 (a separate subtree's root) never holds a task in this suite.
  // root's own subtree doesn't include head2 (Gate 2) — use the Owner
  // (admin), who is company-wide.
  const deactivate = await api('PATCH', `/employees/${fixtures.employeeIds.head2}/deactivate`, {
    token: tokens.admin,
  });
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.body));

  // tokens.head2 was issued before deactivation — still a validly-signed JWT.
  const res = await api('GET', '/requests', { token: tokens.head2 });
  assert.equal(res.status, 401);
});

test('weeklyRestDay: invalid value rejected on create, valid value round-trips, and PATCH can change or clear it', async () => {
  const bad = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Rest', lastName: 'Bad', email: 'rest.bad@fixture.test',
      password: 'Password123!', weeklyRestDay: 7,
    },
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.weeklyRestDay);

  const created = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Rest', lastName: 'Good', email: 'rest.good@fixture.test',
      password: 'Password123!', weeklyRestDay: 5,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.employee.weeklyRestDay, 5);

  const changed = await api('PATCH', `/employees/${created.body.employee.id}`, {
    token: tokens.root,
    body: { weeklyRestDay: 0 },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.employee.weeklyRestDay, 0);

  const cleared = await api('PATCH', `/employees/${created.body.employee.id}`, {
    token: tokens.root,
    body: { weeklyRestDay: null },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.employee.weeklyRestDay, null);
});

test('hire past the plan employee cap → 409', async () => {
  const { rows: co } = await query('SELECT id FROM company LIMIT 1');
  const companyId = co[0].id;
  await query("UPDATE company SET plan = 'starter' WHERE id = $1", [companyId]);

  // starter's employeeCap is 10. Pad active employees up to exactly 10
  // directly (fast, and robust to how many earlier tests in this file
  // deactivated) — only the cap-triggering hire attempt below needs to go
  // through the real API.
  const { rows: countRows } = await query(
    "SELECT count(*)::int AS n FROM users WHERE role = 'employee' AND company_id = $1 AND is_active = TRUE",
    [companyId]
  );
  const toPad = Math.max(0, 10 - countRows[0].n);
  for (let i = 0; i < toPad; i++) {
    await query(
      `INSERT INTO users (name, email, password_hash, role, login_identifier, department_id, company_id, is_active)
       VALUES ($1, $2, 'x', 'employee', $2, $3, $4, TRUE)`,
      [`Pad ${i}`, `pad${i}@fixture.test`, fixtures.departmentId, companyId]
    );
  }

  const res = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'One', lastName: 'TooMany', email: 'onetoomany@fixture.test',
      password: 'Password123!', departmentId: fixtures.departmentId,
    },
  });
  assert.equal(res.status, 409);
});
