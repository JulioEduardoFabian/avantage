import 'dart:math';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Quién es este aparato: su plataforma, un nombre que una persona reconozca y
/// —solo cuando trabaja por sondeo— un identificador propio y estable.
class DeviceIdentity {
  const DeviceIdentity({
    required this.platform,
    required this.label,
    required this.appVersion,
    required this.pollingId,
  });

  /// El valor que espera `DEVICE_PLATFORMS` del backend.
  final String platform;

  /// "Redmi Note 12", "DESKTOP-J4K1", "Chrome". Es texto libre: no se decide
  /// nada con él, sirve para que en la pantalla de dispositivos se reconozca
  /// cuál es cuál.
  final String label;
  final String appVersion;

  /// El identificador que se registra en el backend cuando NO hay token de
  /// Firebase (Windows, Linux, o cualquier plataforma sin credenciales).
  ///
  /// Se guarda en el dispositivo y se reusa: generado en cada arranque, el
  /// backend acumularía una fila por vez que alguien abre la app, y la lista de
  /// dispositivos dejaría de significar nada.
  final String pollingId;

  static const _pollingIdKey = 'avantage.device.pollingId';

  static Future<DeviceIdentity> resolve() async {
    final prefs = await SharedPreferences.getInstance();
    var pollingId = prefs.getString(_pollingIdKey);
    if (pollingId == null || pollingId.isEmpty) {
      pollingId = 'poll_${_randomHex(16)}';
      await prefs.setString(_pollingIdKey, pollingId);
    }

    return DeviceIdentity(
      platform: _platformName(),
      label: await _deviceLabel(),
      appVersion: await _appVersion(),
      pollingId: pollingId,
    );
  }

  static String _platformName() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.linux:
        return 'linux';
      default:
        return 'web';
    }
  }

  /// Se lee del mapa crudo (`info.data`) y no de los campos tipados de cada
  /// plataforma: son seis plataformas y un nombre para mostrar no justifica un
  /// `switch` que hay que tocar cada vez que el plugin cambia una clase. Si
  /// ninguna clave está, queda el nombre de la plataforma — un nombre feo es
  /// mejor que una excepción al arrancar.
  static Future<String> _deviceLabel() async {
    try {
      final data = (await DeviceInfoPlugin().deviceInfo).data;
      for (final key in ['model', 'computerName', 'name', 'prettyName', 'browserName', 'utsname']) {
        final value = data[key];
        if (value is String && value.trim().isNotEmpty) return value.trim();
        if (value is Map && value['machine'] is String) return value['machine'] as String;
      }
    } catch (_) {
      // Un plugin que falla no puede impedir registrar el dispositivo.
    }
    return _platformName();
  }

  static Future<String> _appVersion() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return '${info.version}+${info.buildNumber}';
    } catch (_) {
      return 'desconocida';
    }
  }

  static String _randomHex(int bytes) {
    final random = Random.secure();
    return List.generate(bytes, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
