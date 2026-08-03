/// The authenticated user, as returned by /auth/* and /users/me.
class AppUser {
  final int id;
  final String name;
  // Null for field employees, who log in with an employee id, not an email.
  final String? email;
  final String role; // 'user' | 'employee' | 'admin'
  final String? phone;
  final int? departmentId;
  // What this account logs in with: an email (users) or a 4-digit number.
  final String loginIdentifier;
  // The onboarding wizard's step-4 feature picks — gates the 7 workforce
  // module screens the same way the web console's nav does. The server
  // enforces this too (requireFeature, backend/src/middleware/auth.js); this
  // only keeps the UI from offering a screen that would just 403.
  final List<String> companyFeatures;

  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.departmentId,
    required this.loginIdentifier,
    this.companyFeatures = const [],
  });

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String?,
        role: json['role'] as String,
        phone: json['phone'] as String?,
        departmentId: json['departmentId'] as int?,
        loginIdentifier: (json['loginIdentifier'] as String?) ?? (json['email'] as String? ?? ''),
        companyFeatures: (json['companyFeatures'] as List<dynamic>?)?.cast<String>() ?? const [],
      );
}
