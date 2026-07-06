// Category filter chips — the web board's vocabulary, toggled the same way.
// Shared by the employee queue and My Requests; each list passes its own
// counts from the unfiltered data. Categories only, never status keys
// (CLAUDE.md Section 9).
import 'package:flutter/material.dart';

import '../theme.dart';

class CategoryChips extends StatelessWidget {
  /// Category → item count, from the unfiltered list.
  final Map<String, int> counts;
  final String? selected;
  final void Function(String category) onToggle;

  const CategoryChips({
    super.key,
    required this.counts,
    required this.selected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final cats =
        kCategoryColors.keys.where((c) => (counts[c] ?? 0) > 0).toList();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final cat in cats) ...[
            _chip(cat, counts[cat]!),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }

  Widget _chip(String cat, int count) {
    final c = categoryColors(cat);
    final isSelected = selected == cat;
    return Material(
      color: isSelected ? c.tint : MfColors.bg,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(999),
        side: BorderSide(color: isSelected ? c.accent : MfColors.border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: () => onToggle(cat),
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
                '${cat.replaceAll('_', ' ')} · $count',
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
