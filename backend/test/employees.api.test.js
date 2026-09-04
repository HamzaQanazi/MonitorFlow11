// API suite for /employees (CLAUDE.md §14 must-pass negatives): duplicate
// assign, deactivate-with-open-task, deactivated JWT rejected everywhere (not
// just login), hire past the plan's employee cap.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  setup, stopServer, api, login, loginAll, fixtures, submitRequest, query,
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

test('view_all_company: a level holding it reaches employees outside its own department', async () => {
  // Gate 2 is normally flat department scope (scope.js) — root's requests
  // elsewhere in this suite prove root can't reach head2's department.
  // view_all_company is the one capability that widens Gate 2 itself: a
  // level holding it gets the whole company as scope. Built explicitly here
  // (not via the shared Manager level, which deliberately excludes it —
  // testlib/harness.js) so this is a real, isolated proof, not an accidental
  // side effect of another level's grants. Looks up head2's department_id
  // directly rather than depending on head2 itself, since an earlier test in
  // this file deactivates head2.
  const { rows: dept } = await query('SELECT department_id FROM users WHERE id = $1', [fixtures.employeeIds.head2]);
  const otherDepartmentId = dept[0].department_id;

  const level = await api('POST', '/employee-levels', {
    token: tokens.admin,
    body: { name: { en: 'General Manager Test', ar: 'مدير عام (اختبار)' } },
  });
  assert.equal(level.status, 201, JSON.stringify(level.body));

  const granted = await api('PATCH', `/employee-levels/${level.body.level.id}`, {
    token: tokens.admin,
    body: { capabilities: ['manage_employees', 'view_all_company'] },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));

  const REQUIRED_EXTRAS = { phone: '0590000000', birthdate: '1995-01-01', gender: 'female', workerType: 'full_time' };
  const gm = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'General', lastName: 'Manager', email: 'general.manager@fixture.test',
      departmentId: fixtures.departmentId, levelId: level.body.level.id, ...REQUIRED_EXTRAS,
    },
  });
  assert.equal(gm.status, 201, JSON.stringify(gm.body));
  const gmToken = await login(gm.body.employee.loginIdentifier, gm.body.tempPassword);

  // A fresh stranger in the other department — self-contained, doesn't lean
  // on head2 (deactivated earlier in this file) still being reachable.
  const stranger = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'Other', lastName: 'Dept', email: 'other.dept@fixture.test',
      departmentId: otherDepartmentId, ...REQUIRED_EXTRAS,
    },
  });
  assert.equal(stranger.status, 201, JSON.stringify(stranger.body));

  // Without view_all_company: root's own department doesn't include the
  // stranger's — the pre-existing flat-scope rule, unchanged.
  const refused = await api('GET', `/employees/${stranger.body.employee.id}/tasks`, { token: tokens.root });
  assert.equal(refused.status, 404);

  // With it: the General Manager reaches across the whole company.
  const allowed = await api('GET', `/employees/${stranger.body.employee.id}/tasks`, { token: gmToken });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
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
