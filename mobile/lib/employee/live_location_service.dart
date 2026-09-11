// Live location while clocked in (CLAUDE.md I10 re-scope, 2026-09-11 —
// deliberate, scoped exception: only while an active Time Clock shift is
// open, current position only, cleared server-side on clock-out). A bare
// singleton, deliberately NOT tied to any screen's State: the whole point is
// that pings keep going while the employee is on another tab or the app is
// backgrounded, so its lifecycle is started/stopped only by clock-in/out
// (time_clock_screen.dart) and by sign-out (auth_state.dart), never by a
// widget's dispose().
import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../api/api_client.dart';

const _pingInterval = Duration(minutes: 5);

class LiveLocationService {
  LiveLocationService._();
  static final LiveLocationService instance = LiveLocationService._();

  StreamSubscription<Position>? _sub;

  bool get isRunning => _sub != null;

  /// Idempotent — calling this while already running (e.g. TimeClockScreen's
  /// _load() resuming a still-active shift after an app relaunch) is a no-op.
  /// notificationTitle/Text are passed in (rather than looked up here) so
  /// this file, with no BuildContext of its own, still surfaces the
  /// employee's chosen language (I5) — see time_clock_screen.dart's callers.
  Future<void> start(
    ApiClient api, {
    required String notificationTitle,
    required String notificationText,
  }) async {
    if (_sub != null) return;
    if (!await Geolocator.isLocationServiceEnabled()) return;

    // Live tracking needs "always" permission, not just the one-shot
    // when-in-use grant clock-in itself already requires — Android's
    // background grant is a second, separate runtime prompt that must follow
    // the foreground one. A refusal here just means no live pings; it never
    // blocks clock-in/out themselves (those use their own one-shot fix).
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return;
    }
    if (!kIsWeb && Platform.isAndroid) {
      final bg = await Geolocator.requestPermission();
      if (bg != LocationPermission.always) {
        // whileInUse still works for pings sent while the app is in the
        // foreground; just don't promise background delivery beyond that.
      }
    }

    final settings = _settingsFor(Platform.isAndroid, notificationTitle, notificationText);
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen(
      (pos) => _ping(api, pos),
      onError: (_) {
        // A stream error (permission revoked mid-shift, provider disabled,
        // …) just stops pings — never crashes the app. stop() clears it
        // properly on the next clock-out either way.
      },
    );
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  Future<void> _ping(ApiClient api, Position pos) async {
    try {
      await api.patch('/timeclock/live-location', body: {
        'location': {'lat': pos.latitude, 'lng': pos.longitude},
      });
    } on Exception {
      // Best-effort — a dropped ping is just a slightly-stale marker on the
      // manager's map (routes/timeclock.js flags anything >15 min old), not
      // a failure worth surfacing to the employee.
    }
  }

  LocationSettings _settingsFor(bool isAndroid, String notificationTitle, String notificationText) {
    if (isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.medium,
        intervalDuration: _pingInterval,
        // Required for Android to keep reporting once the app is
        // backgrounded — a persistent, honest notification, never a silent
        // background service (I10's transparency point).
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationTitle: notificationTitle,
          notificationText: notificationText,
          enableWakeLock: true,
        ),
      );
    }
    // iOS (once this project adds the platform) needs the always-on
    // equivalent; every other target here (Windows dev builds) has no real
    // background story, so a plain foreground-only stream is enough.
    if (!kIsWeb && Platform.isIOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.medium,
        distanceFilter: 0,
        pauseLocationUpdatesAutomatically: false,
        allowBackgroundLocationUpdates: true,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.medium);
  }
}
