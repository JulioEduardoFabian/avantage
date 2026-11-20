import 'package:flutter/material.dart';

/// La paleta del panel, para que la app se vea como el mismo producto: crema
/// cálido, olivo y terracota (los tokens `--bg-dark`, `--primary` y `--cta` de
/// `src/style.css`).
class Brand {
  static const olive = Color(0xFF6F8125);
  static const oliveDark = Color(0xFF56621D);
  static const terracotta = Color(0xFFC85532);
  static const cream = Color(0xFFF2F3E8);
  static const creamAlt = Color(0xFFE8EBDC);
  static const border = Color(0xFFD9DCC9);
  static const ink = Color(0xFF101414);
  static const inkMuted = Color(0xFF626A62);
  static const emerald = Color(0xFF2E7D46);

  // Modo oscuro: los dos acentos tienen su propio paso, igual que la guía de
  // visualización del panel exige para los colores de serie — el olivo del
  // tema claro sobre un fondo oscuro no llega al contraste mínimo.
  static const oliveOnDark = Color(0xFF9AA68A);
  static const terracottaOnDark = Color(0xFFD98A63);
  static const inkDark = Color(0xFF10140F);
  static const cardDark = Color(0xFF1A1E17);
}

ThemeData buildLightTheme() => _theme(
  ColorScheme.fromSeed(
    seedColor: Brand.olive,
    brightness: Brightness.light,
  ).copyWith(
    primary: Brand.olive,
    secondary: Brand.terracotta,
    surface: Colors.white,
    onSurface: Brand.ink,
  ),
  scaffold: Brand.cream,
  divider: Brand.border,
);

ThemeData buildDarkTheme() => _theme(
  ColorScheme.fromSeed(
    seedColor: Brand.olive,
    brightness: Brightness.dark,
  ).copyWith(
    primary: Brand.oliveOnDark,
    secondary: Brand.terracottaOnDark,
    surface: Brand.cardDark,
  ),
  scaffold: Brand.inkDark,
  divider: const Color(0xFF2C3327),
);

ThemeData _theme(ColorScheme scheme, {required Color scaffold, required Color divider}) {
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: scaffold,
    dividerColor: divider,
    appBarTheme: AppBarTheme(
      backgroundColor: scaffold,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleLarge?.copyWith(
        fontWeight: FontWeight.w700,
        color: scheme.onSurface,
      ),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: divider),
      ),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: divider),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: divider),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.primary, width: 1.6),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
