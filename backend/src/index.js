require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const dashboardRoutes = require('./routes/dashboard');
const requestRoutes = require('./routes/requests');
const taskRoutes = require('./routes/tasks');
const employeeRoutes = require('./routes/employees');
const fileRoutes = require('./routes/files');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/requests', requestRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/employees', employeeRoutes);
app.use('/api/v1/files', fileRoutes);

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

module.exports = app;
