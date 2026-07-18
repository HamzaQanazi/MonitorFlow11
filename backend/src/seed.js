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

// The admin password on a real handover. Demo/dev accounts keep DEV_PASSWORD so
// every developer starts identical; the ADMIN account — the only one that ships
// to a client — takes SEED_ADMIN_PASSWORD when set, so the literal above can't
// reach production. There is no self-service reset (§15), so a wrong password
// here means a manual DB fix.
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || DEV_PASSWORD;

// This script TRUNCATEs every table. That is correct for a first install and
// catastrophic on a running system, so it refuses to touch a database that
// already has users unless SEED_FORCE=true is passed explicitly.
const SEED_FORCE = process.env.SEED_FORCE === 'true';

// Two levels: a Manager (every capability — oversight) and a Field Officer
// (none). The City Manager and the three department heads are all Managers;
// what differentiates who-sees-what is the reporting TREE (Gate 2), not the
// level. The capability catalogue itself is fixed (lib/capabilities.js).
const LEVEL_GRANTS = {
  Manager: CAPABILITIES,
  'Field Officer': [],
};

// Phase 3: department and level display names are bilingual {en, ar} in the DB.
// The keys above/on services stay English (stable lookup keys); these maps hold
// the stored name. `L` mirrors company-config.js.
const L = (en, ar) => ({ en, ar });
const DEPARTMENT_LABELS = {
  'Public Works': L('Public Works', 'الأشغال العامة'),
  Sanitation: L('Sanitation', 'النظافة'),
  Licensing: L('Licensing & Permits', 'التراخيص والتصاريح'),
};
const LEVEL_LABELS = {
  Manager: L('Manager', 'مدير'),
  'Field Officer': L('Field Officer', 'موظف ميداني'),
};

// Always seeded — a real handover needs the admin to create staff. Change the
// login/password before deploying to a client.
const adminAccount = {
  name: 'Adam Admin', login: 'admin@city.gov', email: 'admin@city.gov',
  role: 'admin', department: null,
};
// Everything below is demo/dev fixtures — seeded only when SEED_DEMO_DATA is on.
// Order matters: a manager must be inserted before its reports (manager_id FK).
// The City Manager is the root (no manager) and sees every request; each
// department head reports to her and owns that department's services; the field
// staff report to their head. Heads log in by email (web dashboard), field
// staff by EMP-id (mobile app).
const demoAccounts = [
  { name: 'Maya Manager', login: 'manager@city.gov', email: 'manager@city.gov',
    role: 'employee', department: null, level: 'Manager' },
  { name: 'Rami Roads', login: 'roads@city.gov', email: 'roads@city.gov',
    role: 'employee', department: 'Public Works', level: 'Manager', manager: 'manager@city.gov' },
  { name: 'Widad Waste', login: 'waste@city.gov', email: 'waste@city.gov',
    role: 'employee', department: 'Sanitation', level: 'Manager', manager: 'manager@city.gov' },
  { name: 'Peter Permits', login: 'permits@city.gov', email: 'permits@city.gov',
    role: 'employee', department: 'Licensing', level: 'Manager', manager: 'manager@city.gov' },
  // Two Public Works crew so reassignment can be exercised and demoed.
  { name: 'Ziad Field', login: 'EMP-2001', email: null, role: 'employee', department: 'Public Works',
    level: 'Field Officer', manager: 'roads@city.gov', phone: '+970 59 200 2001' },
  { name: 'Zaid Field', login: 'EMP-2002', email: null, role: 'employee', department: 'Public Works',
    level: 'Field Officer', manager: 'roads@city.gov', phone: '+970 59 200 2002' },
  { name: 'Sami Collector', login: 'EMP-2003', email: null, role: 'employee', department: 'Sanitation',
    level: 'Field Officer', manager: 'waste@city.gov', phone: '+970 59 200 2003' },
  { name: 'Lina Inspector', login: 'EMP-2004', email: null, role: 'employee', department: 'Licensing',
    level: 'Field Officer', manager: 'permits@city.gov', phone: '+970 59 200 2004' },
  { name: 'Rania Resident', login: 'resident@city.gov', email: 'resident@city.gov',
    role: 'user', department: null, phone: '+970 59 100 3000' },
];

// ---------------------------------------------------------------------------
// Demo requests — a realistic queue so the dashboard, lists, and timelines
// have data from day one (Section 15: demo data only ever enters via seed).
// `path` is the status walk from initial to current; a history row is written
// per step, with changed_by resolved from the transition's actor/capability. A
// task row is created whenever the walk reaches the assignment status (derived
// from the workflow's assign-capability transition — never a hardcoded key).
// ---------------------------------------------------------------------------

