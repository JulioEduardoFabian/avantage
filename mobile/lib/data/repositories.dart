import '../models/app_notification.dart';
import '../models/session.dart';
import 'api_client.dart';

/// Login y sesión. Es el mismo `POST /api/auth/login` del panel web.
class AuthRepository {
  AuthRepository(this._api);
  final ApiClient _api;

  Future<Session> login({required String email, required String password}) async {
    final data = await _api.post('/api/auth/login', {'email': email.trim(), 'password': password});
    return Session.fromLogin(
      data['token'].toString(),
      Map<String, dynamic>.from(data['user'] as Map),
    );
  }

  /// Revalida el token guardado al abrir la app.
  ///
  /// `/api/auth/me` reemite el token cuando los permisos cambiaron desde el
  /// login, así que la respuesta puede traer uno nuevo: ignorarlo dejaría a la
  /// app con permisos viejos y recibiendo 403 en rutas que la pantalla ya
  /// muestra.
  Future<Session> me(String currentToken) async {
    final data = await _api.get('/api/auth/me');
    return Session.fromLogin(
      (data['token'] ?? currentToken).toString(),
      Map<String, dynamic>.from(data['user'] as Map),
    );
  }
}

/// La campana del panel: las mismas cuatro rutas que usa `AdminNavbar.vue`.
class NotificationsRepository {
  NotificationsRepository(this._api);
  final ApiClient _api;

  Future<List<AppNotification>> list() async {
    final data = await _api.get('/api/notifications');
    final rows = (data['notifications'] as List?) ?? const [];
    return rows
        .map((row) => AppNotification.fromJson(Map<String, dynamic>.from(row as Map)))
        .toList();
  }

  Future<int> unreadCount() async {
    final data = await _api.get('/api/notifications/unread-count');
    return int.tryParse(data['count']?.toString() ?? '') ?? 0;
  }

  Future<void> markRead(int id) => _api.post('/api/notifications/$id/read');

  Future<void> markAllRead() => _api.post('/api/notifications/read-all');
}

/// El estado del push en el servidor y el registro de ESTE dispositivo.
class DevicesRepository {
  DevicesRepository(this._api);
  final ApiClient _api;

  /// Si el backend tiene credenciales de Firebase. La app lo pregunta para no
  /// quedarse esperando un push que nadie va a mandar: sin credenciales se
  /// pasa al sondeo, que es la diferencia entre "no me llega nada" y "no me
  /// llega nada y no sé por qué".
  Future<PushServerStatus> status() async {
    final data = await _api.get('/api/push/status');
    final push = Map<String, dynamic>.from((data['push'] as Map?) ?? const {});
    return PushServerStatus(
      configured: push['configured'] == true,
      projectId: push['projectId']?.toString(),
      error: push['error']?.toString(),
    );
  }

  Future<void> register({
    required String token,
    required String platform,
    required String transport,
    String? deviceLabel,
    String? appVersion,
  }) => _api.post('/api/devices', {
    'token': token,
    'platform': platform,
    'transport': transport,
    'deviceLabel': deviceLabel,
    'appVersion': appVersion,
  });

  Future<void> unregister(String token) => _api.post('/api/devices/unregister', {'token': token});

  Future<void> ping(String token) => _api.post('/api/devices/ping', {'token': token});

  /// Manda un push de prueba a los dispositivos de quien lo pide. Es la única
  /// forma de comprobar la cadena completa (servidor → Firebase → teléfono)
  /// sin tener que esperar a que alguien agende una reunión.
  Future<Map<String, dynamic>> sendTest() async {
    final data = await _api.post('/api/push/test');
    return Map<String, dynamic>.from((data['summary'] as Map?) ?? const {});
  }

  Future<List<Map<String, dynamic>>> listMine() async {
    final data = await _api.get('/api/devices');
    final rows = (data['devices'] as List?) ?? const [];
    return rows.map((row) => Map<String, dynamic>.from(row as Map)).toList();
  }
}

class PushServerStatus {
  const PushServerStatus({required this.configured, this.projectId, this.error});
  final bool configured;
  final String? projectId;
  final String? error;
}
