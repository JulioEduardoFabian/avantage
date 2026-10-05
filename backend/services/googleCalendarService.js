import { google } from 'googleapis';
import { db } from '../db/connection.js';

// Único permiso solicitado: crear/editar eventos en el calendario del
// asesor. No pedimos acceso a leer todo su calendario ni otros datos.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/userinfo.email'];

// Perú no aplica horario de verano, así que su offset respecto a UTC es
// siempre fijo; esto evita depender de una librería de timezones para
// calcular los bloques de disponibilidad.
const LIMA_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

const SLOT_LABEL_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

function formatSlotLabel(date) {
  const label = SLOT_LABEL_FORMATTER.format(date).replace(/\./g, '').replace(/\s([ap])\s?m\b/, ' $1.m.');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Solo la hora, para las listas de opciones de un mismo día: repetir "Sáb, 5
// set" en las tres alternativas es ruido cuando el día ya se dijo arriba.
const SLOT_TIME_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', hour: 'numeric', minute: '2-digit', hour12: true
});

function formatSlotTime(date) {
  return SLOT_TIME_FORMATTER.format(date).replace(/\./g, '').replace(/\s([ap])\s?m\b/, ' $1.m.');
}

const LIMA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Fecha del bloque en calendario de Lima, formato "YYYY-MM-DD". */
function limaDateOf(date) {
  return LIMA_DATE_FORMATTER.format(date);
}

const LIMA_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

