// Submission + file must-pass negatives (CLAUDE.md §14): the trust boundary
// where untrusted bytes enter — a dynamic form payload and an uploaded file.
//
// Like the workflow suite, nothing here hardcodes a field id or a service key:
// the payloads are derived from the stored field_schema at runtime, so these
// tests hold for any seeded sector.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { setup, stopServer, api, apiUrl, login, loginAll, SEED_PASSWORD } = require('../testlib/harness');

let tok;
let svc;        // a service the resident may submit to
let fields;     // its request-form field_schema

// Multipart isn't worth a helper in harness.js until a second suite uploads.
// ponytail: local uploader; move to harness if another suite needs it.
async function upload(token, filename, bytes, type = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const res = await fetch(apiUrl(`/files`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'); // a real PE header

// The smallest payload that satisfies every required field, so a negative test
// changes exactly one thing and the 422 can only come from that change.
function validResponse() {
  const out = {};
  for (const f of fields) {
    if (!f.required) continue;
    switch (f.type) {
      case 'number': out[f.id] = f.min ?? 1; break;
      case 'date': out[f.id] = '2026-07-18'; break;
      case 'checkbox': out[f.id] = true; break;
      case 'dropdown':
      case 'radio': out[f.id] = f.options[0].value; break;
      case 'location': out[f.id] = { lat: 32.22, lng: 35.26 }; break;
      case 'photo': out[f.id] = null; break; // filled per-test where it matters
      default: out[f.id] = 'x'.repeat(Math.max(f.min ?? 1, 1));
    }
  }
  return out;
}

before(async () => {
  await setup('submission');
  tok = await loginAll();

  const cat = await api('GET', '/services', { token: tok.resident });
  assert.equal(cat.status, 200);
  svc = cat.body.services.find((s) => s.acceptsExternalUsers);
  assert.ok(svc, 'seed offers a service the resident can submit to');

  const form = await api('GET', `/services/${svc.id}/forms/request`, { token: tok.resident });
  assert.equal(form.status, 200);
  fields = form.body.fields;
});

after(stopServer);

describe('the dynamic form is validated server-side, per field', () => {
  test('the derived baseline payload is actually accepted', async () => {
    // Guards every negative below: if the baseline were invalid, each 422
    // would pass for the wrong reason.
    const res = await api('POST', '/requests', {
      token: tok.resident,
      body: { serviceTypeId: svc.id, formResponse: validResponse() },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test('a field id that is not in the schema is 422', async () => {
    const res = await api('POST', '/requests', {
      token: tok.resident,
      body: { serviceTypeId: svc.id, formResponse: { ...validResponse(), not_a_field: 'x' } },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.errors.not_a_field, 'the error is keyed by the offending field id');
  });

  test('a missing required field is 422, keyed by that field', async () => {
    const required = fields.find((f) => f.required);
    assert.ok(required, 'seed form has a required field');
    const body = validResponse();
    delete body[required.id];
    const res = await api('POST', '/requests', {
      token: tok.resident,
      body: { serviceTypeId: svc.id, formResponse: body },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.errors[required.id]);
  });

  test('a value outside the schema bounds is 422', async () => {
    const numeric = fields.find((f) => f.type === 'number' && f.max !== null && f.max !== undefined);
    const choice = fields.find((f) => f.options && f.options.length);
    const field = numeric || choice;
    assert.ok(field, 'seed form has a bounded or option-backed field');
    const res = await api('POST', '/requests', {
      token: tok.resident,
      body: {
        serviceTypeId: svc.id,
        formResponse: { ...validResponse(), [field.id]: numeric ? field.max + 1 : 'not-an-option' },
      },
    });
    assert.equal(res.status, 422);
    assert.ok(res.body.errors[field.id]);
  });

  test('an employee cannot submit a request at all', async () => {
    const res = await api('POST', '/requests', {
      token: tok.worksField,
      body: { serviceTypeId: svc.id, formResponse: validResponse() },
    });
    assert.equal(res.status, 403);
  });
});

describe('a service that does not accept external users', () => {
  let internalId;

  before(async () => {
    // Onboarded through the config API rather than hand-written SQL — which is
    // also the thesis check: a new sector, zero code change.
    const label = (en, ar) => ({ en, ar });
    const res = await api('POST', '/config/services', {
      token: tok.admin,
      body: {
        service: {
          key: 'internal_only_test',
          name: label('Internal Only', 'داخلي فقط'),
          accepts_external_users: false,
          department: { name: label('Public Works', 'الأشغال العامة') },
        },
        workflow: {
          initial_status: 'new',
          statuses: [
            { key: 'new', label: label('New', 'جديد') },
            { key: 'done', label: label('Done', 'منجز'), is_terminal: true },
          ],
          transitions: [
            {
              key: 'finish',
              from: 'new',
              to: 'done',
              label: label('Finish', 'إنهاء'),
              actor: 'assignee',
            },
          ],
        },
        forms: {
          request: [{ id: 'note', label: label('Note', 'ملاحظة'), type: 'text', required: true }],
          completion: [{ id: 'result', label: label('Result', 'النتيجة'), type: 'text', required: true }],
        },
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    internalId = res.body.serviceTypeId;
  });

  test('is hidden from the external catalogue', async () => {
    const cat = await api('GET', '/services', { token: tok.resident });
    assert.equal(cat.status, 200);
    assert.ok(!cat.body.services.some((s) => s.id === internalId));
  });

  test('refuses a user submission with 403, not just a hidden button', async () => {
    const res = await api('POST', '/requests', {
      token: tok.resident,
      body: { serviceTypeId: internalId, formResponse: { note: 'let me in' } },
    });
    assert.equal(res.status, 403);
  });

  test('a duplicate service key never creates a second row', async () => {
    const res = await api('POST', '/config/services', {
      token: tok.admin,
      body: { service: { key: 'internal_only_test' } },
    });
    // Top-level shape is validated before the key, so a bare body is 422; a
    // full duplicate body is 409. Either way there is still exactly one row.
    assert.ok([409, 422].includes(res.status));
    const list = await api('GET', '/config/services', { token: tok.admin });
    assert.equal(list.body.services.filter((s) => s.key === 'internal_only_test').length, 1);
  });
});

describe('uploads are judged by their bytes, not their name', () => {
  test('an executable renamed .jpg is rejected', async () => {
    const res = await upload(tok.resident, 'totally-a-photo.jpg', EXE);
    assert.equal(res.status, 422);
    assert.ok(res.body.errors.file);
  });

  test('a file over 5 MB is rejected', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(tok.resident, 'huge.jpg', big);
    assert.equal(res.status, 422);
    assert.ok(res.body.errors.file);
  });

  test('a genuine JPEG is accepted', async () => {
    const res = await upload(tok.resident, 'pothole.jpg', JPEG);
    assert.equal(res.status, 201);
    assert.equal(res.body.attachment.mimeType, 'image/jpeg');
  });

  test('an employee cannot create a pending upload', async () => {
    const res = await upload(tok.worksField, 'x.jpg', JPEG);
    assert.equal(res.status, 403);
  });
});

describe("downloading someone else's file", () => {
  let fileId;
  let strangerToken;

  before(async () => {
    const up = await upload(tok.resident, 'private.jpg', JPEG);
    assert.equal(up.status, 201);
    fileId = up.body.attachment.id;

    const reg = await api('POST', '/auth/register', {
      body: { name: 'Nosy Neighbour', email: 'nosy@example.com', password: SEED_PASSWORD },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    strangerToken = await login('nosy@example.com');
  });

  test('is 404 for another user, never 403', async () => {
    const res = await api('GET', `/files/${fileId}`, { token: strangerToken });
    assert.equal(res.status, 404);
  });

  test('is 404 for an unassigned employee too', async () => {
    const res = await api('GET', `/files/${fileId}`, { token: tok.worksField });
    assert.equal(res.status, 404);
  });

  test('a non-existent id is the same 404 — ids cannot be probed', async () => {
    const res = await api('GET', '/files/00000000-0000-4000-8000-000000000000', {
      token: tok.resident,
    });
    assert.equal(res.status, 404);
  });

  test('the uploader can still fetch their own pending file', async () => {
    const res = await fetch(apiUrl(`/files/${fileId}`), {
      headers: { Authorization: `Bearer ${tok.resident}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^attachment;/);
  });
});

describe('CSV export is capability-gated', () => {
  test('a field employee is refused', async () => {
    const res = await api('GET', '/reports/export.csv', { token: tok.worksField });
    assert.equal(res.status, 403);
  });

  test('a user is refused', async () => {
    const res = await api('GET', '/reports/export.csv', { token: tok.resident });
    assert.equal(res.status, 403);
  });

  test('a capable head gets a CSV', async () => {
    const res = await api('GET', '/reports/export.csv', { token: tok.worksHead });
    assert.equal(res.status, 200);
  });
});
