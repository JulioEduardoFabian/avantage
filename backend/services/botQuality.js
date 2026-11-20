/**
 * Monitor de calidad del bot: qué de lo que pasa en una conversación hay que
 * poder contar DESPUÉS.
 *
 * El bot ya anotaba todo —más de cien tipos de evento en `logActivity()`—,
 * pero en un arreglo **en memoria** de tamaño fijo (`MAX_ACTIVITY_LOG`): se
 * pierde entero en cada despliegue, no se puede consultar por fecha y no se
 * puede sumar. O sea que las cuatro preguntas que de verdad se hacen sobre el
 * bot no tenían respuesta: cuántas preguntas quedaron sin resolver, cuántos
 * errores hubo, cuántas veces repitió lo mismo y cuántas conversaciones se
 * abandonaron. Cada una de esas cuatro cosas se descubría igual: alguien
 * abriendo conversaciones a mano, como pasó con las ocho huérfanas y con los
 * cuatro "estoy en sala de espera".
 *
 * Este módulo es la mitad PURA: traduce un evento de la bitácora a un evento
 * de calidad. La persistencia está en `botQualityService.js`.
 *
 * El enganche es `logActivity()` y no cada llamador, por la misma razón que el
 * push se cuelga de `notificationService.create()` y que el aviso de proyecto
 * nuevo vive en `projectService` y no en sus tres rutas de alta: es el punto
 * único por el que pasa todo, y puesto en cada sitio el evento número ciento
 * once se olvida y nadie se entera de que no se está midiendo.
 *
 * **No se persiste todo.** De los cien tipos, acá entran los que contestan una
 * de las cuatro preguntas; el resto sigue viviendo en la bitácora en memoria,
 * que es lo que se mira cuando se está depurando una conversación concreta.
 * Guardar los cien convertiría la tabla en un firehose —`send_success` y
 * `llm_request` solos son dos filas por turno— y las cuatro cifras quedarían
 * enterradas, que es exactamente el problema que esto viene a resolver.
 */

/** Las cuatro preguntas. Son el vocabulario de la tabla y de la pantalla. */
export const QUALITY_KINDS = ['pregunta_no_resuelta', 'error', 'respuesta_repetida', 'abandono'];

/**
 * QUIÉN dejó de responder, que en un abandono es la mitad del dato.
 *
 * Un contacto que se fue y una conversación que NOSOTROS dejamos sin contestar
 * se ven igual en una cifra —"35 conversaciones terminadas sin respuesta"— y
 * se arreglan al revés: al primero se le insiste (el motor de seguimiento), al
 * segundo se le reclama al equipo. Mezclados, el número no sirve para decidir
 * nada, que es como se llega a mirar un tablero y no hacer nada con él.
 */
export const QUALITY_ACTORS = ['contacto', 'equipo', 'bot'];

/**
 * Evento de la bitácora → evento de calidad.
 *
 * `severity` ordena la lista de la pantalla, y no es cosmética: un turno que
 * se cayó (`alta`) y un horario que no se pudo interpretar (`baja`) tienen que
 * poder separarse, porque el primero es un fallo y el segundo es un lead al
 * que hay que repreguntarle.
 */
const CLASSIFICATION = {
  // ── Preguntas que el bot no pudo resolver ──────────────────────────────
  // Lo que la persona escribió y el bot no supo convertir en un paso. Cada
  // una de estas filas es una frase real que conviene leer: de ahí salieron
  // las reglas de `slotReply.js` y la corrección de carrera/universidad.
  step_miss: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'media' },
  day_request_parse_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'baja' },
  constraint_parse_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'baja' },
  time_change_parse_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'baja' },
  preferred_when_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'baja' },
  slot_reply_lookup_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'media' },
  slot_reply_no_alternatives: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'media' },
  scheduling_aside_failed: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'media' },
  // El bot no puede abrir lo que le mandaron: es una pregunta sin resolver
  // desde el lado de la persona, que mandó su plan de tesis y recibió un
  // "cuéntamelo por escrito".
  unreadable_message: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'media' },
  garbage_value_ignored: { kind: 'pregunta_no_resuelta', actor: 'bot', severity: 'baja' },

  // ── Errores ───────────────────────────────────────────────────────────
  conversation_turn_failed: { kind: 'error', actor: 'bot', severity: 'alta' },
  turn_error_recovering: { kind: 'error', actor: 'bot', severity: 'alta' },
  turn_recovery_send_failed: { kind: 'error', actor: 'bot', severity: 'alta' },
  turn_recovery_session_failed: { kind: 'error', actor: 'bot', severity: 'alta' },
  send_failed: { kind: 'error', actor: 'bot', severity: 'alta' },
  whatsapp_reminder_undeliverable: { kind: 'error', actor: 'bot', severity: 'media' },
  google_calendar_disconnected: { kind: 'error', actor: 'equipo', severity: 'alta' },
  internal_alert_whatsapp_skipped: { kind: 'error', actor: 'equipo', severity: 'media' },
  typing_anchor_failed: { kind: 'error', actor: 'bot', severity: 'baja' },
  typing_indicator_failed: { kind: 'error', actor: 'bot', severity: 'baja' },

  // ── Respuestas repetidas ──────────────────────────────────────────────
  // El bot diciendo dos veces lo mismo es lo que la gente reclama como "no me
  // entiende" (ver FRUSTRATION_RE), y las redes que lo evitan ya existen: lo
  // que faltaba era contar cuántas veces se activan, que es la única forma de
  // saber si el guion está dando vueltas.
  redundant_message_suppressed: { kind: 'respuesta_repetida', actor: 'bot', severity: 'media' },
  redundant_question_fixed: { kind: 'respuesta_repetida', actor: 'bot', severity: 'media' },
  send_skipped_duplicate: { kind: 'respuesta_repetida', actor: 'bot', severity: 'media' },
  confirm_reasked: { kind: 'respuesta_repetida', actor: 'bot', severity: 'baja' },
  critical_signal_repeated: { kind: 'respuesta_repetida', actor: 'bot', severity: 'alta' },
  unreadable_message_repeated: { kind: 'respuesta_repetida', actor: 'bot', severity: 'baja' },
  waiting_in_meeting_repeated: { kind: 'respuesta_repetida', actor: 'bot', severity: 'alta' },

  // ── Abandonos ─────────────────────────────────────────────────────────
  // El contacto dejó de contestar y la conversación se congeló.
  inactivity_frozen: { kind: 'abandono', actor: 'contacto', severity: 'media' },
  // Nosotros dejamos de contestar: alguien escribió y nadie respondió. Es el
  // peor de los dos y el que no se ve sin medirlo.
  unanswered_inbound: { kind: 'abandono', actor: 'equipo', severity: 'alta' },
  handoff_unattended: { kind: 'abandono', actor: 'equipo', severity: 'alta' },
  missed_reply_handoff: { kind: 'abandono', actor: 'bot', severity: 'alta' },
  paused_inbound_message: { kind: 'abandono', actor: 'equipo', severity: 'media' },
  // Una conversación que quedó sin ficha es un contacto que no existe para
  // nadie: se recupera solo, pero haber tenido que recuperarlo es el dato.
  orphan_inbound_recovered: { kind: 'abandono', actor: 'bot', severity: 'media' }
};

