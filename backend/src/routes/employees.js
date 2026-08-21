// Employees (monitor only, Section 7). Read list is the assignment picker;
// the writes (create/edit/activate/deactivate/reset-password/tasks) are the
// Employees Management page's backend.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin } = require('../middleware/auth');
const { statusOf } = require('../lib/workflowEngine');
const { subtreeIds } = require('../lib/scope');
const { withTx, logAudit } = require('../lib/audit');
const { allocateEmployeeEmail } = require('../lib/employeeEmail');
const { PLANS } = require('../lib/onboardingOptions');
const { reassignDepartmentHead } = require('../lib/departmentHead');
const { sendMail } = require('../lib/mailer');
const { csvToObjects } = require('../lib/csv');

// Credential delivery emails (supervisor-directed, CLAUDE.md §13) — best-
// effort, never awaited in a way that could fail the write that triggered
// them (mailer.sendMail itself never throws). `who` greets the employee by
// name; `loginIdentifier`/`password` are whatever the caller just set.
function sendCredentialsEmail(to, who, loginIdentifier, password) {
  return sendMail(to, 'Your MonitorFlow account / حسابك في MonitorFlow', {
    en: `Hi ${who},\n\nAn account was created for you on MonitorFlow. Sign in with:\n\nLogin: ${loginIdentifier}\nPassword: ${password}\n\nPlease keep these credentials safe.`,
    ar: `مرحبًا ${who}،\n\nتم إنشاء حساب لك على MonitorFlow. سجّل الدخول باستخدام:\n\nاسم الدخول: ${loginIdentifier}\nكلمة المرور: ${password}\n\nيرجى الحفاظ على هذه البيانات بسرية.`,
  });
}

const router = express.Router();
router.use(requireAuth);
router.use(requireCapabilityOrAdmin('manage_employees'));

// Machine-key picklists (same treatment as `priority`, I5's precedent) —
// translated client-side, not stored bilingual.
const GENDERS = new Set(['male', 'female']);
const WORKER_TYPES = new Set(['full_time', 'part_time', 'contractor']);
// One fixed day off per week (0=Sunday..6=Saturday, JS Date#getUTCDay()
// convention, same as schedule.js's weekday filter) — lets /schedule/suggest
// skip this employee on their day off when the company's working week (picked
// per-suggestion) is wider than what they're contracted for. Not a general
// availability system (CLAUDE.md §13) — a single static day, nothing more.
function isValidWeeklyRestDay(v) {
  return Number.isInteger(v) && v >= 0 && v <= 6;
}

function publicEmployee(r) {
  return {
    id: r.id,
    name: r.name,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    // The login this employee signs in with — returned so whoever created
    // them can hand it over (there is no other way to look it up).
    loginIdentifier: r.login_identifier,
    isActive: r.is_active,
    birthdate: r.birthdate,
    gender: r.gender,
    workerType: r.worker_type,
    weeklyRestDay: r.weekly_rest_day,
    departmentId: r.department_id,
    departmentName: r.department_name,
    branchId: r.branch_id,
    branchName: r.branch_name,
    levelId: r.level_id,
    levelName: r.level_name,
  };
}

// Load an employee by id, joined to its department. Returns null for a
// missing id, a non-employee user, the actor themselves, OR (Gate 2) an
// employee outside the acting oversight actor's subtree — all look
// nonexistent → 404. The admin has no subtree (I2) — they see the whole
// company, so their "sub" CTE is every user rather than a recursive walk.
async function loadEmployee(id, actor) {
  if (!Number.isInteger(id)) return null;
  const sub = actor.role === 'admin'
    ? 'WITH sub AS (SELECT id FROM users)'
    : `WITH RECURSIVE sub AS (
         SELECT id FROM users WHERE id = $2
         UNION ALL
         SELECT u.id FROM users u JOIN sub ON u.manager_id = sub.id
       )`;
  const { rows } = await pool.query(
    `${sub}
     SELECT u.id, u.name, u.first_name, u.last_name, u.email, u.phone,
            u.login_identifier, u.is_active, u.birthdate, u.gender, u.worker_type, u.weekly_rest_day,
            u.department_id, d.name AS department_name, d.branch_id, b.name AS branch_name,
            u.level_id, l.name AS level_name, u.manager_id
     FROM users u
     LEFT JOIN department d ON d.id = u.department_id
     LEFT JOIN branch b ON b.id = d.branch_id
     LEFT JOIN employee_level l ON l.id = u.level_id
     WHERE u.id = $1 AND u.role = 'employee'
       AND u.id <> $2 AND u.id IN (SELECT id FROM sub)`,
    [id, actor.id]
  );
  return rows[0] || null;
}

