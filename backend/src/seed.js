// Seed script (CLAUDE.md Sections 8, 9.4, 15). The ONLY way config and demo
// data enter the database — form/workflow definitions have no write API.
// Idempotent: wipes all data and reseeds, so every run starts identical state.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { validateFieldSchema } = require('./lib/formSchema');
const { validateWorkflowDefinition } = require('./lib/workflowSchema');
const { validateFormResponse } = require('./lib/validateFormResponse');
const { CAPABILITIES } = require('./lib/capabilities');
// Departments + services live in company-config.js — the one file edited per
// deployment (Section 15: config only ever enters via the seed path).
const { services } = require('./company-config');

// SEED_DEMO_DATA=false → seed only departments, services, and the admin
// account (a clean handover to a real company). Default seeds the demo
// accounts + request queue too (dev/demo state). When off, editing
// company-config.js can't break the demo fixtures below — there are none.
const SEED_DEMO_DATA = process.env.SEED_DEMO_DATA !== 'false';

// The admin account is seed-only and configures the platform (it operates no
// queue); every other account's authority comes from a LEVEL (Gate 1) and its
// place in the reporting tree (Gate 2). All are dev fixtures so every developer
// and demo starts from identical state (Section 15).
const DEV_PASSWORD = 'Password123!';

// Two levels for the demo: an oversight lead (every capability — the old
// monitor's powers) and a field technician (none). A real deployment defines
// its own grades; the capability catalogue is fixed (lib/capabilities.js).
const LEVEL_GRANTS = {
  'Operations Lead': CAPABILITIES,
  'Field Technician': [],
};

// Always seeded — a real handover needs the admin to create staff. Change the
// login/password before deploying to a client.
const adminAccount = {
  name: 'Adel Admin', login: 'admin@monitorflow.dev', email: 'admin@monitorflow.dev',
  role: 'admin', department: null,
};
// Everything below is demo/dev fixtures — seeded only when SEED_DEMO_DATA is on.
// Order matters: a manager must be inserted before its reports (manager_id FK).
// Oversight leads own their department's queue and manage its field techs; the
// leads log in by email (they use the web dashboard), the techs by EMP-id.
const demoAccounts = [
  { name: 'Mona Manager', login: 'monitor@monitorflow.dev', email: 'monitor@monitorflow.dev',
    role: 'employee', department: 'IT', level: 'Operations Lead' },
  { name: 'Malak Manager', login: 'monitor2@monitorflow.dev', email: 'monitor2@monitorflow.dev',
    role: 'employee', department: 'Facilities', level: 'Operations Lead' },
  { name: 'Ehab Technician', login: 'EMP-1001', email: null, role: 'employee', department: 'IT',
    level: 'Field Technician', manager: 'monitor@monitorflow.dev', phone: '+970 59 200 1001' },
  // Second IT tech so reassignment can be exercised and demoed.
  { name: 'Rana Technician', login: 'EMP-1002', email: null, role: 'employee', department: 'IT',
    level: 'Field Technician', manager: 'monitor@monitorflow.dev', phone: '+970 59 200 1002' },
  { name: 'Fadia Cleaner', login: 'EMP-1003', email: null, role: 'employee', department: 'Facilities',
    level: 'Field Technician', manager: 'monitor2@monitorflow.dev', phone: '+970 59 200 1003' },
  { name: 'Uma User', login: 'user@monitorflow.dev', email: 'user@monitorflow.dev',
    role: 'user', department: null, phone: '+970 59 100 2000' },
];

// ---------------------------------------------------------------------------
// Demo requests — a realistic queue so the dashboard, lists, and timelines
// have data from day one (Section 15: demo data only ever enters via seed).
// `path` is the status walk from initial to current; a history row is written
// per step, with changed_by resolved from the transition's allowed_role. A
// task row is created whenever the walk passes through an assignment.
// ---------------------------------------------------------------------------

const aForm = (equipment_type, location, problem_description, urgent = false, coords = null) => ({
  equipment_type, location, problem_description, urgent,
  ...(coords ? { site_location: coords } : {}),
});
// coords is mandatory on B — visit_location is a required field.
const bForm = (preferred_date, pkg, num_rooms, has_pets, address, coords, gate_code) => ({
  preferred_date, package: pkg, num_rooms, has_pets, address, visit_location: coords,
  ...(gate_code ? { gate_code } : {}),
});

