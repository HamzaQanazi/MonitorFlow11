// Typed parsing of FORM_DEFINITION.field_schema (CLAUDE.md Section 8).
// Unknown field types parse to FieldType.unsupported — rendered as a
// disabled placeholder, never a crash.

enum FieldType {
  text,
  multiline,
  number,
  date,
  dropdown,
  radio,
  checkbox,
  photo,
  unsupported;

  static FieldType parse(String? raw) => switch (raw) {
        'text' => text,
        'multiline' => multiline,
        'number' => number,
        'date' => date,
        'dropdown' => dropdown,
        'radio' => radio,
        'checkbox' => checkbox,
        'photo' => photo,
        _ => unsupported,
      };
}

class FieldOption {
  final String value;
  final String label;
  const FieldOption({required this.value, required this.label});

  factory FieldOption.fromJson(Map<String, dynamic> json) =>
      FieldOption(value: '${json['value']}', label: '${json['label']}');
}

class FormFieldDef {
  final String id;
  final String label;
  final FieldType type;
  final bool required;
  final List<FieldOption> options;
  final num? min; // number: value bounds; text/multiline: length bounds
  final num? max;

  const FormFieldDef({
    required this.id,
    required this.label,
    required this.type,
    this.required = false,
    this.options = const [],
    this.min,
    this.max,
  });

  factory FormFieldDef.fromJson(Map<String, dynamic> json) => FormFieldDef(
        id: json['id'] as String,
        label: json['label'] as String,
        type: FieldType.parse(json['type'] as String?),
        required: json['required'] == true,
        options: (json['options'] as List<dynamic>? ?? const [])
            .map((o) => FieldOption.fromJson(o as Map<String, dynamic>))
            .toList(),
        min: json['min'] as num?,
        max: json['max'] as num?,
      );

  /// Parse a full field_schema array (array order = display order).
  static List<FormFieldDef> parseSchema(List<dynamic> fields) =>
      fields.map((f) => FormFieldDef.fromJson(f as Map<String, dynamic>)).toList();

  /// Client-side validation mirroring the server's validateFormResponse —
  /// same checks, same label-generated messages. The server's 422 stays
  /// authoritative; this is UX only.
  String? validate(Object? value) {
    final missing = value == null || value == '';
    if (missing) return required ? '$label is required' : null;

    switch (type) {
      case FieldType.text:
      case FieldType.multiline:
        final s = value as String;
        if (min != null && s.length < min!) {
          return '$label must be at least $min characters';
        }
        if (max != null && s.length > max!) {
          return '$label must be at most $max characters';
        }
        return null;
      case FieldType.number:
        if (value is! num) return '$label must be a number';
        if (min != null && value < min!) return '$label must be at least $min';
        if (max != null && value > max!) return '$label must be at most $max';
        return null;
      case FieldType.date:
        if (value is! String || !_isValidDate(value)) {
          return '$label must be a valid date (YYYY-MM-DD)';
        }
        return null;
      case FieldType.dropdown:
      case FieldType.radio:
        if (!options.any((o) => o.value == value)) {
          return '$label must be one of the listed options';
        }
        return null;
      case FieldType.checkbox:
        return value is bool ? null : '$label must be true or false';
      case FieldType.photo:
        return value is String && value.isNotEmpty
            ? null
            : '$label must be an uploaded attachment id';
      case FieldType.unsupported:
        // Required unsupported fields block submission (Section 8 rule);
        // by definition the user can't fill them in this app version.
        return required ? '$label is not supported in this app version' : null;
    }
  }

  static final _dateRe = RegExp(r'^\d{4}-\d{2}-\d{2}$');

  static bool _isValidDate(String value) {
    if (!_dateRe.hasMatch(value)) return false;
    final parts = value.split('-').map(int.parse).toList();
    final date = DateTime.utc(parts[0], parts[1], parts[2]);
    return date.year == parts[0] && date.month == parts[1] && date.day == parts[2];
  }
}
