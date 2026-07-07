// My Requests (Section 4, User app — merged list + detail/timeline page).
// 30s silent polling per the polling rules; pull-to-refresh; tap → detail.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/category_chips.dart';
import '../widgets/states.dart';
import 'request_detail_screen.dart';

class MyRequestsScreen extends StatefulWidget {
  const MyRequestsScreen({super.key});

  @override
  State<MyRequestsScreen> createState() => _MyRequestsScreenState();
}

class _MyRequestsScreenState extends State<MyRequestsScreen> {
  List<RequestSummary>? _requests;
  Object? _error;
  Timer? _poll;
  String? _categoryFilter; // chip toggle, same behavior as the employee queue

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
      final json = await api.get('/requests', query: {'pageSize': '100'});
      if (!mounted) return;
      setState(() {
        _requests = (json['requests'] as List<dynamic>)
            .map((r) => RequestSummary.fromJson(r as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      // Silent polls never replace data with an error screen.
      if (!silent || _requests == null) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My requests')),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null && _requests == null) {
      return ErrorState(
        message: _error is NetworkException
            ? 'Could not reach the server — check your connection.'
            : 'Could not load your requests.',
        onRetry: _load,
      );
    }
    if (_requests == null) return const LoadingState();
    if (_requests!.isEmpty) {
      return EmptyState(
        icon: Icons.inbox_outlined,
        title: 'No requests yet',
        subtitle: 'Your submitted requests and their progress will appear here.',
        action: OutlinedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Browse services'),
        ),
      );
    }
    final counts = <String, int>{};
    for (final r in _requests!) {
      counts[r.status.category] = (counts[r.status.category] ?? 0) + 1;
    }
    final filtered = _categoryFilter == null
        ? _requests!
        : _requests!.where((r) => r.status.category == _categoryFilter).toList();

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          CategoryChips(
            counts: counts,
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
                title: 'No requests in this category',
                action: OutlinedButton(
                  onPressed: () => setState(() => _categoryFilter = null),
                  child: const Text('Clear filter'),
                ),
              ),
            ),
          for (final r in filtered) ...[
            _RequestCard(
              request: r,
              onReturn: () => _load(silent: true), // detail may have changed things
            ),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  final RequestSummary request;
  final VoidCallback onReturn;

  const _RequestCard({required this.request, required this.onReturn});

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
            MaterialPageRoute(
              builder: (_) => RequestDetailScreen(requestId: request.id),
            ),
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
                      request.serviceTypeName,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                  ),
                  StatusPill(status: request.status),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '#${request.id} · ${relativeTime(request.createdAt)}',
                style: const TextStyle(color: MfColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
