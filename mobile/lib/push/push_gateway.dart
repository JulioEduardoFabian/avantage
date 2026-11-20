import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app_config.dart';
import '../data/repositories.dart';
import '../firebase_options.dart';
import '../models/app_notification.dart';
import 'device_identity.dart';
import 'local_notifier.dart';

/// Por dónde le llegan los avisos a ESTE dispositivo.
enum PushTransport {
  /// Push de verdad: el servidor empuja y el aviso llega con la app cerrada.
  fcm,

  /// Sondeo: la app pregunta cada tanto mientras está abierta. Es el único
  /// camino en Windows y en Linux, donde Firebase Cloud Messaging no existe.
  polling,
}

/// En qué estado quedó el push, para que la pantalla de diagnóstico pueda
/// explicarlo en vez de que la app simplemente no avise.
class PushState {
  const PushState({
    required this.transport,
    required this.permissionGranted,
    this.reason,
    this.serverConfigured,
    this.token,
  });

  final PushTransport transport;
  final bool permissionGranted;

  /// Por qué quedó en sondeo, cuando quedó en sondeo. Es lo único que
  /// distingue "falta configurar Firebase" de "esta plataforma no lo soporta",
  /// y las dos se arreglan distinto (o no se arreglan).
  final String? reason;
  final bool? serverConfigured;
  final String? token;

  bool get isPush => transport == PushTransport.fcm;
}

/// El handler de segundo plano **tiene que ser una función de nivel superior**
/// y llevar `@pragma('vm:entry-point')`: corre en un isolate propio que el
/// sistema levanta de cero, así que no ve nada del estado de la app, y sin la
/// anotación el compilador lo elimina al generar el release — con lo cual en
/// debug funciona y en producción no, que es el peor de los dos mundos.
///
/// No dibuja nada a propósito: los avisos que manda el backend llevan el bloque
/// `notification`, así que con la app en segundo plano o cerrada **el sistema
/// operativo ya los muestra solo**. Pintar acá otro sería mostrar cada aviso
/// dos veces.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

/// Enciende el camino por el que llegan los avisos y lo mantiene.
///
/// La decisión central: **la app no depende de que Firebase esté configurado.**
/// Si lo está y la plataforma lo soporta, va por push; si no, se pasa al sondeo
/// y lo dice. Una app de notificaciones que muestra una pantalla de error
/// porque falta una credencial es una app que no sirve para nada hasta que
/// alguien entre a la consola de Firebase.
class PushGateway {
  PushGateway({
    required DevicesRepository devices,
    required NotificationsRepository notifications,
  })  : _devices = devices,
        _notifications = notifications;

  final DevicesRepository _devices;
  final NotificationsRepository _notifications;

  static const _lastSeenKey = 'avantage.notifications.lastSeenId';

  DeviceIdentity? _identity;
  Timer? _pollTimer;
  StreamSubscription<String>? _tokenRefresh;
  StreamSubscription<RemoteMessage>? _onMessage;
  StreamSubscription<RemoteMessage>? _onOpened;

  PushState _state = const PushState(transport: PushTransport.polling, permissionGranted: false);
  PushState get state => _state;

  /// Qué token tiene registrado en el backend ahora mismo: el de Firebase, o
  /// el identificador propio del dispositivo cuando trabaja por sondeo.
  String? _registeredToken;

  /// Se llama cuando llegó algo nuevo, para que la lista en pantalla se
  /// refresque sin que la persona tenga que tirar hacia abajo.
  void Function()? onRefreshNeeded;

  /// Se llama cuando alguien TOCA un aviso, con el `link` del panel adentro.
  void Function(Map<String, String> data)? onOpened;

  // ───────────────────────────── Arranque ──────────────────────────────────

