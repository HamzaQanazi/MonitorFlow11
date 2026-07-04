// Task payloads from /tasks endpoints (employee-only surface). The
// embedded request data is the server-limited view: requester name and
// phone only — never email — with `visible_to_employee: false` fields
// already stripped server-side.
import 'request.dart';

class TaskSummary {
  final int id;
  final int requestId;
  final int serviceTypeId;
  final String serviceTypeName;
  final StatusInfo status;
  final String priority;
  final DateTime assignedAt;

  const TaskSummary({
    required this.id,
    required this.requestId,
    required this.serviceTypeId,
    required this.serviceTypeName,
    required this.status,
    required this.priority,
    required this.assignedAt,
  });

  factory TaskSummary.fromJson(Map<String, dynamic> json) => TaskSummary(
        id: json['id'] as int,
        requestId: json['requestId'] as int,
        serviceTypeId: json['serviceTypeId'] as int,
        serviceTypeName: json['serviceTypeName'] as String,
        status: StatusInfo.fromJson(json['status'] as Map<String, dynamic>),
        priority: json['priority'] as String,
        assignedAt: DateTime.parse(json['assignedAt'] as String),
      );
}

class TaskDetail {
  final TaskSummary summary;
  final Map<String, dynamic> requestFormResponse;
  final DateTime requestCreatedAt;
  final String requesterName;
  final String? requesterPhone;
  final Map<String, dynamic>? completionFormResponse;

  const TaskDetail({
    required this.summary,
    required this.requestFormResponse,
    required this.requestCreatedAt,
    required this.requesterName,
    this.requesterPhone,
    this.completionFormResponse,
  });

  factory TaskDetail.fromJson(Map<String, dynamic> json) {
    final request = json['request'] as Map<String, dynamic>;
    final requester = request['requester'] as Map<String, dynamic>;
    return TaskDetail(
      summary: TaskSummary.fromJson({...json, 'assignedAt': json['assignedAt']}),
      requestFormResponse:
          (request['formResponse'] as Map<String, dynamic>?) ?? const {},
      requestCreatedAt: DateTime.parse(request['createdAt'] as String),
      requesterName: requester['name'] as String,
      requesterPhone: requester['phone'] as String?,
      completionFormResponse: json['completionFormResponse'] as Map<String, dynamic>?,
    );
  }
}

/// One row of GET /tasks/{id}/valid-transitions — the data that drives
/// which action buttons exist (no status keys in code, Section 9).
class TaskTransition {
  final String to;
  final String toLabel;
  final String toCategory;
  final String? action; // accept | reject | complete | null (generic)
  final bool requiresNote;
  final bool requiresCompletionForm;

  const TaskTransition({
    required this.to,
    required this.toLabel,
    required this.toCategory,
    this.action,
    required this.requiresNote,
    required this.requiresCompletionForm,
  });

  factory TaskTransition.fromJson(Map<String, dynamic> json) => TaskTransition(
        to: json['to'] as String,
        toLabel: json['toLabel'] as String,
        toCategory: json['toCategory'] as String,
        action: json['action'] as String?,
        requiresNote: json['requiresNote'] == true,
        requiresCompletionForm: json['requiresCompletionForm'] == true,
      );
}
