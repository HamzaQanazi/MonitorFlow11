// Pure unit test for the auto-assign ranking formula (lib/autoAssign.js).
// No DB/server needed — the weighting math is a pure function of the rows
// the SQL query would return, same style as the form/workflow validator
// unit tests (CLAUDE.md §14).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankCandidates } = require('../src/lib/autoAssign');

test('no history anywhere: falls back to least-loaded, ties broken by id', () => {
  const rows = [
    { id: 3, open_count: 1, avg_resolution_minutes: null, reopen_rate: null },
    { id: 1, open_count: 0, avg_resolution_minutes: null, reopen_rate: null },
    { id: 2, open_count: 0, avg_resolution_minutes: null, reopen_rate: null },
  ];
  assert.equal(rankCandidates(rows).id, 1);
});

test('a high reopen rate outweighs a lower open load', () => {
  const rows = [
    // More load, but a clean track record.
    { id: 1, open_count: 3, avg_resolution_minutes: 60, reopen_rate: 0 },
    // Least loaded, but everything they finish gets reopened.
    { id: 2, open_count: 0, avg_resolution_minutes: 60, reopen_rate: 1 },
  ];
  assert.equal(rankCandidates(rows).id, 1);
});

test('faster average resolution wins when load and reopen rate are tied', () => {
  const rows = [
    { id: 1, open_count: 2, avg_resolution_minutes: 500, reopen_rate: 0.1 },
    { id: 2, open_count: 2, avg_resolution_minutes: 20, reopen_rate: 0.1 },
  ];
  assert.equal(rankCandidates(rows).id, 2);
});

test('a candidate with no track record yet is judged on load alone against it', () => {
  const rows = [
    // Proven track record but currently the most loaded.
    { id: 1, open_count: 5, avg_resolution_minutes: 30, reopen_rate: 0 },
    // Brand new hire: no completions yet, but currently unloaded.
    { id: 2, open_count: 0, avg_resolution_minutes: null, reopen_rate: null },
  ];
  assert.equal(rankCandidates(rows).id, 2);
});
