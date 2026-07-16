// Labelled read-only rendering of a form_response, shared by the user and
// employee detail screens. Values are displayed through the field schema:
// option values become their labels, booleans become Yes/No, photo ids
// become a friendly marker. Falls back to prettified ids when the schema
// isn't available (fetch failed) — never blocks the page on it.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../forms/form_schema.dart';
import '../i18n.dart';
import '../theme.dart';

class FormResponseView extends StatelessWidget {
  final Map<String, dynamic> response;
  final List<FormFieldDef>? fields;

  const FormResponseView({super.key, required this.response, this.fields});

  @override
  Widget build(BuildContext context) {
    final rows = _rows(context.watch<I18n>());
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
                  Expanded(flex: 3, child: row.$2),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static const _valueStyle = TextStyle(fontSize: 13);

  List<(String, Widget)> _rows(I18n i18n) {
    final rows = <(String, Widget)>[];
    final remaining = Map<String, dynamic>.of(response);

    // Schema order first, then anything the schema doesn't know about.
    for (final f in fields ?? const <FormFieldDef>[]) {
      if (!remaining.containsKey(f.id)) continue;
      final value = remaining.remove(f.id);
      // Location rows are tappable → the device's maps app (v5 amendment).
      if (f.type == FieldType.location && value is Map) {
        rows.add((i18n.l(f.label), _LocationValue(value: value)));
      } else {
        rows.add((i18n.l(f.label), Text(_display(i18n, f, value), style: _valueStyle)));
      }
    }
    for (final entry in remaining.entries) {
      rows.add((
        entry.key.replaceAll('_', ' '),
        Text('${entry.value}', style: _valueStyle),
      ));
    }
    return rows;
  }

  String _display(I18n i18n, FormFieldDef field, Object? value) {
    switch (field.type) {
      case FieldType.checkbox:
        return value == true ? i18n.tr('fr_yes') : i18n.tr('fr_no');
      case FieldType.dropdown:
      case FieldType.radio:
        for (final o in field.options) {
          if (o.value == value) return i18n.l(o.label);
        }
        return '$value';
      case FieldType.photo:
        return i18n.tr('fr_photo');
      default:
        return '$value';
    }
  }
}

/// Coords that open in the device's maps app (`geo:`), falling back to the
/// OpenStreetMap website when no maps app can handle it.
class _LocationValue extends StatelessWidget {
  final Map value;

  const _LocationValue({required this.value});

  Future<void> _open(BuildContext context) async {
    final lat = (value['lat'] as num).toDouble();
    final lng = (value['lng'] as num).toDouble();
    final geo = Uri.parse('geo:$lat,$lng?q=$lat,$lng');
    final ok = await launchUrl(geo).then((v) => v, onError: (_) => false);
    if (!ok) {
      await launchUrl(
        Uri.parse('https://www.openstreetmap.org/?mlat=$lat&mlon=$lng#map=16/$lat/$lng'),
        mode: LaunchMode.externalApplication,
      ).then((v) => v, onError: (_) => false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lat = value['lat'], lng = value['lng'];
    if (lat is! num || lng is! num) return Text('$value', style: const TextStyle(fontSize: 13));
    return InkWell(
      onTap: () => _open(context),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(
              '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
              style: const TextStyle(
                fontSize: 13,
                color: MfColors.amber600,
                decoration: TextDecoration.underline,
              ),
            ),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.map_outlined, size: 15, color: MfColors.amber600),
        ],
      ),
    );
  }
}
