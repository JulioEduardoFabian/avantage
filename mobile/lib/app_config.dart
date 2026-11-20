/// Configuración de la app, toda por `--dart-define` y nada escrita a mano en
/// el código: la misma compilación tiene que poder apuntar al servidor de
/// pruebas y al de producción, y una URL hardcodeada obliga a recompilar (y a
/// acordarse de volver a cambiarla antes de publicar).
///
/// Ejemplo:
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.50:3000
library;

class AppConfig {
  /// A qué backend se conecta la app.
  ///
  /// El valor por defecto es `10.0.2.2`, que es cómo el emulador de Android ve
  /// el `localhost` de la máquina que lo hospeda: con `localhost` a secas, la
  /// app busca el servidor DENTRO del emulador y falla con un "connection
  /// refused" que parece un problema del backend.
  ///
  /// En un teléfono de verdad hay que poner la IP de la máquina en la red
  /// local (`http://192.168.x.x:3000`) o la URL pública del panel.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Cada cuánto vuelve a preguntar por notificaciones nuevas cuando trabaja
  /// por sondeo (Windows, Linux, o cualquier plataforma sin Firebase
  /// configurado). 45 s y no 5: son 30 filas por consulta y el sondeo existe
  /// para no perderse un aviso, no para ser un push.
  static const Duration pollInterval = Duration(
    seconds: int.fromEnvironment('POLL_SECONDS', defaultValue: 45),
  );

  /// La clave VAPID del par de claves web de Firebase (Configuración del
  /// proyecto → Cloud Messaging → "Certificados push web"). **Solo la web la
  /// necesita**: sin ella, `getToken()` en el navegador falla y esa plataforma
  /// se queda sin push aunque todo lo demás esté bien.
  static const String webVapidKey = String.fromEnvironment('FIREBASE_VAPID_KEY');

  /// El canal de notificaciones de Android. Tiene que ser EL MISMO que manda
  /// el backend en `pushService.ANDROID_CHANNEL_ID`: si no coinciden, Android
  /// cae al canal por defecto y el aviso sale sin sonido y sin poder despertar
  /// la pantalla.
  static const String androidChannelId = 'avantage_avisos';
  static const String androidChannelName = 'Avisos del panel';
  static const String androidChannelDescription =
      'Reuniones agendadas, pagos verificados, proyectos nuevos y avisos del bot de WhatsApp.';
}
