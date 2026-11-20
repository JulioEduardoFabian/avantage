import { MANUAL_NOTICE_TYPE } from './noticeService.js';

/**
 * Qué notificación automática le toca a qué perfil.
 *
 * Todas las automáticas nacen con `user_id` en NULL —"para todos"—, que era lo
 * correcto cuando eran ocho avisos del negocio. Hoy son quince tipos muy
 * distintos entre sí y le suenan en el teléfono a todo el mundo: el
 * "Recordatorio de reunión sin entregar" le interesa a quien lleva la agenda,
 * "pago verificado" a Finanzas, y "escribió y nadie le respondió" a quien
 * trabaja leads. Con los tres mezclados en la misma campana, la campana deja
 * de mirarse — 645 sin leer es exactamente eso, y a partir de ahí el aviso que
 * sí importaba tampoco se ve.
 *
 * **Sin reglas, todo sigue yendo a todos.** Un tipo sin filas en
 * `notification_routing` es "para todos", que es el comportamiento de hoy: la
 * función se enciende cuando alguien la configura, y un entorno donde la
 * migración no corrió se comporta igual que antes en vez de dejar a la mitad
 * del equipo sin avisos.
 *
 * El filtro se resuelve **al leer y no al crear**, al revés que los avisos
 * manuales (`resolveRecipients()` los expande a una fila por persona). Son dos
 * decisiones distintas porque los avisos son distintos:
 *
 *   - Un aviso MANUAL es un hecho puntual ("reunión a las 5"): quien entre al
 *     rol la semana que viene no debería verlo —el push ya salió sin él— y
 *     quien salga no debería perder el que sí le llegó.
 *   - Un aviso AUTOMÁTICO es un estado del negocio que sigue siendo cierto
 *     mientras nadie lo atienda ("este lead sigue sin respuesta"). Al setter
 *     que entra hoy le sirve ver los de ayer, y al que cambia de rol ya no le
 *     tocan. Expandirlo además multiplicaría cada aviso del bot por la
 *     cantidad de empleados, que es justo lo que el `user_id` en NULL evita.
 *
 * Lo que NO se puede resolver al leer es el **push**: ese ya salió. Por eso
 * `create()` resuelve el público una vez y se lo pasa a `sendForNotification`,
 * para que la campana y el teléfono digan lo mismo — si el push fuera a todos
 * y la campana filtrara, el aviso le sonaría en el bolsillo a gente que después
 * no lo encuentra en el panel.
 */

/**
 * El catálogo de lo que el sistema avisa, agrupado por el trabajo al que
 * pertenece. Es lo que se le ofrece a quien configura: una lista de quince
 * claves como `whatsapp_reminder_undeliverable` no se puede repartir entre
 * perfiles porque nadie sabe qué significan.
 *
 * Vive en el backend y viaja en la respuesta del `GET`, no copiado en la
 * pantalla: con una copia en cada lado, el tipo que se agregue mañana aparece
 * en la base y no en el formulario, así que nadie puede enrutarlo.
 *
 * `MANUAL_NOTICE_TYPE` NO está acá a propósito: esos ya eligen destinatario al
 * mandarse (`¿A quién?` en la pantalla de Avisos), y enrutarlos además por su
 * tipo haría que un aviso dirigido a tres personas se le escondiera a una de
 * ellas por su perfil — dos reglas peleando por el mismo aviso.
 */
