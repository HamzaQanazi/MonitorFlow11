// Bilingual + RTL for the mobile apps (Phase 3), the sibling of web/src/i18n.tsx.
//   tr(key)       — UI chrome, from the `_dict` below (en + ar).
//   l(Loc)        — a data label the API returns as { en, ar }; picks the language.
//   apiError(err) — a caught ApiException/NetworkException; picks the language
//                   for the finite set of server error strings mobile screens
//                   can actually trigger (`_serverErrorDict` below), falling
//                   back to the server's raw English text for anything not
//                   recognized — an honest degradation, not a mistranslation.
// The provider persists the choice and exposes a TextDirection; main.dart wraps
// the app in a Directionality so layout (EdgeInsetsDirectional, Row, text)
// flips between LTR and RTL. Notification bodies (server-composed, not an
// {en,ar} object) still stay English — that part of the bilingual-
// notifications work is deferred to Phase 5.
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api/api_client.dart';

/// A bilingual label as returned by the API: { en, ar }. Defensive against a
/// plain string (older payloads) so a render never throws.
class Loc {
  final String en;
  final String ar;
  const Loc(this.en, this.ar);

  factory Loc.fromJson(dynamic v) {
    if (v is Map) {
      final en = v['en']?.toString() ?? '';
      final ar = v['ar']?.toString() ?? en;
      return Loc(en, ar);
    }
    final s = v?.toString() ?? '';
    return Loc(s, s);
  }

  String pick(String lang) => lang == 'ar' ? ar : en;
}

class I18n extends ChangeNotifier {
  static const _key = 'mf.lang';
  String _lang = 'en';

  String get lang => _lang;
  TextDirection get dir => _lang == 'ar' ? TextDirection.rtl : TextDirection.ltr;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _lang = prefs.getString(_key) ?? 'en';
    notifyListeners();
  }

  Future<void> toggle() async {
    _lang = _lang == 'ar' ? 'en' : 'ar';
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, _lang);
  }

  /// Pick a bilingual data label for the active language.
  String l(Loc v) => v.pick(_lang);

  /// Look up a UI chrome string. Falls back to English, then the key itself.
  String tr(String key) => _dict[key]?[_lang] ?? _dict[key]?['en'] ?? key;

  /// Localizes a caught API error for display. A NetworkException gets the
  /// generic "could not reach the server" copy; an ApiException's message is
  /// looked up in `_serverErrorDict` and falls back to the raw server string
  /// (English) if this particular error isn't in that finite list yet.
  String apiError(Object error) {
    if (error is NetworkException) return tr('net_retry');
    if (error is ApiException) {
      final loc = _serverErrorDict[error.message];
      if (loc != null) return loc[_lang] ?? loc['en']!;
      return error.message;
    }
    return error.toString();
  }

  /// "high" → "High priority" / "أولوية عالية" (word order differs, so the
  /// whole phrase is a single key rather than composed).
  String priorityPhrase(String priority) => tr('pri_phrase_$priority');

  /// "2h ago"-style relative timestamps, localised.
  String relativeTime(DateTime when) {
    final diff = DateTime.now().difference(when);
    if (diff.inMinutes < 1) return tr('time_just_now');
    if (diff.inMinutes < 60) return '${diff.inMinutes}${tr('time_m_ago')}';
    if (diff.inHours < 24) return '${diff.inHours}${tr('time_h_ago')}';
    if (diff.inDays < 7) return '${diff.inDays}${tr('time_d_ago')}';
    return _shortDate(when.toLocal());
  }

  static String _shortDate(DateTime d) => '${d.day}/${d.month}';
}

