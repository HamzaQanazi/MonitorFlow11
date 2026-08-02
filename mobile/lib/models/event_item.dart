// EventItem payloads from GET /events (communication feature group).
// Read + self-service RSVP only here — authoring stays console-only.
import '../i18n.dart';

class EventItem {
  final int id;
  final Loc title;
  final Loc? description;
  final DateTime startsAt;
  final DateTime? endsAt;
  final String? location;
  final String createdByName;
  final int attendeeCount;
  final bool isGoing;

  const EventItem({
    required this.id,
    required this.title,
    this.description,
    required this.startsAt,
    this.endsAt,
    this.location,
    required this.createdByName,
    required this.attendeeCount,
    required this.isGoing,
  });

  factory EventItem.fromJson(Map<String, dynamic> json) => EventItem(
        id: json['id'] as int,
        title: Loc.fromJson(json['title']),
        description: json['description'] == null ? null : Loc.fromJson(json['description']),
        startsAt: DateTime.parse(json['startsAt'] as String),
        endsAt: json['endsAt'] == null ? null : DateTime.parse(json['endsAt'] as String),
        location: json['location'] as String?,
        createdByName: json['createdByName'] as String,
        attendeeCount: json['attendeeCount'] as int? ?? 0,
        isGoing: json['isGoing'] as bool? ?? false,
      );
}
