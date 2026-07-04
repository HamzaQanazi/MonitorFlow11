// Request Details / Timeline — the detail half of the merged My Requests
// page (Section 4). One call: GET /requests/{id} embeds history and
// comments. Refreshes on focus resume, not a timer (the polling rules).
// Cancel / confirm-dispute / comment posting arrive with the Week 5
// backend endpoints.
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../models/request.dart';
import '../theme.dart';
import '../widgets/states.dart';

class RequestDetailScreen extends StatefulWidget {
  final int requestId;

  const RequestDetailScreen({super.key, required this.requestId});

  @override
  State<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends State<RequestDetailScreen>
    with WidgetsBindingObserver {
  RequestDetail? _detail;
  Object? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/requests/${widget.requestId}');
      if (!mounted) return;
      setState(() {
        _detail = RequestDetail.fromJson(json['request'] as Map<String, dynamic>);
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      if (!silent || _detail == null) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Request #${widget.requestId}')),
      body: _body(),
    );
  }

  Widget _body() {
    if (_error != null && _detail == null) {
      final message = switch (_error) {
        ApiException(status: 404) => 'This request could not be found.',
        NetworkException() => 'Could not reach the server — check your connection.',
        _ => 'Could not load this request.',
      };
      return ErrorState(message: message, onRetry: _load);
    }
    if (_detail == null) return const LoadingState();

    final d = _detail!;
    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  d.summary.serviceTypeName,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                ),
              ),
              StatusPill(status: d.summary.status),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Submitted ${DateFormat.yMMMd().add_jm().format(d.summary.createdAt.toLocal())}'
            ' · ${d.summary.priority} priority',
            style: const TextStyle(color: MfColors.muted, fontSize: 13),
          ),
          const SizedBox(height: 24),
          const _SectionTitle('Timeline'),
          const SizedBox(height: 12),
          _Timeline(entries: d.statusHistory),
          const SizedBox(height: 24),
          const _SectionTitle('Your answers'),
          const SizedBox(height: 12),
          _FormResponse(response: d.formResponse),
          if (d.comments.isNotEmpty) ...[
            const SizedBox(height: 24),
            const _SectionTitle('Comments'),
            const SizedBox(height: 12),
            for (final c in d.comments) _CommentTile(comment: c),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      );
}

class _Timeline extends StatelessWidget {
  final List<HistoryEntry> entries;
  const _Timeline({required this.entries});

  @override
  Widget build(BuildContext context) {
    // Newest first, like the Monitor detail pane.
    final ordered = entries.reversed.toList();
    return Column(
      children: [
        for (var i = 0; i < ordered.length; i++)
          _TimelineRow(entry: ordered[i], isLast: i == ordered.length - 1),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  final HistoryEntry entry;
  final bool isLast;

  const _TimelineRow({required this.entry, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final c = categoryColors(entry.status.category);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Container(
                  width: 11,
                  height: 11,
                  margin: const EdgeInsets.only(top: 3),
                  decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                ),
                if (!isLast)
                  const Expanded(
                    child: VerticalDivider(width: 1, color: MfColors.border),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entry.status.label,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(
                    '${DateFormat.yMMMd().add_jm().format(entry.changedAt.toLocal())}'
                    ' · ${entry.changedByName}',
                    style: const TextStyle(color: MfColors.muted, fontSize: 12),
                  ),
                  if (entry.note != null && entry.note!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: MfColors.surface,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(entry.note!, style: const TextStyle(fontSize: 13)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FormResponse extends StatelessWidget {
  final Map<String, dynamic> response;
  const _FormResponse({required this.response});

  @override
  Widget build(BuildContext context) {
    // Field ids double as readable labels here; the schema-labelled version
    // needs a second fetch and lands with the Week 5 detail work.
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: MfColors.surface,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in response.entries)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 2,
                    child: Text(
                      entry.key.replaceAll('_', ' '),
                      style: const TextStyle(color: MfColors.muted, fontSize: 13),
                    ),
                  ),
                  Expanded(
                    flex: 3,
                    child: Text('${entry.value}', style: const TextStyle(fontSize: 13)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _CommentTile extends StatelessWidget {
  final RequestComment comment;
  const _CommentTile({required this.comment});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${comment.authorName} · '
            '${DateFormat.yMMMd().add_jm().format(comment.createdAt.toLocal())}',
            style: const TextStyle(color: MfColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Text(comment.body),
        ],
      ),
    );
  }
}