// Per-service form builders (keep demo.form shapes matched to each schema).
const potholeForm = (severity, road_name, description, coords, blocking = false) =>
  ({ severity, road_name, description, blocking_traffic: blocking, site_location: coords });
const lightForm = (issue, description, coords, pole_id) =>
  ({ issue, ...(pole_id ? { pole_id } : {}), ...(description ? { description } : {}), site_location: coords });
const leakForm = (severity, description, coords) => ({ severity, description, site_location: coords });
const bulkyForm = (item_type, quantity, preferred_date, address, coords, notes) =>
  ({ item_type, quantity, preferred_date, address, ...(notes ? { notes } : {}), pickup_location: coords });
const missedForm = (collection_type, missed_date, address, notes) =>
  ({ collection_type, missed_date, address, ...(notes ? { notes } : {}) });
const permitForm = (project_type, property_address, plot_area_m2, description) =>
  ({ project_type, property_address, plot_area_m2, description });
const licenseForm = (business_name, business_type, owner_id_number, address, description) =>
  ({ business_name, business_type, owner_id_number, address, ...(description ? { description } : {}) });

// Cumulative walks per workflow (keys are seed data, not application code).
const DISPATCH_WALK = ['reported', 'assigned', 'accepted', 'en_route', 'in_progress', 'completed', 'confirmed'];
const PICKUP_WALK = ['requested', 'scheduled', 'accepted', 'completed', 'confirmed'];
const APPROVAL_WALK = ['submitted', 'under_review', 'approved', 'assigned', 'accepted', 'completed', 'confirmed'];
const walkTo = (walk, key) => walk.slice(0, walk.indexOf(key) + 1);

