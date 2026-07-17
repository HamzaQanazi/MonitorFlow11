// Audit trail. Two families of audit_event rows, all written via logAudit
// inside the SAME transaction as the change they record (so an audit row can't
// outlive a rolled-back change, I9):
//   • account/configuration — employee.* and service.created (admin/monitor
//     handlers), the original spec v4 Section C surface.
//   • operational (§6 re-scope) — request.status_changed / request.assigned /
//     request.priority_changed, written by the workflow engine and the
//     assign/priority handlers. This deliberately duplicates the operational
//     timeline in request_status_history so the admin audit page shows one feed.
const pool = require('../db');

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// db is the transaction client. detail must never contain secrets (passwords,
// temp passwords, hashes) — emails and changed field values only.
async function logAudit(db, actorId, action, entityType, entityId, detail = null) {
  await db.query(
    `INSERT INTO audit_event (actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, entityType, entityId, detail ? JSON.stringify(detail) : null]
  );
}

module.exports = { withTx, logAudit };
