// ScheduleEntry payloads from GET /schedule/mine (employee self-service).
// Mirrors the backend's routes/schedule.js serialization. Read-only here —
// only a manager (web console) assigns shifts.
import '../i18n.dart';

class ScheduleEntry {
  final DateTime date;
  final int templateId;
  final Loc templateName;
  final String startTime; // 'HH:MM:SS', as returned by pg's TIME column
  final String endTime;

  const ScheduleEntry({
    required this.date,
    required this.templateId,
    required this.templateName,
    required this.startTime,
    required this.endTime,
  });

  factory ScheduleEntry.fromJson(Map<String, dynamic> json) => ScheduleEntry(
        date: DateTime.parse(json['date'] as String),
        templateId: json['templateId'] as int,
        templateName: Loc.fromJson(json['templateName']),
        startTime: json['startTime'] as String,
        endTime: json['endTime'] as String,
      );
}
