// TrainingModule payloads from GET /training (hr_skills feature group).
// Read + self-service completion only here — authoring stays console-only.
import '../i18n.dart';

class TrainingModule {
  final int id;
  final Loc title;
  final Loc body;
  final String createdByName;
  final DateTime updatedAt;
  final int completionCount;
  final bool isComplete;

  const TrainingModule({
    required this.id,
    required this.title,
    required this.body,
    required this.createdByName,
    required this.updatedAt,
    required this.completionCount,
    required this.isComplete,
  });

  factory TrainingModule.fromJson(Map<String, dynamic> json) => TrainingModule(
        id: json['id'] as int,
        title: Loc.fromJson(json['title']),
        body: Loc.fromJson(json['body']),
        createdByName: json['createdByName'] as String,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        completionCount: json['completionCount'] as int? ?? 0,
        isComplete: json['isComplete'] as bool? ?? false,
      );

  TrainingModule copyWith({bool? isComplete}) => TrainingModule(
        id: id,
        title: title,
        body: body,
        createdByName: createdByName,
        updatedAt: updatedAt,
        completionCount: completionCount,
        isComplete: isComplete ?? this.isComplete,
      );
}
