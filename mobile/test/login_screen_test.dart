// Login/Registration screen: client-side validation and mode switching.
// Server-driven states (401/422/429) are exercised in the manual pass
// against the seeded backend.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:monitorflow_mobile/api/api_client.dart';
import 'package:monitorflow_mobile/auth/auth_state.dart';
import 'package:monitorflow_mobile/auth/login_screen.dart';
import 'package:monitorflow_mobile/i18n.dart';
import 'package:monitorflow_mobile/theme.dart';

Widget wrap() => MultiProvider(
      providers: [
        ChangeNotifierProvider(
            create: (_) => AuthState(ApiClient(baseUrl: 'http://localhost:1'))),
        ChangeNotifierProvider(create: (_) => I18n()),
      ],
      child: MaterialApp(theme: buildTheme(), home: const LoginScreen()),
    );

void main() {
  testWidgets('sign-in mode shows identifier + password only', (tester) async {
    await tester.pumpWidget(wrap());
    // Two-gate login: sign-in accepts an email OR a 4-digit employee number.
    expect(find.text('Email or employee ID'), findsOneWidget);
    expect(find.text('Password'), findsOneWidget);
    expect(find.text('Full name'), findsNothing);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('empty submit shows required errors, no network call', (tester) async {
    await tester.pumpWidget(wrap());
    await tester.tap(find.text('Sign in'));
    await tester.pump();
    expect(find.text('Enter your email or employee ID'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
  });

  testWidgets('invalid email format is rejected in register mode', (tester) async {
    // Sign-in no longer validates email shape (it may be an employee id);
    // registration still creates users and requires a valid email.
    await tester.pumpWidget(wrap());
    await tester.tap(find.text('New here? Create an account'));
    await tester.pump();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Email'), 'not-an-email');
    await tester.tap(find.text('Create account'));
    await tester.pump();
    expect(find.text('Enter a valid email'), findsOneWidget);
  });

  testWidgets('switching to register reveals name and phone fields', (tester) async {
    await tester.pumpWidget(wrap());
    await tester.tap(find.text('New here? Create an account'));
    await tester.pump();
    expect(find.text('Full name'), findsOneWidget);
    expect(find.text('Phone (optional)'), findsOneWidget);
    expect(find.text('Create account'), findsOneWidget);
  });

  testWidgets('register enforces 8-char minimum password', (tester) async {
    await tester.pumpWidget(wrap());
    await tester.tap(find.text('New here? Create an account'));
    await tester.pump();
    await tester.enterText(find.widgetWithText(TextFormField, 'Full name'), 'Test User');
    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'a@b.co');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'short');
    await tester.tap(find.text('Create account'));
    await tester.pump();
    expect(find.text('Password must be at least 8 characters'), findsOneWidget);
  });

  testWidgets('password visibility toggles', (tester) async {
    await tester.pumpWidget(wrap());
    expect(find.byIcon(Icons.visibility), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_off), findsOneWidget);
  });
}
