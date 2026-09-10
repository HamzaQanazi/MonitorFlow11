// Single choke point for writing a NOTIFICATION row. Every call site used to
// run its own `INSERT INTO notification` (Section 7's notify triggers,
// spread across workflowEngine.js and requests.js) — routing them all
// through here means adding push (below) didn't require touching each one's
// send logic separately, and no future trigger can add the DB row without
// also getting the push for free.
const { sendPush } = require('./push');

// `message` is the usual {en, ar} pair (I5). Written to the DB inside the
// caller's transaction via `client` — same transaction as the status change
// it's part of (I9). The push itself runs on the shared pool, not `client`,
// and is fire-and-forget: a slow or failed push must never hold a locked row
// open or affect whether the transaction commits.
// ponytail: no stored per-user language preference exists yet, so push text
// is always English; add a users.locale column if Arabic push text matters.
async function createNotification(client, userId, requestId, type, message) {
  await client.query(
    'INSERT INTO notification (user_id, request_id, type, message) VALUES ($1, $2, $3, $4)',
    [userId, requestId, type, JSON.stringify(message)]
  );
  sendPush(userId, 'MonitorFlow', message.en);
}

module.exports = { createNotification };
