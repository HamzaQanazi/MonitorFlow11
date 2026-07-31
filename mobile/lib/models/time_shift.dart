// TimeShift payloads from /timeclock endpoints (employee self-service).
// Mirrors the backend's serialize(loadShiftDetail(...)) shape
// (backend/src/routes/timeclock.js). Entries (notes/photos/tips) join this
// model in the shift-extras increment; core clock in/out/break doesn't need
// them yet.
class TimeBreak {
  final int id;
  final DateTime breakStartAt;
  final DateTime? breakEndAt;

  const TimeBreak({required this.id, required this.breakStartAt, this.breakEndAt});

  factory TimeBreak.fromJson(Map<String, dynamic> json) => TimeBreak(
        id: json['id'] as int,
        breakStartAt: DateTime.parse(json['breakStartAt'] as String),
        breakEndAt:
            json['breakEndAt'] == null ? null : DateTime.parse(json['breakEndAt'] as String),
      );

  bool get isActive => breakEndAt == null;
}

class TimeShift {
  final int id;
  final DateTime clockInAt;
  final DateTime? clockOutAt;
  final String status; // active | completed
  final List<TimeBreak> breaks;

  const TimeShift({
    required this.id,
    required this.clockInAt,
    this.clockOutAt,
    required this.status,
    this.breaks = const [],
  });

  factory TimeShift.fromJson(Map<String, dynamic> json) => TimeShift(
        id: json['id'] as int,
        clockInAt: DateTime.parse(json['clockInAt'] as String),
        clockOutAt:
            json['clockOutAt'] == null ? null : DateTime.parse(json['clockOutAt'] as String),
        status: json['status'] as String,
        breaks: (json['breaks'] as List<dynamic>? ?? const [])
            .map((b) => TimeBreak.fromJson(b as Map<String, dynamic>))
            .toList(),
      );

  TimeBreak? get activeBreak {
    for (final b in breaks) {
      if (b.isActive) return b;
    }
    return null;
  }

  bool get isOnBreak => activeBreak != null;
}
