/**
 * Las reglas de "qué hay que cambiar en el panel" al sincronizar con Google
 * Calendar, sin tocar la base de datos ni la API de Google.
 *
 * Están aparte del servicio (`calendarSyncService.js`) por lo mismo que
 * `leadRouting.js` y `winDeal.js`: es la parte que decide, y las decisiones de
 * un botón que reescribe horas de reuniones y marca cancelaciones tienen que
 * poder probarse sin credenciales de Google.
 *
 * La dirección es **de Google al panel**: Google es la verdad y el panel se
 * acomoda. Nada de acá crea ni modifica eventos en el calendario de nadie.
 */

/**
 * Un evento de Google reducido a lo que el panel necesita. Devuelve `null`
 * cuando no se puede ubicar en la agenda:
 *
 * - **Día completo** (`start.date` en vez de `start.dateTime`): el Calendario
 *   es una grilla de horas y un evento sin hora no cae en ninguna franja.
 *   Anclarlo a las 00:00 lo pondría todos los días en la lista de "fuera del
 *   horario", diciendo una hora que nadie puso. Se cuentan aparte y la
 *   respuesta los informa, para que no desaparezcan en silencio.
 * - **Sin id**: no habría con qué reconocerlo la próxima vez, así que
 *   sincronizar dos veces lo importaría dos veces.
 */
export function normalizeGoogleEvent(event) {
  const id = event?.id;
  if (!id) return null;

  const startIso = event?.start?.dateTime;
  const endIso = event?.end?.dateTime;
  if (!startIso || !endIso) return { id, allDay: true, cancelled: event?.status === 'cancelled' };

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  // El invitado es con QUIÉN es la reunión: el primero que no sea la propia
  // cuenta del asesor ni una sala. Google marca la cuenta del dueño del
  // calendario con `self`, y los recursos (salas, proyectores) con `resource`.
  const guest = (event.attendees || []).find((person) => !person.self && !person.resource && person.email);

  return {
    id,
    allDay: false,
    cancelled: event.status === 'cancelled',
    startTime: start,
    endTime: end,
    summary: String(event.summary || '').trim() || null,
    meetLink: cleanMeetLink(event.hangoutLink),
    guestName: (guest?.displayName || '').trim() || null,
    guestEmail: (guest?.email || '').trim() || null
  };
}

/**
 * El enlace de Meet, sin los parámetros que arrastra un copiado desde el
 * navegador (`?authuser=0` fuerza la primera cuenta de Google del dispositivo
 * del cliente — ver `sanitizeMeetLink`). Se repite acá en vez de importarlo
 * para que este módulo no dependa de `googleapis`.
 */
