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
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.department_id, u.is_active,
            u.login_identifier, u.level_id, u.company_id,
            c.features AS company_features
     FROM users u
     LEFT JOIN company c ON c.id = u.company_id
     WHERE u.id = $1`,
    [payload.sub]
  );
  if (!rows.length || !rows[0].is_active) {
    return res.status(401).json({ error: 'Account is not active' });
  }

  req.user = rows[0];
  // The onboarding wizard's step-4 feature selection — independent of Gate 1/2,
  // checked by requireFeature() below. Empty for accounts with no company.
  req.user.companyFeatures = req.user.company_features || [];
  delete req.user.company_features;
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

// Same as requireCapability, but also admits the admin (Owner) — who holds no
// capabilities by design (I2). Precedent: departments.js already OR's these
// two checks inline; this is the shared version for routes that need it too.
// The handler is still expected to branch on req.user.role for data scope
// (admin sees company-wide, a capability holder sees their Gate-2 subtree).
// Accepts multiple capabilities (OR'd): requireCapabilityOrAdmin('view_all',
// 'manage_events') admits either a full-oversight level or a level scoped to
// just that one module — a narrow role doesn't need view_all's operational
// power just to author one thing.
function requireCapabilityOrAdmin(...capabilities) {
  return (req, res, next) => {
    if (
      req.user.role === 'admin' ||
      (req.user.capabilities && capabilities.some((c) => req.user.capabilities.has(c)))
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
}

// Feature gate: independent of Gate 1/2 (capability/subtree) — this is
// "does the company's deployment even have this module," from the
// onboarding wizard's step-4 feature picks (lib/onboardingOptions.js). No
// admin bypass: if the Owner didn't select it, the module doesn't exist for
// this deployment, including for the Owner (onboarding is one-shot — turning
// a feature on later is a direct row update for now, CLAUDE.md §15).
function requireFeature(featureKey) {
  return (req, res, next) => {
    if (!req.user.companyFeatures.includes(featureKey)) {
      return res.status(403).json({ error: 'This feature is not enabled for your company' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireCapability, requireCapabilityOrAdmin, requireFeature };
