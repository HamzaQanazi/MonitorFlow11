// POST /translate — bilingual auto-fill assist (CLAUDE.md §13, 2026-08-21
// exception). Auth/role/validation are covered unconditionally. The last
// test branches on whether GEMINI_API_KEY is set in the environment running
// the suite: unset (a fresh clone, CI, the other student's machine without a
// key yet) asserts the 503-not-a-crash path; set (this machine) asserts a
// real round trip actually returns a translation — so the suite stays green
// either way without hard-depending on a committed secret.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('translate_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('unauthenticated is refused', async () => {
  const res = await api('POST', '/translate', { body: { text: 'Hello', target: 'ar' } });
  assert.equal(res.status, 401);
});

test('the user role (external submitters) is refused', async () => {
  const res = await api('POST', '/translate', {
    token: tokens.resident,
    body: { text: 'Hello', target: 'ar' },
  });
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('missing text and a bad target are both 422, field-keyed', async () => {
  const res = await api('POST', '/translate', { token: tokens.root, body: { target: 'ar' } });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.text);

  const res2 = await api('POST', '/translate', { token: tokens.root, body: { text: 'Hello', target: 'fr' } });
  assert.equal(res2.status, 422, JSON.stringify(res2.body));
  assert.ok(res2.body.errors.target);
});

test('a valid request from an admin/employee', async () => {
  const res = await api('POST', '/translate', {
    token: tokens.root,
    body: { text: 'Hello', target: 'ar' },
  });
  if (!process.env.GEMINI_API_KEY) {
    // No key in this environment — must fail clean (503), not crash.
    assert.equal(res.status, 503, JSON.stringify(res.body));
    return;
  }
  // A key is configured — prove the real round trip works and returns
  // Arabic script, not an echo of the English input.
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(typeof res.body.translation, 'string');
  assert.ok(res.body.translation.length > 0);
  assert.ok(/[؀-ۿ]/.test(res.body.translation), `expected Arabic script, got: ${res.body.translation}`);
});
