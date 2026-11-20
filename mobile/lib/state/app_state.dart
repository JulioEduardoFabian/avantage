import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app_config.dart';
import '../data/api_client.dart';
import '../data/repositories.dart';
import '../models/app_notification.dart';
import '../models/session.dart';
import '../push/push_gateway.dart';

/// El estado de la app: la sesión, la lista de avisos y por dónde llegan.
///
/// Un `ChangeNotifier` y no un gestor de estado con dependencias: la app tiene
/// tres pantallas y un solo flujo (entrar, recibir, tocar). Lo que justifica
/// una librería de estado es la cantidad de pantallas que comparten datos, y
/// acá es una.
class AppState extends ChangeNotifier {
  AppState() {
    _api = ApiClient(
      baseUrl: AppConfig.apiBaseUrl,
      // El 401 se resuelve en UN solo sitio: el token dura 8 h, así que la
      // sesión se vence sola todos los días y cada pantalla tendría que
      // acordarse de manejarlo.
      onUnauthorized: () => signOut(expired: true),
    );
    auth = AuthRepository(_api);
    notifications = NotificationsRepository(_api);
    devices = DevicesRepository(_api);
    push = PushGateway(devices: devices, notifications: notifications);
    push.onRefreshNeeded = refreshNotifications;
  }

  static const _sessionKey = 'avantage.session';

  late final ApiClient _api;
  late final AuthRepository auth;
  late final NotificationsRepository notifications;
  late final DevicesRepository devices;
  late final PushGateway push;

  Session? _session;
  Session? get session => _session;
  bool get isSignedIn => _session != null;

  bool _restoring = true;
  bool get restoring => _restoring;

  bool _busy = false;
  bool get busy => _busy;

  String? _error;
  String? get error => _error;

  /// Se muestra una vez cuando la sesión se venció sola, para que volver al
  /// login no parezca que la app se deslogueó por su cuenta.
  bool _sessionExpired = false;
  bool get sessionExpired => _sessionExpired;

  List<AppNotification> _items = const [];
  List<AppNotification> get items => _items;

  int _unread = 0;
  int get unread => _unread;

  PushState get pushState => push.state;

  /// El `link` del aviso que alguien tocó, para que la pantalla lo ofrezca.
  /// Son rutas del panel web (`/admin/calendario`), así que la app no tiene
  /// esas pantallas: lo que hace es ofrecer abrirlas en el navegador, que es
  /// honesto y útil, en vez de reimplementar el CRM entero.
  String? _pendingLink;
  String? get pendingLink => _pendingLink;

  void consumePendingLink() {
    _pendingLink = null;
    notifyListeners();
  }

  // ─────────────────────────────── Sesión ──────────────────────────────────

  /// Al abrir la app: recupera la sesión guardada y la revalida.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_sessionKey);
    if (raw != null && raw.isNotEmpty) {
      try {
        final saved = Session.fromJson(Map<String, dynamic>.from(jsonDecode(raw) as Map));
        _api.token = saved.token;
        _session = saved;
        // Se muestra la sesión guardada de inmediato y se revalida en segundo
        // plano: esperar a `/api/auth/me` deja la app en blanco cada vez que se
        // abre con mala señal, y si el token ya no vale, el 401 de cualquier
        // llamada la devuelve al login.
        notifyListeners();
        final fresh = await auth.me(saved.token);
        await _persist(fresh);
      } catch (_) {
        // Un JSON corrupto o un token ya inválido: se arranca desde el login.
        if (_session == null) await prefs.remove(_sessionKey);
      }
    }
    _restoring = false;
    notifyListeners();

