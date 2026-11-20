import 'package:avantage_avisos/models/app_notification.dart';
import 'package:avantage_avisos/models/session.dart';
import 'package:avantage_avisos/ui/notification_meta.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppNotification', () {
    test('lee el 0/1 de MySQL como booleano', () {
      // El driver de MySQL devuelve los booleanos como 0/1 y no siempre los
      // convierte. Leyendo solo `== true`, TODO queda como no leído y el badge
      // de la app nunca baja aunque en el panel ya se hayan leído.
      expect(AppNotification.fromJson({'id': 1, 'type': 'x', 'title': 'y', 'is_read': 1}).isRead, isTrue);
      expect(AppNotification.fromJson({'id': 1, 'type': 'x', 'title': 'y', 'is_read': 0}).isRead, isFalse);
      expect(AppNotification.fromJson({'id': 1, 'type': 'x', 'title': 'y', 'is_read': true}).isRead, isTrue);
    });

    test('un cuerpo o un enlace vacíos son nulos, no cadenas vacías', () {
      // De eso depende que la tarjeta no dibuje "Abrir en el panel" para un
      // aviso que no lleva enlace a ninguna parte.
      final item = AppNotification.fromJson({
        'id': 1,
        'type': 'x',
        'title': 'y',
        'body': '   ',
        'link': '',
        'is_read': 0,
      });
      expect(item.body, isNull);
      expect(item.link, isNull);
    });

    test('la fecha se convierte a la hora local', () {
      // El backend serializa en UTC: sin `toLocal()`, un aviso de hace un
      // minuto se lee como "hace 5 horas" en Lima.
      final item = AppNotification.fromJson({
        'id': 1,
        'type': 'x',
        'title': 'y',
        'is_read': 0,
        'created_at': '2026-11-13T15:00:00.000Z',
      });
      expect(item.createdAt!.isUtc, isFalse);
    });

    test('un id que viene como texto se lee igual', () {
      expect(AppNotification.fromJson({'id': '42', 'type': 'x', 'title': 'y'}).id, 42);
    });
  });

  group('NotificationMeta', () {
    test('un tipo conocido trae su nombre', () {
      expect(NotificationMeta.of('income_verified').label, 'Pago verificado');
    });

    test('un tipo NUEVO del backend no rompe la pantalla', () {
      // El backend puede sumar un tipo sin que esta app se actualice: tiene que
      // dibujarse con el aviso genérico y no desaparecer de la lista.
      final meta = NotificationMeta.of('algo_que_todavia_no_existe');
      expect(meta.label, 'Aviso del panel');
    });
  });

  group('relativeTime', () {
    test('cuenta en lenguaje llano', () {
      final now = DateTime.now();
      expect(relativeTime(now), 'ahora');
      expect(relativeTime(now.subtract(const Duration(minutes: 5))), 'hace 5 min');
      expect(relativeTime(now.subtract(const Duration(hours: 3))), 'hace 3 h');
      expect(relativeTime(now.subtract(const Duration(days: 1, hours: 1))), 'ayer');
      expect(relativeTime(now.subtract(const Duration(days: 3))), 'hace 3 días');
    });

    test('más de una semana atrás se escribe con la fecha', () {
      expect(relativeTime(DateTime(2026, 3, 4)), '04/03/2026');
    });

    test('una fecha en el futuro no dice "hace -2 min"', () {
      // Pasa de verdad: el reloj del teléfono y el del servidor no coinciden al
      // segundo, así que un aviso recién creado puede llegar "del futuro".
      expect(relativeTime(DateTime.now().add(const Duration(minutes: 2))), 'ahora');
    });
  });

  group('Session', () {
    test('las iniciales salen del nombre, como en el panel', () {
      final session = Session.fromLogin('tok', {
        'id': 1,
        'name': 'Lucía Castañeda Ríos',
        'email': 'l@x.pe',
        'role': 'Setter',
        'permissions': ['setter.view'],
      });
      expect(session.initials, 'LR');
      expect(session.permissions, contains('setter.view'));
    });

    test('un nombre de una sola palabra da una inicial', () {
      expect(Session.fromLogin('t', {'id': 1, 'name': 'Kevin'}).initials, 'K');
    });

    test('la sesión guardada y recuperada es la misma', () {
      final original = Session.fromLogin('tok', {
        'id': 7,
        'name': 'Jair',
        'email': 'j@x.pe',
        'role': 'Admin',
        'permissions': ['leads.view', 'finance.view'],
      });
      final restored = Session.fromJson(original.toJson());
      expect(restored.token, original.token);
      expect(restored.userId, 7);
      expect(restored.permissions, original.permissions);
    });
  });
}
