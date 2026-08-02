// Training & Onboarding (hr_skills feature group, onboarding wizard). Same
// read/write split as Knowledge Base: read is company-wide (any admin/
// employee, mobile included), write (create/edit/delete) needs view_all or
// admin. Completion is self-service, mirroring Events' RSVP — presence in
// training_completion = "this employee finished it."
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { isBilingual } = require('../lib/i18nLabel');

const router = express.Router();
router.use(requireAuth);

const canWrite = requireCapabilityOrAdmin('view_all');

async function loadModule(id, companyId) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `SELECT m.id, m.title, m.body, m.created_by, u.name AS created_by_name,
            m.created_at, m.updated_at
     FROM training_module m
     JOIN users u ON u.id = m.created_by
     WHERE m.id = $1 AND m.company_id = $2`,
    [id, companyId]
  );
  return rows[0] || null;
}

function publicModule(r, extra = {}) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...extra,
  };
}

// GET /training — every admin/employee account, company-wide.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.body, m.created_by, u.name AS created_by_name,
              m.created_at, m.updated_at,
              (SELECT COUNT(*)::int FROM training_completion c WHERE c.module_id = m.id) AS completion_count,
              EXISTS(SELECT 1 FROM training_completion c WHERE c.module_id = m.id AND c.user_id = $2) AS is_complete
       FROM training_module m
       JOIN users u ON u.id = m.created_by
       WHERE m.company_id = $1
       ORDER BY m.updated_at DESC`,
      [req.user.company_id, req.user.id]
    );
    res.json({
      modules: rows.map((r) =>
        publicModule(r, { completionCount: r.completion_count, isComplete: r.is_complete })
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const mod = await loadModule(Number(req.params.id), req.user.company_id);
    if (!mod) return res.status(404).json({ error: 'Not found' });

    const { rows: completed } = await pool.query(
      `SELECT u.id, u.name FROM training_completion c JOIN users u ON u.id = c.user_id
       WHERE c.module_id = $1 ORDER BY c.completed_at`,
      [mod.id]
    );
    res.json({
      module: publicModule(mod, {
        completionCount: completed.length,
        completedByNames: completed.map((c) => c.name),
        isComplete: completed.some((c) => c.id === req.user.id),
      }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /training (view_all or admin)
router.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};
    if (!isBilingual(b.title)) errors.title = 'Bilingual title (en + ar) is required';
    if (!isBilingual(b.body)) errors.body = 'Bilingual body (en + ar) is required';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const created = await withTx(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO training_module (company_id, title, body, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, body, created_by, created_at, updated_at`,
        [req.user.company_id, b.title, b.body, req.user.id]
      );
      await logAudit(tx, req.user.id, 'training_module.created', 'training_module', rows[0].id, { title: b.title });
      return rows[0];
    });

    res.status(201).json({
      module: publicModule(
        { ...created, created_by_name: req.user.name },
        { completionCount: 0, isComplete: false }
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /training/:id (view_all or admin)
router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadModule(id, req.user.company_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const errors = {};
    if (b.title !== undefined && !isBilingual(b.title)) errors.title = 'Bilingual title (en + ar) is required';
    if (b.body !== undefined && !isBilingual(b.body)) errors.body = 'Bilingual body (en + ar) is required';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const title = b.title !== undefined ? b.title : existing.title;
    const body = b.body !== undefined ? b.body : existing.body;

    const updated = await withTx(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE training_module SET title = $1, body = $2, updated_at = now()
         WHERE id = $3
         RETURNING id, title, body, created_by, created_at, updated_at`,
        [title, body, id]
      );
      await logAudit(tx, req.user.id, 'training_module.updated', 'training_module', id, { title });
      return rows[0];
    });

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM training_completion WHERE module_id = $1',
      [id]
    );
    res.json({
      module: publicModule(
        { ...updated, created_by_name: existing.created_by_name },
        { completionCount: countRows[0].n }
      ),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /training/:id (view_all or admin)
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadModule(id, req.user.company_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await withTx(async (tx) => {
      await tx.query('DELETE FROM training_module WHERE id = $1', [id]);
      await logAudit(tx, req.user.id, 'training_module.deleted', 'training_module', id, { title: existing.title });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /training/:id/complete — self-service, idempotent.
router.post('/:id/complete', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const id = Number(req.params.id);
    const mod = await loadModule(id, req.user.company_id);
    if (!mod) return res.status(404).json({ error: 'Not found' });

    await pool.query(
      'INSERT INTO training_completion (module_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, req.user.id]
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// DELETE /training/:id/complete — self-service, idempotent (un-mark).
router.delete('/:id/complete', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const id = Number(req.params.id);
    const mod = await loadModule(id, req.user.company_id);
    if (!mod) return res.status(404).json({ error: 'Not found' });

    await pool.query('DELETE FROM training_completion WHERE module_id = $1 AND user_id = $2', [id, req.user.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
