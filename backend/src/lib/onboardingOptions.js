// The static catalogue behind the onboarding wizard (pivot v7). Lives in the
// backend as the single source of truth: the wizard fetches it via
// GET /onboarding/options (thin client, I4) and the save endpoint validates the
// owner's picks against it. Machine keys are plain ASCII (I5); every label is
// bilingual {en,ar} (I5) so the wizard renders in either language + RTL (I6).
//
// The feature list is IDENTICAL for every industry (product rule). Industry only
// drives which sub-industries appear.

const EMPLOYEE_RANGES = ['1-5', '6-10', '11-30', '31-50', '51-100', '101-250', '251-500', '500+'];

// industry key → { label, subs: [{ key, label }] }
const INDUSTRIES = [
  {
    key: 'healthcare',
    label: { en: 'Healthcare', ar: 'الرعاية الصحية' },
    subs: [
      { key: 'hospital', label: { en: 'Hospital', ar: 'مستشفى' } },
      { key: 'clinic', label: { en: 'Clinic', ar: 'عيادة' } },
      { key: 'healthcare_staffing', label: { en: 'Healthcare Staffing', ar: 'توظيف الرعاية الصحية' } },
      { key: 'home_care', label: { en: 'Home Care', ar: 'الرعاية المنزلية' } },
    ],
  },
  {
    key: 'accommodation',
    label: { en: 'Accommodation', ar: 'الإقامة والضيافة' },
    subs: [
      { key: 'hotels', label: { en: 'Hotels', ar: 'فنادق' } },
      { key: 'short_term_rental', label: { en: 'Airbnb / Short-term Rental', ar: 'تأجير قصير المدى' } },
      { key: 'campgrounds', label: { en: 'Parks & Campgrounds', ar: 'منتزهات ومخيمات' } },
      { key: 'hostels', label: { en: 'Hostels', ar: 'بيوت شباب' } },
    ],
  },
  {
    key: 'construction',
    label: { en: 'Construction', ar: 'البناء والإنشاءات' },
    subs: [
      { key: 'general_contracting', label: { en: 'General Contracting', ar: 'المقاولات العامة' } },
      { key: 'electrical', label: { en: 'Electrical', ar: 'الكهرباء' } },
      { key: 'plumbing', label: { en: 'Plumbing', ar: 'السباكة' } },
      { key: 'hvac', label: { en: 'HVAC', ar: 'التدفئة والتبريد' } },
    ],
  },
  {
    key: 'food_beverage',
    label: { en: 'Food & Beverage', ar: 'الأغذية والمشروبات' },
    subs: [
      { key: 'restaurant', label: { en: 'Restaurant', ar: 'مطعم' } },
      { key: 'cafe', label: { en: 'Café', ar: 'مقهى' } },
      { key: 'catering', label: { en: 'Catering', ar: 'خدمات التموين' } },
      { key: 'fast_food', label: { en: 'Fast Food', ar: 'الوجبات السريعة' } },
    ],
  },
  {
    key: 'cleaning',
    label: { en: 'Cleaning Services', ar: 'خدمات التنظيف' },
    subs: [
      { key: 'commercial_cleaning', label: { en: 'Commercial Cleaning', ar: 'تنظيف تجاري' } },
      { key: 'residential_cleaning', label: { en: 'Residential Cleaning', ar: 'تنظيف منزلي' } },
      { key: 'facilities', label: { en: 'Facilities Management', ar: 'إدارة المرافق' } },
    ],
  },
  {
    key: 'field_services',
    label: { en: 'Field Services', ar: 'الخدمات الميدانية' },
    subs: [
      { key: 'maintenance', label: { en: 'Maintenance', ar: 'الصيانة' } },
      { key: 'landscaping', label: { en: 'Landscaping', ar: 'تنسيق الحدائق' } },
      { key: 'security', label: { en: 'Security', ar: 'الأمن' } },
      { key: 'logistics', label: { en: 'Logistics', ar: 'الخدمات اللوجستية' } },
    ],
  },
  {
    key: 'municipality',
    label: { en: 'Municipality', ar: 'البلدية' },
    subs: [
      { key: 'public_works', label: { en: 'Public Works', ar: 'الأشغال العامة' } },
      { key: 'parks_recreation', label: { en: 'Parks & Recreation', ar: 'الحدائق والترفيه' } },
      { key: 'waste_management', label: { en: 'Waste Management', ar: 'إدارة النفايات' } },
      { key: 'permits_licensing', label: { en: 'Permits & Licensing', ar: 'التراخيص والتصاريح' } },
    ],
  },
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
      { key: 'directory', label: { en: 'Directory', ar: 'الدليل' } },
      { key: 'events', label: { en: 'Events', ar: 'الفعاليات' } },
      { key: 'knowledge_base', label: { en: 'Knowledge Base', ar: 'قاعدة المعرفة' } },
    ],
  },
  {
    key: 'hr_skills',
    label: { en: 'HR & Skills', ar: 'الموارد البشرية والمهارات' },
    features: [
      { key: 'time_off', label: { en: 'Time Off Management', ar: 'إدارة الإجازات' } },
      { key: 'training_onboarding', label: { en: 'Training & Onboarding', ar: 'التدريب والتأهيل' } },
    ],
  },
];
// Dropped from the catalogue (deliberate scope decision, not yet built):
// chat_updates (conflicts with the frozen no-WebSockets/no-push constraint,
// §3), hiring (ATS-scale — biggest remaining scope), recognitions (no real
// product/thesis value). A company that already had one of these keys stored
// in its `features` array (none did in this dev seed) keeps it — this only
// stops the wizard from offering them to new selections.

// Plan catalogue — step 7. Record-only (no billing, no enforcement yet): each
// plan's employeeCap and featureGroups are descriptive text on the wizard card,
// not a limit the server checks. null employeeCap = unlimited.
const PLANS = [
  {
    key: 'starter',
    name: { en: 'Starter', ar: 'أساسي' },
    employeeCap: 10,
    featureGroups: ['operations'],
  },
  {
    key: 'growth',
    name: { en: 'Growth', ar: 'نمو' },
    employeeCap: 50,
    featureGroups: ['operations', 'communication'],
  },
  {
    key: 'enterprise',
    name: { en: 'Enterprise', ar: 'مؤسسات' },
    employeeCap: null,
    featureGroups: ['operations', 'communication', 'hr_skills'],
  },
];

// Flat lookup sets for validation.
const INDUSTRY_KEYS = new Set(INDUSTRIES.map((i) => i.key));
const SUBS_BY_INDUSTRY = new Map(INDUSTRIES.map((i) => [i.key, new Set(i.subs.map((s) => s.key))]));
const FEATURE_KEYS = new Set(FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.key)));
const EMPLOYEE_RANGE_SET = new Set(EMPLOYEE_RANGES);
const PLAN_KEYS = new Set(PLANS.map((p) => p.key));

module.exports = {
  EMPLOYEE_RANGES,
  INDUSTRIES,
  FEATURE_GROUPS,
  PLANS,
  INDUSTRY_KEYS,
  SUBS_BY_INDUSTRY,
  FEATURE_KEYS,
  EMPLOYEE_RANGE_SET,
  PLAN_KEYS,
};