// Cumulative walks per service (keys are seed data, not application code).
const A_WALK = ['submitted', 'approved', 'assigned', 'accepted', 'in_progress', 'completed', 'confirmed'];
const B_WALK = ['booked', 'assigned', 'accepted', 'en_route', 'in_service', 'completed', 'confirmed'];
const walkTo = (walk, key) => walk.slice(0, walk.indexOf(key) + 1);

const demoRequests = [
  // Service A: Equipment Repair
  { svc: 0, priority: 'high', daysAgo: 0, path: walkTo(A_WALK, 'submitted'),
    form: aForm('printer', 'Room 214', 'Printer jams on every duplex job and shows error E-04.', true, { lat: 32.2322, lng: 35.2494 }) },
  { svc: 0, priority: 'medium', daysAgo: 1, path: walkTo(A_WALK, 'submitted'),
    form: aForm('laptop', 'Reception desk', 'Battery drains from full to empty in under an hour.', false, { lat: 32.2239, lng: 35.2606 }) },
  { svc: 0, priority: 'medium', daysAgo: 2, path: walkTo(A_WALK, 'approved'),
    form: aForm('desktop', 'Lab 3, seat 12', 'No display output after the last power cut; fans spin up.', false, { lat: 32.2155, lng: 35.2784 }) },
  { svc: 0, priority: 'high', daysAgo: 3, path: walkTo(A_WALK, 'assigned'), employee: 'EMP-1001',
    form: aForm('network', 'Server room B', 'Switch port 14 flapping — link drops every few minutes.', true, { lat: 32.2411, lng: 35.2367 }) },
  { svc: 0, priority: 'medium', daysAgo: 4, path: walkTo(A_WALK, 'accepted'), employee: 'EMP-1001',
    form: aForm('laptop', 'Room 108', 'Keyboard keys Q and W stopped responding.', false, { lat: 32.208, lng: 35.2461 }) },
  { svc: 0, priority: 'high', daysAgo: 5, path: walkTo(A_WALK, 'in_progress'), employee: 'EMP-1001',
    form: aForm('desktop', 'Finance office', 'PC restarts randomly under load, twice today.', true, { lat: 32.2547, lng: 35.2628 }) },
  { svc: 0, priority: 'low', daysAgo: 8, path: [...walkTo(A_WALK, 'in_progress'), 'awaiting_parts'], employee: 'EMP-1001',
    form: aForm('printer', 'Room 301', 'Faded print on the left half of every page — likely drum unit.', false, { lat: 32.1965, lng: 35.2912 }) },
  { svc: 0, priority: 'medium', daysAgo: 9, path: walkTo(A_WALK, 'completed'), employee: 'EMP-1001',
    form: aForm('laptop', 'Room 122', 'Screen flickers at low brightness levels.', false, { lat: 32.22, lng: 35.274 }),
    completion: { work_performed: 'Reseated the display cable and updated the panel driver; retested at all brightness levels.', parts_used: 'None' } },
  { svc: 0, priority: 'low', daysAgo: 14, path: walkTo(A_WALK, 'confirmed'), employee: 'EMP-1001',
    // ~300 m from Room 122 above — the IT map's cluster merge/split pair.
    form: aForm('desktop', 'Room 210', 'Very slow startup, over five minutes to desktop.', false, { lat: 32.2227, lng: 35.274 }),
    completion: { work_performed: 'Replaced failing HDD with SSD, cloned system, verified boot in 40 seconds.', parts_used: '480GB SSD' } },
  { svc: 0, priority: 'medium', daysAgo: 21, path: walkTo(A_WALK, 'confirmed'), employee: 'EMP-1001',
    form: aForm('network', 'Room 115', 'Wall port dead — no link light on any device.', false, { lat: 32.2655, lng: 35.2245 }),
    completion: { work_performed: 'Re-terminated the wall port and patched it through on the floor switch.', parts_used: 'RJ45 keystone' } },
  { svc: 0, priority: 'low', daysAgo: 6, path: ['submitted', 'rejected'],
    form: aForm('other', 'Cafeteria', 'Coffee machine displays descale warning.') },
  { svc: 0, priority: 'low', daysAgo: 17, path: ['submitted', 'cancelled'],
    form: aForm('laptop', 'Room 118', 'Trackpad cursor jumps occasionally.') },

  // Service B: Home Cleaning Visit
  { svc: 1, priority: 'low', daysAgo: 0, path: walkTo(B_WALK, 'booked'),
    form: bForm('2026-07-08', 'standard', 3, false, '14 Olive Street, Apt 2', { lat: 32.2121, lng: 35.2698 }) },
  { svc: 1, priority: 'medium', daysAgo: 2, path: walkTo(B_WALK, 'booked'),
    form: bForm('2026-07-06', 'deep', 5, true, '9 Cedar Lane', { lat: 32.246, lng: 35.1952 }, '4417') },
  { svc: 1, priority: 'low', daysAgo: 3, path: walkTo(B_WALK, 'assigned'), employee: 'EMP-1003',
    form: bForm('2026-07-05', 'standard', 2, false, '31 Harbor Road, floor 3', { lat: 32.1758, lng: 35.281 }) },
  { svc: 1, priority: 'low', daysAgo: 5, path: walkTo(B_WALK, 'accepted'), employee: 'EMP-1003',
    form: bForm('2026-07-04', 'standard', 4, true, '5 Almond Court', { lat: 32.2602, lng: 35.287 }) },
  { svc: 1, priority: 'medium', daysAgo: 1, path: walkTo(B_WALK, 'en_route'), employee: 'EMP-1003',
    form: bForm('2026-07-03', 'deep', 6, false, '22 Palm Avenue', { lat: 32.2215, lng: 35.2315 }, '0091') },
  { svc: 1, priority: 'high', daysAgo: 0, path: walkTo(B_WALK, 'in_service'), employee: 'EMP-1003',
    // ~300 m from 22 Palm Avenue above — the Facilities map's cluster pair.
    form: bForm('2026-07-03', 'deep', 8, true, '2 Jasmine Boulevard, villa 7', { lat: 32.2242, lng: 35.2315 }) },
  { svc: 1, priority: 'low', daysAgo: 7, path: walkTo(B_WALK, 'completed'), employee: 'EMP-1003',
    form: bForm('2026-06-27', 'standard', 3, false, '18 Maple Walk', { lat: 32.1888, lng: 35.239 }),
    completion: { rooms_cleaned: 3, notes: 'All rooms done; left windows ajar to air out the kitchen.' } },
  { svc: 1, priority: 'low', daysAgo: 12, path: walkTo(B_WALK, 'confirmed'), employee: 'EMP-1003',
    form: bForm('2026-06-22', 'standard', 2, false, '7 Birch Close', { lat: 32.2333, lng: 35.30 }),
    completion: { rooms_cleaned: 2 } },
  { svc: 1, priority: 'medium', daysAgo: 26, path: walkTo(B_WALK, 'confirmed'), employee: 'EMP-1003',
    form: bForm('2026-06-08', 'deep', 5, true, '40 Rosewood Drive', { lat: 32.203, lng: 35.21 }, '2203'),
    completion: { rooms_cleaned: 5, notes: 'Deep clean complete; pet hair filter replaced in the vacuum.' } },
  { svc: 1, priority: 'low', daysAgo: 24, path: ['booked', 'cancelled'],
    form: bForm('2026-06-12', 'standard', 1, false, '3 Fig Tree Lane', { lat: 32.1695, lng: 35.2545 }) },
];

