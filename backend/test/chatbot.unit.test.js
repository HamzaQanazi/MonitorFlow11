// Unit test for lib/chatbot.js's Groq error handling. Mocks global.fetch —
// no network, no DB, no server. (2026-09-22: switched from Gemini to Groq,
// see CLAUDE.md §13 — this test follows that switch.)
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { askChatbot } = require('../src/lib/chatbot');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.GROQ_API_KEY;
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test('a successful reply is returned trimmed', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const calledUrls = [];
  global.fetch = async (url) => {
    calledUrls.push(url);
    return jsonResponse(200, { choices: [{ message: { content: '  hi there  ' } }] });
  };

  const reply = await askChatbot('how do I clock in?', [], 'employee', undefined, [], []);

  assert.equal(reply, 'hi there');
  assert.equal(calledUrls.length, 1);
  assert.match(calledUrls[0], /api\.groq\.com\/openai\/v1\/chat\/completions/);
});

test('a 429 from Groq surfaces as our own 429', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => jsonResponse(429, { error: 'rate limited' });

  await assert.rejects(
    () => askChatbot('how do I clock in?', [], 'employee', undefined, [], []),
    (err) => err.status === 429
  );
});

test('a non-429 upstream error is a 502', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  global.fetch = async () => jsonResponse(500, { error: 'server error' });

  await assert.rejects(
    () => askChatbot('how do I clock in?', [], 'employee', undefined, [], []),
    (err) => err.status === 502
  );
});

test('no GROQ_API_KEY is a 503, no fetch attempted', async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    return jsonResponse(200, {});
  };

  await assert.rejects(
    () => askChatbot('how do I clock in?', [], 'employee', undefined, [], []),
    (err) => err.status === 503
  );
  assert.equal(called, false);
});
