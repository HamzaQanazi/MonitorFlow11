// POST /chatbot/message — in-app help/FAQ assistant (CLAUDE.md §13, chatbot
// exception, switched from Gemini to Groq 2026-09-22). Same
// GROQ_API_KEY-branching pattern as translate.api.test.js: the round-trip
// assertion only runs when a real key is present in the environment running
// the suite, so the suite stays green on a fresh clone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('chatbot_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('unauthenticated is refused', async () => {
  const res = await api('POST', '/chatbot/message', { body: { message: 'How do I clock in?' } });
  assert.equal(res.status, 401);
});

test('every account kind may call it (user included, unlike /translate)', async () => {
  const res = await api('POST', '/chatbot/message', {
    token: tokens.resident,
    body: { message: 'How do I clock in?' },
  });
  assert.notEqual(res.status, 403, JSON.stringify(res.body));
});

test('missing message is 422, field-keyed', async () => {
  const res = await api('POST', '/chatbot/message', { token: tokens.root, body: {} });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.message);
});

test('an over-length message is 422', async () => {
  const res = await api('POST', '/chatbot/message', {
    token: tokens.root,
    body: { message: 'a'.repeat(1001) },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.message);
});

test('a bad history item is 422', async () => {
  const res = await api('POST', '/chatbot/message', {
    token: tokens.root,
    body: { message: 'hi', history: [{ role: 'wrong', text: 'x' }] },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.history);
});

test('a valid request from an authenticated employee', async () => {
  const res = await api('POST', '/chatbot/message', {
    token: tokens.root,
    body: { message: 'How do I submit a request?' },
  });
  if (!process.env.GROQ_API_KEY) {
    assert.equal(res.status, 503, JSON.stringify(res.body));
    return;
  }
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(typeof res.body.reply, 'string');
  assert.ok(res.body.reply.length > 0);
});
