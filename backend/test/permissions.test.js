// The permission suite (CLAUDE.md §14: "the permission model is the test plan").
//
// Every case here is a two-gate assertion:
//   GATE 1 — does the actor's LEVEL grant the required capability?
//   GATE 2 — is the target inside the actor's SUBTREE?
// §14 names the two failures that matter most: a capable actor OUTSIDE their
// subtree is refused, and a subtree member WITHOUT the capability is refused.
// Both appear below against the same endpoints, so neither gate can be dropped
// without a red test.
//
// Runs against a spawned server on a throwaway `monitorflow_test` database —
// the dev database is never touched. See testlib/harness.js.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, login, loginAll, SEED_PASSWORD } = require('../testlib/harness');

let tok;              // tokens by role name
const svc = {};       // service key -> id
let worksRequestId;   // a Public Works request (Rami's subtree)
let wasteRequestId;   // a Sanitation request (Widad's subtree)
let ziadId;           // a Field Officer inside Rami's subtree
let samiId;           // a Field Officer OUTSIDE Rami's subtree

before(async () => {
  await setup();
  tok = await loginAll();

  const services = await api('GET', '/config/services', { token: tok.admin });
  assert.equal(services.status, 200, 'admin can list configured services');
  for (const s of services.body.services) svc[s.key] = s.id;

  // The org root sees every subtree, so it is the reliable way to look up a
  // request in someone else's department.
  const pick = async (key) => {
    const r = await api('GET', `/requests?serviceTypeId=${svc[key]}&pageSize=1`, { token: tok.root });
    assert.equal(r.status, 200);
    assert.ok(r.body.requests.length, `seed has at least one ${key} request`);
    return r.body.requests[0].id;
  };
  worksRequestId = await pick('pothole');
  wasteRequestId = await pick('bulky_waste');

  const staff = await api('GET', '/employees?pageSize=100', { token: tok.root });
  assert.equal(staff.status, 200);
  const byLogin = (n) => staff.body.employees.find((e) => e.loginIdentifier === n);
  ziadId = byLogin('1101').id;
  samiId = byLogin('1201').id;
});

after(() => stopServer());

describe('unauthenticated', () => {
  test('every guarded route needs a token', async () => {
    for (const [method, path] of [
      ['GET', '/requests'],
      ['GET', '/employees'],
      ['GET', '/config/services'],
      ['GET', '/notifications'],
    ]) {
      const r = await api(method, path);
      assert.equal(r.status, 401, `${method} ${path} without a token`);
    }
  });

  test('a garbage token is rejected, not ignored', async () => {
    const r = await api('GET', '/requests', { token: 'not.a.jwt' });
    assert.equal(r.status, 401);
  });
});

describe('Gate 1 — capability', () => {
  // Ziad is INSIDE Rami's subtree, so Gate 2 passes. He is a Field Officer,
  // whose level grants no capabilities, so each of these must fail on Gate 1
  // alone. This is §14's "a subtree member without the capability is refused".
  test('a Field Officer cannot assign, set priority, or override', async () => {
    const assign = await api('PATCH', `/requests/${worksRequestId}/assign`, {
      token: tok.worksField,
      body: { employeeId: ziadId },
    });
    assert.equal(assign.status, 403, 'assign requires the assign capability');

    const priority = await api('PATCH', `/requests/${worksRequestId}/priority`, {
      token: tok.worksField,
      body: { priority: 'high' },
    });
    assert.equal(priority.status, 403, 'priority requires set_priority');

    const override = await api('PATCH', `/requests/${worksRequestId}/status`, {
      token: tok.worksField,
      body: { status: 'cancelled', note: 'test' },
    });
    assert.equal(override.status, 403, 'override requires the override capability');
  });

  test('a Field Officer cannot manage employees or export', async () => {
    const list = await api('GET', '/employees', { token: tok.worksField });
    assert.equal(list.status, 403, 'employee management requires manage_employees');

    const csv = await api('GET', '/reports/export.csv', { token: tok.worksField });
    assert.equal(csv.status, 403, 'CSV export requires the export capability');
  });

  test('the same calls succeed for a level that does grant the capability', async () => {
    // Identical requests, different actor — proves the refusals above are the
    // capability gate and not a broken endpoint.
    const priority = await api('PATCH', `/requests/${worksRequestId}/priority`, {
      token: tok.worksHead,
      body: { priority: 'high' },
    });
    assert.equal(priority.status, 200);

    const list = await api('GET', '/employees', { token: tok.worksHead });
    assert.equal(list.status, 200);
  });
});

