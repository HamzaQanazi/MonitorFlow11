// Departments (Section 7). Read-only — writes are seed-only. Monitor (the
// Employees Management picker) + admin (spec v4: the service-creation picker).
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
// Read-only reference data for two pickers: the admin's service-creation form
// (all departments) and an oversight employee's Employees Management page
// (their own). Gate on admin kind OR the view_all capability.
router.use((req, res, next) => {
  if (req.user.role === 'admin' || (req.user.capabilities && req.user.capabilities.has('view_all'))) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
});

// GET /departments — admin sees all; an oversight employee sees only their own
// department, which keeps every department picker correct without client-side
// filtering.
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
