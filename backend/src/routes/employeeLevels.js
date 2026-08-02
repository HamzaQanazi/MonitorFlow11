// Employee levels — Gate-1 configuration. Reads stay open to manage_employees
// or admin (backs the Add Employee "role" picker, unchanged). Writes
// (create/rename/delete a level, or change what it can do) are admin-only:
// handing out capabilities is real Gate-1 power, same reasoning the code
// already uses for levelId on hire (routes/employees.js). Level *creation*
// was seed-only until now (CLAUDE.md §12) — this is that live editor.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireRole, requireCapabilityOrAdmin } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { isBilingual } = require('../lib/i18nLabel');
const { CAPABILITIES } = require('../lib/capabilities');

const router = express.Router();
router.use(requireAuth);

async function loadLevel(id) {
  const { rows } = await pool.query(
    `SELECT l.id, l.name,
            COALESCE(
              (SELECT array_agg(lc.capability_key ORDER BY lc.capability_key)
               FROM level_capability lc WHERE lc.level_id = l.id),
              '{}'
            ) AS capabilities,
            (SELECT COUNT(*)::int FROM users u WHERE u.level_id = l.id AND u.is_active = TRUE) AS holder_count
     FROM employee_level l WHERE l.id = $1`,
    [id]
  );
  return rows[0] || null;
}

function publicLevel(r) {
  return { id: r.id, name: r.name, capabilities: r.capabilities, holderCount: r.holder_count };
}

// GET /employee-levels — capabilities + holder count, for the Levels &
// Capabilities page and the Add Employee role picker.
router.get('/', requireCapabilityOrAdmin('manage_employees'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.name,
              COALESCE(
                (SELECT array_agg(lc.capability_key ORDER BY lc.capability_key)
                 FROM level_capability lc WHERE lc.level_id = l.id),
                '{}'
              ) AS capabilities,
              (SELECT COUNT(*)::int FROM users u WHERE u.level_id = l.id AND u.is_active = TRUE) AS holder_count
       FROM employee_level l
       ORDER BY l.id`
    );
    res.json({ levels: rows.map(publicLevel) });
  } catch (err) {
    next(err);
  }
});

function invalidCapabilities(list) {
  if (!Array.isArray(list)) return true;
  const known = new Set(CAPABILITIES);
  return !list.every((c) => typeof c === 'string' && known.has(c));
}

// POST /employee-levels (admin-only) — create a level. Capabilities start
// empty; grant them via PATCH once the level exists.
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!isBilingual(b.name)) {
      return res.status(422).json({ errors: { name: 'Bilingual name (en + ar) is required' } });
    }

    const created = await withTx(async (tx) => {
      const { rows } = await tx.query(
        'INSERT INTO employee_level (name) VALUES ($1) RETURNING id',
        [b.name]
      );
      await logAudit(tx, req.user.id, 'employee_level.created', 'employee_level', rows[0].id, { name: b.name });
      return rows[0];
    });

    res.status(201).json({ level: { id: created.id, name: b.name, capabilities: [], holderCount: 0 } });
  } catch (err) {
    next(err);
  }
});

// PATCH /employee-levels/:id (admin-only) — rename, and/or replace the
// level's full capability set. Takes effect immediately for every current
// holder — no sign-out needed (capabilities are re-read from the DB on every
// request via requireAuth).
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = Number.isInteger(id) ? await loadLevel(id) : null;
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const errors = {};
    if (b.name !== undefined && !isBilingual(b.name)) errors.name = 'Bilingual name (en + ar) is required';
    if (b.capabilities !== undefined && invalidCapabilities(b.capabilities)) {
      errors.capabilities = 'Unknown capability key';
    }
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const name = b.name !== undefined ? b.name : existing.name;

    await withTx(async (tx) => {
      await tx.query('UPDATE employee_level SET name = $1 WHERE id = $2', [name, id]);
      if (b.capabilities !== undefined) {
        await tx.query('DELETE FROM level_capability WHERE level_id = $1', [id]);
        for (const key of b.capabilities) {
          await tx.query('INSERT INTO level_capability (level_id, capability_key) VALUES ($1, $2)', [id, key]);
        }
      }
      await logAudit(tx, req.user.id, 'employee_level.updated', 'employee_level', id, {
        name,
        capabilities: b.capabilities,
      });
    });

    res.json({ level: publicLevel(await loadLevel(id)) });
  } catch (err) {
    next(err);
  }
});

// DELETE /employee-levels/:id (admin-only) — 409 while any active employee
// still holds it (same "reassign/move first" shape as department delete).
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = Number.isInteger(id) ? await loadLevel(id) : null;
    if (!existing) return res.status(404).json({ error: 'Not found' });

    // users.level_id has no ON DELETE clause — a deactivated former holder
    // still blocks the FK, so this checks ANY reference, not just active
    // ones (same shape as departments.js's delete guard).
    const { rows: anyHolder } = await pool.query('SELECT 1 FROM users WHERE level_id = $1 LIMIT 1', [id]);
    if (anyHolder.length) {
      return res.status(409).json({ error: 'This level has been assigned to an employee — reassign them to a different level first' });
    }

    await withTx(async (tx) => {
      await tx.query('DELETE FROM level_capability WHERE level_id = $1', [id]);
      await tx.query('DELETE FROM employee_level WHERE id = $1', [id]);
      await logAudit(tx, req.user.id, 'employee_level.deleted', 'employee_level', id, { name: existing.name });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