describe('Gate 2 — subtree scope', () => {
  // Widad holds every capability, so Gate 1 passes. A Public Works request is
  // outside her subtree, so it must be invisible — §14's "a capable actor
  // outside their subtree is refused". 404, not 403, so ids cannot be probed.
  test('a fully capable head cannot see another subtree request', async () => {
    const read = await api('GET', `/requests/${worksRequestId}`, { token: tok.wasteHead });
    assert.equal(read.status, 404, 'out-of-subtree request is invisible, not forbidden');
  });

  test('a fully capable head cannot act on another subtree request', async () => {
    const assign = await api('PATCH', `/requests/${worksRequestId}/assign`, {
      token: tok.wasteHead,
      body: { employeeId: samiId },
    });
    assert.equal(assign.status, 404, 'capability held, but the target is out of scope');

    const priority = await api('PATCH', `/requests/${worksRequestId}/priority`, {
      token: tok.wasteHead,
      body: { priority: 'low' },
    });
    assert.equal(priority.status, 404);
  });

  test('each head sees their own subtree and not the other', async () => {
    const mine = await api('GET', `/requests/${wasteRequestId}`, { token: tok.wasteHead });
    assert.equal(mine.status, 200, 'own subtree is visible');

    const theirs = await api('GET', `/requests/${wasteRequestId}`, { token: tok.worksHead });
    assert.equal(theirs.status, 404, 'and the reverse direction is refused too');
  });

  test('the org root reaches every subtree', async () => {
    // Maya sits at the top with manager_id NULL — she reaches everything by
    // position in the tree, not by a special case in the code.
    for (const id of [worksRequestId, wasteRequestId]) {
      const r = await api('GET', `/requests/${id}`, { token: tok.root });
      assert.equal(r.status, 200);
    }
  });

  test('assignment is downward-only: an out-of-subtree assignee is refused', async () => {
    // Rami holds `assign` AND the request is his. Only the assignee is wrong:
    // Sami reports to Widad, not to Rami. Must-pass "cross-subtree assign".
    const bad = await api('PATCH', `/requests/${worksRequestId}/assign`, {
      token: tok.worksHead,
      body: { employeeId: samiId },
    });
    assert.equal(bad.status, 422, 'assignee outside the actor subtree');

    const good = await api('PATCH', `/requests/${worksRequestId}/assign`, {
      token: tok.worksHead,
      body: { employeeId: ziadId },
    });
    assert.equal(good.status, 200, 'same call, assignee inside the subtree');
  });
});

describe('admins configure, they do not operate the queue', () => {
  // I2/§5: admins gate by role and hold NO capabilities. The operational
  // routers exclude them outright so they cannot fall through to oversight.
  test('an admin is refused on operational endpoints', async () => {
    for (const [method, path] of [
      ['GET', '/requests'],
      ['GET', `/requests/${worksRequestId}`],
      ['GET', '/tasks'],
      ['GET', '/employees'],
    ]) {
      const r = await api(method, path, { token: tok.admin });
      assert.equal(r.status, 403, `admin on ${method} ${path}`);
    }
  });

  test('and is the only kind allowed on config', async () => {
    const ok = await api('GET', '/config/services', { token: tok.admin });
    assert.equal(ok.status, 200);

    for (const role of ['root', 'worksHead', 'worksField', 'resident']) {
      const r = await api('GET', '/config/services', { token: tok[role] });
      assert.equal(r.status, 403, `${role} must not reach the config API`);
    }
  });
});

describe('external users see only their own', () => {
  test('another user\'s request is 404, never 403', async () => {
    // The seed has exactly one external user, so a second one has to be
    // created to test cross-user isolation at all. Self-registration is the
    // only path that makes a `user`, which is itself worth exercising.
    const email = `outsider.${Date.now()}@example.test`;
    const created = await api('POST', '/auth/register', {
      body: { name: 'Outside Party', email, password: SEED_PASSWORD, phone: null },
    });
    assert.equal(created.status, 201, 'self-registration creates a user');
    const outsider = await login(email);

    const mine = await api('GET', '/requests?pageSize=1', { token: tok.resident });
    assert.equal(mine.status, 200);
    const someoneElsesId = mine.body.requests[0].id;

    // A valid id owned by another party must look nonexistent, so ids cannot
    // be probed by comparing 403 against 404.
    const read = await api('GET', `/requests/${someoneElsesId}`, { token: outsider });
    assert.equal(read.status, 404);

    // ...and the new user's own (empty) list is genuinely scoped to them.
    const theirs = await api('GET', '/requests', { token: outsider });
    assert.equal(theirs.status, 200);
    assert.equal(theirs.body.requests.length, 0, 'a fresh user sees no one else\'s requests');
  });

  test('a user cannot reach oversight endpoints at all', async () => {
    for (const [method, path, body] of [
      ['GET', '/employees', null],
      ['GET', '/reports/export.csv', null],
      ['PATCH', `/requests/${worksRequestId}/priority`, { priority: 'low' }],
    ]) {
      const r = await api(method, path, { token: tok.resident, ...(body ? { body } : {}) });
      assert.equal(r.status, 403, `user on ${method} ${path}`);
    }
  });
});
