// Push token registration (CLAUDE.md §13, FCM exception, Android only for
// now — no APNs key configured, so this silently does nothing useful on iOS
// until that's added). Same "best-effort, never blocks the caller" shape as
// every other named-vendor integration in this app: if Firebase isn't
// reachable or permission is denied, the app just falls back to the existing
// 30s notification poll — login must never fail because of this.
import 'package:firebase_messaging/firebase_messaging.dart';

import '../api/api_client.dart';

Future<void> registerPushToken(ApiClient api) async {
  try {
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(); // Android 13+ requires this at runtime
    final token = await messaging.getToken();
    if (token == null) return;
    await api.post('/notifications/devices', body: {'token': token});

    // FCM rotates the token occasionally; re-register so the DB row stays
    // current for the lifetime of this app session.
    messaging.onTokenRefresh.listen((newToken) {
      api.post('/notifications/devices', body: {'token': newToken}).catchError((_) => const <String, dynamic>{});
    });
  } catch (_) {
    // Best-effort — see file header.
  }
}
