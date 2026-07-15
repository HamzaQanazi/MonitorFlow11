const jwt = require('jsonwebtoken');
const pool = require('../db');
const { loadCapabilities } = require('../lib/capabilities');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // is_active is re-checked on every request (CLAUDE.md Section 3): a
  // deactivated account's still-valid JWT must stop working immediately.
  const { rows } = await pool.query(
    `SELECT id, name, email, role, phone, department_id, is_active,
            login_identifier, manager_id, level_id
     FROM users WHERE id = $1`,
    [payload.sub]
  );
  if (!rows.length || !rows[0].is_active) {
    return res.status(401).json({ error: 'Account is not active' });
  }

  req.user = rows[0];
  // Gate 1: the capability set this account holds through its level (empty for
  // users, field employees, and admins). Attached once per request so guards
  // and the workflow engine read it without re-querying.
  req.user.capabilities = await loadCapabilities(req.user, pool);
  next();
}

// Role gate (403, not 404 — Section 7 status-code table). Ownership checks
// stay in the routes; a role check alone is never sufficient for "own only".
// Accepts multiple roles (spec v4: some surfaces are monitor+admin).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Gate 1 guard: the actor's level must grant `capability` (403 otherwise).
// Replaces requireRole('monitor') on every oversight surface — authority now
// comes from the level, not a hardcoded role.
function requireCapability(capability) {
  return (req, res, next) => {
    if (!req.user.capabilities || !req.user.capabilities.has(capability)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireCapability };
