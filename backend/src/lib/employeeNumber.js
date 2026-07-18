// Employees log in with a 4-digit number, not an email: 1000 + department * 100
// gives each department a block of 100, and employees with no department (the
// org root) sit in 1000-1099. Admins and external `user` accounts keep their
// email as login_identifier — this is only for the `employee` kind.
//
// Migration 011 renumbered the accounts that already existed; this allocates for
// every hire after that.

// Lowest number in a department's block, i.e. the block's base.
function blockBase(departmentId) {
  return 1000 + (departmentId ?? 0) * 100;
}

// Allocate the lowest free number in the department's block. MUST be called
// inside a transaction: the advisory lock is transaction-scoped, and it is what
// stops two concurrent hires in the same department from picking the same free
// number (login_identifier is UNIQUE, so the loser would otherwise 500).
// Returns a string, or null when all 100 numbers in the block are taken.
async function allocateEmployeeNumber(tx, departmentId) {
  const base = blockBase(departmentId);
  await tx.query('SELECT pg_advisory_xact_lock($1)', [base]);
  const { rows } = await tx.query(
    `SELECT MIN(n) AS n
       FROM generate_series($1::int, $1::int + 99) n
      WHERE NOT EXISTS (
        SELECT 1 FROM users WHERE login_identifier = n::text
      )`,
    [base]
  );
  return rows[0].n === null ? null : String(rows[0].n);
}

module.exports = { allocateEmployeeNumber, blockBase };
