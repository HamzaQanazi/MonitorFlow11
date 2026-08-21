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
  const REQUIRED_EXTRAS = { phone: '0590000000', birthdate: '1995-01-01', gender: 'female', workerType: 'full_time' };
  const bad = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Rest', lastName: 'Bad', email: 'rest.bad@fixture.test',
      ...REQUIRED_EXTRAS, weeklyRestDay: 7,
    },
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.weeklyRestDay);

  const created = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Rest', lastName: 'Good', email: 'rest.good@fixture.test',
      ...REQUIRED_EXTRAS, weeklyRestDay: 5,
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

test('phone/birthdate/gender/workerType are required; the server always generates the password', async () => {
  const missing = await api('POST', '/employees', {
    token: tokens.root,
    body: { firstName: 'Missing', lastName: 'Fields', email: 'missing.fields@fixture.test' },
  });
  assert.equal(missing.status, 422);
  for (const field of ['phone', 'birthdate', 'gender', 'workerType']) {
    assert.ok(missing.body.errors[field], `expected a ${field} error`);
  }
  // No password/email errors here — the client never supplies a password,
  // and email/firstName/lastName ARE present and valid in this body.
  assert.equal(missing.body.errors.password, undefined);

  const res = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Full', lastName: 'Fields', email: 'full.fields@fixture.test',
      phone: '0590000001', birthdate: '1990-05-01', gender: 'male', workerType: 'part_time',
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(typeof res.body.tempPassword, 'string');
  assert.ok(res.body.tempPassword.length >= 8);
  // The generated password actually works to log in.
  const login = await api('POST', '/auth/login', {
    body: { identifier: res.body.employee.loginIdentifier, password: res.body.tempPassword },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
});

test('PATCH can change birthdate/gender/workerType to another valid value, but not clear them', async () => {
  const created = await api('POST', '/employees', {
    token: tokens.root,
    body: {
      firstName: 'Edit', lastName: 'Me', email: 'edit.me@fixture.test',
      phone: '0590000002', birthdate: '1988-02-02', gender: 'male', workerType: 'contractor',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.employee.id;

  const changed = await api('PATCH', `/employees/${id}`, {
    token: tokens.root,
    body: { birthdate: '1999-09-09', gender: 'female', workerType: 'full_time', phone: '0590000003' },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  // Compare against the stored value directly (::text) rather than the JSON
  // response's date string — a DATE column round-tripped through JS Date/
  // JSON.stringify can shift a day depending on the server's local timezone,
  // a serialization quirk unrelated to what's actually correct in storage.
  const { rows: stored } = await query('SELECT birthdate::text AS birthdate FROM users WHERE id = $1', [id]);
  assert.equal(stored[0].birthdate, '1999-09-09');
  assert.equal(changed.body.employee.gender, 'female');
  assert.equal(changed.body.employee.workerType, 'full_time');
  assert.equal(changed.body.employee.phone, '0590000003');

  const cleared = await api('PATCH', `/employees/${id}`, {
    token: tokens.root,
    body: { gender: null },
  });
  assert.equal(cleared.status, 422);
  assert.ok(cleared.body.errors.gender);
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

// PATCH /employees/{id} managerId (2026-08-21 addition — previously an
// employee's manager could only change via a whole-department head
// reassignment). Same cycle risk/guard as departmentHead.js.
// field2 and head2 both get deactivated by earlier tests in this file
// (reassign-then-deactivate, and the deactivated-JWT test), and the plan-cap
// test right above pads the company to its Starter-plan limit so a fresh
// hire 409s — reactivating one directly sidesteps both without depending on
// run order or the seat cap.
test('admin can move an employee under a new manager', async () => {
  await query('UPDATE users SET is_active = TRUE WHERE id = $1', [fixtures.employeeIds.field2]);
  const res = await api('PATCH', `/employees/${fixtures.employeeIds.field1}`, {
    token: tokens.admin,
    body: { managerId: fixtures.employeeIds.field2 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.employee.managerId, fixtures.employeeIds.field2);
});

test('managerId is admin-only — a non-admin manage_employees holder cannot change it', async () => {
  await query('UPDATE users SET is_active = TRUE WHERE id = $1', [fixtures.employeeIds.head2]);
  const res = await api('PATCH', `/employees/${fixtures.employeeIds.field1}`, {
    token: tokens.root,
    body: { managerId: fixtures.employeeIds.head2 },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Silently ignored, same as levelId for a non-admin caller — stays
  // whatever the previous test just set (field2), not this new target.
  assert.equal(res.body.employee.managerId, fixtures.employeeIds.field2);
});

test('PATCH managerId rejects a reassignment that would create a cycle', async () => {
  // root manages field1 and field2 (harness fixture). Making root report to
  // their own report (field1) would be a direct cycle.
  const res = await api('PATCH', `/employees/${fixtures.employeeIds.root}`, {
    token: tokens.admin,
    body: { managerId: fixtures.employeeIds.field1 },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.errors.managerId, /cycle/i);
});

test('PATCH managerId: null makes the employee a tree root', async () => {
  const res = await api('PATCH', `/employees/${fixtures.employeeIds.field1}`, {
    token: tokens.admin,
    body: { managerId: null },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.employee.managerId, null);
});
