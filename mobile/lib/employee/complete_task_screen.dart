// Complete Task (Section 4, Employee app) — the form named by the
// transition's required_form_key, rendered through the same dynamic form
// engine as Create Request and fired via the one generic
// POST /requests/{id}/transitions (Phase 4) with the form payload. Server
// 422s render per-field; a 409 means the task moved under us (monitor
// cancelled, concurrent fire) — surface and go back.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/dynamic_form.dart';
import '../forms/form_schema.dart';
import '../i18n.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/states.dart';

class CompleteTaskScreen extends StatefulWidget {
  final int taskId;
  final int requestId;
  final TransitionOption transition;
  final String expectedStatus;
  final int serviceTypeId;
  final Loc serviceTypeName;

  const CompleteTaskScreen({
    super.key,
    required this.taskId,
    required this.requestId,
    required this.transition,
    required this.expectedStatus,
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
    final formKey = widget.transition.requiredFormKey ?? 'completion';
    final json = await api.get('/services/${widget.serviceTypeId}/forms/$formKey');
    return FormFieldDef.parseSchema(json['fields'] as List<dynamic>);
  }

  Future<void> _submit() async {
    final i18n = context.read<I18n>();
    setState(() => _bannerError = null);
    final response = _formKey.currentState!.submit();
    if (response == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(i18n.tr('ct_complete_q')),
        content: Text(i18n.tr('ct_complete_body')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(i18n.tr('back')),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(i18n.tr('td_complete_btn')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _submitting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.post('/requests/${widget.requestId}/transitions', body: {
        'transition_key': widget.transition.key,
        'expected_status': widget.expectedStatus,
        'form': response,
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(i18n.tr('ct_done'))),
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
      setState(() => _bannerError = i18n.tr('net_check_retry'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(
          title: Text('${i18n.tr('ct_complete_pre')} — ${i18n.l(widget.serviceTypeName)}')),
      body: FutureBuilder<List<FormFieldDef>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingState();
          }
          if (snap.hasError) {
            return ErrorState(
              message: snap.error is NetworkException
                  ? i18n.tr('net_check')
                  : i18n.tr('ct_form_fail'),
              onRetry: () => setState(() => _future = _load()),
            );
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  i18n.tr('ct_hint'),
                  style: const TextStyle(color: MfColors.muted, fontSize: 13),
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
                      : Text(i18n.tr('td_complete_btn')),
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
