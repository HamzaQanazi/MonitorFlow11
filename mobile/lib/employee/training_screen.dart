// Training & Onboarding (hr_skills feature group): read + self-service
// completion on mobile — authoring stays console-only. Flat list, completed
// modules show a checkmark instead of being hidden (an employee should still
// be able to re-read something they already finished).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/training_module.dart';
import '../theme.dart';
import '../widgets/states.dart';

class TrainingScreen extends StatefulWidget {
  const TrainingScreen({super.key});

  @override
  State<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends State<TrainingScreen> {
  List<TrainingModule>? _modules;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/training');
      if (!mounted) return;
      setState(() {
        _modules = (json['modules'] as List<dynamic>)
            .map((m) => TrainingModule.fromJson(m as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  Future<void> _toggleComplete(TrainingModule module) async {
    final api = context.read<AuthState>().api;
    try {
      if (module.isComplete) {
        await api.delete('/training/${module.id}/complete');
      } else {
        await api.post('/training/${module.id}/complete');
      }
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('tr_complete_fail'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('tr_title'))),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _modules == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('tr_load_fail'),
        onRetry: _load,
      );
    }
    if (_modules == null) return const LoadingState();
    if (_modules!.isEmpty) {
      return EmptyState(icon: Icons.school_outlined, title: i18n.tr('tr_none_title'));
    }

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: _modules!.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _ModuleCard(
          module: _modules![i],
          onTap: () => _openDetail(_modules![i]),
        ),
      ),
    );
  }

  Future<void> _openDetail(TrainingModule module) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => _ModuleDetailScreen(module: module, onToggle: () => _toggleComplete(module)),
      ),
    );
    _load();
  }
}

class _ModuleCard extends StatelessWidget {
  final TrainingModule module;
  final VoidCallback onTap;

  const _ModuleCard({required this.module, required this.onTap});

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
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Text(i18n.l(module.title),
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              ),
              if (module.isComplete)
                const Icon(Icons.check_circle, color: MfColors.amber600, size: 20)
              else
                const Icon(Icons.radio_button_unchecked, color: MfColors.muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

class _ModuleDetailScreen extends StatelessWidget {
  final TrainingModule module;
  final VoidCallback onToggle;

  const _ModuleDetailScreen({required this.module, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.l(module.title))),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            OutlinedButton.icon(
              onPressed: onToggle,
              icon: Icon(module.isComplete ? Icons.check_circle : Icons.radio_button_unchecked),
              label: Text(module.isComplete ? i18n.tr('tr_uncomplete') : i18n.tr('tr_complete')),
            ),
            const SizedBox(height: 20),
            Text(i18n.l(module.body), style: const TextStyle(fontSize: 15, height: 1.5)),
          ],
        ),
      ),
    );
  }
}
