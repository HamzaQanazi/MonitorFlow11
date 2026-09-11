// API-integration + permission suite for the live-location endpoints (I10
// re-scope, CLAUDE.md §2/§13, 2026-09-11): PATCH /timeclock/live-location
// (employee, own active shift) and GET /timeclock/live-locations (manager
// surface, gated by the view_live_location capability + Gate 2 scope).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures, query } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('timeclock_live_location_api');
  tokens = await loginAll();
});

after(() => stopServer());

async function clockIn(token) {
  const res = await api('POST', '/timeclock/clock-in', {
    token,
    body: { location: { lat: 32.22, lng: 35.26 } },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.shift;
}

test('PATCH /timeclock/live-location with no active shift → 409', async () => {
  const res = await api('PATCH', '/timeclock/live-location', {
    token: tokens.field2,
    body: { location: { lat: 32.2, lng: 35.3 } },
  });
  assert.equal(res.status, 409);
});

test('PATCH /timeclock/live-location: missing/out-of-range location → 422', async () => {
  await clockIn(tokens.field2);
  const missing = await api('PATCH', '/timeclock/live-location', {
    token: tokens.field2,
    body: {},
  });
  assert.equal(missing.status, 422);

  const outOfRange = await api('PATCH', '/timeclock/live-location', {
    token: tokens.field2,
    body: { location: { lat: 999, lng: 35.3 } },
  });
  assert.equal(outOfRange.status, 422);

  // Clean up so later tests get a fresh clock-in.
  await api('POST', '/timeclock/clock-out', { token: tokens.field2 });
});

test('PATCH /timeclock/live-location: a valid ping updates the active shift, own GET reflects it', async () => {
  await clockIn(tokens.field1);
  const ping = await api('PATCH', '/timeclock/live-location', {
    token: tokens.field1,
    body: { location: { lat: 32.25, lng: 35.3 } },
  });
  assert.equal(ping.status, 200, JSON.stringify(ping.body));
  assert.deepEqual(ping.body.liveLocation, { lat: 32.25, lng: 35.3 });
  assert.ok(ping.body.liveLocationAt);

  const own = await api('GET', '/timeclock/shifts/active', { token: tokens.field1 });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.shift.liveLocation, { lat: 32.25, lng: 35.3 });

  await api('POST', '/timeclock/clock-out', { token: tokens.field1 });
});

test('GET /timeclock/live-locations: a plain employee without the capability → 403', async () => {
  const res = await api('GET', '/timeclock/live-locations', { token: tokens.field2 });
  assert.equal(res.status, 403);
});

test('GET /timeclock/live-locations: oversight in scope sees the clocked-in employee\'s live position; cross-department oversight does not', async () => {
  await clockIn(tokens.field1);
  await api('PATCH', '/timeclock/live-location', {
    token: tokens.field1,
    body: { location: { lat: 32.3, lng: 35.35 } },
  });

  const inScope = await api('GET', '/timeclock/live-locations', { token: tokens.root });
  assert.equal(inScope.status, 200, JSON.stringify(inScope.body));
  const mine = inScope.body.employees.find((e) => e.employeeId === fixtures.employeeIds.field1);
  assert.ok(mine, 'field1 should appear in root\'s scope');
  assert.deepEqual(mine.liveLocation, { lat: 32.3, lng: 35.35 });
  assert.equal(mine.stale, false);

  // head2 is a different department's oversight (testlib/harness.js) — never
  // reaches field1's row at all, not even filtered out with a placeholder.
  const outOfScope = await api('GET', '/timeclock/live-locations', { token: tokens.head2 });
  assert.equal(outOfScope.status, 200);
  assert.ok(!outOfScope.body.employees.some((e) => e.employeeId === fixtures.employeeIds.field1));

  // The admin (Owner) sees company-wide, same as /timeclock/today.
  const asAdmin = await api('GET', '/timeclock/live-locations', { token: tokens.admin });
  assert.equal(asAdmin.status, 200);
  assert.ok(asAdmin.body.employees.some((e) => e.employeeId === fixtures.employeeIds.field1));

  await api('POST', '/timeclock/clock-out', { token: tokens.field1 });
});

test('GET /timeclock/live-locations: a stale ping is flagged, and clocking out clears the position entirely', async () => {
  await clockIn(tokens.field1);
  await api('PATCH', '/timeclock/live-location', {
    token: tokens.field1,
    body: { location: { lat: 32.4, lng: 35.4 } },
  });
  await query(
    `UPDATE time_shift SET live_location_at = now() - INTERVAL '20 minutes'
     WHERE employee_id = $1 AND status = 'active'`,
    [fixtures.employeeIds.field1]
  );

  const stale = await api('GET', '/timeclock/live-locations', { token: tokens.root });
  const mine = stale.body.employees.find((e) => e.employeeId === fixtures.employeeIds.field1);
  assert.equal(mine.stale, true);

  const clockOut = await api('POST', '/timeclock/clock-out', { token: tokens.field1 });
  assert.equal(clockOut.status, 200);
  assert.equal(clockOut.body.shift.liveLocation, null);

  // No longer an active shift at all, so it drops out of the list entirely
  // rather than lingering with a stale last-known point (I10 — no
  // last-known position survives clock-out).
  const afterClockOut = await api('GET', '/timeclock/live-locations', { token: tokens.root });
  assert.ok(!afterClockOut.body.employees.some((e) => e.employeeId === fixtures.employeeIds.field1));
});
