// Seed script (CLAUDE.md Sections 8, 9.4, 15). The ONLY way config and demo
// data enter the database — form/workflow definitions have no write API.
// Idempotent: wipes all data and reseeds, so every run starts identical state.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { validateFieldSchema } = require('./lib/formSchema');
const { validateWorkflowDefinition } = require('./lib/workflowSchema');
const { validateFormResponse } = require('./lib/validateFormResponse');

const status = (key, label, category, flags = {}) => ({
  key,
  label,
  category,
  is_initial: flags.initial === true,
  is_final: flags.final === true,
});

const transition = (from, to, allowed_role, extra = {}) => ({
  from,
  to,
  allowed_role,
  action: extra.action || null,
  requires_note: extra.note === true,
  requires_completion_form: extra.form === true,
});

// ---------------------------------------------------------------------------
// Service A: Equipment Repair (IT) — approval gate, hold loop, rejected terminal
// ---------------------------------------------------------------------------

const equipmentRepairRequestForm = [
  {
    id: 'equipment_type',
    label: 'Equipment type',
    type: 'dropdown',
    required: true,
    options: [
      { value: 'laptop', label: 'Laptop' },
      { value: 'desktop', label: 'Desktop PC' },
      { value: 'printer', label: 'Printer' },
      { value: 'network', label: 'Network equipment' },
      { value: 'other', label: 'Other' },
    ],
  },
  { id: 'location', label: 'Room / location', type: 'text', required: true, max: 100 },
  { id: 'problem_description', label: 'Problem description', type: 'multiline', required: true, max: 1000 },
  { id: 'photo', label: 'Photo of the problem', type: 'photo', required: false },
  { id: 'urgent', label: 'Urgent?', type: 'checkbox', required: false },
];

const equipmentRepairCompletionForm = [
  { id: 'work_performed', label: 'Work performed', type: 'multiline', required: true, max: 1000 },
  { id: 'parts_used', label: 'Parts used', type: 'text', required: false, max: 200 },
  { id: 'after_photo', label: 'Photo after repair', type: 'photo', required: false },
];

const equipmentRepairWorkflow = {
  statuses: [
    status('submitted', 'Submitted', 'new', { initial: true }),
    status('approved', 'Approved', 'triage'),
    status('assigned', 'Assigned', 'triage'),
    status('accepted', 'Accepted', 'in_progress'),
    status('in_progress', 'In Progress', 'in_progress'),
    status('awaiting_parts', 'Awaiting Parts', 'in_progress'),
    status('completed', 'Completed', 'done'),
    status('confirmed', 'Resolved', 'closed', { final: true }),
    status('rejected', 'Rejected', 'terminated', { final: true }),
    status('cancelled', 'Cancelled', 'terminated', { final: true }),
  ],
  transitions: [
    transition('submitted', 'approved', 'monitor'),
    transition('submitted', 'rejected', 'monitor', { note: true }),
    transition('submitted', 'cancelled', 'user', { note: true }),
    transition('submitted', 'cancelled', 'monitor', { note: true }),
    transition('approved', 'assigned', 'monitor'),
    transition('approved', 'cancelled', 'monitor', { note: true }),
    transition('assigned', 'accepted', 'employee', { action: 'accept' }),
    transition('assigned', 'approved', 'employee', { action: 'reject', note: true }),
    transition('assigned', 'cancelled', 'monitor', { note: true }),
    transition('accepted', 'in_progress', 'employee'),
    transition('in_progress', 'awaiting_parts', 'employee', { note: true }),
    transition('in_progress', 'completed', 'employee', { action: 'complete', form: true }),
    transition('awaiting_parts', 'in_progress', 'employee'),
    transition('completed', 'confirmed', 'user', { action: 'confirm' }),
    transition('completed', 'in_progress', 'user', { action: 'dispute', note: true }),
  ],
};

// ---------------------------------------------------------------------------
// Service B: Home Cleaning Visit (Facilities) — no approval gate, field-visit
// states, no rejected terminal
// ---------------------------------------------------------------------------

