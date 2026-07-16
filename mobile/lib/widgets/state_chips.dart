// State filter chips — open vs closed, the web board's Phase-4 vocabulary,
// toggled the same way. Shared by the employee queue and My Requests; each
// list passes its own counts from the unfiltered data. No status keys, no
// categories (CLAUDE.md §10 Phase 4).
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../i18n.dart';
import '../theme.dart';

class StateChips extends StatelessWidget {
  /// State ('open' | 'closed') → item count, from the unfiltered list.
  final Map<String, int> counts;
  final String? selected;
  final void Function(String state) onToggle;

  const StateChips({
    super.key,
    required this.counts,
    required this.selected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final i18n = context.watch<I18n>();
    final states = ['open', 'closed'].where((s) => (counts[s] ?? 0) > 0).toList();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final s in states) ...[
            _chip(i18n, s, counts[s]!),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }

  Widget _chip(I18n i18n, String state, int count) {
    final c = stateColors(state == 'closed');
    final isSelected = selected == state;
    return Material(
      color: isSelected ? c.tint : MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(999),
        side: BorderSide(color: isSelected ? c.accent : MfColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => onToggle(state),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
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
                '${i18n.tr('state_$state')} · $count',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: isSelected ? c.ink : MfColors.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
