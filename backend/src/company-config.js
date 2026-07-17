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
// --- This deployment: a MUNICIPALITY -------------------------------------
// One City Manager sees every request (root of the tree). Three departments,
// each with its own head who owns that department's services and sees only
// them: Public Works (field dispatch), Sanitation (scheduled pickup), and
// Licensing (approval-gated permits). Three structurally different workflows
// on one engine — that is the whole point (same code, different JSON).
// ===========================================================================

const L = (en, ar) => ({ en, ar });

// Phase 4 transition model (CLAUDE.md §10): statuses carry `is_terminal`
// (category is gone); transitions are keyed and gated by two orthogonal
// fields — `required_capability` (Gate 1, an oversight capability or null)
// and `actor` (the party whose turn it is: 'requester' | 'assignee' | null).
// The generic /requests/{id}/transitions call serves the actor-based
// transitions (capability:null); oversight (capability-gated) transitions are
// fired by the dedicated /assign, /priority, /status endpoints.
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

// ===========================================================================
// WORKFLOW W1 — Public Works field dispatch. No approval gate; the head
// assigns a crew, the crew drives out, and can pause for materials (hold
// loop). Shared by pothole / streetlight / water-leak.
// ===========================================================================
const dispatchWorkflow = {
  statuses: [
    status('reported', L('Reported', 'مُبلَّغ عنه'), { initial: true, sla: 240 }),
    status('assigned', L('Assigned', 'مُسنَد'), { sla: 1200 }),
    status('accepted', L('Accepted', 'مقبول'), { sla: 1200 }),
    status('en_route', L('On the Way', 'في الطريق'), { sla: 1200 }),
    status('in_progress', L('In Progress', 'قيد التنفيذ'), { sla: 1200 }),
    status('awaiting_materials', L('Awaiting Materials', 'بانتظار المواد'), { sla: 1200 }),
    status('completed', L('Completed', 'مكتمل'), { sla: 1440 }),
    status('confirmed', L('Resolved', 'تم الحل'), { terminal: true }),
    status('cancelled', L('Cancelled', 'ملغى'), { terminal: true }),
  ],
  transitions: [
    transition('assign', 'reported', 'assigned', cap('assign'),
      { notify: ['assigned_to'], label: L('Assign crew', 'إسناد لطاقم') }),
    transition('cancel', 'reported', 'cancelled', requester,
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('cancel_oversight', 'reported', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('accept', 'assigned', 'accepted', assignee,
      { label: L('Accept task', 'قبول المهمة') }),
    transition('reject', 'assigned', 'reported', assignee,
      { note: true, notify: ['assignee_manager'], label: L('Reject task', 'رفض المهمة') }),
    transition('cancel_assigned', 'assigned', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('depart', 'accepted', 'en_route', assignee,
      { label: L('On the way', 'في الطريق') }),
    transition('start', 'en_route', 'in_progress', assignee,
      { label: L('Start work', 'بدء العمل') }),
    transition('hold', 'in_progress', 'awaiting_materials', assignee,
      { note: true, label: L('Await materials', 'انتظار المواد') }),
    transition('resume', 'awaiting_materials', 'in_progress', assignee,
      { label: L('Resume work', 'استئناف العمل') }),
    transition('complete', 'in_progress', 'completed', assignee,
      { form: 'completion', label: L('Complete task', 'إكمال المهمة') }),
    transition('confirm', 'completed', 'confirmed', requester,
      { label: L('Confirm resolution', 'تأكيد الحل') }),
    transition('dispute', 'completed', 'in_progress', requester,
      { note: true, label: L('Report unresolved', 'الإبلاغ عن عدم الحل') }),
  ],
};

// ===========================================================================
// WORKFLOW W2 — Sanitation scheduled pickup. Deliberately leaner than W1: no
// en-route / hold states. Shared by bulky-waste / missed-collection.
// ===========================================================================
const pickupWorkflow = {
  statuses: [
    status('requested', L('Requested', 'مطلوب'), { initial: true, sla: 240 }),
    status('scheduled', L('Scheduled', 'مجدول'), { sla: 1200 }),
    status('accepted', L('Accepted', 'مقبول'), { sla: 1200 }),
    status('completed', L('Collected', 'تم الجمع'), { sla: 1440 }),
    status('confirmed', L('Closed', 'مغلق'), { terminal: true }),
    status('cancelled', L('Cancelled', 'ملغى'), { terminal: true }),
  ],
  transitions: [
    transition('assign', 'requested', 'scheduled', cap('assign'),
      { notify: ['assigned_to'], label: L('Schedule pickup', 'جدولة الجمع') }),
    transition('cancel', 'requested', 'cancelled', requester,
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('cancel_oversight', 'requested', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('accept', 'scheduled', 'accepted', assignee,
      { label: L('Accept task', 'قبول المهمة') }),
    transition('reject', 'scheduled', 'requested', assignee,
      { note: true, notify: ['assignee_manager'], label: L('Reject task', 'رفض المهمة') }),
    transition('cancel_scheduled', 'scheduled', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('complete', 'accepted', 'completed', assignee,
      { form: 'completion', label: L('Mark collected', 'تأكيد الجمع') }),
    transition('confirm', 'completed', 'confirmed', requester,
      { label: L('Confirm resolution', 'تأكيد الحل') }),
    transition('dispute', 'completed', 'accepted', requester,
      { note: true, label: L('Report unresolved', 'الإبلاغ عن عدم الحل') }),
  ],
};

// ===========================================================================
// WORKFLOW W3 — Licensing approval gate. The head reviews and either approves
// or REJECTS (a terminal state — the structural contrast with W1/W2); only
// then is an inspector assigned. Shared by building-permit / business-license.
// ===========================================================================
const approvalWorkflow = {
  statuses: [
    status('submitted', L('Submitted', 'مُقدَّم'), { initial: true, sla: 240 }),
    status('under_review', L('Under Review', 'قيد المراجعة'), { sla: 1440 }),
    status('approved', L('Approved', 'مُعتمَد'), { sla: 1200 }),
    status('assigned', L('Assigned', 'مُسنَد'), { sla: 1200 }),
    status('accepted', L('Accepted', 'مقبول'), { sla: 1200 }),
    status('completed', L('Inspected', 'تم التفتيش'), { sla: 1440 }),
    status('confirmed', L('Issued', 'صادر'), { terminal: true }),
    status('rejected', L('Rejected', 'مرفوض'), { terminal: true }),
    status('cancelled', L('Withdrawn', 'مسحوب'), { terminal: true }),
  ],
  transitions: [
    transition('review', 'submitted', 'under_review', cap('override'),
      { label: L('Start review', 'بدء المراجعة') }),
    transition('withdraw', 'submitted', 'cancelled', requester,
      { note: true, label: L('Withdraw application', 'سحب الطلب') }),
    transition('cancel_submitted', 'submitted', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('approve', 'under_review', 'approved', cap('override'),
      { label: L('Approve', 'اعتماد') }),
    transition('reject_request', 'under_review', 'rejected', cap('override'),
      { note: true, label: L('Reject application', 'رفض الطلب') }),
    transition('cancel_review', 'under_review', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('assign', 'approved', 'assigned', cap('assign'),
      { notify: ['assigned_to'], label: L('Assign inspector', 'إسناد لمفتش') }),
    transition('cancel_approved', 'approved', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('accept', 'assigned', 'accepted', assignee,
      { label: L('Accept task', 'قبول المهمة') }),
    transition('reject', 'assigned', 'approved', assignee,
      { note: true, notify: ['assignee_manager'], label: L('Reject task', 'رفض المهمة') }),
    transition('cancel_assigned', 'assigned', 'cancelled', cap('override'),
      { note: true, label: L('Cancel request', 'إلغاء الطلب') }),
    transition('complete', 'accepted', 'completed', assignee,
      { form: 'completion', label: L('Complete inspection', 'إنهاء التفتيش') }),
    transition('confirm', 'completed', 'confirmed', requester,
      { label: L('Confirm & receive', 'تأكيد واستلام') }),
    transition('dispute', 'completed', 'accepted', requester,
      { note: true, label: L('Report issue', 'الإبلاغ عن مشكلة') }),
  ],
};

// ---------------------------------------------------------------------------
// Request + completion forms per service (CLAUDE.md §8 field types). One
// `location` field max per form. `visible_to_employee: false` hides a field
// from the assigned worker's GET /tasks/{id} view.
// ---------------------------------------------------------------------------

const SEVERITY = [
  { value: 'minor', label: L('Minor', 'طفيف') },
  { value: 'moderate', label: L('Moderate', 'متوسط') },
  { value: 'severe', label: L('Severe', 'شديد') },
];

// --- Public Works: Pothole / road damage ---
const potholeRequestForm = [
  { id: 'severity', label: L('Severity', 'الخطورة'), type: 'dropdown', required: true, options: SEVERITY },
  { id: 'road_name', label: L('Road / street name', 'اسم الطريق / الشارع'), type: 'text', required: true, max: 120 },
  { id: 'description', label: L('Description', 'الوصف'), type: 'multiline', required: true, max: 1000 },
  { id: 'blocking_traffic', label: L('Blocking traffic?', 'يعيق حركة المرور؟'), type: 'checkbox', required: false },
  { id: 'photo', label: L('Photo', 'صورة'), type: 'photo', required: false },
  { id: 'site_location', label: L('Location on map', 'الموقع على الخريطة'), type: 'location', required: true },
];
const repairCompletionForm = [
  { id: 'work_performed', label: L('Work performed', 'العمل المنجز'), type: 'multiline', required: true, max: 1000 },
  { id: 'materials_used', label: L('Materials used', 'المواد المستخدمة'), type: 'text', required: false, max: 200 },
  { id: 'after_photo', label: L('Photo after work', 'صورة بعد العمل'), type: 'photo', required: false },
];

// --- Public Works: Streetlight outage ---
const streetlightRequestForm = [
  {
    id: 'issue', label: L('Issue', 'العطل'), type: 'dropdown', required: true,
    options: [
      { value: 'off', label: L('Light is off', 'الإنارة مطفأة') },
      { value: 'flickering', label: L('Flickering', 'وميض') },
      { value: 'damaged', label: L('Damaged pole/fixture', 'عمود/وحدة متضررة') },
      { value: 'exposed_wires', label: L('Exposed wires', 'أسلاك مكشوفة') },
    ],
  },
  { id: 'pole_id', label: L('Pole ID (if visible)', 'رقم العمود (إن وُجد)'), type: 'text', required: false, max: 40 },
  { id: 'description', label: L('Description', 'الوصف'), type: 'multiline', required: false, max: 1000 },
  { id: 'site_location', label: L('Location on map', 'الموقع على الخريطة'), type: 'location', required: true },
];
const streetlightCompletionForm = [
  { id: 'work_performed', label: L('Work performed', 'العمل المنجز'), type: 'multiline', required: true, max: 1000 },
  { id: 'after_photo', label: L('Photo after work', 'صورة بعد العمل'), type: 'photo', required: false },
];

// --- Public Works: Water leak ---
const waterLeakRequestForm = [
  {
    id: 'severity', label: L('Severity', 'الخطورة'), type: 'dropdown', required: true,
    options: [...SEVERITY, { value: 'burst', label: L('Burst main', 'انفجار خط رئيسي') }],
  },
  { id: 'description', label: L('Description', 'الوصف'), type: 'multiline', required: true, max: 1000 },
  { id: 'photo', label: L('Photo', 'صورة'), type: 'photo', required: false },
  { id: 'site_location', label: L('Location on map', 'الموقع على الخريطة'), type: 'location', required: true },
];

// --- Sanitation: Bulky waste pickup ---
const bulkyWasteRequestForm = [
  {
    id: 'item_type', label: L('Item type', 'نوع الأغراض'), type: 'dropdown', required: true,
    options: [
      { value: 'furniture', label: L('Furniture', 'أثاث') },
      { value: 'appliance', label: L('Appliance', 'أجهزة') },
      { value: 'garden_waste', label: L('Garden waste', 'مخلفات حديقة') },
      { value: 'construction', label: L('Construction debris', 'مخلفات بناء') },
      { value: 'other', label: L('Other', 'أخرى') },
    ],
  },
  { id: 'quantity', label: L('Number of items', 'عدد الأغراض'), type: 'number', required: true, min: 1, max: 20 },
  { id: 'preferred_date', label: L('Preferred date', 'التاريخ المفضل'), type: 'date', required: true },
  { id: 'address', label: L('Address', 'العنوان'), type: 'text', required: true, max: 200, visible_to_employee: true },
  { id: 'notes', label: L('Notes', 'ملاحظات'), type: 'multiline', required: false, max: 500 },
  { id: 'pickup_location', label: L('Pickup location', 'موقع الجمع'), type: 'location', required: true, visible_to_employee: true },
];
const bulkyWasteCompletionForm = [
  { id: 'items_collected', label: L('Items collected', 'الأغراض المجموعة'), type: 'number', required: true, min: 1, max: 50 },
  { id: 'notes', label: L('Notes', 'ملاحظات'), type: 'multiline', required: false, max: 500 },
];

// --- Sanitation: Missed collection complaint (no map field — variety) ---
const missedCollectionRequestForm = [
  {
    id: 'collection_type', label: L('Collection type', 'نوع الجمع'), type: 'dropdown', required: true,
    options: [
      { value: 'household', label: L('Household waste', 'نفايات منزلية') },
      { value: 'recycling', label: L('Recycling', 'إعادة تدوير') },
      { value: 'organic', label: L('Organic', 'عضوية') },
      { value: 'garden', label: L('Garden waste', 'مخلفات حديقة') },
    ],
  },
  { id: 'missed_date', label: L('Missed collection date', 'تاريخ الجمع الفائت'), type: 'date', required: true },
  { id: 'address', label: L('Address', 'العنوان'), type: 'text', required: true, max: 200, visible_to_employee: true },
  { id: 'notes', label: L('Notes', 'ملاحظات'), type: 'multiline', required: false, max: 500 },
];
const missedCollectionCompletionForm = [
  { id: 'resolution', label: L('Resolution', 'الإجراء المتخذ'), type: 'multiline', required: true, max: 1000 },
];

// --- Licensing: Building permit ---
const buildingPermitRequestForm = [
  {
    id: 'project_type', label: L('Project type', 'نوع المشروع'), type: 'dropdown', required: true,
    options: [
      { value: 'new_construction', label: L('New construction', 'بناء جديد') },
      { value: 'renovation', label: L('Renovation', 'ترميم') },
      { value: 'extension', label: L('Extension', 'توسعة') },
      { value: 'demolition', label: L('Demolition', 'هدم') },
    ],
  },
  { id: 'property_address', label: L('Property address', 'عنوان العقار'), type: 'text', required: true, max: 200 },
  { id: 'plot_area_m2', label: L('Plot area (m²)', 'مساحة الأرض (م²)'), type: 'number', required: true, min: 1, max: 100000 },
  { id: 'description', label: L('Project description', 'وصف المشروع'), type: 'multiline', required: true, max: 2000 },
  { id: 'site_plan', label: L('Site plan', 'مخطط الموقع'), type: 'photo', required: false },
];
const buildingPermitCompletionForm = [
  { id: 'permit_number', label: L('Permit number', 'رقم الرخصة'), type: 'text', required: true, max: 60 },
  { id: 'conditions', label: L('Conditions', 'الشروط'), type: 'multiline', required: false, max: 1000 },
];

// --- Licensing: Business license (owner ID hidden from the inspector) ---
const businessLicenseRequestForm = [
  { id: 'business_name', label: L('Business name', 'اسم النشاط التجاري'), type: 'text', required: true, max: 150 },
  {
    id: 'business_type', label: L('Business type', 'نوع النشاط'), type: 'dropdown', required: true,
    options: [
      { value: 'retail', label: L('Retail', 'تجزئة') },
      { value: 'food', label: L('Food & beverage', 'أغذية ومشروبات') },
      { value: 'office', label: L('Office / services', 'مكتب / خدمات') },
      { value: 'industrial', label: L('Industrial', 'صناعي') },
      { value: 'other', label: L('Other', 'أخرى') },
    ],
  },
  // Sensitive PII — visible to oversight but hidden from the field inspector.
  { id: 'owner_id_number', label: L('Owner ID number', 'رقم هوية المالك'), type: 'text', required: true, max: 40, visible_to_employee: false },
  { id: 'address', label: L('Business address', 'عنوان النشاط'), type: 'text', required: true, max: 200 },
  { id: 'description', label: L('Activity description', 'وصف النشاط'), type: 'multiline', required: false, max: 1000 },
];
const businessLicenseCompletionForm = [
  { id: 'license_number', label: L('License number', 'رقم الرخصة'), type: 'text', required: true, max: 60 },
  { id: 'valid_until', label: L('Valid until', 'صالحة حتى'), type: 'date', required: true },
];

// ---------------------------------------------------------------------------
// The municipality's departments + services. `department` is a stable key used
// for grouping and for the bilingual display name in DEPARTMENT_LABELS
// (seed.js). Phase 7: `key` is the stable string handle; `accepts_external_users`
// gates the public catalogue + submission for self-registered citizens.
// ---------------------------------------------------------------------------

const services = [
  {
    key: 'pothole', accepts_external_users: true,
    name: L('Pothole / Road Damage', 'حفرة / تلف الطريق'),
    department: 'Public Works', default_priority: 'medium',
    requestForm: potholeRequestForm, completionForm: repairCompletionForm, workflow: dispatchWorkflow,
  },
  {
    key: 'streetlight', accepts_external_users: true,
    name: L('Streetlight Outage', 'عطل إنارة الشارع'),
    department: 'Public Works', default_priority: 'low',
    requestForm: streetlightRequestForm, completionForm: streetlightCompletionForm, workflow: dispatchWorkflow,
  },
  {
    key: 'water_leak', accepts_external_users: true,
    name: L('Water Leak', 'تسرب مياه'),
    department: 'Public Works', default_priority: 'high',
    requestForm: waterLeakRequestForm, completionForm: repairCompletionForm, workflow: dispatchWorkflow,
  },
  {
    key: 'bulky_waste', accepts_external_users: true,
    name: L('Bulky Waste Pickup', 'جمع النفايات الكبيرة'),
    department: 'Sanitation', default_priority: 'low',
    requestForm: bulkyWasteRequestForm, completionForm: bulkyWasteCompletionForm, workflow: pickupWorkflow,
  },
  {
    key: 'missed_collection', accepts_external_users: true,
    name: L('Missed Collection', 'تفويت جمع النفايات'),
    department: 'Sanitation', default_priority: 'low',
    requestForm: missedCollectionRequestForm, completionForm: missedCollectionCompletionForm, workflow: pickupWorkflow,
  },
  {
    key: 'building_permit', accepts_external_users: true,
    name: L('Building Permit', 'رخصة بناء'),
    department: 'Licensing', default_priority: 'medium',
    requestForm: buildingPermitRequestForm, completionForm: buildingPermitCompletionForm, workflow: approvalWorkflow,
  },
  {
    key: 'business_license', accepts_external_users: true,
    name: L('Business License', 'رخصة تجارية'),
    department: 'Licensing', default_priority: 'medium',
    requestForm: businessLicenseRequestForm, completionForm: businessLicenseCompletionForm, workflow: approvalWorkflow,
  },
];

module.exports = { services };
