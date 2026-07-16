// Login/Registration — one Section 4 page, shared by both mobile apps.
// States: submitting, per-field 422 errors, 401 invalid credentials,
// 429 rate limit, network failure.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../i18n.dart';
import '../theme.dart';
import 'auth_state.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _phone = TextEditingController();

  bool _registering = false;
  bool _submitting = false;
  bool _showPassword = false;
  String? _bannerError;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    _phone.dispose();
    super.dispose();
  }

  void _switchMode() {
    setState(() {
      _registering = !_registering;
      _bannerError = null;
      _fieldErrors = const {};
    });
  }

  Future<void> _submit() async {
    setState(() {
      _bannerError = null;
      _fieldErrors = const {};
    });
    if (!_formKey.currentState!.validate()) return;

    setState(() => _submitting = true);
    final auth = context.read<AuthState>();
    try {
      if (_registering) {
        await auth.register(
          name: _name.text.trim(),
          email: _email.text.trim(),
          password: _password.text,
          phone: _phone.text.trim(),
        );
      } else {
        await auth.login(_email.text.trim(), _password.text);
      }
      // Success: the auth gate in main.dart swaps this screen out.
    } on ApiException catch (e) {
      setState(() {
        if (e.fieldErrors.isNotEmpty) {
          _fieldErrors = e.fieldErrors;
        } else {
          _bannerError = e.message;
        }
      });
    } on NetworkException {
      setState(() => _bannerError = context.read<I18n>().tr('net_check_retry'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const _Wordmark(),
                      const SizedBox(height: 8),
                      Text(
                        _registering ? i18n.tr('login_create') : i18n.tr('login_signin_sub'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 16, color: MfColors.muted),
                      ),
                      // Language toggle — available before sign-in so the whole
                      // flow can be seen in either direction.
                      Align(
                        child: TextButton(
                          onPressed: () => i18n.toggle(),
                          child: Text(i18n.tr('lang_toggle')),
                        ),
                      ),
                      const SizedBox(height: 16),
                      if (_bannerError != null) ...[
                        _ErrorBanner(message: _bannerError!),
                        const SizedBox(height: 16),
                      ],
                      if (_registering) ...[
                        TextFormField(
                          controller: _name,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.name],
                          decoration: InputDecoration(
                            labelText: i18n.tr('login_full_name'),
                            errorText: _fieldErrors['name'],
                          ),
                          validator: (v) => (v == null || v.trim().isEmpty)
                              ? i18n.tr('login_err_name')
                              : null,
                        ),
                        const SizedBox(height: 14),
                      ],
                      TextFormField(
                        controller: _email,
                        keyboardType:
                            _registering ? TextInputType.emailAddress : TextInputType.text,
                        textInputAction: TextInputAction.next,
                        autofillHints: [
                          _registering ? AutofillHints.email : AutofillHints.username,
                        ],
                        decoration: InputDecoration(
                          labelText:
                              _registering ? i18n.tr('login_email') : i18n.tr('login_email_or_id'),
                          errorText: _fieldErrors['email'] ?? _fieldErrors['identifier'],
                        ),
                        validator: (v) {
                          final value = v?.trim() ?? '';
                          if (value.isEmpty) {
                            return _registering
                                ? i18n.tr('login_err_email')
                                : i18n.tr('login_err_id');
                          }
                          // Only registration (users) must be a valid email;
                          // sign-in also accepts an EMP-xxxx employee id.
                          if (_registering &&
                              !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value)) {
                            return i18n.tr('login_err_email_valid');
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        obscureText: !_showPassword,
                        textInputAction:
                            _registering ? TextInputAction.next : TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: _registering ? null : (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: i18n.tr('login_password'),
                          errorText: _fieldErrors['password'],
                          suffixIcon: IconButton(
                            icon: Icon(
                              _showPassword ? Icons.visibility_off : Icons.visibility,
                              color: MfColors.muted,
                            ),
                            tooltip: _showPassword
                                ? i18n.tr('login_hide_password')
                                : i18n.tr('login_show_password'),
                            onPressed: () => setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        validator: (v) {
                          if (v == null || v.isEmpty) return i18n.tr('login_err_password');
                          if (_registering && v.length < 8) {
                            return i18n.tr('login_err_password_len');
                          }
                          return null;
                        },
                      ),
                      if (_registering) ...[
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _phone,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.telephoneNumber],
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: i18n.tr('login_phone_optional'),
                            errorText: _fieldErrors['phone'],
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2.5, color: MfColors.muted),
                              )
                            : Text(_registering
                                ? i18n.tr('login_create_btn')
                                : i18n.tr('login_signin_btn')),
                      ),
                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: _submitting ? null : _switchMode,
                        child: Text(
                          _registering
                              ? i18n.tr('login_have_account')
                              : i18n.tr('login_new_here'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      const TextSpan(children: [
        TextSpan(text: 'Monitor', style: TextStyle(color: MfColors.ink)),
        TextSpan(text: 'Flow', style: TextStyle(color: MfColors.amber600)),
      ]),
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, letterSpacing: -0.5),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  final String message;
  const _ErrorBanner({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: MfColors.errorBg,
        border: Border.all(color: MfColors.errorBorder),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: MfColors.error, size: 20),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: const TextStyle(color: MfColors.error))),
        ],
      ),
    );
  }
}
