// Dynamic form renderer tests (CLAUDE.md Section 13: schema → correct
// widgets; required blocking). The two fixtures are the real seeded
// request forms — both must render through the same widget with zero
// code differences (the Week 2 must-pass).
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:monitorflow_mobile/forms/dynamic_form.dart';
import 'package:monitorflow_mobile/forms/form_schema.dart';
import 'package:monitorflow_mobile/theme.dart';

// GET /services/1/forms/request — Equipment Repair (IT)
const equipmentRepairJson = '''
[
  {"id":"equipment_type","type":"dropdown","label":"Equipment type","options":[{"label":"Laptop","value":"laptop"},{"label":"Desktop PC","value":"desktop"},{"label":"Printer","value":"printer"},{"label":"Network equipment","value":"network"},{"label":"Other","value":"other"}],"required":true},
  {"id":"location","max":100,"type":"text","label":"Room / location","required":true},
  {"id":"problem_description","max":1000,"type":"multiline","label":"Problem description","required":true},
  {"id":"photo","type":"photo","label":"Photo of the problem","required":false},
  {"id":"urgent","type":"checkbox","label":"Urgent?","required":false}
]
''';

// GET /services/2/forms/request — Home Cleaning Visit (Facilities)
const homeCleaningJson = '''
[
  {"id":"preferred_date","type":"date","label":"Preferred date","required":true},
  {"id":"package","type":"radio","label":"Cleaning package","options":[{"label":"Standard cleaning","value":"standard"},{"label":"Deep cleaning","value":"deep"}],"required":true},
  {"id":"num_rooms","max":20,"min":1,"type":"number","label":"Number of rooms","required":true},
  {"id":"has_pets","type":"checkbox","label":"Pets at home?","required":false},
  {"id":"address","max":200,"type":"text","label":"Address","required":true,"visible_to_employee":true},
  {"id":"gate_code","max":20,"type":"text","label":"Gate code","required":false,"visible_to_employee":false}
]
''';

List<FormFieldDef> parse(String json) =>
    FormFieldDef.parseSchema(jsonDecode(json) as List<dynamic>);

Widget wrap(Key key, List<FormFieldDef> fields) => MaterialApp(
      theme: buildTheme(),
      home: Scaffold(
        body: SingleChildScrollView(child: DynamicForm(key: key, fields: fields)),
      ),
    );

void main() {
  group('schema → correct widgets', () {
    testWidgets('Equipment Repair renders all five fields in order', (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(equipmentRepairJson)));

      expect(find.byKey(const ValueKey('field-equipment_type')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-location')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-problem_description')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-photo')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-urgent')), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      expect(find.byType(CheckboxListTile), findsOneWidget);
      // No photoUploader passed → the photo field is an honest placeholder.
      expect(find.text('Photo upload is not available here yet'), findsOneWidget);
      // Required fields are marked; optional ones aren't.
      expect(find.text('Equipment type *'), findsOneWidget);
      expect(find.text('Urgent?'), findsOneWidget);
    });

    testWidgets('Home Cleaning renders date, radio, number and both texts', (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(homeCleaningJson)));

      expect(find.byKey(const ValueKey('field-preferred_date')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-package-standard')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-package-deep')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-num_rooms')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-has_pets')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-address')), findsOneWidget);
      expect(find.byKey(const ValueKey('field-gate_code')), findsOneWidget);
      expect(find.byType(RadioListTile<String>), findsNWidgets(2));
    });
  });

  group('required blocking', () {
    testWidgets('empty submit returns null and shows per-field errors', (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(homeCleaningJson)));

      expect(key.currentState!.submit(), isNull);
      await tester.pump();

      expect(find.text('Preferred date is required'), findsOneWidget);
      expect(find.text('Cleaning package is required'), findsOneWidget);
      expect(find.text('Number of rooms is required'), findsOneWidget);
      expect(find.text('Address is required'), findsOneWidget);
      // Optional fields don't error.
      expect(find.text('Gate code is required'), findsNothing);
    });

    testWidgets('editing a field clears its error', (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(homeCleaningJson)));

      key.currentState!.submit();
      await tester.pump();
      expect(find.text('Address is required'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('field-address')), '12 Main St');
      await tester.pump();
      expect(find.text('Address is required'), findsNothing);
    });
  });

  group('bounds and types', () {
    testWidgets('number out of range blocks with the server-matching message',
        (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(homeCleaningJson)));

      await tester.enterText(find.byKey(const ValueKey('field-num_rooms')), '25');
      expect(key.currentState!.submit(), isNull);
      await tester.pump();
      expect(find.text('Number of rooms must be at most 20'), findsOneWidget);
    });

    testWidgets('valid response map has server-expected JSON types', (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(homeCleaningJson)));

      // Pick today via the real date picker dialog.
      await tester.tap(find.byKey(const ValueKey('field-preferred_date')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('field-package-deep')));
      await tester.enterText(find.byKey(const ValueKey('field-num_rooms')), '3');
      await tester.enterText(find.byKey(const ValueKey('field-address')), '12 Main St');
      await tester.pump();

      final response = key.currentState!.submit();
      expect(response, isNotNull);
      expect(response!['preferred_date'], matches(r'^\d{4}-\d{2}-\d{2}$'));
      expect(response['package'], 'deep');
      expect(response['num_rooms'], isA<num>()); // JSON number, not string
      expect(response['has_pets'], false); // checkbox always sends its bool
      expect(response['address'], '12 Main St');
      expect(response.containsKey('gate_code'), isFalse); // empty optional omitted
    });

    test('FormFieldDef.validate mirrors server rules', () {
      final fields = parse(homeCleaningJson);
      final date = fields[0], radio = fields[1], rooms = fields[2];

      expect(date.validate('2026-07-10'), isNull);
      expect(date.validate('2026-02-30'), contains('valid date'));
      expect(date.validate('10/07/2026'), contains('valid date'));
      expect(radio.validate('deep'), isNull);
      expect(radio.validate('bogus'), contains('listed options'));
      expect(rooms.validate(1), isNull);
      expect(rooms.validate(0), contains('at least 1'));
      expect(rooms.validate('3'), contains('must be a number'));

      final text = parse(equipmentRepairJson)[1]; // location, max 100
      expect(text.validate('x' * 100), isNull);
      expect(text.validate('x' * 101), contains('at most 100'));
    });
  });

  group('unknown field types', () {
    const unknownJson = '''
    [
      {"id":"weird","type":"signature","label":"Sign here","required":true},
      {"id":"note","type":"text","label":"Note","required":false}
    ]
    ''';

    testWidgets('renders placeholder, never crashes, blocks when required',
        (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(unknownJson)));

      expect(
        find.text('This field type is not supported in this app version'),
        findsOneWidget,
      );
      expect(key.currentState!.submit(), isNull);
      await tester.pump();
      expect(find.text('Sign here is not supported in this app version'), findsOneWidget);
    });
  });

  group('server errors are authoritative', () {
    testWidgets('applyServerErrors shows 422 messages keyed by field id',
        (tester) async {
      final key = GlobalKey<DynamicFormState>();
      await tester.pumpWidget(wrap(key, parse(equipmentRepairJson)));

      key.currentState!
          .applyServerErrors({'location': 'Room / location must be at most 100 characters'});
      await tester.pump();
      expect(
        find.text('Room / location must be at most 100 characters'),
        findsOneWidget,
      );
    });
  });
}