const Map<String, Map<String, String>> _dict = {
  // common / actions
  'try_again': {'en': 'Try again', 'ar': 'حاول مجددًا'},
  'back': {'en': 'Back', 'ar': 'رجوع'},
  'confirm': {'en': 'Confirm', 'ar': 'تأكيد'},
  'sign_out': {'en': 'Sign out', 'ar': 'تسجيل الخروج'},
  'profile': {'en': 'Profile', 'ar': 'الملف الشخصي'},
  'note_required': {'en': 'Note (required)', 'ar': 'ملاحظة (مطلوبة)'},
  'clear_filter': {'en': 'Clear filter', 'ar': 'مسح التصفية'},
  'net_check': {
    'en': 'Could not reach the server — check your connection.',
    'ar': 'تعذّر الوصول إلى الخادم — تحقّق من اتصالك.',
  },
  'net_check_retry': {
    'en': 'Could not reach the server — check your connection and try again.',
    'ar': 'تعذّر الوصول إلى الخادم — تحقّق من اتصالك ثم حاول مجددًا.',
  },
  'net_retry': {
    'en': 'Could not reach the server — try again.',
    'ar': 'تعذّر الوصول إلى الخادم — حاول مجددًا.',
  },

  // categories (the closed enum, Section 9)
  'state_open': {'en': 'Open', 'ar': 'مفتوح'},
  'state_closed': {'en': 'Closed', 'ar': 'مغلق'},

  // priorities (full phrase — word order differs across languages)
  'pri_phrase_high': {'en': 'High priority', 'ar': 'أولوية عالية'},
  'pri_phrase_medium': {'en': 'Medium priority', 'ar': 'أولوية متوسطة'},
  'pri_phrase_low': {'en': 'Low priority', 'ar': 'أولوية منخفضة'},

  // relative time
  'time_just_now': {'en': 'just now', 'ar': 'الآن'},
  'time_m_ago': {'en': 'm ago', 'ar': ' د'},
  'time_h_ago': {'en': 'h ago', 'ar': ' س'},
  'time_d_ago': {'en': 'd ago', 'ar': ' يوم'},

  // auth gate (main.dart)
  'gate_web_title': {'en': 'This account uses the web dashboard', 'ar': 'يستخدم هذا الحساب لوحة الويب'},
  'gate_web_body': {
    'en': 'This app is for users and field employees only.',
    'ar': 'هذا التطبيق مخصّص للمستخدمين والموظفين الميدانيين فقط.',
  },

  // login
  'login_create': {'en': 'Create your account', 'ar': 'أنشئ حسابك'},
  'login_signin_sub': {'en': 'Sign in to continue', 'ar': 'سجّل الدخول للمتابعة'},
  'login_full_name': {'en': 'Full name', 'ar': 'الاسم الكامل'},
  'login_email': {'en': 'Email', 'ar': 'البريد الإلكتروني'},
  'login_email_or_id': {'en': 'Email or employee ID', 'ar': 'البريد أو معرّف الموظف'},
  'login_password': {'en': 'Password', 'ar': 'كلمة المرور'},
  'login_phone_optional': {'en': 'Phone (optional)', 'ar': 'الهاتف (اختياري)'},
  'login_create_btn': {'en': 'Create account', 'ar': 'إنشاء حساب'},
  'login_signin_btn': {'en': 'Sign in', 'ar': 'تسجيل الدخول'},
  'login_have_account': {'en': 'Already have an account? Sign in', 'ar': 'لديك حساب؟ سجّل الدخول'},
  'login_new_here': {'en': 'New here? Create an account', 'ar': 'جديد هنا؟ أنشئ حسابًا'},
  'login_show_password': {'en': 'Show password', 'ar': 'إظهار كلمة المرور'},
  'login_hide_password': {'en': 'Hide password', 'ar': 'إخفاء كلمة المرور'},
  'login_err_name': {'en': 'Name is required', 'ar': 'الاسم مطلوب'},
  'login_err_email': {'en': 'Email is required', 'ar': 'البريد الإلكتروني مطلوب'},
  'login_err_id': {'en': 'Enter your email or employee ID', 'ar': 'أدخل بريدك أو معرّف الموظف'},
  'login_err_email_valid': {'en': 'Enter a valid email', 'ar': 'أدخل بريدًا إلكترونيًا صالحًا'},
  'login_err_password': {'en': 'Password is required', 'ar': 'كلمة المرور مطلوبة'},
  'login_err_password_len': {'en': 'Password must be at least 8 characters', 'ar': 'يجب ألا تقل كلمة المرور عن 8 أحرف'},

  // profile
  'profile_updated': {'en': 'Profile updated', 'ar': 'تم تحديث الملف الشخصي'},
  'profile_password_changed': {'en': 'Password changed', 'ar': 'تم تغيير كلمة المرور'},
  'profile_details': {'en': 'Details', 'ar': 'التفاصيل'},
  'profile_phone': {'en': 'Phone', 'ar': 'الهاتف'},
  'profile_save': {'en': 'Save details', 'ar': 'حفظ التفاصيل'},
  'profile_change_password': {'en': 'Change password', 'ar': 'تغيير كلمة المرور'},
  'profile_current_password': {'en': 'Current password', 'ar': 'كلمة المرور الحالية'},
  'profile_new_password': {'en': 'New password (min 8 characters)', 'ar': 'كلمة مرور جديدة (8 أحرف على الأقل)'},
  'profile_language': {'en': 'Language', 'ar': 'اللغة'},
  'lang_toggle': {'en': 'العربية', 'ar': 'English'},

  // notifications
  'notif_title': {'en': 'Notifications', 'ar': 'الإشعارات'},
  'notif_mark_all': {'en': 'Mark all read', 'ar': 'تحديد الكل كمقروء'},
  'notif_mark_all_fail': {'en': 'Could not mark all read — try again.', 'ar': 'تعذّر تحديد الكل كمقروء — حاول مجددًا.'},
  'notif_load_fail': {'en': 'Could not load notifications.', 'ar': 'تعذّر تحميل الإشعارات.'},
  'notif_none_title': {'en': 'No notifications', 'ar': 'لا إشعارات'},
  'notif_none_sub': {'en': 'Updates about your requests and tasks appear here.', 'ar': 'تظهر هنا تحديثات طلباتك ومهامك.'},

  // user home
  'home_hi': {'en': 'Hi', 'ar': 'مرحبًا'},
  'home_prompt': {'en': 'What do you need help with today?', 'ar': 'بماذا يمكننا مساعدتك اليوم؟'},
  'home_new_request': {'en': 'New request', 'ar': 'طلب جديد'},
  'home_recent': {'en': 'Recent requests', 'ar': 'الطلبات الأخيرة'},
  'home_view_all': {'en': 'View all', 'ar': 'عرض الكل'},
  'home_load_fail': {'en': 'Could not load your requests.', 'ar': 'تعذّر تحميل طلباتك.'},
  'home_none_title': {'en': 'Nothing here yet', 'ar': 'لا يوجد شيء بعد'},
  'home_none_sub': {'en': 'Submit your first request to see its progress here.', 'ar': 'أرسل أول طلب لك لترى تقدّمه هنا.'},

  // catalogue
  'cat_title': {'en': 'Choose a service', 'ar': 'اختر خدمة'},
  'cat_load_fail': {'en': 'Could not load services.', 'ar': 'تعذّر تحميل الخدمات.'},
  'cat_none_title': {'en': 'No services available', 'ar': 'لا خدمات متاحة'},
  'cat_none_sub': {'en': 'Check back later.', 'ar': 'تحقّق لاحقًا.'},

  // create request
  'create_hint': {'en': 'Tell us what you need — fields marked * are required.', 'ar': 'أخبرنا بما تحتاجه — الحقول المعلّمة بـ * مطلوبة.'},
  'create_form_fail': {'en': 'Could not load this form.', 'ar': 'تعذّر تحميل هذا النموذج.'},
  'create_submit': {'en': 'Submit request', 'ar': 'إرسال الطلب'},
  'create_submitted_pre': {'en': 'Request', 'ar': 'الطلب'},
  'create_submitted_post': {'en': 'submitted', 'ar': 'تم إرساله'},

  // my requests
  'my_title': {'en': 'My requests', 'ar': 'طلباتي'},
  'my_none_title': {'en': 'No requests yet', 'ar': 'لا طلبات بعد'},
  'my_none_sub': {'en': 'Your submitted requests and their progress will appear here.', 'ar': 'ستظهر هنا طلباتك المُرسلة وتقدّمها.'},
  'my_browse': {'en': 'Browse services', 'ar': 'تصفّح الخدمات'},
  'my_none_cat': {'en': 'No requests in this category', 'ar': 'لا طلبات في هذه الفئة'},

  // request detail
  'rd_title': {'en': 'Request', 'ar': 'الطلب'},
  'rd_confirm_q': {'en': 'Confirm resolution?', 'ar': 'تأكيد الحل؟'},
  'rd_confirm_body': {'en': 'You confirm the work is done to your satisfaction. This closes the request.', 'ar': 'أنت تؤكّد أن العمل أُنجز بما يرضيك. هذا يغلق الطلب.'},
  'rd_dispute_q': {'en': 'Report unresolved?', 'ar': 'الإبلاغ عن عدم الحل؟'},
  'rd_dispute_body': {'en': 'The work goes back to the assigned employee. Explain what is still wrong.', 'ar': 'يعود العمل إلى الموظف المُسنَد. وضّح ما الذي لا يزال خاطئًا.'},
  'rd_dispute_btn': {'en': 'Report unresolved', 'ar': 'الإبلاغ عن عدم الحل'},
  'rd_cancel_q': {'en': 'Cancel this request?', 'ar': 'إلغاء هذا الطلب؟'},
  'rd_cancel_body': {'en': 'This cannot be undone. A short reason is required.', 'ar': 'لا يمكن التراجع عن هذا. سبب موجز مطلوب.'},
  'rd_cancel_btn': {'en': 'Cancel request', 'ar': 'إلغاء الطلب'},
  'rd_act_body': {'en': 'This updates your request and notifies the team.', 'ar': 'هذا يحدّث طلبك ويُعلم الفريق.'},
  'rd_note_body': {'en': 'A short reason is required.', 'ar': 'سبب موجز مطلوب.'},
  'rd_service_unavailable': {'en': 'This service is not available right now.', 'ar': 'هذه الخدمة غير متاحة حاليًا.'},
  'rd_now_pre': {'en': 'Request is now', 'ar': 'الطلب الآن'},
  'rd_not_found': {'en': 'This request could not be found.', 'ar': 'تعذّر العثور على هذا الطلب.'},
  'rd_load_fail': {'en': 'Could not load this request.', 'ar': 'تعذّر تحميل هذا الطلب.'},
  'rd_submitted': {'en': 'Submitted', 'ar': 'أُرسل'},
  'rd_timeline': {'en': 'Timeline', 'ar': 'الجدول الزمني'},
  'rd_resolved_q': {'en': 'The work is marked as completed. Is everything resolved?', 'ar': 'العمل مُعلَّم كمكتمل. هل كل شيء تم حلّه؟'},
  'rd_confirm_btn': {'en': 'Confirm resolution', 'ar': 'تأكيد الحل'},
  'rd_answers': {'en': 'Your answers', 'ar': 'إجاباتك'},
  'rd_comments': {'en': 'Comments', 'ar': 'التعليقات'},
  'rd_again': {'en': 'Request again', 'ar': 'اطلب مجددًا'},

  // employee home
  'eh_title': {'en': 'My tasks', 'ar': 'مهامي'},
  'eh_load_fail': {'en': 'Could not load your tasks.', 'ar': 'تعذّر تحميل مهامك.'},
  'eh_none_title': {'en': 'No tasks assigned', 'ar': 'لا مهام مُسنَدة'},
  'eh_none_sub': {'en': 'New assignments will appear here.', 'ar': 'ستظهر الإسنادات الجديدة هنا.'},
  'eh_list': {'en': 'List', 'ar': 'قائمة'},
  'eh_map': {'en': 'Map', 'ar': 'خريطة'},
  'eh_none_cat': {'en': 'No tasks in this category', 'ar': 'لا مهام في هذه الفئة'},
  'eh_needs_response': {'en': 'Needs response', 'ar': 'بحاجة إلى رد'},
  'eh_in_progress': {'en': 'In progress', 'ar': 'قيد التنفيذ'},
  'eh_history': {'en': 'History', 'ar': 'السجل'},
  'eh_task': {'en': 'Task', 'ar': 'مهمة'},
  'eh_request': {'en': 'Request', 'ar': 'طلب'},

  // task detail
  'td_title': {'en': 'Task', 'ar': 'مهمة'},
  'td_accept_q': {'en': 'Accept this task?', 'ar': 'قبول هذه المهمة؟'},
  'td_accept_body_pre': {'en': 'The task moves to', 'ar': 'تنتقل المهمة إلى'},
  'td_accept_body_post': {'en': 'and the requester is notified.', 'ar': 'ويُخطَر مقدّم الطلب.'},
  'td_accept_btn': {'en': 'Accept task', 'ar': 'قبول المهمة'},
  'td_reject_q': {'en': 'Reject this task?', 'ar': 'رفض هذه المهمة؟'},
  'td_reject_body': {'en': 'The request goes back to the queue for reassignment and your supervisor is notified. A note explaining why is required.', 'ar': 'يعود الطلب إلى قائمة الانتظار لإعادة الإسناد ويُخطَر مشرفك. مطلوب ملاحظة توضّح السبب.'},
  'td_reject_btn': {'en': 'Reject task', 'ar': 'رفض المهمة'},
  'td_move_pre': {'en': 'Move to', 'ar': 'الانتقال إلى'},
  'td_move_note': {'en': 'A note explaining the change is required.', 'ar': 'مطلوب ملاحظة توضّح التغيير.'},
  'td_update_btn': {'en': 'Update status', 'ar': 'تحديث الحالة'},
  'td_move_notify': {'en': 'The requester is notified of the change.', 'ar': 'يُخطَر مقدّم الطلب بالتغيير.'},
  'td_now_pre': {'en': 'Task is now', 'ar': 'المهمة الآن'},
  'td_not_found': {'en': 'This task could not be found.', 'ar': 'تعذّر العثور على هذه المهمة.'},
  'td_load_fail': {'en': 'Could not load this task.', 'ar': 'تعذّر تحميل هذه المهمة.'},
  'td_no_phone': {'en': 'No phone app available on this device', 'ar': 'لا يوجد تطبيق هاتف على هذا الجهاز'},
  'td_requester': {'en': 'Requester', 'ar': 'مقدّم الطلب'},
  'td_request_details': {'en': 'Request details', 'ar': 'تفاصيل الطلب'},
  'td_assigned': {'en': 'assigned', 'ar': 'أُسندت'},
  'td_complete_btn': {'en': 'Complete task', 'ar': 'إكمال المهمة'},
  'td_no_actions': {'en': 'No actions available — this task is closed or on hold.', 'ar': 'لا إجراءات متاحة — هذه المهمة مغلقة أو معلّقة.'},

  // complete task
  'ct_complete_pre': {'en': 'Complete', 'ar': 'إكمال'},
  'ct_complete_q': {'en': 'Complete this task?', 'ar': 'إكمال هذه المهمة؟'},
  'ct_complete_body': {'en': 'The requester will be notified and asked to confirm the resolution.', 'ar': 'سيُخطَر مقدّم الطلب ويُطلَب منه تأكيد الحل.'},
  'ct_hint': {'en': 'Fill in the completion report — fields marked * are required.', 'ar': 'املأ تقرير الإكمال — الحقول المعلّمة بـ * مطلوبة.'},
  'ct_form_fail': {'en': 'Could not load the completion form.', 'ar': 'تعذّر تحميل نموذج الإكمال.'},
  'ct_done': {'en': 'Task completed', 'ar': 'اكتملت المهمة'},

  // task map view
  'tm_open': {'en': 'Open task', 'ar': 'فتح المهمة'},
  'tm_nothing_title': {'en': 'Nothing to map', 'ar': 'لا شيء لعرضه على الخريطة'},
  'tm_nothing_sub': {'en': 'Active tasks with a location will appear here.', 'ar': 'ستظهر هنا المهام النشطة التي لها موقع.'},
  'tm_missing_one': {'en': '1 task has no location', 'ar': 'مهمة واحدة بلا موقع'},
  'tm_missing_pre': {'en': 'tasks have no location', 'ar': 'مهام بلا موقع'},

  // location picker
  'lp_title': {'en': 'Pick a location', 'ar': 'اختر موقعًا'},
  'lp_use': {'en': 'Use this location', 'ar': 'استخدم هذا الموقع'},
  'lp_tap': {'en': 'Tap the map to drop a pin', 'ar': 'انقر على الخريطة لوضع دبوس'},
  'lp_locating': {'en': 'Finding your location…', 'ar': 'جارٍ تحديد موقعك…'},
  'lp_my_location': {'en': 'Use my location', 'ar': 'استخدم موقعي'},

  // dynamic form
  'df_photo_unavailable': {'en': 'Photo upload is not available here yet', 'ar': 'رفع الصور غير متاح هنا بعد'},
  'df_uploading': {'en': 'Uploading…', 'ar': 'جارٍ الرفع…'},
  'df_photo_attached': {'en': 'Photo attached', 'ar': 'صورة مرفقة'},
  'df_no_photo': {'en': 'No photo attached', 'ar': 'لا صورة مرفقة'},
  'df_remove': {'en': 'Remove', 'ar': 'إزالة'},
  'df_add_photo': {'en': 'Add photo', 'ar': 'إضافة صورة'},
  'df_map_unavailable': {'en': 'Map picker is not available here yet', 'ar': 'منتقي الخريطة غير متاح هنا بعد'},
  'df_no_location': {'en': 'No location set', 'ar': 'لم يُحدَّد موقع'},
  'df_set_location': {'en': 'Set location', 'ar': 'تحديد الموقع'},
  'df_change': {'en': 'Change', 'ar': 'تغيير'},
  'df_unsupported': {'en': 'This field type is not supported in this app version', 'ar': 'نوع الحقل هذا غير مدعوم في هذا الإصدار'},

  // time clock (employee self-service — clock in/out, breaks, manual hours)
  'tc_title': {'en': 'Time Clock', 'ar': 'ساعة الدوام'},
  'tc_load_fail': {'en': 'Could not load your time clock status.', 'ar': 'تعذّر تحميل حالة ساعة الدوام.'},
  'tc_not_clocked_in': {'en': 'Not clocked in', 'ar': 'لم تسجّل حضورًا'},
  'tc_clocked_in': {'en': 'Clocked in', 'ar': 'مسجَّل حضور'},
  'tc_on_break': {'en': 'On break', 'ar': 'في استراحة'},
  'tc_since': {'en': 'since', 'ar': 'منذ'},
  'tc_clock_in': {'en': 'Clock in', 'ar': 'تسجيل حضور'},
  'tc_clock_out': {'en': 'Clock out', 'ar': 'تسجيل انصراف'},
  'tc_start_break': {'en': 'Start break', 'ar': 'بدء الاستراحة'},
  'tc_end_break': {'en': 'End break', 'ar': 'إنهاء الاستراحة'},
  'tc_end_break_first': {'en': 'End your break before clocking out.', 'ar': 'أنهِ استراحتك قبل تسجيل الانصراف.'},
  'tc_log_manual': {'en': 'Log hours manually', 'ar': 'تسجيل ساعات يدويًا'},
  'tc_manual_title': {'en': 'Log hours manually', 'ar': 'تسجيل ساعات يدويًا'},
  'tc_manual_hint': {
    'en': 'Forgot to clock in? Log the hours here — a manager reviews and approves it.',
    'ar': 'نسيت تسجيل الحضور؟ سجّل الساعات هنا — سيراجعها المدير ويعتمدها.',
  },
  'tc_note_optional': {'en': 'Note (optional)', 'ar': 'ملاحظة (اختياري)'},
  'tc_submit_manual': {'en': 'Submit', 'ar': 'إرسال'},
  'tc_submitting': {'en': 'Submitting…', 'ar': 'جارٍ الإرسال…'},
  'tc_manual_submitted': {'en': 'Submitted — pending manager approval', 'ar': 'تم الإرسال — بانتظار موافقة المدير'},
  'tc_err_required': {'en': 'Required', 'ar': 'مطلوب'},

  // my schedule (employee self-service, read-only — a manager assigns shifts on web)
  'sc_title': {'en': 'Schedule', 'ar': 'الجدولة'},
  'sc_load_fail': {'en': 'Could not load your schedule.', 'ar': 'تعذّر تحميل جدولك.'},
  'sc_no_shift': {'en': 'No shift scheduled', 'ar': 'لا وردية مجدولة'},

  // time off (employee self-service — submit, list, detail)
  'to_title': {'en': 'My Time Off', 'ar': 'إجازاتي'},
  'to_new': {'en': 'Request time off', 'ar': 'طلب إجازة'},
  'to_load_fail': {'en': 'Could not load your time off requests.', 'ar': 'تعذّر تحميل طلبات إجازتك.'},
  'to_none_title': {'en': 'No time off requests yet', 'ar': 'لا طلبات إجازة بعد'},
  'to_none_sub': {'en': 'Your submitted time off requests will appear here.', 'ar': 'ستظهر هنا طلبات الإجازة التي أرسلتها.'},

  // checklists (employee self-service — pick a template, submit, list, detail)
  'cl_title': {'en': 'My Checklists', 'ar': 'قوائمي'},
  'cl_new_template': {'en': 'New', 'ar': 'جديد'},
  'cl_load_fail': {'en': 'Could not load checklists.', 'ar': 'تعذّر تحميل القوائم.'},
  'cl_templates_none': {'en': 'No checklists set up yet', 'ar': 'لا توجد قوائم بعد'},
  'cl_none_title': {'en': 'No checklists submitted yet', 'ar': 'لا توجد قوائم مُرسلة بعد'},
  'cl_none_sub': {'en': 'Your submitted checklists will appear here.', 'ar': 'ستظهر هنا القوائم التي أرسلتها.'},
  'cl_submissions': {'en': 'Submitted', 'ar': 'المُرسَلة'},

  // company directory (communication feature group — company-wide, not subtree-scoped)
  'dir_title': {'en': 'Directory', 'ar': 'الدليل'},
  'dir_search_ph': {'en': 'Search name…', 'ar': 'ابحث بالاسم…'},
  'dir_load_fail': {'en': 'Could not load the directory.', 'ar': 'تعذّر تحميل الدليل.'},
  'dir_none_title': {'en': 'No colleagues yet', 'ar': 'لا زملاء بعد'},
  'dir_no_match_title': {'en': 'No matching colleagues', 'ar': 'لا زملاء مطابقين'},
  'dir_you': {'en': 'You', 'ar': 'أنت'},
  'dir_call': {'en': 'Call', 'ar': 'اتصال'},
  'dir_email': {'en': 'Email', 'ar': 'بريد إلكتروني'},
  'dir_no_phone': {'en': 'Could not open the phone dialer', 'ar': 'تعذّر فتح تطبيق الاتصال'},

  // knowledge base (communication feature group — read-only on mobile)
  'kb_title': {'en': 'Knowledge Base', 'ar': 'قاعدة المعرفة'},
  'kb_load_fail': {'en': 'Could not load the knowledge base.', 'ar': 'تعذّر تحميل قاعدة المعرفة.'},
  'kb_none_title': {'en': 'No articles yet', 'ar': 'لا مقالات بعد'},

  // events (communication feature group — read + self-service RSVP on mobile)
  'ev_title': {'en': 'Events', 'ar': 'الفعاليات'},
  'ev_load_fail': {'en': 'Could not load events.', 'ar': 'تعذّر تحميل الفعاليات.'},
  'ev_none_title': {'en': 'No events yet', 'ar': 'لا فعاليات بعد'},
  'ev_none_upcoming': {'en': 'No upcoming events', 'ar': 'لا فعاليات قادمة'},
  'ev_past': {'en': 'Past events', 'ar': 'فعاليات سابقة'},
  'ev_join': {'en': 'I’m going', 'ar': 'سأحضر'},
  'ev_leave': {'en': 'Cancel RSVP', 'ar': 'إلغاء الحضور'},
  'ev_rsvp_fail': {'en': 'Could not update your RSVP', 'ar': 'تعذّر تحديث حالة حضورك'},
  'ev_going_count': {'en': 'going', 'ar': 'سيحضرون'},

  // training & onboarding (hr_skills feature group — read + self-service completion)
  'tr_title': {'en': 'Training & Onboarding', 'ar': 'التدريب والتأهيل'},
  'tr_load_fail': {'en': 'Could not load training modules.', 'ar': 'تعذّر تحميل وحدات التدريب.'},
  'tr_none_title': {'en': 'No modules yet', 'ar': 'لا وحدات بعد'},
  'tr_complete': {'en': 'Mark complete', 'ar': 'تمييز كمكتملة'},
  'tr_uncomplete': {'en': 'Undo complete', 'ar': 'إلغاء الإكمال'},
  'tr_complete_fail': {'en': 'Could not update your progress', 'ar': 'تعذّر تحديث تقدّمك'},

  // form response view (shared)
  'fr_yes': {'en': 'Yes', 'ar': 'نعم'},
  'fr_no': {'en': 'No', 'ar': 'لا'},
  'fr_photo': {'en': 'Photo attached', 'ar': 'صورة مرفقة'},
};

