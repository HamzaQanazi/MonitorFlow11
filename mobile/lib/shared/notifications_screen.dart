// Notifications (shared Section 4 cross-app component — same screen in
// the User and Employee apps). 30s polling; tap marks read; read-all in
// the app bar. Navigation targets differ per app, so the host passes
// `onOpenRequest` — the User app opens Request Details, the Employee app
// resolves its task first.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../theme.dart';
import '../widgets/states.dart';

class AppNotification {
  final int id;
  final String type;
  final String message;
  final int? requestId;
  final bool isRead;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.message,
    this.requestId,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as int,
        type: json['type'] as String,
        message: json['message'] as String,
        requestId: json['requestId'] as int?,
        isRead: json['isRead'] == true,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class NotificationsScreen extends StatefulWidget {
  /// Called with the notification's requestId after marking it read.
  final void Function(BuildContext context, int requestId)? onOpenRequest;

  const NotificationsScreen({super.key, this.onOpenRequest});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification>? _items;
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
      final json =
          await api.get('/notifications', query: {'userId': 'me', 'pageSize': '100'});
      if (!mounted) return;
      setState(() {
        _items = (json['notifications'] as List<dynamic>)
            .map((n) => AppNotification.fromJson(n as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _items == null) setState(() => _error = e);
    }
  }

  Future<void> _readAll() async {
    final api = context.read<AuthState>().api;
    try {
      await api.patch('/notifications/read-all');
      _load(silent: true);
    } on Exception {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not mark all read — try again.')),
      );
    }
  }

  Future<void> _open(AppNotification n) async {
    final api = context.read<AuthState>().api;
    if (!n.isRead) {
      try {
        await api.patch('/notifications/${n.id}/read');
      } on Exception {
        // reading is best-effort; still navigate
      }
      _load(silent: true);
    }
    if (n.requestId != null && widget.onOpenRequest != null && mounted) {
      widget.onOpenRequest!(context, n.requestId!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _items?.any((n) => !n.isRead) ?? false;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (hasUnread)
            TextButton(onPressed: _readAll, child: const Text('Mark all read')),
        ],
      ),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null && _items == null) {
      return ErrorState(
        message: _error is NetworkException
            ? 'Could not reach the server — check your connection.'
            : 'Could not load notifications.',
        onRetry: _load,
      );
    }
    if (_items == null) return const LoadingState();
    if (_items!.isEmpty) {
      return const EmptyState(
        icon: Icons.notifications_none_outlined,
        title: 'No notifications',
        subtitle: 'Updates about your requests and tasks appear here.',
      );
    }
    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: _items!.length,
        separatorBuilder: (_, _) => const Divider(),
        itemBuilder: (context, i) {
          final n = _items![i];
          return ListTile(
            onTap: () => _open(n),
            leading: Icon(
              _iconFor(n.type),
              color: n.isRead ? MfColors.borderStrong : MfColors.amber600,
            ),
            title: Text(
              n.message,
              style: TextStyle(
                fontSize: 14,
                fontWeight: n.isRead ? FontWeight.w400 : FontWeight.w600,
              ),
            ),
            subtitle: Text(
              DateFormat.yMMMd().add_jm().format(n.createdAt.toLocal()),
              style: const TextStyle(fontSize: 12, color: MfColors.muted),
            ),
            trailing: n.isRead
                ? null
                : Container(
                    width: 9,
                    height: 9,
                    decoration: const BoxDecoration(
                      color: MfColors.amber600,
                      shape: BoxShape.circle,
                    ),
                  ),
          );
        },
      ),
    );
  }

  IconData _iconFor(String type) => switch (type) {
        'assigned' => Icons.assignment_ind_outlined,
        'status_changed' => Icons.swap_horiz_outlined,
        'completed' => Icons.check_circle_outline,
        'task_rejected' => Icons.undo_outlined,
        'comment' => Icons.chat_bubble_outline,
        // Spec v4 E1: proactive nudge (e.g. "please confirm the result").
        'escalation' => Icons.notification_important_outlined,
        _ => Icons.notifications_none_outlined,
      };
}

/// App-bar bell with the unread count — the entry point both apps mount.
class NotificationBell extends StatefulWidget {
  final VoidCallback onTap;

  const NotificationBell({super.key, required this.onTap});

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  int _unread = 0;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final api = context.read<AuthState>().api;
    try {
      final json =
          await api.get('/notifications', query: {'userId': 'me', 'pageSize': '1'});
      if (!mounted) return;
      setState(() => _unread = (json['unread'] as int?) ?? 0);
    } on Exception {
      // badge keeps its last value; the list screen shows real errors
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Notifications',
      onPressed: () async {
        widget.onTap();
        // refresh the badge when the user comes back
        await Future<void>.delayed(const Duration(milliseconds: 300));
        if (mounted) _load();
      },
      icon: Badge(
        isLabelVisible: _unread > 0,
        label: Text('$_unread'),
        backgroundColor: MfColors.amber600,
        child: const Icon(Icons.notifications_none_outlined),
      ),
    );
  }
}
