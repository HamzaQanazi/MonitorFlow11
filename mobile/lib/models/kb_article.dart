// KbArticle payloads from GET /knowledge-base (communication feature group).
// Read-only here — authoring stays console-only (routes/knowledgeBase.js).
import '../i18n.dart';

class KbArticle {
  final int id;
  final Loc title;
  final Loc body;
  final String createdByName;
  final DateTime updatedAt;

  const KbArticle({
    required this.id,
    required this.title,
    required this.body,
    required this.createdByName,
    required this.updatedAt,
  });

  factory KbArticle.fromJson(Map<String, dynamic> json) => KbArticle(
        id: json['id'] as int,
        title: Loc.fromJson(json['title']),
        body: Loc.fromJson(json['body']),
        createdByName: json['createdByName'] as String,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
}
