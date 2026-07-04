// GET /services/{id}/workflow — the raw WORKFLOW_DEFINITION JSON
// (snake_case keys, exactly as seeded). Drives the user-side action
// buttons the same way valid-transitions drives the employee side:
// code only reads categories and actions, never status keys (Section 9).
class WorkflowTransition {
  final String from;
  final String to;
  final String allowedRole;
  final String? action; // accept | reject | complete | confirm | dispute
  final bool requiresNote;

  const WorkflowTransition({
    required this.from,
    required this.to,
    required this.allowedRole,
    this.action,
    required this.requiresNote,
  });

  factory WorkflowTransition.fromJson(Map<String, dynamic> json) =>
      WorkflowTransition(
        from: json['from'] as String,
        to: json['to'] as String,
        allowedRole: json['allowed_role'] as String,
        action: json['action'] as String?,
        requiresNote: json['requires_note'] == true,
      );
}

class WorkflowDef {
  final Map<String, String> categoryByStatusKey;
  final List<WorkflowTransition> transitions;

  const WorkflowDef({required this.categoryByStatusKey, required this.transitions});

  factory WorkflowDef.fromJson(Map<String, dynamic> json) => WorkflowDef(
        categoryByStatusKey: {
          for (final s in json['statuses'] as List<dynamic>)
            (s as Map<String, dynamic>)['key'] as String: s['category'] as String,
        },
        transitions: (json['transitions'] as List<dynamic>)
            .map((t) => WorkflowTransition.fromJson(t as Map<String, dynamic>))
            .toList(),
      );

  List<WorkflowTransition> _userTransitionsFrom(String statusKey) => transitions
      .where((t) => t.from == statusKey && t.allowedRole == 'user')
      .toList();

  /// The confirm-resolution transition available from this status, if any.
  WorkflowTransition? confirmFrom(String statusKey) =>
      _firstWhere(_userTransitionsFrom(statusKey), (t) => t.action == 'confirm');

  /// The dispute transition available from this status, if any.
  WorkflowTransition? disputeFrom(String statusKey) =>
      _firstWhere(_userTransitionsFrom(statusKey), (t) => t.action == 'dispute');

  /// The user's own cancel: a user-role transition into a terminated-
  /// category status. The caller must additionally gate on "no task
  /// exists" (Section 6: cancel only while unassigned).
  WorkflowTransition? cancelFrom(String statusKey) => _firstWhere(
        _userTransitionsFrom(statusKey),
        (t) => categoryByStatusKey[t.to] == 'terminated',
      );

  static WorkflowTransition? _firstWhere(
    List<WorkflowTransition> list,
    bool Function(WorkflowTransition) test,
  ) {
    for (final t in list) {
      if (test(t)) return t;
    }
    return null;
  }
}
