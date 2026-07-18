// The block arithmetic decides what an employee types to sign in, so it gets a
// unit check. The DB round trip is stubbed — what matters here is the block a
// department maps to, and that a full block reports "full" instead of colliding
// with the UNIQUE index.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocateEmployeeNumber, blockBase } = require('../src/lib/employeeNumber');

// Stand-in for a pg client: answers the advisory lock with nothing and the
// allocation query with whatever `taken` implies.
function fakeTx(taken = []) {
  const seen = new Set(taken.map(String));
  return {
    async query(sql, params) {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      const base = params[0];
      for (let n = base; n < base + 100; n += 1) {
        if (!seen.has(String(n))) return { rows: [{ n }] };
      }
      return { rows: [{ n: null }] };
    },
  };
}

test('each department gets its own block of 100, no department is the root block', () => {
  assert.equal(blockBase(null), 1000);
  assert.equal(blockBase(undefined), 1000);
  assert.equal(blockBase(1), 1100);
  assert.equal(blockBase(3), 1300);
});

test('allocates the lowest free number in the department block, as a string', async () => {
  assert.equal(await allocateEmployeeNumber(fakeTx(), 1), '1100');
  assert.equal(await allocateEmployeeNumber(fakeTx(['1100', '1101']), 1), '1102');
  // A gap left by an earlier hire is reused before the block grows.
  assert.equal(await allocateEmployeeNumber(fakeTx(['1100', '1102']), 1), '1101');
});

test('a full block returns null rather than colliding on the UNIQUE index', async () => {
  const full = Array.from({ length: 100 }, (_, i) => 1200 + i);
  assert.equal(await allocateEmployeeNumber(fakeTx(full), 2), null);
});

test('takes the transaction-scoped advisory lock before reading free numbers', async () => {
  const calls = [];
  const tx = {
    async query(sql, params) {
      calls.push(sql.includes('pg_advisory_xact_lock') ? 'lock' : 'select');
      return { rows: [{ n: params[0] }] };
    },
  };
  await allocateEmployeeNumber(tx, 1);
  assert.deepEqual(calls, ['lock', 'select']);
});