// Server-composed error strings (`routes/*.js`'s `res.status(...).json({error:
// '...'})` bodies) that mobile screens can actually trigger, keyed by the
// exact literal the backend sends. Not every backend error string is here —
// web/admin-only ones (department, level, plan-cap errors) never reach a
// mobile screen, so they're left out rather than translated speculatively.
// A message not found here falls back to its raw English text (apiError()
// above) instead of guessing.
const Map<String, Map<String, String>> _serverErrorDict = {
  'Invalid credentials': {'en': 'Invalid credentials', 'ar': 'بيانات الدخول غير صحيحة'},
  'Too many login attempts, try again later': {
    'en': 'Too many login attempts, try again later',
    'ar': 'محاولات دخول كثيرة جدًا، حاول لاحقًا',
  },
  'Account is not active': {'en': 'Account is not active', 'ar': 'الحساب غير نشط'},
  'Invalid or expired token': {
    'en': 'Invalid or expired token',
    'ar': 'الجلسة غير صالحة أو منتهية',
  },
  'Authentication required': {'en': 'Authentication required', 'ar': 'تسجيل الدخول مطلوب'},
  'Forbidden': {'en': 'Forbidden', 'ar': 'غير مسموح'},
  'Not found': {'en': 'Not found', 'ar': 'غير موجود'},
  'Internal server error': {'en': 'Internal server error', 'ar': 'خطأ في الخادم'},
  'You are already clocked in': {
    'en': 'You are already clocked in',
    'ar': 'أنت مسجّل حضورك بالفعل',
  },
  'You are not clocked in': {'en': 'You are not clocked in', 'ar': 'لم تسجّل حضورك'},
  'You already have an active break': {
    'en': 'You already have an active break',
    'ar': 'لديك استراحة نشطة بالفعل',
  },
  'No active break to end': {
    'en': 'No active break to end',
    'ar': 'لا توجد استراحة نشطة لإنهائها',
  },
  'End your break before clocking out': {
    'en': 'End your break before clocking out',
    'ar': 'أنهِ استراحتك قبل تسجيل الانصراف',
  },
  'Entries can only be added to an active shift': {
    'en': 'Entries can only be added to an active shift',
    'ar': 'يمكن إضافة الإدخالات فقط أثناء وردية نشطة',
  },
  'This request cannot be cancelled': {
    'en': 'This request cannot be cancelled',
    'ar': 'لا يمكن إلغاء هذا الطلب',
  },
  'This task is already assigned to that employee': {
    'en': 'This task is already assigned to that employee',
    'ar': 'هذه المهمة مُسندة بالفعل لهذا الموظف',
  },
  'This request cannot be assigned in its current state': {
    'en': 'This request cannot be assigned in its current state',
    'ar': 'لا يمكن إسناد هذا الطلب في حالته الحالية',
  },
  'This feature is not enabled for your company': {
    'en': 'This feature is not enabled for your company',
    'ar': 'هذه الميزة غير مفعّلة لشركتك',
  },
  'date must be YYYY-MM-DD': {
    'en': 'date must be YYYY-MM-DD',
    'ar': 'يجب أن يكون التاريخ بصيغة YYYY-MM-DD',
  },
};
