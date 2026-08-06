// My Checklists (employee self-service): unlike Time Off, there can be
// several checklist templates at once, so this is a list-of-templates
// screen rather than TimeOffScreen's single-service shortcut. Checklist
// services are identified by featureKey == 'forms_checklists' (lib/
// onboardingOptions.js's catalogue) — the same acceptsEmployeeSubmitters
// flag Time Off uses, so featureKey is what keeps the two apart. GET
// /requests already returns "own rows OR subtree-owned rows" for an
// employee; filtered here to just this screen's own template ids so a
// manager's subtree-owned requests (and Time Off) don't show up in the
// submissions list below.
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

class ChecklistsScreen extends StatefulWidget {
  const ChecklistsScreen({super.key});

  @override
  State<ChecklistsScreen> createState() => _ChecklistsScreenState();
}

class _ChecklistsScreenState extends State<ChecklistsScreen> {
  List<ServiceType>? _templates;
  List<RequestSummary>? _requests;
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
      final templates = (results[1]['services'] as List<dynamic>)
          .map((s) => ServiceType.fromJson(s as Map<String, dynamic>))
          .where((s) => s.acceptsEmployeeSubmitters && s.featureKey == 'forms_checklists')
          .toList();
      final templateIds = templates.map((s) => s.id).toSet();
      setState(() {
        _templates = templates;
        _requests = (results[0]['requests'] as List<dynamic>)
            .map((r) => RequestSummary.fromJson(r as Map<String, dynamic>))
            .where((r) => templateIds.contains(r.serviceTypeId))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _templates == null) setState(() => _error = e);
    }
  }

  Future<void> _requestNew(ServiceType template) async {
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => CreateRequestScreen(service: template)),
    );
    if (submitted == true) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('cl_title'))),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _templates == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('cl_load_fail'),
        onRetry: _load,
      );
    }
    if (_templates == null) return const LoadingState();
    if (_templates!.isEmpty) {
      return EmptyState(
        icon: Icons.checklist_outlined,
        title: i18n.tr('cl_templates_none'),
      );
    }

    final sorted = List<RequestSummary>.of(_requests ?? const [])
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          for (final t in _templates!) ...[
            _ChecklistTemplateRow(template: t, onNew: () => _requestNew(t)),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 12),
          Text(i18n.tr('cl_submissions'), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          if (sorted.isEmpty)
            EmptyState(icon: Icons.checklist_outlined, title: i18n.tr('cl_none_title'), subtitle: i18n.tr('cl_none_sub'))
          else
            for (final r in sorted) ...[
              _ChecklistSubmissionCard(request: r, onReturn: () => _load(silent: true)),
              const SizedBox(height: 12),
            ],
        ],
      ),
    );
  }
}

class _ChecklistTemplateRow extends StatelessWidget {
  final ServiceType template;
  final VoidCallback onNew;

  const _ChecklistTemplateRow({required this.template, required this.onNew});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Material(
      color: MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: MfColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                i18n.l(template.name),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
            Semantics(
              button: true,
              excludeSemantics: true,
              label: '${i18n.l(template.name)}: ${i18n.tr('cl_new_template')}',
              child: OutlinedButton(onPressed: onNew, child: Text(i18n.tr('cl_new_template'))),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChecklistSubmissionCard extends StatelessWidget {
  final RequestSummary request;
  final VoidCallback onReturn;

  const _ChecklistSubmissionCard({required this.request, required this.onReturn});

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
                  '${i18n.l(request.serviceTypeName)} · ${i18n.relativeTime(request.createdAt)}',
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
