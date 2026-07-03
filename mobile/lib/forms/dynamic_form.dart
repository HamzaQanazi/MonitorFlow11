// The dynamic form renderer — one widget draws any FORM_DEFINITION schema
// with zero per-service code (the project's core thesis, CLAUDE.md §1).
// The parent owns submission: call `submit()` for a validated response map
// (null if invalid), and `applyServerErrors()` with a 422's per-field
// errors — the server is authoritative, these override client validation.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';
import 'form_schema.dart';

class DynamicForm extends StatefulWidget {
  final List<FormFieldDef> fields;

  const DynamicForm({super.key, required this.fields});

  @override
  State<DynamicForm> createState() => DynamicFormState();
}

class DynamicFormState extends State<DynamicForm> {
  final Map<String, Object?> _values = {};
  final Map<String, String> _errors = {};
  final Map<String, TextEditingController> _textControllers = {};

  @override
  void initState() {
    super.initState();
    for (final f in widget.fields) {
      if (f.type == FieldType.checkbox) _values[f.id] = false;
      if (f.type == FieldType.text ||
          f.type == FieldType.multiline ||
          f.type == FieldType.number) {
        _textControllers[f.id] = TextEditingController();
      }
    }
  }

  @override
  void dispose() {
    for (final c in _textControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// Validate everything; return the form_response map if clean, else null
  /// (with errors shown). Empty optional values are omitted from the map —
  /// checkboxes always send their boolean.
  Map<String, dynamic>? submit() {
    final errors = <String, String>{};
    for (final f in widget.fields) {
      final err = f.validate(_values[f.id]);
      if (err != null) errors[f.id] = err;
    }
    setState(() {
      _errors
        ..clear()
        ..addAll(errors);
    });
    if (errors.isNotEmpty) return null;

    final response = <String, dynamic>{};
    for (final f in widget.fields) {
      final v = _values[f.id];
      if (v == null || v == '') continue;
      response[f.id] = v;
    }
    return response;
  }

  /// Show the server's per-field 422 errors (keyed by field id).
  void applyServerErrors(Map<String, String> errors) {
    setState(() {
      _errors
        ..clear()
        ..addAll(errors);
    });
  }

  void _setValue(String id, Object? value) {
    setState(() {
      _values[id] = value;
      _errors.remove(id); // editing a field clears its stale error
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final field in widget.fields) ...[
          _buildField(field),
          const SizedBox(height: 18),
        ],
      ],
    );
  }

  Widget _buildField(FormFieldDef field) {
    final error = _errors[field.id];
    return switch (field.type) {
      FieldType.text => _textField(field, error),
      FieldType.multiline => _textField(field, error, maxLines: 5),
      FieldType.number => _numberField(field, error),
      FieldType.date => _dateField(field, error),
      FieldType.dropdown => _dropdownField(field, error),
      FieldType.radio => _radioField(field, error),
      FieldType.checkbox => _checkboxField(field, error),
      FieldType.photo => _photoField(field, error),
      FieldType.unsupported => _unsupportedField(field, error),
    };
  }

  InputDecoration _decoration(FormFieldDef field, String? error, {String? counter}) =>
      InputDecoration(
        labelText: field.required ? '${field.label} *' : field.label,
        errorText: error,
        counterText: counter,
      );

  Widget _textField(FormFieldDef field, String? error, {int maxLines = 1}) {
    return TextField(
      key: ValueKey('field-${field.id}'),
      controller: _textControllers[field.id],
      maxLines: maxLines,
      maxLength: field.max?.toInt(),
      decoration: _decoration(field, error, counter: field.max == null ? null : ''),
      onChanged: (v) => _setValue(field.id, v),
    );
  }

  Widget _numberField(FormFieldDef field, String? error) {
    return TextField(
      key: ValueKey('field-${field.id}'),
      controller: _textControllers[field.id],
      keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
      inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d.\-]'))],
      decoration: _decoration(field, error),
      onChanged: (v) {
        // Store a real num so the JSON payload matches the server's type
        // check; unparseable text is kept as-is to fail validation loudly.
        _setValue(field.id, v.isEmpty ? null : num.tryParse(v) ?? v);
      },
    );
  }

