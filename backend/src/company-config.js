// ===========================================================================
// COMPANY CONFIGURATION — edit THIS file to set up a new deployment.
//
// This is the ONE file you change when handing MonitorFlow to a company:
// list the departments they have and the services each department provides.
// Then run `node src/seed.js` to write it into their database and they can
// start using it.
//
// There is no form/workflow builder UI by design (CLAUDE.md Section 2) — this
// file IS the authoring surface, and the seed script validates every field
// schema and workflow here before writing anything (Section 8 seed-time rules).
//
// Immutability (Section 2): once a service has any request, its form/workflow
// is frozen — to change a live service, add a new one and disable the old.
//
// To add a service: copy one of the blocks below, change the department name,
// the form fields (Section 8 field types), and the workflow (Section 9), then
// add it to the `services` array at the bottom. Departments are created
// automatically from the `department` name on each service.
// ===========================================================================

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
  // v5 map amendment. Optional here (required on Service B) — config variance
  // the demo points at. Id avoids the existing 'location' text field above.
  { id: 'site_location', label: 'Location on map', type: 'location', required: false },
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
  // v5 map amendment: required — the cleaner needs the exact visit spot.
  { id: 'visit_location', label: 'Visit location', type: 'location', required: true, visible_to_employee: true },
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
// The company's departments + services. Add/remove blocks here per deployment.
// `department` is created automatically the first time it appears. Escalation
// thresholds (hours; spec v4 E1) — null on any of the three turns that rule
// off for the service.
// ---------------------------------------------------------------------------

const services = [
  {
    name: 'Equipment Repair',
    department: 'IT',
    default_priority: 'medium',
    escalation: { unassigned: 4, stale: 20, confirm: 24 },
    requestForm: equipmentRepairRequestForm,
    completionForm: equipmentRepairCompletionForm,
    workflow: equipmentRepairWorkflow,
  },
  {
    name: 'Home Cleaning Visit',
    department: 'Facilities',
    default_priority: 'low',
    escalation: { unassigned: 4, stale: 20, confirm: 24 },
    requestForm: homeCleaningRequestForm,
    completionForm: homeCleaningCompletionForm,
    workflow: homeCleaningWorkflow,
  },
];

module.exports = { services };
