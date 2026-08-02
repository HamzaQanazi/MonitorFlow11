// API suite for /company/onboarding (CLAUDE.md §14: "onboarding-save
// validation — each pick against the catalogue; one-shot 409"). Every
// catalogue-validation check in routes/onboarding.js runs BEFORE the
// one-shot completed-check, so these negatives work fine against the
// harness's already-onboarded fixture company — only the "second call"
// test needs a valid payload.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll } = require('../testlib/harness');

let tokens;

const VALID = {
  name: { en: 'Second Try Co', ar: 'شركة أخرى' },
  address: { en: '2 Test St', ar: 'شارع الاختبار 2' },
  ownerJobTitle: { en: 'Owner', ar: 'المالك' },
  phone: '0590000001',
  emailDomain: 'second.test',
  employeeRange: '11-30',
  industry: 'field_services',
  subIndustry: 'maintenance',
  branches: [{ en: 'Main', ar: 'الرئيسي' }],
  features: ['time_clock'],
  plan: 'enterprise',
};

before(async () => {
  await setup('onboarding_api');
  tokens = await loginAll();
});

after(() => stopServer());

test('second PATCH /company/onboarding after completion → 409', async () => {
  const res = await api('PATCH', '/company/onboarding', { token: tokens.admin, body: VALID });
  assert.equal(res.status, 409);
});

test('unknown industry → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, industry: 'not_a_real_industry' },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.industry);
});

test('sub-industry not belonging to the chosen industry → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, industry: 'healthcare', subIndustry: 'maintenance' },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.subIndustry);
});

test('unknown plan → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, plan: 'not_a_real_plan' },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.plan);
});

test('unknown feature key → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, features: ['not_a_real_feature'] },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.features);
});

test('bilingual field missing one language → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, name: { en: 'Only English' } },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.name);
});

test('malformed email domain → 422', async () => {
  const res = await api('PATCH', '/company/onboarding', {
    token: tokens.admin,
    body: { ...VALID, emailDomain: 'not a domain!' },
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.emailDomain);
});