/**
 * El evento de calidad que corresponde a una entrada de la bitácora, o null si
 * esa entrada no contesta ninguna de las cuatro preguntas.
 *
 * `detail` es lo que hace útil la fila: el texto del contacto, el motivo o el
 * mensaje de error. Sin eso la tabla dice "12 preguntas no resueltas" y no
 * deja arreglar ninguna. Se recorta acá y no en la base para que el límite sea
 * el mismo sin importar por dónde entre la fila.
 */
export function classifyActivity(entry = {}) {
  const rule = CLASSIFICATION[entry.type];
  if (!rule) return null;

  return {
    kind: rule.kind,
    actor: rule.actor,
    severity: rule.severity,
    eventType: entry.type,
    waId: entry.waId || null,
    detail: detailOf(entry)
  };
}

const MAX_DETAIL = 500;

/**
 * El dato legible de la entrada. Se busca en orden de lo más específico a lo
 * más genérico: el motivo del error gana sobre el texto, porque cuando hay un
 * error lo que hace falta es el error.
 */
function detailOf(entry) {
  const parts = [];
  if (entry.error) parts.push(String(entry.error));
  if (entry.reason) parts.push(String(entry.reason));
  if (entry.text) parts.push(String(entry.text));
  if (entry.prompt) parts.push(String(entry.prompt));
  if (entry.messageType) parts.push(`[${entry.messageType}]`);
  if (entry.campo && entry.valor) parts.push(`${entry.campo}: ${entry.valor}`);
  if (entry.status) parts.push(`estado: ${entry.status}`);
  const detail = parts.join(' · ').replace(/\s+/g, ' ').trim();
  return detail ? detail.slice(0, MAX_DETAIL) : null;
}

/** Los tipos de la bitácora que se persisten. Útil para el test y la pantalla. */
export function trackedActivityTypes() {
  return Object.keys(CLASSIFICATION);
}

/**
 * Cómo se nombra cada pregunta en pantalla. En español porque esto se lee en
 * el panel, igual que los estados de Entregables.
 */
const KIND_LABELS = {
  pregunta_no_resuelta: 'Preguntas que el bot no resolvió',
  error: 'Errores',
  respuesta_repetida: 'Respuestas repetidas',
  abandono: 'Conversaciones abandonadas'
};

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind;
}

/**
 * Agrupa filas ya leídas en el resumen de la pantalla: el total por pregunta,
 * y dentro de cada una quién la provocó.
 *
 * Es puro y aparte de la consulta a propósito: así la misma cuenta vale para
 * las filas que vienen de la base y para las que estén en memoria, y la
 * pantalla no puede decir un número distinto del que dice el resumen.
 */
export function summarise(rows = []) {
  const byKind = {};
  for (const kind of QUALITY_KINDS) {
    byKind[kind] = { total: 0, porActor: {}, porEvento: {} };
  }

  for (const row of rows) {
    const bucket = byKind[row.kind];
    if (!bucket) continue;
    bucket.total += 1;
    const actor = row.actor || 'bot';
    bucket.porActor[actor] = (bucket.porActor[actor] || 0) + 1;
    const evento = row.event_type || row.eventType;
    if (evento) bucket.porEvento[evento] = (bucket.porEvento[evento] || 0) + 1;
  }

  return {
    total: rows.length,
    // Las conversaciones distintas afectadas, que es lo que dice si son doce
    // problemas o el mismo problema doce veces en la misma conversación.
    conversaciones: new Set(rows.map((r) => r.wa_id || r.waId).filter(Boolean)).size,
    porPregunta: byKind
  };
}
