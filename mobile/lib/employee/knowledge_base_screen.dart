// Knowledge Base (communication feature group): read-only on mobile —
// authoring stays console-only. Flat list with server-side search (same
// GET /knowledge-base?q= the web console uses — matches both languages of
// title AND body, so an article is found by what it says, not just its
// title). Debounced the same way the web page debounces (250ms).
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../models/kb_article.dart';
import '../theme.dart';
import '../widgets/states.dart';

class KnowledgeBaseScreen extends StatefulWidget {
  const KnowledgeBaseScreen({super.key});

  @override
  State<KnowledgeBaseScreen> createState() => _KnowledgeBaseScreenState();
}

class _KnowledgeBaseScreenState extends State<KnowledgeBaseScreen> {
  List<KbArticle>? _articles;
  Object? _error;
  String _query = '';
  Timer? _debounce;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final q = _query.trim();
      final json = await api.get('/knowledge-base', query: q.isEmpty ? null : {'q': q});
      if (!mounted) return;
      setState(() {
        _articles = (json['articles'] as List<dynamic>)
            .map((a) => KbArticle.fromJson(a as Map<String, dynamic>))
            .toList();
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      // A search re-fetch never blanks an already-visible list with an
      // error screen — same "silent" shape used for polling elsewhere.
      if (!silent || _articles == null) setState(() => _error = e);
    }
  }

  void _onSearchChanged(String value) {
    setState(() => _query = value);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () => _load(silent: _articles != null));
  }

  void _clearSearch() {
    _searchController.clear();
    _debounce?.cancel();
    setState(() => _query = '');
    _load(silent: _articles != null);
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('kb_title'))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: TextField(
              controller: _searchController,
              textInputAction: TextInputAction.search,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: i18n.tr('kb_search'),
                prefixIcon: const Icon(Icons.search, size: 20),
                suffixIcon: _query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        onPressed: _clearSearch,
                      ),
              ),
            ),
          ),
          Expanded(child: _body(i18n)),
        ],
      ),
    );
  }

  Widget _body(I18n i18n) {
    if (_error != null && _articles == null) {
      return ErrorState(
        message: _error is NetworkException ? i18n.tr('net_check') : i18n.tr('kb_load_fail'),
        onRetry: _load,
      );
    }
    if (_articles == null) return const LoadingState();
    if (_articles!.isEmpty) {
      return _query.trim().isEmpty
          ? EmptyState(icon: Icons.menu_book_outlined, title: i18n.tr('kb_none_title'))
          : EmptyState(
              icon: Icons.search_off_outlined,
              title: i18n.tr('kb_no_match_title'),
              action: OutlinedButton(
                onPressed: _clearSearch,
                child: Text(i18n.tr('clear_filter')),
              ),
            );
    }

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        itemCount: _articles!.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _ArticleCard(article: _articles![i]),
      ),
    );
  }
}

class _ArticleCard extends StatelessWidget {
  final KbArticle article;
  const _ArticleCard({required this.article});

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
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => _ArticleDetailScreen(article: article)),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(i18n.l(article.title),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(
                '${article.createdByName} · ${i18n.relativeTime(article.updatedAt)}',
                style: const TextStyle(color: MfColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ArticleDetailScreen extends StatelessWidget {
  final KbArticle article;
  const _ArticleDetailScreen({required this.article});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.l(article.title))),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${article.createdByName} · ${i18n.relativeTime(article.updatedAt)}',
              style: const TextStyle(color: MfColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 16),
            Text(i18n.l(article.body), style: const TextStyle(fontSize: 15, height: 1.5)),
          ],
        ),
      ),
    );
  }
}
