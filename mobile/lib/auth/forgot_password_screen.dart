// Self-service password reset, step 1 (CLAUDE.md §13 re-scope,
// supervisor-directed) — the mobile counterpart of web/src/pages/
// ForgotPasswordPage.tsx, same backend endpoint. POST /auth/forgot-password
// always responds the same way whether or not the identifier matched an
// account, so this screen shows the same "check your email" confirmation
// either way — no account enumeration.
//
// There is no native "set new password" screen here on purpose: the emailed
// link opens web/src/pages/ResetPasswordPage.tsx, a public page (no login,
// no console/role gate) that already completes the reset for any account
// kind — a `user`/`employee` on mobile finishes the flow in their phone's
// browser, then returns here to sign in with the new password. Building a
// second, native reset screen would need app deep-linking (custom scheme or
// platform App/Universal Links config) that doesn't exist in this app yet —
// skip until the browser hand-off is an actual complaint, not a guess.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../i18n.dart';
import '../theme.dart';
import 'auth_state.dart';

class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  bool _submitting = false;
  bool _sent = false;

  @override
  void dispose() {
    _identifier.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.post('/auth/forgot-password', body: {'identifier': _identifier.text.trim()});
    } on ApiException {
      // Deliberately ignored (matches the web page): the endpoint itself
      // never reveals whether the account exists, so the confirmation shown
      // below is the same regardless.
    } on NetworkException {
      // Same reasoning — don't leak a different outcome for "server
      // unreachable" vs. "no such account".
    } finally {
      if (mounted) {
        setState(() {
          _submitting = false;
          _sent = true;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('fp_title'))),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent ? _SentConfirmation(i18n: i18n) : _buildForm(i18n),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildForm(I18n i18n) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            i18n.tr('fp_sub'),
            style: const TextStyle(fontSize: 15, color: MfColors.muted),
          ),
          const SizedBox(height: 20),
          TextFormField(
            controller: _identifier,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.username],
            onFieldSubmitted: (_) => _submit(),
            decoration: InputDecoration(labelText: i18n.tr('fp_identifier')),
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? i18n.tr('login_err_id') : null,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: MfColors.muted),
                  )
                : Text(i18n.tr('fp_submit')),
          ),
        ],
      ),
    );
  }
}

class _SentConfirmation extends StatelessWidget {
  final I18n i18n;
  const _SentConfirmation({required this.i18n});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.mark_email_read_outlined, size: 48, color: MfColors.amber600),
        const SizedBox(height: 16),
        Text(
          i18n.tr('fp_sent'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 15, color: MfColors.muted),
        ),
        const SizedBox(height: 24),
        OutlinedButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(i18n.tr('fp_back_to_login')),
        ),
      ],
    );
  }
}
