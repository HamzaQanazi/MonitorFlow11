// API suite for POST /schedule/suggest (AI scheduling track, CLAUDE.md §13).
// Preview-only: never writes schedule_entry itself, so every test here reads
// the response and, where it applies the result, goes through the existing
// PUT /schedule/roster exactly like the web UI would.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures, query } = require('../testlib/harness');

let tokens;
let templateId;

before(async () => {
  await setup('schedule_suggest_api');
  // The shared fixture company onboards with features: ['time_clock'] only
  // (testlib/harness.js) — no re-onboard endpoint exists post-pivot (§9), so
  // direct row update is the documented way to turn a feature on afterward
  // (§15). Test-DB-only, same allowance harness.js's own fixture setup uses.
  await query(`UPDATE company SET features = features || '{schedule}'`);
  tokens = await loginAll();

  const tpl = await api('POST', '/schedule/templates', {
    token: tokens.root,
    body: { name: { en: 'Morning', ar: 'صباحي' }, startTime: '09:00', endTime: '17:00' },
  });
  assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
  templateId = tpl.body.template.id;
});

after(() => stopServer());

test('without manage_employees, suggest is refused', async () => {
  const res = await api('POST', '/schedule/suggest', {
    token: tokens.resident,
    body: { from: '2026-09-07', to: '2026-09-08', templateId, weekdays: [1, 2] },
  });
  assert.equal(res.status, 403);
});

test('unknown template id -> 404', async () => {
  const res = await api('POST', '/schedule/suggest', {
    token: tokens.root,
    body: { from: '2026-09-07', to: '2026-09-08', templateId: 999999, weekdays: [1] },
  });
  assert.equal(res.status, 404);
});

test('employeeIds outside the caller\'s subtree -> 404', async () => {
  const res = await api('POST', '/schedule/suggest', {
    token: tokens.root,
    body: { from: '2026-09-07', to: '2026-09-08', templateId, weekdays: [1], employeeIds: [fixtures.employeeIds.head2] },
  });
  assert.equal(res.status, 404);
});

test('perDay caps and rotates by who has the fewest shifts so far, tie-broken by id', async () => {
  const { field1, field2 } = fixtures.employeeIds;
  const lo = Math.min(field1, field2);
  const hi = Math.max(field1, field2);
  const res = await api('POST', '/schedule/suggest', {
    token: tokens.root,
    body: {
      from: '2026-09-07', // Monday
      to: '2026-09-08', // Tuesday
      templateId,
      weekdays: [1, 2],
      employeeIds: [field1, field2],
      perDay: 1,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.entries.length, 2);
  const byDate = Object.fromEntries(res.body.entries.map((e) => [e.date, e.employeeId]));
  assert.equal(byDate['2026-09-07'], lo, 'day 1: lower id wins the tie at equal load');
  assert.equal(byDate['2026-09-08'], hi, 'day 2: the other one now has the lower load');
});

test('an employee already scheduled that day is skipped, not overwritten', async () => {
  const { field1, field2 } = fixtures.employeeIds;
  const put = await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: field1, date: '2026-09-14', templateId }] },
  });
  assert.equal(put.status, 204);

  const res = await api('POST', '/schedule/suggest', {
    token: tokens.root,
    body: {
      from: '2026-09-14', // Monday
      to: '2026-09-14',
      templateId,
      weekdays: [1],
      employeeIds: [field1, field2],
      perDay: 2,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.alreadyScheduledSkipped, 1);
  assert.deepEqual(
    res.body.entries.map((e) => e.employeeId),
    [field2]
  );
});
