import 'package:flutter/material.dart';

import 'theme.dart';

/// Cómo se ve y cómo se llama cada tipo de aviso.
///
/// Los tipos son los que escribe el backend en `notifications.type`: hoy
/// `meeting_booked`, `income_verified`, `project_created`,
/// `client_payment_uploaded`, `deliverables_unlocked`, `post_booking_attention`,
/// `whatsapp_daily_agenda` y `google_calendar_disconnected`.
///
/// Está en un solo sitio y no repartido por las tarjetas: es el vocabulario de
/// la pantalla, y una copia por widget es como se llega a que la lista y el
/// detalle llamen distinto a la misma cosa. Un tipo que no esté en la tabla se
/// dibuja con el aviso genérico en vez de desaparecer: el backend puede sumar
/// uno nuevo sin que esta app se actualice, y un aviso sin icono se lee igual.
class NotificationMeta {
  const NotificationMeta(this.label, this.icon, this.color);

  final String label;
  final IconData icon;
  final Color color;

  static const _table = <String, NotificationMeta>{
    'meeting_booked': NotificationMeta('Reunión agendada', Icons.event_available_outlined, Brand.emerald),
    'post_booking_attention': NotificationMeta('Necesita un asesor', Icons.support_agent_outlined, Brand.terracotta),
    'whatsapp_daily_agenda': NotificationMeta('Agenda del día', Icons.today_outlined, Brand.olive),
    'google_calendar_disconnected': NotificationMeta('Calendario desconectado', Icons.link_off_outlined, Brand.terracotta),
    'income_verified': NotificationMeta('Pago verificado', Icons.verified_outlined, Brand.emerald),
    'client_payment_uploaded': NotificationMeta('Comprobante del cliente', Icons.receipt_long_outlined, Brand.olive),
    'deliverables_unlocked': NotificationMeta('Entregables liberados', Icons.lock_open_outlined, Brand.emerald),
    'project_created': NotificationMeta('Proyecto nuevo', Icons.folder_special_outlined, Brand.olive),
    'push_test': NotificationMeta('Prueba de notificación', Icons.science_outlined, Brand.inkMuted),
    // El aviso que una persona del equipo escribió a mano desde
    // `/admin/avisos`. Es el único tipo que no nace de un evento del negocio,
    // y por eso lleva un icono de persona y no de un módulo del panel.
    'team_notice': NotificationMeta('Aviso del equipo', Icons.campaign_outlined, Brand.terracotta),
  };

  static NotificationMeta of(String type) =>
      _table[type] ?? const NotificationMeta('Aviso del panel', Icons.notifications_outlined, Brand.olive);
}

/// Cuándo pasó, en lenguaje llano.
///
/// Es la convención del módulo de Entregables del panel ("faltan 3 días",
/// "pasó hace 2 días") traída acá: en una lista de avisos lo que se pregunta es
/// si esto es de ahora o de la semana pasada, y "13/11/2026, 10:21" obliga a
/// hacer la cuenta. La fecha exacta queda en el detalle.
String relativeTime(DateTime? when) {
  if (when == null) return '';
  final diff = DateTime.now().difference(when);
  if (diff.isNegative) return 'ahora';
  if (diff.inMinutes < 1) return 'ahora';
  if (diff.inMinutes < 60) return 'hace ${diff.inMinutes} min';
  if (diff.inHours < 24) return 'hace ${diff.inHours} h';
  if (diff.inDays == 1) return 'ayer';
  if (diff.inDays < 7) return 'hace ${diff.inDays} días';
  return '${when.day.toString().padLeft(2, '0')}/${when.month.toString().padLeft(2, '0')}/${when.year}';
}
