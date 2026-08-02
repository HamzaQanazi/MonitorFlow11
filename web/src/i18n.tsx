// Bilingual + RTL for the console (Phase 3). Two lookups:
//   t(key) — UI chrome, from the `dict` below (en + ar).
//   L(loc) — a data label the API returns as { en, ar }; picks the active lang.
// The provider stamps <html lang/dir> so CSS logical properties flip the whole
// console between LTR and RTL. Language choice persists in localStorage.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { brand } from './brand'

export type Lang = 'en' | 'ar'
// A bilingual label as stored in the DB / returned by the API.
export type Loc = { en: string; ar: string }

const KEY = 'mf.lang'

// UI chrome. Every key carries both languages (Full-Arabic console). Data
// labels (service names, status labels, form field labels, department names)
// are NOT here — they come from the API as Loc and go through L().
const dict: Record<string, Loc> = {
  // shell — the company name is NOT here: it is per-deployment branding, so it
  // lives in brand.ts and renders through <Wordmark>.
  console_suffix: { en: 'Monitor', ar: 'المراقبة' },
  nav_dashboard: { en: 'Dashboard', ar: 'لوحة القيادة' },
  nav_requests: { en: 'Requests', ar: 'الطلبات' },
  nav_employees: { en: 'Employees', ar: 'الموظفون' },
  nav_reports: { en: 'Reports', ar: 'التقارير' },
  nav_timeclock: { en: 'Time Clock', ar: 'ساعة الدوام' },
  nav_schedule: { en: 'Schedule', ar: 'الجدولة' },
  nav_checklists: { en: 'Checklists', ar: 'القوائم' },
  nav_audit: { en: 'Audit Log', ar: 'سجل التدقيق' },
  nav_add_service: { en: 'Add Service', ar: 'إضافة خدمة' },
  sign_out: { en: 'Sign out', ar: 'تسجيل الخروج' },
  lang_toggle: { en: 'العربية', ar: 'English' }, // shows the OTHER language

  // common
  loading: { en: 'Loading…', ar: 'جارٍ التحميل…' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  save: { en: 'Save', ar: 'حفظ' },
  close: { en: 'Close', ar: 'إغلاق' },
  confirm: { en: 'Confirm', ar: 'تأكيد' },
  done: { en: 'Done', ar: 'تم' },
  try_again: { en: 'Try again', ar: 'حاول مجددًا' },
  clear_filters: { en: 'Clear filters', ar: 'مسح عوامل التصفية' },
  previous: { en: 'Previous', ar: 'السابق' },
  next: { en: 'Next', ar: 'التالي' },
  all: { en: 'All', ar: 'الكل' },
  no_data: { en: 'No data', ar: 'لا توجد بيانات' },
  of: { en: 'of', ar: 'من' },
  matching: { en: 'matching', ar: 'مطابقة' },
  updated: { en: 'updated', ar: 'حُدّث' },
  pagination: { en: 'Pagination', ar: 'ترقيم الصفحات' },
  // compact duration units (resolution-time formatting)
  dur_min: { en: 'min', ar: 'د' },
  dur_hr: { en: 'h', ar: 'س' },
  dur_day: { en: 'd', ar: 'ي' },

  // request state (Phase 4: open/closed from is_terminal — category is gone)
  state_open: { en: 'Open', ar: 'مفتوح' },
  state_closed: { en: 'Closed', ar: 'مغلق' },

  // priorities
  pri_high: { en: 'High', ar: 'عالية' },
  pri_medium: { en: 'Medium', ar: 'متوسطة' },
  pri_low: { en: 'Low', ar: 'منخفضة' },

  // count nouns (Arabic ignores the singular/plural split English needs)
  request_word: { en: 'request', ar: 'طلب' },
  requests_word: { en: 'requests', ar: 'طلبات' },
  employee_word: { en: 'employee', ar: 'موظف' },
  employees_word: { en: 'employees', ar: 'موظفين' },
  event_word: { en: 'event', ar: 'حدث' },
  events_word: { en: 'events', ar: 'أحداث' },
  task_word: { en: 'task', ar: 'مهمة' },
  tasks_word: { en: 'tasks', ar: 'مهام' },

  // login
  login_tagline: {
    en: 'Service requests and field operations, on one board.',
    ar: 'طلبات الخدمة والعمليات الميدانية على لوحة واحدة.',
  },
  login_console: { en: 'Monitor console', ar: 'وحدة الإشراف' },
  login_signin: { en: 'Sign in', ar: 'تسجيل الدخول' },
  login_sub: {
    en: 'Oversee requests, assignments, and field work.',
    ar: 'أشرف على الطلبات والإسنادات والعمل الميداني.',
  },
  // Employees sign in with their 4-digit number, admins with an email.
  login_identifier: { en: 'Employee no. or email', ar: 'الرقم الوظيفي أو البريد الإلكتروني' },
  login_password: { en: 'Password', ar: 'كلمة المرور' },
  login_signing_in: { en: 'Signing in…', ar: 'جارٍ تسجيل الدخول…' },
  login_note: {
    en: 'Monitor accounts are provisioned by an administrator — there’s no self-registration here.',
    ar: 'تُنشأ حسابات الإشراف بواسطة المسؤول — لا يوجد تسجيل ذاتي هنا.',
  },
  login_show_password: { en: 'Show password', ar: 'إظهار كلمة المرور' },
  login_hide_password: { en: 'Hide password', ar: 'إخفاء كلمة المرور' },
  login_err_email: { en: 'Enter your employee number or email.', ar: 'أدخل رقمك الوظيفي أو بريدك الإلكتروني.' },
  login_err_password: { en: 'Enter your password.', ar: 'أدخل كلمة المرور.' },
  login_err_not_console: {
    en: 'This dashboard is for oversight and admin accounts. Requesters and field staff sign in from the mobile apps.',
    ar: 'هذه اللوحة مخصّصة لحسابات الإشراف والإدارة. يسجّل مقدّمو الطلبات والعاملون الميدانيون الدخول من تطبيقات الجوال.',
  },
  login_err_credentials: { en: 'Email or password is incorrect.', ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.' },
  login_err_rate: {
    en: 'Too many attempts. Wait a few minutes, then try again.',
    ar: 'محاولات كثيرة جدًا. انتظر بضع دقائق ثم حاول مجددًا.',
  },
  login_err_server: {
    en: 'Something went wrong on our side. Try again.',
    ar: 'حدث خطأ من جانبنا. حاول مجددًا.',
  },
  login_err_network: {
    en: 'Can’t reach the server. Check your connection and try again.',
    ar: 'تعذّر الوصول إلى الخادم. تحقّق من اتصالك ثم حاول مجددًا.',
  },

  // dashboard
  dash_overview: { en: 'Overview', ar: 'نظرة عامة' },
  dash_on_board: { en: 'on the board', ar: 'على اللوحة' },
  dash_by_state: { en: 'Requests by state', ar: 'الطلبات حسب الحالة' },
  dash_clear_h: { en: 'The board is clear', ar: 'اللوحة خالية' },
  dash_clear_p: {
    en: 'New requests appear here the moment users submit them, grouped by where they stand in their workflow. Activity charts and per-service breakdowns fill in as work arrives.',
    ar: 'تظهر الطلبات الجديدة هنا لحظة إرسال المستخدمين لها، مجمّعةً حسب موضعها في سير العمل. تمتلئ مخططات النشاط والتفصيلات حسب الخدمة كلما وصل عمل جديد.',
  },
  dash_load_err: { en: 'Couldn’t load the dashboard:', ar: 'تعذّر تحميل لوحة القيادة:' },
  dash_requests_created: { en: 'Requests created', ar: 'الطلبات المُنشأة' },
  dash_last_30: { en: 'last 30 days', ar: 'آخر 30 يومًا' },
  dash_total: { en: 'total', ar: 'الإجمالي' },
  dash_peak: { en: 'peak', ar: 'الذروة' },
  dash_on: { en: 'on', ar: 'في' },
  dash_by_service: { en: 'By service', ar: 'حسب الخدمة' },
  dash_by_priority: { en: 'By priority', ar: 'حسب الأولوية' },
  dash_by_department: { en: 'By department', ar: 'حسب الدائرة' },
  dash_by_requester: { en: 'By requester', ar: 'حسب مُقدّم الطلب' },
  dash_distribution: { en: 'Distribution', ar: 'التوزيع' },
  dash_resolution: { en: 'Resolution time', ar: 'زمن الحل' },
  dash_avg_resolution: { en: 'Avg. resolution', ar: 'متوسط زمن الحل' },
  dash_overall: { en: 'Overall', ar: 'الإجمالي' },
  dash_no_resolved: { en: 'Nothing resolved yet', ar: 'لا شيء محلول بعد' },
  dash_loading: { en: 'Loading dashboard…', ar: 'جارٍ تحميل لوحة القيادة…' },

  // requests
  req_title: { en: 'Requests', ar: 'الطلبات' },
  req_filter_state: { en: 'Filter by state', ar: 'تصفية حسب الحالة' },
  req_search_ph: { en: 'Search requester or service…', ar: 'ابحث عن مقدّم الطلب أو الخدمة…' },
  req_search_aria: { en: 'Search by requester or service name', ar: 'ابحث بالاسم أو اسم الخدمة' },
  req_filter_service: { en: 'Filter by service type', ar: 'تصفية حسب نوع الخدمة' },
  req_all_services: { en: 'All services', ar: 'كل الخدمات' },
  req_filter_priority: { en: 'Filter by priority', ar: 'تصفية حسب الأولوية' },
  req_any_priority: { en: 'Any priority', ar: 'أي أولوية' },
  req_filter_employee: { en: 'Filter by assigned employee', ar: 'تصفية حسب الموظف المُسنَد' },
  req_all_employees: { en: 'All employees', ar: 'كل الموظفين' },
  req_filter_requester: { en: 'Filter by who submitted it', ar: 'تصفية حسب مُقدّم الطلب' },
  req_all_requesters: { en: 'Anyone', ar: 'الجميع' },
  requester_user: { en: 'External user', ar: 'مستخدم خارجي' },
  requester_employee: { en: 'Employee', ar: 'موظف' },
  req_view_as: { en: 'View as', ar: 'العرض كـ' },
  req_list: { en: 'List', ar: 'قائمة' },
  req_map: { en: 'Map', ar: 'خريطة' },
  req_load_err: { en: 'Couldn’t load requests:', ar: 'تعذّر تحميل الطلبات:' },
  req_loading: { en: 'Loading requests…', ar: 'جارٍ تحميل الطلبات…' },
  req_no_match_h: { en: 'No matching requests', ar: 'لا طلبات مطابقة' },
  req_no_match_p: {
    en: 'Nothing on the board matches these filters. Loosen or clear them to see more.',
    ar: 'لا شيء على اللوحة يطابق عوامل التصفية هذه. خفّفها أو امسحها لعرض المزيد.',
  },
  req_clear_h: { en: 'The board is clear', ar: 'اللوحة خالية' },
  req_clear_p: {
    en: 'Requests appear here the moment users submit them, newest first, with their current workflow status. Filters above narrow the board by state, service, or priority.',
    ar: 'تظهر الطلبات هنا لحظة إرسالها، الأحدث أولًا، مع حالتها الحالية في سير العمل. تحصر عوامل التصفية أعلاه اللوحة حسب الحالة أو الخدمة أو الأولوية.',
  },
  col_id: { en: 'ID', ar: 'المعرّف' },
  col_service: { en: 'Service', ar: 'الخدمة' },
  col_requester: { en: 'Requester', ar: 'مقدّم الطلب' },
  col_status: { en: 'Status', ar: 'الحالة' },
  col_priority: { en: 'Priority', ar: 'الأولوية' },
  col_created: { en: 'Created', ar: 'أُنشئ' },
  col_age: { en: 'Age', ar: 'العمر' },

  // map view
  map_load_err: { en: 'Couldn’t load the map:', ar: 'تعذّر تحميل الخريطة:' },
  map_loading: { en: 'Loading map…', ar: 'جارٍ تحميل الخريطة…' },
  map_banner_pre: { en: 'Showing the first', ar: 'عرض أول' },
  map_banner_mid: { en: 'requests — narrow the filters to see the rest.', ar: 'طلب — ضيّق عوامل التصفية لرؤية الباقي.' },
  map_nothing_h: { en: 'Nothing to map', ar: 'لا شيء لعرضه على الخريطة' },
  map_nothing_p: {
    en: 'No requests matching these filters carry a location.',
    ar: 'لا يحمل أيّ طلب مطابق لعوامل التصفية هذه موقعًا.',
  },
  map_missing_none: { en: 'without a location is not shown.', ar: 'بدون موقع غير معروض.' },
  map_missing_some: { en: 'without a location are not shown.', ar: 'بدون موقع غير معروضة.' },

  // request detail pane
  detail_actions: { en: 'Actions', ar: 'الإجراءات' },
  detail_assignment: { en: 'Assignment', ar: 'الإسناد' },
  detail_request_details: { en: 'Request details', ar: 'تفاصيل الطلب' },
  detail_timeline: { en: 'Timeline', ar: 'الجدول الزمني' },
  detail_comments: { en: 'Comments', ar: 'التعليقات' },
  detail_attachments: { en: 'Attachments', ar: 'المرفقات' },
  detail_assigned_to: { en: 'Assigned to', ar: 'مُسنَد إلى' },
  detail_since: { en: 'since', ar: 'منذ' },
  detail_not_assigned: { en: 'Not assigned yet', ar: 'لم يُسنَد بعد' },
  detail_assign: { en: 'Assign', ar: 'إسناد' },
  detail_reassign: { en: 'Reassign', ar: 'إعادة إسناد' },
  detail_assigning: { en: 'Assigning…', ar: 'جارٍ الإسناد…' },
  detail_assign_to: { en: 'Assign to', ar: 'إسناد إلى' },
  detail_reassign_to: { en: 'Reassign to', ar: 'إعادة الإسناد إلى' },
  detail_choose_employee: { en: 'Choose an employee…', ar: 'اختر موظفًا…' },
  detail_no_other_emps: { en: 'No other employees in this department', ar: 'لا يوجد موظفون آخرون في هذه الدائرة' },
  detail_open: { en: 'open', ar: 'مفتوحة' },
  detail_suggested: { en: 'Suggested', ar: 'مقترح' },
  detail_assign_fail: {
    en: 'That employee can’t take this request (wrong department or inactive).',
    ar: 'لا يمكن لهذا الموظف استلام هذا الطلب (دائرة غير مطابقة أو غير مُفعّل).',
  },
  detail_assign_fail_generic: { en: 'Assignment failed', ar: 'فشل الإسناد' },
  detail_reopen_to: { en: 'Reopen to…', ar: 'إعادة الفتح إلى…' },
  detail_reopen_to_aria: { en: 'Reopen to status', ar: 'إعادة الفتح إلى حالة' },
  detail_reopen: { en: 'Reopen', ar: 'إعادة فتح' },
  detail_cancel_request: { en: 'Cancel request', ar: 'إلغاء الطلب' },
  detail_mark_as: { en: 'Mark as', ar: 'تعليم كـ' },
  detail_move_pre: { en: 'Move request', ar: 'نقل الطلب' },
  detail_to: { en: 'to', ar: 'إلى' },
  detail_reopen_pre: { en: 'Reopen request', ar: 'إعادة فتح الطلب' },
  detail_as: { en: 'as', ar: 'كـ' },
  detail_priority_aria: { en: 'Priority', ar: 'الأولوية' },
  detail_priority_suffix: { en: 'priority', ar: 'أولوية' },
  detail_opened: { en: 'opened', ar: 'فُتح' },
  detail_no_comments: { en: 'No comments yet.', ar: 'لا تعليقات بعد.' },
  detail_no_attachments: { en: 'No attachments.', ar: 'لا مرفقات.' },
  detail_write_comment_aria: { en: 'Write a comment', ar: 'اكتب تعليقًا' },
  detail_write_comment_ph: { en: 'Write a comment for the requester…', ar: 'اكتب تعليقًا لمقدّم الطلب…' },
  detail_post_comment: { en: 'Post comment', ar: 'نشر التعليق' },
  detail_posting: { en: 'Posting…', ar: 'جارٍ النشر…' },
  detail_comment_fail: { en: 'Couldn’t post the comment.', ar: 'تعذّر نشر التعليق.' },
  detail_priority_fail: { en: 'Couldn’t change the priority — try again.', ar: 'تعذّر تغيير الأولوية — حاول مجددًا.' },
  detail_before: { en: 'Before', ar: 'قبل' },
  detail_after: { en: 'After', ar: 'بعد' },
  detail_task: { en: 'Task', ar: 'مهمة' },
  detail_open_osm: { en: 'Open in OpenStreetMap ↗', ar: 'افتح في OpenStreetMap ↗' },
  detail_photo_attached: { en: 'Photo attached', ar: 'صورة مرفقة' },
  detail_yes: { en: 'Yes', ar: 'نعم' },
  detail_no: { en: 'No', ar: 'لا' },
  detail_keep_as_is: { en: 'Keep as is', ar: 'اتركه كما هو' },
  detail_working: { en: 'Working…', ar: 'جارٍ التنفيذ…' },
  detail_note_required: { en: 'A note is required for this action.', ar: 'مطلوب ملاحظة لهذا الإجراء.' },
  detail_note_ph: {
    en: 'Add a note explaining this action (required)',
    ar: 'أضف ملاحظة توضّح هذا الإجراء (مطلوبة)',
  },
  detail_note_aria: { en: 'Note (required)', ar: 'ملاحظة (مطلوبة)' },
  detail_action_fail: { en: 'Action failed', ar: 'فشل الإجراء' },
  detail_load_fail: { en: 'Couldn’t load this request:', ar: 'تعذّر تحميل هذا الطلب:' },
  detail_loading: { en: 'Loading request…', ar: 'جارٍ تحميل الطلب…' },
  detail_back_to_list: { en: 'Back to list', ar: 'العودة إلى القائمة' },
  detail_close_aria: { en: 'Close detail', ar: 'إغلاق التفاصيل' },
  detail_aria: { en: 'Request detail', ar: 'تفاصيل الطلب' },

  // employees
  emp_title: { en: 'Employees', ar: 'الموظفون' },
  emp_add: { en: 'Add employee', ar: 'إضافة موظف' },
  emp_search_ph: { en: 'Search name or email…', ar: 'ابحث بالاسم أو البريد…' },
  emp_search_aria: { en: 'Search by name or email', ar: 'ابحث بالاسم أو البريد الإلكتروني' },
  emp_filter_dept: { en: 'Filter by department', ar: 'تصفية حسب الدائرة' },
  emp_all_depts: { en: 'All departments', ar: 'كل الدوائر' },
  emp_load_err: { en: 'Couldn’t load employees:', ar: 'تعذّر تحميل الموظفين:' },
  emp_loading: { en: 'Loading employees…', ar: 'جارٍ تحميل الموظفين…' },
  emp_none_h: { en: 'No employees yet', ar: 'لا موظفين بعد' },
  emp_no_match_h: { en: 'No matching employees', ar: 'لا موظفين مطابقين' },
  emp_add_first_p: {
    en: 'Add your first employee to start assigning requests to them.',
    ar: 'أضف أول موظف لديك لتبدأ بإسناد الطلبات إليه.',
  },
  emp_loosen_p: { en: 'Loosen or clear the filters to see more.', ar: 'خفّف عوامل التصفية أو امسحها لعرض المزيد.' },
  col_name: { en: 'Name', ar: 'الاسم' },
  col_login: { en: 'Employee no.', ar: 'الرقم الوظيفي' },
  col_email: { en: 'Email', ar: 'البريد الإلكتروني' },
  col_department: { en: 'Department', ar: 'الدائرة' },
  col_actions: { en: 'Actions', ar: 'الإجراءات' },
  emp_active: { en: 'Active', ar: 'مُفعّل' },
  emp_inactive: { en: 'Inactive', ar: 'غير مُفعّل' },
  emp_edit: { en: 'Edit', ar: 'تعديل' },
  emp_deactivate: { en: 'Deactivate', ar: 'إلغاء التفعيل' },
  emp_activate: { en: 'Activate', ar: 'تفعيل' },
  emp_reset_password: { en: 'Reset password', ar: 'إعادة تعيين كلمة المرور' },
  emp_edit_h: { en: 'Edit employee', ar: 'تعديل الموظف' },
  emp_name: { en: 'Name', ar: 'الاسم' },
  emp_first_name: { en: 'First name', ar: 'الاسم الأول' },
  emp_last_name: { en: 'Last name', ar: 'اسم العائلة' },
  emp_email: { en: 'Email', ar: 'البريد الإلكتروني' },
  emp_initial_password: { en: 'Initial password', ar: 'كلمة المرور الأولية' },
  emp_phone_optional: { en: 'Phone (optional)', ar: 'الهاتف (اختياري)' },
  emp_birthdate_optional: { en: 'Birthdate (optional)', ar: 'تاريخ الميلاد (اختياري)' },
  emp_gender_optional: { en: 'Gender (optional)', ar: 'الجنس (اختياري)' },
  emp_worker_type_optional: { en: 'Worker type (optional)', ar: 'نوع العامل (اختياري)' },
  emp_manager_optional: { en: 'Manager (optional)', ar: 'المدير المباشر (اختياري)' },
  emp_manager_none: { en: 'No manager (organization root)', ar: 'بلا مدير (جذر التنظيم)' },
  emp_role_optional: { en: 'Role (optional)', ar: 'الدور (اختياري)' },
  emp_department: { en: 'Department', ar: 'الدائرة' },
  emp_save_changes: { en: 'Save changes', ar: 'حفظ التغييرات' },
  emp_create: { en: 'Create employee', ar: 'إنشاء موظف' },
  emp_created_h: { en: 'Employee created', ar: 'تم إنشاء الموظف' },
  emp_created_login_p: {
    en: 'Share this login with them — it won’t be shown again.',
    ar: 'شارك بيانات الدخول هذه معهم — لن تظهر مرة أخرى.',
  },
  gender_male: { en: 'Male', ar: 'ذكر' },
  gender_female: { en: 'Female', ar: 'أنثى' },
  worker_type_full_time: { en: 'Full-time', ar: 'دوام كامل' },
  worker_type_part_time: { en: 'Part-time', ar: 'دوام جزئي' },
  worker_type_contractor: { en: 'Contractor', ar: 'متعاقد' },
  emp_deactivate_q_pre: { en: 'Deactivate', ar: 'إلغاء تفعيل' },
  emp_deactivate_warn: {
    en: 'They will be unable to log in and cannot be assigned new tasks. You can reactivate them later.',
    ar: 'لن يتمكّن من تسجيل الدخول ولا يمكن إسناد مهام جديدة إليه. يمكنك إعادة تفعيله لاحقًا.',
  },
  emp_deactivate_open_tasks: {
    en: 'This employee still has open tasks. Reassign them before deactivating.',
    ar: 'لا يزال لدى هذا الموظف مهام مفتوحة. أعد إسنادها قبل إلغاء التفعيل.',
  },
  emp_reset_q_pre: { en: 'Reset password for', ar: 'إعادة تعيين كلمة مرور' },
  emp_temp_share: {
    en: 'Share this temporary password now — it is shown only once and cannot be retrieved again.',
    ar: 'شارك كلمة المرور المؤقتة هذه الآن — تُعرض مرة واحدة فقط ولا يمكن استرجاعها.',
  },
  emp_temp_will: {
    en: 'A new temporary password will be generated and shown once. The current password stops working immediately.',
    ar: 'ستُنشأ كلمة مرور مؤقتة جديدة وتُعرض مرة واحدة. تتوقّف كلمة المرور الحالية عن العمل فورًا.',
  },
  emp_tasks_load_err: { en: 'Couldn’t load tasks:', ar: 'تعذّر تحميل المهام:' },
  emp_loading_tasks: { en: 'Loading tasks…', ar: 'جارٍ تحميل المهام…' },
  emp_no_tasks: { en: 'No tasks have been assigned to this employee yet.', ar: 'لم تُسنَد أي مهمة إلى هذا الموظف بعد.' },
  col_request: { en: 'Request', ar: 'الطلب' },
  col_assigned: { en: 'Assigned', ar: 'مُسنَد' },
  col_avg_resolution: { en: 'Avg. resolution', ar: 'متوسط زمن الحل' },
  emp_no_resolved: { en: '—', ar: '—' },

  // reports
  rep_title: { en: 'Reports', ar: 'التقارير' },
  rep_export: { en: 'Export CSV', ar: 'تصدير CSV' },
  rep_export_pdf: { en: 'Export PDF', ar: 'تصدير PDF' },
  rep_exporting: { en: 'Exporting…', ar: 'جارٍ التصدير…' },
  rep_generated: { en: 'Generated', ar: 'أُنشئ في' },
  rep_filters_applied: { en: 'Filters', ar: 'عوامل التصفية' },
  rep_filters_none: { en: 'None', ar: 'لا شيء' },
  rep_from: { en: 'From', ar: 'من' },
  rep_to: { en: 'To', ar: 'إلى' },
  rep_filter_employee: { en: 'Filter by employee', ar: 'تصفية حسب الموظف' },
  rep_inactive_suffix: { en: '(inactive)', ar: '(غير مُفعّل)' },
  rep_from_date_aria: { en: 'From date', ar: 'من تاريخ' },
  rep_to_date_aria: { en: 'To date', ar: 'إلى تاريخ' },
  rep_summary: { en: 'Summary', ar: 'الملخّص' },
  rep_total_requests: { en: 'Total requests', ar: 'إجمالي الطلبات' },
  rep_by_state: { en: 'By state', ar: 'حسب الحالة' },
  rep_by_priority: { en: 'By priority', ar: 'حسب الأولوية' },
  rep_by_service: { en: 'By service', ar: 'حسب الخدمة' },
  rep_by_requester: { en: 'By requester', ar: 'حسب مُقدّم الطلب' },
  rep_load_err: { en: 'Couldn’t load reports:', ar: 'تعذّر تحميل التقارير:' },
  rep_loading: { en: 'Loading reports…', ar: 'جارٍ تحميل التقارير…' },
  rep_no_match_h: { en: 'No matching requests', ar: 'لا طلبات مطابقة' },
  rep_no_match_p: { en: 'Nothing matches these filters. Loosen or clear them to see more.', ar: 'لا شيء يطابق عوامل التصفية هذه. خفّفها أو امسحها لعرض المزيد.' },

  // time clock — Today tab (manager view)
  tc_title: { en: 'Time Clock', ar: 'ساعة الدوام' },
  tc_tab_today: { en: 'Today', ar: 'اليوم' },
  tc_tab_timesheets: { en: 'Timesheets', ar: 'الجداول الأسبوعية' },
  tc_date_aria: { en: 'Date', ar: 'التاريخ' },
  tc_load_err: { en: 'Couldn’t load time clock data:', ar: 'تعذّر تحميل بيانات ساعة الدوام:' },
  tc_loading: { en: 'Loading time clock…', ar: 'جارٍ تحميل ساعة الدوام…' },
  tc_none_h: { en: 'No employees yet', ar: 'لا موظفين بعد' },
  tc_none_p: { en: 'Employees appear here once they are added to your team.', ar: 'يظهر الموظفون هنا بعد إضافتهم إلى فريقك.' },
  tc_no_match_h: { en: 'No employees match this filter', ar: 'لا يوجد موظفون مطابقون لهذا الفلتر' },
  tc_counter_late_in: { en: 'Late clock-ins', ar: 'حضور متأخر' },
  tc_counter_late_out: { en: 'Late clock-outs', ar: 'انصراف متأخر' },
  tc_counter_attendance: { en: 'Attendance', ar: 'الحضور' },
  tc_counter_absences: { en: 'Absences', ar: 'الغياب' },
  tc_counter_working: { en: 'Currently working', ar: 'يعملون الآن' },
  tc_col_clock_in: { en: 'Clock-in', ar: 'وقت الحضور' },
  tc_col_clock_out: { en: 'Clock-out', ar: 'وقت الانصراف' },
  tc_col_total: { en: 'Total hours', ar: 'إجمالي الساعات' },
  tc_col_overtime: { en: 'Overtime', ar: 'الوقت الإضافي' },
  tc_col_break_in: { en: 'Break-in', ar: 'بداية الاستراحة' },
  tc_col_break_out: { en: 'Break-out', ar: 'نهاية الاستراحة' },
  tc_working_now: { en: 'Working now', ar: 'يعمل الآن' },
  tc_absent: { en: 'Absent', ar: 'غائب' },
  tc_not_clocked_in: { en: 'Not clocked in', ar: 'لم يسجّل حضورًا' },
  tc_hrs: { en: 'h', ar: 'س' },

  // time clock — Timesheets tab (manager view)
  tc_week_start: { en: 'Week starting', ar: 'أسبوع يبدأ من' },
  tc_col_weekly_total: { en: 'Weekly total', ar: 'الإجمالي الأسبوعي' },
  tc_col_weekly_overtime: { en: 'Weekly overtime', ar: 'الوقت الإضافي الأسبوعي' },
  tc_day_shifts_h: { en: 'Shifts', ar: 'الورديات' },
  tc_status_pending: { en: 'Pending approval', ar: 'بانتظار الموافقة' },
  tc_status_approved: { en: 'Approved', ar: 'مُعتمد' },
  tc_status_edited: { en: 'Edited', ar: 'مُعدَّل' },
  tc_approve: { en: 'Approve', ar: 'اعتماد' },
  tc_approving: { en: 'Approving…', ar: 'جارٍ الاعتماد…' },
  tc_edit_shift_h: { en: 'Edit shift', ar: 'تعديل الوردية' },
  tc_field_note: { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  tc_saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  tc_source_clock: { en: 'Clocked', ar: 'تسجيل مباشر' },
  tc_source_manual: { en: 'Manual entry', ar: 'إدخال يدوي' },
  tc_action_fail: { en: 'Action failed', ar: 'فشل الإجراء' },

  // Schedule
  sc_title: { en: 'Schedule', ar: 'الجدولة' },
  sc_tab_roster: { en: 'Roster', ar: 'الجدول' },
  sc_tab_templates: { en: 'Shift Templates', ar: 'قوالب الورديات' },
  sc_add_template: { en: 'Add template', ar: 'إضافة قالب' },
  sc_edit_template_h: { en: 'Edit template', ar: 'تعديل القالب' },
  sc_delete_template: { en: 'Delete', ar: 'حذف' },
  sc_delete_template_q_pre: { en: 'Delete', ar: 'حذف' },
  sc_template_in_use: { en: 'This template is used by scheduled shifts — clear those days first.', ar: 'هذا القالب مستخدم في ورديات مجدولة — يرجى إلغاؤها أولاً.' },
  sc_no_templates_h: { en: 'No shift templates yet', ar: 'لا توجد قوالب ورديات بعد' },
  sc_no_templates_p: { en: 'Add a template (e.g. "Morning 9–5") to start building the roster.', ar: 'أضف قالبًا (مثل "صباحي 9–5") للبدء بإعداد الجدول.' },
  sc_field_name_en: { en: 'Name (English)', ar: 'الاسم (إنجليزي)' },
  sc_field_name_ar: { en: 'Name (Arabic)', ar: 'الاسم (عربي)' },
  sc_field_start: { en: 'Start time', ar: 'وقت البدء' },
  sc_field_end: { en: 'End time', ar: 'وقت الانتهاء' },
  sc_field_template: { en: 'Shift template', ar: 'قالب الوردية' },
  sc_pick_template: { en: 'Choose a template…', ar: 'اختر قالبًا…' },
  sc_off: { en: '—', ar: '—' },
  sc_clear_day: { en: 'Clear day', ar: 'إلغاء اليوم' },
  sc_copy_last_week: { en: 'Copy last week', ar: 'نسخ الأسبوع الماضي' },
  sc_copying: { en: 'Copying…', ar: 'جارٍ النسخ…' },
  sc_copy_last_week_q: { en: 'Copy last week into this week?', ar: 'نسخ الأسبوع الماضي إلى هذا الأسبوع؟' },
  sc_copy_last_week_warn: { en: 'This overwrites any shift already assigned on a matching day this week.', ar: 'سيؤدي هذا إلى استبدال أي وردية مُعيّنة مسبقًا في نفس اليوم من هذا الأسبوع.' },

  cl_title: { en: 'Checklists', ar: 'القوائم' },
  cl_load_err: { en: 'Could not load checklists.', ar: 'تعذّر تحميل القوائم.' },
  cl_loading: { en: 'Loading checklists…', ar: 'جارٍ تحميل القوائم…' },
  cl_none_h: { en: 'No checklists set up yet', ar: 'لا توجد قوائم بعد' },
  cl_none_p: { en: 'Checklist templates are added through Add Service.', ar: 'تُضاف قوالب القوائم عبر إضافة خدمة.' },
  cl_submitted_today: { en: 'Submitted today', ar: 'مُرسَلة اليوم' },
  cl_logged_today: { en: 'Logged today', ar: 'مسجَّلة اليوم' },
  cl_all_time: { en: 'All-time:', ar: 'الإجمالي:' },
  cl_last: { en: 'Last:', ar: 'آخر:' },
  cl_new_open: { en: '+ New checklist', ar: '+ قائمة جديدة' },
  cl_new_h: { en: 'New checklist template', ar: 'قالب قائمة جديد' },
  cl_new_err_required: { en: 'Name (both languages) and owner are required.', ar: 'الاسم (باللغتين) والمسؤول مطلوبان.' },
  cl_new_err_save: { en: 'Could not save the checklist.', ar: 'تعذّر حفظ القائمة.' },
  cl_add_item: { en: '+ Add item', ar: '+ إضافة عنصر' },
  cl_save_template: { en: 'Save template', ar: 'حفظ القالب' },
  cl_saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },

  // levels & capabilities (Gate 1 configuration — admin only)
  lvl_title: { en: 'Levels & Capabilities', ar: 'المستويات والصلاحيات' },
  lvl_sub: {
    en: 'What each level is allowed to do, and which level each employee holds.',
    ar: 'ما المسموح به لكل مستوى، وأي مستوى يشغله كل موظف.',
  },
  lvl_legend: {
    en: 'A capability is granted by a level, never by a person or a job title. Ticking a box changes what every employee at that level may do, on their next request — no sign-out needed. The holder count is the blast radius.',
    ar: 'تُمنح الصلاحية عبر المستوى، لا عبر شخص أو مسمّى وظيفي. تغيير الخانة يغيّر ما يستطيع فعله كل موظف في ذلك المستوى، اعتبارًا من طلبه التالي — دون تسجيل خروج. وعدد الأفراد يبيّن حجم الأثر.',
  },
  lvl_loading: { en: 'Loading levels…', ar: 'جارٍ تحميل المستويات…' },
  lvl_add: { en: 'Add level', ar: 'إضافة مستوى' },
  lvl_create: { en: 'Create level', ar: 'إنشاء المستوى' },
  lvl_name_en: { en: 'Name (English)', ar: 'الاسم (إنجليزي)' },
  lvl_name_ar: { en: 'Name (Arabic)', ar: 'الاسم (عربي)' },
  lvl_grants: { en: 'Capabilities', ar: 'الصلاحيات' },
  lvl_delete: { en: 'Delete', ar: 'حذف' },
  lvl_delete_q: { en: 'Delete this level?', ar: 'حذف هذا المستوى؟' },
  lvl_delete_warn: {
    en: 'The level and its capability grants are removed. This cannot be undone. Only a level nobody holds can be deleted.',
    ar: 'سيُحذف المستوى وصلاحياته. لا يمكن التراجع. لا يمكن حذف مستوى يشغله أحد.',
  },
  lvl_col_level: { en: 'Level', ar: 'المستوى' },
  lvl_col_holders: { en: 'Employees', ar: 'الموظفون' },
  lvl_col_employee: { en: 'Employee', ar: 'الموظف' },
  lvl_col_grants: { en: 'Effective capabilities', ar: 'الصلاحيات الفعلية' },
  lvl_assign_h: { en: 'Employee levels', ar: 'مستويات الموظفين' },
  lvl_assign_p: {
    en: 'Moving an employee to a level changes what they may do. Their position in the reporting tree — who they can reach — is set elsewhere and is not affected.',
    ar: 'نقل الموظف إلى مستوى يغيّر ما يُسمح له بفعله. أما موقعه في الهيكل الإداري — ومن يمكنه الوصول إليهم — فيُحدَّد في مكان آخر ولا يتأثر.',
  },

  // organisation (reporting tree + capability grants; two gates, not a ladder)
  org_title: { en: 'Organisation', ar: 'الهيكل التنظيمي' },
  org_sub: {
    en: 'Who reports to whom, and what each level is allowed to do.',
    ar: 'من يتبع لمن، وما المسموح به لكل مستوى.',
  },
  org_legend: {
    en: 'Nesting is reach: an employee sees and assigns to everyone below them. The chips are separate — they are what their level permits, granted independently of position. Someone low in the tree can hold broad permissions, and someone at the top can hold none.',
    ar: 'التداخل يعني النطاق: يرى الموظف من هم أدنى منه ويُسند إليهم. أما الوسوم فمنفصلة — وهي ما يسمح به مستواه، ويُمنح بصرف النظر عن الموقع. قد يملك من هو في الأسفل صلاحيات واسعة، وقد لا يملك من في القمة أيًّا منها.',
  },
  org_no_caps: { en: 'no capabilities', ar: 'بلا صلاحيات' },
  org_no_level: { en: 'no level', ar: 'بلا مستوى' },
  org_inactive: { en: 'deactivated', ar: 'معطّل' },
  org_deactivate: { en: 'Deactivate', ar: 'إلغاء التفعيل' },
  org_activate: { en: 'Reactivate', ar: 'إعادة التفعيل' },
  org_deactivate_q: { en: 'Deactivate this account?', ar: 'إلغاء تفعيل هذا الحساب؟' },
  org_deactivate_warn: {
    en: 'They can no longer sign in, and their existing token stops working immediately. Their requests and history are kept. You can reactivate them later.',
    ar: 'لن يتمكن من تسجيل الدخول، ويتوقف رمزه الحالي فورًا. تُحفظ طلباته وسجله. يمكنك إعادة تفعيله لاحقًا.',
  },
  org_open_tasks: {
    en: 'This employee still holds open tasks — reassign them first.',
    ar: 'لا يزال هذا الموظف يحمل مهامًا مفتوحة — أعد إسنادها أولًا.',
  },
  org_load_err: { en: 'Couldn’t load the organisation:', ar: 'تعذّر تحميل الهيكل التنظيمي:' },
  org_loading: { en: 'Loading organisation…', ar: 'جارٍ تحميل الهيكل التنظيمي…' },
  org_none_h: { en: 'No employees yet', ar: 'لا موظفين بعد' },
  org_none_p: {
    en: 'Employees appear here once they are created.',
    ar: 'يظهر الموظفون هنا بعد إنشائهم.',
  },

  // webhooks (§9 config API)
  wh_title: { en: 'Webhooks', ar: 'الويب هوك' },
  wh_sub: {
    en: 'Outbound event subscriptions. Each delivery is signed with the subscription’s secret.',
    ar: 'اشتراكات الأحداث الصادرة. كل إرسال موقّع بالمفتاح السري للاشتراك.',
  },
  wh_add: { en: 'Add webhook', ar: 'إضافة ويب هوك' },
  wh_create: { en: 'Create', ar: 'إنشاء' },
  wh_delete: { en: 'Delete', ar: 'حذف' },
  wh_url: { en: 'Endpoint URL', ar: 'رابط الوجهة' },
  wh_secret: { en: 'Signing secret', ar: 'المفتاح السري للتوقيع' },
  wh_secret_hint: {
    en: 'Copy this now — the server never returns it again. Used for the X-MonitorFlow-Signature header.',
    ar: 'انسخه الآن — لن يعيده الخادم مرة أخرى. يُستخدم لترويسة X-MonitorFlow-Signature.',
  },
  wh_events: { en: 'Events', ar: 'الأحداث' },
  wh_col_url: { en: 'Endpoint', ar: 'الوجهة' },
  wh_col_events: { en: 'Events', ar: 'الأحداث' },
  wh_load_err: { en: 'Couldn’t load webhooks:', ar: 'تعذّر تحميل الويب هوك:' },
  wh_loading: { en: 'Loading webhooks…', ar: 'جارٍ تحميل الويب هوك…' },
  wh_none_h: { en: 'No webhooks yet', ar: 'لا ويب هوك بعد' },
  wh_none_p: {
    en: 'Add a subscription to push request events to an external system.',
    ar: 'أضف اشتراكًا لإرسال أحداث الطلبات إلى نظام خارجي.',
  },
  wh_delete_q: { en: 'Delete this webhook?', ar: 'حذف هذا الويب هوك؟' },
  wh_delete_warn: {
    en: 'The endpoint stops receiving events immediately. This cannot be undone.',
    ar: 'ستتوقف الوجهة عن استقبال الأحداث فورًا. لا يمكن التراجع.',
  },
  wh_ev_request_created: { en: 'Request created', ar: 'إنشاء طلب' },
  wh_ev_status_changed: { en: 'Status changed', ar: 'تغيير الحالة' },
  wh_ev_assigned: { en: 'Request assigned', ar: 'إسناد الطلب' },
  wh_ev_sla_breached: { en: 'SLA breached', ar: 'تجاوز مدة الاستجابة' },

  // audit
  audit_title: { en: 'Audit Log', ar: 'سجل التدقيق' },
  audit_filter_action: { en: 'Filter by action', ar: 'تصفية حسب الإجراء' },
  audit_all_actions: { en: 'All actions', ar: 'كل الإجراءات' },
  audit_filter_actor: { en: 'Filter by actor', ar: 'تصفية حسب المنفّذ' },
  audit_all_actors: { en: 'All actors', ar: 'كل المنفّذين' },
  audit_you: { en: 'you', ar: 'أنت' },
  audit_load_err: { en: 'Couldn’t load the audit log:', ar: 'تعذّر تحميل سجل التدقيق:' },
  audit_loading: { en: 'Loading audit events…', ar: 'جارٍ تحميل أحداث التدقيق…' },
  audit_none_h: { en: 'No audit events yet', ar: 'لا أحداث تدقيق بعد' },
  audit_no_match_h: { en: 'No matching events', ar: 'لا أحداث مطابقة' },
  audit_none_p: {
    en: 'Account and configuration changes will appear here as they happen.',
    ar: 'ستظهر تغييرات الحسابات والإعدادات هنا فور حدوثها.',
  },
  // Keyed by the FULL action (dots → underscores). `employee.created` and
  // `service.created` share a verb, so keying on the verb alone mislabelled one
  // of them.
  audit_act_employee_created: { en: 'Employee created', ar: 'إنشاء موظف' },
  audit_act_employee_updated: { en: 'Employee updated', ar: 'تعديل موظف' },
  audit_act_employee_activated: { en: 'Employee activated', ar: 'تفعيل موظف' },
  audit_act_employee_deactivated: { en: 'Employee deactivated', ar: 'إلغاء تفعيل موظف' },
  audit_act_employee_password_reset: {
    en: 'Employee password reset',
    ar: 'إعادة تعيين كلمة مرور موظف',
  },
  audit_act_request_status_changed: { en: 'Status changed', ar: 'تغيير الحالة' },
  audit_act_request_assigned: { en: 'Request assigned', ar: 'إسناد الطلب' },
  audit_act_request_priority_changed: { en: 'Priority changed', ar: 'تغيير الأولوية' },
  audit_act_level_created: { en: 'Level created', ar: 'إنشاء مستوى' },
  audit_act_level_updated: { en: 'Level capabilities changed', ar: 'تغيير صلاحيات المستوى' },
  audit_act_level_deleted: { en: 'Level deleted', ar: 'حذف مستوى' },
  audit_act_employee_level_changed: { en: 'Employee level changed', ar: 'تغيير مستوى الموظف' },
  audit_act_service_created: { en: 'Service created', ar: 'إنشاء خدمة' },
  audit_act_service_updated: { en: 'Service updated', ar: 'تعديل خدمة' },
  audit_entity_user: { en: 'Employee', ar: 'موظف' },
  audit_entity_request: { en: 'Request', ar: 'طلب' },
  audit_entity_service_type: { en: 'Service', ar: 'خدمة' },
  audit_entity_employee_level: { en: 'Level', ar: 'مستوى' },
  col_when: { en: 'When', ar: 'الوقت' },
  col_actor: { en: 'Actor', ar: 'المنفّذ' },
  col_action: { en: 'Action', ar: 'الإجراء' },
  col_target: { en: 'Target', ar: 'الهدف' },
  col_details: { en: 'Details', ar: 'التفاصيل' },

  // notification bell
  notif_title: { en: 'Notifications', ar: 'الإشعارات' },
  notif_mark_all: { en: 'Mark all read', ar: 'تحديد الكل كمقروء' },
  notif_empty: { en: 'Nothing here — updates about requests will appear.', ar: 'لا شيء هنا — ستظهر تحديثات الطلبات.' },
  notif_unread: { en: 'unread', ar: 'غير مقروء' },
  notif_just_now: { en: 'just now', ar: 'الآن' },
  notif_m_ago: { en: 'm ago', ar: 'د مضت' },
  notif_h_ago: { en: 'h ago', ar: 'س مضت' },

  // onboarding wizard (first-login, admin only)
  ob_title: { en: 'Customize your app in 1 minute', ar: 'خصّص تطبيقك في دقيقة' },
  ob_step_of: { en: 'Step', ar: 'خطوة' }, // "Step 2 of 6"
  ob_finish: { en: 'Get started', ar: 'ابدأ الآن' },
  ob_saving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  ob_err_required: { en: 'This field is required.', ar: 'هذا الحقل مطلوب.' },
  ob_err_save: {
    en: 'Couldn’t save your setup. Check your answers and try again.',
    ar: 'تعذّر حفظ الإعداد. تحقّق من إجاباتك وحاول مجددًا.',
  },
  ob_err_logo: { en: 'Couldn’t upload the logo. Try a JPG, PNG, or PDF under 5 MB.', ar: 'تعذّر رفع الشعار. جرّب JPG أو PNG أو PDF أقل من 5 ميغابايت.' },
  ob_err_domain: { en: 'Enter a valid domain, e.g. company.org', ar: 'أدخل نطاقًا صالحًا، مثل company.org' },
  ob_select: { en: 'Select…', ar: 'اختر…' },

  ob_s1_title: { en: 'Company information', ar: 'معلومات الشركة' },
  ob_company_name_en: { en: 'Company name (English)', ar: 'اسم الشركة (بالإنجليزية)' },
  ob_company_name_ar: { en: 'Company name (Arabic)', ar: 'اسم الشركة (بالعربية)' },
  ob_company_address_en: { en: 'Company address (English)', ar: 'عنوان الشركة (بالإنجليزية)' },
  ob_company_address_ar: { en: 'Company address (Arabic)', ar: 'عنوان الشركة (بالعربية)' },
  ob_job_title_en: { en: 'Your job title (English)', ar: 'مسمّاك الوظيفي (بالإنجليزية)' },
  ob_job_title_ar: { en: 'Your job title (Arabic)', ar: 'مسمّاك الوظيفي (بالعربية)' },
  ob_phone: { en: 'Phone number', ar: 'رقم الهاتف' },

  ob_s2_title: { en: 'Company details', ar: 'تفاصيل الشركة' },
  ob_employee_count: { en: 'Number of employees', ar: 'عدد الموظفين' },
  ob_industry: { en: 'Business industry', ar: 'مجال العمل' },
  ob_sub_industry: { en: 'Sub-industry', ar: 'التخصّص' },

  ob_s3_title: { en: 'Branches', ar: 'الفروع' },
  ob_branch_count: { en: 'How many branches?', ar: 'كم عدد الفروع؟' },
  ob_branch_name_en: { en: 'Branch name (English)', ar: 'اسم الفرع (بالإنجليزية)' },
  ob_branch_name_ar: { en: 'Branch name (Arabic)', ar: 'اسم الفرع (بالعربية)' },

  ob_s4_title: { en: 'Features', ar: 'الميزات' },
  ob_features_hint: {
    en: 'Choose the features you want to use. You can change these later.',
    ar: 'اختر الميزات التي تريد استخدامها. يمكنك تغييرها لاحقًا.',
  },

  ob_s5_title: { en: 'Branding', ar: 'الهوية' },
  ob_logo: { en: 'Company logo (optional)', ar: 'شعار الشركة (اختياري)' },
  ob_choose_file: { en: 'Choose file…', ar: 'اختر ملفًا…' },
  ob_email_domain: { en: 'Employee email domain', ar: 'نطاق بريد الموظفين' },
  ob_email_domain_hint: {
    en: 'New employee logins are generated as name@this-domain, e.g. ha.qanazi@company.org.',
    ar: 'يتم إنشاء بيانات دخول الموظفين على شكل الاسم@هذا-النطاق، مثل ha.qanazi@company.org.',
  },

  ob_s7_title: { en: 'Choose your plan', ar: 'اختر خطتك' },
  ob_plan_hint: {
    en: 'Pick the plan that fits your team. This is just a starting point — you can change it later.',
    ar: 'اختر الخطة المناسبة لفريقك. هذه بداية فقط — يمكنك تغييرها لاحقًا.',
  },
  ob_plan_up_to: { en: 'Up to', ar: 'حتى' },
  ob_plan_employees: { en: 'employees', ar: 'موظف' },
  ob_plan_unlimited: { en: 'Unlimited employees', ar: 'عدد غير محدود من الموظفين' },
  ob_plan_includes: { en: 'Includes', ar: 'يشمل' },
  ob_plan_size_warning: {
    en: 'This may not fit your team size — consider a larger plan.',
    ar: 'قد لا تناسب هذه الخطة حجم فريقك — فكّر في خطة أكبر.',
  },

  // Add Service builder (admin-only) — CLAUDE.md §3/§13's flagged deviation.
  svc_title: { en: 'Add a service', ar: 'إضافة خدمة' },
  svc_s1_title: { en: 'Basics', ar: 'الأساسيات' },
  svc_s2_title: { en: 'Request form', ar: 'نموذج الطلب' },
  svc_s3_title: { en: 'Completion form', ar: 'نموذج الإنجاز' },
  svc_s4_title: { en: 'Workflow', ar: 'سير العمل' },
  svc_s5_title: { en: 'Review', ar: 'المراجعة' },
  svc_name_en: { en: 'Service name (English)', ar: 'اسم الخدمة (بالإنجليزية)' },
  svc_name_ar: { en: 'Service name (Arabic)', ar: 'اسم الخدمة (بالعربية)' },
  svc_default_priority: { en: 'Default priority', ar: 'الأولوية الافتراضية' },
  svc_accepts_external: { en: 'External users may submit this request', ar: 'يمكن للمستخدمين الخارجيين تقديم هذا الطلب' },
  svc_accepts_employee: { en: 'Employees may submit this request (e.g. Time Off)', ar: 'يمكن للموظفين تقديم هذا الطلب (مثل الإجازة)' },
  svc_owner: { en: 'Owner', ar: 'المسؤول' },
  svc_owner_hint: {
    en: 'The employee whose subtree can see this service’s requests.',
    ar: 'الموظف الذي يمكن لفريقه رؤية طلبات هذه الخدمة.',
  },
  svc_request_fields_h: { en: 'Request form fields', ar: 'حقول نموذج الطلب' },
  svc_completion_fields_h: { en: 'Completion form fields', ar: 'حقول نموذج الإنجاز' },
  svc_add_field: { en: 'Add field', ar: 'إضافة حقل' },
  svc_field_id: { en: 'Field id', ar: 'معرّف الحقل' },
  svc_field_label_en: { en: 'Label (English)', ar: 'التسمية (بالإنجليزية)' },
  svc_field_label_ar: { en: 'Label (Arabic)', ar: 'التسمية (بالعربية)' },
  svc_required: { en: 'Required', ar: 'مطلوب' },
  svc_remove: { en: 'Remove', ar: 'إزالة' },
  svc_min: { en: 'Min', ar: 'الحد الأدنى' },
  svc_max: { en: 'Max', ar: 'الحد الأقصى' },
  svc_option_value: { en: 'Option value', ar: 'قيمة الخيار' },
  svc_add_option: { en: 'Add option', ar: 'إضافة خيار' },
  svc_statuses_h: { en: 'Statuses', ar: 'الحالات' },
  svc_add_status: { en: 'Add status', ar: 'إضافة حالة' },
  svc_transitions_h: { en: 'Transitions', ar: 'الانتقالات' },
  svc_add_transition: { en: 'Add transition', ar: 'إضافة انتقال' },
  svc_status_key: { en: 'Status key', ar: 'مفتاح الحالة' },
  svc_is_initial: { en: 'Initial', ar: 'أولية' },
  svc_is_terminal: { en: 'Terminal', ar: 'نهائية' },
  svc_sla_minutes: { en: 'SLA (minutes, optional)', ar: 'مدة الالتزام (دقائق، اختياري)' },
  svc_transition_key: { en: 'Transition key', ar: 'مفتاح الانتقال' },
  svc_from: { en: 'From status', ar: 'من حالة' },
  svc_to: { en: 'To status', ar: 'إلى حالة' },
  svc_gate_capability: { en: 'Oversight capability', ar: 'صلاحية إشرافية' },
  svc_gate_actor: { en: 'Actor’s turn', ar: 'دور أحد الأطراف' },
  svc_requires_completion_form: { en: 'Requires the completion form', ar: 'يتطلب نموذج الإنجاز' },
  svc_requires_note: { en: 'Requires a note', ar: 'يتطلب ملاحظة' },
  svc_untitled: { en: 'Untitled service', ar: 'خدمة بلا اسم' },
  svc_review_fields: { en: 'fields', ar: 'حقول' },
  svc_review_statuses: { en: 'statuses', ar: 'حالات' },
  svc_review_transitions: { en: 'transitions', ar: 'انتقالات' },
  svc_create: { en: 'Create service', ar: 'إنشاء الخدمة' },
  svc_created_h: { en: 'Service created', ar: 'تم إنشاء الخدمة' },
  svc_created_p: { en: 'Live under key', ar: 'مُفعّلة بالمفتاح' },
  svc_err_save: { en: 'Couldn’t save this service. Check your answers and try again.', ar: 'تعذّر حفظ الخدمة. تحقّق من إجاباتك وحاول مجددًا.' },
  svc_err_load: { en: 'Couldn’t load departments and employees.', ar: 'تعذّر تحميل الدوائر والموظفين.' },
  field_type_text: { en: 'Text', ar: 'نص' },
  field_type_multiline: { en: 'Multiline text', ar: 'نص متعدد الأسطر' },
  field_type_number: { en: 'Number', ar: 'رقم' },
  field_type_date: { en: 'Date', ar: 'تاريخ' },
  field_type_dropdown: { en: 'Dropdown', ar: 'قائمة منسدلة' },
  field_type_radio: { en: 'Radio', ar: 'اختيار واحد' },
  field_type_checkbox: { en: 'Checkbox', ar: 'مربع اختيار' },
  field_type_photo: { en: 'Photo', ar: 'صورة' },
  field_type_location: { en: 'Location', ar: 'الموقع' },
}

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
  L: (value: Loc | string | null | undefined) => string
}

const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(KEY) as Lang) || 'en')

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    // The tab title carries the deployment's branding too, and follows the
    // language. Set here rather than in index.html because .env is gitignored
    // repo-wide, so Vite's %VITE_*% HTML substitution has nothing to read.
    document.title = `${brand.name[lang] ?? brand.name.en} · ${dict.console_suffix[lang]}`
    // Tab icon follows the configured logo, so the two can't drift apart. No
    // logo configured → the shipped favicon.svg in index.html stays.
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon && brand.logo) {
      icon.href = brand.logo
      icon.type = brand.logo.endsWith('.svg') ? 'image/svg+xml' : ''
    }
    localStorage.setItem(KEY, lang)
  }, [lang])

  const t = (key: string) => dict[key]?.[lang] ?? dict[key]?.en ?? key
  const L = (value: Loc | string | null | undefined) => {
    if (value == null) return ''
    return typeof value === 'object' ? (value[lang] ?? value.en) : value
  }

  return <I18nContext.Provider value={{ lang, setLang, t, L }}>{children}</I18nContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook + provider share this module by design
export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
