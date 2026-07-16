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
// Phase 3: every user-facing label is bilingual — `L(en, ar)` builds the
// {en, ar} object the DB and clients expect. Machine keys (status keys, field
// ids, option values) stay plain ASCII.
//
// Immutability (Section 2): once a service has any request, its form/workflow
// is frozen — to change a live service, add a new one and disable the old.
//
// To add a service: copy one of the blocks below, change the department name,
// the form fields (Section 8 field types), and the workflow (Section 9), then
// add it to the `services` array at the bottom. Departments are created
// automatically from the `department` key on each service.
// ===========================================================================

const L = (en, ar) => ({ en, ar });

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
    label: L('Equipment type', 'نوع الجهاز'),
    type: 'dropdown',
    required: true,
    options: [
      { value: 'laptop', label: L('Laptop', 'حاسوب محمول') },
      { value: 'desktop', label: L('Desktop PC', 'حاسوب مكتبي') },
      { value: 'printer', label: L('Printer', 'طابعة') },
      { value: 'network', label: L('Network equipment', 'معدات الشبكة') },
      { value: 'other', label: L('Other', 'أخرى') },
    ],
  },
  { id: 'location', label: L('Room / location', 'الغرفة / الموقع'), type: 'text', required: true, max: 100 },
  { id: 'problem_description', label: L('Problem description', 'وصف المشكلة'), type: 'multiline', required: true, max: 1000 },
  { id: 'photo', label: L('Photo of the problem', 'صورة المشكلة'), type: 'photo', required: false },
  { id: 'urgent', label: L('Urgent?', 'عاجل؟'), type: 'checkbox', required: false },
  // v5 map amendment. Optional here (required on Service B) — config variance
  // the demo points at. Id avoids the existing 'location' text field above.
  { id: 'site_location', label: L('Location on map', 'الموقع على الخريطة'), type: 'location', required: false },
];

const equipmentRepairCompletionForm = [
  { id: 'work_performed', label: L('Work performed', 'العمل المنجز'), type: 'multiline', required: true, max: 1000 },
  { id: 'parts_used', label: L('Parts used', 'القطع المستخدمة'), type: 'text', required: false, max: 200 },
  { id: 'after_photo', label: L('Photo after repair', 'صورة بعد الإصلاح'), type: 'photo', required: false },
];

const equipmentRepairWorkflow = {
  statuses: [
    status('submitted', L('Submitted', 'مُقدَّم'), 'new', { initial: true }),
    status('approved', L('Approved', 'مُعتمَد'), 'triage'),
    status('assigned', L('Assigned', 'مُسنَد'), 'triage'),
    status('accepted', L('Accepted', 'مقبول'), 'in_progress'),
    status('in_progress', L('In Progress', 'قيد التنفيذ'), 'in_progress'),
    status('awaiting_parts', L('Awaiting Parts', 'بانتظار القطع'), 'in_progress'),
    status('completed', L('Completed', 'مكتمل'), 'done'),
    status('confirmed', L('Resolved', 'تم الحل'), 'closed', { final: true }),
    status('rejected', L('Rejected', 'مرفوض'), 'terminated', { final: true }),
    status('cancelled', L('Cancelled', 'ملغى'), 'terminated', { final: true }),
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
  { id: 'preferred_date', label: L('Preferred date', 'التاريخ المفضل'), type: 'date', required: true },
  {
    id: 'package',
    label: L('Cleaning package', 'باقة التنظيف'),
    type: 'radio',
    required: true,
    options: [
      { value: 'standard', label: L('Standard cleaning', 'تنظيف عادي') },
      { value: 'deep', label: L('Deep cleaning', 'تنظيف عميق') },
    ],
  },
  { id: 'num_rooms', label: L('Number of rooms', 'عدد الغرف'), type: 'number', required: true, min: 1, max: 20 },
  { id: 'has_pets', label: L('Pets at home?', 'حيوانات أليفة في المنزل؟'), type: 'checkbox', required: false },
  { id: 'address', label: L('Address', 'العنوان'), type: 'text', required: true, max: 200, visible_to_employee: true },
  // visible_to_employee: false demonstrates field-level filtering on GET /tasks/{id}
  { id: 'gate_code', label: L('Gate code', 'رمز البوابة'), type: 'text', required: false, max: 20, visible_to_employee: false },
  // v5 map amendment: required — the cleaner needs the exact visit spot.
  { id: 'visit_location', label: L('Visit location', 'موقع الزيارة'), type: 'location', required: true, visible_to_employee: true },
];

const homeCleaningCompletionForm = [
  { id: 'rooms_cleaned', label: L('Rooms cleaned', 'الغرف المُنظَّفة'), type: 'number', required: true, min: 1, max: 20 },
  { id: 'notes', label: L('Notes for the customer', 'ملاحظات للعميل'), type: 'multiline', required: false, max: 1000 },
];

const homeCleaningWorkflow = {
  statuses: [
    status('booked', L('Booked', 'محجوز'), 'new', { initial: true }),
    status('assigned', L('Assigned', 'مُسنَد'), 'triage'),
    status('accepted', L('Scheduled', 'مجدول'), 'in_progress'),
    status('en_route', L('On the Way', 'في الطريق'), 'in_progress'),
    status('in_service', L('Service in Progress', 'الخدمة قيد التنفيذ'), 'in_progress'),
    status('completed', L('Completed', 'مكتمل'), 'done'),
    status('confirmed', L('Closed', 'مغلق'), 'closed', { final: true }),
    status('cancelled', L('Cancelled', 'ملغى'), 'terminated', { final: true }),
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
// `department` is a stable key used for grouping and for the bilingual display
// name in DEPARTMENT_LABELS (seed.js). Escalation thresholds (hours; spec v4
// E1) — null on any of the three turns that rule off for the service.
// ---------------------------------------------------------------------------

const services = [
  {
    name: L('Equipment Repair', 'إصلاح المعدات'),
    department: 'IT',
    default_priority: 'medium',
    escalation: { unassigned: 4, stale: 20, confirm: 24 },
    requestForm: equipmentRepairRequestForm,
    completionForm: equipmentRepairCompletionForm,
    workflow: equipmentRepairWorkflow,
  },
  {
    name: L('Home Cleaning Visit', 'زيارة تنظيف منزلي'),
    department: 'Facilities',
    default_priority: 'low',
    escalation: { unassigned: 4, stale: 20, confirm: 24 },
    requestForm: homeCleaningRequestForm,
    completionForm: homeCleaningCompletionForm,
    workflow: homeCleaningWorkflow,
  },
];

module.exports = { services };
