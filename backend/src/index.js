require('dotenv').config();
const express = require('express');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const dashboardRoutes = require('./routes/dashboard');
const requestRoutes = require('./routes/requests');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/requests', requestRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`MonitorFlow API listening on :${port}`));

module.exports = app;
