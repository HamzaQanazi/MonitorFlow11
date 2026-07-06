// Departments (Section 7). Read-only — writes are seed-only. Monitor (the
// Employees Management picker) + admin (spec v4: the service-creation picker).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('monitor', 'admin'));

// GET /departments — admin sees all; a monitor sees only their own (spec v4
// department scoping), which keeps every department picker in the monitor UI
// correct without any client-side filtering.
router.get('/', async (req, res, next) => {
  try {
    const { rows } =
      req.user.role === 'admin'
        ? await pool.query('SELECT id, name FROM department ORDER BY name')
        : await pool.query('SELECT id, name FROM department WHERE id = $1', [
            req.user.department_id,
          ]);
    res.json({ departments: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
