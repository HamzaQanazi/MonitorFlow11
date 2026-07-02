const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map();

function rateLimitLogin(req, res, next) {
  const key = `${(req.body.email || '').toLowerCase()}|${req.ip}`;
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

function publicUser(row) {
  const { id, name, email, role, phone, department_id } = row;
  return { id, name, email, role, phone, departmentId: department_id };
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
      ({ rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, phone)
         VALUES ($1, $2, $3, 'user', $4)
         RETURNING id, name, email, role, phone, department_id`,
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
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(401).json({ error: 'Account is not active' });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
