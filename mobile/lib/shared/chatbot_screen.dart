// In-app help/FAQ assistant (CLAUDE.md §13, chatbot exception — reuses the
// same Gemini proxy already approved for bilingual auto-fill). Shared
// Section 4 cross-app component, same screen in both apps (like Notifications
// and Profile). Stateless on the server: conversation history lives only in
// this screen's state and is round-tripped on every call — nothing persists
// past navigating away.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../auth/auth_state.dart';
import '../api/api_client.dart';
import '../i18n.dart';
import '../theme.dart';

class _ChatMessage {
  final String role; // 'user' | 'assistant'
  final String text;
  const _ChatMessage(this.role, this.text);
}

class ChatbotScreen extends StatefulWidget {
  /// The screen this was opened from (e.g. "Home") — sent as `page` so
  /// ambiguous questions ("how does this work") get an answer about the
  /// actual current screen (backend/src/lib/chatbot.js).
  final String? currentScreen;

  /// i18n keys for the empty-state starter-prompt chips — differs per app
  /// (User vs Employee), passed by each home screen.
  final List<String> suggestionKeys;

  const ChatbotScreen({super.key, this.currentScreen, this.suggestionKeys = const []});

  @override
  State<ChatbotScreen> createState() => _ChatbotScreenState();
}

class _ChatbotScreenState extends State<ChatbotScreen> {
  final _messages = <_ChatMessage>[];
  final _input = TextEditingController();
  final _scroll = ScrollController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _sendText(String text) async {
    text = text.trim();
    if (text.isEmpty || _sending) return;
    final i18n = context.read<I18n>();
    setState(() {
      _error = null;
      _messages.add(_ChatMessage('user', text));
      _input.clear();
      _sending = true;
    });
    _scrollToEnd();
    final auth = context.read<AuthState>();
    final api = auth.api;
    try {
      final history = _messages
          .take(_messages.length - 1) // exclude the message just added — mirrors it below
          .toList()
          .reversed
          .take(20)
          .toList()
          .reversed
          .map((m) => {'role': m.role, 'text': m.text})
          .toList();
      final json = await api.post(
        '/chatbot/message',
        body: {
          'message': text,
          'history': history,
          if (widget.currentScreen != null) 'page': widget.currentScreen,
          'features': auth.user?.companyFeatures ?? const [],
        },
        // Default 15s is too short for this call: the model's own reply can
        // take 20-30s (lib/chatbot.js's 35s server-side timeout), unlike
        // every other endpoint this client talks to.
        timeout: const Duration(seconds: 40),
      );
      setState(() => _messages.add(_ChatMessage('assistant', json['reply'] as String)));
    } on ApiException catch (e) {
      setState(() => _error = e.status == 429 ? i18n.tr('chatbot_rate_limited') : i18n.tr('chatbot_error'));
    } on NetworkException {
      setState(() => _error = i18n.tr('net_check'));
    } finally {
      setState(() => _sending = false);
      _scrollToEnd();
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(_scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('chatbot_title'))),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(i18n.tr('chatbot_empty'),
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Theme.of(context).colorScheme.outline)),
                          if (widget.suggestionKeys.isNotEmpty) ...[
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              alignment: WrapAlignment.center,
                              children: [
                                for (final key in widget.suggestionKeys)
                                  OutlinedButton(
                                    onPressed: () => _sendText(i18n.tr(key)),
                                    child: Text(i18n.tr(key)),
                                  ),
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length + (_sending ? 1 : 0),
                    itemBuilder: (context, i) {
                      if (i == _messages.length) return _bubble(context, '…', isUser: false);
                      final m = _messages[i];
                      return _bubble(context, m.text, isUser: m.role == 'user');
                    },
                  ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      enabled: !_sending,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendText(_input.text),
                      decoration: InputDecoration(
                        hintText: i18n.tr('chatbot_placeholder'),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : () => _sendText(_input.text),
                    icon: const Icon(Icons.send),
                    style: IconButton.styleFrom(backgroundColor: MfColors.amber600, foregroundColor: Colors.white),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble(BuildContext context, String text, {required bool isUser}) {
    return Align(
      alignment: isUser ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: isUser ? MfColors.amber600 : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(text, style: TextStyle(color: isUser ? Colors.white : Theme.of(context).colorScheme.onSurface)),
      ),
    );
  }
}