  Future<PushState> start() async {
    _identity ??= await DeviceIdentity.resolve();
    await LocalNotifier.instance.init();
    LocalNotifier.instance.onTap = (payload) {
      if (payload != null && payload.isNotEmpty) onOpened?.call({'link': payload});
    };

    final permissionGranted = await LocalNotifier.instance.requestPermission();

    // Qué dice el servidor. Si no tiene credenciales, registrar un token de
    // Firebase sería guardar una dirección a la que nadie va a escribir: mejor
    // sondear y decirlo.
    bool? serverConfigured;
    try {
      serverConfigured = (await _devices.status()).configured;
    } catch (_) {
      // Que no se pueda preguntar no es motivo para no intentar el push: el
      // estado es informativo, no la condición.
      serverConfigured = null;
    }

    if (!DefaultFirebaseOptions.isSupportedPlatform) {
      return _startPolling(
        permissionGranted: permissionGranted,
        serverConfigured: serverConfigured,
        reason: 'Firebase Cloud Messaging no existe en esta plataforma: los avisos llegan '
            'mientras la app esté abierta.',
      );
    }
    if (!DefaultFirebaseOptions.isConfigured) {
      return _startPolling(
        permissionGranted: permissionGranted,
        serverConfigured: serverConfigured,
        reason: 'Faltan las credenciales de Firebase en la app (ver el README de mobile/). '
            'Los avisos llegan mientras la app esté abierta.',
      );
    }

    try {
      return await _startFcm(permissionGranted: permissionGranted, serverConfigured: serverConfigured);
    } catch (error) {
      // Credenciales mal pegadas, google-services.json que no corresponde,
      // Google Play Services ausente en el emulador: todo eso termina acá, y
      // en los tres casos el sondeo es mejor que nada.
      return _startPolling(
        permissionGranted: permissionGranted,
        serverConfigured: serverConfigured,
        reason: 'Firebase no pudo arrancar ($error). Los avisos llegan mientras la app esté abierta.',
      );
    }
  }

  // ─────────────────────────────── FCM ─────────────────────────────────────

  Future<PushState> _startFcm({required bool permissionGranted, bool? serverConfigured}) async {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);

    final messaging = FirebaseMessaging.instance;
    // En iOS y macOS el permiso de Firebase es el que de verdad habilita el
    // push (en Android el que vale es el del sistema, que ya se pidió arriba).
    final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
    final granted = settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;

    // En web, `getToken` SIN la clave VAPID falla: es el fallo más común de
    // esa plataforma y no dice nada sobre lo que falta.
    //
    // `getToken`/`onTokenRefresh` están marcados como obsoletos en
    // firebase_messaging 17 a favor de `register()`/`onRegistered`, y NO se
    // migran a propósito: lo que `onRegistered` emite es el **Firebase
    // Installation ID** (se ve en el nativo: `registeredObserver = fid -> ...`),
    // y el backend manda por FCM HTTP v1 con `message.token`, que exige un
    // **token de registro**. Cambiarlo haría que el registro "funcione", que el
    // envío devuelva un 400 por token inválido y que el barrido dé de baja el
    // dispositivo — sin que nada falle a la vista en la app. Se migra el día que
    // el backend pase a un campo que acepte el FID.
    // ignore: deprecated_member_use
    final token = await messaging.getToken(
      vapidKey: kIsWeb && AppConfig.webVapidKey.isNotEmpty ? AppConfig.webVapidKey : null,
    );
    if (token == null || token.isEmpty) {
      throw StateError('Firebase no devolvió un token para este dispositivo');
    }

    await _register(token: token, transport: 'fcm');

    // Este aparato pudo haber estado registrado por sondeo (una instalación
    // anterior sin credenciales de Firebase, o un arranque en el que Firebase
    // falló). Su fila se da de baja: el mismo teléfono en dos filas —una
    // 'fcm' y una 'polling'— hace que la pantalla de dispositivos muestre dos
    // aparatos donde hay uno, y esa pantalla existe justamente para
    // diagnosticar. El id de sondeo es estable por instalación, así que se sabe
    // exactamente cuál quitar. Al revés NO se hace: si el push falla y se cae
    // al sondeo, el token de FCM sigue siendo válido y darlo de baja perdería
    // el push por un fallo que puede ser de este arranque solamente.
    await _unregisterQuietly(_identity!.pollingId);