/** Minutos transcurridos del día (hora de Lima) para un instante dado. */
function minutesOfDayLima(date) {
  const parts = LIMA_TIME_FORMATTER.formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

/**
 * Cuánto "cuesta" cada día de distancia al comparar bloques de días distintos,
 * expresado en los mismos minutos con los que se mide la cercanía a la hora
 * pedida. Sin esta penalización el orden salía solo por hora del día y un
 * bloque de mañana a las 6:30 p.m. le ganaba a uno de hoy a las 6:00 p.m.:
 * a quien pide "hoy a las 7" hay que ofrecerle primero lo de hoy, salvo que
 * lo de otro día se acerque bastante más a la hora que quiere.
 */
const DAY_DISTANCE_PENALTY_MINUTES = 45;

/**
 * Anticipación mínima con la que se puede reservar un bloque: nada que empiece
 * dentro de los próximos N minutos se ofrece. Es lo que decide si "hoy" todavía
 * es posible — con 60 minutos, a las 3:42 p.m. el bloque de las 5:30 p.m. sigue
 * ofreciéndose; antes eran 120, y perder "hoy" tan temprano en la tarde era lo
 * que más fricción generaba en el agendamiento — así que se deja configurable
 * por entorno.
 */
export const MIN_BOOKING_LEAD_MINUTES = Number(process.env.WHATSAPP_BOOKING_MIN_LEAD_MINUTES) || 60;

/** Instante de inicio del bloque, venga como candidato (`start`) o ya formateado. */
function slotStartDate(slot) {
  return slot.start instanceof Date ? slot.start : new Date(slot.startTime);
}

/** Día del bloque (calendario de Lima) como número entero, para restar días. */
function limaDayIndex(date) {
  const [y, m, d] = limaDateOf(date).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Reordena bloques libres por cercanía a una hora del día ("HH:MM", 24h, hora
 * de Lima), penalizando además cada día de distancia. Se usa cuando el lead
 * dijo a qué hora le viene bien: sin esto se le ofrecen siempre los primeros
 * bloques del día, aunque haya pedido explícitamente otra hora. Acepta tanto
 * candidatos internos como bloques ya formateados por `toFreeSlot`.
 */
function rankByProximityToTime(slots, preferredTime) {
  const [ph, pm] = String(preferredTime || '').split(':').map(Number);
  if (!Number.isFinite(ph) || !Number.isFinite(pm)) return slots;
  const preferredMinutes = ph * 60 + pm;
  if (slots.length === 0) return slots;

  const baseDay = Math.min(...slots.map((slot) => limaDayIndex(slotStartDate(slot))));
  const score = (slot) => {
    const start = slotStartDate(slot);
    const daysAway = limaDayIndex(start) - baseDay;
    return Math.abs(minutesOfDayLima(start) - preferredMinutes) + daysAway * DAY_DISTANCE_PENALTY_MINUTES;
  };

  return [...slots].sort((a, b) => (score(a) - score(b)) || (slotStartDate(a) - slotStartDate(b)));
}

/** Da forma uniforme a un bloque libre para devolverlo a los llamadores. */
function toFreeSlot(slot) {
  return {
    startTime: slot.start.toISOString(),
    endTime: slot.end.toISOString(),
    label: formatSlotLabel(slot.start),
    timeLabel: formatSlotTime(slot.start),
    date: limaDateOf(slot.start)
  };
}

/**
 * Conexión OAuth de cada asesor con su propio Google Calendar, usada para
 * crear reuniones con Google Meet directamente en su calendario real.
 */
/**
 * Deja el link de Meet limpio: sin parámetros de consulta ni fragmento.
 *
 * Google devuelve el link pelado, pero cuando alguien lo copia desde la barra
 * del navegador se lleva `?authuser=0`, y ese parámetro fuerza la PRIMERA
 * cuenta de Google del dispositivo del cliente: si tiene dos sesiones abiertas
 * entra con la equivocada o le rebota ("entré a este y nada", caso real). El
 * link que sale del sistema nunca debe llevarlo.
 */
export function sanitizeMeetLink(link) {
  const clean = String(link || '').trim();
  if (!clean) return null;
  return clean.split(/[?#]/)[0];
}

export class GoogleCalendarService {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
  }

  isConfigured() {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  createOAuthClient() {
    if (!this.isConfigured()) {
      throw new Error('Google Calendar no está configurado (faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REDIRECT_URI en el .env).');
    }
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  /**
   * URL de consentimiento de Google para que el asesor autorice su calendario.
   * `state` viaja firmado (JWT) para identificar al usuario cuando Google
   * redirija de vuelta a /api/google/callback.
   */
  getAuthUrl(state) {
    const client = this.createOAuthClient();
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // fuerza a que Google siempre devuelva refresh_token, incluso en reconexiones
      scope: SCOPES,
      state
    });
  }

  async getConnection(userId) {
    return db('google_calendar_connections').where({ user_id: userId }).first();
  }

  /**
   * Comprueba que la conexión guardada siga VIVA (no basta con que exista la
   * fila): fuerza un refresco del access token. Si el refresh token ya fue
   * revocado/expiró (`invalid_grant`), borra la conexión y devuelve
   * `connected: false` para que el panel muestre "Conectar" en vez de un
   * "Conectado" falso.
   */
  async verifyConnection(userId) {
    const connection = await this.getConnection(userId);
    if (!connection) return { connected: false, email: null };

    try {
      const client = await this.getAuthorizedClient(userId);
      const token = await client.getAccessToken(); // refresca si hace falta
      if (!token || !token.token) throw new Error('Google no devolvió un access token válido.');
      return { connected: true, email: connection.google_email };
    } catch (error) {
      const reason = String(error?.response?.data?.error || error?.message || '');
      if (reason.includes('invalid_grant')) {
        await db('google_calendar_connections').where({ user_id: userId }).delete().catch(() => {});
        console.warn(`⚠️ [Google Calendar] La conexión del usuario ${userId} ya no es válida (invalid_grant); se eliminó. El asesor debe reconectar.`);
        return { connected: false, email: null, needsReconnect: true };
      }
      // Otro tipo de error (red, cuota, etc.): no se borra la conexión, pero
      // se avisa de que no se pudo verificar en este momento.
      console.warn(`⚠️ [Google Calendar] No se pudo verificar la conexión del usuario ${userId}: ${reason}`);
      return { connected: true, email: connection.google_email, warning: reason };
    }
  }

  async saveConnectionFromCode(userId, code) {
    const client = this.createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const existing = await this.getConnection(userId);
    const payload = {
      user_id: userId,
      google_email: userInfo.email || null,
      access_token: tokens.access_token,
      // Google solo manda refresh_token la primera vez que el usuario
      // autoriza (o si se fuerza con prompt=consent); si no viene, se
      // conserva el que ya teníamos guardado.
      refresh_token: tokens.refresh_token || existing?.refresh_token || null,
      access_token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope || null,
      updated_at: db.fn.now()
    };

    if (existing) {
      await db('google_calendar_connections').where({ user_id: userId }).update(payload);
    } else {
      await db('google_calendar_connections').insert(payload);
    }

    return this.getConnection(userId);
  }

  async disconnect(userId) {
    const connection = await this.getConnection(userId);
    if (!connection) return;

    try {
      const client = this.createOAuthClient();
      await client.revokeToken(connection.refresh_token || connection.access_token);
    } catch (error) {
      // La revocación puede fallar si el token ya venció o el usuario lo
      // revocó manualmente desde su cuenta de Google; no es bloqueante,
      // igual borramos la conexión guardada.
      console.warn('⚠️ [Google Calendar] No se pudo revocar el token en Google:', error.message);
    }

    await db('google_calendar_connections').where({ user_id: userId }).delete();
  }

  /**
   * Cuando Google responde `invalid_grant`, el refresh token del asesor ya no
   * sirve (lo revocó, caducó por inactividad, o cambió su contraseña). Se
   * borra la conexión guardada para que el panel muestre "no conectado" y el
   * asesor sepa que tiene que volver a autorizar, y se lanza un error claro
   * (code GOOGLE_RECONNECT_REQUIRED) en vez del críptico "invalid_grant".
   */
  async handleTokenError(userId, error) {
    const reason = String(error?.response?.data?.error || error?.message || '');
    if (reason.includes('invalid_grant')) {
      try {
        await db('google_calendar_connections').where({ user_id: userId }).delete();
      } catch (dbError) {
        console.error('❌ [Google Calendar] Error al borrar la conexión caducada:', dbError);
      }
      console.warn(`⚠️ [Google Calendar] El refresh token del usuario ${userId} ya no es válido (invalid_grant); se eliminó la conexión. El asesor debe volver a conectar su Google Calendar desde "Disponibilidad".`);
      const friendly = new Error('La conexión de Google Calendar del asesor caducó. Debe volver a conectarla desde la sección "Disponibilidad".');
      friendly.code = 'GOOGLE_RECONNECT_REQUIRED';
      throw friendly;
    }
    throw error;
  }

  /**
   * Cliente OAuth2 listo para llamar la API, con refresco automático del
   * access_token (googleapis lo renueva solo si está por vencer) y persiste
   * el access_token renovado para no repetir el refresh en cada llamada.
   */
  async getAuthorizedClient(userId) {
    const connection = await this.getConnection(userId);
    if (!connection) {
      throw new Error('Este usuario no tiene conectado su Google Calendar.');
    }

    const client = this.createOAuthClient();
    client.setCredentials({
      access_token: connection.access_token,
      refresh_token: connection.refresh_token,
      expiry_date: connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : null
    });

    client.on('tokens', (tokens) => {
      const update = {};
      if (tokens.access_token) update.access_token = tokens.access_token;
      if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;
      if (tokens.expiry_date) update.access_token_expires_at = new Date(tokens.expiry_date);
      if (Object.keys(update).length > 0) {
        update.updated_at = db.fn.now();
        db('google_calendar_connections').where({ user_id: userId }).update(update).catch((error) => {
          console.error('❌ [Google Calendar] Error al guardar el token renovado:', error);
        });
      }
    });

    return client;
  }

  /**
   * Crea un evento con Google Meet en el calendario del asesor y devuelve el
   * link de la reunión. `startTime`/`endTime` deben ser ISO 8601 con
   * timezone (ej: 2026-03-28T14:00:00-05:00).
   */
  /**
   * `attendeeEmail` es el invitado de siempre (el lead). `extraAttendees` suma
   * otros correos: lo usa la reunión cargada a mano cuando el closer no tiene
   * su Google conectado y el evento se crea en el calendario de quien la
   * agenda — el closer entra como invitado para que igual le llegue a su
   * correo y le aparezca en su agenda.
   */
  async createMeetEvent(userId, { summary, description, startTime, endTime, attendeeEmail, extraAttendees = [], timeZone = 'America/Lima' }) {
    const client = await this.getAuthorizedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth: client });

    const attendees = [...(attendeeEmail ? [attendeeEmail] : []), ...extraAttendees]
      .map((email) => String(email || '').trim())
      .filter(Boolean)
      .filter((email, index, todos) => todos.indexOf(email) === index)
      .map((email) => ({ email }));

    let data;
    try {
      ({ data } = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: attendees.length > 0 ? 'all' : 'none',
      requestBody: {
        summary,
        description,
        start: { dateTime: startTime, timeZone },
        end: { dateTime: endTime, timeZone },
        attendees,
        conferenceData: {
          createRequest: {
            requestId: `avan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      }
      }));
    } catch (error) {
      await this.handleTokenError(userId, error);
    }

    return {
      eventId: data.id,
      meetLink: sanitizeMeetLink(data.hangoutLink),
      htmlLink: data.htmlLink || null,
      start: data.start,
      end: data.end
    };
  }

  /**
   * Descarta de `candidates` los bloques que se cruzan con eventos ya
   * existentes en el Google Calendar real del asesor. Se usa events.list (no
   * freebusy.query) porque el scope pedido al asesor es "calendar.events"
   * (solo eventos), y freebusy.query exige el scope más amplio
   * "calendar"/"calendar.readonly" que no solicitamos.
   */
  async filterAgainstCalendar(userId, candidates) {
    if (candidates.length === 0) return [];

    const client = await this.getAuthorizedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth: client });
    let data;
    try {
      ({ data } = await calendar.events.list({
        calendarId: 'primary',
        timeMin: candidates[0].start.toISOString(),
        timeMax: candidates[candidates.length - 1].end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      }));
    } catch (error) {
      await this.handleTokenError(userId, error);
    }
    const busyPeriods = (data.items || [])
      .filter((event) => event.status !== 'cancelled' && event.start?.dateTime && event.end?.dateTime)
      .map((event) => ({ start: new Date(event.start.dateTime).getTime(), end: new Date(event.end.dateTime).getTime() }));

    return candidates.filter((slot) => !busyPeriods.some((busy) => (
      slot.start.getTime() < busy.end && slot.end.getTime() > busy.start
    )));
  }

  /**
   * Bloques candidatos (sin cruzar aún con el calendario real) para los
   * próximos `days` días a partir de hoy, según el horario semanal
   * recurrente del asesor (`advisor_availability`).
   */
  buildCandidateSlots(availabilityRows, { days, slotMinutes, minLeadTimeMinutes }) {
    const startsByDay = new Map();
    for (const row of availabilityRows) {
      if (!startsByDay.has(row.day_of_week)) startsByDay.set(row.day_of_week, []);
      startsByDay.get(row.day_of_week).push(row.start_time);
    }

    const now = new Date();
    const minStart = new Date(now.getTime() + minLeadTimeMinutes * 60000);

    const limaTodayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const [limaY, limaM, limaD] = limaTodayStr.split('-').map(Number);
    const limaMidnightUTC = Date.UTC(limaY, limaM - 1, limaD) + LIMA_UTC_OFFSET_MS;

    const candidates = [];
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const dayStartUTC = limaMidnightUTC + dayOffset * 86400000;
      const jsWeekday = new Date(dayStartUTC).getUTCDay(); // 0=Dom..6=Sáb
      const dayOfWeek = (jsWeekday + 6) % 7; // 0=Lun..6=Dom, igual que advisor_availability
      const starts = startsByDay.get(dayOfWeek);
      if (!starts) continue;

      for (const hhmm of starts) {
        const [h, m] = hhmm.split(':').map(Number);
        const startUTC = dayStartUTC + (h * 3600 + m * 60) * 1000;
        const start = new Date(startUTC);
        if (start < minStart) continue;
        candidates.push({ start, end: new Date(startUTC + slotMinutes * 60000) });
      }
    }

    candidates.sort((a, b) => a.start - b.start);
    return candidates;
  }

  /**
   * Calcula los próximos bloques libres del asesor cruzando su horario
   * semanal recurrente con los eventos ya existentes en su Google Calendar
   * real, para ofrecerlos como opciones concretas de agendamiento. Se usa
   * como respaldo cuando un día específico pedido no tiene espacio, para
   * sugerir las próximas opciones reales en vez de un simple "no hay".
   */
  async getUpcomingFreeSlots(userId, { days = 14, limit = 3, slotMinutes = 30, minLeadTimeMinutes = MIN_BOOKING_LEAD_MINUTES } = {}) {
    const availabilityRows = await db('advisor_availability').where({ user_id: userId }).select('day_of_week', 'start_time');
    if (availabilityRows.length === 0) return [];

    const candidates = this.buildCandidateSlots(availabilityRows, { days, slotMinutes, minLeadTimeMinutes });
    if (candidates.length === 0) return [];

    const freeSlots = await this.filterAgainstCalendar(userId, candidates);
    return freeSlots.slice(0, limit).map(toFreeSlot);
  }

  /**
   * Bloques libres del asesor para UN día específico (`dateStr` en formato
   * "YYYY-MM-DD", calendario de Lima) — usado cuando el lead ya dijo qué día
   * prefiere, en vez de mostrarle una lista genérica de próximos horarios.
   */
  async getFreeSlotsForDate(userId, dateStr, { slotMinutes = 30, minLeadTimeMinutes = MIN_BOOKING_LEAD_MINUTES, limit = 3, nearTime = null } = {}) {
    const availabilityRows = await db('advisor_availability').where({ user_id: userId }).select('day_of_week', 'start_time');
    if (availabilityRows.length === 0) return [];

    const [y, m, d] = dateStr.split('-').map(Number);
    const dayStartUTC = Date.UTC(y, m - 1, d) + LIMA_UTC_OFFSET_MS;
    const jsWeekday = new Date(dayStartUTC).getUTCDay();
    const dayOfWeek = (jsWeekday + 6) % 7;
    const starts = availabilityRows.filter((row) => row.day_of_week === dayOfWeek).map((row) => row.start_time);
    if (starts.length === 0) return [];

    const now = new Date();
    const minStart = new Date(now.getTime() + minLeadTimeMinutes * 60000);

    const candidates = [];
    for (const hhmm of starts) {
      const [h, mnt] = hhmm.split(':').map(Number);
      const startUTC = dayStartUTC + (h * 3600 + mnt * 60) * 1000;
      const start = new Date(startUTC);
      if (start < minStart) continue;
      candidates.push({ start, end: new Date(startUTC + slotMinutes * 60000) });
    }
    if (candidates.length === 0) return [];
    candidates.sort((a, b) => a.start - b.start);

    const freeSlots = await this.filterAgainstCalendar(userId, candidates);
    // Si el lead dijo también una hora ("hoy a las 6 pm"), se le ofrecen los
    // bloques más cercanos a esa hora en vez de los primeros del día.
    const ordered = nearTime ? rankByProximityToTime(freeSlots, nearTime) : freeSlots;
    return ordered.slice(0, limit).map(toFreeSlot);
  }

  /**
   * Los `limit` bloques libres (en los próximos `days` días) cuya hora del
   * día está más cerca de `preferredTime` ("HH:MM", 24h, hora de Lima) — se
   * usa cuando el lead pidió un horario que no estaba en la lista ofrecida
   * (ej. "no tienes más de noche?"), para sugerirle lo más cercano a lo que
   * realmente quiere en vez de repetirle la misma lista que ya rechazó.
   */
  async getFreeSlotsNearTime(userId, preferredTime, { days = 14, limit = 3, slotMinutes = 30, minLeadTimeMinutes = MIN_BOOKING_LEAD_MINUTES } = {}) {
    const availabilityRows = await db('advisor_availability').where({ user_id: userId }).select('day_of_week', 'start_time');
    if (availabilityRows.length === 0) return [];

    const candidates = this.buildCandidateSlots(availabilityRows, { days, slotMinutes, minLeadTimeMinutes });
    if (candidates.length === 0) return [];

    const freeSlots = await this.filterAgainstCalendar(userId, candidates);
    if (freeSlots.length === 0) return [];

    return rankByProximityToTime(freeSlots, preferredTime).slice(0, limit).map(toFreeSlot);
  }

  /**
   * Reordena por cercanía a una hora bloques que YA vienen formateados (los
   * que devuelven los métodos de arriba). Lo usa el bot cuando junta los
   * horarios de un día con los de otros días y necesita que la lista final
   * salga en un solo orden coherente.
   */
  rankFreeSlots(freeSlots, preferredTime) {
    return rankByProximityToTime(freeSlots || [], preferredTime);
  }
}
