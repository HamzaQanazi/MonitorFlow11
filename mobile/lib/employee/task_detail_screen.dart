// Task Details (Section 4, Employee app) — GET /tasks/{id} (the limited
// employee view; employees never call GET /requests/{id} for data). Every
// action button is driven by GET /requests/{requestId}/transitions (Phase 4:
// the one generic call — accept/reject/complete/status endpoints are gone)
// and fired via POST /requests/{requestId}/transitions with expected_status
// for concurrency. All confirm; note fields appear where the workflow
// requires them (Section 4 UI-state rule + requires_note).
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/form_schema.dart';
import '../i18n.dart';
import '../models/request.dart';
import '../models/task.dart';
import '../theme.dart';
import '../widgets/form_response_view.dart';
import '../widgets/states.dart';
import 'complete_task_screen.dart';

class TaskDetailScreen extends StatefulWidget {
  final int taskId;

  const TaskDetailScreen({super.key, required this.taskId});

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen>
    with WidgetsBindingObserver {
  TaskDetail? _detail;
  List<TransitionOption>? _transitions;
  List<FormFieldDef>? _requestFields; // labels for the answers; optional
  Object? _error;
  bool _acting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      // The task first (it carries requestId), then the actions for that
      // request — the assignee party of the one generic transitions call.
      final taskJson = await api.get('/tasks/${widget.taskId}');
      final detail = TaskDetail.fromJson(taskJson['task'] as Map<String, dynamic>);
      final txJson = await api.get('/requests/${detail.summary.requestId}/transitions');
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _transitions = (txJson['transitions'] as List<dynamic>)
            .map((t) => TransitionOption.fromJson(t as Map<String, dynamic>))
            .toList();
        _error = null;
      });
      _loadRequestFields();
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  /// Best-effort: the answers render with prettified ids until (or if
  /// ever) the schema arrives — never blocks the page.
  Future<void> _loadRequestFields() async {
    if (_requestFields != null || _detail == null) return;
    final api = context.read<AuthState>().api;
    try {
      final json =
          await api.get('/services/${_detail!.summary.serviceTypeId}/forms/request');
      if (!mounted) return;
      setState(() =>
          _requestFields = FormFieldDef.parseSchema(json['fields'] as List<dynamic>));
    } on Exception {
      // keep the fallback rendering
    }
  }

  Future<void> _call(String phone) async {
    final ok = await launchUrl(Uri(scheme: 'tel', path: phone))
        .then((v) => v, onError: (_) => false);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('td_no_phone'))),
      );
    }
  }

  /// One generic action path: note prompt when the transition requires it,
  /// plain confirm otherwise — the button labels come from the workflow data.
  Future<void> _fire(TransitionOption t) async {
    final i18n = context.read<I18n>();
    final moveTitle = '${i18n.tr('td_move_pre')} "${i18n.l(t.toLabel)}"?';
    if (t.requiresNote) {
      final note = await _promptNote(
        title: moveTitle,
        message: i18n.tr('td_move_note'),
        confirmLabel: i18n.l(t.label),
      );
      if (note == null) return;
      await _act(t, note);
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(moveTitle),
        content: Text(i18n.tr('td_move_notify')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(i18n.tr('back')),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(i18n.l(t.label)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _act(t, null);
  }

  /// A transition carrying a required form (completion) opens the form
  /// screen, which fires the transition together with the form payload.
  Future<void> _complete(TransitionOption t) async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CompleteTaskScreen(
          taskId: widget.taskId,
          requestId: _detail!.summary.requestId,
          transition: t,
          expectedStatus: _detail!.summary.status.key,
          serviceTypeId: _detail!.summary.serviceTypeId,
          serviceTypeName: _detail!.summary.serviceTypeName,
        ),
      ),
    );
    if (done == true) _load(silent: true);
  }

  Future<String?> _promptNote({
    required String title,
    required String message,
    required String confirmLabel,
  }) {
    final i18n = context.read<I18n>();
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(title),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message, style: const TextStyle(fontSize: 14)),
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
              onPressed: controller.text.trim().isEmpty
                  ? null
                  : () => Navigator.of(context).pop(controller.text.trim()),
              child: Text(confirmLabel),
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
      await api.post('/requests/${_detail!.summary.requestId}/transitions', body: {
        'transition_key': t.key,
        // Optimistic concurrency: the status we acted on. A concurrent move
        // makes the server 409 instead of double-firing (must-pass #12).
        'expected_status': _detail!.summary.status.key,
        'note': ?note,
      });
      if (!mounted) return;
      await _load(silent: true);
      if (!mounted) return;
      final label = _detail == null ? '' : i18n.l(_detail!.summary.status.label);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${i18n.tr('td_now_pre')} "$label"')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      // 409 = someone changed the task under us — reload shows the truth.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
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
    // The request # is the shared key with the Monitor board.
    final requestId = _detail?.summary.requestId;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          requestId == null
              ? '${i18n.tr('td_title')} #${widget.taskId}'
              : '${i18n.tr('td_title')} #${widget.taskId} · ${i18n.tr('eh_request')} #$requestId',
        ),
      ),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _detail == null) {
      final message = switch (_error) {
        ApiException(status: 404) => i18n.tr('td_not_found'),
        NetworkException() => i18n.tr('net_check'),
        _ => i18n.tr('td_load_fail'),
      };
      return ErrorState(message: message, onRetry: _load);
    }
    if (_detail == null) return const LoadingState();

    final d = _detail!;

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
            '${i18n.priorityPhrase(d.summary.priority)} · ${i18n.tr('td_assigned')} '
            '${DateFormat.yMMMd().add_jm().format(d.summary.assignedAt.toLocal())}',
            style: const TextStyle(color: MfColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          _SectionTitle(i18n.tr('td_requester')),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: MfColors.surface,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                const Icon(Icons.person_outline, color: MfColors.muted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(d.requesterName,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                if (d.requesterPhone != null && d.requesterPhone!.isNotEmpty)
                  // Tap-to-call: the field-ops path from seeing a task to
                  // reaching the requester. tel: needs a phone app — on
                  // platforms without one (e.g. desktop) we say so instead.
                  TextButton.icon(
                    onPressed: () => _call(d.requesterPhone!),
                    icon: const Icon(Icons.call, size: 18),
                    label: Text(d.requesterPhone!),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _SectionTitle(i18n.tr('td_request_details')),
          const SizedBox(height: 10),
          FormResponseView(response: d.requestFormResponse, fields: _requestFields),
          const SizedBox(height: 28),
          // Exactly the server's legal next actions, in workflow-data order:
          // a form-carrying transition (complete) opens its form; a plain
          // move is primary; a note-requiring move (reject, hold) is the
          // quieter outlined button.
          for (final t in _transitions ?? const <TransitionOption>[]) ...[
            if (t.requiredFormKey != null)
              ElevatedButton(
                onPressed: _acting ? null : () => _complete(t),
                child: Text(i18n.l(t.label)),
              )
            else if (t.requiresNote)
              OutlinedButton(
                onPressed: _acting ? null : () => _fire(t),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                child: Text(i18n.l(t.label)),
              )
            else
              ElevatedButton(
                onPressed: _acting ? null : () => _fire(t),
                child: Text(i18n.l(t.label)),
              ),
            const SizedBox(height: 12),
          ],
          if (_transitions != null && _transitions!.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                i18n.tr('td_no_actions'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: MfColors.muted, fontSize: 13),
              ),
            ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      );
}
