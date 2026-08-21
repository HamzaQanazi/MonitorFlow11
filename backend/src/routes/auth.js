const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loadCapabilities } = require('../lib/capabilities');
const { withTx } = require('../lib/audit');
const { sendMail } = require('../lib/mailer');

const router = express.Router();

// Same uploads dir files.js writes to — read-only here, just to inline the
// company logo as a data URI on the authenticated user payload (see below).
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

function rateLimitLogin(req, res, next) {
  const identifier = req.body.identifier || req.body.email || '';
  const key = `${identifier.toLowerCase()}|${req.ip}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return next();
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts, try again later' });
  }
  entry.count += 1;
  next();
}

function publicUser(row, capabilities, company = { onboardingCompleted: null, companyName: null, companyFeatures: [] }) {
  const { id, name, email, role, phone, department_id, login_identifier } = row;
  return {
    id, name, email, role, phone,
    departmentId: department_id,
    loginIdentifier: login_identifier,
    // Two-gate model: clients read capabilities to show/hide oversight surfaces
    // (the server still enforces every one — Gate 1). Absent = none.
    capabilities: capabilities ? [...capabilities] : [],
    // First-login gate: the Owner (admin) whose company hasn't been onboarded
    // yet is routed to the "Customize your app" wizard, not the dashboard. null
    // for accounts with no company (self-registered users).
    onboardingCompleted: company.onboardingCompleted,
    // The console wordmark falls back to the build-time brand default until
    // these are set (both NULL until the onboarding PATCH writes them).
    companyName: company.companyName,
    companyLogo: company.companyLogo,
    // The onboarding wizard's step-4 feature picks — the client filters nav/
    // routes on this the same way it already does on capabilities (I4); the
    // server is still the one enforcing it (requireFeature, middleware/auth.js).
    companyFeatures: company.companyFeatures,
  };
}

// The company's onboarding flag, name and logo for a given account — null/null/
// null when the account isn't tied to a company. Used by /login and /me to
// drive the first-login gate and the post-onboarding wordmark. The logo is
// inlined as a data URI (not a URL) so the wordmark's <img> never needs its
// own authenticated request — GET /files/{id} is auth-gated per-file and would
// otherwise 404 for every console user except whoever uploaded it.
async function getCompanyInfo(companyId) {
  const empty = { onboardingCompleted: null, companyName: null, companyLogo: null, companyFeatures: [] };
  if (!companyId) return empty;
  const { rows } = await pool.query(
    'SELECT onboarding_completed, name, logo_file_id, features FROM company WHERE id = $1',
    [companyId]
  );
  if (!rows.length) return empty;
  let companyLogo = null;
  if (rows[0].logo_file_id) {
    const { rows: fa } = await pool.query(
      'SELECT mime_type, storage_path FROM file_attachment WHERE id = $1',
      [rows[0].logo_file_id]
    );
    if (fa.length) {
      try {
        const buf = await fs.promises.readFile(path.join(UPLOAD_DIR, fa[0].storage_path));
        companyLogo = `data:${fa[0].mime_type};base64,${buf.toString('base64')}`;
      } catch {
        companyLogo = null;
      }
    }
  }
  return {
    onboardingCompleted: rows[0].onboarding_completed,
    companyName: rows[0].name,
    companyLogo,
    companyFeatures: rows[0].features || [],
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

// Same shape as rateLimitLogin above — separate map/keying so a burst of
// forgot-password requests can't also lock someone out of logging in.
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const resetAttempts = new Map();

function rateLimitReset(req, res, next) {
  const identifier = (req.body || {}).identifier || '';
  const key = `${String(identifier).toLowerCase()}|${req.ip}`;
  const now = Date.now();
  const entry = resetAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    resetAttempts.set(key, { count: 1, resetAt: now + RESET_WINDOW_MS });
    return next();
  }
  if (entry.count >= RESET_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many requests, try again later' });
  }
  entry.count += 1;
  next();
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body || {};
    const errors = {};
    if (!name || typeof name !== 'string' || !name.trim()) errors.name = 'Name is required';
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'A valid email is required';
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const password_hash = await bcrypt.hash(password, 10);
    let rows;
    try {
      // Self-registration creates the `user` kind only; login_identifier is the
      // email (employees get an allocated 4-digit number at creation instead).
      ({ rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, phone, login_identifier)
         VALUES ($1, $2, $3, 'user', $4, $2)
         RETURNING id, name, email, role, phone, department_id, login_identifier`,
        [name.trim(), email.toLowerCase(), password_hash, phone || null]
      ));
    } catch (err) {
      if (err.code === '23505') {
        return res.status(422).json({ errors: { email: 'Email is already registered' } });
      }
      throw err;
    }

    const user = rows[0];
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', rateLimitLogin, async (req, res, next) => {
  try {
    // Generic login: users authenticate with their email, employees with an
    // 4-digit number — both stored in login_identifier. `email` still accepted for
    // back-compat with existing clients. Case-insensitive match.
    const identifier = (req.body || {}).identifier || (req.body || {}).email;
    const { password } = req.body || {};
    if (!identifier || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE lower(login_identifier) = lower($1)',
      [identifier]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(401).json({ error: 'Account is not active' });

    const capabilities = await loadCapabilities(user, pool);
    const company = await getCompanyInfo(user.company_id);
    res.json({ token: signToken(user), user: publicUser(user, capabilities, company) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const company = await getCompanyInfo(req.user.company_id);
  res.json({ user: publicUser(req.user, req.user.capabilities, company) });
});

// POST /auth/forgot-password — self-service reset (CLAUDE.md §13 re-scope,
// supervisor-directed, 2026-08-21). Accepts the same identifier used to log
// in (email for a `user`, the generated login email for an employee/admin)
// and, separately, resolves it to the account's real `email` column to send
// to — the two differ for employees (§4). Always the same response whether
// or not the identifier matched anything (no account enumeration, same
// reasoning as the documented register-enumeration limitation, §15, just
// actually closed here since a reset request is more sensitive than a
// registration collision).
router.post('/forgot-password', rateLimitReset, async (req, res, next) => {
  try {
    const identifier = (req.body || {}).identifier;
    if (!identifier || typeof identifier !== 'string') {
      return res.status(422).json({ errors: { identifier: 'Enter your login email or ID' } });
    }

    const { rows } = await pool.query(
      `SELECT id, name, first_name, email FROM users
       WHERE is_active AND (lower(login_identifier) = lower($1) OR lower(email) = lower($1))`,
      [identifier]
    );
    const user = rows[0];
    if (user && user.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      // Only one live token per user — a fresh request supersedes any
      // earlier, unused one rather than leaving multiple valid links around.
      await pool.query('DELETE FROM password_reset_token WHERE user_id = $1', [user.id]);
      await pool.query(
        'INSERT INTO password_reset_token (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS)]
      );
      const resetUrl = `${process.env.WEB_BASE_URL || 'http://localhost:5173'}/reset-password?token=${token}`;
      const who = user.first_name || user.name;
      await sendMail(user.email, 'Reset your MonitorFlow password / إعادة تعيين كلمة المرور', {
        en: `Hi ${who},\n\nSomeone requested a password reset for your MonitorFlow account. This link is valid for 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email — your password won't change.`,
        ar: `مرحبًا ${who}،\n\nتم طلب إعادة تعيين كلمة المرور لحسابك في MonitorFlow. هذا الرابط صالح لمدة ساعة واحدة:\n\n${resetUrl}\n\nإذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة — لن تتغيّر كلمة المرور.`,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /auth/reset-password — consumes the token from the emailed link.
// Single-use (used_at) and time-boxed (expires_at); a bad/expired/reused
// token is a 422 keyed the same way every other form-shaped rejection here
// is, not a distinct error family.
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body || {};
    const errors = {};
    if (!token || typeof token !== 'string') errors.token = 'Invalid or expired link';
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      `SELECT id, user_id FROM password_reset_token
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    if (!rows.length) return res.status(422).json({ errors: { token: 'Invalid or expired link' } });

    const password_hash = await bcrypt.hash(newPassword, 10);
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, rows[0].user_id]);
      await tx.query('UPDATE password_reset_token SET used_at = now() WHERE id = $1', [rows[0].id]);
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
