// User Home (Section 4, User app) — greeting, the primary "new request"
// action, and a glance at recent requests ("where is my request and what
// happens next" in one look — PRODUCT.md).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/request.dart';
import '../shared/notifications_screen.dart';
import '../shared/profile_screen.dart';
import '../theme.dart';
import '../widgets/states.dart';
import 'catalogue_screen.dart';
import 'my_requests_screen.dart';
import 'request_detail_screen.dart';

class UserHomeScreen extends StatefulWidget {
  const UserHomeScreen({super.key});

  @override
  State<UserHomeScreen> createState() => _UserHomeScreenState();
}

class _UserHomeScreenState extends State<UserHomeScreen> {
  List<RequestSummary>? _recent;
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
      final json = await api.get('/requests', query: {'pageSize': '3'});
      if (!mounted) return;
      setState(() {
        _recent = (json['requests'] as List<dynamic>)
            .map((r) => RequestSummary.fromJson(r as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _recent == null) setState(() => _error = e);
    }
  }

  Future<void> _openCatalogue() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const CatalogueScreen()),
    );
    _load(silent: true); // a request may have been submitted
  }

  Future<void> _openMyRequests() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const MyRequestsScreen()),
    );
    _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final firstName = (auth.user?.name ?? '').split(' ').first;

    return Scaffold(
      appBar: AppBar(
        title: const Text('MonitorFlow'),
        actions: [
          NotificationBell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => NotificationsScreen(
                  onOpenRequest: (ctx, requestId) => Navigator.of(ctx).push(
                    MaterialPageRoute(
                      builder: (_) => RequestDetailScreen(requestId: requestId),
                    ),
                  ),
                ),
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
      body: RefreshIndicator(
        color: MfColors.amber600,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Hi $firstName',
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text(
              'What do you need help with today?',
              style: TextStyle(color: MfColors.muted),
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _openCatalogue,
              icon: const Icon(Icons.add),
              label: const Text('New request'),
            ),
            const SizedBox(height: 28),
            Row(
              children: [
                const Expanded(
                  child: Text('Recent requests',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                ),
                TextButton(onPressed: _openMyRequests, child: const Text('View all')),
              ],
            ),
            const SizedBox(height: 4),
            ..._recentSection(),
          ],
        ),
      ),
    );
  }

  List<Widget> _recentSection() {
    if (_error != null && _recent == null) {
      return [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: ErrorState(
            message: _error is NetworkException
                ? 'Could not reach the server — check your connection.'
                : 'Could not load your requests.',
            onRetry: _load,
          ),
        ),
      ];
    }
    if (_recent == null) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 32),
          child: LoadingState(),
        ),
      ];
    }
    if (_recent!.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: EmptyState(
            icon: Icons.inbox_outlined,
            title: 'Nothing here yet',
            subtitle: 'Submit your first request to see its progress here.',
          ),
        ),
      ];
    }
    return [
      for (final r in _recent!)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Material(
            color: MfColors.bg,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: MfColors.border),
            ),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => RequestDetailScreen(requestId: r.id),
                  ),
                );
                _load(silent: true);
              },
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(r.serviceTypeName,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                    StatusPill(status: r.status),
                  ],
                ),
              ),
            ),
          ),
        ),
    ];
  }
}
