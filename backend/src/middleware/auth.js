const jwt = require('jsonwebtoken');
const pool = require('../db');

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
    'SELECT id, name, email, role, phone, department_id, is_active FROM users WHERE id = $1',
    [payload.sub]
  );
  if (!rows.length || !rows[0].is_active) {
    return res.status(401).json({ error: 'Account is not active' });
  }

  req.user = rows[0];
  next();
}

// Role gate (403, not 404 — Section 7 status-code table). Ownership checks
// stay in the routes; a role check alone is never sufficient for "own only".
function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { requireAuth, requireRole };
