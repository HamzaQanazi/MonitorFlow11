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
      requestFields: A_FIELD,
      completionFields: A_FIELD,
      ...A_WORKFLOW,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.serviceTypeId);
});

// ---- Structural workflow rules (workflowSchema.js). A definition is frozen
// the moment a request uses it (§3), so a workflow that can strand a request
// is permanent damage — these are rejected at author time instead.

function servicePayload(overrides) {
  return {
    name: { en: 'Structural', ar: 'هيكلي' },
    departmentId: fixtures.departmentId,
    defaultPriority: 'low',
    acceptsExternalUsers: true,
    acceptsEmployeeSubmitters: false,
    featureKey: null,
    requestFields: A_FIELD,
    completionFields: A_FIELD,
    ...A_WORKFLOW,
    ...overrides,
  };
}

test('a status nothing can reach is refused', async () => {
  const res = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({
      name: { en: 'Unreachable', ar: 'غير قابل للوصول' },
      statuses: [
        ...A_WORKFLOW.statuses,
        { key: 'orphan', label: { en: 'Orphan', ar: 'يتيم' }, is_initial: false, is_terminal: true },
      ],
    }),
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.some((e) => e.includes('no transition path reaches')), JSON.stringify(res.body));
});

test('a non-terminal status with no way out is refused', async () => {
  const res = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({
      name: { en: 'Dead end', ar: 'طريق مسدود' },
      statuses: [
        { key: 'open', label: { en: 'Open', ar: 'مفتوح' }, is_initial: true, is_terminal: false },
        { key: 'stuck', label: { en: 'Stuck', ar: 'عالق' }, is_initial: false, is_terminal: false },
        { key: 'closed', label: { en: 'Closed', ar: 'مغلق' }, is_initial: false, is_terminal: true },
      ],
      transitions: [
        {
          key: 'to_stuck', from: 'open', to: 'stuck',
          label: { en: 'Stall', ar: 'تعليق' },
          required_capability: null, actor: 'requester', requires_note: false, notify: [],
        },
        {
          key: 'close', from: 'open', to: 'closed',
          label: { en: 'Close', ar: 'إغلاق' },
          required_capability: null, actor: 'requester', requires_note: false, notify: [],
        },
      ],
    }),
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.some((e) => e.includes('no transition out of it')), JSON.stringify(res.body));
});

test('an assign transition that also requires a form is refused', async () => {
  const res = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({
      name: { en: 'Assign plus form', ar: 'إسناد ونموذج' },
      transitions: [
        {
          key: 'close', from: 'open', to: 'closed',
          label: { en: 'Close', ar: 'إغلاق' },
          required_capability: 'assign', actor: null,
          required_form_key: 'completion', requires_note: false, notify: [],
        },
      ],
    }),
  });
  assert.equal(res.status, 422);
  assert.ok(res.body.errors.some((e) => e.includes('cannot also require a form')), JSON.stringify(res.body));
});

test('a self-service workflow with no assign transition is still allowed', async () => {
  // seedChecklists.js is exactly this shape — submitted -> logged, fired by
  // the requester, never assigned. It must not be caught by the new rules.
  const res = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Self service', ar: 'خدمة ذاتية' } }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

// ---- Editing a service before any request has used it (§3's actual rule).

test('a service with no requests can be edited, and GET /:id reports it editable', async () => {
  const created = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Editable', ar: 'قابل للتعديل' } }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.serviceTypeId;

  const before = await api('GET', `/services/${id}`, { token: tokens.admin });
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.service.editable, true);

  const res = await api('PATCH', `/services/${id}`, {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Renamed', ar: 'أُعيدت التسمية' }, defaultPriority: 'high' }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after = await api('GET', `/services/${id}`, { token: tokens.admin });
  assert.equal(after.body.service.name.en, 'Renamed');
  assert.equal(after.body.service.defaultPriority, 'high');
  // `key` is a stable handle and is deliberately not re-derived on rename.
  assert.equal(after.body.service.key, before.body.service.key);
});

test('editing is refused once the service has a request', async () => {
  const created = await api('POST', '/services', {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Freezes on use', ar: 'يتجمّد عند الاستخدام' } }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.serviceTypeId;

  // Editable right up until the first request lands.
  const beforeUse = await api('PATCH', `/services/${id}`, {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Still editable', ar: 'ما زال قابلًا للتعديل' } }),
  });
  assert.equal(beforeUse.status, 200, JSON.stringify(beforeUse.body));

  const req = await api('POST', '/requests', {
    token: tokens.resident,
    body: { serviceTypeId: id, formResponse: { note: 'first request' } },
  });
  assert.equal(req.status, 201, JSON.stringify(req.body));

  const afterUse = await api('PATCH', `/services/${id}`, {
    token: tokens.admin,
    body: servicePayload({ name: { en: 'Too late', ar: 'فات الأوان' } }),
  });
  assert.equal(afterUse.status, 409, JSON.stringify(afterUse.body));

  const detail = await api('GET', `/services/${id}`, { token: tokens.admin });
  assert.equal(detail.body.service.editable, false);
  assert.equal(detail.body.service.name.en, 'Still editable', 'the refused edit must not have landed');
});

test('a non-admin cannot edit or read a service definition', async () => {
  assert.equal((await api('GET', `/services/${fixtures.serviceTypeId}`, { token: tokens.root })).status, 403);
  assert.equal(
    (await api('PATCH', `/services/${fixtures.serviceTypeId}`, { token: tokens.root, body: servicePayload({}) })).status,
    403
  );
});
