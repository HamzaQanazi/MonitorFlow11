// Employee Home + My Tasks (one merged Section 4 page) — the field
// worker's queue. GET /tasks?employeeId=me, 30s polling, pull-to-refresh.
// Field-first ergonomics: full-width cards, status readable at a glance.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/task.dart';
import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../theme.dart';
import '../widgets/states.dart';
import 'task_detail_screen.dart';

class EmployeeHomeScreen extends StatefulWidget {
  const EmployeeHomeScreen({super.key});

  @override
  State<EmployeeHomeScreen> createState() => _EmployeeHomeScreenState();
}

class _EmployeeHomeScreenState extends State<EmployeeHomeScreen> {
  List<TaskSummary>? _tasks;
  Object? _error;
  Timer? _poll;
  String? _categoryFilter; // chip toggle, same behavior as the web board
  bool _showHistory = false;

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
            const SnackBar(content: Text('This task is no longer assigned to you.')),
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
    final auth = context.watch<AuthState>();
    final firstName = (auth.user?.name ?? '').split(' ').first;

    return Scaffold(
      appBar: AppBar(
        title: Text('My tasks — $firstName'),
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
            tooltip: 'Profile',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProfileScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => context.read<AuthState>().logout(),
          ),
        ],
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null && _tasks == null) {
      return ErrorState(
        message: _error is NetworkException
            ? 'Could not reach the server — check your connection.'
            : 'Could not load your tasks.',
        onRetry: _load,
      );
    }
    if (_tasks == null) return const LoadingState();
    if (_tasks!.isEmpty) {
      return const EmptyState(
        icon: Icons.task_alt_outlined,
        title: 'No tasks assigned',
        subtitle: 'New assignments will appear here.',
      );
    }

    // The queue is grouped by actionability, not assignment date: the
    // accept/reject decision first, live work next, finished work folded
    // away. Within groups: high priority first, then longest-waiting.
    const historyCats = {'done', 'closed', 'terminated'};
    final filtered = _categoryFilter == null
        ? _tasks!
        : _tasks!.where((t) => t.status.category == _categoryFilter).toList();
    int prio(TaskSummary t) =>
        const {'high': 0, 'medium': 1, 'low': 2}[t.priority] ?? 3;
    int byUrgency(TaskSummary a, TaskSummary b) {
      final p = prio(a).compareTo(prio(b));
      return p != 0 ? p : a.assignedAt.compareTo(b.assignedAt);
    }

    final needsResponse = filtered.where((t) => t.status.category == 'triage').toList()
      ..sort(byUrgency);
    final active = filtered
        .where((t) => !historyCats.contains(t.status.category) && t.status.category != 'triage')
        .toList()
      ..sort(byUrgency);
    final history = filtered.where((t) => historyCats.contains(t.status.category)).toList()
      ..sort((a, b) => b.assignedAt.compareTo(a.assignedAt));

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _CategoryChips(
            tasks: _tasks!,
            selected: _categoryFilter,
            onToggle: (cat) => setState(
                () => _categoryFilter = _categoryFilter == cat ? null : cat),
          ),
          const SizedBox(height: 16),
          if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 24),
              child: EmptyState(
                icon: Icons.filter_alt_off_outlined,
                title: 'No tasks in this category',
                action: OutlinedButton(
                  onPressed: () => setState(() => _categoryFilter = null),
                  child: const Text('Clear filter'),
                ),
              ),
            ),
          if (needsResponse.isNotEmpty) ...[
            const _SectionHeader('Needs response'),
            for (final t in needsResponse) _cardFor(t, attention: true),
          ],
          if (active.isNotEmpty) ...[
            const _SectionHeader('In progress'),
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
              label: Text('History (${history.length})'),
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

/// Category filter chips — the web board's vocabulary, toggled the same
/// way. Counts come from the unfiltered list.
class _CategoryChips extends StatelessWidget {
  final List<TaskSummary> tasks;
  final String? selected;
  final void Function(String category) onToggle;

  const _CategoryChips({
    required this.tasks,
    required this.selected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final counts = <String, int>{};
    for (final t in tasks) {
      counts[t.status.category] = (counts[t.status.category] ?? 0) + 1;
    }
    final cats =
        kCategoryColors.keys.where((c) => (counts[c] ?? 0) > 0).toList();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final cat in cats) ...[
            _chip(cat, counts[cat]!),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }

  Widget _chip(String cat, int count) {
    final c = categoryColors(cat);
    final isSelected = selected == cat;
    return Material(
      color: isSelected ? c.tint : MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(999),
        side: BorderSide(color: isSelected ? c.accent : MfColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => onToggle(cat),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
              ),
              const SizedBox(width: 6),
              Text(
                '${cat.replaceAll('_', ' ')} · $count',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: isSelected ? c.ink : MfColors.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
                      label: 'Needs response',
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
                      task.serviceTypeName,
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
                      'Task #${task.id} · Request #${task.requestId} · '
                      '${task.priority} priority · ${relativeTime(task.assignedAt)}',
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
