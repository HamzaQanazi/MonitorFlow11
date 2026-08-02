// API suite for /files (CLAUDE.md §14 must-pass negatives): magic-byte
// rejection, size limit, and ownership on download. `api()` from the harness
// only sends JSON, so uploads here use fetch + FormData directly against
// apiUrl().
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, apiUrl, loginAll } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('files_api');
  tokens = await loginAll();
});

after(() => stopServer());

async function upload(token, { filename, bytes, extraFields = {} } = {}) {
  const form = new FormData();
  form.set('file', new Blob([bytes]), filename);
  for (const [k, v] of Object.entries(extraFields)) form.set(k, String(v));
  const res = await fetch(apiUrl('/files'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

test('.exe renamed .jpg → rejected by magic bytes', async () => {
  // 'MZ' DOS header, not a jpeg/png/pdf signature.
  const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const res = await upload(tokens.resident, { filename: 'virus.jpg', bytes: exeBytes });
  assert.equal(res.status, 422);
});

test('upload over 5MB → 422', async () => {
  const big = Buffer.alloc(5 * 1024 * 1024 + 1024, 0);
  const res = await upload(tokens.resident, { filename: 'big.png', bytes: big });
  assert.equal(res.status, 422);
});

test('download another user\'s file → 404', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
  const uploaded = await upload(tokens.resident, { filename: 'mine.png', bytes: png });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const fileId = uploaded.body.attachment.id;

  const reg = await api('POST', '/auth/register', {
    body: { name: 'Files Other', email: 'files-other@fixture.test', password: 'Password123!' },
  });
  assert.equal(reg.status, 201);

  const res = await api('GET', `/files/${fileId}`, { token: reg.body.token });
  assert.equal(res.status, 404);
});
