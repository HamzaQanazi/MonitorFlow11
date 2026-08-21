// Unit test for lib/csv.js — no DB/server needed, pure parsing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects } = require('../src/lib/csv');

test('parses plain comma-separated rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('handles quoted fields with embedded commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('name,note\n"Doe, Jane","She said ""hi"""\n'), [
    ['name', 'note'],
    ['Doe, Jane', 'She said "hi"'],
  ]);
});

test('handles CRLF line endings and a missing trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('csvToObjects keys by lowercased header, header-only file is empty', () => {
  assert.deepEqual(csvToObjects('firstName,lastName\nJane,Doe\n'), [{ firstname: 'Jane', lastname: 'Doe' }]);
  assert.deepEqual(csvToObjects('firstName,lastName\n'), []);
  assert.deepEqual(csvToObjects(''), []);
});

test('csvToObjects pads a short row with empty strings', () => {
  assert.deepEqual(csvToObjects('a,b,c\n1\n'), [{ a: '1', b: '', c: '' }]);
});
