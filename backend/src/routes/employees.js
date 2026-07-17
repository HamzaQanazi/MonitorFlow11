// Employees (monitor only, Section 7). Read list is the assignment picker;
// the writes (create/edit/activate/deactivate/reset-password/tasks) are the
// Employees Management page's backend.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { statusOf } = require('../lib/workflowEngine');
const { subtreeIds } = require('../lib/scope');
const { withTx, logAudit } = require('../lib/audit');

const router = express.Router();
router.use(requireAuth);
router.use(requireCapability('manage_employees'));

function publicEmployee(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    isActive: r.is_active,
    departmentId: r.department_id,
    departmentName: r.department_name,
  };
}

// Load an employee by id, joined to its department. Returns null for a
// missing id, a non-employee user, the actor themselves, OR (Gate 2) an
// employee outside the acting oversight actor's subtree — all look
// nonexistent → 404.
async function loadEmployee(id, actorId) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM users WHERE id = $2
       UNION ALL
       SELECT u.id FROM users u JOIN sub ON u.manager_id = sub.id
     )
     SELECT u.id, u.name, u.email, u.phone, u.is_active, u.department_id,
            d.name AS department_name
     FROM users u
     LEFT JOIN department d ON d.id = u.department_id
     WHERE u.id = $1 AND u.role = 'employee'
       AND u.id <> $2 AND u.id IN (SELECT id FROM sub)`,
    [id, actorId]
  );
  return rows[0] || null;
}

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
    // Gate 2: an oversight actor manages the staff inside their subtree only
    // (excluding themselves). The departmentId param narrows within that.
    add('u.id = ANY(?)', await subtreeIds(req.user.id));
    add('u.id <> ?', req.user.id);
    if (q.departmentId !== undefined) add('u.department_id = ?', Number(q.departmentId));
    if (q.q) add('(u.name ILIKE ? OR u.email ILIKE ?)', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    // openTaskCount (spec v4 E2, assignment suggestions): tasks whose current
    // status is non-final — finality read from the workflow data, no status
    // key in code (same mechanism as the deactivate guard below).
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active,
              u.department_id, d.name AS department_name,
              (SELECT COUNT(*)::int
               FROM task t
               JOIN request r ON r.id = t.request_id
               JOIN workflow_definition w ON w.service_type_id = r.service_type_id
               JOIN LATERAL jsonb_array_elements(w.statuses) s ON s->>'key' = t.status
               WHERE t.employee_id = u.id AND (s->>'is_terminal')::boolean = FALSE
              ) AS open_task_count,
              -- Avg minutes from request creation to its completion-form target
              -- status (§7, same "resolved" definition as the CSV export), over
              -- the requests this employee currently holds. Attribution follows
              -- task.employee_id, so a reassigned request counts for its final
              -- assignee (the documented reassignment limitation, §15). null
              -- when they've resolved nothing yet.
              -- ponytail: correlated per employee row — fine for a page of 20;
              -- push into a GROUP BY join if the employee list ever gets large.
              (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (comp.completed_at - r.created_at)) / 60))
               FROM task t
               JOIN request r ON r.id = t.request_id
               JOIN workflow_definition w ON w.service_type_id = r.service_type_id
               CROSS JOIN LATERAL (
                 SELECT MIN(h.changed_at) AS completed_at
                 FROM request_status_history h
                 WHERE h.request_id = r.id
                   AND h.status = (
                     SELECT tr->>'to' FROM jsonb_array_elements(w.transitions) tr
                     WHERE tr->>'required_form_key' IS NOT NULL
                     LIMIT 1
                   )
               ) comp
               WHERE t.employee_id = u.id AND comp.completed_at IS NOT NULL
              )::int AS avg_resolution_minutes,
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
        openTaskCount: r.open_task_count,
        avgResolutionMinutes: r.avg_resolution_minutes,
      })),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
    });
  } catch (err) {
    next(err);
  }
});

// POST /employees — create an employee; monitor sets the initial password.
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
    let inserted;
    try {
      // Gate 2: a new employee becomes a direct report of the creating oversight
      // actor (manager_id = actor) so it lands inside their subtree, and
      // inherits the actor's department. login_identifier is the email here
      // (seeded field techs get EMP-xxxx ids instead).
      inserted = await withTx(async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO users (name, email, password_hash, role, phone, department_id, manager_id, login_identifier)
           VALUES ($1, $2, $3, 'employee', $4, $5, $6, $2)
           RETURNING id, name, email, phone, is_active, department_id`,
          [name.trim(), email.toLowerCase(), password_hash, phone || null, req.user.department_id, req.user.id]
        );
        await logAudit(tx, req.user.id, 'employee.created', 'user', rows[0].id, { email: rows[0].email });
        return rows[0];
      });
    } catch (err) {
      if (err.code === '23505') return res.status(422).json({ errors: { email: 'Email is already registered' } });
      throw err;
    }
    const created = await loadEmployee(inserted.id, req.user.id);
    res.status(201).json({ employee: publicEmployee(created) });
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/{id} — edit name / phone / department
router.patch('/:id', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    const { name, phone, departmentId } = req.body || {};
    const errors = {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) errors.name = 'Name cannot be empty';
    if (phone !== undefined && phone !== null && typeof phone !== 'string') errors.phone = 'Phone must be text';
    if (departmentId !== undefined && !Number.isInteger(departmentId)) errors.departmentId = 'Invalid department';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    // Spec v4: an employee cannot be moved out of the monitor's department
    // (that would need an org-level actor; today no one has that power).
    if (departmentId !== undefined && departmentId !== req.user.department_id) {
      return res.status(422).json({ errors: { departmentId: 'Must be your own department' } });
    }

    await withTx(async (tx) => {
      await tx.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           phone = CASE WHEN $2::boolean THEN $3 ELSE phone END,
           department_id = COALESCE($4, department_id)
         WHERE id = $5`,
        [
          name === undefined ? null : name.trim(),
          phone !== undefined,
          phone === undefined ? null : phone,
          departmentId === undefined ? null : departmentId,
          emp.id,
        ]
      );
      await logAudit(tx, req.user.id, 'employee.updated', 'user', emp.id, {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(departmentId !== undefined ? { departmentId } : {}),
      });
    });
    res.json({ employee: publicEmployee(await loadEmployee(emp.id, req.user.id)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/{id}/activate
router.patch('/:id/activate', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET is_active = TRUE WHERE id = $1', [emp.id]);
      await logAudit(tx, req.user.id, 'employee.activated', 'user', emp.id);
    });
    res.json({ employee: publicEmployee({ ...emp, is_active: true }) });
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/{id}/deactivate — 409 if the employee holds any task whose
// current status is non-final (Section 5). Finality is read from the workflow
// data, not a hardcoded status key: reassign the open task first.
router.patch('/:id/deactivate', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    const open = await pool.query(
      `SELECT 1
       FROM task t
       JOIN request r ON r.id = t.request_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       CROSS JOIN LATERAL jsonb_array_elements(w.statuses) s
       WHERE t.employee_id = $1
         AND s->>'key' = t.status
         AND (s->>'is_terminal')::boolean = FALSE
       LIMIT 1`,
      [emp.id]
    );
    if (open.rows.length) {
      return res.status(409).json({ error: 'Employee has open tasks — reassign them before deactivating' });
    }

    await withTx(async (tx) => {
      await tx.query('UPDATE users SET is_active = FALSE WHERE id = $1', [emp.id]);
      await logAudit(tx, req.user.id, 'employee.deactivated', 'user', emp.id);
    });
    res.json({ employee: publicEmployee({ ...emp, is_active: false }) });
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/{id}/reset-password — server generates a temporary password,
// returned once (no forced-change flow — documented MVP limitation).
router.patch('/:id/reset-password', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const tempPassword = `Temp-${crypto.randomBytes(6).toString('base64url')}`;
    const password_hash = await bcrypt.hash(tempPassword, 10);
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, emp.id]);
      // The temp password itself is never audited (secrets stay out of detail).
      await logAudit(tx, req.user.id, 'employee.password_reset', 'user', emp.id);
    });
    res.json({ tempPassword });
  } catch (err) {
    next(err);
  }
});

// GET /employees/{id}/tasks — one employee's tasks (status label + is_terminal
// from the workflow data). Read-only oversight view of assignment progress.
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user.id);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    const { rows } = await pool.query(
      `SELECT t.id, t.status, t.assigned_at, t.request_id,
              r.priority, r.service_type_id, st.name AS service_type_name,
              w.statuses
       FROM task t
       JOIN request r ON r.id = t.request_id
       JOIN service_type st ON st.id = r.service_type_id
       JOIN workflow_definition w ON w.service_type_id = r.service_type_id
       WHERE t.employee_id = $1
       ORDER BY t.assigned_at DESC`,
      [emp.id]
    );

    res.json({
      tasks: rows.map((r) => ({
        id: r.id,
        requestId: r.request_id,
        serviceTypeId: r.service_type_id,
        serviceTypeName: r.service_type_name,
        status: statusOf(r.statuses, r.status),
        priority: r.priority,
        assignedAt: r.assigned_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
