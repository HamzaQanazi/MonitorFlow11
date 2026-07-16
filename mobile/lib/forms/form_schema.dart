// Typed parsing of FORM_DEFINITION.field_schema (CLAUDE.md Section 8).
// Unknown field types parse to FieldType.unsupported — rendered as a
// disabled placeholder, never a crash.
import '../i18n.dart';

enum FieldType {
  text,
  multiline,
  number,
  date,
  dropdown,
  radio,
  checkbox,
  photo,
  location,
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
        'location' => location,
        _ => unsupported,
      };
}

class FieldOption {
  final String value;
  final Loc label;
  const FieldOption({required this.value, required this.label});

  factory FieldOption.fromJson(Map<String, dynamic> json) =>
      FieldOption(value: '${json['value']}', label: Loc.fromJson(json['label']));
}

class FormFieldDef {
  final String id;
  final Loc label;
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
        label: Loc.fromJson(json['label']),
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
    // Client-side messages stay English to mirror the server's authoritative
    // 422 (validateFormResponse resolves label.en) — bilingual form errors
    // are deferred with the rest of the runtime-composed text.
    final name = label.en;
    // Unsupported first: its value is always empty (nothing renders an
    // input), and "is required" would be a lie the user can't act on.
    if (type == FieldType.unsupported) {
      return required ? '$name is not supported in this app version' : null;
    }

    final missing = value == null || value == '';
    if (missing) return required ? '$name is required' : null;

    switch (type) {
      case FieldType.text:
      case FieldType.multiline:
        final s = value as String;
        if (min != null && s.length < min!) {
          return '$name must be at least $min characters';
        }
        if (max != null && s.length > max!) {
          return '$name must be at most $max characters';
        }
        return null;
      case FieldType.number:
        if (value is! num) return '$name must be a number';
        if (min != null && value < min!) return '$name must be at least $min';
        if (max != null && value > max!) return '$name must be at most $max';
        return null;
      case FieldType.date:
        if (value is! String || !_isValidDate(value)) {
          return '$name must be a valid date (YYYY-MM-DD)';
        }
        return null;
      case FieldType.dropdown:
      case FieldType.radio:
        if (!options.any((o) => o.value == value)) {
          return '$name must be one of the listed options';
        }
        return null;
      case FieldType.checkbox:
        return value is bool ? null : '$name must be true or false';
      case FieldType.photo:
        return value is String && value.isNotEmpty
            ? null
            : '$name must be an uploaded attachment id';
      case FieldType.location:
        if (value is Map) {
          final lat = value['lat'];
          final lng = value['lng'];
          if (value.length == 2 &&
              lat is num && lat.isFinite && lat >= -90 && lat <= 90 &&
              lng is num && lng.isFinite && lng >= -180 && lng <= 180) {
            return null;
          }
        }
        return '$name must be a map location';
      case FieldType.unsupported:
        return null; // handled above — unreachable
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
