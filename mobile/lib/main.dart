// MonitorFlow mobile — one codebase, two apps: post-login routing sends
// `user` to the User app and `employee` to the Employee app. Admin (and any
// other kind) is web-only and rejected here (the server still enforces
// per-route).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'auth/auth_state.dart';
import 'auth/login_screen.dart';
import 'employee/employee_home.dart';
import 'i18n.dart';
import 'theme.dart';
import 'user/user_home.dart';

void main() {
  final auth = AuthState(ApiClient())..init();
  final i18n = I18n()..init();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: auth),
        ChangeNotifierProvider.value(value: i18n),
      ],
      child: const MonitorFlowApp(),
    ),
  );
}

class MonitorFlowApp extends StatelessWidget {
  const MonitorFlowApp({super.key});

  @override
  Widget build(BuildContext context) {
    // The locale drives text direction for the whole app. Wrapping the
    // navigator (via builder) flips pushed routes, dialogs and snackbars too.
    final dir = context.watch<I18n>().dir;
    return MaterialApp(
      title: 'MonitorFlow',
      theme: buildTheme(),
      debugShowCheckedModeBanner: false,
      builder: (context, child) => Directionality(textDirection: dir, child: child!),
      home: const _AuthGate(),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    return switch (auth.status) {
      AuthStatus.restoring =>
        const Scaffold(body: Center(child: CircularProgressIndicator())),
      AuthStatus.signedOut => const LoginScreen(),
      AuthStatus.signedIn => switch (auth.user!.role) {
          'user' => const UserHomeScreen(),
          'employee' => const EmployeeHomeScreen(),
          _ => const _MonitorNotSupported(),
        },
    };
  }
}

class _MonitorNotSupported extends StatelessWidget {
  const _MonitorNotSupported();

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.desktop_windows_outlined, size: 48, color: MfColors.muted),
              const SizedBox(height: 16),
              Text(
                i18n.tr('gate_web_title'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text(
                i18n.tr('gate_web_body'),
                textAlign: TextAlign.center,
                style: const TextStyle(color: MfColors.muted),
              ),
              const SizedBox(height: 24),
              TextButton(
                onPressed: () => context.read<AuthState>().logout(),
                child: Text(i18n.tr('sign_out')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