// Single-employee-row creation, shared by POST / (one at a time, the
// original path) and POST /import (CSV, one row at a time reusing this exact
// same validation/insert/email logic — the bulk path isn't a second,
// hand-rolled create). The caller never sets a password (credentials are
// email-delivered, never admin-typed or spreadsheet-carried) — one is always
// generated here. Returns { employee, password } on success (the loaded row,
// not yet publicEmployee-mapped — callers do that) or { errors } on a
// validation/uniqueness/FK failure, never throws for those — only for a
// genuine unexpected DB error, same as the original single-row code did.
async function createEmployeeRow(actor, emailDomain, input) {
  const {
    firstName, lastName, email, phone, birthdate, gender, workerType,
    weeklyRestDay, departmentId, managerId, levelId,
  } = input;
  const errors = {};
  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) errors.firstName = 'First name is required';
  if (!lastName || typeof lastName !== 'string' || !lastName.trim()) errors.lastName = 'Last name is required';
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'A valid email is required';
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) errors.phone = 'Phone is required';
  if (!birthdate || Number.isNaN(Date.parse(birthdate))) errors.birthdate = 'A valid birthdate is required';
  if (!gender || !GENDERS.has(gender)) errors.gender = 'Gender is required';
  if (!workerType || !WORKER_TYPES.has(workerType)) errors.workerType = 'Worker type is required';
  if (weeklyRestDay !== undefined && weeklyRestDay !== null && !isValidWeeklyRestDay(weeklyRestDay)) {
    errors.weeklyRestDay = 'Must be 0 (Sunday) through 6 (Saturday)';
  }
  if (Object.keys(errors).length) return { errors };

  const password = `Temp-${crypto.randomBytes(6).toString('base64url')}`;
  const password_hash = await bcrypt.hash(password, 10);
  let inserted;
  try {
    inserted = await withTx(async (tx) => {
      const loginIdentifier = await allocateEmployeeEmail(tx, firstName, lastName, emailDomain);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const { rows } = await tx.query(
        `INSERT INTO users (name, first_name, last_name, email, password_hash, role, phone,
                            birthdate, gender, worker_type, weekly_rest_day, department_id, manager_id, level_id,
                            login_identifier, company_id)
         VALUES ($1, $2, $3, $4, $5, 'employee', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, name, email, phone, is_active, department_id`,
        [fullName, firstName.trim(), lastName.trim(), email.toLowerCase(), password_hash, phone.trim(),
         birthdate, gender, workerType, weeklyRestDay ?? null, departmentId, managerId, levelId,
         loginIdentifier, actor.company_id]
      );
      await logAudit(tx, actor.id, 'employee.created', 'user', rows[0].id, { email: rows[0].email });
      return rows[0];
    });
  } catch (err) {
    if (err.code === '23505') return { errors: { email: 'Email is already registered' } };
    if (err.code === '23503') return { errors: { departmentId: 'Invalid department, manager, or level' } };
    throw err;
  }
  const created = await loadEmployee(inserted.id, actor);
  if (created.email) {
    await sendCredentialsEmail(created.email, created.first_name || created.name, created.login_identifier, password);
  }
  return { employee: created, password };
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
    if (q.workerType !== undefined && !WORKER_TYPES.has(q.workerType)) bad.push('workerType');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const where = ["u.role = 'employee'"];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    // Gate 2: an oversight actor manages the staff inside their subtree only.
    // The admin has no subtree (I2) — they see the whole company. The
    // departmentId param narrows within whichever scope applies.
    if (req.user.role !== 'admin') add('u.id = ANY(?)', await subtreeIds(req.user.id));
    add('u.id <> ?', req.user.id);
    if (q.departmentId !== undefined) add('u.department_id = ?', Number(q.departmentId));
    if (q.workerType !== undefined) add('u.worker_type = ?', q.workerType);
    if (q.q) add('(u.name ILIKE ? OR u.email ILIKE ?)', `%${q.q}%`);

    params.push(pageSize, (page - 1) * pageSize);
    // openTaskCount (spec v4 E2, assignment suggestions): tasks whose current
    // status is non-final — finality read from the workflow data, no status
    // key in code (same mechanism as the deactivate guard below).
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.first_name, u.last_name, u.email, u.phone,
              u.login_identifier, u.is_active, u.birthdate, u.gender, u.worker_type, u.weekly_rest_day,
              u.department_id, d.name AS department_name, d.branch_id, b.name AS branch_name,
              u.level_id, l.name AS level_name,
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
       LEFT JOIN branch b ON b.id = d.branch_id
       LEFT JOIN employee_level l ON l.id = u.level_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      employees: rows.map((r) => ({
        id: r.id,
        name: r.name,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        loginIdentifier: r.login_identifier,
        isActive: r.is_active,
        birthdate: r.birthdate,
        gender: r.gender,
        workerType: r.worker_type,
        weeklyRestDay: r.weekly_rest_day,
        departmentId: r.department_id,
        departmentName: r.department_name,
        branchId: r.branch_id,
        branchName: r.branch_name,
        levelId: r.level_id,
        levelName: r.level_name,
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

// POST /employees — create an employee. The server always generates the
// initial password (never admin-typed) — it's delivered by the credentials
// email and also returned once here, same reveal-once shape as
// PATCH /:id/reset-password, as a fallback if mail delivery is slow/down.
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};

    // Gate 2: an oversight actor's new hire becomes their direct report
    // (manager_id = actor), inheriting the actor's department. The admin has
    // no department/subtree of their own (I2) — they sit outside the tree —
    // so they must say where the hire goes; an omitted managerId makes the
    // hire a tree root (I3: "a root employee reaches the whole organisation
    // by sitting at the top").
    let departmentId = req.user.department_id;
    let managerId = req.user.id;
    // Handing out a level at creation grants real Gate-1 power, so only the
    // admin can do it — an oversight employee handing an arbitrary level
    // (including one stronger than their own) to their own hire would be a
    // privilege-escalation path. Oversight-created hires keep level_id NULL,
    // same as before this change.
    let levelId = null;
    if (req.user.role === 'admin') {
      if (!Number.isInteger(b.departmentId)) errors.departmentId = 'Department is required';
      departmentId = b.departmentId;
      if (b.managerId !== undefined && b.managerId !== null) {
        if (!Number.isInteger(b.managerId)) errors.managerId = 'Invalid manager';
        managerId = b.managerId;
      } else {
        managerId = null;
      }
      if (b.levelId !== undefined && b.levelId !== null) {
        if (!Number.isInteger(b.levelId)) errors.levelId = 'Invalid level';
        levelId = b.levelId;
      }
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    // The generated login lives on the one company row's email_domain
    // (step 5 of the wizard) — single-org per deployment (§13), so there's
    // exactly one to read, not one scoped per actor.
    const { rows: co } = await pool.query('SELECT id, plan, email_domain FROM company LIMIT 1');
    if (!co.length || !co[0].email_domain) {
      return res.status(422).json({ errors: { _: 'Company email domain is not set — finish onboarding first' } });
    }

    // Plan seat cap (step 7 of onboarding) — Enterprise's employeeCap is null
    // (unlimited). Counts active employees only; a deactivated one frees a seat.
    const planDef = PLANS.find((p) => p.key === co[0].plan);
    if (planDef && planDef.employeeCap != null) {
      const { rows: countRows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE role = 'employee' AND company_id = $1 AND is_active = true",
        [co[0].id]
      );
      if (countRows[0].n >= planDef.employeeCap) {
        return res.status(409).json({
          error: `Employee limit reached for the ${planDef.name.en} plan (${planDef.employeeCap}). Contact support to upgrade your plan.`,
        });
      }
    }

    const result = await createEmployeeRow(req.user, co[0].email_domain, {
      firstName: b.firstName, lastName: b.lastName, email: b.email,
      phone: b.phone, birthdate: b.birthdate, gender: b.gender, workerType: b.workerType,
      weeklyRestDay: b.weeklyRestDay, departmentId, managerId, levelId,
    });
    if (result.errors) return res.status(422).json({ errors: result.errors });
    res.status(201).json({ employee: publicEmployee(result.employee), tempPassword: result.password });
  } catch (err) {
    next(err);
  }
});