  Widget _dateField(FormFieldDef field, String? error) {
    final value = _values[field.id] as String?;
    return TextField(
      key: ValueKey('field-${field.id}'),
      readOnly: true,
      controller: TextEditingController(text: value ?? ''),
      decoration: _decoration(field, error).copyWith(
        hintText: 'YYYY-MM-DD',
        suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20, color: MfColors.muted),
      ),
      onTap: () async {
        final now = DateTime.now();
        final picked = await showDatePicker(
          context: context,
          initialDate: now,
          firstDate: now.subtract(const Duration(days: 365)),
          lastDate: now.add(const Duration(days: 365)),
        );
        if (picked != null) {
          final formatted = '${picked.year.toString().padLeft(4, '0')}-'
              '${picked.month.toString().padLeft(2, '0')}-'
              '${picked.day.toString().padLeft(2, '0')}';
          _setValue(field.id, formatted);
        }
      },
    );
  }

  Widget _dropdownField(FormFieldDef field, String? error) {
    return DropdownButtonFormField<String>(
      key: ValueKey('field-${field.id}'),
      initialValue: _values[field.id] as String?,
      decoration: _decoration(field, error),
      items: [
        for (final opt in field.options)
          DropdownMenuItem(value: opt.value, child: Text(opt.label)),
      ],
      onChanged: (v) => _setValue(field.id, v),
    );
  }

  Widget _radioField(FormFieldDef field, String? error) {
    final value = _values[field.id] as String?;
    return _GroupShell(
      field: field,
      error: error,
      child: RadioGroup<String>(
        groupValue: value,
        onChanged: (v) => _setValue(field.id, v),
        child: Column(
          children: [
            for (final opt in field.options)
              RadioListTile<String>(
                key: ValueKey('field-${field.id}-${opt.value}'),
                title: Text(opt.label),
                value: opt.value,
                contentPadding: EdgeInsets.zero,
                dense: true,
                activeColor: MfColors.amber600,
              ),
          ],
        ),
      ),
    );
  }

  Widget _checkboxField(FormFieldDef field, String? error) {
    return _GroupShell(
      field: field,
      error: error,
      showLabel: false,
      child: CheckboxListTile(
        key: ValueKey('field-${field.id}'),
        title: Text(field.required ? '${field.label} *' : field.label),
        value: (_values[field.id] as bool?) ?? false,
        onChanged: (v) => _setValue(field.id, v ?? false),
        controlAffinity: ListTileControlAffinity.leading,
        contentPadding: EdgeInsets.zero,
        dense: true,
        activeColor: MfColors.amber600,
      ),
    );
  }

  // Photo upload lands with the Week 5 files backend; the field is shown
  // disabled so the schema is fully represented. Both seeded photo fields
  // are optional, so this never blocks submission today.
  Widget _photoField(FormFieldDef field, String? error) {
    return _GroupShell(
      field: field,
      error: error,
      child: Container(
        key: ValueKey('field-${field.id}'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: MfColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: MfColors.border),
        ),
        child: const Row(
          children: [
            Icon(Icons.photo_camera_outlined, color: MfColors.muted),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'Photo upload is coming in a later build',
                style: TextStyle(color: MfColors.muted),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _unsupportedField(FormFieldDef field, String? error) {
    return _GroupShell(
      field: field,
      error: error,
      child: Container(
        key: ValueKey('field-${field.id}'),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: MfColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: MfColors.border),
        ),
        child: const Row(
          children: [
            Icon(Icons.block_outlined, color: MfColors.muted),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'This field type is not supported in this app version',
                style: TextStyle(color: MfColors.muted),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Label + error wrapper for fields that aren't TextFields (radio groups,
/// checkboxes, placeholders) so every field presents errors identically.
class _GroupShell extends StatelessWidget {
  final FormFieldDef field;
  final String? error;
  final Widget child;
  final bool showLabel;

  const _GroupShell({
    required this.field,
    required this.error,
    required this.child,
    this.showLabel = true,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showLabel) ...[
          Text(
            field.required ? '${field.label} *' : field.label,
            style: const TextStyle(
                fontSize: 14, fontWeight: FontWeight.w600, color: MfColors.ink),
          ),
          const SizedBox(height: 6),
        ],
        child,
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text(error!, style: const TextStyle(color: MfColors.error, fontSize: 12)),
          ),
      ],
    );
  }
}
