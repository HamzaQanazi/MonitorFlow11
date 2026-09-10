// Push notification delivery via Firebase Cloud Messaging (CLAUDE.md §13,
// 4th named-vendor exception, 2026-09-10 — Android only for now, no APNs key
// configured). Same shape as mailer.js: configured via an env var only, never
// a value the client supplies; best-effort from the caller's side — the
// notification row in the DB is the source of truth, a push is just a nudge,
// so a missing/invalid credential or a Firebase outage never throws.
const path = require('path');
const pool = require('../db');
// firebase-admin v13's modular API — no more `admin.credential.cert(...)` /
// `admin.messaging()`, both moved to their own subpath exports.
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let app;
function getApp() {
  if (app !== undefined) return app;
  const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!credPath) {
    app = null;
    return app;
  }
  // Resolved against the working directory (backend/, where the process
  // starts) — not this file's directory — so the env var reads the same way
  // as a path typed at a terminal in backend/.
  app = initializeApp({ credential: cert(require(path.resolve(credPath))) });
  return app;
}

// FCM error codes that mean "this token will never work again" — anything
// else (rate limiting, a transient network blip) leaves the token alone.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// Sends one plain-string title/body to every device this user has registered
// (lib/notify.js is the only caller). Never awaited by a DB transaction and
// never throws — errors are logged and swallowed.
async function sendPush(userId, title, body) {
  try {
    const a = getApp();
    if (!a) {
      console.log(`[push] Firebase not configured — skipping push to user ${userId}.`);
      return;
    }
    const { rows } = await pool.query('SELECT token FROM device_token WHERE user_id = $1', [userId]);
    if (!rows.length) return;

    const { responses } = await getMessaging(a).sendEachForMulticast({
      tokens: rows.map((r) => r.token),
      notification: { title, body },
    });
    const dead = responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? rows[i].token : null))
      .filter(Boolean);
    if (dead.length) {
      await pool.query('DELETE FROM device_token WHERE token = ANY($1)', [dead]);
    }
  } catch (err) {
    console.error(`[push] failed for user ${userId}:`, err.message);
  }
}

module.exports = { sendPush };
