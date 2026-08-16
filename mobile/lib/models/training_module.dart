// TrainingModule payloads from GET /training (hr_skills feature group).
// Read + self-service completion only here — authoring stays console-only.
import '../i18n.dart';

/// A module's optional attached file ("cheap version" of a more versatile
/// module, §11) — a PDF or image, same /files allowlist as everywhere else.
class TrainingAttachment {
  final String id;
  final String originalFilename;
  final String mimeType;
  final int sizeBytes;

  const TrainingAttachment({
    required this.id,
    required this.originalFilename,
    required this.mimeType,
    required this.sizeBytes,
  });

  bool get isImage => mimeType.startsWith('image/');

  factory TrainingAttachment.fromJson(Map<String, dynamic> json) => TrainingAttachment(
        id: json['id'] as String,
        originalFilename: json['originalFilename'] as String,
        mimeType: json['mimeType'] as String,
        sizeBytes: json['sizeBytes'] as int? ?? 0,
      );
}

class TrainingModule {
  final int id;
  final Loc title;
  final Loc body;
  final String createdByName;
  final DateTime updatedAt;
  final int completionCount;
  final bool isComplete;
  final TrainingAttachment? attachment;

  const TrainingModule({
    required this.id,
    required this.title,
    required this.body,
    required this.createdByName,
    required this.updatedAt,
    required this.completionCount,
    required this.isComplete,
    this.attachment,
  });

  factory TrainingModule.fromJson(Map<String, dynamic> json) => TrainingModule(
        id: json['id'] as int,
        title: Loc.fromJson(json['title']),
        body: Loc.fromJson(json['body']),
        createdByName: json['createdByName'] as String,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        completionCount: json['completionCount'] as int? ?? 0,
        isComplete: json['isComplete'] as bool? ?? false,
        attachment: json['attachment'] == null
            ? null
            : TrainingAttachment.fromJson(json['attachment'] as Map<String, dynamic>),
      );

  TrainingModule copyWith({bool? isComplete}) => TrainingModule(
        id: id,
        title: title,
        body: body,
        createdByName: createdByName,
        updatedAt: updatedAt,
        completionCount: completionCount,
        isComplete: isComplete ?? this.isComplete,
        attachment: attachment,
      );
}
