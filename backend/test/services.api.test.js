// API suite for /services (CLAUDE.md §14: "non-admin config → 403"). The Add
// Service builder (routes/services.js POST /) is a config action, not an
// oversight one (I2) — requireRole('admin'), no capability. reports.api.test.js
// already covers the CSV-export half of this must-pass item; this covers the
// config-write half specifically, since role-gating and capability-gating are
// different mechanisms and each needs its own negative.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, loginAll, fixtures } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('services_api');
  tokens = await loginAll();
});

after(() => stopServer());

// Minimal valid shapes both tests share — at least one field is required per
// form (formSchema.js rejects an empty array).
const A_FIELD = [{ id: 'note', label: { en: 'Note', ar: 'ملاحظة' }, type: 'text', required: true }];
const A_WORKFLOW = {
  statuses: [
    { key: 'open', label: { en: 'Open', ar: 'مفتوح' }, is_initial: true, is_terminal: false },
    { key: 'closed', label: { en: 'Closed', ar: 'مغلق' }, is_initial: false, is_terminal: true },
  ],
  transitions: [
    {
      key: 'close', from: 'open', to: 'closed',
      label: { en: 'Close', ar: 'إغلاق' },
      required_capability: null, actor: 'requester', requires_note: false, notify: [],
    },
  ],
};

test('a fully-capable employee (root) still gets 403 on POST /services — admin-only by role, not capability', async () => {
  // root holds every capability in this suite's fixture (Phase 0's test-only
  // augmentation) — proves the gate here is requireRole('admin'), not any
  // capability an employee level could ever hold.
  const res = await api('POST', '/services', {
    token: tokens.root,
    body: {
      name: { en: 'Should Not Exist', ar: 'يجب ألا يوجد' },
      departmentId: fixtures.departmentId,
      defaultPriority: 'low',
      acceptsExternalUsers: true,
      acceptsEmployeeSubmitters: false,
      featureKey: null,
      ownerId: fixtures.employeeIds.root,
      requestFields: A_FIELD,
      completionFields: A_FIELD,
      ...A_WORKFLOW,
    },
  });
  assert.equal(res.status, 403);
});

test('the admin can create a service', async () => {
  const res = await api('POST', '/services', {
    token: tokens.admin,
    body: {
      name: { en: 'Fixture Extra Service', ar: 'خدمة إضافية تجريبية' },
      departmentId: fixtures.departmentId,
      defaultPriority: 'low',
      acceptsExternalUsers: true,
      acceptsEmployeeSubmitters: false,
      featureKey: null,
      ownerId: fixtures.employeeIds.root,
      requestFields: A_FIELD,
      completionFields: A_FIELD,
      ...A_WORKFLOW,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.serviceTypeId);
});
