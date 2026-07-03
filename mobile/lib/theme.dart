// MonitorFlow design tokens — sRGB conversions of web/src/styles/tokens.css
// (OKLCH source of truth). The status-category palette is the one fixed
// assignment shared by all three apps (DESIGN.md: Status-Owns-Color) — never
// color alone, always paired with the label text.
import 'package:flutter/material.dart';

abstract final class MfColors {
  // Brand — Workwear Amber
  static const amber500 = Color(0xFFD5761D); // decorative only, never text-bearing
  static const amber600 = Color(0xFFAE5C01); // primary fill; white text
  static const amber700 = Color(0xFF974D00); // pressed fill

  // Neutrals — pure surface; warmth lives in the brand, not the bg
  static const bg = Color(0xFFFFFFFF);
  static const surface = Color(0xFFF5F5F5);
  static const ink = Color(0xFF1A1816);
  static const muted = Color(0xFF595451);
  static const border = Color(0xFFDCDAD9);
  static const borderStrong = Color(0xFFA8A4A1);

  // Semantic
  static const error = Color(0xFFB7191C);
  static const errorBg = Color(0xFFFFF2F0);
  static const errorBorder = Color(0xFFF3C0B9);
}

/// Accent / ink / tint triple for one workflow status category.
class CategoryColors {
  final Color accent;
  final Color ink;
  final Color tint;
  const CategoryColors(this.accent, this.ink, this.tint);
}

/// The fixed six-category assignment (keys are Section 9 categories).
/// Unknown categories fall back to `closed`'s neutral — never crash.
const Map<String, CategoryColors> kCategoryColors = {
  'new': CategoryColors(Color(0xFF2A75BA), Color(0xFF124A7B), Color(0xFFE8F3FF)),
  'triage': CategoryColors(Color(0xFF7F5BB6), Color(0xFF523779), Color(0xFFF4EFFE)),
  'in_progress': CategoryColors(Color(0xFF008388), Color(0xFF004D51), Color(0xFFE3F6F7)),
  'done': CategoryColors(Color(0xFF33854A), Color(0xFF1D4E2B), Color(0xFFE7F7E9)),
  'closed': CategoryColors(Color(0xFF5B646F), Color(0xFF3C434A), Color(0xFFEEF0F3)),
  'terminated': CategoryColors(Color(0xFF785C52), Color(0xFF56423C), Color(0xFFF5EEEC)),
};

CategoryColors categoryColors(String category) =>
    kCategoryColors[category] ?? kCategoryColors['closed']!;

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: MfColors.amber600,
      primary: MfColors.amber600,
      onPrimary: Colors.white,
      error: MfColors.error,
      surface: MfColors.bg,
      onSurface: MfColors.ink,
    ),
    scaffoldBackgroundColor: MfColors.bg,
  );

  const radius = BorderRadius.all(Radius.circular(10));
  OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
      OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: color, width: width));

  return base.copyWith(
    textTheme: base.textTheme.apply(bodyColor: MfColors.ink, displayColor: MfColors.ink),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: MfColors.bg,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: inputBorder(MfColors.border),
      enabledBorder: inputBorder(MfColors.border),
      focusedBorder: inputBorder(MfColors.amber600, 2),
      errorBorder: inputBorder(MfColors.error),
      focusedErrorBorder: inputBorder(MfColors.error, 2),
      labelStyle: const TextStyle(color: MfColors.muted),
      hintStyle: const TextStyle(color: MfColors.muted),
      errorStyle: const TextStyle(color: MfColors.error),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: MfColors.amber600,
        foregroundColor: Colors.white,
        disabledBackgroundColor: MfColors.border,
        disabledForegroundColor: MfColors.muted,
        elevation: 0,
        minimumSize: const Size.fromHeight(52), // thumb-friendly field target
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: MfColors.amber600),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: MfColors.bg,
      foregroundColor: MfColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
    ),
    dividerTheme: const DividerThemeData(color: MfColors.border, space: 1, thickness: 1),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
