// My Schedule (mobile, employee self-service, read-only): the next two weeks
// of shifts a manager assigned via the web Roster grid (GET /schedule/mine).
// Assignment itself is web-console-only — no write surface here.
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/schedule_entry.dart';
import '../theme.dart';
import '../widgets/states.dart';

String _isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

// shift_template start/end are plain TIME values ('HH:MM:SS'), not instants —
// format as given, no timezone conversion (unlike TimeShift's clockInAt).
String _fmtTime(String hhmmss) {
  final parts = hhmmss.split(':');
  final dt = DateTime(2000, 1, 1, int.parse(parts[0]), int.parse(parts[1]));
  return DateFormat.jm().format(dt);
}

class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key});

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  List<ScheduleEntry>? _entries;
  Object? _error;
  final DateTime _from = DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day);
  late final DateTime _to = _from.add(const Duration(days: 13));

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/schedule/mine', query: {'from': _isoDate(_from), 'to': _isoDate(_to)});
      if (!mounted) return;
      setState(() {
        _entries = (json['entries'] as List<dynamic>)
            .map((e) => ScheduleEntry.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('sc_title'))),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _entries == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('sc_load_fail'),
        onRetry: _load,
      );
    }
    if (_entries == null) return const LoadingState();

    final byDate = {for (final e in _entries!) _isoDate(e.date): e};
    final days = List.generate(14, (i) => _from.add(Duration(days: i)));

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: days.length,
        separatorBuilder: (context, i) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final day = days[i];
          return _DayCard(day: day, entry: byDate[_isoDate(day)], isToday: i == 0, i18n: i18n);
        },
      ),
    );
  }
}

class _DayCard extends StatelessWidget {
  final DateTime day;
  final ScheduleEntry? entry;
  final bool isToday;
  final I18n i18n;

  const _DayCard({required this.day, required this.entry, required this.isToday, required this.i18n});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: MfColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isToday ? MfColors.amber600 : MfColors.border, width: isToday ? 1.5 : 1),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  DateFormat('EEE, MMM d').format(day),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                ),
                if (entry != null) ...[
                  const SizedBox(height: 4),
                  Text(i18n.l(entry!.templateName), style: const TextStyle(fontSize: 14, color: MfColors.muted)),
                ],
              ],
            ),
          ),
          Text(
            entry != null ? '${_fmtTime(entry!.startTime)} – ${_fmtTime(entry!.endTime)}' : i18n.tr('sc_no_shift'),
            style: TextStyle(
              fontSize: 14,
              fontWeight: entry != null ? FontWeight.w600 : FontWeight.w400,
              color: entry != null ? MfColors.ink : MfColors.muted,
            ),
          ),
        ],
      ),
    );
  }
}