function validateAll() {
  const problems = [];
  for (const svc of services) {
    for (const [formType, fields] of [['request', svc.requestForm], ['completion', svc.completionForm]]) {
      for (const err of validateFieldSchema(fields)) {
        problems.push(`${svc.name} ${formType} form: ${err}`);
      }
    }
    for (const err of validateWorkflowDefinition(svc.workflow)) {
      problems.push(`${svc.name} workflow: ${err}`);
    }
  }
  return problems;
}

// Demo requests are held to the same bar as API input: valid form responses,
// real status keys, and a legal transition for every step of the walk.
async function validateDemo() {
  const problems = [];
  for (const [i, demo] of demoRequests.entries()) {
    const svc = services[demo.svc];
    const label = `demo request #${i + 1} (${svc.name})`;
    const keys = new Set(svc.workflow.statuses.map((s) => s.key));
    for (const key of demo.path) {
      if (!keys.has(key)) problems.push(`${label}: unknown status "${key}"`);
    }
    for (let step = 1; step < demo.path.length; step++) {
      const [from, to] = [demo.path[step - 1], demo.path[step]];
      if (!svc.workflow.transitions.some((t) => t.from === from && t.to === to)) {
        problems.push(`${label}: no transition ${from} -> ${to}`);
      }
    }
    // No photo fields in demo data, so the db handle is never used.
    const stub = { query: () => { throw new Error('demo data must not reference attachments'); } };
    const formErrors = await validateFormResponse(svc.requestForm, demo.form, { db: stub, userId: 0 });
    for (const [field, msg] of Object.entries(formErrors)) problems.push(`${label}: ${field}: ${msg}`);
    if (demo.completion) {
      const errs = await validateFormResponse(svc.completionForm, demo.completion, { db: stub, userId: 0 });
      for (const [field, msg] of Object.entries(errs)) problems.push(`${label} completion: ${field}: ${msg}`);
    }
  }
  return problems;
}

