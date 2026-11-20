import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Se lanza cuando el backend contesta 401: el token caducó (dura 8 h) o se
/// revocó. La app cierra la sesión y vuelve al login, igual que hace
/// `apiClient.js` en el panel web.
class SessionExpiredException implements Exception {
  const SessionExpiredException();
  @override
  String toString() => 'La sesión expiró.';
}

/// Un error que la app puede mostrar tal cual: el backend contesta `{ error }`
/// en todas sus rutas, así que ese texto ya está escrito para una persona.
class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

/// El equivalente de `src/apiClient.js`: adjunta el Bearer y traduce las
/// respuestas del backend a algo que la app pueda mostrar.
///
/// Un solo sitio para las dos cosas que si no se repiten en cada pantalla: la
/// cabecera de autorización y el 401. Con el token adjuntado pantalla por
/// pantalla, la que se olvide recibe un 401 que parece un problema de permisos.
class ApiClient {
  ApiClient({required this.baseUrl, http.Client? httpClient, this.onUnauthorized})
      : _http = httpClient ?? http.Client();

  final String baseUrl;
  final http.Client _http;

  /// Se llama cuando el backend contesta 401. Lo usa el estado de la app para
  /// cerrar la sesión desde un solo lugar.
  final void Function()? onUnauthorized;

  String? _token;

  // ignore: avoid_setters_without_getters
  set token(String? value) => _token = value;

  /// Un pedido que no vuelve nunca es peor que uno que falla: con el servidor
  /// apagado, sin esto la pantalla se queda girando sin decir nada.
  static const Duration _timeout = Duration(seconds: 20);

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl$path').replace(queryParameters: query);

  Map<String, String> get _headers => {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    if (_token != null) 'Authorization': 'Bearer $_token',
  };

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers));

  Future<Map<String, dynamic>> post(String path, [Map<String, dynamic>? body]) => _send(
    () => _http.post(_uri(path), headers: _headers, body: jsonEncode(body ?? const {})),
  );

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() request) async {
    final http.Response response;
    try {
      response = await request().timeout(_timeout);
    } on TimeoutException {
      throw const ApiException('El servidor no respondió. Revisá la URL y que el panel esté encendido.');
    } catch (error) {
      // Sin red, URL mal escrita, certificado rechazado: el mensaje crudo de
      // Dart ("SocketException: Failed host lookup") no le dice nada a nadie.
      throw ApiException('No se pudo conectar con el servidor ($error).');
    }

    if (response.statusCode == 401) {
      onUnauthorized?.call();
      throw const SessionExpiredException();
    }

    final decoded = _decode(response);
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;

    throw ApiException(
      decoded['error']?.toString() ?? 'El servidor respondió ${response.statusCode}.',
      statusCode: response.statusCode,
    );
  }

  Map<String, dynamic> _decode(http.Response response) {
    if (response.body.isEmpty) return const {};
    try {
      // `utf8.decode` y no `response.body`: los avisos están en español y con
      // la decodificación por defecto "Reunión" llega como "ReuniÃ³n".
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : {'data': decoded};
    } catch (_) {
      // Una respuesta que no es JSON casi siempre es el HTML de un proxy o de
      // la página de error del hosting: decirlo es más útil que el parser.
      return {'error': 'El servidor no devolvió JSON (¿es la URL del panel?).'};
    }
  }

  void close() => _http.close();
}
