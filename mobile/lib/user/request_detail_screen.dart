// Request Details / Timeline — the detail half of the merged My Requests
// page (Section 4). GET /requests/{id} embeds history and comments;
// refreshes on focus resume, not a timer (the polling rules). The user's
// actions — cancel (only while unassigned), confirm resolution, report
// unresolved — are driven by the service's workflow definition: code
// reads categories and actions, never status keys (Section 9).
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/form_schema.dart';
import '../i18n.dart';
import '../models/request.dart';
import '../models/workflow.dart';
import '../theme.dart';
import '../widgets/form_response_view.dart';
import '../widgets/states.dart';
import 'create_request_screen.dart';

class RequestDetailScreen extends StatefulWidget {
  final int requestId;

  const RequestDetailScreen({super.key, required this.requestId});

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen>
    with WidgetsBindingObserver {
  RequestDetail? _detail;
  WorkflowDef? _workflow;
  List<FormFieldDef>? _requestFields;
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
      final json = await api.get('/requests/${widget.requestId}');
      if (!mounted) return;
      setState(() {
        _detail = RequestDetail.fromJson(json['request'] as Map<String, dynamic>);
        _error = null;
      });
      _loadConfig();
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  /// Workflow (drives the action buttons) and form schema (labels the
  /// answers). Best-effort: failure hides actions and keeps prettified
  /// ids rather than blocking the page; retried on the next refresh.
  Future<void> _loadConfig() async {
    if (_workflow != null && _requestFields != null) return;
    final api = context.read<AuthState>().api;
    final sid = _detail!.summary.serviceTypeId;
    try {
      final results = await Future.wait([
        api.get('/services/$sid/workflow'),
        api.get('/services/$sid/forms/request'),
      ]);
      if (!mounted) return;
      setState(() {
        _workflow = WorkflowDef.fromJson(results[0]);
        _requestFields =
            FormFieldDef.parseSchema(results[1]['fields'] as List<dynamic>);
      });
    } on Exception {
      // actions stay hidden this round; next load retries
    }
  }

  Future<void> _confirmResolution() async {
    final i18n = context.read<I18n>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(i18n.tr('rd_confirm_q')),
        content: Text(i18n.tr('rd_confirm_body')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(i18n.tr('back')),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(i18n.tr('confirm')),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _act('/requests/${widget.requestId}/resolution', {'outcome': 'confirmed'});
  }

  Future<void> _dispute() async {
    final i18n = context.read<I18n>();
    final note = await _promptNote(
      title: i18n.tr('rd_dispute_q'),
      message: i18n.tr('rd_dispute_body'),
      confirmLabel: i18n.tr('rd_dispute_btn'),
    );
    if (note == null) return;
    await _act('/requests/${widget.requestId}/resolution',
        {'outcome': 'unresolved', 'note': note});
  }

  Future<void> _cancel() async {
    final i18n = context.read<I18n>();
    final note = await _promptNote(
      title: i18n.tr('rd_cancel_q'),
      message: i18n.tr('rd_cancel_body'),
      confirmLabel: i18n.tr('rd_cancel_btn'),
      destructive: true,
    );
    if (note == null) return;
    await _act('/requests/${widget.requestId}/cancel', {'note': note});
  }

  Future<String?> _promptNote({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
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
              style: destructive
                  ? ElevatedButton.styleFrom(backgroundColor: MfColors.error)
                  : null,
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

  /// "Request again" — reopen Create Request prefilled with this request's
  /// answers. The catalogue is re-checked first: the service may have been
  /// disabled since (GET /services returns enabled only).
  Future<void> _requestAgain() async {
    final api = context.read<AuthState>().api;
    final int sid = _detail!.summary.serviceTypeId;
    ServiceType? service;
    try {
      final json = await api.get('/services');
      service = (json['services'] as List<dynamic>)
          .map((s) => ServiceType.fromJson(s as Map<String, dynamic>))
          .where((s) => s.id == sid)
          .firstOrNull;
    } on Exception {
      service = null;
    }
    if (!mounted) return;
    if (service == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('rd_service_unavailable'))),
      );
      return;
    }
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CreateRequestScreen(
          service: service!,
          initialResponse: _detail!.formResponse,
        ),
      ),
    );
  }

  Future<void> _act(String path, Map<String, dynamic> body) async {
    final i18n = context.read<I18n>();
    setState(() => _acting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.patch(path, body: body);
      if (!mounted) return;
      await _load(silent: true);
      if (!mounted) return;
      final label = _detail == null ? '' : i18n.l(_detail!.summary.status.label);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${i18n.tr('rd_now_pre')} "$label"')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      // 409 = the state moved under us (e.g. assigned meanwhile) — the
      // reload shows the truth and the stale button disappears.
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
    final statusKey = d.summary.status.key;
    final confirm = _workflow?.confirmFrom(statusKey);
    final dispute = _workflow?.disputeFrom(statusKey);
    final cancel = d.taskExists ? null : _workflow?.cancelFrom(statusKey);
    // The request has run its course — offer a prefilled resubmission.
    final finished =
        const {'closed', 'terminated'}.contains(d.summary.status.category);

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
            '${DateFormat.yMMMd().add_jm().format(d.summary.createdAt.toLocal())}'
            ' · ${i18n.priorityPhrase(d.summary.priority)}',
            style: const TextStyle(color: MfColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          _SectionTitle(i18n.tr('rd_timeline')),
          const SizedBox(height: 12),
          _Timeline(entries: d.statusHistory),
          if (confirm != null || dispute != null) ...[
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: MfColors.surface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    i18n.tr('rd_resolved_q'),
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 14),
                  if (confirm != null)
                    ElevatedButton(
                      onPressed: _acting ? null : _confirmResolution,
                      child: Text(i18n.tr('rd_confirm_btn')),
                    ),
                  if (dispute != null) ...[
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: _acting ? null : _dispute,
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                      child: Text(i18n.tr('rd_dispute_btn')),
                    ),
                  ],
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          _SectionTitle(i18n.tr('rd_answers')),
          const SizedBox(height: 12),
          FormResponseView(response: d.formResponse, fields: _requestFields),
          if (d.comments.isNotEmpty) ...[
            const SizedBox(height: 24),
            _SectionTitle(i18n.tr('rd_comments')),
            const SizedBox(height: 12),
            for (final c in d.comments) _CommentTile(comment: c),
          ],
          if (finished) ...[
            const SizedBox(height: 28),
            OutlinedButton.icon(
              onPressed: _acting ? null : _requestAgain,
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
              icon: const Icon(Icons.replay_outlined, size: 20),
              label: Text(i18n.tr('rd_again')),
            ),
          ],
          if (cancel != null) ...[
            const SizedBox(height: 28),
            OutlinedButton(
              onPressed: _acting ? null : _cancel,
              style: OutlinedButton.styleFrom(
                foregroundColor: MfColors.error,
                side: const BorderSide(color: MfColors.errorBorder),
                minimumSize: const Size.fromHeight(52),
              ),
              child: Text(i18n.tr('rd_cancel_btn')),
            ),
          ],
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

class _Timeline extends StatelessWidget {
  final List<HistoryEntry> entries;
  const _Timeline({required this.entries});

  @override
  Widget build(BuildContext context) {
    // Newest first, like the Monitor detail pane.
    final ordered = entries.reversed.toList();
    return Column(
      children: [
        for (var i = 0; i < ordered.length; i++)
          _TimelineRow(entry: ordered[i], isLast: i == ordered.length - 1),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  final HistoryEntry entry;
  final bool isLast;

  const _TimelineRow({required this.entry, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final c = categoryColors(entry.status.category);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Container(
                  width: 11,
                  height: 11,
                  margin: const EdgeInsets.only(top: 3),
                  decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                ),
                if (!isLast)
                  const Expanded(
                    child: VerticalDivider(width: 1, color: MfColors.border),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(i18n.l(entry.status.label),
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(
                    '${DateFormat.yMMMd().add_jm().format(entry.changedAt.toLocal())}'
                    ' · ${entry.changedByName}',
                    style: const TextStyle(color: MfColors.muted, fontSize: 12),
                  ),
                  if (entry.note != null && entry.note!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: MfColors.surface,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(entry.note!, style: const TextStyle(fontSize: 13)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CommentTile extends StatelessWidget {
  final RequestComment comment;
  const _CommentTile({required this.comment});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${comment.authorName} · '
            '${DateFormat.yMMMd().add_jm().format(comment.createdAt.toLocal())}',
            style: const TextStyle(color: MfColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Text(comment.body),
        ],
      ),
    );
  }
}
