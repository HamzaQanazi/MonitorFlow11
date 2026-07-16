// Employee Home + My Tasks (one merged Section 4 page) — the field
// worker's queue. GET /tasks?employeeId=me, 30s polling, pull-to-refresh.
// Field-first ergonomics: full-width cards, status readable at a glance.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/task.dart';
import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../theme.dart';
import '../widgets/state_chips.dart';
import '../widgets/states.dart';
import 'task_detail_screen.dart';
import 'task_map_view.dart';

class EmployeeHomeScreen extends StatefulWidget {
  const EmployeeHomeScreen({super.key});

  @override
  State<EmployeeHomeScreen> createState() => _EmployeeHomeScreenState();
}

class _EmployeeHomeScreenState extends State<EmployeeHomeScreen> {
  List<TaskSummary>? _tasks;
  Object? _error;
  Timer? _poll;
  String? _stateFilter; // open/closed chip toggle, same behavior as the web board
  bool _showHistory = false;
  bool _mapMode = false; // v5: list ⇄ map view of the same filtered queue

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/tasks', query: {'pageSize': '100'});
      if (!mounted) return;
      setState(() {
        _tasks = (json['tasks'] as List<dynamic>)
            .map((t) => TaskSummary.fromJson(t as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _tasks == null) setState(() => _error = e);
    }
  }

  Map<String, int> _stateCounts() {
    final counts = <String, int>{};
    for (final t in _tasks!) {
      final s = t.status.isTerminal ? 'closed' : 'open';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }

  /// An employee notification points at a request; find their task for it.
  Future<void> _openTaskForRequest(BuildContext ctx, int requestId) async {
    final match = _tasks?.where((t) => t.requestId == requestId).toList();
    if (match == null || match.isEmpty) {
      // Not in the cached list (e.g. rejected away) — refresh and retry once.
      await _load(silent: true);
      final retry = _tasks?.where((t) => t.requestId == requestId).toList();
      if (retry == null || retry.isEmpty) {
        if (ctx.mounted) {
          ScaffoldMessenger.of(ctx).showSnackBar(
            SnackBar(content: Text(ctx.read<I18n>().tr('eh_task_gone'))),
          );
        }
        return;
      }
      if (!ctx.mounted) return;
      await Navigator.of(ctx).push(
        MaterialPageRoute(builder: (_) => TaskDetailScreen(taskId: retry.first.id)),
      );
      return;
    }
    await Navigator.of(ctx).push(
      MaterialPageRoute(builder: (_) => TaskDetailScreen(taskId: match.first.id)),
    );
    _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final auth = context.watch<AuthState>();
    final firstName = (auth.user?.name ?? '').split(' ').first;

    return Scaffold(
      appBar: AppBar(
        title: Text('${i18n.tr('eh_title')} — $firstName'),
        actions: [
          NotificationBell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) =>
                    NotificationsScreen(onOpenRequest: _openTaskForRequest),
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.person_outline),
            tooltip: i18n.tr('profile'),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProfileScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: i18n.tr('sign_out'),
            onPressed: () => context.read<AuthState>().logout(),
          ),
        ],
      ),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _tasks == null) {
      return ErrorState(
        message: _error is NetworkException
            ? i18n.tr('net_check')
            : i18n.tr('eh_load_fail'),
        onRetry: _load,
      );
    }
    if (_tasks == null) return const LoadingState();
    if (_tasks!.isEmpty) {
      return EmptyState(
        icon: Icons.task_alt_outlined,
        title: i18n.tr('eh_none_title'),
        subtitle: i18n.tr('eh_none_sub'),
      );
    }

    // The queue is grouped by actionability, not assignment date: the
    // accept/reject decision first (the server-derived needsResponse
    // window), live work next, finished work folded away. Within groups:
    // high priority first, then longest-waiting. Phase 4: history is simply
    // the terminal statuses — no categories.
    final filtered = _stateFilter == null
        ? _tasks!
        : _tasks!
            .where((t) => (t.status.isTerminal ? 'closed' : 'open') == _stateFilter)
            .toList();
    int prio(TaskSummary t) =>
        const {'high': 0, 'medium': 1, 'low': 2}[t.priority] ?? 3;
    int byUrgency(TaskSummary a, TaskSummary b) {
      final p = prio(a).compareTo(prio(b));
      return p != 0 ? p : a.assignedAt.compareTo(b.assignedAt);
    }

    final needsResponse =
        filtered.where((t) => !t.status.isTerminal && t.needsResponse).toList()
          ..sort(byUrgency);
    final active = filtered
        .where((t) => !t.status.isTerminal && !t.needsResponse)
        .toList()
      ..sort(byUrgency);
    final history = filtered.where((t) => t.status.isTerminal).toList()
      ..sort((a, b) => b.assignedAt.compareTo(a.assignedAt));

