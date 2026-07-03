// Employees (monitor only, Section 7). Week 4 needs only the read list —
// the assignment UI's employee picker. POST/PATCH/activate/deactivate/
// reset-password land in Week 6.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('monitor'));

// GET /employees?departmentId=&q=
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (q.departmentId !== undefined && !Number.isInteger(Number(q.departmentId))) bad.push('departmentId');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = ["u.role = 'employee'"];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (q.departmentId !== undefined) add('u.department_id = ?', Number(q.departmentId));
    if (q.q) add('(u.name ILIKE ? OR u.email ILIKE ?)', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active,
              u.department_id, d.name AS department_name,
              COUNT(*) OVER()::int AS total
       FROM users u
       JOIN department d ON d.id = u.department_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      employees: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        isActive: r.is_active,
        departmentId: r.department_id,
        departmentName: r.department_name,
      })),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
