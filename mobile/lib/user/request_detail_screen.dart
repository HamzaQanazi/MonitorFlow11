// Request Details / Timeline — the detail half of the merged My Requests
// page (Section 4). GET /requests/{id} embeds history and comments;
// refreshes on focus resume, not a timer (the polling rules). The user's
// actions — cancel (only while unassigned), confirm resolution, report
// unresolved — come from GET /requests/{id}/transitions (Phase 4: the one
// generic call, gates already applied server-side) and fire via
// POST /requests/{id}/transitions with expected_status. No status keys,
// no categories in code.
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
  List<TransitionOption>? _transitions;
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
      // Detail + the caller's legal next actions, together — the buttons
      // must always match the status they were computed from.
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
      _loadConfig();
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  /// Form schema (labels the answers). Best-effort: failure keeps
  /// prettified ids rather than blocking the page; retried on refresh.
  Future<void> _loadConfig() async {
    if (_requestFields != null) return;
    final api = context.read<AuthState>().api;
    final sid = _detail!.summary.serviceTypeId;
    try {
      final json = await api.get('/services/$sid/forms/request');
      if (!mounted) return;
      setState(() {
        _requestFields = FormFieldDef.parseSchema(json['fields'] as List<dynamic>);
      });
    } on Exception {
      // labels stay prettified this round; next load retries
    }
  }

  /// One generic action path (Phase 4): note prompt when the transition
  /// requires it, plain confirm otherwise. `destructive` = a note-requiring
  /// move into a terminal status (cancel-like).
  Future<void> _fire(TransitionOption t) async {
    final i18n = context.read<I18n>();
    final destructive = t.requiresNote && t.toTerminal;
    if (t.requiresNote) {
      final note = await _promptNote(
        title: '${i18n.l(t.label)}?',
        message: destructive ? i18n.tr('rd_cancel_body') : i18n.tr('rd_note_body'),
        confirmLabel: i18n.l(t.label),
        destructive: destructive,
      );
      if (note == null) return;
      await _act(t, note);
      return;
    }
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
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(i18n.l(t.label)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _act(t, null);
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
    // The server's legal next actions — both gates and the unassigned-only
    // cancel rule already applied. Destructive = a note-requiring move into
    // a terminal status (cancel-like); the rest live in the actions card.
    final actions = _transitions ?? const <TransitionOption>[];
    final destructive =
        actions.where((t) => t.requiresNote && t.toTerminal).toList();
    final regular =
        actions.where((t) => !(t.requiresNote && t.toTerminal)).toList();
    // The request has run its course — offer a prefilled resubmission.
    final finished = d.summary.status.isTerminal;

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
          if (regular.isNotEmpty) ...[
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
                  for (var i = 0; i < regular.length; i++) ...[
                    if (i > 0) const SizedBox(height: 10),
                    // Plain moves (confirm) are primary; note-requiring
                    // moves (dispute) are the quieter outlined button.
                    if (regular[i].requiresNote)
                      OutlinedButton(
                        onPressed: _acting ? null : () => _fire(regular[i]),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(52),
                        ),
                        child: Text(i18n.l(regular[i].label)),
                      )
                    else
                      ElevatedButton(
                        onPressed: _acting ? null : () => _fire(regular[i]),
                        child: Text(i18n.l(regular[i].label)),
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
          for (final t in destructive) ...[
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
    final c = stateColors(entry.status.isTerminal);
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