export const NOTIFICATION_TYPES = [
  // ── Leads que esperan respuesta ────────────────────────────────────────
  {
    type: 'unanswered_inbound',
    group: 'Leads sin atender',
    label: 'Escribió y nadie le respondió',
    description: 'Un contacto escribió y su mensaje sigue sin respuesta porque su conversación está cerrada, congelada o con el bot pausado.'
  },
  {
    type: 'paused_inbound_message',
    group: 'Leads sin atender',
    label: 'Respondió con el bot pausado',
    description: 'El contacto escribió, pero el bot está apagado para él: nadie le va a contestar solo.'
  },
  {
    type: 'whatsapp_lead_handed_off',
    group: 'Leads sin atender',
    label: 'Lead transferido a un asesor',
    description: 'El bot dejó de atender a un lead y lo pasó a una persona.'
  },
  {
    type: 'handoff_unattended',
    group: 'Leads sin atender',
    label: 'Lead transferido que sigue esperando',
    description: 'Pasaron horas desde la transferencia y todavía no le escribió nadie.'
  },
  {
    type: 'sales_funnel_lead_message',
    group: 'Leads sin atender',
    label: 'Escribió un lead del Funnel de Ventas',
    description: 'Un lead que ya es del closer escribió por WhatsApp; el bot no le contesta.'
  },

  // ── Reuniones ──────────────────────────────────────────────────────────
  {
    type: 'meeting_booked',
    group: 'Reuniones',
    label: 'Reunión agendada por el bot',
    description: 'Avan reservó un bloque en el calendario de un asesor.'
  },
  {
    type: 'lead_waiting_in_meeting',
    group: 'Reuniones',
    label: 'Hay alguien esperando en la sala AHORA',
    description: 'El lead entró al Meet y espera que lo admitan. Es el aviso más urgente del sistema.'
  },
  {
    type: 'meeting_change_requested',
    group: 'Reuniones',
    label: 'Pidió cambiar su reunión',
    description: 'Un lead con reunión agendada quiere moverla.'
  },
  {
    type: 'post_booking_attention',
    group: 'Reuniones',
    label: 'Necesita atención después de agendar',
    description: 'Un lead con reunión ya agendada escribió algo que el bot no puede resolver.'
  },
  {
    type: 'whatsapp_reminder_undeliverable',
    group: 'Reuniones',
    label: 'Recordatorio de reunión sin entregar',
    description: 'No se pudo avisar por WhatsApp de su reunión: la ventana de 24 h está cerrada.'
  },
  {
    type: 'whatsapp_daily_agenda',
    group: 'Reuniones',
    label: 'Agenda del día',
    description: 'El resumen de las reuniones de la jornada.'
  },

  // ── Dinero ─────────────────────────────────────────────────────────────
  {
    type: 'income_verified',
    group: 'Dinero y entregas',
    label: 'Pago verificado',
    description: 'Finanzas dio el visto bueno a una cuota; nombra los entregables que la esperaban.'
  },
  {
    type: 'client_payment_uploaded',
    group: 'Dinero y entregas',
    label: 'Un cliente subió su comprobante',
    description: 'Llegó un comprobante desde el portal del cliente y hay que verificarlo.'
  },
  {
    type: 'deliverables_unlocked',
    group: 'Dinero y entregas',
    label: 'Entregables desbloqueados',
    description: 'Se verificó el pago que bloqueaba un entregable.'
  },
  {
    type: 'project_created',
    group: 'Dinero y entregas',
    label: 'Proyecto nuevo',
    description: 'Nació un proyecto: cliente, tema, fecha límite y si queda bloqueado esperando el primer pago.'
  },

  // ── Cosas del sistema ──────────────────────────────────────────────────
  {
    type: 'media_for_review',
    group: 'Sistema',
    label: 'Mandaron un archivo para revisar',
    description: 'Un contacto mandó un documento, una imagen o un video que el bot no puede abrir.'
  },
  {
    type: 'google_calendar_disconnected',
    group: 'Sistema',
    label: 'Google Calendar desconectado',
    description: 'Se cayó la conexión con el calendario de un asesor y el bot no puede agendar.'
  }
];

/** Las claves del catálogo, para validar lo que llega del formulario. */
export const KNOWN_TYPES = new Set(NOTIFICATION_TYPES.map((t) => t.type));

/**
 * Los tipos que se pueden enrutar. Es el catálogo menos el aviso manual, que
 * elige destinatario al mandarse.
 */
export function routableTypes() {
  return NOTIFICATION_TYPES.filter((t) => t.type !== MANUAL_NOTICE_TYPE);
}

/**
 * Las filas de `notification_routing` como un mapa `tipo → [role_id]`.
 * Un tipo ausente del mapa es "para todos".
 */
export function routingMap(rows = []) {
  const map = {};
  for (const row of rows) {
    if (!map[row.type]) map[row.type] = [];
    if (!map[row.type].includes(row.role_id)) map[row.type].push(row.role_id);
  }
  return map;
}

/**
 * Los tipos que este perfil NO tiene que ver.
 *
 * Se contesta "qué se esconde" y no "qué se muestra" porque la lista de tipos
 * crece: preguntando al revés, el tipo que se agregue mañana no estaría en
 * ninguna lista permitida y desaparecería de todas las campanas sin que nadie
 * lo note — el fallo silencioso de siempre. Así, lo que no está configurado va
 * a todos, que es el comportamiento de hoy.
 *
 * `roleId` en null (un usuario sin perfil) solo ve lo no restringido: no se le
 * puede afirmar que le toca algo que está repartido por perfiles.
 */
export function blockedTypesFor(roleId, rows = []) {
  const map = routingMap(rows);
  return Object.entries(map)
    .filter(([, roleIds]) => roleIds.length > 0 && !roleIds.includes(roleId))
    .map(([type]) => type);
}

/**
 * Los perfiles a los que va este tipo, o null si va a todos. Es lo que usa el
 * push para resolver a qué teléfonos mandar.
 */
export function audienceRoleIds(type, rows = []) {
  const roleIds = routingMap(rows)[type];
  return roleIds && roleIds.length > 0 ? roleIds : null;
}
