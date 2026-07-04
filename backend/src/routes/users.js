// Users profile (Section 7). Own only, any role — every route acts on
// req.user. Email and role are identity, not editable here (email is unique;
// role changes happen only via seed / employee creation). Password change
// requires the current password (Section 6 row).
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function publicUser(row) {
  const { id, name, email, role, phone, department_id } = row;
  return { id, name, email, role, phone, departmentId: department_id };
}

// GET /users/me — same shape as GET /auth/me
router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

// PATCH /users/me — name and phone only
router.patch('/me', async (req, res, next) => {
  try {
    const { name, phone } = req.body || {};
    const errors = {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      errors.name = 'Name cannot be empty';
    }
    if (phone !== undefined && phone !== null && typeof phone !== 'string') {
      errors.phone = 'Phone must be text';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const { rows } = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           phone = CASE WHEN $2::boolean THEN $3 ELSE phone END
       WHERE id = $4
       RETURNING id, name, email, role, phone, department_id`,
      [
        name === undefined ? null : name.trim(),
        phone !== undefined, // whether to touch phone at all
        phone === undefined ? null : phone,
        req.user.id,
      ]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// PATCH /users/me/password — requires the current password
router.patch('/me/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const errors = {};
    if (!currentPassword || typeof currentPassword !== 'string') {
      errors.currentPassword = 'Current password is required';
    }
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const matches = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!matches) {
      return res.status(422).json({ errors: { currentPassword: 'Current password is incorrect' } });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