const homeCleaningRequestForm = [
  { id: 'preferred_date', label: 'Preferred date', type: 'date', required: true },
  {
    id: 'package',
    label: 'Cleaning package',
    type: 'radio',
    required: true,
    options: [
      { value: 'standard', label: 'Standard cleaning' },
      { value: 'deep', label: 'Deep cleaning' },
    ],
  },
  { id: 'num_rooms', label: 'Number of rooms', type: 'number', required: true, min: 1, max: 20 },
  { id: 'has_pets', label: 'Pets at home?', type: 'checkbox', required: false },
  { id: 'address', label: 'Address', type: 'text', required: true, max: 200, visible_to_employee: true },
  // visible_to_employee: false demonstrates field-level filtering on GET /tasks/{id}
  { id: 'gate_code', label: 'Gate code', type: 'text', required: false, max: 20, visible_to_employee: false },
];

const homeCleaningCompletionForm = [
  { id: 'rooms_cleaned', label: 'Rooms cleaned', type: 'number', required: true, min: 1, max: 20 },
  { id: 'notes', label: 'Notes for the customer', type: 'multiline', required: false, max: 1000 },
];

const homeCleaningWorkflow = {
  statuses: [
    status('booked', 'Booked', 'new', { initial: true }),
    status('assigned', 'Assigned', 'triage'),
    status('accepted', 'Scheduled', 'in_progress'),
    status('en_route', 'On the Way', 'in_progress'),
    status('in_service', 'Service in Progress', 'in_progress'),
    status('completed', 'Completed', 'done'),
    status('confirmed', 'Closed', 'closed', { final: true }),
    status('cancelled', 'Cancelled', 'terminated', { final: true }),
  ],
  transitions: [
    transition('booked', 'assigned', 'monitor'),
    transition('booked', 'cancelled', 'user', { note: true }),
    transition('booked', 'cancelled', 'monitor', { note: true }),
    transition('assigned', 'accepted', 'employee', { action: 'accept' }),
    transition('assigned', 'booked', 'employee', { action: 'reject', note: true }),
    transition('assigned', 'cancelled', 'monitor', { note: true }),
    transition('accepted', 'en_route', 'employee'),
    transition('en_route', 'in_service', 'employee'),
    transition('in_service', 'completed', 'employee', { action: 'complete', form: true }),
    transition('completed', 'confirmed', 'user', { action: 'confirm' }),
    transition('completed', 'in_service', 'user', { action: 'dispute', note: true }),
  ],
};

// ---------------------------------------------------------------------------

const services = [
  {
    name: 'Equipment Repair',
    department: 'IT',
    default_priority: 'medium',
    requestForm: equipmentRepairRequestForm,
    completionForm: equipmentRepairCompletionForm,
    workflow: equipmentRepairWorkflow,
  },
  {
    name: 'Home Cleaning Visit',
    department: 'Facilities',
    default_priority: 'low',
    requestForm: homeCleaningRequestForm,
    completionForm: homeCleaningCompletionForm,
    workflow: homeCleaningWorkflow,
  },
];

// Monitor accounts are seed-only (Section 5); employees and a demo user are
// seeded so every developer/demo starts from identical state (Section 15).
const DEV_PASSWORD = 'Password123!';
const accounts = [
  { name: 'Mona Monitor', email: 'monitor@monitorflow.dev', role: 'monitor', department: null },
  { name: 'Ehab Technician', email: 'tech@monitorflow.dev', role: 'employee', department: 'IT' },
  { name: 'Fadia Cleaner', email: 'cleaner@monitorflow.dev', role: 'employee', department: 'Facilities' },
  { name: 'Uma User', email: 'user@monitorflow.dev', role: 'user', department: null },
];

// ---------------------------------------------------------------------------
// Demo requests — a realistic queue so the dashboard, lists, and timelines
// have data from day one (Section 15: demo data only ever enters via seed).
// `path` is the status walk from initial to current; a history row is written
// per step, with changed_by resolved from the transition's allowed_role. A
// task row is created whenever the walk passes through an assignment.
// ---------------------------------------------------------------------------

