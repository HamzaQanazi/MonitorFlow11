// Manual hours entry (Time Clock, mobile core). Lands with
// approvalStatus 'pending' — reviewed/approved on the web Timesheets tab
// (routes/timeclock.js PATCH/approve). Same validation shape as
// lib/timeClock.js's validateManualShift, so 422s land on the right field.
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../auth/auth_state.dart';
import '../i18n.dart';
import '../theme.dart';

class ManualHoursScreen extends StatefulWidget {
  const ManualHoursScreen({super.key});

  @override
  State<ManualHoursScreen> createState() => _ManualHoursScreenState();
}

class _ManualHoursScreenState extends State<ManualHoursScreen> {
  DateTime? _clockIn;
  DateTime? _clockOut;
  final _noteController = TextEditingController();
  Map<String, String> _errors = {};
  bool _submitting = false;

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _pick(bool isClockIn) async {
    final now = DateTime.now();
    final initial = (isClockIn ? _clockIn : _clockOut) ?? now;
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: now.subtract(const Duration(days: 90)),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null || !mounted) return;
    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isClockIn) {
        _clockIn = picked;
      } else {
        _clockOut = picked;
      }
    });
  }

  Future<void> _submit() async {
    final i18n = context.read<I18n>();
    setState(() => _errors = {});
    if (_clockIn == null || _clockOut == null) {
      setState(() => _errors = {
            if (_clockIn == null) 'clockInAt': i18n.tr('tc_err_required'),
            if (_clockOut == null) 'clockOutAt': i18n.tr('tc_err_required'),
          });
      return;
    }
    setState(() => _submitting = true);
    final api = context.read<AuthState>().api;
    try {
      await api.post('/timeclock/shifts/manual', body: {
        'clockInAt': _clockIn!.toUtc().toIso8601String(),
        'clockOutAt': _clockOut!.toUtc().toIso8601String(),
        if (_noteController.text.trim().isNotEmpty) 'note': _noteController.text.trim(),
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.fieldErrors.isNotEmpty) {
        setState(() => _errors = e.fieldErrors);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } on NetworkException {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(i18n.tr('net_retry'))));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    return Scaffold(
      appBar: AppBar(title: Text(i18n.tr('tc_manual_title'))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(i18n.tr('tc_manual_hint'), style: const TextStyle(color: MfColors.muted)),
          const SizedBox(height: 20),
          _DateTimeField(
            label: i18n.tr('tc_clock_in'),
            value: _clockIn,
            error: _errors['clockInAt'],
            onTap: () => _pick(true),
          ),
          const SizedBox(height: 16),
          _DateTimeField(
            label: i18n.tr('tc_clock_out'),
            value: _clockOut,
            error: _errors['clockOutAt'],
            onTap: () => _pick(false),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _noteController,
            maxLines: 3,
            decoration: InputDecoration(labelText: i18n.tr('tc_note_optional')),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _submitting ? null : _submit,
            child: Text(_submitting ? i18n.tr('tc_submitting') : i18n.tr('tc_submit_manual')),
          ),
        ],
      ),
    );
  }
}

class _DateTimeField extends StatelessWidget {
  final String label;
  final DateTime? value;
  final String? error;
  final VoidCallback onTap;

  const _DateTimeField({
    required this.label,
    required this.value,
    this.error,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          errorText: error,
          suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20),
        ),
        child: Text(value == null ? '—' : DateFormat.yMMMd().add_jm().format(value!)),
      ),
    );
  }
}
