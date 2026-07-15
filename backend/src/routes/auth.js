const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { loadCapabilities } = require('../lib/capabilities');

const router = express.Router();

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

function publicUser(row, capabilities) {
  const { id, name, email, role, phone, department_id, login_identifier } = row;
  return {
    id, name, email, role, phone,
    departmentId: department_id,
    loginIdentifier: login_identifier,
    // Two-gate model: clients read capabilities to show/hide oversight surfaces
    // (the server still enforces every one — Gate 1). Absent = none.
    capabilities: capabilities ? [...capabilities] : [],
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

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
      // email (employees get EMP-xxxx ids at seed/creation time instead).
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
    // EMP-xxxx id — both stored in login_identifier. `email` still accepted for
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
    res.json({ token: signToken(user), user: publicUser(user, capabilities) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user, req.user.capabilities) });
});

module.exports = router;
