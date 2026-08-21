// Self-service reset request screen (CLAUDE.md §13 re-scope). No live
// backend here — the client points at an unreachable port, so a submit
// always raises NetworkException, which the screen deliberately swallows
// (same "never reveal whether the account exists" reasoning as a real 200
// from the server) and shows the confirmation regardless.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:monitorflow_mobile/api/api_client.dart';
import 'package:monitorflow_mobile/auth/auth_state.dart';
import 'package:monitorflow_mobile/auth/forgot_password_screen.dart';
import 'package:monitorflow_mobile/i18n.dart';
import 'package:monitorflow_mobile/theme.dart';

Widget wrap() => MultiProvider(
      providers: [
        ChangeNotifierProvider(
            create: (_) => AuthState(ApiClient(baseUrl: 'http://localhost:1'))),
        ChangeNotifierProvider(create: (_) => I18n()),
      ],
      child: MaterialApp(theme: buildTheme(), home: const ForgotPasswordScreen()),
    );

void main() {
  testWidgets('empty submit shows a required error, no confirmation shown', (tester) async {
    await tester.pumpWidget(wrap());
    await tester.tap(find.text('Send reset link'));
    await tester.pump();
    expect(find.text('Enter your email or employee ID'), findsOneWidget);
    expect(find.byIcon(Icons.mark_email_read_outlined), findsNothing);
  });

  testWidgets('submitting an identifier always shows the same confirmation', (tester) async {
    await tester.pumpWidget(wrap());
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Employee no. or email'), 'anyone@example.com');
    await tester.tap(find.text('Send reset link'));
    await tester.pump(); // starts the request
    await tester.pump(); // NetworkException resolves synchronously against a closed port
    expect(find.byIcon(Icons.mark_email_read_outlined), findsOneWidget);
    expect(find.text('Send reset link'), findsNothing);
  });

  testWidgets('back-to-sign-in from the confirmation pops the screen', (tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
              create: (_) => AuthState(ApiClient(baseUrl: 'http://localhost:1'))),
          ChangeNotifierProvider(create: (_) => I18n()),
        ],
        child: MaterialApp(
          theme: buildTheme(),
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: ElevatedButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ForgotPasswordScreen()),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Employee no. or email'), 'anyone@example.com');
    await tester.tap(find.text('Send reset link'));
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('Back to sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Reset your password'), findsNothing);
    expect(find.text('open'), findsOneWidget);
  });
}
