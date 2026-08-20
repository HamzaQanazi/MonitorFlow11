// Time Clock (mobile core, employee self-service): clock in/out, start/end
// break, log hours manually. NFC clock-in was scoped out (hardware-dependent,
// no testable path in this environment — see 017_time_clock.sql's header).
// In-shift notes/photos/tips are the next increment (shift extras), added
// once an active shift exists here.
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/time_shift.dart';
import '../theme.dart';
import '../widgets/states.dart';
import 'manual_hours_screen.dart';

class TimeClockScreen extends StatefulWidget {
  const TimeClockScreen({super.key});

  @override
  State<TimeClockScreen> createState() => _TimeClockScreenState();
}

class _TimeClockScreenState extends State<TimeClockScreen> {
  TimeShift? _shift; // null = not currently clocked in
  bool _loaded = false;
  Object? _error;
  bool _acting = false;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/timeclock/shifts/active');
      if (!mounted) return;
      setState(() {
        _shift = _parseShift(json);
        _loaded = true;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loaded = true;
      });
    }
  }

  TimeShift? _parseShift(Map<String, dynamic> json) {
    final s = json['shift'] as Map<String, dynamic>?;
    return s == null ? null : TimeShift.fromJson(s);
  }

  Future<void> _act(String path, {Object? body}) async {
    final i18n = context.read<I18n>();
    setState(() => _acting = true);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.post(path, body: body);
      if (!mounted) return;
      // clock-out's response is the shift just completed, not an active one —
      // treat anything non-active as "not clocked in" rather than trusting
      // null-ness alone.
      final parsed = _parseShift(json);
      setState(() => _shift = parsed?.status == 'active' ? parsed : null);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(i18n.apiError(e))));
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(i18n.tr('net_retry'))));
    } finally {
      if (mounted) setState(() => _acting = false);
    }
  }

  // Mandatory one-shot device location fix before clocking in (never a
  // stream, never stored as a coordinate server-side — see timeclock.js's
  // clock-in handler). Blocks the action entirely on denial/failure rather
  // than clocking in without one.
  Future<void> _clockIn() async {
    final i18n = context.read<I18n>();
    setState(() => _locating = true);
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _showError(i18n.tr('tc_location_failed'));
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        _showError(i18n.tr('tc_location_denied'));
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      if (!mounted) return;
      await _act('/timeclock/clock-in', body: {
        'location': {'lat': pos.latitude, 'lng': pos.longitude},
      });
    } catch (_) {
      if (mounted) _showError(i18n.tr('tc_location_failed'));
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  // Clock-out's location is best-effort — unlike clock-in, a field employee
  // without a signal (or who denies permission) can still clock out; the
  // coordinate is simply omitted. A short timeout keeps a slow/failed fix
  // from blocking the action itself.
  Future<void> _clockOut() async {
    Map<String, double>? location;
    try {
      if (await Geolocator.isLocationServiceEnabled()) {
        var permission = await Geolocator.checkPermission();
        if (permission == LocationPermission.denied) {
          permission = await Geolocator.requestPermission();
        }
        if (permission != LocationPermission.denied && permission != LocationPermission.deniedForever) {
          final pos = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(timeLimit: Duration(seconds: 5)),
          );
          location = {'lat': pos.latitude, 'lng': pos.longitude};
        }
      }
    } catch (_) {
      // Best-effort — any failure just means no location on this clock-out.
    }
    if (!mounted) return;
    await _act('/timeclock/clock-out', body: location != null ? {'location': location} : null);
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openManualHours() async {
    final done = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => const ManualHoursScreen()));
    if (done == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('tc_manual_submitted'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('tc_title'))),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && !_loaded) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('tc_load_fail'),
        onRetry: _load,
      );
    }
    if (!_loaded) return const LoadingState();

    final shift = _shift;
    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          _StatusCard(shift: shift, i18n: i18n),
          const SizedBox(height: 24),
          if (shift == null)
            ElevatedButton.icon(
              onPressed: _acting || _locating ? null : _clockIn,
              icon: _locating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.login),
              label: Text(_locating ? i18n.tr('tc_locating') : i18n.tr('tc_clock_in')),
            )
          else ...[
            if (shift.isOnBreak)
              ElevatedButton.icon(
                onPressed: _acting ? null : () => _act('/timeclock/breaks/end'),
                icon: const Icon(Icons.play_arrow),
                label: Text(i18n.tr('tc_end_break')),
              )
            else
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                onPressed: _acting ? null : () => _act('/timeclock/breaks/start'),
                icon: const Icon(Icons.pause),
                label: Text(i18n.tr('tc_start_break')),
              ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _acting || shift.isOnBreak ? null : _clockOut,
              icon: const Icon(Icons.logout),
              label: Text(i18n.tr('tc_clock_out')),
            ),
            if (shift.isOnBreak)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  i18n.tr('tc_end_break_first'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: MfColors.muted, fontSize: 13),
                ),
              ),
          ],
          const SizedBox(height: 24),
          const Divider(),
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: _openManualHours,
            icon: const Icon(Icons.edit_calendar_outlined),
            label: Text(i18n.tr('tc_log_manual')),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final TimeShift? shift;
  final I18n i18n;
  const _StatusCard({required this.shift, required this.i18n});

  @override
  Widget build(BuildContext context) {
    final onBreak = shift?.isOnBreak ?? false;
    final label = shift == null
        ? i18n.tr('tc_not_clocked_in')
        : onBreak
            ? i18n.tr('tc_on_break')
            : i18n.tr('tc_clocked_in');
    final c = shift == null
        ? MfColors.muted
        : (onBreak ? MfColors.amber600 : kOpenColors.accent);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: MfColors.surface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(color: c, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Text(label, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ],
          ),
          if (shift != null) ...[
            const SizedBox(height: 8),
            Text(
              '${i18n.tr('tc_since')} ${DateFormat.jm().format(shift!.clockInAt.toLocal())}',
              style: const TextStyle(color: MfColors.muted, fontSize: 14),
            ),
          ],
        ],
      ),
    );
  }
}
