// Create Request (Section 4, User app) — fetches the service's request
// FORM_DEFINITION and renders it through the dynamic form engine. The
// server's per-field 422 is authoritative and rendered field-by-field.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../forms/dynamic_form.dart';
import '../forms/form_schema.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/states.dart';

class CreateRequestScreen extends StatefulWidget {
  final ServiceType service;

  const CreateRequestScreen({super.key, required this.service});

  @override
  State<CreateRequestScreen> createState() => _CreateRequestScreenState();
}

class _CreateRequestScreenState extends State<CreateRequestScreen> {
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
    final json = await api.get('/services/${widget.service.id}/forms/request');
    return FormFieldDef.parseSchema(json['fields'] as List<dynamic>);
  }

  Future<void> _submit() async {
    setState(() => _bannerError = null);
    final response = _formKey.currentState!.submit();
    if (response == null) return; // client validation failed, errors shown

    setState(() => _submitting = true);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.post('/requests', body: {
        'serviceTypeId': widget.service.id,
        'formResponse': response,
      });
      if (!mounted) return;
      final id = (json['request'] as Map<String, dynamic>)['id'];
      Navigator.of(context).pop(true); // signal My Requests / Home to refresh
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Request #$id submitted')),
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
      appBar: AppBar(title: Text(widget.service.name)),
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
                  : 'Could not load this form.',
              onRetry: () => setState(() => _future = _load()),
            );
          }
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Tell us what you need — fields marked * are required.',
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
                DynamicForm(key: _formKey, fields: snap.data!),
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
                      : const Text('Submit request'),
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
