import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../app_config.dart';

/// Quien DIBUJA el aviso en el sistema operativo.
///
/// Hace falta incluso teniendo FCM, y por dos motivos que no son obvios:
///
///  1. **Con la app en primer plano, Android no muestra nada.** El bloque
///     `notification` del push solo lo pinta el sistema cuando la app está en
///     segundo plano o cerrada; en primer plano llega por `onMessage` y si
///     nadie lo dibuja, el aviso simplemente no existe para quien está mirando
///     la pantalla.
///  2. **En Windows y Linux no hay FCM.** Ahí el único camino es el sondeo, y
///     el sondeo necesita algo que muestre lo que encontró.
///
/// En **web** es un no-op a propósito: `flutter_local_notifications` no soporta
/// el navegador, y ahí el aviso lo pinta el service worker de Firebase.
class LocalNotifier {
  LocalNotifier._();
  static final LocalNotifier instance = LocalNotifier._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Lo que se ejecuta al tocar el aviso. Lo pone el estado de la app, que es
  /// el que sabe a qué pantalla llevar.
  void Function(String? payload)? onTap;

  Future<void> init() async {
    if (_ready || kIsWeb) {
      _ready = true;
      return;
    }

    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      // Los permisos NO se piden acá: los pide `PushGateway` junto con los de
      // Firebase, para que al abrir la app no salgan dos diálogos seguidos
      // preguntando lo mismo.
      iOS: DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
      macOS: DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      ),
      linux: LinuxInitializationSettings(defaultActionName: 'Abrir'),
      windows: WindowsInitializationSettings(
        appName: 'Avisos Avantage',
        appUserModelId: 'Avantage.Avisos',
        // El GUID identifica el callback de activación del aviso en Windows.
        // Es fijo y propio de esta app: si cambia, los avisos que ya están en
        // el centro de notificaciones dejan de poder abrirla.
        guid: '0d5c6f2e-9a44-4f1e-8d1a-2b7f3c6e91aa',
      ),
    );

    await _plugin.initialize(
      settings: settings,
      onDidReceiveNotificationResponse: (response) => onTap?.call(response.payload),
    );

    // El canal se crea a mano y no se deja que lo cree el primer aviso: en
    // Android el sonido, la vibración y la importancia de un canal quedan
    // CONGELADOS la primera vez, y no se pueden cambiar después sin
    // desinstalar la app. Si el primer aviso lo crea Android solo (porque el
    // `channel_id` del push no existía todavía), queda con importancia por
    // defecto y nunca más suena.
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            AppConfig.androidChannelId,
            AppConfig.androidChannelName,
            description: AppConfig.androidChannelDescription,
            importance: Importance.high,
          ),
        );

    _ready = true;
  }

  /// Pide el permiso de notificaciones donde hace falta pedirlo aparte:
  /// Android 13+ (`POST_NOTIFICATIONS`) y las dos plataformas Darwin.
  ///
  /// Devuelve `false` solo cuando la persona dijo que no: eso se muestra en
  /// pantalla, porque es la causa más común de "la app no me avisa" y no se
  /// arregla desde la app sino desde los ajustes del sistema.
  Future<bool> requestPermission() async {
    if (kIsWeb) return true;
    if (defaultTargetPlatform == TargetPlatform.android) {
      final granted = await _plugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.requestNotificationsPermission();
      return granted ?? true;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      final granted = await _plugin
          .resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
      return granted ?? true;
    }
    if (defaultTargetPlatform == TargetPlatform.macOS) {
      final granted = await _plugin
          .resolvePlatformSpecificImplementation<MacOSFlutterLocalNotificationsPlugin>()
          ?.requestPermissions(alert: true, badge: true, sound: true);
      return granted ?? true;
    }
    return true;
  }

  /// Muestra un aviso.
  ///
  /// El `id` es el de la notificación del panel, no un contador: así el mismo
  /// aviso llegado dos veces (el push y el sondeo que lo encuentra después)
  /// REEMPLAZA al anterior en vez de apilarse. Sin eso, una conexión que se
  /// recupera deja la barra con diez copias del mismo aviso.
  Future<void> show({
    required int id,
    required String title,
    String? body,
    String? payload,
    String? threadTag,
  }) async {
    if (kIsWeb) return;
    if (!_ready) await init();

    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        AppConfig.androidChannelId,
        AppConfig.androidChannelName,
        channelDescription: AppConfig.androidChannelDescription,
        importance: Importance.high,
        priority: Priority.high,
        // Agrupa por tipo de aviso: veinte del bot de WhatsApp no pueden tapar
        // el pago que se acaba de verificar.
        groupKey: threadTag,
        // El cuerpo de un aviso del panel puede ser una línea larga ("Rafael
        // Gonzales · Tesis de ingeniería · vence el 20 nov"); sin esto Android
        // lo corta y deja fuera justo el dato del final.
        styleInformation: body == null ? null : BigTextStyleInformation(body),
      ),
      iOS: DarwinNotificationDetails(threadIdentifier: threadTag),
      macOS: DarwinNotificationDetails(threadIdentifier: threadTag),
      linux: const LinuxNotificationDetails(urgency: LinuxNotificationUrgency.normal),
      windows: const WindowsNotificationDetails(),
    );

    await _plugin.show(id: id, title: title, body: body, notificationDetails: details, payload: payload);
  }
}
