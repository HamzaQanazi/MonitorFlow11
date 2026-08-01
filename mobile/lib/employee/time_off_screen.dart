// My Time Off (employee self-service): list of the employee's own submitted
// requests plus a button to request more. GET /requests is now scoped to
// "own rows OR subtree-owned rows" for an employee (the Time Off engine
// change), so a plain employee sees exactly their own submissions here —
// no Time-Off-specific filtering in this file. Reuses the generic
// CreateRequestScreen/DynamicForm (I4) for submission; Time Off is assumed
// to be the only service with acceptsEmployeeSubmitters right now, so this
// screen doesn't offer a multi-service catalogue.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/request.dart';
import '../theme.dart';
import '../user/create_request_screen.dart';
import '../widgets/states.dart';
import 'time_off_detail_screen.dart';

class TimeOffScreen extends StatefulWidget {
  const TimeOffScreen({super.key});

  @override
  State<TimeOffScreen> createState() => _TimeOffScreenState();
}

class _TimeOffScreenState extends State<TimeOffScreen> {
  List<RequestSummary>? _requests;
  ServiceType? _service;
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
      final results = await Future.wait([
        api.get('/requests', query: {'pageSize': '100'}),
        api.get('/services'),
      ]);
      if (!mounted) return;
      final services = (results[1]['services'] as List<dynamic>)
          .map((s) => ServiceType.fromJson(s as Map<String, dynamic>))
          .toList();
      setState(() {
        _requests = (results[0]['requests'] as List<dynamic>)
            .map((r) => RequestSummary.fromJson(r as Map<String, dynamic>))
            .toList();
        _service = services.where((s) => s.acceptsEmployeeSubmitters).firstOrNull;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _requests == null) setState(() => _error = e);
    }
  }

  Future<void> _requestNew() async {
    if (_service == null) return;
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => CreateRequestScreen(service: _service!)),
    );
    if (submitted == true) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(
        title: Text(i18n.tr('to_title')),
        actions: [
          if (_service != null)
            IconButton(
              icon: const Icon(Icons.add),
              tooltip: i18n.tr('to_new'),
              onPressed: _requestNew,
            ),
        ],
      ),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _requests == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('to_load_fail'),
        onRetry: _load,
      );
    }
    if (_requests == null) return const LoadingState();
    if (_requests!.isEmpty) {
      return EmptyState(
        icon: Icons.beach_access_outlined,
        title: i18n.tr('to_none_title'),
        subtitle: i18n.tr('to_none_sub'),
        action: _service == null
            ? null
            : OutlinedButton(onPressed: _requestNew, child: Text(i18n.tr('to_new'))),
      );
    }

    final sorted = List<RequestSummary>.of(_requests!)
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final r in sorted) ...[
            _TimeOffCard(request: r, onReturn: () => _load(silent: true)),
            const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _TimeOffCard extends StatelessWidget {
  final RequestSummary request;
  final VoidCallback onReturn;

  const _TimeOffCard({required this.request, required this.onReturn});

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
            MaterialPageRoute(builder: (_) => TimeOffDetailScreen(requestId: request.id)),
          );
          onReturn();
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '#${request.id} · ${i18n.relativeTime(request.createdAt)}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                ),
              ),
              StatusPill(status: request.status),
            ],
          ),
        ),
      ),
    );
  }
}
