// Knowledge Base (communication feature group, onboarding wizard). Flat list
// of company articles — no categories, no drafts, no versioning. Read is
// company-wide (any admin/employee, not gated by a
// capability — an employee reading the KB on mobile has no capabilities at
// all); writes need admin, view_all, or the narrower manage_knowledge_base
// (Levels & Capabilities) — a level can author articles without also
// holding view_all's operational oversight.
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin, requireFeature } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { isBilingual } = require('../lib/i18nLabel');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('knowledge_base'));

const canWrite = requireCapabilityOrAdmin('view_all', 'manage_knowledge_base');

async function loadArticle(id, companyId) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.body, a.created_by, u.name AS created_by_name,
            a.created_at, a.updated_at
     FROM kb_article a
     JOIN users u ON u.id = a.created_by
     WHERE a.id = $1 AND a.company_id = $2`,
    [id, companyId]
  );
  return rows[0] || null;
}

function publicArticle(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// GET /knowledge-base — every admin/employee account, company-wide.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.created_by, u.name AS created_by_name,
              a.created_at, a.updated_at
       FROM kb_article a
       JOIN users u ON u.id = a.created_by
       WHERE a.company_id = $1
       ORDER BY a.updated_at DESC`,
      [req.user.company_id]
    );
    res.json({ articles: rows.map(publicArticle) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const article = await loadArticle(Number(req.params.id), req.user.company_id);
    if (!article) return res.status(404).json({ error: 'Not found' });
    res.json({ article: publicArticle(article) });
  } catch (err) {
    next(err);
  }
});

// POST /knowledge-base (view_all or admin)
router.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};
    if (!isBilingual(b.title)) errors.title = 'Bilingual title (en + ar) is required';
    if (!isBilingual(b.body)) errors.body = 'Bilingual body (en + ar) is required';
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const created = await withTx(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO kb_article (company_id, title, body, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, body, created_by, created_at, updated_at`,
        [req.user.company_id, b.title, b.body, req.user.id]
      );
      await logAudit(tx, req.user.id, 'kb_article.created', 'kb_article', rows[0].id, { title: b.title });
      return rows[0];
    });

    res.status(201).json({
      article: publicArticle({ ...created, created_by_name: req.user.name }),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /knowledge-base/:id (view_all or admin)
router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadArticle(id, req.user.company_id);
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
        `UPDATE kb_article SET title = $1, body = $2, updated_at = now()
         WHERE id = $3
         RETURNING id, title, body, created_by, created_at, updated_at`,
        [title, body, id]
      );
      await logAudit(tx, req.user.id, 'kb_article.updated', 'kb_article', id, { title });
      return rows[0];
    });

    res.json({ article: publicArticle({ ...updated, created_by_name: existing.created_by_name }) });
  } catch (err) {
    next(err);
  }
});

// DELETE /knowledge-base/:id (view_all or admin)
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadArticle(id, req.user.company_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await withTx(async (tx) => {
      await tx.query('DELETE FROM kb_article WHERE id = $1', [id]);
      await logAudit(tx, req.user.id, 'kb_article.deleted', 'kb_article', id, { title: existing.title });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
