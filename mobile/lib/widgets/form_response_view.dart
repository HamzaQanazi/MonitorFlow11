// Labelled read-only rendering of a form_response, shared by the user and
// employee detail screens. Values are displayed through the field schema:
// option values become their labels, booleans become Yes/No, photo ids
// become a friendly marker. Falls back to prettified ids when the schema
// isn't available (fetch failed) — never blocks the page on it.
import 'package:flutter/material.dart';

import '../forms/form_schema.dart';
import '../theme.dart';

class FormResponseView extends StatelessWidget {
  final Map<String, dynamic> response;
  final List<FormFieldDef>? fields;

  const FormResponseView({super.key, required this.response, this.fields});

  @override
  Widget build(BuildContext context) {
    final rows = _rows();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: MfColors.surface,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 2,
                    child: Text(row.$1,
                        style: const TextStyle(color: MfColors.muted, fontSize: 13)),
                  ),
                  Expanded(
                    flex: 3,
                    child: Text(row.$2, style: const TextStyle(fontSize: 13)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  List<(String, String)> _rows() {
    final rows = <(String, String)>[];
    final remaining = Map<String, dynamic>.of(response);

    // Schema order first, then anything the schema doesn't know about.
    for (final f in fields ?? const <FormFieldDef>[]) {
      if (!remaining.containsKey(f.id)) continue;
      rows.add((f.label, _display(f, remaining.remove(f.id))));
    }
    for (final entry in remaining.entries) {
      rows.add((entry.key.replaceAll('_', ' '), '${entry.value}'));
    }
    return rows;
  }

  String _display(FormFieldDef field, Object? value) {
    switch (field.type) {
      case FieldType.checkbox:
        return value == true ? 'Yes' : 'No';
      case FieldType.dropdown:
      case FieldType.radio:
        for (final o in field.options) {
          if (o.value == value) return o.label;
        }
        return '$value';
      case FieldType.photo:
        return 'Photo attached';
      default:
        return '$value';
    }
  }
}