async function seed() {
  const problems = [...validateAll(), ...(await validateDemo())];
  if (problems.length) {
    console.error('Seed validation failed:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE audit_event, file_attachment, notification, request_comment,
               request_status_history, task, request, workflow_definition,
               form_definition, service_type, level_capability, employee_level,
               capability, users, department
       RESTART IDENTITY CASCADE`
    );

    // Capability catalogue (fixed) + demo levels and their grants (Gate 1).
    // Seeded always: a real deployment needs levels to hang capabilities on.
    for (const key of CAPABILITIES) {
      await client.query('INSERT INTO capability (key) VALUES ($1)', [key]);
    }
    const levelIds = {};
    for (const [name, caps] of Object.entries(LEVEL_GRANTS)) {
      const { rows } = await client.query(
        'INSERT INTO employee_level (name) VALUES ($1) RETURNING id',
        [name]
      );
      levelIds[name] = rows[0].id;
      for (const cap of caps) {
        await client.query(
          'INSERT INTO level_capability (level_id, capability_key) VALUES ($1, $2)',
          [rows[0].id, cap]
        );
      }
    }

    const departmentIds = {};
    for (const svc of services) {
      if (!(svc.department in departmentIds)) {
        const { rows } = await client.query(
          'INSERT INTO department (name) VALUES ($1) RETURNING id',
          [svc.department]
        );
        departmentIds[svc.department] = rows[0].id;
      }
    }

    for (const svc of services) {
      const { rows } = await client.query(
        `INSERT INTO service_type (name, department_id, default_priority, enabled,
           escalate_unassigned_hours, escalate_stale_hours, escalate_confirm_hours)
         VALUES ($1, $2, $3, TRUE, $4, $5, $6) RETURNING id`,
        [svc.name, departmentIds[svc.department], svc.default_priority,
         svc.escalation.unassigned, svc.escalation.stale, svc.escalation.confirm]
      );
      const serviceTypeId = rows[0].id;
      svc.id = serviceTypeId;

      await client.query(
        `INSERT INTO form_definition (service_type_id, form_type, field_schema)
         VALUES ($1, 'request', $2), ($1, 'completion', $3)`,
        [serviceTypeId, JSON.stringify(svc.requestForm), JSON.stringify(svc.completionForm)]
      );

      await client.query(
        `INSERT INTO workflow_definition (service_type_id, statuses, transitions)
         VALUES ($1, $2, $3)`,
        [serviceTypeId, JSON.stringify(svc.workflow.statuses), JSON.stringify(svc.workflow.transitions)]
      );
      console.log(`seeded service "${svc.name}" (id ${serviceTypeId})`);
    }

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    const accountIds = {};
    for (const acc of [adminAccount, ...(SEED_DEMO_DATA ? demoAccounts : [])]) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id, phone,
           login_identifier, manager_id, level_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [acc.name, acc.email, passwordHash, acc.role,
         acc.department ? departmentIds[acc.department] : null, acc.phone || null,
         acc.login, acc.manager ? accountIds[acc.manager] : null,
         acc.level ? levelIds[acc.level] : null]
      );
      accountIds[acc.login] = rows[0].id;
      console.log(`seeded ${acc.role} account ${acc.login}`);
    }

    // Demo fixtures (accounts + request queue) only — real handovers stop at
    // departments + services + admin (SEED_DEMO_DATA=false).
    if (SEED_DEMO_DATA) {
    const requesterId = accountIds['user@monitorflow.dev'];
    // Oversight actions in demo history come from the service's owner (the
    // department's Operations Lead). This map is also the request-visibility
    // anchor: set each service's owner_id now that the leads exist.
    const ownerByDept = {
      IT: accountIds['monitor@monitorflow.dev'],
      Facilities: accountIds['monitor2@monitorflow.dev'],
    };
    for (const svc of services) {
      await client.query('UPDATE service_type SET owner_id = $1 WHERE id = $2', [
        ownerByDept[svc.department], svc.id,
      ]);
    }

    // Audit trail matching how these accounts really enter the system: the
    // admin creates the leads (manager = null), each lead creates its techs.
    const adminId = accountIds['admin@monitorflow.dev'];
    for (const acc of demoAccounts) {
      if (acc.role !== 'employee') continue;
      await client.query(
        `INSERT INTO audit_event (actor_id, action, entity_type, entity_id, detail)
         VALUES ($1, 'employee.created', 'user', $2, $3)`,
        [
          acc.manager ? accountIds[acc.manager] : adminId,
          accountIds[acc.login],
          JSON.stringify({ login: acc.login }),
        ]
      );
    }

    const HOUR = 3600e3;

    for (const [i, demo] of demoRequests.entries()) {
      const svc = services[demo.svc];
      const employeeId = demo.employee ? accountIds[demo.employee] : null;
      const created = new Date(Date.now() - demo.daysAgo * 24 * HOUR - ((i % 6) + 1) * HOUR);
      // History timestamps spread evenly between creation and now.
      const step = (Date.now() - created.getTime()) / demo.path.length;
      const times = demo.path.map((_, s) => new Date(created.getTime() + s * step));
      const currentStatus = demo.path[demo.path.length - 1];

      // v5 map amendment: denormalize the location field the same way
      // POST /requests does.
      const locField = svc.requestForm.find((f) => f.type === 'location');
      const coords = (locField && demo.form[locField.id]) || null;
      const { rows } = await client.query(
        `INSERT INTO request (user_id, service_type_id, form_response, status, priority, created_at, updated_at, location_lat, location_lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [requesterId, svc.id, JSON.stringify(demo.form), currentStatus, demo.priority,
         created, times[times.length - 1], coords ? coords.lat : null, coords ? coords.lng : null]
      );
      const requestId = rows[0].id;

      for (let s = 0; s < demo.path.length; s++) {
        // First step is the initial status, written by the requester; each
        // later step's actor comes from the transition's allowed_role.
        let changedBy = requesterId;
        if (s > 0) {
          const t = svc.workflow.transitions.find(
            (tr) => tr.from === demo.path[s - 1] && tr.to === demo.path[s]
          );
          changedBy = t.allowed_role === 'user' ? requesterId
            : t.allowed_role === 'employee' ? employeeId
            : ownerByDept[svc.department];
        }
        await client.query(
          `INSERT INTO request_status_history (request_id, status, changed_by, changed_at)
           VALUES ($1, $2, $3, $4)`,
          [requestId, demo.path[s], changedBy, times[s]]
        );
      }

      const assignedStep = demo.path.indexOf('assigned');
      if (assignedStep !== -1) {
        await client.query(
          `INSERT INTO task (request_id, employee_id, status, completion_form_response, assigned_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [requestId, employeeId, currentStatus,
           demo.completion ? JSON.stringify(demo.completion) : null, times[assignedStep]]
        );
      }
    }
    console.log(`seeded ${demoRequests.length} demo requests`);
    } // ponytail: inner block kept at its original indent — gate is a wrapper, not a rewrite

    await client.query('COMMIT');
    const note = SEED_DEMO_DATA ? `All seeded accounts use password: ${DEV_PASSWORD}` : 'Admin account seeded; add staff via the app.';
    console.log(`\nDone. ${note}`);
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
