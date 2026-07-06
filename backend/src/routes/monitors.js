// Monitors (admin only, spec v4 Sections A/F — docs/spec_v4_amendment.md).
// Mirrors the employees surface one level up: admin manages monitor accounts,
// monitors manage employees. Every write logs an AUDIT_EVENT in the same
// transaction (Section C).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

function publicMonitor(r) {
  return { id: r.id, name: r.name, email: r.email, phone: r.phone, isActive: r.is_active };
}

// A missing id OR a non-monitor user must look nonexistent on this
// admin-facing surface → 404 (the 404-over-403 rule).
async function loadMonitor(id) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, is_active FROM users WHERE id = $1 AND role = 'monitor'`,
    [id]
  );
  return rows[0] || null;
}

// GET /monitors?q=
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = ["role = 'monitor'"];
    const params = [];
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }
    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, is_active, COUNT(*) OVER()::int AS total
       FROM users
       WHERE ${where.join(' AND ')}
       ORDER BY name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      monitors: rows.map(publicMonitor),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

// POST /monitors — create a monitor; admin sets the initial password.
router.post('/', async (req, res, next) => {
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
    let created;
    try {
      created = await withTx(async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO users (name, email, password_hash, role, phone)
           VALUES ($1, $2, $3, 'monitor', $4)
           RETURNING id, name, email, phone, is_active`,
          [name.trim(), email.toLowerCase(), password_hash, phone || null]
        );
        await logAudit(tx, req.user.id, 'monitor.created', 'user', rows[0].id, { email: rows[0].email });
        return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') return res.status(422).json({ errors: { email: 'Email is already registered' } });
      throw err;
    }
    res.status(201).json({ monitor: publicMonitor(created) });
  } catch (err) {
    next(err);
  }
});

// PATCH /monitors/{id} — edit name / phone
router.patch('/:id', async (req, res, next) => {
  try {
    const mon = await loadMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'Not found' });

    const { name, phone } = req.body || {};
    const errors = {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) errors.name = 'Name cannot be empty';
    if (phone !== undefined && phone !== null && typeof phone !== 'string') errors.phone = 'Phone must be text';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    await withTx(async (tx) => {
      await tx.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           phone = CASE WHEN $2::boolean THEN $3 ELSE phone END
         WHERE id = $4`,
        [
          name === undefined ? null : name.trim(),
          phone !== undefined,
          phone === undefined ? null : phone,
          mon.id,
        ]
      );
      await logAudit(tx, req.user.id, 'monitor.updated', 'user', mon.id, {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
      });
    });
    res.json({ monitor: publicMonitor(await loadMonitor(mon.id)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /monitors/{id}/activate
router.patch('/:id/activate', async (req, res, next) => {
  try {
    const mon = await loadMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'Not found' });
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET is_active = TRUE WHERE id = $1', [mon.id]);
      await logAudit(tx, req.user.id, 'monitor.activated', 'user', mon.id);
    });
    res.json({ monitor: publicMonitor({ ...mon, is_active: true }) });
  } catch (err) {
    next(err);
  }
});

// PATCH /monitors/{id}/deactivate — the last ACTIVE monitor cannot be
// deactivated (409, spec v4 must-pass #23): operations always need someone
// at the board.
router.patch('/:id/deactivate', async (req, res, next) => {
  try {
    const mon = await loadMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'Not found' });

    const others = await pool.query(
      `SELECT 1 FROM users WHERE role = 'monitor' AND is_active AND id <> $1 LIMIT 1`,
      [mon.id]
    );
    if (!others.rows.length) {
      return res.status(409).json({ error: 'Cannot deactivate the last active monitor' });
    }

    await withTx(async (tx) => {
      await tx.query('UPDATE users SET is_active = FALSE WHERE id = $1', [mon.id]);
      await logAudit(tx, req.user.id, 'monitor.deactivated', 'user', mon.id);
    });
    res.json({ monitor: publicMonitor({ ...mon, is_active: false }) });
  } catch (err) {
    next(err);
  }
});

// PATCH /monitors/{id}/reset-password — server-generated temp password,
// returned once (no forced-change flow — documented MVP limitation). Never
// logged to the audit trail.
router.patch('/:id/reset-password', async (req, res, next) => {
  try {
    const mon = await loadMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'Not found' });
    const tempPassword = `Temp-${crypto.randomBytes(6).toString('base64url')}`;
    const password_hash = await bcrypt.hash(tempPassword, 10);
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, mon.id]);
      await logAudit(tx, req.user.id, 'monitor.password_reset', 'user', mon.id);
    });
    res.json({ tempPassword });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
