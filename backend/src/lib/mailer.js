// Server-side email delivery (CLAUDE.md §13, supervisor-directed exception —
// third named-vendor carve-out after Nominatim/Gemini, this time for SMTP
// mail delivery: new-employee credentials and password-reset links). Same
// shape as those two: configured via env vars only, never a value the client
// supplies or sees.
//
// Configured via SMTP_HOST/PORT/USER/PASS/FROM. If SMTP_HOST is unset (dev/
// test, or a deployment that hasn't filled it in yet), falls back to logging
// the message instead of sending it — email delivery is always best-effort
// from the caller's side (a hire or a reset request must still succeed even
// if mail is down or unconfigured), never a hard dependency.
const nodemailer = require('nodemailer');

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  transporter = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    : null;
  return transporter;
}

// `body` is {en, ar} (I5) — email has no client to pick one language, so both
// go in the same message, English first then Arabic, separated by a rule.
async function sendMail(to, subject, body) {
  const text = `${body.en}\n\n----------\n\n${body.ar}`;
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP not configured — logging instead of sending.\nTo: ${to}\nSubject: ${subject}\n${text}`);
    return;
  }
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
  } catch (err) {
    console.error(`[mailer] failed to send to ${to}:`, err.message);
  }
}

module.exports = { sendMail };