// GET /employees/import/template — a starter CSV with the exact columns
// POST /employees/import expects, one filled-in example row. Not itself
// gated to admin-only fields: department/manager/level only ever get read
// for an admin caller (see below), so a non-admin importer just leaves them
// blank — the template shows the full column set either way for simplicity.
router.get('/import/template', (req, res) => {
  const csv =
    'firstName,lastName,email,phone,birthdate,gender,workerType,weeklyRestDay,department,manager,level\n' +
    'Jane,Doe,jane.doe@example.com,0590000000,1995-03-14,female,full_time,Friday,Field Services,,Staff\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employees-template.csv"');
  res.send(csv);
});

const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const IMPORT_MAX_ROWS = 500;
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES } });
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// A blank cell → null (unset, matches the single-create form). A number
// string → that number, validated by createEmployeeRow same as the API
// body would be. A day name → its index. Anything else → NaN, which
// createEmployeeRow's own isValidWeeklyRestDay check rejects with the
// normal field error — this never silently swallows a bad value.
function parseWeeklyRestDayCell(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const idx = DAY_NAMES.indexOf(v.toLowerCase());
  return idx === -1 ? NaN : idx;
}

// POST /employees/import — CSV, multipart field `file`. Partial success by
// design (user-confirmed): every row is validated and inserted independently
// through createEmployeeRow, so one bad row never blocks the good ones —
// the response lists exactly which rows landed and which didn't, with why.
// No password column: each row gets a random temp password, same shape as
// PATCH /:id/reset-password, delivered only by the credentials email (never
// echoed back in the response) — a spreadsheet is not where passwords belong.
router.post('/import', (req, res, next) => {
  importUpload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({ errors: { file: 'File exceeds the 2 MB limit' } });
    }
    if (err) return next(err);
    importEmployees(req, res, next);
  });
});

