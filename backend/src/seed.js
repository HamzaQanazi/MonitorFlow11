// Provisioning script (pivot v7). One deployment = one company. This seeds the
// clean handover state: the fixed capability catalogue, one empty company row
// with onboarding pending, and the Owner account (role 'admin') that logs in and
// runs the "Customize your app in 1 minute" wizard on first login.
//
// Run once per sale. Everything the wizard collects (company details, branches,
// features, branding, contact) is filled in later through the app, not here.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { CAPABILITIES } = require('./lib/capabilities');

// The Owner's credentials, handed to the buyer. Override per sale; the default
// is a dev convenience only. There is no self-service reset (documented MVP
// limitation), so a wrong value here means a manual DB fix.
const OWNER_NAME = process.env.SEED_OWNER_NAME || 'Account Owner';
const OWNER_EMAIL = (process.env.SEED_OWNER_EMAIL || 'owner@company.com').toLowerCase();
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD || 'Password123!';

// TRUNCATE wipes every table — correct for a first install, catastrophic on a
// live one, so it refuses a database that already has users unless forced.
const SEED_FORCE = process.env.SEED_FORCE === 'true';

async function seed() {
  if (!SEED_FORCE) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      console.error(
        `Refusing to seed: this database already has ${rows[0].n} user(s).\n` +
          'Seeding TRUNCATEs every table. Re-run with SEED_FORCE=true if you mean it.'
      );
      process.exit(1);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE audit_event, file_attachment, notification, request_comment,
               request_status_history, task, request, workflow_definition,
               form_definition, service_type, level_capability, employee_level,
               capability, branch, company, users, department
       RESTART IDENTITY CASCADE`
    );

    // Fixed capability catalogue (Gate 1 grants hang off these once staff exist).
    for (const key of CAPABILITIES) {
      await client.query('INSERT INTO capability (key) VALUES ($1)', [key]);
    }

    // The single empty company — onboarding pending. The wizard fills it in.
    const { rows: co } = await client.query(
      'INSERT INTO company (onboarding_completed) VALUES (FALSE) RETURNING id'
    );
    const companyId = co[0].id;

    // The Owner: role 'admin' (configures, outside the reporting tree, holds no
    // capabilities — I2), signs in with their email.
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, login_identifier, company_id)
       VALUES ($1, $2, $3, 'admin', $2, $4)`,
      [OWNER_NAME, OWNER_EMAIL, passwordHash, companyId]
    );

    await client.query('COMMIT');
    console.log(
      `Provisioned Owner "${OWNER_EMAIL}" (password: ${OWNER_PASSWORD}).\n` +
        'First login starts the onboarding wizard.'
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
