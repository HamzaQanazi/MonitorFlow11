// Task Details (Section 4, Employee app) — GET /tasks/{id} (the limited
// employee view; employees never call GET /requests/{id}). Action buttons
// come from GET /tasks/{id}/valid-transitions: this part wires the
// accept / reject actions; generic status updates and Complete Task are
// the next part. Both actions confirm; reject requires a note
// (Section 4 UI-state rule + workflow requires_note).
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/task.dart';
import '../theme.dart';
import '../widgets/states.dart';

class TaskDetailScreen extends StatefulWidget {
  final int taskId;

  const TaskDetailScreen({super.key, required this.taskId});

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen>
    with WidgetsBindingObserver {
  TaskDetail? _detail;
  List<TaskTransition>? _transitions;
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
      final results = await Future.wait([
        api.get('/tasks/${widget.taskId}'),
        api.get('/tasks/${widget.taskId}/valid-transitions'),
      ]);
      if (!mounted) return;
      setState(() {
        _detail = TaskDetail.fromJson(results[0]['task'] as Map<String, dynamic>);
        _transitions = (results[1]['transitions'] as List<dynamic>)
            .map((t) => TaskTransition.fromJson(t as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  Future<void> _accept(TaskTransition t) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Accept this task?'),
        content: Text('The task moves to "${t.toLabel}" and the requester is notified.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Back'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Accept task'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _act('/tasks/${widget.taskId}/accept', {});
  }

  Future<void> _reject(TaskTransition t) async {
    final note = await _promptNote(
      title: 'Reject this task?',
      message:
          'The request goes back to the queue for reassignment and the monitors are notified. '
          'A note explaining why is required.',
      confirmLabel: 'Reject task',
    );
    if (note == null) return;
    await _act('/tasks/${widget.taskId}/reject', {'note': note});
  }

  Future<String?> _promptNote({
    required String title,
    required String message,
    required String confirmLabel,
  }) {
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
                decoration: const InputDecoration(labelText: 'Note (required)'),
                onChanged: (_) => setDialogState(() {}),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(null),
              child: const Text('Back'),
            ),
            ElevatedButton(
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

  Future<void> _act(String path, Map<String, dynamic> body) async {
    setState(() => _acting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.patch(path, body: body);
      if (!mounted) return;
      await _load(silent: true);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Task is now "${_detail?.summary.status.label}"')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      // 409 = someone changed the task under us — reload shows the truth.
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      _load(silent: true);
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not reach the server — try again.')),
      );
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Task #${widget.taskId}')),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null && _detail == null) {
      final message = switch (_error) {
        ApiException(status: 404) => 'This task could not be found.',
        NetworkException() => 'Could not reach the server — check your connection.',
        _ => 'Could not load this task.',
      };
      return ErrorState(message: message, onRetry: _load);
    }
    if (_detail == null) return const LoadingState();

    final d = _detail!;
    final accept = _transitions?.where((t) => t.action == 'accept').firstOrNull;
    final reject = _transitions?.where((t) => t.action == 'reject').firstOrNull;

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
                  d.summary.serviceTypeName,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
              ),
              StatusPill(status: d.summary.status),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${d.summary.priority} priority · assigned '
            '${DateFormat.yMMMd().add_jm().format(d.summary.assignedAt.toLocal())}',
            style: const TextStyle(color: MfColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          const _SectionTitle('Requester'),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: MfColors.surface,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                const Icon(Icons.person_outline, color: MfColors.muted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(d.requesterName,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                if (d.requesterPhone != null && d.requesterPhone!.isNotEmpty)
                  Text(d.requesterPhone!,
                      style: const TextStyle(color: MfColors.muted)),
              ],
            ),
          ),
          const SizedBox(height: 24),
          const _SectionTitle('Request details'),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: MfColors.surface,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final entry in d.requestFormResponse.entries)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          flex: 2,
                          child: Text(
                            entry.key.replaceAll('_', ' '),
                            style: const TextStyle(color: MfColors.muted, fontSize: 13),
                          ),
                        ),
                        Expanded(
                          flex: 3,
                          child: Text('${entry.value}',
                              style: const TextStyle(fontSize: 13)),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          if (accept != null) ...[
            ElevatedButton(
              onPressed: _acting ? null : () => _accept(accept),
              child: const Text('Accept task'),
            ),
            const SizedBox(height: 12),
          ],
          if (reject != null)
            OutlinedButton(
              onPressed: _acting ? null : () => _reject(reject),
              style: OutlinedButton.styleFrom(
                foregroundColor: MfColors.error,
                side: const BorderSide(color: MfColors.errorBorder),
                minimumSize: const Size.fromHeight(52),
              ),
              child: const Text('Reject task'),
            ),
          if (accept == null && reject == null && (_transitions?.isNotEmpty ?? false))
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text(
                'Status updates for this task arrive in the next build.',
                textAlign: TextAlign.center,
                style: TextStyle(color: MfColors.muted, fontSize: 13),
              ),
            ),
          if (_transitions != null && _transitions!.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text(
                'No actions available — this task is closed or on hold.',
                textAlign: TextAlign.center,
                style: TextStyle(color: MfColors.muted, fontSize: 13),
              ),
            ),
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
