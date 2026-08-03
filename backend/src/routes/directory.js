// Company directory (communication feature group, onboarding wizard). Unlike
// every other list in this app, this is deliberately NOT Gate-2 scoped — a
// directory's whole point is letting any employee find any colleague, not
// just their own subtree. Read-only: no capability required, just an
// authenticated admin/employee account (the `user` role — external
// submitters — gets 403; a directory of internal staff isn't their concern).
const express = require('express');
const pool = require('../db');
const { requireAuth, requireFeature } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('directory'));

// GET /directory?departmentId=&branchId=&q=&page=&pageSize=
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });

    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (q.departmentId !== undefined && !Number.isInteger(Number(q.departmentId))) bad.push('departmentId');
    if (q.branchId !== undefined && !Number.isInteger(Number(q.branchId))) bad.push('branchId');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = ["u.role IN ('admin', 'employee')", 'u.is_active = TRUE'];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    add('u.company_id = ?', req.user.company_id);
    if (q.departmentId !== undefined) add('u.department_id = ?', Number(q.departmentId));
    if (q.branchId !== undefined) add('d.branch_id = ?', Number(q.branchId));
    if (q.q) add('u.name ILIKE ?', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.phone, u.email, u.role,
              d.name AS department_name, b.name AS branch_name, l.name AS level_name
       FROM users u
       LEFT JOIN department d ON d.id = u.department_id
       LEFT JOIN branch b ON b.id = d.branch_id
       LEFT JOIN employee_level l ON l.id = u.level_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users u
       LEFT JOIN department d ON d.id = u.department_id
       WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );

    res.json({
      directory: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        isYou: r.id === req.user.id,
        departmentName: r.department_name,
        branchName: r.branch_name,
        levelName: r.level_name,
      })),
      page,
      pageSize,
      total: countRows[0].total,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
