// API suite for requireFeature() (middleware/auth.js) — the onboarding
// wizard's step-4 feature picks gate the 7 workforce module route files
// independently of Gate 1/2. The harness's fixture company (testlib/
// harness.js) onboards with features: ['time_clock'] only, so every other
// module's routes should refuse even an otherwise-fully-capable actor.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('feature_gate_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('a module not in the company\'s onboarding feature picks refuses everyone, including a fully-capable employee and the admin', async () => {
  // Knowledge Base's read side has no capability requirement at all (any
  // authenticated employee/admin can read it) — isolates the feature gate as
  // the ONLY thing that can be refusing this request.
  const asRoot = await api('GET', '/knowledge-base', { token: tokens.root });
  assert.equal(asRoot.status, 403, JSON.stringify(asRoot.body));
  const asAdmin = await api('GET', '/knowledge-base', { token: tokens.admin });
  assert.equal(asAdmin.status, 403, JSON.stringify(asAdmin.body));
});

test('a module the company DID select at onboarding (time_clock) is reachable', async () => {
  const res = await api('GET', '/timeclock/shifts/active', { token: tokens.field1 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});
