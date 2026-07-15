// Gate 1 (capabilities): the fixed vocabulary of guarded actions. A LEVEL grants
// a subset; an endpoint requires one via requireCapability(). Capability keys are
// never status keys or role names. Admin authority is by KIND
// (requireRole('admin')), not capability — admins configure the platform, they
// do not operate the queue (CLAUDE.md §10, must-pass #20).
const CAPABILITIES = ['view_all', 'assign', 'set_priority', 'override', 'manage_employees', 'export'];

// The capability set an employee holds through their level. Non-employees, and
// employees without a level, hold none.
async function loadCapabilities(user, db) {
  if (user.role !== 'employee' || !user.level_id) return new Set();
  const { rows } = await db.query(
    'SELECT capability_key FROM level_capability WHERE level_id = $1',
    [user.level_id]
  );
  return new Set(rows.map((r) => r.capability_key));
}

// An oversight employee is the two-gate replacement for the old `monitor`
// role: an employee whose level grants `view_all`. Everywhere the code used to
// ask `role === 'monitor'` it now asks isOversight(user); in the workflow
// engine such a user acts as the workflow's `monitor` actor (Phase 4 renames
// allowed_role → required_capability and retires this shim).
function isOversight(user) {
  return user.role === 'employee' && user.capabilities instanceof Set && user.capabilities.has('view_all');
}

module.exports = { CAPABILITIES, loadCapabilities, isOversight };
