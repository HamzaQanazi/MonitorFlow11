// Unit tests for seed-time field_schema validation (CLAUDE.md Section 8 +
// v5 amendment: location type, max one per form).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateFieldSchema } = require('../src/lib/formSchema');

const L = (en, ar) => ({ en, ar });

test('location field is accepted', () => {
  const errors = validateFieldSchema([
    { id: 'visit_location', label: L('Visit location', 'موقع الزيارة'), type: 'location', required: true },
  ]);
  assert.deepEqual(errors, []);
});

test('English-only label is rejected (Phase 3 bilingual rule)', () => {
  const errors = validateFieldSchema([
    { id: 'x', label: 'English only', type: 'text' },
  ]);
  assert.ok(errors.some((e) => /label must be a \{en, ar\}/.test(e)));
});

test('location: options forbidden', () => {
  const errors = validateFieldSchema([
    { id: 'spot', label: 'Spot', type: 'location', options: [{ value: 'a', label: 'A' }] },
  ]);
  assert.ok(errors.some((e) => /options are forbidden/.test(e)));
});

test('location: min/max forbidden', () => {
  const errors = validateFieldSchema([
    { id: 'spot', label: 'Spot', type: 'location', min: 1, max: 2 },
  ]);
  assert.ok(errors.some((e) => /min is not allowed/.test(e)));
  assert.ok(errors.some((e) => /max is not allowed/.test(e)));
});

test('two location fields in one form rejected', () => {
  const errors = validateFieldSchema([
    { id: 'a', label: 'A', type: 'location' },
    { id: 'b', label: 'B', type: 'location' },
  ]);
  assert.ok(errors.some((e) => /at most one location field/.test(e)));
});

test('one location field alongside other types stays valid', () => {
  const errors = validateFieldSchema([
    { id: 'desc', label: L('Description', 'الوصف'), type: 'multiline', required: true, max: 1000 },
    { id: 'spot', label: L('Spot', 'المكان'), type: 'location', required: false },
  ]);
  assert.deepEqual(errors, []);
});

test('unknown type still rejected', () => {
  const errors = validateFieldSchema([{ id: 'x', label: 'X', type: 'geopoint' }]);
  assert.ok(errors.some((e) => /invalid type/.test(e)));
});
