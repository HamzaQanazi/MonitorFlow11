/// The authenticated user, as returned by /auth/* and /users/me.
class AppUser {
  final int id;
  final String name;
  // Null for field employees, who log in with an employee id, not an email.
  final String? email;
  final String role; // 'user' | 'employee' | 'admin'
  final String? phone;
  final int? departmentId;
  // What this account logs in with: an email (users) or an EMP-xxxx id.
  final String loginIdentifier;

  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.departmentId,
    required this.loginIdentifier,
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String?,
        role: json['role'] as String,
        phone: json['phone'] as String?,
        departmentId: json['departmentId'] as int?,
        loginIdentifier: (json['loginIdentifier'] as String?) ?? (json['email'] as String? ?? ''),
      );
}