async function importEmployees(req, res, next) {
  try {
    if (!req.file) return res.status(422).json({ errors: { file: 'A CSV file is required' } });
    let rows;
    try {
      rows = csvToObjects(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(422).json({ errors: { file: 'Could not parse the file as CSV' } });
    }
    if (!rows.length) return res.status(422).json({ errors: { file: 'The file has no data rows' } });
    if (rows.length > IMPORT_MAX_ROWS) {
      return res.status(422).json({ errors: { file: `A single import is limited to ${IMPORT_MAX_ROWS} rows` } });
    }

    const { rows: co } = await pool.query('SELECT id, plan, email_domain FROM company LIMIT 1');
    if (!co.length || !co[0].email_domain) {
      return res.status(422).json({ errors: { _: 'Company email domain is not set — finish onboarding first' } });
    }
    const planDef = PLANS.find((p) => p.key === co[0].plan);
    let activeCount = null;
    if (planDef && planDef.employeeCap != null) {
      const { rows: countRows } = await pool.query(
        "SELECT count(*)::int AS n FROM users WHERE role = 'employee' AND company_id = $1 AND is_active = true",
        [co[0].id]
      );
      activeCount = countRows[0].n;
    }

    // Department/manager/level columns only mean anything for an admin
    // caller (same restriction POST / already applies — a non-admin's hire
    // always lands in their own department, under themselves). Resolved
    // once here, not per row: a subtree-sized company's department/level
    // catalogue and employee list are small, and re-querying per CSV row
    // would be wasteful for a 500-row file.
    const isAdmin = req.user.role === 'admin';
    const departmentsByName = new Map();
    const levelsByName = new Map();
    const employeesByHandle = new Map();
    if (isAdmin) {
      const { rows: depts } = await pool.query('SELECT id, name FROM department');
      for (const d of depts) {
        if (d.name.en) departmentsByName.set(d.name.en.toLowerCase(), d.id);
        if (d.name.ar) departmentsByName.set(d.name.ar.toLowerCase(), d.id);
      }
      const { rows: levels } = await pool.query('SELECT id, name FROM employee_level');
      for (const l of levels) {
        if (l.name.en) levelsByName.set(l.name.en.toLowerCase(), l.id);
        if (l.name.ar) levelsByName.set(l.name.ar.toLowerCase(), l.id);
      }
      const { rows: emps } = await pool.query(
        "SELECT id, login_identifier, email FROM users WHERE role = 'employee' AND company_id = $1",
        [req.user.company_id]
      );
      for (const e of emps) {
        employeesByHandle.set(e.login_identifier.toLowerCase(), e.id);
        if (e.email) employeesByHandle.set(e.email.toLowerCase(), e.id);
      }
    }

    const created = [];
    const failed = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const rowNum = idx + 2; // header is row 1
      const r = rows[idx];
      const rowErrors = {};

      let departmentId = req.user.department_id;
      let managerId = req.user.id;
      let levelId = null;
      if (isAdmin) {
        const deptName = (r.department || '').toLowerCase();
        if (!deptName) rowErrors.department = 'Department is required';
        else if (!departmentsByName.has(deptName)) rowErrors.department = `Department "${r.department}" not found`;
        else departmentId = departmentsByName.get(deptName);

        managerId = null;
        const managerHandle = (r.manager || '').toLowerCase();
        if (managerHandle) {
          if (!employeesByHandle.has(managerHandle)) rowErrors.manager = `Manager "${r.manager}" not found`;
          else managerId = employeesByHandle.get(managerHandle);
        }

        const levelName = (r.level || '').toLowerCase();
        if (levelName) {
          if (!levelsByName.has(levelName)) rowErrors.level = `Level "${r.level}" not found`;
          else levelId = levelsByName.get(levelName);
        }
      }
      if (Object.keys(rowErrors).length) {
        failed.push({ row: rowNum, errors: rowErrors });
        continue;
      }

      if (activeCount !== null && activeCount >= planDef.employeeCap) {
        failed.push({
          row: rowNum,
          errors: { _: `Employee limit reached for the ${planDef.name.en} plan (${planDef.employeeCap})` },
        });
        continue;
      }

      const result = await createEmployeeRow(req.user, co[0].email_domain, {
        firstName: r.firstname, lastName: r.lastname, email: r.email,
        phone: r.phone || null,
        birthdate: r.birthdate || null,
        gender: r.gender || null,
        workerType: r.workertype || null,
        weeklyRestDay: parseWeeklyRestDayCell(r.weeklyrestday),
        departmentId, managerId, levelId,
      });
      if (result.errors) {
        failed.push({ row: rowNum, errors: result.errors });
        continue;
      }
      const emp = publicEmployee(result.employee);
      created.push({ row: rowNum, employee: emp });
      if (activeCount !== null) activeCount++;
      // A manager referenced before their own row, or a sibling created
      // earlier in this same file, is now resolvable for later rows too.
      employeesByHandle.set(emp.loginIdentifier.toLowerCase(), emp.id);
      if (emp.email) employeesByHandle.set(emp.email.toLowerCase(), emp.id);
    }

    res.json({ totalRows: rows.length, createdCount: created.length, failedCount: failed.length, created, failed });
  } catch (err) {
    next(err);
  }
}

