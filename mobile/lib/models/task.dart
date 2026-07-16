// Task payloads from /tasks endpoints (employee-only surface). The
// embedded request data is the server-limited view: requester name and
// phone only — never email — with `visible_to_employee: false` fields
// already stripped server-side.
import '../i18n.dart';
import 'request.dart';

class TaskSummary {
  final int id;
  final int requestId;
  final int serviceTypeId;
  final Loc serviceTypeName;
  final StatusInfo status;

  /// The accept/reject decision window (server-derived from the workflow:
  /// an assignee reject is still available from the current status).
  final bool needsResponse;
  final String priority;
  final DateTime assignedAt;

  /// v5 map amendment: the request's location, null when the form has none,
  /// the field was left empty, or the server hid it (visible_to_employee).
  final ({double lat, double lng})? location;

  const TaskSummary({
    required this.id,
    required this.requestId,
    required this.serviceTypeId,
    required this.serviceTypeName,
    required this.status,
    this.needsResponse = false,
    required this.priority,
    required this.assignedAt,
    this.location,
  });

  factory TaskSummary.fromJson(Map<String, dynamic> json) {
    final loc = json['location'] as Map<String, dynamic>?;
    return TaskSummary(
      id: json['id'] as int,
      requestId: json['requestId'] as int,
      serviceTypeId: json['serviceTypeId'] as int,
      serviceTypeName: Loc.fromJson(json['serviceTypeName']),
      status: StatusInfo.fromJson(json['status'] as Map<String, dynamic>),
      needsResponse: json['needsResponse'] == true,
      priority: json['priority'] as String,
      assignedAt: DateTime.parse(json['assignedAt'] as String),
      location: loc == null
          ? null
          : (lat: (loc['lat'] as num).toDouble(), lng: (loc['lng'] as num).toDouble()),
    );
  }
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

// Phase 4: TaskTransition is gone — action buttons come from
// GET /requests/{id}/transitions (TransitionOption in models/request.dart).
