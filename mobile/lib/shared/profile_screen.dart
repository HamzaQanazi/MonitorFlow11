// Profile (shared Section 4 cross-app component). Edit name/phone via
// PATCH /users/me; change password via PATCH /users/me/password (current
// password required, per-field 422). Email and role are immutable. Also
// hosts the app's language toggle (Phase 3).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../theme.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  final _current = TextEditingController();
  final _newPassword = TextEditingController();

  bool _savingProfile = false;
  bool _savingPassword = false;
  Map<String, String> _profileErrors = const {};
  Map<String, String> _passwordErrors = const {};

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthState>().user;
    _name = TextEditingController(text: user?.name ?? '');
    _phone = TextEditingController(text: user?.phone ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _current.dispose();
    _newPassword.dispose();
    super.dispose();
  }

  Future<void> _saveProfile() async {
    setState(() {
      _profileErrors = const {};
      _savingProfile = true;
    });
    final api = context.read<AuthState>().api;
    try {
      await api.patch('/users/me', body: {
        'name': _name.text.trim(),
        'phone': _phone.text.trim(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('profile_updated'))),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _profileErrors = e.fieldErrors.isNotEmpty
          ? e.fieldErrors
          : {'name': e.message});
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('net_retry'))),
      );
    } finally {
      if (mounted) setState(() => _savingProfile = false);
    }
  }

  Future<void> _changePassword() async {
    setState(() {
      _passwordErrors = const {};
      _savingPassword = true;
    });
    final api = context.read<AuthState>().api;
    try {
      await api.patch('/users/me/password', body: {
        'currentPassword': _current.text,
        'newPassword': _newPassword.text,
      });
      if (!mounted) return;
      _current.clear();
      _newPassword.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('profile_password_changed'))),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _passwordErrors = e.fieldErrors.isNotEmpty
          ? e.fieldErrors
          : {'currentPassword': e.message});
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.read<I18n>().tr('net_retry'))),
      );
    } finally {
      if (mounted) setState(() => _savingPassword = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final user = context.watch<AuthState>().user;
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('profile'))),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Immutable identity
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: MfColors.surface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  const Icon(Icons.account_circle_outlined,
                      size: 36, color: MfColors.muted),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.email ?? user?.loginIdentifier ?? '',
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(user?.role ?? '',
                            style: const TextStyle(
                                color: MfColors.muted, fontSize: 13)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            // Language toggle
            Row(
              children: [
                const Icon(Icons.translate, size: 20, color: MfColors.muted),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(i18n.tr('profile_language'),
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                OutlinedButton(
                  onPressed: () => i18n.toggle(),
                  child: Text(i18n.tr('lang_toggle')),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Text(i18n.tr('profile_details'),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              decoration: InputDecoration(
                labelText: i18n.tr('login_full_name'),
                errorText: _profileErrors['name'],
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: i18n.tr('profile_phone'),
                errorText: _profileErrors['phone'],
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _savingProfile ? null : _saveProfile,
              child: Text(i18n.tr('profile_save')),
            ),
            const SizedBox(height: 32),
            Text(i18n.tr('profile_change_password'),
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            TextField(
              controller: _current,
              obscureText: true,
              decoration: InputDecoration(
                labelText: i18n.tr('profile_current_password'),
                errorText: _passwordErrors['currentPassword'],
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _newPassword,
              obscureText: true,
              decoration: InputDecoration(
                labelText: i18n.tr('profile_new_password'),
                errorText: _passwordErrors['newPassword'],
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _savingPassword ? null : _changePassword,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: Text(i18n.tr('profile_change_password')),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