// PATCH /employees/{id} — edit name / phone / birthdate / gender / worker
// type / department / level / weekly rest day. Phone, birthdate, gender, and
// worker type are required at creation (I8) — an edit may change them to
// another valid value but never clear them to blank; weeklyRestDay is the
// one still-optional field here and keeps its own null-clearing shape.
router.patch('/:id', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user);
    if (!emp) return res.status(404).json({ error: 'Not found' });

    const { name, phone, birthdate, gender, workerType, departmentId, levelId, weeklyRestDay } = req.body || {};
    const errors = {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) errors.name = 'Name cannot be empty';
    if (phone !== undefined && (typeof phone !== 'string' || !phone.trim())) errors.phone = 'Phone is required';
    if (birthdate !== undefined && (!birthdate || Number.isNaN(Date.parse(birthdate)))) {
      errors.birthdate = 'A valid birthdate is required';
    }
    if (gender !== undefined && !GENDERS.has(gender)) errors.gender = 'Gender is required';
    if (workerType !== undefined && !WORKER_TYPES.has(workerType)) errors.workerType = 'Worker type is required';
    if (departmentId !== undefined && !Number.isInteger(departmentId)) errors.departmentId = 'Invalid department';
    if (weeklyRestDay !== undefined && weeklyRestDay !== null && !isValidWeeklyRestDay(weeklyRestDay)) {
      errors.weeklyRestDay = 'Must be 0 (Sunday) through 6 (Saturday)';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    // Spec v4: an oversight employee cannot move a report out of their own
    // department (that would need an org-level actor). The admin has no
    // department of their own (I2) and configures the whole org, so this
    // restriction doesn't apply to them.
    if (req.user.role !== 'admin' && departmentId !== undefined && departmentId !== req.user.department_id) {
      return res.status(422).json({ errors: { departmentId: 'Must be your own department' } });
    }

    // Changing a level is real Gate-1 power (same reasoning as levelId at
    // creation — POST /employees) — admin-only. A non-admin actor's levelId
    // is silently ignored, same as the creation path, not a 403: this endpoint
    // is otherwise open to any manage_employees holder for name/phone/dept.
    let applyLevelId = false;
    let resolvedLevelId = null;
    if (req.user.role === 'admin' && levelId !== undefined) {
      applyLevelId = true;
      if (levelId !== null) {
        if (!Number.isInteger(levelId)) {
          return res.status(422).json({ errors: { levelId: 'Invalid level' } });
        }
        const { rows: levelRows } = await pool.query('SELECT 1 FROM employee_level WHERE id = $1', [levelId]);
        if (!levelRows.length) return res.status(422).json({ errors: { levelId: 'Invalid level' } });
        resolvedLevelId = levelId;
      }
    }

    await withTx(async (tx) => {
      await tx.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           birthdate = COALESCE($3, birthdate),
           gender = COALESCE($4, gender),
           worker_type = COALESCE($5, worker_type),
           department_id = COALESCE($6, department_id),
           level_id = CASE WHEN $7::boolean THEN $8 ELSE level_id END,
           weekly_rest_day = CASE WHEN $9::boolean THEN $10 ELSE weekly_rest_day END
         WHERE id = $11`,
        [
          name === undefined ? null : name.trim(),
          phone === undefined ? null : phone.trim(),
          birthdate === undefined ? null : birthdate,
          gender === undefined ? null : gender,
          workerType === undefined ? null : workerType,
          departmentId === undefined ? null : departmentId,
          applyLevelId,
          resolvedLevelId,
          weeklyRestDay !== undefined,
          weeklyRestDay === undefined ? null : weeklyRestDay,
          emp.id,
        ]
      );
      await logAudit(tx, req.user.id, 'employee.updated', 'user', emp.id, {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(birthdate !== undefined ? { birthdate } : {}),
        ...(gender !== undefined ? { gender } : {}),
        ...(workerType !== undefined ? { workerType } : {}),
        ...(departmentId !== undefined ? { departmentId } : {}),
        ...(applyLevelId ? { levelId: resolvedLevelId } : {}),
        ...(weeklyRestDay !== undefined ? { weeklyRestDay } : {}),
      });
    });
    res.json({ employee: publicEmployee(await loadEmployee(emp.id, req.user)) });
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/{id}/activate
router.patch('/:id/activate', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user);
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
//
// Department-head fallback: if this employee currently heads a department,
// deactivating them auto-promotes THEIR OWN manager to head (and re-points
// the department's other members to report to that new head — see
// lib/departmentHead.js), so oversight of the department never has a gap. If
// they have no manager of their own, there's no one to fall back to — the
// deactivation is refused (409) until the Owner reassigns the department's
// head (or gives this employee a manager) first, same "fix the tree before
// you leave it broken" spirit as the open-task check above.
router.patch('/:id/deactivate', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user);
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

    const { rows: headOf } = await pool.query('SELECT id FROM department WHERE head_user_id = $1', [emp.id]);
    if (headOf.length) {
      // The fallback must be an active employee — a null manager_id, or one
      // pointing at an already-inactive account, both leave nobody who can
      // actually operate as head (an inactive account can't log in).
      const { rows: fallback } = emp.manager_id == null
        ? { rows: [] }
        : await pool.query(
            "SELECT id FROM users WHERE id = $1 AND role = 'employee' AND is_active = TRUE",
            [emp.manager_id]
          );
      if (!fallback.length) {
        return res.status(409).json({
          error: 'Employee heads a department and has no active manager to fall back to — reassign the department’s head first',
        });
      }
    }

    await withTx(async (tx) => {
      if (headOf.length) {
        for (const dept of headOf) {
          await reassignDepartmentHead(tx, dept.id, emp.manager_id, { moveIntoDepartment: false });
          await logAudit(tx, req.user.id, 'department.head_auto_promoted', 'department', dept.id, {
            firedHeadId: emp.id,
            newHeadId: emp.manager_id,
          });
        }
      }
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
    const emp = await loadEmployee(Number(req.params.id), req.user);
    if (!emp) return res.status(404).json({ error: 'Not found' });
    const tempPassword = `Temp-${crypto.randomBytes(6).toString('base64url')}`;
    const password_hash = await bcrypt.hash(tempPassword, 10);
    await withTx(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, emp.id]);
      // The temp password itself is never audited (secrets stay out of detail).
      await logAudit(tx, req.user.id, 'employee.password_reset', 'user', emp.id);
    });
    if (emp.email) await sendCredentialsEmail(emp.email, emp.first_name || emp.name, emp.login_identifier, tempPassword);
    res.json({ tempPassword });
  } catch (err) {
    next(err);
  }
});

// GET /employees/{id}/tasks — one employee's tasks (status label + is_terminal
// from the workflow data). Read-only oversight view of assignment progress.
router.get('/:id/tasks', async (req, res, next) => {
  try {
    const emp = await loadEmployee(Number(req.params.id), req.user);
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
