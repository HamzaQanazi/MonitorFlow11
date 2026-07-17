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

// Phase 4 transition model (CLAUDE.md §10): statuses carry `is_terminal`
// (category is gone); transitions are keyed and gated by two orthogonal
// fields — `required_capability` (Gate 1, an oversight capability or null)
// and `actor` (the party whose turn it is: 'requester' | 'assignee' | null).
// The old `allowed_role` split cleanly into these: user→actor:'requester',
// employee→actor:'assignee', monitor→required_capability (actor:null). The
// generic /requests/{id}/transitions call serves the actor-based transitions
// (capability:null); oversight (capability-gated) transitions are fired by
// the dedicated /assign, /priority, /status endpoints.
// Phase 5: `flags.sla` = minutes a request may sit in this status before the
// escalation sweep fires (null/absent = no SLA for the status).
const status = (key, label, flags = {}) => ({
  key,
  label,
  is_initial: flags.initial === true,
  is_terminal: flags.terminal === true,
  sla_minutes: flags.sla ?? null,
});

// `who` is exactly one of {actor:'requester'|'assignee'} or {capability:'…'}.
// `extra.form` names the FORM_DEFINITION form_type a transition requires
// (replaces requires_completion_form); `extra.note` keeps requires_note.
const transition = (key, from, to, who, extra = {}) => ({
  key,
  from,
  to,
  label: extra.label, // bilingual button label the client renders verbatim
  required_capability: who.capability ?? null,
  actor: who.actor ?? null,
  required_form_key: extra.form ?? null,
  requires_note: extra.note === true,
  // Phase 5: notification targets are RELATIONSHIPS resolved at fire time —
  // created_by | assigned_to | assignee_manager. Every transition notifies
  // the requester (§7 trigger table); `extra.notify` adds the others.
  notify: ['created_by', ...(extra.notify ?? [])],
});

