import '../i18n.dart';

/// Request payloads from /requests endpoints. Status is the
/// {key, label, isTerminal} triple (Phase 4: category is gone) — code
/// reasons via isTerminal only; the key is only echoed back as
/// expected_status. `label` is bilingual ({en,ar}); render through i18n.l().
class StatusInfo {
  final String key;
  final Loc label;
  final bool isTerminal;

  const StatusInfo({required this.key, required this.label, required this.isTerminal});

  factory StatusInfo.fromJson(Map<String, dynamic> json) => StatusInfo(
        key: json['key'] as String,
        label: Loc.fromJson(json['label']),
        isTerminal: json['isTerminal'] == true,
      );
}

/// One row of GET /requests/{id}/transitions — the caller's legal next
/// actions, both gates already applied server-side. Clients render exactly
/// these buttons (Phase 4: the accept/reject/complete/resolution endpoints
/// are gone; everything fires POST /requests/{id}/transitions).
class TransitionOption {
  final String key;
  final Loc label; // bilingual button label, rendered verbatim
  final String to;
  final Loc toLabel;
  final bool toTerminal; // destructive styling hint (cancel-like moves)
  final bool requiresNote;
  final String? requiredFormKey; // non-null ⇒ collect this form first

  const TransitionOption({
    required this.key,
    required this.label,
    required this.to,
    required this.toLabel,
    required this.toTerminal,
    required this.requiresNote,
    this.requiredFormKey,
  });

  factory TransitionOption.fromJson(Map<String, dynamic> json) => TransitionOption(
        key: json['key'] as String,
        label: Loc.fromJson(json['label']),
        to: json['to'] as String,
        toLabel: Loc.fromJson(json['toLabel']),
        toTerminal: json['toTerminal'] == true,
        requiresNote: json['requiresNote'] == true,
        requiredFormKey: json['requiredFormKey'] as String?,
      );
}

class RequestSummary {
  final int id;
  final int serviceTypeId;
  final Loc serviceTypeName;
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
        serviceTypeName: Loc.fromJson(json['serviceTypeName']),
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
  final Loc name;
  final Loc departmentName;

  const ServiceType({required this.id, required this.name, required this.departmentName});

  factory ServiceType.fromJson(Map<String, dynamic> json) => ServiceType(
        id: json['id'] as int,
        name: Loc.fromJson(json['name']),
        departmentName: Loc.fromJson(json['departmentName']),
      );
}
