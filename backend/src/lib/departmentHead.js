// Shared department-head reassignment, used by both a manual Owner action
// (routes/departments.js PATCH /:id/head) and the automatic on-deactivation
// check in routes/employees.js. Keeping one function means both paths agree
// on what "reassigning the head" means.
//
// Sets department.head_user_id. That's purely display metadata now (re-
// scoped, user-directed: `users.manager_id` and the reporting-tree it powered
// are gone — Gate 2 scope is flat department membership, §6/lib/scope.js), so
// there's no cycle risk left to guard against and no other member's row to
// re-point. `moveIntoDepartment` additionally pulls the new head's own
// department_id into this department; the manual reassignment does this (the
// Owner is deliberately placing them here), the on-deactivation fallback does
// not apply (deactivation now just refuses outright — see employees.js).
async function reassignDepartmentHead(tx, departmentId, newHeadId, { moveIntoDepartment }) {
  await tx.query('UPDATE department SET head_user_id = $1 WHERE id = $2', [newHeadId, departmentId]);
  if (moveIntoDepartment) {
    await tx.query('UPDATE users SET department_id = $1 WHERE id = $2', [departmentId, newHeadId]);
  }
}

module.exports = { reassignDepartmentHead };
