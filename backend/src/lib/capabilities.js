// Gate 1 (capabilities): the fixed vocabulary of guarded actions. A LEVEL grants
// a subset; an endpoint requires one via requireCapability(). Capability keys are
// never status keys or role names. Admin authority is by KIND
// (requireRole('admin')), not capability — admins configure the platform, they
// do not operate the queue (CLAUDE.md §10, must-pass #20).
// manage_events/manage_knowledge_base (Levels & Capabilities live editor) let
// a level author just that module without also holding view_all's
// operational oversight — see routes/events.js et al.
// view_all_company (added 2026-09-04, user-directed): the one capability that
// widens Gate 2 (scope) itself rather than gating an action within it. Every
// other capability here is a Gate-1 grant, orthogonal to scope — an employee
// with all of them still only reaches their own department (flat scope,
// scope.js). This one is different: a level holding it makes its employees'
// scope the whole company, the same "operational, not admin" reach a General
// Manager needs — someone who works requests/tasks like any employee (unlike
// the Owner, who holds no capabilities and doesn't operate the queue, I2) but
// needs company-wide reach, not just their own department's. Orthogonal to
// view_all like any other pair of capabilities: it widens WHERE an employee's
// authority reaches, view_all widens WHAT they can see once there — hold only
// this one and Gate 1 still limits you to your own resources across a huge
// scope; hold both for real oversight of the whole company.
const CAPABILITIES = [
  'view_all',
  'assign',
  'set_priority',
  'override',
  'manage_employees',
  'export',
  'manage_events',
  'manage_knowledge_base',
  'view_all_company',
];

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
