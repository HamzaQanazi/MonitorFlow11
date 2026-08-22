// Events (communication feature group, onboarding wizard). Company calendar.
// Read: company-wide, any admin/employee (mobile employees included). Write
// (create/edit/delete): admin, view_all, or the narrower manage_events —
// a level can author events without also holding view_all's operational
// oversight (Levels & Capabilities). RSVP: self-service — any admin/employee
// toggles their own attendance; presence in event_rsvp = "going".
const express = require('express');
const pool = require('../db');
const { requireAuth, requireCapabilityOrAdmin, requireFeature } = require('../middleware/auth');
const { withTx, logAudit } = require('../lib/audit');
const { isBilingual } = require('../lib/i18nLabel');

const router = express.Router();
router.use(requireAuth);
router.use(requireFeature('events'));

const canWrite = requireCapabilityOrAdmin('view_all', 'manage_events');

async function loadEvent(id, companyId) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location,
            e.created_by, u.name AS created_by_name, e.created_at
     FROM event e
     JOIN users u ON u.id = e.created_by
     WHERE e.id = $1 AND e.company_id = $2`,
    [id, companyId]
  );
  return rows[0] || null;
}

function publicEvent(r, extra = {}) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    location: r.location,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    ...extra,
  };
}

// `existing` is the stored row on a partial update: without it a PATCH that
// sends only endsAt has no startsAt to compare against, and an event could be
// saved ending before it starts.
function validateBody(b, { partial, existing = null }) {
  const errors = {};
  if (!partial || b.title !== undefined) {
    if (!isBilingual(b.title)) errors.title = 'Bilingual title (en + ar) is required';
  }
  if (b.description !== undefined && b.description !== null && !isBilingual(b.description)) {
    errors.description = 'Description must be bilingual (en + ar) or omitted';
  }
  let startsAt;
  if (!partial || b.startsAt !== undefined) {
    startsAt = new Date(b.startsAt);
    if (!b.startsAt || Number.isNaN(startsAt.getTime())) errors.startsAt = 'A valid start date/time is required';
  }
  const effectiveStart = startsAt ?? (existing && existing.starts_at ? new Date(existing.starts_at) : null);
  let endsAt;
  if (b.endsAt !== undefined && b.endsAt !== null) {
    endsAt = new Date(b.endsAt);
    if (Number.isNaN(endsAt.getTime())) errors.endsAt = 'Invalid end date/time';
    else if (effectiveStart && endsAt < effectiveStart) errors.endsAt = 'End must be after start';
  } else if (startsAt && !b.endsAt && existing && existing.ends_at) {
    // Moving only the start, past an end that stays put, is the same mistake
    // from the other side.
    if (new Date(existing.ends_at) < startsAt) errors.startsAt = 'Start must be before the end';
  }
  return { errors, startsAt, endsAt };
}

// GET /events — every admin/employee account, company-wide, chronological.
router.get('/', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location,
              e.created_by, u.name AS created_by_name,
              (SELECT COUNT(*)::int FROM event_rsvp r WHERE r.event_id = e.id) AS attendee_count,
              EXISTS(SELECT 1 FROM event_rsvp r WHERE r.event_id = e.id AND r.user_id = $2) AS is_going
       FROM event e
       JOIN users u ON u.id = e.created_by
       WHERE e.company_id = $1
       ORDER BY e.starts_at ASC`,
      [req.user.company_id, req.user.id]
    );
    res.json({
      events: rows.map((r) =>
        publicEvent(r, { attendeeCount: r.attendee_count, isGoing: r.is_going })
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const event = await loadEvent(Number(req.params.id), req.user.company_id);
    if (!event) return res.status(404).json({ error: 'Not found' });

    const { rows: attendees } = await pool.query(
      `SELECT u.id, u.name FROM event_rsvp r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1 ORDER BY r.responded_at`,
      [event.id]
    );
    res.json({
      event: publicEvent(event, {
        attendeeCount: attendees.length,
        attendeeNames: attendees.map((a) => a.name),
        isGoing: attendees.some((a) => a.id === req.user.id),
      }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /events (view_all or admin)
router.post('/', canWrite, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { errors, startsAt, endsAt } = validateBody(b, { partial: false });
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const created = await withTx(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO event (company_id, title, description, starts_at, ends_at, location, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, description, starts_at, ends_at, location, created_by, created_at`,
        [req.user.company_id, b.title, b.description ?? null, startsAt, endsAt ?? null, b.location ?? null, req.user.id]
      );
      await logAudit(tx, req.user.id, 'event.created', 'event', rows[0].id, { title: b.title });
      return rows[0];
    });

    res.status(201).json({
      event: publicEvent(
        { ...created, created_by_name: req.user.name },
        { attendeeCount: 0, isGoing: false }
      ),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /events/:id (view_all or admin)
router.patch('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadEvent(id, req.user.company_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const { errors, startsAt, endsAt } = validateBody(b, { partial: true, existing });
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    const title = b.title !== undefined ? b.title : existing.title;
    const description = b.description !== undefined ? b.description : existing.description;
    const finalStartsAt = b.startsAt !== undefined ? startsAt : existing.starts_at;
    const finalEndsAt = b.endsAt !== undefined ? endsAt : existing.ends_at;
    const location = b.location !== undefined ? b.location : existing.location;

    const updated = await withTx(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE event SET title = $1, description = $2, starts_at = $3, ends_at = $4, location = $5
         WHERE id = $6
         RETURNING id, title, description, starts_at, ends_at, location, created_by, created_at`,
        [title, description, finalStartsAt, finalEndsAt, location, id]
      );
      await logAudit(tx, req.user.id, 'event.updated', 'event', id, { title });
      return rows[0];
    });

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM event_rsvp WHERE event_id = $1',
      [id]
    );
    res.json({
      event: publicEvent(
        { ...updated, created_by_name: existing.created_by_name },
        { attendeeCount: countRows[0].n }
      ),
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:id (view_all or admin)
router.delete('/:id', canWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await loadEvent(id, req.user.company_id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await withTx(async (tx) => {
      await tx.query('DELETE FROM event WHERE id = $1', [id]);
      await logAudit(tx, req.user.id, 'event.deleted', 'event', id, { title: existing.title });
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /events/:id/rsvp — self-service, idempotent "I'm going".
router.post('/:id/rsvp', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const id = Number(req.params.id);
    const event = await loadEvent(id, req.user.company_id);
    if (!event) return res.status(404).json({ error: 'Not found' });

    await pool.query(
      'INSERT INTO event_rsvp (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, req.user.id]
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// DELETE /events/:id/rsvp — self-service, idempotent "not going".
router.delete('/:id/rsvp', async (req, res, next) => {
  try {
    if (req.user.role === 'user') return res.status(403).json({ error: 'Forbidden' });
    const id = Number(req.params.id);
    const event = await loadEvent(id, req.user.company_id);
    if (!event) return res.status(404).json({ error: 'Not found' });

    await pool.query('DELETE FROM event_rsvp WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
