// API suite for the Schedule template rules and the Owner's scope on the
// roster. Both were live defects: the Owner (an admin with no subtree, I2) got
// an empty roster they also couldn't write to, and a template's hours could be
// edited after the fact, silently rewriting Time Clock's attendance history.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures, query } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('schedule_templates_api');
  // Same feature-flip the suggest suite uses — no re-onboard endpoint exists
  // post-pivot (§9), so a direct row update is the documented way (§15).
  await query(`UPDATE company SET features = features || '{schedule}'`);
  tokens = await loginAll();
});

after(() => stopServer());

async function newTemplate(en, startTime, endTime) {
  const res = await api('POST', '/schedule/templates', {
    token: tokens.root,
    body: { name: { en, ar: en }, startTime, endTime },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.template.id;
}

// ---- Gate 2: the Owner has no subtree, so the roster has to fall back to
// the whole company or the feature is unusable for them.

test('the Owner sees the company roster, not an empty one', async () => {
  const res = await api('GET', '/schedule/roster?from=2026-09-07&to=2026-09-13', { token: tokens.admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.employees.length > 0, 'Owner saw an empty roster');
});

test('the Owner can write the roster', async () => {
  const templateId = await newTemplate('Owner write', '09:00', '17:00');
  const res = await api('PUT', '/schedule/roster', {
    token: tokens.admin,
    body: { entries: [{ employeeId: fixtures.employeeIds.field1, date: '2026-09-07', templateId }] },
  });
  assert.equal(res.status, 204, JSON.stringify(res.body));
});

test('the Owner can generate a suggestion over the whole company', async () => {
  const templateId = await newTemplate('Owner suggest', '08:00', '16:00');
  const res = await api('POST', '/schedule/suggest', {
    token: tokens.admin,
    body: { from: '2026-09-14', to: '2026-09-15', templateId, weekdays: [1, 2] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.entries.length > 0, 'Owner got no suggestions');
});

// ---- A template's hours are frozen once it has been worked.

test('hours are frozen once the template has been used on a past date', async () => {
  const templateId = await newTemplate('Frozen', '09:00', '17:00');
  const put = await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: fixtures.employeeIds.field1, date: '2020-01-06', templateId }] },
  });
  assert.equal(put.status, 204);

  const res = await api('PATCH', `/schedule/templates/${templateId}`, {
    token: tokens.root,
    body: { startTime: '10:00', endTime: '18:00' },
  });
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

test('renaming a used template is still allowed — a label never feeds the math', async () => {
  const templateId = await newTemplate('Renamable', '11:00', '19:00');
  await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: fixtures.employeeIds.field2, date: '2020-01-07', templateId }] },
  });

  const res = await api('PATCH', `/schedule/templates/${templateId}`, {
    token: tokens.root,
    body: { name: { en: 'Renamed', ar: 'مُعاد التسمية' } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.template.name.en, 'Renamed');
});

test('a template used only on future dates is still fully editable', async () => {
  const templateId = await newTemplate('Future only', '12:00', '20:00');
  await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: fixtures.employeeIds.field1, date: '2099-01-05', templateId }] },
  });

  const res = await api('PATCH', `/schedule/templates/${templateId}`, {
    token: tokens.root,
    body: { startTime: '13:00', endTime: '21:00' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.template.startTime.slice(0, 5), '13:00');
});

test('re-sending the same hours on a used template is not a change, so it passes', async () => {
  const templateId = await newTemplate('Unchanged', '07:00', '15:00');
  await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: fixtures.employeeIds.field2, date: '2020-01-08', templateId }] },
  });

  const res = await api('PATCH', `/schedule/templates/${templateId}`, {
    token: tokens.root,
    body: { startTime: '07:00', endTime: '15:00', name: { en: 'Still fine', ar: 'ما زال جيدًا' } },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('deleting a template that is in use is refused', async () => {
  const templateId = await newTemplate('In use', '06:00', '14:00');
  await api('PUT', '/schedule/roster', {
    token: tokens.root,
    body: { entries: [{ employeeId: fixtures.employeeIds.field1, date: '2026-09-21', templateId }] },
  });

  const res = await api('DELETE', `/schedule/templates/${templateId}`, { token: tokens.root });
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

test('an unused template deletes cleanly', async () => {
  const templateId = await newTemplate('Unused', '05:00', '13:00');
  const res = await api('DELETE', `/schedule/templates/${templateId}`, { token: tokens.root });
  assert.equal(res.status, 204, JSON.stringify(res.body));
});
