/// Request payloads from /requests endpoints. Status is always the
/// {key, label, category} triple — code reasons via category only
/// (CLAUDE.md Section 9); the key is never referenced.
class StatusInfo {
  final String key;
  final String label;
  final String category;

  const StatusInfo({required this.key, required this.label, required this.category});

  factory StatusInfo.fromJson(Map<String, dynamic> json) => StatusInfo(
        key: json['key'] as String,
        label: json['label'] as String,
        category: (json['category'] as String?) ?? 'closed',
      );
}

class RequestSummary {
  final int id;
  final int serviceTypeId;
  final String serviceTypeName;
  final StatusInfo status;
  final String priority;
  final DateTime createdAt;
  final DateTime updatedAt;

  const RequestSummary({
    required this.id,
    required this.serviceTypeId,
    required this.serviceTypeName,
    required this.status,
    required this.priority,
    required this.createdAt,
    required this.updatedAt,
  });

  factory RequestSummary.fromJson(Map<String, dynamic> json) => RequestSummary(
        id: json['id'] as int,
        serviceTypeId: json['serviceTypeId'] as int,
        serviceTypeName: json['serviceTypeName'] as String,
        status: StatusInfo.fromJson(json['status'] as Map<String, dynamic>),
        priority: json['priority'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
}

class HistoryEntry {
  final StatusInfo status;
  final String changedByName;
  final DateTime changedAt;
  final String? note;

  const HistoryEntry({
    required this.status,
    required this.changedByName,
    required this.changedAt,
    this.note,
  });

  factory HistoryEntry.fromJson(Map<String, dynamic> json) => HistoryEntry(
        status: StatusInfo.fromJson(json['status'] as Map<String, dynamic>),
        changedByName: (json['changedBy'] as Map<String, dynamic>)['name'] as String,
        changedAt: DateTime.parse(json['changedAt'] as String),
        note: json['note'] as String?,
      );
}

class RequestComment {
  final String authorName;
  final String body;
  final DateTime createdAt;

  const RequestComment({
    required this.authorName,
    required this.body,
    required this.createdAt,
  });

  factory RequestComment.fromJson(Map<String, dynamic> json) => RequestComment(
        authorName: (json['user'] as Map<String, dynamic>?)?['name'] as String? ?? 'Unknown',
        body: json['body'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class RequestDetail {
  final RequestSummary summary;
  final Map<String, dynamic> formResponse;
  final List<HistoryEntry> statusHistory;
  final List<RequestComment> comments;

  /// Whether a task was ever created — gates the user's own cancel
  /// (Section 6: only while unassigned).
  final bool taskExists;

  const RequestDetail({
    required this.summary,
    required this.formResponse,
    required this.statusHistory,
    required this.comments,
    required this.taskExists,
  });

  factory RequestDetail.fromJson(Map<String, dynamic> json) => RequestDetail(
        summary: RequestSummary.fromJson(json),
        formResponse: (json['formResponse'] as Map<String, dynamic>?) ?? const {},
        taskExists: json['task'] != null,
        statusHistory: (json['statusHistory'] as List<dynamic>? ?? const [])
            .map((h) => HistoryEntry.fromJson(h as Map<String, dynamic>))
            .toList(),
        comments: (json['comments'] as List<dynamic>? ?? const [])
            .map((c) => RequestComment.fromJson(c as Map<String, dynamic>))
            .toList(),
      );
}

class ServiceType {
  final int id;
  final String name;
  final String departmentName;

  const ServiceType({required this.id, required this.name, required this.departmentName});

  factory ServiceType.fromJson(Map<String, dynamic> json) => ServiceType(
        id: json['id'] as int,
        name: json['name'] as String,
        departmentName: json['departmentName'] as String,
      );
}
