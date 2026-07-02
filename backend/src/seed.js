// Seed script (CLAUDE.md Sections 8, 9.4, 15). The ONLY way config and demo
// data enter the database — form/workflow definitions have no write API.
// Idempotent: wipes all data and reseeds, so every run starts identical state.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { validateFieldSchema } = require('./lib/formSchema');
const { validateWorkflowDefinition } = require('./lib/workflowSchema');

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

async function seed() {
  const problems = validateAll();
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
    for (const acc of accounts) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [acc.name, acc.email, passwordHash, acc.role, acc.department ? departmentIds[acc.department] : null]
      );
      console.log(`seeded ${acc.role} account ${acc.email}`);
    }

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
