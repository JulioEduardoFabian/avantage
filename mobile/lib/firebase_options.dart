import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show TargetPlatform, defaultTargetPlatform, kIsWeb;

/// Las credenciales del proyecto de Firebase, por `--dart-define`.
///
/// **Este archivo es compatible con el que genera `flutterfire configure`** (la
/// misma clase, el mismo `currentPlatform`), así que si algún día se corre esa
/// herramienta y lo sobrescribe, la app sigue compilando sin tocar nada más.
/// Mientras tanto los valores se pasan al compilar, que es lo que permite que
/// el repo no lleve adentro las claves de un proyecto de Firebase.
///
/// Los valores salen de la consola de Firebase → Configuración del proyecto →
/// "Tus apps". Son **identificadores públicos** (viajan dentro del binario de
/// cualquier app de Firebase, no son secretos); el secreto es la cuenta de
/// servicio, y esa vive en el `.env` del backend y nunca en la app.
///
/// Si faltan, `currentPlatform` lanza `UnsupportedError` —igual que el archivo
/// generado cuando una plataforma no está configurada— y el arranque de la app
/// lo captura y se pasa al sondeo. O sea: **la app funciona sin Firebase**, con
/// avisos mientras esté abierta, y gana el push de verdad cuando se le pegan
/// estos valores. Que no esté configurado no puede ser una pantalla en blanco.
class DefaultFirebaseOptions {
  static const String _apiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const String _appIdAndroid = String.fromEnvironment('FIREBASE_APP_ID_ANDROID');
  static const String _appIdIos = String.fromEnvironment('FIREBASE_APP_ID_IOS');
  static const String _appIdWeb = String.fromEnvironment('FIREBASE_APP_ID_WEB');
  static const String _messagingSenderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const String _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const String _storageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');
  static const String _authDomain = String.fromEnvironment('FIREBASE_AUTH_DOMAIN');
  static const String _iosBundleId = String.fromEnvironment(
    'FIREBASE_IOS_BUNDLE_ID',
    defaultValue: 'pe.avantage.avantageAvisos',
  );

  /// Si esta plataforma puede recibir push de Firebase.
  ///
  /// Dos cosas distintas se preguntan acá: que haya credenciales, y que la
  /// plataforma tenga FCM. **Firebase Cloud Messaging no existe en Windows ni
  /// en Linux** —no es que falte configurarlo, es que el SDK no los soporta—,
  /// así que esas dos trabajan siempre por sondeo.
  static bool get isSupportedPlatform {
    if (kIsWeb) return true;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS;
  }

  static bool get isConfigured {
    if (!isSupportedPlatform) return false;
    if (_apiKey.isEmpty || _projectId.isEmpty || _messagingSenderId.isEmpty) return false;
    return _appIdFor().isNotEmpty;
  }

  static String _appIdFor() {
    if (kIsWeb) return _appIdWeb;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return _appIdAndroid;
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        return _appIdIos;
      default:
        return '';
    }
  }

  static FirebaseOptions get currentPlatform {
    if (!isSupportedPlatform) {
      throw UnsupportedError(
        'Firebase Cloud Messaging no soporta esta plataforma. La app trabaja por sondeo acá.',
      );
    }
    if (!isConfigured) {
      throw UnsupportedError(
        'Faltan las credenciales de Firebase. Pasalas con --dart-define '
        '(FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_SENDER_ID y el '
        'FIREBASE_APP_ID_* de esta plataforma) o corré `flutterfire configure`.',
      );
    }
    return FirebaseOptions(
      apiKey: _apiKey,
      appId: _appIdFor(),
      messagingSenderId: _messagingSenderId,
      projectId: _projectId,
      storageBucket: _storageBucket.isEmpty ? null : _storageBucket,
      authDomain: _authDomain.isEmpty ? null : _authDomain,
      iosBundleId: _iosBundleId,
    );
  }
}
