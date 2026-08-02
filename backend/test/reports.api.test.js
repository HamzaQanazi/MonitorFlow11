// API suite for /reports (CLAUDE.md §14: "non-admin config/CSV → 403").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, apiUrl, loginAll } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('reports_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('a non-capable employee gets 403 on the CSV export endpoint', async () => {
  // field1 holds no capabilities at all — refused by the router's own
  // requireCapability('view_all') before even reaching the export-specific
  // requireCapability('export') check.
  const res = await api('GET', '/reports/export.csv', { token: tokens.field1 });
  assert.equal(res.status, 403);
});

test('a capable employee (root) can export CSV', async () => {
  const res = await fetch(apiUrl('/reports/export.csv'), {
    headers: { Authorization: `Bearer ${tokens.root}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const text = await res.text();
  assert.match(text.split('\r\n')[0], /^id,service_type,status_label,state,priority/);
});
