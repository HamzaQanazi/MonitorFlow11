// Shared department-head reassignment, used by both a manual Owner action
// (routes/departments.js PATCH /:id/head) and the automatic fallback when a
// head is deactivated (routes/employees.js). Keeping one function means both
// paths move the reporting tree the same way.
//
// Sets department.head_user_id, then re-points every OTHER current member of
// the department (by department_id) to report to the new head (manager_id) —
// this is what keeps Gate 2 oversight working under the new head with no
// manual fixup. `moveIntoDepartment` additionally pulls the new head's own
// department_id into this department; the manual reassignment does this
// (the Owner is deliberately placing them here), the automatic on-fire
// promotion does not (it's a minimal emergency fallback, not a relocation of
// whoever the fired head used to report to).
//
// 2026-08-21 incident: this is the write path that actually produced a live
// manager_id cycle in production data (scope.js's cycle guard is the
// defensive backstop, this is the fix at the source). Re-pointing every
// other department member at newHeadId creates a cycle iff newHeadId is
// currently a descendant of one of them — walk newHeadId's ancestor chain
// and refuse if it passes through anyone about to become their report.
const { ancestorIds } = require('./scope');

async function reassignDepartmentHead(tx, departmentId, newHeadId, { moveIntoDepartment }) {
  const { rows: members } = await tx.query(
    'SELECT id FROM users WHERE department_id = $1 AND id <> $2',
    [departmentId, newHeadId]
  );
  if (members.length) {
    const ancestors = new Set(await ancestorIds(newHeadId, tx));
    const cyclic = members.find((m) => ancestors.has(m.id));
    if (cyclic) {
      throw Object.assign(
        new Error(`Reassigning would create a reporting cycle through employee ${cyclic.id}`),
        { status: 409 }
      );
    }
  }

  await tx.query('UPDATE department SET head_user_id = $1 WHERE id = $2', [newHeadId, departmentId]);
  if (moveIntoDepartment) {
    await tx.query('UPDATE users SET department_id = $1 WHERE id = $2', [departmentId, newHeadId]);
  }
  await tx.query(
    'UPDATE users SET manager_id = $1 WHERE department_id = $2 AND id <> $1',
    [newHeadId, departmentId]
  );
}

module.exports = { reassignDepartmentHead };
