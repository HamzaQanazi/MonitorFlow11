// Employee Home + My Tasks (one merged Section 4 page) — the field
// worker's queue. GET /tasks?employeeId=me, 30s polling, pull-to-refresh.
// Field-first ergonomics: full-width cards, status readable at a glance.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
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
    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: _tasks!.length,
        separatorBuilder: (_, _) => const SizedBox(height: 12),
        itemBuilder: (context, i) => _TaskCard(
          task: _tasks![i],
          onReturn: () => _load(silent: true),
        ),
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  final TaskSummary task;
  final VoidCallback onReturn;

  const _TaskCard({required this.task, required this.onReturn});

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
                  Text(
                    '${task.priority} priority · assigned '
                    '${DateFormat.yMMMd().format(task.assignedAt.toLocal())}',
                    style: const TextStyle(color: MfColors.muted, fontSize: 13),
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