    // El token ROTA (reinstalación, restauración de copia de seguridad, limpieza
    // de datos). Sin esto, el backend se queda con el viejo y a ese dispositivo
    // deja de llegarle todo, sin que nada falle a la vista.
    // ignore: deprecated_member_use
    _tokenRefresh = messaging.onTokenRefresh.listen((fresh) {
      _register(token: fresh, transport: 'fcm');
    });

    // Con la app en primer plano el sistema NO dibuja nada (ver
    // `LocalNotifier`): acá se pinta y se refresca la lista.
    _onMessage = FirebaseMessaging.onMessage.listen((message) {
      _showIncoming(message);
      onRefreshNeeded?.call();
    });

    _onOpened = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      onOpened?.call(_dataOf(message));
      onRefreshNeeded?.call();
    });

    // La app estaba CERRADA y se abrió tocando el aviso: eso no pasa por
    // `onMessageOpenedApp`, hay que preguntarlo una vez al arrancar o el toque
    // se pierde y la app abre en la lista como si nada.
    final initial = await messaging.getInitialMessage();
    if (initial != null) onOpened?.call(_dataOf(initial));

    _state = PushState(
      transport: PushTransport.fcm,
      permissionGranted: granted && permissionGranted,
      serverConfigured: serverConfigured,
      token: token,
      reason: serverConfigured == false
          ? 'El dispositivo quedó registrado, pero el servidor no tiene credenciales de '
              'Firebase: no va a empujar nada hasta que se completen en su .env.'
          : null,
    );
    return _state;
  }

  Map<String, String> _dataOf(RemoteMessage message) =>
      message.data.map((key, value) => MapEntry(key, value?.toString() ?? ''));

  void _showIncoming(RemoteMessage message) {
    final data = _dataOf(message);
    final title = message.notification?.title ?? data['title'] ?? 'Aviso del panel';
    final body = message.notification?.body ?? data['body'];
    // El id es el de la notificación del panel: así el mismo aviso llegado por
    // push y encontrado después por el sondeo se reemplaza en vez de apilarse.
    final id = int.tryParse(data['notificationId'] ?? '') ?? DateTime.now().millisecondsSinceEpoch ~/ 1000;
    LocalNotifier.instance.show(
      id: id,
      title: title,
      body: body,
      payload: data['link'],
      threadTag: data['type'],
    );
  }

  // ────────────────────────────── Sondeo ───────────────────────────────────

  Future<PushState> _startPolling({
    required bool permissionGranted,
    bool? serverConfigured,
    required String reason,
  }) async {
    // El dispositivo se registra IGUAL, con `transport: 'polling'`: así el
    // backend sabe cuántas instalaciones hay y cuáles no pueden recibir un
    // push —`activeFcmTokens()` las excluye, así que no se le gasta una llamada
    // a Firebase por una dirección que no existe— y la pantalla de dispositivos
    // puede decir por qué a ese equipo no le llega nada con la app cerrada.
    await _register(token: _identity!.pollingId, transport: 'polling');

    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(AppConfig.pollInterval, (_) => pollOnce());
    // Una vuelta ya: con solo el temporizador, lo que llegó mientras la app
    // estaba cerrada no se avisa hasta el primer intervalo.
    await pollOnce();

    _state = PushState(
      transport: PushTransport.polling,
      permissionGranted: permissionGranted,
      serverConfigured: serverConfigured,
      reason: reason,
      token: _identity!.pollingId,
    );
    return _state;
  }

  /// Una vuelta del sondeo: trae la lista y avisa de lo que no se había visto.
  ///
  /// La marca de agua es el id MÁS ALTO visto, guardado en el dispositivo. No
  /// se usa "no leída" como criterio: una notificación que alguien ya leyó
  /// desde el panel web sigue sin leer para esta app si se mira solo `is_read`,
  /// y el teléfono empezaría a avisar de cosas viejas cada vez que se abre.
  Future<void> pollOnce() async {
    try {
      final items = await _notifications.list();
      if (items.isEmpty) return;

      final prefs = await SharedPreferences.getInstance();
      final lastSeen = prefs.getInt(_lastSeenKey) ?? 0;
      final highest = items.map((n) => n.id).reduce((a, b) => a > b ? a : b);

      if (lastSeen == 0) {
        // Primera vuelta de esta instalación: se toma nota y NO se avisa. Si no,
        // al entrar por primera vez salen treinta avisos de golpe de cosas que
        // pasaron la semana pasada.
        await prefs.setInt(_lastSeenKey, highest);
        onRefreshNeeded?.call();
        return;
      }

      final nuevas = items.where((n) => n.id > lastSeen).toList()
        ..sort((a, b) => a.id.compareTo(b.id));

      for (final item in nuevas) {
        await _notify(item);
      }
      if (highest > lastSeen) await prefs.setInt(_lastSeenKey, highest);
      if (nuevas.isNotEmpty) onRefreshNeeded?.call();

      if (_registeredToken != null) {
        // Marca que esta instalación sigue viva, para que la pantalla de
        // dispositivos pueda distinguir la que dejó de abrirse.
        _devices.ping(_registeredToken!).catchError((_) {});
      }
    } catch (_) {
      // Sin red, o el servidor caído: la próxima vuelta lo reintenta. Un
      // sondeo que falla no es un error que mostrar, es una vuelta perdida.
    }
  }

  Future<void> _notify(AppNotification item) => LocalNotifier.instance.show(
    id: item.id,
    title: item.title,
    body: item.body,
    payload: item.link,
    threadTag: item.type,
  );

  // ───────────────────────── Registro y limpieza ───────────────────────────

  Future<void> _register({required String token, required String transport}) async {
    try {
      await _devices.register(
        token: token,
        platform: _identity!.platform,
        transport: transport,
        deviceLabel: _identity!.label,
        appVersion: _identity!.appVersion,
      );
      _registeredToken = token;
    } catch (_) {
      // El registro falla con el servidor caído o la sesión recién vencida. No
      // se escala: la app sigue funcionando y el registro se reintenta al
      // próximo arranque o al refrescar desde la pantalla de diagnóstico.
    }
  }

  /// Da de baja un token sin que un fallo importe: se usa para limpiar el
  /// registro viejo de este mismo aparato, que es ordenar y no una operación de
  /// la que dependa nada.
  Future<void> _unregisterQuietly(String token) async {
    try {
      await _devices.unregister(token);
    } catch (_) {
      // Queda la fila de más en la lista de dispositivos. Se vuelve a intentar
      // en el próximo arranque.
    }
  }

  /// Cierre de sesión: el token se da de baja **antes** de olvidar el JWT.
  ///
  /// Es lo que impide que a un teléfono le sigan llegando los avisos de una
  /// sesión que ya se cerró —o peor, los de los leads de la persona que entre
  /// después en ese mismo aparato—.
  Future<void> signOut() async {
    final token = _registeredToken;
    _pollTimer?.cancel();
    _pollTimer = null;
    await _tokenRefresh?.cancel();
    await _onMessage?.cancel();
    await _onOpened?.cancel();
    _tokenRefresh = null;
    _onMessage = null;
    _onOpened = null;

    if (token != null) {
      try {
        await _devices.unregister(token);
      } catch (_) {
        // Si no se pudo avisar al servidor, el token queda registrado. Lo
        // cubre Firebase: al reinstalar o limpiar datos el token muere y el
        // primer envío lo da de baja con `UNREGISTERED`.
      }
    }
    _registeredToken = null;

    // La marca de agua del sondeo se borra: con la marca vieja, la persona que
    // entre después en este aparato no recibiría aviso de nada anterior a su
    // sesión, pero tampoco tiene por qué ver el conteo de la anterior.
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_lastSeenKey);

    _state = const PushState(transport: PushTransport.polling, permissionGranted: false);
  }

  void dispose() {
    _pollTimer?.cancel();
    _tokenRefresh?.cancel();
    _onMessage?.cancel();
    _onOpened?.cancel();
  }
}
