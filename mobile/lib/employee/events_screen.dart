// Events (communication feature group): read + self-service RSVP on mobile —
// authoring stays console-only. Upcoming first, past folded away (same
// collapse pattern My Tasks uses for history).
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/event_item.dart';
import '../theme.dart';
import '../widgets/states.dart';

class EventsScreen extends StatefulWidget {
  const EventsScreen({super.key});

  @override
  State<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends State<EventsScreen> {
  List<EventItem>? _events;
  Object? _error;
  bool _showPast = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/events');
      if (!mounted) return;
      setState(() {
        _events = (json['events'] as List<dynamic>)
            .map((e) => EventItem.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  Future<void> _toggleRsvp(EventItem event) async {
    final api = context.read<AuthState>().api;
    try {
      if (event.isGoing) {
        await api.delete('/events/${event.id}/rsvp');
      } else {
        await api.post('/events/${event.id}/rsvp');
      }
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('ev_rsvp_fail'))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('ev_title'))),
      body: _body(i18n),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _events == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('ev_load_fail'),
        onRetry: _load,
      );
    }
    if (_events == null) return const LoadingState();
    if (_events!.isEmpty) {
      return EmptyState(icon: Icons.event_outlined, title: i18n.tr('ev_none_title'));
    }

    final now = DateTime.now();
    final upcoming = _events!.where((e) => !e.startsAt.isBefore(now)).toList()
      ..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    final past = _events!.where((e) => e.startsAt.isBefore(now)).toList()
      ..sort((a, b) => b.startsAt.compareTo(a.startsAt));

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          if (upcoming.isEmpty)
            EmptyState(icon: Icons.event_outlined, title: i18n.tr('ev_none_upcoming'))
          else
            for (final e in upcoming) ...[
              _EventCard(event: e, onTap: () => _openDetail(e), onRsvp: () => _toggleRsvp(e)),
              const SizedBox(height: 10),
            ],
          if (past.isNotEmpty) ...[
            const SizedBox(height: 4),
            TextButton.icon(
              onPressed: () => setState(() => _showPast = !_showPast),
              icon: Icon(_showPast ? Icons.expand_less : Icons.expand_more, size: 18),
              label: Text('${i18n.tr('ev_past')} (${past.length})'),
            ),
            if (_showPast)
              for (final e in past) ...[
                _EventCard(event: e, onTap: () => _openDetail(e), onRsvp: () => _toggleRsvp(e)),
                const SizedBox(height: 10),
              ],
          ],
        ],
      ),
    );
  }

  Future<void> _openDetail(EventItem event) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _EventDetailScreen(event: event, onRsvp: () => _toggleRsvp(event))),
    );
    _load();
  }
}

class _EventCard extends StatelessWidget {
  final EventItem event;
  final VoidCallback onTap;
  final VoidCallback onRsvp;

  const _EventCard({required this.event, required this.onTap, required this.onRsvp});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Material(
      color: MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: MfColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(i18n.l(event.title),
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(
                      [
                        DateFormat.yMMMd().add_jm().format(event.startsAt.toLocal()),
                        if (event.location != null) event.location!,
                      ].join(' · '),
                      style: const TextStyle(color: MfColors.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
              OutlinedButton(
                onPressed: onRsvp,
                child: Text(event.isGoing ? i18n.tr('ev_leave') : i18n.tr('ev_join')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EventDetailScreen extends StatelessWidget {
  final EventItem event;
  final VoidCallback onRsvp;

  const _EventDetailScreen({required this.event, required this.onRsvp});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.l(event.title))),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(DateFormat.yMMMd().add_jm().format(event.startsAt.toLocal()),
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            if (event.location != null) ...[
              const SizedBox(height: 4),
              Text(event.location!, style: const TextStyle(color: MfColors.muted, fontSize: 14)),
            ],
            const SizedBox(height: 8),
            Text('${event.attendeeCount} ${i18n.tr('ev_going_count')}',
                style: const TextStyle(color: MfColors.muted, fontSize: 13)),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: onRsvp,
              child: Text(event.isGoing ? i18n.tr('ev_leave') : i18n.tr('ev_join')),
            ),
            if (event.description != null) ...[
              const SizedBox(height: 20),
              Text(i18n.l(event.description!), style: const TextStyle(fontSize: 15, height: 1.5)),
            ],
          ],
        ),
      ),
    );
  }
}
