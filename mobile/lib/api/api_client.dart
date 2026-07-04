// Typed API client for /api/v1 (CLAUDE.md Section 7). Mirrors the web
// client's conventions: bearer JWT on every call, 422 bodies carry
// per-field errors keyed by field id, everything else carries {error}.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Android emulators reach the host machine via 10.0.2.2, everything else
/// (Windows dev builds, physical devices with --dart-define) uses localhost.
const String _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: '',
);

String apiBaseUrl() {
  if (_defaultBaseUrl.isNotEmpty) return _defaultBaseUrl;
  if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:3000/api/v1';
  return 'http://localhost:3000/api/v1';
}

class ApiException implements Exception {
  final int status;
  final String message;

  /// Per-field messages keyed by field id — only populated on 422.
  final Map<String, String> fieldErrors;

  ApiException(this.status, this.message, [this.fieldErrors = const {}]);

  bool get isAuthError => status == 401;

  @override
  String toString() => 'ApiException($status): $message';
}

/// Thrown when the server is unreachable — distinct from an HTTP error so
/// screens can show "check your connection" instead of a server message.
class NetworkException implements Exception {
  final String message;
  NetworkException([this.message = 'Could not reach the server']);

  @override
  String toString() => 'NetworkException: $message';
}

class ApiClient {
  final String baseUrl;
  final http.Client _http;
  String? _token;

  /// Called on any 401 so the app can drop the session (deactivated
  /// accounts are rejected at JWT validation, not just at login).
  void Function()? onUnauthorized;

  ApiClient({String? baseUrl, http.Client? httpClient})
      : baseUrl = baseUrl ?? apiBaseUrl(),
        _http = httpClient ?? http.Client();

  set token(String? value) => _token = value;

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send('GET', path, query: query);

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send('POST', path, body: body);

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _send('PATCH', path, body: body);

  /// Multipart upload (POST /files): file bytes + form fields. Same error
  /// mapping as JSON calls — 422 carries per-field errors.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required List<int> bytes,
    required String filename,
    Map<String, String> fields = const {},
  }) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'));
    request.headers['Accept'] = 'application/json';
    if (_token != null) request.headers['Authorization'] = 'Bearer $_token';
    request.fields.addAll(fields);
    request.files.add(http.MultipartFile.fromBytes('file', bytes, filename: filename));

    http.Response response;
    try {
      response = await http.Response.fromStream(
        await _http.send(request).timeout(const Duration(seconds: 60)),
      );
    } on TimeoutException {
      throw NetworkException('The upload took too long');
    } on http.ClientException {
      throw NetworkException();
    } on SocketException {
      throw NetworkException();
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: {...uri.queryParameters, ...query});
    }

    final request = http.Request(method, uri);
    request.headers['Accept'] = 'application/json';
    if (_token != null) request.headers['Authorization'] = 'Bearer $_token';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    http.Response response;
    try {
      response = await http.Response.fromStream(
        await _http.send(request).timeout(const Duration(seconds: 15)),
      );
    } on TimeoutException {
      throw NetworkException('The server took too long to respond');
    } on http.ClientException {
      throw NetworkException();
    } on SocketException {
      throw NetworkException();
    }
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.statusCode == 204) return const {};

    Map<String, dynamic> json;
    try {
      json = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      json = const {};
    }

    if (response.statusCode >= 200 && response.statusCode < 300) return json;

    if (response.statusCode == 401) onUnauthorized?.call();

    final fieldErrors = <String, String>{};
    if (json['errors'] is Map) {
      (json['errors'] as Map).forEach((k, v) => fieldErrors['$k'] = '$v');
    }
    final message = switch (response.statusCode) {
      401 => (json['error'] as String?) ?? 'Your session has expired — please log in again',
      429 => (json['error'] as String?) ?? 'Too many attempts, try again later',
      422 => (json['error'] as String?) ?? 'Please fix the highlighted fields',
      _ => (json['error'] as String?) ?? 'Something went wrong',
    };
    throw ApiException(response.statusCode, message, fieldErrors);
  }
}
