// Login/Registration — one Section 4 page, shared by both mobile apps.
// States: submitting, per-field 422 errors, 401 invalid credentials,
// 429 rate limit, network failure.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
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
      setState(() =>
          _bannerError = 'Could not reach the server — check your connection and try again.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
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
                        _registering ? 'Create your account' : 'Sign in to continue',
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 16, color: MfColors.muted),
                      ),
                      const SizedBox(height: 28),
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
                            labelText: 'Full name',
                            errorText: _fieldErrors['name'],
                          ),
                          validator: (v) =>
                              (v == null || v.trim().isEmpty) ? 'Name is required' : null,
                        ),
                        const SizedBox(height: 14),
                      ],
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.email],
                        decoration: InputDecoration(
                          labelText: 'Email',
                          errorText: _fieldErrors['email'],
                        ),
                        validator: (v) {
                          final value = v?.trim() ?? '';
                          if (value.isEmpty) return 'Email is required';
                          if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value)) {
                            return 'Enter a valid email';
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
                          labelText: 'Password',
                          errorText: _fieldErrors['password'],
                          suffixIcon: IconButton(
                            icon: Icon(
                              _showPassword ? Icons.visibility_off : Icons.visibility,
                              color: MfColors.muted,
                            ),
                            tooltip: _showPassword ? 'Hide password' : 'Show password',
                            onPressed: () => setState(() => _showPassword = !_showPassword),
                          ),
                        ),
                        validator: (v) {
                          if (v == null || v.isEmpty) return 'Password is required';
                          if (_registering && v.length < 8) {
                            return 'Password must be at least 8 characters';
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
                            labelText: 'Phone (optional)',
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
                            : Text(_registering ? 'Create account' : 'Sign in'),
                      ),
                      const SizedBox(height: 16),
                      TextButton(
                        onPressed: _submitting ? null : _switchMode,
                        child: Text(
                          _registering
                              ? 'Already have an account? Sign in'
                              : 'New here? Create an account',
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
