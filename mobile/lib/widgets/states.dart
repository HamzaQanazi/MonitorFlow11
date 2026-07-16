// Shared list/page states — every list gets designed loading, empty and
// error states (CLAUDE.md Section 4 UI-state rule), plus the status pill:
// the one state color-and-shape language used everywhere, always with
// its label text (DESIGN.md: Status-Owns-Color).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../i18n.dart';
import '../models/request.dart';
import '../theme.dart';

// relativeTime lives on I18n now (it needs the locale for its suffixes).

class StatusPill extends StatelessWidget {
  final StatusInfo status;

  const StatusPill({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final c = stateColors(status.isTerminal);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: c.tint,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(
            i18n.l(status.label),
            style: TextStyle(color: c.ink, fontSize: 13, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class LoadingState extends StatelessWidget {
  const LoadingState({super.key});

  @override
  Widget build(BuildContext context) =>
      const Center(child: CircularProgressIndicator(color: MfColors.amber600));
}

class ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const ErrorState({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 44, color: MfColors.muted),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center,
                style: const TextStyle(color: MfColors.muted)),
            const SizedBox(height: 16),
            OutlinedButton(
                onPressed: onRetry,
                child: Text(context.watch<I18n>().tr('try_again'))),
          ],
        ),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: MfColors.borderStrong),
            const SizedBox(height: 12),
            Text(title,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(subtitle!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: MfColors.muted)),
            ],
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}
