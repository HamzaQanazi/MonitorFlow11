// Phase 7: the webhook signing helper is the security-relevant bit (a subscriber
// verifies deliveries with it), so it gets a unit check. Delivery itself is
// covered end-to-end by scratchpad/smoke_p7.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sign, EVENTS } = require('../src/lib/webhooks');

test('sign is a deterministic HMAC-SHA256 of the body', () => {
  const body = JSON.stringify({ event: 'status_changed', request_id: 7 });
  const expected = crypto.createHmac('sha256', 'sekret').update(body).digest('hex');
  assert.equal(sign('sekret', body), expected);
  assert.equal(sign('sekret', body), sign('sekret', body)); // stable
});

test('a different secret or body yields a different signature', () => {
  const body = '{"a":1}';
  assert.notEqual(sign('one', body), sign('two', body));
  assert.notEqual(sign('one', body), sign('one', '{"a":2}'));
});

test('the four lifecycle events are the fixed vocabulary', () => {
  assert.deepEqual(EVENTS, ['request_created', 'status_changed', 'assigned', 'sla_breached']);
});
