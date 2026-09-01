// API suite for POST /employees/import (bulk CSV hire, user-confirmed
// "partial success" semantics: good rows land, bad rows are reported, one
// bad row never blocks the rest of the file). `api()` from the harness only
// sends JSON, so uploads here use fetch + FormData directly (files.api.test.js's
// own pattern).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, apiUrl, loginAll, fixtures, query } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('employees_import_api');
  tokens = await loginAll();
});

after(() => stopServer());

async function importCsv(token, csv) {
  const form = new FormData();
  form.set('file', new Blob([csv], { type: 'text/csv' }), 'employees.csv');
  const res = await fetch(apiUrl('/employees/import'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json();
  return { status: res.status, body };
}

test('GET /employees/import/template returns a CSV with the expected header', async () => {
  const res = await fetch(apiUrl('/employees/import/template'), {
    headers: { Authorization: `Bearer ${tokens.root}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  const text = await res.text();
  assert.match(text.split('\n')[0], /^firstName,lastName,email,phone,birthdate,gender,workerType,weeklyRestDay,department,level$/);
});

test('without manage_employees, import is refused', async () => {
  const res = await importCsv(tokens.resident, 'firstName,lastName,email\nA,B,a@b.co\n');
  assert.equal(res.status, 403);
});

test('no file -> 422; header-only file -> 422', async () => {
  const noFile = await fetch(apiUrl('/employees/import'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.root}` },
    body: new FormData(),
  });
  assert.equal(noFile.status, 422);

  const headerOnly = await importCsv(tokens.root, 'firstName,lastName,email\n');
  assert.equal(headerOnly.status, 422);
});

test('partial success: good rows are created, a bad row is reported, neither blocks the other', async () => {
  const REQ = '0590000000,1995-01-01,female,full_time';
  const csv =
    'firstName,lastName,email,phone,birthdate,gender,workerType,weeklyRestDay\n' +
    `Import,One,import.one@fixture.test,${REQ},\n` +
    `Import,Bad,not-an-email,${REQ},\n` +
    `Import,Two,import.two@fixture.test,${REQ},Friday\n`;
  const res = await importCsv(tokens.root, csv);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.totalRows, 3);
  assert.equal(res.body.createdCount, 2);
  assert.equal(res.body.failedCount, 1);
  assert.deepEqual(
    res.body.created.map((c) => c.row),
    [2, 4]
  );
  assert.equal(res.body.failed[0].row, 3);
  assert.ok(res.body.failed[0].errors.email);

  // Non-admin importer (root): every created row lands in root's own
  // department — same restriction POST / already applies.
  const { rows } = await query(
    "SELECT department_id, weekly_rest_day FROM users WHERE email IN ('import.one@fixture.test', 'import.two@fixture.test') ORDER BY email"
  );
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.department_id, fixtures.departmentId);
  }
  assert.equal(rows[1].weekly_rest_day, 5); // "Friday" -> 5
});

test('admin importer resolves department/level by name; an unknown one fails that row only', async () => {
  const { rows: depts } = await query('SELECT id FROM department LIMIT 1');
  const departmentId = depts[0].id;
  const { rows: deptRow } = await query('SELECT name->>\'en\' AS name FROM department WHERE id = $1', [departmentId]);
  const deptName = deptRow[0].name;

  const csv =
    'firstName,lastName,email,phone,birthdate,gender,workerType,department\n' +
    `Import,Admin1,import.admin1@fixture.test,0590000000,1995-01-01,female,full_time,${deptName}\n` +
    'Import,Admin2,import.admin2@fixture.test,0590000000,1995-01-01,female,full_time,Not A Real Department\n';
  const res = await importCsv(tokens.admin, csv);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.createdCount, 1);
  assert.equal(res.body.failedCount, 1);
  assert.ok(res.body.failed[0].errors.department);

  const { rows } = await query("SELECT department_id FROM users WHERE email = 'import.admin1@fixture.test'");
  assert.equal(rows[0].department_id, departmentId);
});

test('a row missing a required column (phone/birthdate/gender/workerType) fails just that row', async () => {
  const csv =
    'firstName,lastName,email,phone,birthdate,gender,workerType\n' +
    'Import,Complete,import.complete@fixture.test,0590000000,1995-01-01,female,full_time\n' +
    'Import,Incomplete,import.incomplete@fixture.test,,,,\n';
  const res = await importCsv(tokens.root, csv);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.createdCount, 1);
  assert.equal(res.body.failedCount, 1);
  const failedErrors = res.body.failed[0].errors;
  for (const field of ['phone', 'birthdate', 'gender', 'workerType']) {
    assert.ok(failedErrors[field], `expected a ${field} error`);
  }
});

test('row count over the limit -> 422', async () => {
  const lines = ['firstName,lastName,email'];
  for (let i = 0; i < 501; i++) lines.push(`A,B,a${i}@fixture.test`);
  const res = await importCsv(tokens.admin, lines.join('\n') + '\n');
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.file);
});
