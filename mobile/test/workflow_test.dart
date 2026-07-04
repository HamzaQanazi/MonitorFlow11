// WorkflowDef drives which user actions exist per status — categories and
// actions only, never hardcoded keys. Fixture = seeded Equipment Repair.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

import 'package:monitorflow_mobile/models/workflow.dart';

const equipmentRepairWorkflow = '''
{
 "statuses": [
  {"key":"submitted","label":"Submitted","category":"new","is_initial":true,"is_final":false},
  {"key":"completed","label":"Completed","category":"done","is_initial":false,"is_final":false},
  {"key":"confirmed","label":"Resolved","category":"closed","is_initial":false,"is_final":true},
  {"key":"cancelled","label":"Cancelled","category":"terminated","is_initial":false,"is_final":true},
  {"key":"in_progress","label":"In Progress","category":"in_progress","is_initial":false,"is_final":false}
 ],
 "transitions": [
  {"from":"submitted","to":"cancelled","allowed_role":"user","action":null,"requires_note":true,"requires_completion_form":false},
  {"from":"completed","to":"confirmed","allowed_role":"user","action":"confirm","requires_note":false,"requires_completion_form":false},
  {"from":"completed","to":"in_progress","allowed_role":"user","action":"dispute","requires_note":true,"requires_completion_form":false},
  {"from":"submitted","to":"approved","allowed_role":"monitor","action":null,"requires_note":false,"requires_completion_form":false}
 ]
}
''';

void main() {
  final wf = WorkflowDef.fromJson(jsonDecode(equipmentRepairWorkflow) as Map<String, dynamic>);

  test('cancel exists from the initial status (user transition to terminated)', () {
    final cancel = wf.cancelFrom('submitted');
    expect(cancel, isNotNull);
    expect(cancel!.requiresNote, isTrue);
  });

  test('monitor-only transitions never surface as user actions', () {
    // submitted → approved is monitor-role; only the cancel is a user move.
    expect(wf.confirmFrom('submitted'), isNull);
    expect(wf.disputeFrom('submitted'), isNull);
  });

  test('confirm and dispute surface only from the done-category status', () {
    expect(wf.confirmFrom('completed'), isNotNull);
    expect(wf.disputeFrom('completed')!.requiresNote, isTrue);
    expect(wf.cancelFrom('completed'), isNull);
    expect(wf.confirmFrom('in_progress'), isNull);
  });

  test('closed statuses expose no user actions at all', () {
    expect(wf.confirmFrom('confirmed'), isNull);
    expect(wf.disputeFrom('confirmed'), isNull);
    expect(wf.cancelFrom('confirmed'), isNull);
  });
}
