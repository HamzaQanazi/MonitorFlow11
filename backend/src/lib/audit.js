// Account/configuration audit trail (spec v4 Section C —
// docs/spec_v4_amendment.md). Request lifecycle is NOT audited here; that
// stays in request_status_history. One logAudit INSERT per mutating
// admin/monitor handler, inside the same transaction as the write it records
// (withTx), so an audit row can't outlive a rolled-back change.
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
