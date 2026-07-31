// Employee levels — read-only, mirrors departments.js exactly. Backs the Add
// Employee "role" picker (level = the real Gate-1 lever, not a free-text
// title). Level *authoring* stays seed-only for now (seed.js) — a levels
// management UI is out of scope here, same reasoning as the wizard's other
// "record now, build the module later" pieces.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireCapabilityOrAdmin('manage_employees'));

// GET /employee-levels
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM employee_level ORDER BY id');
    res.json({ levels: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
