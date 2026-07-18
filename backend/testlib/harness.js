// Harness for the API/permission suite (CLAUDE.md §14).
//
// Lives outside test/ on purpose: `node --test` executes every .js file in a
// directory named `test`, so a helper placed there would be run as a suite.
//
// The server is spawned as a real subprocess rather than imported, because
// src/index.js calls app.listen() and starts the escalation interval at import
// time. Spawning also means the suite exercises the real wire — JSON limits,
// the 404 fallthrough, the error middleware — instead of a hand-built app.
// No production file changes are needed for any of this.
require('dotenv').config();
const { spawn } = require('child_process');
const { Client } = require('pg');
const path = require('path');

const BACKEND = path.join(__dirname, '..');

// `node --test` runs test FILES in parallel, so each suite needs its own
// database and port or two suites would drop each other's data mid-run and
// fight over the same listener. Both are derived from the suite name passed to
// setup(), so adding a suite needs no bookkeeping here.
let TEST_DB = 'monitorflow_test';
let PORT = Number(process.env.TEST_PORT || 3101);
let BASE = `http://127.0.0.1:${PORT}/api/v1`;

function useSuite(name) {
  if (!name) return;
  TEST_DB = `monitorflow_test_${name}`;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 100;
  PORT = 3100 + h;
  BASE = `http://127.0.0.1:${PORT}/api/v1`;
}

// The dev DATABASE_URL with the database swapped. Everything else (host, user,
// password) is reused, so the suite needs no extra configuration.
function testDbUrl(db = TEST_DB) {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

async function adminQuery(sql) {
  const c = new Client({ connectionString: testDbUrl('postgres') });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    // No shell: spawning through cmd.exe on Windows would make the child a
    // shell wrapper, and kill() would then terminate the wrapper while the real
    // node process kept running (and kept this process's pipes open forever).
    const p = spawn(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out}`))
    );
  });
}

// Drop and rebuild the test database, then migrate and seed it. Dropping first
// makes every run start from the same canonical state, so tests cannot leak
// into each other through the database.
async function resetTestDb() {
  await adminQuery(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`
  );
  await adminQuery(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await adminQuery(`CREATE DATABASE ${TEST_DB}`);
  const env = { DATABASE_URL: testDbUrl() };
  await run('node', ['src/migrate.js'], env);
  await run('node', ['src/seed.js'], env);
}

let server;

async function startServer() {
  server = spawn('node', ['src/index.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      DATABASE_URL: testDbUrl(),
      PORT: String(PORT),
      // Documented test hook (src/index.js): no background sweep firing
      // notifications underneath assertions.
      ESCALATION_SWEEP_MS: '0',
    },
    // See run(): no shell, or kill() cannot reach the server process.
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // Ready when an unauthenticated request is refused — that proves the routes
  // and the auth middleware are both mounted.
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/services`);
      if (r.status === 401) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) throw new Error('server did not start within 20s');
    await new Promise((r) => setTimeout(r, 200));
  }
}

function stopServer() {
  if (!server) return;
  server.kill();
  server = null;
}

// One-shot setup for a test file: canonical database + running server.
// `name` isolates this suite's database and port from every other suite.
async function setup(name) {
  useSuite(name);
  await resetTestDb();
  await startServer();
}

// Thin fetch wrapper. Returns { status, body } rather than throwing, because
// these tests assert on status codes far more often than on payloads.
async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const SEED_PASSWORD = 'Password123!';

// Seeded logins, by the role each plays in the permission matrix. Employees
// sign in with their allocated 4-digit number (migration 011); these are the
// numbers a fresh seed produces.
const WHO = {
  admin: 'admin@city.gov',        // configures; holds NO capabilities
  root: '1000',                   // Maya — Manager level, org root, sees all
  worksHead: '1100',              // Rami — Manager, Public Works
  worksField: '1101',             // Ziad — Field Officer (no capabilities), PW
  worksField2: '1102',            // Zaid — Field Officer, PW
  wasteHead: '1200',              // Widad — Manager, Sanitation (other subtree)
  wasteField: '1201',             // Sami — Field Officer, Sanitation
  licenceHead: '1300',            // Peter — Manager, Licensing
  resident: 'resident@city.gov',  // external user
};

async function login(identifier, password = SEED_PASSWORD) {
  const { status, body } = await api('POST', '/auth/login', {
    body: { identifier, password },
  });
  if (status !== 200) throw new Error(`login ${identifier} failed: ${status}`);
  return body.token;
}

// Log in everyone in WHO once; tests index into the result by role name.
async function loginAll() {
  const tokens = {};
  for (const [role, identifier] of Object.entries(WHO)) {
    tokens[role] = await login(identifier);
  }
  return tokens;
}

module.exports = { setup, stopServer, api, login, loginAll, WHO, SEED_PASSWORD, BASE, testDbUrl };
