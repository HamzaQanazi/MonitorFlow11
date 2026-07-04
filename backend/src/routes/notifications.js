// Notifications (Section 7). Own-only for every role — a notification always
// belongs to req.user; there is no cross-user read. Triggers that create rows
// live in the workflow engine and requests route; this file is read + mark-read
// only. Polled every 30s by the apps (Section 2 — no WebSockets).
const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function item(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    requestId: row.request_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

// GET /notifications?userId=me — always scoped to the caller (params saying
// otherwise are ignored, like GET /requests). Standard page/pageSize only;
// the other list params are irrelevant here and ignored (Section 7).
router.get('/', async (req, res, next) => {
  try {
    const q = req.query;
    const page = q.page === undefined ? 1 : Number(q.page);
    const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
    const bad = [];
    if (!Number.isInteger(page) || page < 1) bad.push('page');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) bad.push('pageSize');
    if (bad.length) return res.status(400).json({ error: `Invalid query params: ${bad.join(', ')}` });

    const { rows } = await pool.query(
      `SELECT id, type, message, request_id, is_read, created_at,
              COUNT(*) OVER()::int AS total,
              COUNT(*) FILTER (WHERE NOT is_read) OVER()::int AS unread
       FROM notification
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, pageSize, (page - 1) * pageSize]
    );

    res.json({
      notifications: rows.map(item),
      page,
      pageSize,
      total: rows.length ? rows[0].total : 0,
      unread: rows.length ? rows[0].unread : 0,
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/read-all — declared before /:id/read so the literal
// path can never be shadowed by the param route.
router.patch('/read-all', async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE notification SET is_read = TRUE WHERE user_id = $1 AND NOT is_read',
      [req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// PATCH /notifications/{id}/read — own only; a valid id owned by someone else
// returns 404 (404-over-403, Section 6). Idempotent.
router.patch('/:id/read', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Not found' });
    const { rowCount } = await pool.query(
      'UPDATE notification SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