const demoRequests = [
  // --- Public Works: Pothole (svc 0) ---
  { svc: 0, priority: 'high', daysAgo: 0, path: walkTo(DISPATCH_WALK, 'reported'),
    form: potholeForm('severe', 'Rafidia Street', 'Deep pothole across the right lane near the pharmacy.', { lat: 32.2222, lng: 35.2450 }, true) },
  { svc: 0, priority: 'medium', daysAgo: 3, path: walkTo(DISPATCH_WALK, 'assigned'), employee: 'EMP-2001',
    form: potholeForm('moderate', 'Faisal Street', 'Cracked asphalt forming a shallow hole.', { lat: 32.2205, lng: 35.2600 }) },
  { svc: 0, priority: 'high', daysAgo: 5, path: walkTo(DISPATCH_WALK, 'in_progress'), employee: 'EMP-2002',
    form: potholeForm('severe', 'Old City junction', 'Sinkhole widening after the rains.', { lat: 32.2211, lng: 35.2620 }, true) },
  { svc: 0, priority: 'low', daysAgo: 6, path: ['reported', 'cancelled'],
    form: potholeForm('minor', 'Tunis Street', 'Small dip, reported twice by mistake.', { lat: 32.2180, lng: 35.2555 }) },

  // --- Public Works: Streetlight (svc 1) ---
  { svc: 1, priority: 'low', daysAgo: 1, path: walkTo(DISPATCH_WALK, 'reported'),
    form: lightForm('off', 'Two poles dark in front of the school.', { lat: 32.2300, lng: 35.2480 }, 'PL-114') },
  { svc: 1, priority: 'medium', daysAgo: 4, path: walkTo(DISPATCH_WALK, 'accepted'), employee: 'EMP-2001',
    form: lightForm('flickering', 'Flickers all night.', { lat: 32.2255, lng: 35.2705 }) },
  { svc: 1, priority: 'low', daysAgo: 9, path: [...walkTo(DISPATCH_WALK, 'in_progress'), 'awaiting_materials'], employee: 'EMP-2002',
    form: lightForm('damaged', 'Pole leaning after a car hit it; fixture cracked.', { lat: 32.2150, lng: 35.2790 }, 'PL-207') },

  // --- Public Works: Water leak (svc 2) ---
  { svc: 2, priority: 'high', daysAgo: 0, path: walkTo(DISPATCH_WALK, 'en_route'), employee: 'EMP-2001',
    form: leakForm('burst', 'Main burst flooding the street, water rising fast.', { lat: 32.2410, lng: 35.2360 }) },
  { svc: 2, priority: 'medium', daysAgo: 8, path: walkTo(DISPATCH_WALK, 'completed'), employee: 'EMP-2002',
    form: leakForm('moderate', 'Steady leak from a valve box on the sidewalk.', { lat: 32.2088, lng: 35.2465 }),
    completion: { work_performed: 'Replaced the corroded valve and resealed the box.', materials_used: 'Gate valve, sealant' } },
  { svc: 2, priority: 'low', daysAgo: 15, path: walkTo(DISPATCH_WALK, 'confirmed'), employee: 'EMP-2001',
    form: leakForm('minor', 'Slow drip at a hydrant base.', { lat: 32.2550, lng: 35.2630 }),
    completion: { work_performed: 'Tightened the hydrant flange and tested pressure.', materials_used: 'None' } },

  // --- Sanitation: Bulky waste (svc 3) ---
  { svc: 3, priority: 'low', daysAgo: 0, path: walkTo(PICKUP_WALK, 'requested'),
    form: bulkyForm('furniture', 3, '2026-07-20', '12 Amman Street, Apt 4', { lat: 32.2121, lng: 35.2698 }, 'Two sofas and a table.') },
  { svc: 3, priority: 'medium', daysAgo: 3, path: walkTo(PICKUP_WALK, 'scheduled'), employee: 'EMP-2003',
    form: bulkyForm('appliance', 1, '2026-07-19', '9 Cedar Lane', { lat: 32.2460, lng: 35.1952 }) },
  { svc: 3, priority: 'low', daysAgo: 7, path: walkTo(PICKUP_WALK, 'completed'), employee: 'EMP-2003',
    form: bulkyForm('garden_waste', 5, '2026-07-12', '31 Harbor Road', { lat: 32.1758, lng: 35.2810 }, 'Branches by the gate.'),
    completion: { items_collected: 5, notes: 'All bags and branches removed.' } },
  { svc: 3, priority: 'low', daysAgo: 20, path: ['requested', 'cancelled'],
    form: bulkyForm('other', 2, '2026-06-30', '3 Fig Tree Lane', { lat: 32.1695, lng: 35.2545 }) },

  // --- Sanitation: Missed collection (svc 4) ---
  { svc: 4, priority: 'medium', daysAgo: 1, path: walkTo(PICKUP_WALK, 'accepted'), employee: 'EMP-2003',
    form: missedForm('household', '2026-07-15', '22 Palm Avenue', 'Bin left out, not collected.') },
  { svc: 4, priority: 'low', daysAgo: 12, path: walkTo(PICKUP_WALK, 'confirmed'), employee: 'EMP-2003',
    form: missedForm('recycling', '2026-07-04', '7 Birch Close'),
    completion: { resolution: 'Recycling collected same day and route note updated.' } },

  // --- Licensing: Building permit (svc 5) ---
  { svc: 5, priority: 'medium', daysAgo: 2, path: walkTo(APPROVAL_WALK, 'under_review'),
    form: permitForm('renovation', '5 Almond Court', 180, 'Interior renovation of a ground-floor shop into a cafe.') },
  { svc: 5, priority: 'high', daysAgo: 6, path: walkTo(APPROVAL_WALK, 'assigned'), employee: 'EMP-2004',
    form: permitForm('new_construction', 'North Ring Road, plot 42', 650, 'New two-storey retail building with basement parking.') },
  { svc: 5, priority: 'medium', daysAgo: 10, path: walkTo(APPROVAL_WALK, 'confirmed'), employee: 'EMP-2004',
    form: permitForm('extension', '18 Maple Walk', 95, 'Rear kitchen extension for a residence.'),
    completion: { permit_number: 'BP-2026-0142', conditions: 'Setback of 2m from the rear boundary.' } },
  { svc: 5, priority: 'low', daysAgo: 8, path: ['submitted', 'under_review', 'rejected'],
    form: permitForm('demolition', '40 Rosewood Drive', 300, 'Demolish an old warehouse; no structural survey attached.') },

  // --- Licensing: Business license (svc 6) ---
  { svc: 6, priority: 'low', daysAgo: 4, path: walkTo(APPROVAL_WALK, 'approved'),
    form: licenseForm('Olive Grove Cafe', 'food', '9-1122334', '14 Rafidia Street', 'Small cafe, 20 seats.') },
  { svc: 6, priority: 'medium', daysAgo: 14, path: walkTo(APPROVAL_WALK, 'completed'), employee: 'EMP-2004',
    form: licenseForm('Cedar Hardware', 'retail', '9-5566778', '2 Faisal Street'),
    completion: { license_number: 'BL-2026-0311', valid_until: '2027-07-01' } },
  { svc: 6, priority: 'low', daysAgo: 18, path: ['submitted', 'cancelled'],
    form: licenseForm('Quick Print', 'office', '9-9081726', '60 Tunis Street', 'Print and copy shop.') },
];