const requester = { actor: 'requester' };
const assignee = { actor: 'assignee' };
const cap = (capability) => ({ capability });

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
    // SLAs (Phase 5): 4h to triage/assign, 20h on working statuses, 24h for
    // the requester's confirmation — same numbers as the old per-service
    // thresholds, now per status.
    status('submitted', L('Submitted', 'مُقدَّم'), { initial: true, sla: 240 }),
    status('approved', L('Approved', 'مُعتمَد'), { sla: 240 }),
    status('assigned', L('Assigned', 'مُسنَد'), { sla: 1200 }),
    status('accepted', L('Accepted', 'مقبول'), { sla: 1200 }),
    status('in_progress', L('In Progress', 'قيد التنفيذ'), { sla: 1200 }),
    status('awaiting_parts', L('Awaiting Parts', 'بانتظار القطع'), { sla: 1200 }),
    status('completed', L('Completed', 'مكتمل'), { sla: 1440 }),
    status('confirmed', L('Resolved', 'تم الحل'), { terminal: true }),
    status('rejected', L('Rejected', 'مرفوض'), { terminal: true }),
    status('cancelled', L('Cancelled', 'ملغى'), { terminal: true }),
  ],
  transitions: [
    transition('approve', 'submitted', 'approved', cap('override'),
      { label: L('Approve', 'اعتماد') }),
    transition('reject_request', 'submitted', 'rejected', cap('override'),
      { note: true, label: L('Reject request', 'رفض الطلب') }),
    transition('cancel', 'submitted', 'cancelled', requester,
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('cancel_oversight', 'submitted', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('assign', 'approved', 'assigned', cap('assign'),
      { notify: ['assigned_to'], label: L('Assign', 'إسناد') }),
    transition('cancel_approved', 'approved', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('accept', 'assigned', 'accepted', assignee,
      { label: L('Accept task', 'قبول المهمة') }),
    transition('reject', 'assigned', 'approved', assignee,
      { note: true, notify: ['assignee_manager'], label: L('Reject task', 'رفض المهمة') }),
    transition('cancel_assigned', 'assigned', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('start', 'accepted', 'in_progress', assignee,
      { label: L('Start work', 'بدء العمل') }),
    transition('hold', 'in_progress', 'awaiting_parts', assignee,
      { note: true, label: L('Put on hold', 'وضع قيد الانتظار') }),
    transition('complete', 'in_progress', 'completed', assignee,
      { form: 'completion', label: L('Complete task', 'إكمال المهمة') }),
    transition('resume', 'awaiting_parts', 'in_progress', assignee,
      { label: L('Resume work', 'استئناف العمل') }),
    transition('confirm', 'completed', 'confirmed', requester,
      { label: L('Confirm resolution', 'تأكيد الحل') }),
    transition('dispute', 'completed', 'in_progress', requester,
      { note: true, label: L('Report unresolved', 'الإبلاغ عن عدم الحل') }),
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
    status('booked', L('Booked', 'محجوز'), { initial: true, sla: 240 }),
    status('assigned', L('Assigned', 'مُسنَد'), { sla: 1200 }),
    status('accepted', L('Scheduled', 'مجدول'), { sla: 1200 }),
    status('en_route', L('On the Way', 'في الطريق'), { sla: 1200 }),
    status('in_service', L('Service in Progress', 'الخدمة قيد التنفيذ'), { sla: 1200 }),
    status('completed', L('Completed', 'مكتمل'), { sla: 1440 }),
    status('confirmed', L('Closed', 'مغلق'), { terminal: true }),
    status('cancelled', L('Cancelled', 'ملغى'), { terminal: true }),
  ],
  transitions: [
    transition('assign', 'booked', 'assigned', cap('assign'),
      { notify: ['assigned_to'], label: L('Assign', 'إسناد') }),
    transition('cancel', 'booked', 'cancelled', requester,
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('cancel_oversight', 'booked', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('accept', 'assigned', 'accepted', assignee,
      { label: L('Accept task', 'قبول المهمة') }),
    transition('reject', 'assigned', 'booked', assignee,
      { note: true, notify: ['assignee_manager'], label: L('Reject task', 'رفض المهمة') }),
    transition('cancel_assigned', 'assigned', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('depart', 'accepted', 'en_route', assignee,
      { label: L('On the way', 'في الطريق') }),
    transition('arrive', 'en_route', 'in_service', assignee,
      { label: L('Start service', 'بدء الخدمة') }),
    transition('complete', 'in_service', 'completed', assignee,
      { form: 'completion', label: L('Complete task', 'إكمال المهمة') }),
    transition('confirm', 'completed', 'confirmed', requester,
      { label: L('Confirm resolution', 'تأكيد الحل') }),
    transition('dispute', 'completed', 'in_service', requester,
      { note: true, label: L('Report unresolved', 'الإبلاغ عن عدم الحل') }),
  ],
};

// ---------------------------------------------------------------------------
// The company's departments + services. Add/remove blocks here per deployment.
// `department` is a stable key used for grouping and for the bilingual display
// name in DEPARTMENT_LABELS (seed.js). Escalation is per-status now (Phase 5):
// `sla` minutes on each workflow status above; a breach escalates up the
// manager tree via the sweep.
// ---------------------------------------------------------------------------

const services = [
  {
    // Phase 7: `key` is the stable string handle (config dedup / webhook payloads
    // / GET /config/services); `accepts_external_users` gates the public
    // catalogue + submission for self-registered users. Both seeded services are
    // public.
    key: 'equipment_repair',
    accepts_external_users: true,
    name: L('Equipment Repair', 'إصلاح المعدات'),
    department: 'IT',
    default_priority: 'medium',
    requestForm: equipmentRepairRequestForm,
    completionForm: equipmentRepairCompletionForm,
    workflow: equipmentRepairWorkflow,
  },
  {
    key: 'home_cleaning',
    accepts_external_users: true,
    name: L('Home Cleaning Visit', 'زيارة تنظيف منزلي'),
    department: 'Facilities',
    default_priority: 'low',
    requestForm: homeCleaningRequestForm,
    completionForm: homeCleaningCompletionForm,
    workflow: homeCleaningWorkflow,
  },
];

module.exports = { services };
