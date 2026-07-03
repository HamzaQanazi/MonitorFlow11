/// The authenticated user, as returned by /auth/* and /users/me.
class AppUser {
  final int id;
  final String name;
  final String email;
  final String role; // 'user' | 'employee' | 'monitor'
  final String? phone;
  final int? departmentId;

  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.departmentId,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String,
        role: json['role'] as String,
        phone: json['phone'] as String?,
        departmentId: json['departmentId'] as int?,
      );
}
