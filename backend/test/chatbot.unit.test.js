// Unit test for lib/chatbot.js's model-fallback logic (2026-09-22 fix): a
// 429 from the primary model must retry once against the fallback model,
// not fail outright. Mocks global.fetch — no network, no DB, no server.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { askChatbot } = require('../src/lib/chatbot');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test('429 on the primary model falls back to the secondary model', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calledUrls = [];
  global.fetch = async (url) => {
    calledUrls.push(url);
    if (calledUrls.length === 1) return jsonResponse(429, { error: 'quota exceeded' });
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'fallback reply' }] } }] });
  };

  const reply = await askChatbot('how do I clock in?', [], 'employee', undefined, [], []);

  assert.equal(reply, 'fallback reply');
  assert.equal(calledUrls.length, 2);
  assert.match(calledUrls[0], /gemini-3\.5-flash:/);
  assert.match(calledUrls[1], /gemini-3\.5-flash-lite:/);
});

test('429 on both models surfaces as a 429', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = async () => jsonResponse(429, { error: 'quota exceeded' });

  await assert.rejects(
    () => askChatbot('how do I clock in?', [], 'employee', undefined, [], []),
    (err) => err.status === 429
  );
});

test('a non-429 upstream error is a 502, no fallback attempted', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const calledUrls = [];
  global.fetch = async (url) => {
    calledUrls.push(url);
    return jsonResponse(500, { error: 'server error' });
  };

  await assert.rejects(
    () => askChatbot('how do I clock in?', [], 'employee', undefined, [], []),
    (err) => err.status === 502
  );
  assert.equal(calledUrls.length, 1);
});
