// MonitorFlow mobile — one codebase, two apps: post-login routing sends
// `user` to the User app and `employee` to the Employee app. Monitor is
// web-only and rejected here (the server still enforces per-route).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'auth/auth_state.dart';
import 'auth/login_screen.dart';
import 'theme.dart';

void main() {
  final auth = AuthState(ApiClient())..init();
  runApp(
    ChangeNotifierProvider.value(value: auth, child: const MonitorFlowApp()),
  );
}

class MonitorFlowApp extends StatelessWidget {
  const MonitorFlowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MonitorFlow',
      theme: buildTheme(),
      debugShowCheckedModeBanner: false,
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
          'user' => const _PlaceholderHome(title: 'User Home'),
          'employee' => const _PlaceholderHome(title: 'Employee Home'),
          _ => const _MonitorNotSupported(),
        },
    };
  }
}

/// Temporary shell until the real Home pages land (Section 4).
class _PlaceholderHome extends StatelessWidget {
  final String title;
  const _PlaceholderHome({required this.title});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => context.read<AuthState>().logout(),
          ),
        ],
      ),
      body: Center(
        child: Text(
          'Signed in as ${auth.user?.name ?? ''}',
          style: const TextStyle(color: MfColors.muted),
        ),
      ),
    );
  }
}

class _MonitorNotSupported extends StatelessWidget {
  const _MonitorNotSupported();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.desktop_windows_outlined, size: 48, color: MfColors.muted),
              const SizedBox(height: 16),
              const Text(
                'Monitor accounts use the web dashboard',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              const Text(
                'This app is for users and field employees only.',
                textAlign: TextAlign.center,
                style: TextStyle(color: MfColors.muted),
              ),
              const SizedBox(height: 24),
              TextButton(
                onPressed: () => context.read<AuthState>().logout(),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
