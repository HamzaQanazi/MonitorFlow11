// Forms & Checklists — creates the checklist service types the same way an
// admin would through the Add Service wizard (POST /services). seed.js can't
// do this itself: post-v7 it seeds zero employees, and a service_type needs a
// real employee as its owner_id (Gate 2's visibility anchor). Run this once
// after onboarding + hiring/promoting at least one oversight-capable
// (view_all) employee. Safe to re-run — existing keys are skipped.
//
//   cd backend && node src/seedChecklists.js
//   CHECKLIST_OWNER_EMAIL=someone@company.org node src/seedChecklists.js
require('dotenv').config();
const pool = require('./db');
const { withTx, logAudit } = require('./lib/audit');
const { validateFieldSchema } = require('./lib/formSchema');
const { validateWorkflowDefinition } = require('./lib/workflowSchema');

const OWNER_EMAIL = process.env.CHECKLIST_OWNER_EMAIL || null;

// Every checklist shares this workflow: the employee submits and it's
// immediately logged — no approval needed, so (unlike Time Off) no
// capability-gated transition at all.
const CHECKLIST_WORKFLOW = {
  statuses: [
    { key: 'submitted', label: { en: 'Submitted', ar: 'تم الإرسال' }, is_initial: true, is_terminal: false },
    { key: 'logged', label: { en: 'Logged', ar: 'مسجَّل' }, is_initial: false, is_terminal: true },
  ],
  transitions: [
    {
      key: 'log',
      from: 'submitted',
      to: 'logged',
      label: { en: 'Submit', ar: 'إرسال' },
      required_capability: null,
      actor: 'requester',
      required_form_key: null,
      requires_note: false,
      notify: [],
    },
  ],
};

// form_definition requires one row per form_type even though nothing here
// ever fires a transition with required_form_key: 'completion' — same
// unused-placeholder pattern Time Off used.
const PLACEHOLDER_COMPLETION_FIELDS = [
  { id: 'notes', label: { en: 'Notes', ar: 'ملاحظات' }, type: 'text', required: false },
];

const CHECKLISTS = [
  {
    key: 'kitchen_opening_checklist',
    name: { en: 'Kitchen Opening Checklist', ar: 'قائمة فتح المطبخ' },
    requestFields: [
      {
        id: 'doors_sealed',
        label: { en: 'Fridge and freezer doors sealed', ar: 'أبواب الثلاجة والفريزر مُحكمة' },
        type: 'checkbox',
        required: true,
      },
      {
        id: 'fridge_temp',
        label: { en: 'Fridge temperature (°C)', ar: 'درجة حرارة الثلاجة (°C)' },
        type: 'number',
        required: true,
        min: -30,
        max: 30,
      },
      {
        id: 'prep_photo',
        label: { en: 'Photo of prep station', ar: 'صورة محطة التحضير' },
        type: 'photo',
        required: true,
      },
      {
        id: 'notes',
        label: { en: 'Notes for the next shift', ar: 'ملاحظات للوردية القادمة' },
        type: 'multiline',
        required: false,
      },
    ],
  },
  {
    key: 'site_safety_walkthrough',
    name: { en: 'Site Safety Walkthrough', ar: 'جولة السلامة الميدانية' },
    requestFields: [
      {
        id: 'extinguishers_checked',
        label: { en: 'Fire extinguishers checked', ar: 'تم فحص طفايات الحريق' },
        type: 'checkbox',
        required: true,
      },
      {
        id: 'walkways_clear',
        label: { en: 'Walkways clear', ar: 'الممرات خالية' },
        type: 'checkbox',
        required: true,
      },
      {
        id: 'hazards_note',
        label: { en: 'Hazards found', ar: 'المخاطر الملاحظة' },
        type: 'multiline',
        required: false,
      },
      {
        id: 'site_photo',
        label: { en: 'Photo', ar: 'صورة' },
        type: 'photo',
        required: false,
      },
    ],
  },
];

async function resolveOwnerId() {
  if (OWNER_EMAIL) {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE role = 'employee' AND is_active AND lower(login_identifier) = lower($1)`,
      [OWNER_EMAIL]
    );
    if (!rows.length) throw new Error(`No active employee found with login "${OWNER_EMAIL}"`);
    return rows[0].id;
  }
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
       JOIN employee_level el ON el.id = u.level_id
       JOIN level_capability lc ON lc.level_id = el.id AND lc.capability_key = 'view_all'
      WHERE u.role = 'employee' AND u.is_active
      ORDER BY u.id
      LIMIT 1`
  );
  if (!rows.length) {
    throw new Error(
      'No oversight-capable (view_all) employee exists yet. Complete onboarding and hire/promote a ' +
        'Manager-level employee first, then re-run — or set CHECKLIST_OWNER_EMAIL to an existing employee.'
    );
  }
  return rows[0].id;
}

async function resolveDepartmentId() {
  const { rows } = await pool.query('SELECT id FROM department ORDER BY id LIMIT 1');
  if (!rows.length) throw new Error('No department exists yet — complete onboarding first.');
  return rows[0].id;
}

async function seedOne(def, ownerId, departmentId) {
  const { rows: existing } = await pool.query('SELECT id FROM service_type WHERE key = $1', [def.key]);
  if (existing.length) {
    console.log(`Skipping "${def.key}" — already exists (service_type ${existing[0].id}).`);
    return;
  }

  const errors = [
    ...validateFieldSchema(def.requestFields).map((e) => `requestFields ${e}`),
    ...validateFieldSchema(PLACEHOLDER_COMPLETION_FIELDS).map((e) => `completionFields ${e}`),
    ...validateWorkflowDefinition(CHECKLIST_WORKFLOW),
  ];
  if (errors.length) {
    throw new Error(`"${def.key}" failed validation:\n${errors.join('\n')}`);
  }

  const serviceTypeId = await withTx(async (tx) => {
    const { rows: st } = await tx.query(
      `INSERT INTO service_type
         (name, department_id, default_priority, enabled, owner_id, key,
          accepts_external_users, accepts_employee_submitters, feature_key)
       VALUES ($1::jsonb, $2, 'low', TRUE, $3, $4, FALSE, TRUE, 'forms_checklists')
       RETURNING id`,
      [JSON.stringify(def.name), departmentId, ownerId, def.key]
    );
    const id = st[0].id;

    await tx.query(
      `INSERT INTO form_definition (service_type_id, form_type, field_schema)
       VALUES ($1, 'request', $2::jsonb), ($1, 'completion', $3::jsonb)`,
      [id, JSON.stringify(def.requestFields), JSON.stringify(PLACEHOLDER_COMPLETION_FIELDS)]
    );
    await tx.query(
      `INSERT INTO workflow_definition (service_type_id, statuses, transitions)
       VALUES ($1, $2::jsonb, $3::jsonb)`,
      [id, JSON.stringify(CHECKLIST_WORKFLOW.statuses), JSON.stringify(CHECKLIST_WORKFLOW.transitions)]
    );

    await logAudit(tx, ownerId, 'service.created', 'service_type', id, { key: def.key });
    return id;
  });

  console.log(`Created "${def.key}" (service_type ${serviceTypeId}).`);
}

async function main() {
  try {
    const ownerId = await resolveOwnerId();
    const departmentId = await resolveDepartmentId();
    for (const def of CHECKLISTS) {
      // eslint-disable-next-line no-await-in-loop
      await seedOne(def, ownerId, departmentId);
    }
  } catch (err) {
    console.error(`seedChecklists failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
