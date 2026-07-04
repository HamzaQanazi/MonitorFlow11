// Profile (shared Section 4 cross-app component). Edit name/phone via
// PATCH /users/me; change password via PATCH /users/me/password (current
// password required, per-field 422). Email and role are immutable.
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
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
        const SnackBar(content: Text('Profile updated')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _profileErrors = e.fieldErrors.isNotEmpty
          ? e.fieldErrors
          : {'name': e.message});
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not reach the server — try again.')),
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
        const SnackBar(content: Text('Password changed')),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _passwordErrors = e.fieldErrors.isNotEmpty
          ? e.fieldErrors
          : {'currentPassword': e.message});
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not reach the server — try again.')),
      );
    } finally {
      if (mounted) setState(() => _savingPassword = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthState>().user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
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
                        Text(user?.email ?? '',
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
            const SizedBox(height: 24),
            const Text('Details',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              decoration: InputDecoration(
                labelText: 'Full name',
                errorText: _profileErrors['name'],
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(
                labelText: 'Phone',
                errorText: _profileErrors['phone'],
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _savingProfile ? null : _saveProfile,
              child: const Text('Save details'),
            ),
            const SizedBox(height: 32),
            const Text('Change password',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            TextField(
              controller: _current,
              obscureText: true,
              decoration: InputDecoration(
                labelText: 'Current password',
                errorText: _passwordErrors['currentPassword'],
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _newPassword,
              obscureText: true,
              decoration: InputDecoration(
                labelText: 'New password (min 8 characters)',
                errorText: _passwordErrors['newPassword'],
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _savingPassword ? null : _changePassword,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              child: const Text('Change password'),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
