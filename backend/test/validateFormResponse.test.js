// Unit tests for the form-validation function (CLAUDE.md Section 13:
// each type × required/bounds/options/unknown-key).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateFormResponse } = require('../src/lib/validateFormResponse');

const USER_ID = 7;
const OWNED_UUID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_UUID = '22222222-2222-4222-8222-222222222222';

// Stub matching the one query the validator issues against file_attachment.
const db = {
  query: async (sql, [id]) => {
    if (id === OWNED_UUID) return { rows: [{ uploaded_by: USER_ID }] };
    if (id === FOREIGN_UUID) return { rows: [{ uploaded_by: USER_ID + 1 }] };
    return { rows: [] };
  },
};

const ctx = { db, userId: USER_ID };

const fields = [
  { id: 'title', label: 'Title', type: 'text', required: true, min: 3, max: 10 },
  { id: 'story', label: 'Story', type: 'multiline', required: false, max: 5 },
  { id: 'rooms', label: 'Rooms', type: 'number', required: true, min: 1, max: 20 },
  { id: 'visit', label: 'Visit date', type: 'date', required: false },
  {
    id: 'pack',
    label: 'Package',
    type: 'dropdown',
    required: true,
    options: [{ value: 'std', label: 'Standard' }, { value: 'deep', label: 'Deep' }],
  },
  {
    id: 'slot',
    label: 'Slot',
    type: 'radio',
    required: false,
    options: [{ value: 'am', label: 'Morning' }, { value: 'pm', label: 'Afternoon' }],
  },
  { id: 'pets', label: 'Pets', type: 'checkbox', required: false },
  { id: 'pic', label: 'Photo', type: 'photo', required: false },
];

const validResponse = {
  title: 'Hello',
  rooms: 3,
  visit: '2026-07-15',
  pack: 'std',
  slot: 'pm',
  pets: true,
  pic: OWNED_UUID,
};

test('valid response including optional fields passes', async () => {
  assert.deepEqual(await validateFormResponse(fields, validResponse, ctx), {});
});

test('minimal response with optionals absent passes', async () => {
  const minimal = { title: 'Hey', rooms: 1, pack: 'deep' };
  assert.deepEqual(await validateFormResponse(fields, minimal, ctx), {});
});

test('non-object response is rejected', async () => {
  for (const bad of [null, 'x', 42, ['a']]) {
    const errors = await validateFormResponse(fields, bad, ctx);
    assert.ok(errors._form);
  }
});

test('unknown keys are rejected and keyed by the unknown key', async () => {
  const errors = await validateFormResponse(fields, { ...validResponse, extra: 1 }, ctx);
  assert.deepEqual(errors, { extra: 'Unknown field' });
});

test('missing required fields error per field; empty string counts as missing', async () => {
  const errors = await validateFormResponse(fields, { title: '' }, ctx);
  assert.equal(errors.title, 'Title is required');
  assert.equal(errors.rooms, 'Rooms is required');
  assert.equal(errors.pack, 'Package is required');
  assert.equal(errors.story, undefined);
});

test('text: wrong type and length bounds', async () => {
  let errors = await validateFormResponse(fields, { ...validResponse, title: 5 }, ctx);
  assert.match(errors.title, /must be text/);
  errors = await validateFormResponse(fields, { ...validResponse, title: 'ab' }, ctx);
  assert.match(errors.title, /at least 3/);
  errors = await validateFormResponse(fields, { ...validResponse, title: 'x'.repeat(11) }, ctx);
  assert.match(errors.title, /at most 10/);
});

test('multiline: max length bound', async () => {
  const errors = await validateFormResponse(fields, { ...validResponse, story: 'toolong' }, ctx);
  assert.match(errors.story, /at most 5/);
});

test('number: type, NaN, and value bounds', async () => {
  let errors = await validateFormResponse(fields, { ...validResponse, rooms: '3' }, ctx);
  assert.match(errors.rooms, /must be a number/);
  errors = await validateFormResponse(fields, { ...validResponse, rooms: NaN }, ctx);
  assert.match(errors.rooms, /must be a number/);
  errors = await validateFormResponse(fields, { ...validResponse, rooms: 0 }, ctx);
  assert.match(errors.rooms, /at least 1/);
  errors = await validateFormResponse(fields, { ...validResponse, rooms: 21 }, ctx);
  assert.match(errors.rooms, /at most 20/);
});

test('date: format and calendar validity', async () => {
  for (const bad of ['15/07/2026', '2026-7-15', '2026-02-30', 20260715]) {
    const errors = await validateFormResponse(fields, { ...validResponse, visit: bad }, ctx);
    assert.match(errors.visit, /valid date/);
  }
});

test('dropdown and radio: option membership', async () => {
  let errors = await validateFormResponse(fields, { ...validResponse, pack: 'bogus' }, ctx);
  assert.match(errors.pack, /one of the listed options/);
  errors = await validateFormResponse(fields, { ...validResponse, slot: 'noon' }, ctx);
  assert.match(errors.slot, /one of the listed options/);
});

test('checkbox: must be boolean', async () => {
  const errors = await validateFormResponse(fields, { ...validResponse, pets: 'yes' }, ctx);
  assert.match(errors.pets, /true or false/);
});

test('photo: malformed id, nonexistent id, and foreign owner all rejected', async () => {
  for (const bad of ['not-a-uuid', '33333333-3333-4333-8333-333333333333', FOREIGN_UUID]) {
    const errors = await validateFormResponse(fields, { ...validResponse, pic: bad }, ctx);
    assert.match(errors.pic, /uploaded attachment/);
  }
});

test('multiple failures report per-field simultaneously', async () => {
  const errors = await validateFormResponse(
    fields,
    { title: 'okay', rooms: 99, pack: 'bogus', mystery: 1 },
    ctx
  );
  assert.equal(Object.keys(errors).length, 3);
  assert.ok(errors.rooms && errors.pack && errors.mystery);
});