    final toggle = Center(
      child: SegmentedButton<bool>(
        showSelectedIcon: false,
        segments: [
          ButtonSegment(value: false, icon: const Icon(Icons.list, size: 18), label: Text(i18n.tr('eh_list'))),
          ButtonSegment(value: true, icon: const Icon(Icons.map_outlined, size: 18), label: Text(i18n.tr('eh_map'))),
        ],
        selected: {_mapMode},
        onSelectionChanged: (s) => setState(() => _mapMode = s.first),
      ),
    );

    if (_mapMode) {
      // Pins are active work only — finished tasks stay in the list's
      // History fold (isTerminal, no status keys).
      final mapTasks = filtered.where((t) => !t.status.isTerminal).toList();
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Column(
              children: [
                toggle,
                const SizedBox(height: 12),
                StateChips(
                  counts: _stateCounts(),
                  selected: _stateFilter,
                  onToggle: (s) => setState(
                      () => _stateFilter = _stateFilter == s ? null : s),
                ),
              ],
            ),
          ),
          Expanded(
            child: TaskMapView(
              tasks: mapTasks,
              onOpen: (t) async {
                await Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => TaskDetailScreen(taskId: t.id)),
                );
                _load(silent: true);
              },
            ),
          ),
        ],
      );
    }

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          toggle,
          const SizedBox(height: 12),
          StateChips(
            counts: _stateCounts(),
            selected: _stateFilter,
            onToggle: (s) => setState(
                () => _stateFilter = _stateFilter == s ? null : s),
          ),
          const SizedBox(height: 16),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: EmptyState(
                icon: Icons.filter_alt_off_outlined,
                title: i18n.tr('eh_none_cat'),
                action: OutlinedButton(
                  onPressed: () => setState(() => _stateFilter = null),
                  child: Text(i18n.tr('clear_filter')),
                ),
              ),
            ),
          if (needsResponse.isNotEmpty) ...[
            _SectionHeader(i18n.tr('eh_needs_response')),
            for (final t in needsResponse) _cardFor(t, attention: true),
          ],
          if (active.isNotEmpty) ...[
            _SectionHeader(i18n.tr('eh_in_progress')),
            for (final t in active) _cardFor(t),
          ],
          if (history.isNotEmpty) ...[
            const SizedBox(height: 4),
            TextButton.icon(
              onPressed: () => setState(() => _showHistory = !_showHistory),
              icon: Icon(
                _showHistory ? Icons.expand_less : Icons.expand_more,
                size: 18,
              ),
              label: Text('${i18n.tr('eh_history')} (${history.length})'),
            ),
            if (_showHistory) for (final t in history) _cardFor(t),
          ],
        ],
      ),
    );
  }

  Widget _cardFor(TaskSummary t, {bool attention = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: _TaskCard(
          task: t,
          attention: attention,
          onReturn: () => _load(silent: true),
        ),
      );
}

class _SectionHeader extends StatelessWidget {
  final String text;
  const _SectionHeader(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 10, top: 4),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: MfColors.muted,
            letterSpacing: 0.3,
          ),
        ),
      );
}


class _TaskCard extends StatelessWidget {
  final TaskSummary task;
  final VoidCallback onReturn;

  /// True in the "Needs response" group — the accept/reject decision is
  /// time-sensitive, so it gets the one amber attention dot.
  final bool attention;

  const _TaskCard({
    required this.task,
    required this.onReturn,
    this.attention = false,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Material(
      color: MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: MfColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => TaskDetailScreen(taskId: task.id)),
          );
          onReturn();
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (attention) ...[
                    Semantics(
                      label: i18n.tr('eh_needs_response'),
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: MfColors.amber600,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: Text(
                      i18n.l(task.serviceTypeName),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                    ),
                  ),
                  StatusPill(status: task.status),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  if (task.priority == 'high') ...[
                    const Icon(Icons.priority_high, size: 15, color: MfColors.error),
                    const SizedBox(width: 2),
                  ],
                  Expanded(
                    child: Text(
                      // The request # is the shared key with the Monitor
                      // board — what a dispatcher can actually look up.
                      '${i18n.tr('eh_task')} #${task.id} · ${i18n.tr('eh_request')} #${task.requestId} · '
                      '${i18n.priorityPhrase(task.priority)} · ${i18n.relativeTime(task.assignedAt)}',
                      style: const TextStyle(color: MfColors.muted, fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
