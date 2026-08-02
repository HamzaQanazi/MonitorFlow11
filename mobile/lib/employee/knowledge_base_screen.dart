// Knowledge Base (communication feature group): read-only on mobile —
// authoring stays console-only. Flat list, no categories, no search (article
// counts are expected small; add search when that stops being true).
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

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    final api = context.read<AuthState>().api;
    try {
      final json = await api.get('/knowledge-base');
      if (!mounted) return;
      setState(() {
        _articles = (json['articles'] as List<dynamic>)
            .map((a) => KbArticle.fromJson(a as Map<String, dynamic>))
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
      appBar: AppBar(title: Text(i18n.tr('kb_title'))),
      body: _body(i18n),
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
      return EmptyState(icon: Icons.menu_book_outlined, title: i18n.tr('kb_none_title'));
    }

    return RefreshIndicator(
      color: MfColors.amber600,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
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
