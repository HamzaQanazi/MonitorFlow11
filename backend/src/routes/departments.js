// Departments (Section 7). Read-only — writes are seed-only. Monitor (the
// Employees Management picker) + admin (spec v4: the service-creation picker).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('monitor', 'admin'));

// GET /departments
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM department ORDER BY name');
    res.json({ departments: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
