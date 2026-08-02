// Branches (Section 6/7). Read-only for now — branches are created only by
// the onboarding wizard (routes/onboarding.js); this exists so the
// Departments page can populate a branch picker. Same read gate as
// /departments: admin or an oversight employee (view_all).
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    if (req.user.role !== 'admin' && !(req.user.capabilities && req.user.capabilities.has('view_all'))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { rows } = await pool.query(
      'SELECT id, name FROM branch WHERE company_id = $1 ORDER BY name',
      [req.user.company_id]
    );
    res.json({ branches: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
