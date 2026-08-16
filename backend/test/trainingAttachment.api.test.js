// API suite for the Training attachment "cheap version" pass
// (027_training_attachment.sql, routes/training.js, routes/files.js):
// - an employee who can write training (manage_training/view_all, not just
//   admin) may now make a parentless upload, previously employee-forbidden.
// - a training-linked file is readable by any admin/employee at the owning
//   company (matching GET /training's own read scope), not just its uploader.
// Own database (setup('training_attachment_api')) because it needs
// training_onboarding enabled, which the shared harness fixture deliberately
// leaves off (see featureGate.api.test.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, apiUrl, loginAll, fixtures, query } = require('../testlib/harness');

let tokens;

before(async () => {
  await setup('training_attachment_api');
  await query(
    `UPDATE company SET features = array_append(features, 'training_onboarding')
     WHERE NOT ('training_onboarding' = ANY(features))`
  );
  tokens = await loginAll();
});

after(() => stopServer());

async function upload(token, { filename = 'guide.pdf', bytes } = {}) {
  const pdf = bytes || Buffer.from('%PDF-1.4\n%mock', 'latin1');
  const form = new FormData();
  form.set('file', new Blob([pdf]), filename);
  const res = await fetch(apiUrl('/files'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Order matters: field1 and field2 share the Staff level, so this negative
// case must run before the next test grants Staff the manage_training
// capability — otherwise it would grant it to field2 too.
test('a plain employee with no training capability cannot make a parentless upload', async () => {
  const res = await upload(tokens.field2);
  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('an employee with only manage_training (no view_all) can make a parentless upload', async () => {
  // Grants Staff level just manage_training, the narrow module-author
  // capability, nothing else — field1 and field2 both pick it up from here on.
  await query(
    `INSERT INTO level_capability (level_id, capability_key)
     VALUES ($1, 'manage_training') ON CONFLICT DO NOTHING`,
    [fixtures.levelIds.staff]
  );
  const res = await upload(tokens.field1);
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test('creating a training module with an attached file, then reading it back as any company employee', async () => {
  const uploaded = await upload(tokens.root, { filename: 'onboarding-guide.pdf' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const attachmentFileId = uploaded.body.attachment.id;

  const created = await api('POST', '/training', {
    token: tokens.root,
    body: {
      title: { en: 'Welcome Guide', ar: 'دليل الترحيب' },
      body: { en: 'Read this first.', ar: 'اقرأ هذا أولاً.' },
      attachmentFileId,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.module.attachment.id, attachmentFileId);
  assert.equal(created.body.module.attachment.originalFilename, 'onboarding-guide.pdf');

  // field2 never uploaded this file and holds no training capability — still
  // company-wide readable, same scope as GET /training itself.
  const download = await fetch(apiUrl(`/files/${attachmentFileId}`), {
    headers: { Authorization: `Bearer ${tokens.field2}` },
  });
  assert.equal(download.status, 200);
});

test('a `user` account (external submitter) cannot read a training attachment', async () => {
  const uploaded = await upload(tokens.root, { filename: 'staff-only.pdf' });
  const created = await api('POST', '/training', {
    token: tokens.root,
    body: {
      title: { en: 'Staff Only', ar: 'للموظفين فقط' },
      body: { en: 'x', ar: 'س' },
      attachmentFileId: uploaded.body.attachment.id,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const download = await fetch(apiUrl(`/files/${created.body.module.attachment.id}`), {
    headers: { Authorization: `Bearer ${tokens.resident}` },
  });
  assert.equal(download.status, 404);
});

test('an already-linked attachment cannot be reused on a second module', async () => {
  const uploaded = await upload(tokens.root, { filename: 'once.pdf' });
  const first = await api('POST', '/training', {
    token: tokens.root,
    body: { title: { en: 'A', ar: 'أ' }, body: { en: 'x', ar: 'س' }, attachmentFileId: uploaded.body.attachment.id },
  });
  assert.equal(first.status, 201);

  const second = await api('POST', '/training', {
    token: tokens.root,
    body: { title: { en: 'B', ar: 'ب' }, body: { en: 'y', ar: 'ص' }, attachmentFileId: uploaded.body.attachment.id },
  });
  assert.equal(second.status, 422);
  assert.ok(second.body.errors.attachmentFileId);
});
