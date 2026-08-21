// Cycle-guard regression for POST /departments and PATCH /:id/head
// (2026-08-21 incident — a live manager_id cycle in real data OOM-crashed
// the server; lib/scope.js's cycle guard is the defensive backstop,
// lib/departmentHead.js + routes/departments.js are the fix at the source).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures, query } = require('../testlib/harness');

const REQUIRED_EXTRAS = { phone: '0590000000', birthdate: '1995-01-01', gender: 'female', workerType: 'full_time' };

let tokens;
let branchId;

before(async () => {
  await setup('departments_api');
  tokens = await loginAll();
  const { rows } = await query('SELECT id FROM branch LIMIT 1');
  branchId = rows[0].id;
});

after(() => stopServer());

test('a non-cyclic department creation still succeeds', async () => {
  // Two brand-new, unrelated employees — isolated from every other test's
  // fixture mutations, so this doesn't depend on run order.
  const headEmp = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'Dept', lastName: 'HeadOk', email: 'dept.headok@fixture.test',
      departmentId: fixtures.departmentId, ...REQUIRED_EXTRAS,
    },
  });
  assert.equal(headEmp.status, 201, JSON.stringify(headEmp.body));
  const memberEmp = await api('POST', '/employees', {
    token: tokens.admin,
    body: {
      firstName: 'Dept', lastName: 'MemberOk', email: 'dept.memberok@fixture.test',
      departmentId: fixtures.departmentId, ...REQUIRED_EXTRAS,
    },
  });
  assert.equal(memberEmp.status, 201, JSON.stringify(memberEmp.body));

  const res = await api('POST', '/departments', {
    token: tokens.admin,
    body: {
      name: { en: 'Clean Dept', ar: 'قسم نظيف' },
      headEmployeeId: headEmp.body.employee.id,
      memberEmployeeIds: [memberEmp.body.employee.id],
      branchId,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('POST /departments rejects a member who already manages the chosen head (cycle)', async () => {
  // head2 becomes root's manager first, by reassigning root's own department
  // to head2 — the setup the next test also builds on.
  const setHead = await api('PATCH', `/departments/${fixtures.departmentId}/head`, {
    token: tokens.admin,
    body: { headEmployeeId: fixtures.employeeIds.head2 },
  });
  assert.equal(setHead.status, 204, JSON.stringify(setHead.body));

  // Now head2 is an ancestor of root. Creating a department headed by root
  // with head2 as a plain "member" would try to set head2.manager_id = root
  // — a direct cycle.
  const res = await api('POST', '/departments', {
    token: tokens.admin,
    body: {
      name: { en: 'Cyclic Dept', ar: 'قسم دائري' },
      headEmployeeId: fixtures.employeeIds.root,
      memberEmployeeIds: [fixtures.employeeIds.head2],
      branchId,
    },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(res.body.errors.memberEmployeeIds, /cycle/i);
});

test('PATCH /departments/:id/head rejects a reassignment that would create a cycle', async () => {
  // Same setup as the previous test: head2 already manages root. Department
  // fixtures.departmentId now has head2 as head with root (and field1/field2)
  // as members. Reassigning it back to root would set head2.manager_id =
  // root — but head2 is root's own manager, so that's a cycle too.
  const res = await api('PATCH', `/departments/${fixtures.departmentId}/head`, {
    token: tokens.admin,
    body: { headEmployeeId: fixtures.employeeIds.root },
  });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /cycle/i);
});