    if (_session != null) await _afterSignIn();
  }

  Future<bool> signIn({required String email, required String password}) async {
    _busy = true;
    _error = null;
    _sessionExpired = false;
    notifyListeners();
    try {
      final fresh = await auth.login(email: email, password: password);
      await _persist(fresh);
      _busy = false;
      notifyListeners();
      await _afterSignIn();
      return true;
    } catch (error) {
      _error = error.toString();
      _busy = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> _persist(Session session) async {
    _session = session;
    _api.token = session.token;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sessionKey, jsonEncode(session.toJson()));
    notifyListeners();
  }

  /// Lo que hay que hacer en ese orden: primero encender el camino de los
  /// avisos y después traer la lista. Al revés, el sondeo arranca sin marca de
  /// agua y la primera vuelta compite con la carga de la pantalla.
  Future<void> _afterSignIn() async {
    push.onOpened = (data) {
      final link = data['link'];
      if (link != null && link.isNotEmpty) {
        _pendingLink = link;
        notifyListeners();
      }
    };
    await push.start();
    notifyListeners();
    await refreshNotifications();
  }

  Future<void> signOut({bool expired = false}) async {
    // La baja del dispositivo va ANTES de olvidar el token: sin sesión, el
    // backend rechazaría el pedido y a este teléfono le seguirían llegando los
    // avisos de una sesión cerrada.
    if (_session != null) await push.signOut();
    _session = null;
    _api.token = null;
    _items = const [];
    _unread = 0;
    _sessionExpired = expired;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionKey);
    notifyListeners();
  }

  // ───────────────────────────── Notificaciones ────────────────────────────

  Future<void> refreshNotifications() async {
    if (_session == null) return;
    try {
      final (list, count) = await (notifications.list(), notifications.unreadCount()).wait;
      _items = list;
      _unread = count;
      _error = null;
    } on SessionExpiredException {
      // `onUnauthorized` ya cerró la sesión.
      return;
    } catch (error) {
      _error = error.toString();
    }
    notifyListeners();
  }

  /// Marca leída y actualiza la fila EN MEMORIA en vez de recargar la lista:
  /// recargar devolvería al principio del scroll justo cuando alguien está
  /// recorriendo los avisos de arriba abajo. Es la misma razón por la que la
  /// píldora de estado del Libro Diario del panel no recarga su tabla.
  Future<void> markRead(AppNotification item) async {
    if (item.isRead) return;
    _items = _items.map((n) => n.id == item.id ? n.copyWith(isRead: true) : n).toList();
    _unread = _unread > 0 ? _unread - 1 : 0;
    notifyListeners();
    try {
      await notifications.markRead(item.id);
    } catch (_) {
      // Si falló, la próxima carga la vuelve a mostrar sin leer: es el estado
      // de verdad, y revertirlo acá haría parpadear la fila.
    }
  }

  Future<void> markAllRead() async {
    _items = _items.map((n) => n.copyWith(isRead: true)).toList();
    _unread = 0;
    notifyListeners();
    try {
      await notifications.markAllRead();
    } catch (error) {
      _error = error.toString();
      notifyListeners();
    }
  }

  /// Vuelve a intentar el push (útil después de completar las credenciales en
  /// el servidor o de conceder el permiso desde los ajustes del sistema).
  Future<void> retryPush() async {
    await push.start();
    notifyListeners();
  }

  Future<String> sendTestPush() async {
    try {
      final summary = await devices.sendTest();
      if (summary['skipped'] == 'no_configurado') {
        return 'El servidor no tiene credenciales de Firebase: completá las FCM_* de su .env.';
      }
      if (summary['skipped'] == 'sin_dispositivos') {
        return 'No hay dispositivos con push registrados para tu cuenta.';
      }
      final sent = summary['sent'] ?? 0;
      final failed = summary['failed'] ?? 0;
      if (failed == 0) return 'Enviado a $sent dispositivo(s). Debería llegarte en unos segundos.';
      return 'Enviados $sent, fallidos $failed. ${summary['error'] ?? ''}'.trim();
    } catch (error) {
      return error.toString();
    }
  }

  @override
  void dispose() {
    push.dispose();
    _api.close();
    super.dispose();
  }
}
