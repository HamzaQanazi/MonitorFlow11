// The static catalogue behind the onboarding wizard (pivot v7). Lives in the
// backend as the single source of truth: the wizard fetches it via
// GET /onboarding/options (thin client, I4) and the save endpoint validates the
// owner's picks against it. Machine keys are plain ASCII (I5); every label is
// bilingual {en,ar} (I5) so the wizard renders in either language + RTL (I6).
//
// The feature list is IDENTICAL for every industry (product rule). Industry is
// classification data only — like the employee-range picklist below, nothing
// ever branches on it (I1). Sub-industry existed here too, for the same
// classification purpose, until it was dropped (2026-09-03, user-directed):
// nothing besides storage/display ever read it, so it was pure collection
// with no payoff.

const EMPLOYEE_RANGES = ['1-5', '6-10', '11-30', '31-50', '51-100', '101-250', '251-500', '500+'];

// industry key → { label }
const INDUSTRIES = [
  { key: 'healthcare', label: { en: 'Healthcare', ar: 'الرعاية الصحية' } },
  { key: 'accommodation', label: { en: 'Accommodation', ar: 'الإقامة والضيافة' } },
  { key: 'construction', label: { en: 'Construction', ar: 'البناء والإنشاءات' } },
  { key: 'food_beverage', label: { en: 'Food & Beverage', ar: 'الأغذية والمشروبات' } },
  { key: 'cleaning', label: { en: 'Cleaning Services', ar: 'خدمات التنظيف' } },
  { key: 'field_services', label: { en: 'Field Services', ar: 'الخدمات الميدانية' } },
  { key: 'municipality', label: { en: 'Municipality', ar: 'البلدية' } },
];

// Feature catalogue — same for all industries, grouped for display only.
const FEATURE_GROUPS = [
  {
    key: 'operations',
    label: { en: 'Operations', ar: 'العمليات' },
    features: [
      { key: 'time_clock', label: { en: 'Time Clock', ar: 'ساعة الدوام' } },
      { key: 'schedule', label: { en: 'Schedule', ar: 'الجدولة' } },
      { key: 'forms_checklists', label: { en: 'Forms & Checklists', ar: 'النماذج وقوائم التحقق' } },
      { key: 'task_management', label: { en: 'Task Management', ar: 'إدارة المهام' } },
    ],
  },
  {
    key: 'communication',
    label: { en: 'Communication', ar: 'التواصل' },
    features: [
      { key: 'events', label: { en: 'Events', ar: 'الفعاليات' } },
      { key: 'knowledge_base', label: { en: 'Knowledge Base', ar: 'قاعدة المعرفة' } },
    ],
  },
];
// Dropped from the catalogue (deliberate scope decision, not yet built):
// chat_updates (conflicts with the frozen no-WebSockets/no-push constraint,
// §3), hiring (ATS-scale — biggest remaining scope), recognitions (no real
// product/thesis value). Also dropped 2026-08-21 (removed, not "not yet
// built"): directory, training_onboarding — low product/thesis value for the
// effort, supervisor decision (CLAUDE.md §13). Also dropped 2026-09-03,
// user-directed: the hr_skills group and its sole feature, time_off — Time
// Off was never actually gated by this flag (it's a normal service type,
// always offered regardless of selection — CLAUDE.md §11), so the checkbox
// controlled nothing. A company that already had one of these keys stored in
// its `features` array (none did in this dev seed) keeps it — this only
// stops the wizard from offering them to new selections.

// Plan catalogue — step 7. Plans differ ONLY by employeeCap (the one thing
// the server actually enforces, on hire — see §9); they never gate which
// feature modules a company can pick (re-scoped 2026-09-03, user-directed —
// used to show a per-plan "includes: Operations, Communication" list, record
// only and never server-enforced, which implied a restriction that didn't
// exist). null employeeCap = unlimited.
const PLANS = [
  {
    key: 'starter',
    name: { en: 'Starter', ar: 'أساسي' },
    employeeCap: 10,
  },
  {
    key: 'growth',
    name: { en: 'Growth', ar: 'نمو' },
    employeeCap: 50,
  },
  {
    key: 'enterprise',
    name: { en: 'Enterprise', ar: 'مؤسسات' },
    employeeCap: null,
  },
];

// Flat lookup sets for validation.
const INDUSTRY_KEYS = new Set(INDUSTRIES.map((i) => i.key));
const FEATURE_KEYS = new Set(FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.key)));
const EMPLOYEE_RANGE_SET = new Set(EMPLOYEE_RANGES);
const PLAN_KEYS = new Set(PLANS.map((p) => p.key));

module.exports = {
  EMPLOYEE_RANGES,
  INDUSTRIES,
  FEATURE_GROUPS,
  PLANS,
  INDUSTRY_KEYS,
  FEATURE_KEYS,
  EMPLOYEE_RANGE_SET,
  PLAN_KEYS,
};