function validateAll() {
  const problems = [];
  for (const svc of services) {
    for (const [formType, fields] of [['request', svc.requestForm], ['completion', svc.completionForm]]) {
      for (const err of validateFieldSchema(fields)) {
        problems.push(`${svc.name.en} ${formType} form: ${err}`);
      }
    }
    for (const err of validateWorkflowDefinition(svc.workflow)) {
      problems.push(`${svc.name.en} workflow: ${err}`);
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
    const label = `demo request #${i + 1} (${svc.name.en})`;
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

  // Refuse to wipe a database that is already in use. Checked before BEGIN so
  // the message is the whole story: nothing was touched.
  if (!SEED_FORCE) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      console.error(
        `Refusing to seed: this database already has ${rows[0].n} user(s).\n` +
          'Seeding TRUNCATEs every table — all requests, history and audit rows would be lost.\n' +
          'If you really mean it, re-run with SEED_FORCE=true.'
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
        [JSON.stringify(LEVEL_LABELS[name])]
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
          [JSON.stringify(DEPARTMENT_LABELS[svc.department])]
        );
        departmentIds[svc.department] = rows[0].id;
      }
    }

    for (const svc of services) {
      const { rows } = await client.query(
        `INSERT INTO service_type (key, name, department_id, default_priority, enabled, accepts_external_users)
         VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
        [svc.key, JSON.stringify(svc.name), departmentIds[svc.department], svc.default_priority,
         svc.accepts_external_users !== false]
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
      console.log(`seeded service "${svc.name.en}" (id ${serviceTypeId})`);
    }

    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    // The admin is the one account that ships to a client, so it gets
    // ADMIN_PASSWORD; demo accounts stay on DEV_PASSWORD.
    const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const accountIds = {};
    for (const acc of [adminAccount, ...(SEED_DEMO_DATA ? demoAccounts : [])]) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id, phone,
           login_identifier, manager_id, level_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [acc.name, acc.email, acc.role === 'admin' ? adminPasswordHash : passwordHash, acc.role,
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
    const requesterId = accountIds['resident@city.gov'];
    // Oversight actions in demo history come from the service's owner (the
    // department head). This map is also the request-visibility anchor: set
    // each service's owner_id now that the heads exist. The City Manager sees
    // everything because every head is inside her subtree (Gate 2).
    const ownerByDept = {
      'Public Works': accountIds['roads@city.gov'],
      Sanitation: accountIds['waste@city.gov'],
      Licensing: accountIds['permits@city.gov'],
    };
    for (const svc of services) {
      await client.query('UPDATE service_type SET owner_id = $1 WHERE id = $2', [
        ownerByDept[svc.department], svc.id,
      ]);
    }

    // Audit trail matching how these accounts really enter the system: the
    // admin creates the City Manager + heads, each head creates its field staff.
    const adminId = accountIds['admin@city.gov'];
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
        `INSERT INTO request (user_id, service_type_id, form_response, status, priority, created_at, updated_at, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN $8::float8 IS NULL THEN NULL
                      ELSE ST_SetSRID(ST_MakePoint($9::float8, $8::float8), 4326)::geography END)
         RETURNING id`,
        [requesterId, svc.id, JSON.stringify(demo.form), currentStatus, demo.priority,
         created, times[times.length - 1], coords ? coords.lat : null, coords ? coords.lng : null]
      );
      const requestId = rows[0].id;

      for (let s = 0; s < demo.path.length; s++) {
        // First step is the initial status, written by the requester; each
        // later step's actor comes from the transition — a requester/assignee
        // party, or an oversight owner for capability-gated transitions.
        let changedBy = requesterId;
        if (s > 0) {
          const t = svc.workflow.transitions.find(
            (tr) => tr.from === demo.path[s - 1] && tr.to === demo.path[s]
          );
          changedBy = t.actor === 'requester' ? requesterId
            : t.actor === 'assignee' ? employeeId
            : ownerByDept[svc.department];
        }
        await client.query(
          `INSERT INTO request_status_history (request_id, status, changed_by, changed_at)
           VALUES ($1, $2, $3, $4)`,
          [requestId, demo.path[s], changedBy, times[s]]
        );
      }

      // The task appears once the walk reaches the workflow's assignment status
      // — the `to` of the transition that carries the `assign` capability.
      // Derived per workflow so W2 ("scheduled") works like W1/W3 ("assigned")
      // without hardcoding a status key (CLAUDE.md §2).
      const assignTr = svc.workflow.transitions.find((t) => t.required_capability === 'assign');
      const assignedStep = assignTr ? demo.path.indexOf(assignTr.to) : -1;
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
    const note = SEED_DEMO_DATA
      ? `All seeded accounts use password: ${DEV_PASSWORD}`
      : process.env.SEED_ADMIN_PASSWORD
        ? 'Admin account seeded with SEED_ADMIN_PASSWORD. Create the first employee via POST /config/employees, then build the tree from the Employees page.'
        : `WARNING: admin seeded with the built-in dev password (${DEV_PASSWORD}). Set SEED_ADMIN_PASSWORD before a real handover — there is no self-service reset.`;
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
