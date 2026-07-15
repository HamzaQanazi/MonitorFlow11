// Files (CLAUDE.md Section 7): local-disk storage under server-generated
// UUID names in a non-web-root uploads dir; the DB stores metadata only and
// storage_path never leaves the server. MIME is decided by magic bytes —
// the client's filename and declared type are never trusted.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isOversight } = require('../lib/capabilities');
const { ownerInScope } = require('../lib/scope');

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowlist jpg/jpeg/png/pdf, identified by content (must-pass #9: an .exe
// renamed .jpg dies here).
function sniffMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(png)) return 'image/png';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

// POST /files — multipart, field `file` + at most one of requestId / taskId.
// Section 6 upload cells: user → own request, employee → own task, monitor
// never. Ownership failures are 404 (404-over-403 rule). No parent = a
// user's pending upload for a request-form photo (Section 7 two-step);
// POST /requests links it in its transaction.
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(422).json({ errors: { file: 'File exceeds the 5 MB limit' } });
    }
    if (err) return next(err);
    createFile(req, res, next);
  });
});

async function createFile(req, res, next) {
  try {
    const requestId = req.body.requestId === undefined ? null : Number(req.body.requestId);
    const taskId = req.body.taskId === undefined ? null : Number(req.body.taskId);
    if (
      (requestId !== null && taskId !== null) ||
      (requestId !== null && !Number.isInteger(requestId)) ||
      (taskId !== null && !Number.isInteger(taskId))
    ) {
      return res
        .status(422)
        .json({ errors: { requestId: 'Provide at most one of requestId or taskId' } });
    }
    if (!req.file) return res.status(422).json({ errors: { file: 'A file is required' } });

    if (requestId !== null) {
      if (req.user.role !== 'user') return res.status(403).json({ error: 'Forbidden' });
      const { rows } = await pool.query('SELECT user_id FROM request WHERE id = $1', [requestId]);
      if (!rows.length || rows[0].user_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
    } else if (taskId !== null) {
      if (req.user.role !== 'employee') return res.status(403).json({ error: 'Forbidden' });
      const { rows } = await pool.query('SELECT employee_id FROM task WHERE id = $1', [taskId]);
      if (!rows.length || rows[0].employee_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
    } else if (req.user.role !== 'user') {
      // Pending uploads are the user-side photo contract only.
      return res.status(403).json({ error: 'Forbidden' });
    }

    const mime = sniffMime(req.file.buffer);
    if (!mime) {
      return res.status(422).json({ errors: { file: 'Only JPG, PNG, or PDF files are accepted' } });
    }

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const storedName = crypto.randomUUID();
    await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), req.file.buffer);

    const { rows } = await pool.query(
      `INSERT INTO file_attachment
         (request_id, task_id, original_filename, mime_type, size_bytes, storage_path, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, uploaded_at`,
      [requestId, taskId, req.file.originalname, mime, req.file.size, storedName, req.user.id]
    );

    res.status(201).json({
      attachment: {
        id: rows[0].id,
        originalFilename: req.file.originalname,
        mimeType: mime,
        sizeBytes: req.file.size,
        uploadedAt: rows[0].uploaded_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /files/{id} — Section 6 download row: user if they own the parent
// request, employee if assigned to that request's task, monitor any.
// Everything else is 404 (must-pass #17).
router.get('/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT f.original_filename, f.mime_type, f.storage_path, f.uploaded_by,
              f.request_id, f.task_id,
              r.user_id AS owner_id, pt.employee_id AS assignee_id,
              st.owner_id AS service_owner_id
       FROM file_attachment f
       LEFT JOIN task ft ON ft.id = f.task_id
       LEFT JOIN request r ON r.id = COALESCE(f.request_id, ft.request_id)
       LEFT JOIN task pt ON pt.request_id = r.id
       LEFT JOIN service_type st ON st.id = r.service_type_id
       WHERE f.id = $1`,
      [req.params.id]
    );
    const f = rows[0];
    // A pending upload (no parent yet) is visible to its uploader only —
    // it isn't part of any request until POST /requests links it.
    const pending = f && f.request_id === null && f.task_id === null;
    let allowed = false;
    if (f) {
      if (pending) {
        allowed = f.uploaded_by === req.user.id;
      } else if (req.user.role === 'user') {
        allowed = f.owner_id === req.user.id;
      } else if (isOversight(req.user)) {
        // Gate 2: an oversight employee downloads within their subtree only.
        allowed = await ownerInScope(req.user.id, f.service_owner_id);
      } else if (req.user.role === 'employee') {
        allowed = f.assignee_id === req.user.id;
      }
    }
    if (!allowed) return res.status(404).json({ error: 'Not found' });

    const safeName = f.original_filename.replace(/["\\\r\n]/g, '_');
    res.sendFile(
      path.join(UPLOAD_DIR, f.storage_path),
      {
        headers: {
          'Content-Type': f.mime_type,
          'Content-Disposition': `attachment; filename="${safeName}"`,
        },
      },
      (err) => err && next(err)
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