const aForm = (equipment_type, location, problem_description, urgent = false) => ({
  equipment_type, location, problem_description, urgent,
});
const bForm = (preferred_date, pkg, num_rooms, has_pets, address, gate_code) => ({
  preferred_date, package: pkg, num_rooms, has_pets, address,
  ...(gate_code ? { gate_code } : {}),
});

// Cumulative walks per service (keys are seed data, not application code).
const A_WALK = ['submitted', 'approved', 'assigned', 'accepted', 'in_progress', 'completed', 'confirmed'];
const B_WALK = ['booked', 'assigned', 'accepted', 'en_route', 'in_service', 'completed', 'confirmed'];
const walkTo = (walk, key) => walk.slice(0, walk.indexOf(key) + 1);

const demoRequests = [
  // Service A: Equipment Repair
  { svc: 0, priority: 'high', daysAgo: 0, path: walkTo(A_WALK, 'submitted'),
    form: aForm('printer', 'Room 214', 'Printer jams on every duplex job and shows error E-04.', true) },
  { svc: 0, priority: 'medium', daysAgo: 1, path: walkTo(A_WALK, 'submitted'),
    form: aForm('laptop', 'Reception desk', 'Battery drains from full to empty in under an hour.') },
  { svc: 0, priority: 'medium', daysAgo: 2, path: walkTo(A_WALK, 'approved'),
    form: aForm('desktop', 'Lab 3, seat 12', 'No display output after the last power cut; fans spin up.') },
  { svc: 0, priority: 'high', daysAgo: 3, path: walkTo(A_WALK, 'assigned'), employee: 'tech@monitorflow.dev',
    form: aForm('network', 'Server room B', 'Switch port 14 flapping — link drops every few minutes.', true) },
  { svc: 0, priority: 'medium', daysAgo: 4, path: walkTo(A_WALK, 'accepted'), employee: 'tech@monitorflow.dev',
    form: aForm('laptop', 'Room 108', 'Keyboard keys Q and W stopped responding.') },
  { svc: 0, priority: 'high', daysAgo: 5, path: walkTo(A_WALK, 'in_progress'), employee: 'tech@monitorflow.dev',
    form: aForm('desktop', 'Finance office', 'PC restarts randomly under load, twice today.', true) },
  { svc: 0, priority: 'low', daysAgo: 8, path: [...walkTo(A_WALK, 'in_progress'), 'awaiting_parts'], employee: 'tech@monitorflow.dev',
    form: aForm('printer', 'Room 301', 'Faded print on the left half of every page — likely drum unit.') },
  { svc: 0, priority: 'medium', daysAgo: 9, path: walkTo(A_WALK, 'completed'), employee: 'tech@monitorflow.dev',
    form: aForm('laptop', 'Room 122', 'Screen flickers at low brightness levels.'),
    completion: { work_performed: 'Reseated the display cable and updated the panel driver; retested at all brightness levels.', parts_used: 'None' } },
  { svc: 0, priority: 'low', daysAgo: 14, path: walkTo(A_WALK, 'confirmed'), employee: 'tech@monitorflow.dev',
    form: aForm('desktop', 'Room 210', 'Very slow startup, over five minutes to desktop.'),
    completion: { work_performed: 'Replaced failing HDD with SSD, cloned system, verified boot in 40 seconds.', parts_used: '480GB SSD' } },
  { svc: 0, priority: 'medium', daysAgo: 21, path: walkTo(A_WALK, 'confirmed'), employee: 'tech@monitorflow.dev',
    form: aForm('network', 'Room 115', 'Wall port dead — no link light on any device.'),
    completion: { work_performed: 'Re-terminated the wall port and patched it through on the floor switch.', parts_used: 'RJ45 keystone' } },
  { svc: 0, priority: 'low', daysAgo: 6, path: ['submitted', 'rejected'],
    form: aForm('other', 'Cafeteria', 'Coffee machine displays descale warning.') },
  { svc: 0, priority: 'low', daysAgo: 17, path: ['submitted', 'cancelled'],
    form: aForm('laptop', 'Room 118', 'Trackpad cursor jumps occasionally.') },

  // Service B: Home Cleaning Visit
  { svc: 1, priority: 'low', daysAgo: 0, path: walkTo(B_WALK, 'booked'),
    form: bForm('2026-07-08', 'standard', 3, false, '14 Olive Street, Apt 2') },
  { svc: 1, priority: 'medium', daysAgo: 2, path: walkTo(B_WALK, 'booked'),
    form: bForm('2026-07-06', 'deep', 5, true, '9 Cedar Lane', '4417') },
  { svc: 1, priority: 'low', daysAgo: 3, path: walkTo(B_WALK, 'assigned'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-07-05', 'standard', 2, false, '31 Harbor Road, floor 3') },
  { svc: 1, priority: 'low', daysAgo: 5, path: walkTo(B_WALK, 'accepted'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-07-04', 'standard', 4, true, '5 Almond Court') },
  { svc: 1, priority: 'medium', daysAgo: 1, path: walkTo(B_WALK, 'en_route'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-07-03', 'deep', 6, false, '22 Palm Avenue', '0091') },
  { svc: 1, priority: 'high', daysAgo: 0, path: walkTo(B_WALK, 'in_service'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-07-03', 'deep', 8, true, '2 Jasmine Boulevard, villa 7') },
  { svc: 1, priority: 'low', daysAgo: 7, path: walkTo(B_WALK, 'completed'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-06-27', 'standard', 3, false, '18 Maple Walk'),
    completion: { rooms_cleaned: 3, notes: 'All rooms done; left windows ajar to air out the kitchen.' } },
  { svc: 1, priority: 'low', daysAgo: 12, path: walkTo(B_WALK, 'confirmed'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-06-22', 'standard', 2, false, '7 Birch Close'),
    completion: { rooms_cleaned: 2 } },
  { svc: 1, priority: 'medium', daysAgo: 26, path: walkTo(B_WALK, 'confirmed'), employee: 'cleaner@monitorflow.dev',
    form: bForm('2026-06-08', 'deep', 5, true, '40 Rosewood Drive', '2203'),
    completion: { rooms_cleaned: 5, notes: 'Deep clean complete; pet hair filter replaced in the vacuum.' } },
  { svc: 1, priority: 'low', daysAgo: 24, path: ['booked', 'cancelled'],
    form: bForm('2026-06-12', 'standard', 1, false, '3 Fig Tree Lane') },
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
      `TRUNCATE file_attachment, notification, request_comment, request_status_history,
               task, request, workflow_definition, form_definition, service_type,
               users, department
       RESTART IDENTITY CASCADE`
    );

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
        `INSERT INTO service_type (name, department_id, default_priority, enabled)
         VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [svc.name, departmentIds[svc.department], svc.default_priority]
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
    for (const acc of accounts) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [acc.name, acc.email, passwordHash, acc.role, acc.department ? departmentIds[acc.department] : null]
      );
      accountIds[acc.email] = rows[0].id;
      console.log(`seeded ${acc.role} account ${acc.email}`);
    }

    const requesterId = accountIds['user@monitorflow.dev'];
    const monitorId = accountIds['monitor@monitorflow.dev'];
    const HOUR = 3600e3;

    for (const [i, demo] of demoRequests.entries()) {
      const svc = services[demo.svc];
      const employeeId = demo.employee ? accountIds[demo.employee] : null;
      const created = new Date(Date.now() - demo.daysAgo * 24 * HOUR - ((i % 6) + 1) * HOUR);
      // History timestamps spread evenly between creation and now.
      const step = (Date.now() - created.getTime()) / demo.path.length;
      const times = demo.path.map((_, s) => new Date(created.getTime() + s * step));
      const currentStatus = demo.path[demo.path.length - 1];

      const { rows } = await client.query(
        `INSERT INTO request (user_id, service_type_id, form_response, status, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [requesterId, svc.id, JSON.stringify(demo.form), currentStatus, demo.priority,
         created, times[times.length - 1]]
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
            : monitorId;
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

    await client.query('COMMIT');
    console.log(`\nDone. All seeded accounts use password: ${DEV_PASSWORD}`);
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