function cleanMeetLink(link) {
  const clean = String(link || '').trim();
  return clean ? clean.split(/[?#]/)[0] : null;
}

function sameInstant(a, b) {
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * Qué hacer con una reunión del panel que YA tiene su evento, a la luz de ese
 * evento. Devuelve `{ patch, reason }` —el parche son columnas de
 * `scheduled_meetings` y nada más, para que quien lo aplique pueda escribirlo
 * tal cual— o `null` si no cambió nada.
 *
 * Dos reglas que no son obvias:
 *
 * - **Si la reunión se movió, el recordatorio se vuelve a habilitar**
 *   (`reminder_sent_at: null`). El que ya salió nombraba la hora vieja, así que
 *   dejarlo marcado como enviado es garantizar que el lead se presente a la
 *   hora equivocada. Solo se reabre cuando la hora nueva todavía está por
 *   venir: resucitar el recordatorio de una reunión que ya pasó sería mandarle
 *   un aviso de algo que terminó.
 * - **Un evento que volvió a aparecer se des-cancela.** Restaurar un evento
 *   borrado en Google es un clic; si el panel se quedara con la marca, la
 *   reunión seguiría tachada para siempre y sin forma de arreglarlo desde acá.
 */
export function planMeetingUpdate(meeting, event, { now = new Date() } = {}) {
  const patch = {};

  // Sin evento (lo borraron en Google) o cancelado: se marca, no se borra.
  if (!event || event.cancelled) {
    if (meeting.cancelled_at) return null;
    return { patch: { cancelled_at: now }, reason: 'cancelada en Google' };
  }

  if (meeting.cancelled_at) patch.cancelled_at = null;

  if (event.allDay) {
    // Pasó a ser de día completo: no hay hora que copiar, pero tampoco está
    // cancelada. Se deja como está (solo se des-cancela si hacía falta).
    return Object.keys(patch).length > 0 ? { patch, reason: 'restaurada en Google' } : null;
  }

  const moved = !sameInstant(meeting.start_time, event.startTime) || !sameInstant(meeting.end_time, event.endTime);
  if (moved) {
    patch.start_time = event.startTime;
    patch.end_time = event.endTime;
    if (meeting.reminder_sent_at && event.startTime > now) patch.reminder_sent_at = null;
  }

  const linkChanged = (meeting.meet_link || null) !== (event.meetLink || null);
  if (linkChanged) patch.meet_link = event.meetLink;

  if (Object.keys(patch).length === 0) return null;

  const reason = moved
    ? 'movida en Google'
    : (patch.cancelled_at === null ? 'restaurada en Google' : 'enlace actualizado');
  return { patch, reason };
}

/**
 * Cómo entra al panel un evento que el Calendario no conocía.
 *
 * El tema es el título del evento y con quién es la reunión sale del invitado:
 * son los dos datos que hacen que la fila diga algo. La modalidad queda en
 * `meet` siempre —es el valor por defecto de la columna— porque `llamada`
 * afirma que la reunión es telefónica, y de un evento ajeno no se sabe: lo
 * único cierto es que no tiene sala de Meet, y eso ya lo dice el enlace vacío.
 */
export function planMeetingImport(event, advisorUserId) {
  return {
    advisor_user_id: advisorUserId,
    calendar_event_id: event.id,
    start_time: event.startTime,
    end_time: event.endTime,
    // Recortado al largo de cada columna: un título kilométrico en un solo
    // evento no puede hacer fallar la sincronización de todo un asesor.
    topic: cut(event.summary, 500),
    contact_name: cut(event.guestName, 160),
    attendee_email: cut(event.guestEmail, 255),
    meet_link: cut(event.meetLink, 500),
    source: 'google',
    modality: 'meet'
  };
}

function cut(text, max) {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * El plan completo para UN asesor: qué actualizar, qué importar y qué eventos
 * hay que ir a buscar de a uno.
 *
 * `meetings` son las filas del panel de ese asesor en el rango que se está
 * sincronizando; `events` los eventos crudos que devolvió Google para el mismo
 * rango; `knownEventIds` todos los `calendar_event_id` que el panel ya tiene
 * **de cualquier asesor**, porque un evento con varios invitados es el MISMO
 * evento en los dos calendarios: sin eso, sincronizar al segundo asesor
 * importaría un duplicado de la reunión que el primero ya trajo.
 *
 * `missing` es la parte sutil: una reunión del panel cuyo evento no vino en la
 * lista puede estar borrada... o movida FUERA del rango que se consultó (el
 * asesor la pasó al mes siguiente). Marcarla cancelada sin preguntar borraría
 * del panel una reunión que existe. Por eso esas se devuelven aparte, para
 * resolverlas una por una contra Google (`events.get`) — son pocas, justo las
 * que no coinciden.
 */
export function planCalendarSync({ meetings = [], events = [], knownEventIds = new Set(), advisorUserId = null, now = new Date() } = {}) {
  const normalized = [];
  const skipped = { allDay: 0, invalid: 0 };

  for (const raw of events) {
    const event = normalizeGoogleEvent(raw);
    if (!event) { skipped.invalid += 1; continue; }
    normalized.push(event);
  }

  const byId = new Map(normalized.map((event) => [event.id, event]));

  const updates = [];
  const missing = [];
  const seen = new Set();

  for (const meeting of meetings) {
    if (!meeting.calendar_event_id) continue; // nació sin evento: no hay nada que comparar
    seen.add(meeting.calendar_event_id);

    const event = byId.get(meeting.calendar_event_id);
    if (!event) { missing.push(meeting); continue; }

    const planned = planMeetingUpdate(meeting, event, { now });
    if (planned) updates.push({ meetingId: meeting.id, ...planned });
  }

  const imports = [];
  for (const event of normalized) {
    if (seen.has(event.id) || knownEventIds.has(event.id)) continue;
    // Un evento ya cancelado que el panel nunca tuvo no es una reunión: es
    // basura de la papelera de Google.
    if (event.cancelled) continue;
    if (event.allDay) { skipped.allDay += 1; continue; }
    imports.push(planMeetingImport(event, advisorUserId));
  }

  return { updates, imports, missing, skipped };
}
