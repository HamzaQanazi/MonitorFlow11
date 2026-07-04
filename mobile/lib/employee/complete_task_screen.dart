// Complete Task (Section 4, Employee app) — the completion FORM_DEFINITION
// rendered through the same dynamic form engine as Create Request, posted
// to POST /tasks/{id}/complete. Server 422s render per-field; a 409 means
// the task moved under us (monitor cancelled, etc.) — surface and go back.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/dynamic_form.dart';
import '../forms/form_schema.dart';
import '../theme.dart';
import '../widgets/states.dart';

class CompleteTaskScreen extends StatefulWidget {
  final int taskId;
  final int serviceTypeId;
  final String serviceTypeName;

  const CompleteTaskScreen({
    super.key,
    required this.taskId,
    required this.serviceTypeId,
    required this.serviceTypeName,
  });

  @override
  State<CompleteTaskScreen> createState() => _CompleteTaskScreenState();
}

class _CompleteTaskScreenState extends State<CompleteTaskScreen> {
  final _formKey = GlobalKey<DynamicFormState>();
  late Future<List<FormFieldDef>> _future;
  bool _submitting = false;
  String? _bannerError;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<FormFieldDef>> _load() async {
    final api = context.read<AuthState>().api;
    final json = await api.get('/services/${widget.serviceTypeId}/forms/completion');
    return FormFieldDef.parseSchema(json['fields'] as List<dynamic>);
  }

  Future<void> _submit() async {
    setState(() => _bannerError = null);
    final response = _formKey.currentState!.submit();
    if (response == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Complete this task?'),
        content: const Text(
            'The requester will be notified and asked to confirm the resolution.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Back'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Complete task'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _submitting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.post('/tasks/${widget.taskId}/complete',
          body: {'completionFormResponse': response});
      if (!mounted) return;
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Task completed')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.fieldErrors.isNotEmpty) {
          _formKey.currentState!.applyServerErrors(e.fieldErrors);
        } else {
          _bannerError = e.message;
        }
      });
    } on NetworkException {
      if (!mounted) return;
      setState(() =>
          _bannerError = 'Could not reach the server — check your connection and try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Complete — ${widget.serviceTypeName}')),
      body: FutureBuilder<List<FormFieldDef>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingState();
          }
          if (snap.hasError) {
            return ErrorState(
              message: snap.error is NetworkException
                  ? 'Could not reach the server — check your connection.'
                  : 'Could not load the completion form.',
              onRetry: () => setState(() => _future = _load()),
            );
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Fill in the completion report — fields marked * are required.',
                  style: TextStyle(color: MfColors.muted, fontSize: 13),
                ),
                const SizedBox(height: 20),
                if (_bannerError != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: MfColors.errorBg,
                      border: Border.all(color: MfColors.errorBorder),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(_bannerError!,
                        style: const TextStyle(color: MfColors.error)),
                  ),
                  const SizedBox(height: 16),
                ],
                DynamicForm(
                  key: _formKey,
                  fields: snap.data!,
                  photoUploader: (filename, bytes) async {
                    final api = context.read<AuthState>().api;
                    final json = await api.postMultipart(
                      '/files',
                      bytes: bytes,
                      filename: filename,
                      fields: {'taskId': '${widget.taskId}'},
                    );
                    return (json['attachment'] as Map<String, dynamic>)['id']
                        as String;
                  },
                ),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2.5, color: MfColors.muted),
                        )
                      : const Text('Complete task'),
                ),
                const SizedBox(height: 24),
              ],
            ),
          );
        },
      ),
    );
  }
}
