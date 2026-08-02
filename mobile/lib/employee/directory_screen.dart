// Company Directory (communication feature group): company-wide, not
// subtree-scoped — see backend/src/routes/directory.js's comment for why
// this is the one list in the app that isn't Gate-2 restricted.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/directory_entry.dart';
import '../theme.dart';
import '../widgets/states.dart';

class DirectoryScreen extends StatefulWidget {
  const DirectoryScreen({super.key});

  @override
  State<DirectoryScreen> createState() => _DirectoryScreenState();
}

class _DirectoryScreenState extends State<DirectoryScreen> {
  List<DirectoryEntry>? _entries;
  Object? _error;
  String _query = '';
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/directory', query: {
        'pageSize': '100',
        if (_query.isNotEmpty) 'q': _query,
      });
      if (!mounted) return;
      setState(() {
        _entries = (json['directory'] as List<dynamic>)
            .map((e) => DirectoryEntry.fromJson(e as Map<String, dynamic>))
            .toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  void _onSearchChanged(String value) {
    _query = value;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), _load);
  }

  Future<void> _call(String phone) async {
    final ok = await launchUrl(Uri(scheme: 'tel', path: phone))
        .then((v) => v, onError: (_) => false);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('dir_no_phone'))),
      );
    }
  }

  Future<void> _email(String email) async {
    await launchUrl(Uri(scheme: 'mailto', path: email))
        .then((v) => v, onError: (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('dir_title'))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: i18n.tr('dir_search_ph'),
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                isDense: true,
              ),
            ),
          ),
          Expanded(child: _body(i18n)),
        ],
      ),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _entries == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('dir_load_fail'),
        onRetry: _load,
      );
    }
    if (_entries == null) return const LoadingState();
    if (_entries!.isEmpty) {
      return EmptyState(
        icon: Icons.people_outline,
        title: _query.isEmpty ? i18n.tr('dir_none_title') : i18n.tr('dir_no_match_title'),
      );
    }

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: _entries!.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _EntryCard(
          entry: _entries![i],
          onCall: _call,
          onEmail: _email,
        ),
      ),
    );
  }
}

class _EntryCard extends StatelessWidget {
  final DirectoryEntry entry;
  final void Function(String phone) onCall;
  final void Function(String email) onEmail;

  const _EntryCard({required this.entry, required this.onCall, required this.onEmail});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final meta = [
      if (entry.levelName != null) i18n.l(entry.levelName!),
      if (entry.departmentName != null) i18n.l(entry.departmentName!),
      if (entry.branchName != null) i18n.l(entry.branchName!),
    ].join(' · ');

    return Material(
      color: MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: MfColors.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          entry.name,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (entry.isYou) ...[
                        const SizedBox(width: 6),
                        Text('· ${i18n.tr('dir_you')}',
                            style: const TextStyle(color: MfColors.muted, fontSize: 13)),
                      ],
                    ],
                  ),
                  if (meta.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(meta, style: const TextStyle(color: MfColors.muted, fontSize: 13)),
                  ],
                ],
              ),
            ),
            if (entry.phone != null)
              IconButton(
                icon: const Icon(Icons.call_outlined),
                tooltip: i18n.tr('dir_call'),
                onPressed: () => onCall(entry.phone!),
              ),
            if (entry.email != null)
              IconButton(
                icon: const Icon(Icons.mail_outline),
                tooltip: i18n.tr('dir_email'),
                onPressed: () => onEmail(entry.email!),
              ),
          ],
        ),
      ),
    );
  }
}
