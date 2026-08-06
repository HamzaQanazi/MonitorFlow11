// Self-service request detail (employee-submitted, no task): status,
// timeline, form answers, and whatever the requester's own actions are (from
// GET /requests/{id}/transitions — rendered generically, no transition key
// hardcoded here, I4). Trimmed from the User app's RequestDetailScreen: these
// requests have no confirm/dispute/"resolved?" step (submit → done, no
// task), so that copy doesn't fit here. Shared by Time Off and Checklists —
// ponytail: the class/file name still says "TimeOff" from when this only
// served one feature; rename to something generic if a third one shows up.
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/form_schema.dart';
import '../i18n.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/form_response_view.dart';
import '../widgets/states.dart';
import '../widgets/timeline.dart';

class TimeOffDetailScreen extends StatefulWidget {
  final int requestId;

  const TimeOffDetailScreen({super.key, required this.requestId});

  @override
  State<TimeOffDetailScreen> createState() => _TimeOffDetailScreenState();
}

class _TimeOffDetailScreenState extends State<TimeOffDetailScreen> {
  RequestDetail? _detail;
  List<TransitionOption>? _transitions;
  List<FormFieldDef>? _requestFields;
  Object? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final results = await Future.wait([
        api.get('/requests/${widget.requestId}'),
        api.get('/requests/${widget.requestId}/transitions'),
      ]);
      if (!mounted) return;
      setState(() {
        _detail = RequestDetail.fromJson(results[0]['request'] as Map<String, dynamic>);
        _transitions = (results[1]['transitions'] as List<dynamic>)
            .map((t) => TransitionOption.fromJson(t as Map<String, dynamic>))
            .toList();
        _error = null;
      });
      _loadFields();
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  /// Form schema (labels the answers). Best-effort: failure keeps prettified
  /// ids rather than blocking the page; retried on refresh.
  Future<void> _loadFields() async {
    if (_requestFields != null) return;
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/services/${_detail!.summary.serviceTypeId}/forms/request');
      if (!mounted) return;
      setState(() => _requestFields = FormFieldDef.parseSchema(json['fields'] as List<dynamic>));
    } on Exception {
      // labels stay prettified this round; next load retries
    }
  }

  Future<void> _fire(TransitionOption t) async {
    final i18n = context.read<I18n>();
    String? note;
    if (t.requiresNote) {
      note = await _promptNote(i18n, t);
      if (note == null) return;
    } else {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('${i18n.l(t.label)}?'),
          content: Text(i18n.tr('rd_act_body')),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(i18n.tr('back')),
            ),
            ElevatedButton(
              style: t.toTerminal ? ElevatedButton.styleFrom(backgroundColor: MfColors.error) : null,
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(i18n.l(t.label)),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    await _act(t, note);
  }

  Future<String?> _promptNote(I18n i18n, TransitionOption t) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('${i18n.l(t.label)}?'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(i18n.tr('rd_note_body'), style: const TextStyle(fontSize: 14)),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                maxLines: 3,
                autofocus: true,
                decoration: InputDecoration(labelText: i18n.tr('note_required')),
                onChanged: (_) => setDialogState(() {}),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(null),
              child: Text(i18n.tr('back')),
            ),
            ElevatedButton(
              style: t.toTerminal ? ElevatedButton.styleFrom(backgroundColor: MfColors.error) : null,
              onPressed: controller.text.trim().isEmpty
                  ? null
                  : () => Navigator.of(context).pop(controller.text.trim()),
              child: Text(i18n.l(t.label)),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _act(TransitionOption t, String? note) async {
    final i18n = context.read<I18n>();
    setState(() => _acting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.post('/requests/${widget.requestId}/transitions', body: {
        'transition_key': t.key,
        // The status we acted on — a concurrent move 409s instead of
        // double-firing (must-pass #12/#13).
        'expected_status': _detail!.summary.status.key,
        'note': ?note,
      });
      if (!mounted) return;
      await _load(silent: true);
      if (!mounted) return;
      final label = _detail == null ? '' : i18n.l(_detail!.summary.status.label);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${i18n.tr('rd_now_pre')} "$label"')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      // 409 = the state moved under us (e.g. approved meanwhile) — the
      // reload shows the truth and the stale button disappears.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(i18n.apiError(e))));
      _load(silent: true);
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(i18n.tr('net_retry'))),
      );
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text('${i18n.tr('rd_title')} #${widget.requestId}')),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _detail == null) {
      final message = switch (_error) {
        ApiException(status: 404) => i18n.tr('rd_not_found'),
        NetworkException() => i18n.tr('net_check'),
        _ => i18n.tr('rd_load_fail'),
      };
      return ErrorState(message: message, onRetry: _load);
    }
    if (_detail == null) return const LoadingState();

    final d = _detail!;
    // The server's legal next actions — both gates and the requester's
    // unassigned-only cancel rule already applied server-side.
    final actions = _transitions ?? const <TransitionOption>[];

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  i18n.l(d.summary.serviceTypeName),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
              ),
              StatusPill(status: d.summary.status),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${i18n.tr('rd_submitted')} '
            '${DateFormat.yMMMd().add_jm().format(d.summary.createdAt.toLocal())}',
            style: const TextStyle(color: MfColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          Text(i18n.tr('rd_timeline'),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          RequestTimeline(entries: d.statusHistory),
          const SizedBox(height: 24),
          Text(i18n.tr('rd_answers'),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          FormResponseView(response: d.formResponse, fields: _requestFields),
          for (final t in actions) ...[
            const SizedBox(height: 28),
            OutlinedButton(
              onPressed: _acting ? null : () => _fire(t),
              style: OutlinedButton.styleFrom(
                foregroundColor: MfColors.error,
                side: const BorderSide(color: MfColors.errorBorder),
                minimumSize: const Size.fromHeight(52),
              ),
              child: Text(i18n.l(t.label)),
            ),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}
