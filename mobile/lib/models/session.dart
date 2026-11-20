/// La sesión: el JWT que emite `POST /api/auth/login` y el usuario que vino
/// con él.
///
/// Los permisos viajan EMBEBIDOS en el token (ver `middleware/auth.js`), así
/// que acá se guarda la copia que mandó el servidor y no se re-consultan: es
/// la misma regla del panel web.
class Session {
  const Session({
    required this.token,
    required this.userId,
    required this.name,
    required this.email,
    required this.role,
    required this.permissions,
    this.avatarUrl,
  });

  final String token;
  final int userId;
  final String name;
  final String email;
  final String role;
  final List<String> permissions;
  final String? avatarUrl;

  factory Session.fromLogin(String token, Map<String, dynamic> user) => Session(
    token: token,
    userId: int.tryParse(user['id']?.toString() ?? '') ?? 0,
    name: (user['name'] ?? user['email'] ?? '').toString(),
    email: (user['email'] ?? '').toString(),
    role: (user['role'] ?? '').toString(),
    permissions: (user['permissions'] as List?)?.map((p) => p.toString()).toList() ?? const [],
    avatarUrl: (user['avatar_url']?.toString().isEmpty ?? true) ? null : user['avatar_url'].toString(),
  );

  Map<String, dynamic> toJson() => {
    'token': token,
    'user': {
      'id': userId,
      'name': name,
      'email': email,
      'role': role,
      'permissions': permissions,
      'avatar_url': avatarUrl,
    },
  };

  factory Session.fromJson(Map<String, dynamic> json) =>
      Session.fromLogin(json['token'].toString(), Map<String, dynamic>.from(json['user'] as Map));

  /// Las iniciales para el círculo del encabezado, igual que en el panel.
  String get initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }
}
