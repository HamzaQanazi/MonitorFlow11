// API suite for self-service password reset (CLAUDE.md §13 re-scope,
// supervisor-directed). No real SMTP in this suite — lib/mailer.js logs
// instead of sending when SMTP_HOST is unset (true by default in the test
// env), so these tests read the token straight out of password_reset_token
// (test-DB-only, no other API surface exposes a raw token by design).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, stopServer, api, loginAll, fixtures, query, WHO, PASSWORDS } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('password_reset_api');
  tokens = await loginAll();
});

after(() => stopServer());

async function latestTokenFor(userId) {
  const { rows } = await query(
    'SELECT token_hash, expires_at, used_at FROM password_reset_token WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [userId]
  );
  return rows[0];
}

test('forgot-password responds identically for a real and a fake identifier (no enumeration)', async () => {
  const real = await api('POST', '/auth/forgot-password', { body: { identifier: WHO.root } });
  const fake = await api('POST', '/auth/forgot-password', { body: { identifier: 'nobody@nowhere.test' } });
  assert.equal(real.status, 200);
  assert.equal(fake.status, 200);
  assert.deepEqual(real.body, fake.body);
});

test('missing identifier -> 422', async () => {
  const res = await api('POST', '/auth/forgot-password', { body: {} });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.identifier);
});

test('full round trip: request a reset, use the token, log in with the new password', async () => {
  const rootId = fixtures.employeeIds.root;
  const req1 = await api('POST', '/auth/forgot-password', { body: { identifier: WHO.root } });
  assert.equal(req1.status, 200);

  const row = await latestTokenFor(rootId);
  assert.ok(row, 'a reset token row should exist for root');
  assert.equal(row.used_at, null);

  // The raw token is never stored — recover it isn't possible from the DB,
  // so this test drives the same code path reset-password uses by minting
  // a token with a known hash directly (test-DB-only), rather than trying
  // to intercept the (in this suite, console-only) mailer output.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await query('UPDATE password_reset_token SET token_hash = $1 WHERE user_id = $2', [tokenHash, rootId]);

  const bad = await api('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'short' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.newPassword);

  const reset = await api('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'BrandNewPass123!' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));

  const reused = await api('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'AnotherOne123!' } });
  assert.equal(reused.status, 422);

  const loginOld = await api('POST', '/auth/login', { body: { identifier: WHO.root, password: PASSWORDS.root } });
  assert.equal(loginOld.status, 401);

  const loginNew = await api('POST', '/auth/login', { body: { identifier: WHO.root, password: 'BrandNewPass123!' } });
  assert.equal(loginNew.status, 200, JSON.stringify(loginNew.body));
});

test('unknown or malformed token -> 422', async () => {
  const res = await api('POST', '/auth/reset-password', { body: { token: 'not-a-real-token', newPassword: 'ValidPass123!' } });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.token);
});

test('an expired token is refused', async () => {
  const rootId = fixtures.employeeIds.field1;
  const req1 = await api('POST', '/auth/forgot-password', { body: { identifier: WHO.field1 } });
  assert.equal(req1.status, 200);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await query("UPDATE password_reset_token SET token_hash = $1, expires_at = now() - INTERVAL '1 minute' WHERE user_id = $2", [
    tokenHash,
    rootId,
  ]);

  const res = await api('POST', '/auth/reset-password', { body: { token: rawToken, newPassword: 'ValidPass123!' } });
  assert.equal(res.status, 422);
});
