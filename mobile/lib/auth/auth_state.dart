// Session state shared by both mobile apps. Restores the stored JWT on
// launch and revalidates it via GET /auth/me (a deactivated account's old
// token must be rejected — CLAUDE.md Section 3 security baseline).
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../models/user.dart';

const _tokenKey = 'mf.token';

enum AuthStatus { restoring, signedOut, signedIn }

class AuthState extends ChangeNotifier {
  final ApiClient api;

  AuthStatus _status = AuthStatus.restoring;
  AppUser? _user;

  AuthState(this.api) {
    api.onUnauthorized = _handleUnauthorized;
  }

  AuthStatus get status => _status;
  AppUser? get user => _user;

  /// Restore a stored session, if any. Network failure keeps the stored
  /// token (offline launch shouldn't log you out); a 401 discards it.
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_tokenKey);
    if (token == null) {
      _status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    api.token = token;
    try {
      final json = await api.get('/auth/me');
      _user = AppUser.fromJson(json['user'] as Map<String, dynamic>);
      _status = AuthStatus.signedIn;
    } on ApiException {
      await _clearSession(); // 401 already handled; any API error → sign out
    } on NetworkException {
      _status = AuthStatus.signedOut;
    }
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final json = await api.post('/auth/login', body: {'email': email, 'password': password});
    await _storeSession(json);
  }

  Future<void> register({
    required String name,
    required String email,
    required String password,
    String? phone,
  }) async {
    final json = await api.post('/auth/register', body: {
      'name': name,
      'email': email,
      'password': password,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
    });
    await _storeSession(json);
  }

  /// Logout is client-side token discard — there is no endpoint (Section 7).
  Future<void> logout() async {
    await _clearSession();
    notifyListeners();
  }

  Future<void> _storeSession(Map<String, dynamic> json) async {
    final token = json['token'] as String;
    _user = AppUser.fromJson(json['user'] as Map<String, dynamic>);
    api.token = token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    _status = AuthStatus.signedIn;
    notifyListeners();
  }

  Future<void> _clearSession() async {
    api.token = null;
    _user = null;
    _status = AuthStatus.signedOut;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
  }

  void _handleUnauthorized() {
    if (_status != AuthStatus.signedIn) return;
    _clearSession().then((_) => notifyListeners());
  }
}
