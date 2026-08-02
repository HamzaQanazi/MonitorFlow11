// DirectoryEntry payloads from GET /directory (communication feature group).
// Company-wide, not subtree-scoped — mirrors routes/directory.js.
import '../i18n.dart';

class DirectoryEntry {
  final int id;
  final String name;
  final String? phone;
  final String? email;
  final bool isYou;
  final Loc? departmentName;
  final Loc? branchName;
  final Loc? levelName;

  const DirectoryEntry({
    required this.id,
    required this.name,
    this.phone,
    this.email,
    required this.isYou,
    this.departmentName,
    this.branchName,
    this.levelName,
  });

  factory DirectoryEntry.fromJson(Map<String, dynamic> json) => DirectoryEntry(
        id: json['id'] as int,
        name: json['name'] as String,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
        isYou: json['isYou'] as bool? ?? false,
        departmentName: json['departmentName'] == null ? null : Loc.fromJson(json['departmentName']),
        branchName: json['branchName'] == null ? null : Loc.fromJson(json['branchName']),
        levelName: json['levelName'] == null ? null : Loc.fromJson(json['levelName']),
      );
}
