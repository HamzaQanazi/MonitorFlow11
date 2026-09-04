// API suite for the company settings editor (GET/PATCH /company). CLAUDE.md
// §15 listed onboarding's one-shot-ness as a limitation to state rather than
// fix; re-scoped 2026-08-22, so these are the rules the new edit path adds.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, query } = require('../testlib/harness');

let tokens;
let base;

before(async () => {
  await setup('company_api');
  tokens = await loginAll();
  const res = await api('GET', '/company', { token: tokens.admin });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const c = res.body.company;
  base = {
    name: c.name,
    address: c.address,
    phone: c.phone,
    employeeRange: c.employeeRange,
    industry: c.industry,
    emailDomain: c.emailDomain,
    plan: c.plan,
    features: c.features,
    branches: c.branches.map((b) => ({ id: b.id, en: b.name.en, ar: b.name.ar })),
  };
});

after(() => stopServer());

test('GET /company returns the onboarded settings and its branches', async () => {
  const res = await api('GET', '/company', { token: tokens.admin });
  assert.equal(res.status, 200);
  assert.equal(res.body.company.onboardingCompleted, true);
  assert.ok(res.body.company.branches.length > 0);
  assert.ok(res.body.company.features.length > 0);
});

test('only the admin can read or write company settings', async () => {
  assert.equal((await api('GET', '/company', { token: tokens.root })).status, 403);
  assert.equal((await api('PATCH', '/company', { token: tokens.root, body: base })).status, 403);
});

test('a feature can be turned on after onboarding — the old §15 limitation', async () => {
  const features = [...new Set([...base.features, 'events'])];
  const res = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, features } });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await api('GET', '/company', { token: tokens.admin });
  assert.ok(after.body.company.features.includes('events'));
});

test('clearing every feature is refused, here as well as at onboarding', async () => {
  const res = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, features: [] } });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.features, JSON.stringify(res.body));
});

test('the catalogue is re-validated on edit, not only at onboarding', async () => {
  const bad = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, industry: 'not_a_thing' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.industry);

  const domain = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, emailDomain: 'not a domain' } });
  assert.equal(domain.status, 422);
  assert.ok(domain.body.errors.emailDomain);
});

test('branches: add, rename, and refuse to delete one a department still uses', async () => {
  const added = await api('PATCH', '/company', {
    token: tokens.admin,
    body: { ...base, branches: [...base.branches, { en: 'Second site', ar: 'الموقع الثاني' }] },
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));

  const afterAdd = await api('GET', '/company', { token: tokens.admin });
  assert.equal(afterAdd.body.company.branches.length, base.branches.length + 1);
  const newBranch = afterAdd.body.company.branches.at(-1);

  const renamed = await api('PATCH', '/company', {
    token: tokens.admin,
    body: {
      ...base,
      branches: afterAdd.body.company.branches.map((b) =>
        b.id === newBranch.id ? { id: b.id, en: 'Renamed site', ar: 'موقع مُعاد تسميته' } : { id: b.id, en: b.name.en, ar: b.name.ar },
      ),
    },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  const afterRename = await api('GET', '/company', { token: tokens.admin });
  assert.equal(afterRename.body.company.branches.find((b) => b.id === newBranch.id).name.en, 'Renamed site');

  // Point a department at it, then try to drop it.
  await query(`UPDATE department SET branch_id = ${newBranch.id} WHERE id = (SELECT MIN(id) FROM department)`);
  const removal = await api('PATCH', '/company', {
    token: tokens.admin,
    body: { ...base, branches: base.branches },
  });
  assert.equal(removal.status, 409, JSON.stringify(removal.body));

  // Detach and it drops cleanly.
  await query('UPDATE department SET branch_id = NULL WHERE branch_id IS NOT NULL');
  const dropped = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, branches: base.branches } });
  assert.equal(dropped.status, 200, JSON.stringify(dropped.body));
  const afterDrop = await api('GET', '/company', { token: tokens.admin });
  assert.equal(afterDrop.body.company.branches.length, base.branches.length);
});

test('a plan whose cap is below the current headcount is refused', async () => {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'employee' AND is_active");
  assert.ok(rows[0].n > 1, 'fixture should have several employees');
  // 'starter' is the smallest tier in lib/onboardingOptions.js.
  const opts = await api('GET', '/onboarding/options', { token: tokens.admin });
  const smallest = opts.body.plans
    .filter((p) => p.employeeCap != null)
    .sort((a, b) => a.employeeCap - b.employeeCap)[0];
  if (smallest.employeeCap >= rows[0].n) return; // fixture is small enough; nothing to prove

  const res = await api('PATCH', '/company', { token: tokens.admin, body: { ...base, plan: smallest.key } });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(res.body.errors.plan);
});

test('editing settings never re-opens onboarding', async () => {
  await api('PATCH', '/company', { token: tokens.admin, body: base });
  const res = await api('GET', '/company', { token: tokens.admin });
  assert.equal(res.body.company.onboardingCompleted, true);
  // The one-shot onboarding save still refuses.
  const rerun = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...base, branches: [{ en: 'X', ar: 'س' }] },
  });
  assert.equal(rerun.status, 409);
});
