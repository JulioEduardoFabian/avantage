import { db } from '../db/connection.js';
import { limaDayStart } from './scheduledMeetingService.js';
import { normalizeGoogleEvent, planCalendarSync, planMeetingUpdate } from './calendarSync.js';

/**
 * Trae al panel lo que pasó en el Google Calendar de cada asesor.
 *
 * El panel sabía ESCRIBIR en Google (al agendar crea el evento) pero nunca
 * volvía a leerlo, y por esa mitad que faltaba se colaban los tres casos que
 * más duelen: el asesor mueve la reunión en su calendario y el panel sigue
 * mostrando la hora vieja —con la que el bot le manda el recordatorio al
 * lead—; el asesor borra el evento y la reunión sigue en la agenda del
 * equipo; el asesor agenda algo directamente en Google y el panel no se
 * entera.
 *
 * La dirección es **de Google al panel** y en un solo sentido: acá no se crea,
 * ni se mueve, ni se cancela ningún evento. Google es la verdad y el panel se
 * acomoda, así que apretar el botón nunca puede estropear el calendario de
 * nadie — que es lo que permite ofrecerlo como un botón y no como un proceso
 * que haya que supervisar.
 *
 * Recorre a TODO el área comercial que tenga su Google conectado
 * (`userService.listCommercialTeam()`, el mismo criterio por permiso que la
 * asignación de leads y el resto del Calendario), porque la agenda del panel
 * es la del equipo: sincronizar solo al que aprieta el botón dejaría al resto
 * con las horas viejas.
 *
 * Un asesor cuya conexión falló no detiene a los demás: su error se junta y
 * viaja en la respuesta. Lo contrario —cortar en el primer token caducado—
 * haría que un solo asesor sin reconectar dejara al equipo entero sin
 * sincronizar.
 */
export class CalendarSyncService {
  constructor({ googleCalendarService = null, userService = null } = {}) {
    this.google = googleCalendarService;
    this.userService = userService;
  }

  /**
   * Sincroniza el rango `from`–`to` (días de calendario de Lima, inclusive) y
   * devuelve el resumen de lo que cambió, que es lo que la pantalla le
   * muestra a quien apretó el botón: un botón que no dice qué hizo obliga a
   * revisar el mes entero a mano para saber si sirvió.
   */
  async sync({ from, to } = {}) {
    if (!this.google?.isConfigured()) {
      throw new Error('El panel no tiene configurada la conexión con Google Calendar.');
    }
    if (!from || !to) throw new Error('Hay que indicar el rango de fechas a sincronizar.');

    const timeMin = limaDayStart(from);
    const timeMax = limaDayStart(to, 1);
    if (!(timeMax > timeMin)) throw new Error('El rango de fechas a sincronizar no es válido.');

    const equipo = await this.userService.listCommercialTeam();
    const conectados = new Set(await db('google_calendar_connections').pluck('user_id'));
    const asesores = equipo.filter((usuario) => conectados.has(usuario.id));

    const resumen = {
      advisors: asesores.length,
      imported: 0,
      updated: 0,
      cancelled: 0,
      restored: 0,
      skippedAllDay: 0,
      checked: 0,
      errors: []
    };
    if (asesores.length === 0) return resumen;

    const now = new Date();
    // Los ids de evento que el panel YA tiene, de todos los asesores y de
    // cualquier fecha: un evento con varios invitados es el mismo evento en
    // los dos calendarios, y uno movido fuera del rango sigue estando en el
    // panel. Sin esta mirada completa, sincronizar importaría duplicados.
    const knownEventIds = new Set(
      await db('scheduled_meetings').whereNotNull('calendar_event_id').pluck('calendar_event_id')
    );

    for (const asesor of asesores) {
      try {
        const events = await this.google.listEvents(asesor.id, { timeMin, timeMax });
        const meetings = await db('scheduled_meetings')
          .where({ advisor_user_id: asesor.id })
          .where('start_time', '>=', timeMin)
          .where('start_time', '<', timeMax)
          .select('id', 'calendar_event_id', 'start_time', 'end_time', 'meet_link', 'cancelled_at', 'reminder_sent_at');

        const plan = planCalendarSync({ meetings, events, knownEventIds, advisorUserId: asesor.id, now });
        resumen.checked += meetings.length;
        resumen.skippedAllDay += plan.skipped.allDay;

        /*
         * Las que no vinieron en la lista se resuelven de a una: no estar en el
         * rango consultado no significa que ya no exista — el asesor pudo
         * haberla movido al mes siguiente, y marcarla cancelada sería borrar
         * del panel una reunión que sigue en pie.
         */
        for (const meeting of plan.missing) {
          const crudo = await this.google.getEvent(asesor.id, meeting.calendar_event_id);
          const evento = crudo ? normalizeGoogleEvent(crudo) : null;
          const planned = planMeetingUpdate(meeting, evento, { now });
          if (planned) plan.updates.push({ meetingId: meeting.id, ...planned });
        }

        for (const { meetingId, patch } of plan.updates) {
          await db('scheduled_meetings').where({ id: meetingId }).update({ ...patch, synced_at: now });
          if (patch.cancelled_at) resumen.cancelled += 1;
          else if (patch.cancelled_at === null && !patch.start_time) resumen.restored += 1;
          else resumen.updated += 1;
        }

        for (const fila of plan.imports) {
          await db('scheduled_meetings').insert({ ...fila, synced_at: now });
          // El panel ya conoce este evento: si el mismo evento aparece en el
          // calendario de otro asesor del equipo, no se importa dos veces.
          knownEventIds.add(fila.calendar_event_id);
          resumen.imported += 1;
        }

        // Las que se compararon y no cambiaron también quedan sincronizadas:
        // `synced_at` dice "esto se miró contra Google", no "esto cambió".
        await db('scheduled_meetings')
          .where({ advisor_user_id: asesor.id })
          .where('start_time', '>=', timeMin)
          .where('start_time', '<', timeMax)
          .update({ synced_at: now });
      } catch (error) {
        // `GOOGLE_RECONNECT_REQUIRED` ya trae un texto que dice qué hacer (y
        // la conexión caducada quedó borrada, así que el panel mostrará
        // "Conectar"). Cualquier otro error va con su mensaje crudo: quien
        // aprieta el botón necesita poder reenviárselo a quien lo arregle.
        resumen.errors.push({ advisor: asesor.name || `Usuario ${asesor.id}`, reason: error.message });
        console.error(`❌ [Calendario] No se pudo sincronizar el calendario de ${asesor.name || asesor.id}:`, error.message);
      }
    }

    return resumen;
  }
}
