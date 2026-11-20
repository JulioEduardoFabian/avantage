/// Una fila de `notifications` del panel, tal como la devuelve
/// `GET /api/notifications`.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.link,
    required this.isRead,
    this.createdAt,
  });

  final int id;
  final String type;
  final String title;
  final String? body;
  final String? link;
  final bool isRead;
  final DateTime? createdAt;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
    id: _asInt(json['id']),
    type: (json['type'] ?? '').toString(),
    title: (json['title'] ?? '').toString(),
    body: _asNullableString(json['body']),
    link: _asNullableString(json['link']),
    // MySQL devuelve los booleanos como 0/1 y el driver no siempre los
    // convierte: leer solo `== true` deja todo como no leído y la app muestra
    // un badge que nunca baja.
    isRead: json['is_read'] == true || json['is_read'] == 1,
    createdAt: _asDate(json['created_at']),
  );

  AppNotification copyWith({bool? isRead}) => AppNotification(
    id: id,
    type: type,
    title: title,
    body: body,
    link: link,
    isRead: isRead ?? this.isRead,
    createdAt: createdAt,
  );

  static int _asInt(Object? value) {
    if (value is int) return value;
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  static String? _asNullableString(Object? value) {
    final text = value?.toString().trim();
    return (text == null || text.isEmpty) ? null : text;
  }

  static DateTime? _asDate(Object? value) {
    if (value == null) return null;
    // El backend serializa los timestamps en UTC: sin `toLocal()`, un aviso de
    // hace un minuto se lee como "hace 5 horas" en Lima.
    return DateTime.tryParse(value.toString())?.toLocal();
  }
}
