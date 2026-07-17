// Phase 7 (§10): outbound signed webhooks. Fired AFTER commit on the four
// lifecycle events — request_created / status_changed / assigned / sla_breached
// — so a delivery failure can never roll back the state change it reports.
//
// Fire-and-forget, at-most-once: each active subscription for the event gets one
// POST with an HMAC-SHA256 signature of the exact body it receives. No retries,
// no delivery queue.
// ponytail: at-most-once, no retry/backoff. Add a delivery-log + retry worker if
// a subscriber's uptime ever has to be tolerated — the dispatch seam is here.
const crypto = require('crypto');
const pool = require('../db');

const EVENTS = ['request_created', 'status_changed', 'assigned', 'sla_breached'];

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// Deliver one event to every active subscriber that asked for it. Never throws:
// callers invoke this after their transaction has already committed and must not
// be affected by a subscriber being down.
async function fireWebhook(event, data) {
  try {
    const { rows } = await pool.query(
      `SELECT url, secret FROM webhook_subscription
       WHERE is_active AND $1 = ANY(events)`,
      [event]
    );
    if (!rows.length) return;
    const body = JSON.stringify({ event, occurred_at: new Date().toISOString(), ...data });
    await Promise.all(
      rows.map((sub) =>
        fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-MonitorFlow-Event': event,
            'X-MonitorFlow-Signature': sign(sub.secret, body),
          },
          body,
          // Don't let a hung subscriber hold a connection forever.
          signal: AbortSignal.timeout(5000),
        }).catch((err) => console.error(`webhook ${event} → ${sub.url} failed: ${err.message}`))
      )
    );
  } catch (err) {
    console.error(`webhook dispatch (${event}) failed: ${err.message}`);
  }
}

module.exports = { EVENTS, sign, fireWebhook };
