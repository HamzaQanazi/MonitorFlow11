require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const dashboardRoutes = require('./routes/dashboard');
const requestRoutes = require('./routes/requests');
const taskRoutes = require('./routes/tasks');
const employeeRoutes = require('./routes/employees');
const auditEventRoutes = require('./routes/auditEvents');
const fileRoutes = require('./routes/files');
const notificationRoutes = require('./routes/notifications');
const userRoutes = require('./routes/users');
const departmentRoutes = require('./routes/departments');
const reportRoutes = require('./routes/reports');
const configRoutes = require('./routes/config');

const app = express();

// ponytail: dev-only CORS so a Flutter *web* build (served on another
// localhost port) can reach this API. Native mobile/desktop builds don't need
// it; the React dashboard uses a Vite proxy. Localhost origins only. Remove if
// the web build isn't a deployment target.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '100kb' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/requests', requestRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/employees', employeeRoutes);
app.use('/api/v1/audit-events', auditEventRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/departments', departmentRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/config', configRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // WorkflowError carries its HTTP status; express.json's parse failures
  // carry 400 (the Section 7 malformed-JSON code). Anything else is a 500.
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MonitorFlow API listening on :${port}`));

// Escalation sweep (spec v4 E1): interval job, no cron infra. Default 5 min;
// ESCALATION_SWEEP_MS=0 disables (tests). First run shortly after boot so a
// fresh seed's over-threshold requests escalate visibly.
const { runEscalationSweep } = require('./lib/escalation');
const sweepMs =
  process.env.ESCALATION_SWEEP_MS === undefined ? 5 * 60e3 : Number(process.env.ESCALATION_SWEEP_MS);
if (sweepMs > 0) {
  const sweep = () =>
    runEscalationSweep()
      .then((n) => {
        const total = n.tree + n.confirm;
        if (total) {
          console.log(
            `escalation sweep: ${total} notification(s) — ${n.tree} SLA breach up-tree, ${n.confirm} awaiting-confirm`
          );
        }
      })
      .catch((err) => console.error(`escalation sweep failed: ${err.message}`));
  setTimeout(sweep, 3000);
  setInterval(sweep, sweepMs);
}

module.exports = app;
