import { db } from '../db/connection.js';
import { firstRealName } from './contactName.js';

/**
 * Registro propio de las reuniones que Avan agenda automáticamente (además
 * del evento real que ya vive en Google Calendar), para poder listarlas
 * dentro del panel de Avantage sin depender de una consulta en vivo a la API
 * de Google.
 */
export class ScheduledMeetingService {
  constructor({ googleCalendarService = null } = {}) {
    // Opcional: solo lo necesita la reunión cargada a mano desde el panel. El
    // bot ya trae su propio cliente de Google cuando llama a create().
    this.google = googleCalendarService;
  }

  async create({ leadId, waId, advisorUserId, topic, startTime, endTime, meetLink, calendarEventId, createdBy = null, attendeeEmail = null, source = 'bot', contactName = null, modality = 'meet' }) {
    const [id] = await db('scheduled_meetings').insert({
      lead_id: leadId ?? null,
      wa_id: waId || null,
      advisor_user_id: advisorUserId,
      topic: topic || null,
      start_time: new Date(startTime),
      end_time: new Date(endTime),
      meet_link: meetLink || null,
      calendar_event_id: calendarEventId || null,
      created_by: createdBy,
      attendee_email: attendeeEmail,
      source,
      // El marcador que el bot le pone a un contacto sin nombre de perfil no
      // es un nombre: se guarda vacío para que la agenda caiga al teléfono,
      // que al menos identifica a la persona.
      contact_name: firstRealName(contactName),
      modality: modality === 'llamada' ? 'llamada' : 'meet'
    });
    return db('scheduled_meetings').where({ id }).first();
  }

  /**
   * Agenda una reunión a mano, desde el Calendario o desde la ficha del lead.
   *
   * El evento va al Google Calendar **del closer**, que es de quien es la
   * reunión. Si él no tiene su cuenta conectada se crea en el calendario de
   * quien la está agendando y se lo invita por correo: así le llega igual y le
   * aparece en su agenda, que es lo que se busca.
   *
   * **Una reunión por Meet exige que haya una conexión con Google.** Antes se
   * guardaba igual sin evento ni enlace y la pantalla lo avisaba, pero eso deja
   * al asesor con una videollamada sin sala: el aviso se lee una vez y la cita
   * queda ahí, con su hora y su cliente, pareciendo completa. Ahora esa
   * combinación se rechaza **antes** de guardar nada, y el error nombra las dos
   * salidas: conectar Google o marcar la reunión como telefónica.
   *
   * `modality: 'llamada'` es esa segunda salida y no un atajo para saltarse la
   * regla: la reunión por teléfono no necesita sala, se guarda aunque no haya
   * ninguna conexión, y su evento —si se puede crear— va al calendario sin
   * Meet. Queda escrito en la fila en vez de deducirse de que falte el enlace,
   * que es exactamente lo que también le pasa a una reunión rota.
   */
  async bookManual({ leadId = null, advisorUserId, topic, startTime, endTime, attendeeEmail = null, createdBy = null, waId = null, contactName = null, modality = 'meet' }) {
    if (!advisorUserId) throw new Error('Hay que elegir al asesor de la reunión.');
    const inicio = new Date(startTime);
    const fin = new Date(endTime);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      throw new Error('La fecha y la hora de la reunión no son válidas.');
    }
    if (fin <= inicio) throw new Error('La reunión no puede terminar antes de empezar.');

    const porMeet = modality !== 'llamada';

    // Los dos calendarios donde puede caer el evento, en orden: el del asesor
    // —de quien es la reunión— y, de respaldo, el de quien la agenda, con el
    // asesor invitado por correo.
    const candidatos = [
      { userId: advisorUserId, extra: [] },
      ...(createdBy && createdBy !== advisorUserId ? [{ userId: createdBy, extra: 'advisor' }] : [])
    ];

    /*
     * La conexión se comprueba ANTES de tocar nada. Dejárselo al fallo de
     * `createMeetEvent` serviría para avisar, pero no para NO guardar, que es
     * justamente lo que hay que evitar: la videollamada agendada sin sala.
     */
    if (porMeet) {
      const motivo = await this.meetBlockedReason(candidatos.map((candidato) => candidato.userId));
      if (motivo) throw new Error(motivo);
    }

    let evento = null;
    let calendarError = null;
    let calendarOwner = null;

    if (this.google) {
      for (const candidato of candidatos) {
        try {
          const asesor = await db('users').where({ id: advisorUserId }).first();
          evento = await this.google.createMeetEvent(candidato.userId, {
            summary: topic || 'Reunión con Avantage Group',
            description: topic || 'Reunión agendada desde el panel de Avantage.',
            startTime: inicio.toISOString(),
            endTime: fin.toISOString(),
            attendeeEmail,
            extraAttendees: candidato.extra === 'advisor' && asesor?.email ? [asesor.email] : [],
            withMeet: porMeet
          });
          calendarOwner = candidato.userId;
          calendarError = null;
          break;
        } catch (error) {
          calendarError = error.message;
        }
      }
    } else {
      calendarError = 'El panel no tiene configurada la conexión con Google Calendar.';
    }

    // Había conexión y aun así no hubo evento (el token se revocó entre la
    // comprobación y el alta, cuota de Google, la red). Para una videollamada
    // eso sigue siendo una reunión sin sala: no se guarda.
    if (porMeet && !evento) {
      throw new Error(`No se pudo crear el evento de Google Meet: ${calendarError} Vuelve a intentarlo, o marca la reunión como telefónica para agendarla sin Meet.`);
    }

    const meeting = await this.create({
      leadId,
      waId,
      advisorUserId,
      topic,
      startTime: inicio,
      endTime: fin,
      meetLink: evento?.meetLink || null,
      calendarEventId: evento?.eventId || null,
      createdBy,
      attendeeEmail,
      source: 'manual',
      contactName,
      modality
    });

    /*
     * El evento salió pero Google no devolvió sala (pasa con cuentas de
     * Workspace que tienen Meet desactivado). La cita ya está en el calendario
     * del asesor, así que tirarla abajo sería peor que decirlo: se guarda y la
     * pantalla lo avisa.
     */
    if (porMeet && !evento.meetLink) {
      calendarError = 'Google creó el evento pero no generó el enlace de Meet; revisa los permisos de Meet de esa cuenta.';
    }

    return { meeting: await this.getById(meeting.id), calendarError, calendarOwner };
  }

  /**
   * Por qué NO se puede agendar por Meet, o `null` si sí se puede.
   *
   * Mira únicamente que exista una conexión guardada: verificarla contra Google
   * en cada alta agregaría un viaje de red al camino más caliente del
   * formulario, y el intento real de crear el evento —que viene justo después—
   * ya cubre el caso del token revocado.
   */
  async meetBlockedReason(userIds) {
    if (!this.google) {
      return 'El panel no tiene configurada la conexión con Google Calendar, así que no puede crear la sala de Meet. Marca la reunión como telefónica para agendarla igual.';
    }
    for (const userId of userIds) {
      if (await this.google.getConnection(userId)) return null;
    }
    return 'Para agendar por Google Meet hace falta una cuenta de Google conectada: la del asesor o la tuya. Conéctala en "Mi Disponibilidad", o marca la reunión como telefónica para agendarla sin Meet.';
  }

  /**
   * Próximas reuniones (desde ahora en adelante), con nombre/teléfono del
   * lead asociado cuando existe.
   *
   * Las canceladas en Google quedan fuera, acá y en todas las lecturas salvo
   * la del Calendario: una reunión que ya no está en el calendario del asesor
   * no es una próxima reunión. Ver `cancelled_at` en
   * `calendarSyncService.js`.
   */
  async getUpcoming({ limit = 50 } = {}) {
    return withContactLabel(await db('scheduled_meetings')
      .leftJoin('leads', 'leads.id', 'scheduled_meetings.lead_id')
      .select(
        'scheduled_meetings.*',
        'leads.full_name as lead_full_name',
        'leads.phone as lead_phone',
        'leads.email as lead_email',
        'leads.topic as lead_topic'
      )
      .where('scheduled_meetings.start_time', '>=', db.fn.now())
      .whereNull('scheduled_meetings.cancelled_at')
      .orderBy('scheduled_meetings.start_time', 'asc')
      .limit(limit));
  }

  /**
   * Todas las reuniones de un día del calendario de Lima, de la primera a la
   * última. Es la agenda que se le manda al vendedor cada mañana.
   *
   * Perú no cambia de hora en todo el año (UTC-5 siempre), así que el día
   * local va de las 05:00 UTC de ese día a las 05:00 UTC del siguiente — el
   * mismo corte que usa el volcado diario de conversaciones.
   */
  async getForDay(dateIso) {
    const [y, m, d] = String(dateIso).split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return withContactLabel(await db('scheduled_meetings')
      .leftJoin('leads', 'leads.id', 'scheduled_meetings.lead_id')
      .select(
        'scheduled_meetings.*',
        'leads.full_name as lead_full_name',
        'leads.phone as lead_phone',
        'leads.topic as lead_topic'
      )
      .where('scheduled_meetings.start_time', '>=', start)
      .where('scheduled_meetings.start_time', '<', end)
      .whereNull('scheduled_meetings.cancelled_at')
      .orderBy('scheduled_meetings.start_time', 'asc'));
  }

  /**
   * Reuniones que ya toca recordarle al contacto: empiezan dentro de las
   * próximas `leadMs` (pero todavía no empezaron) y aún no tienen
   * recordatorio. `minAgeMs` deja fuera las que se acaban de agendar: si
   * alguien reserva para dentro de cincuenta minutos, mandarle un
   * "te recuerdo tu reunión" a los cinco minutos de confirmarla sobra.
   */
  async getPendingReminders({ leadMs, minAgeMs = 0 } = {}) {
    const now = Date.now();
    return db('scheduled_meetings')
      .leftJoin('leads', 'leads.id', 'scheduled_meetings.lead_id')
      .select('scheduled_meetings.*', 'leads.full_name as lead_full_name')
      .whereNull('scheduled_meetings.reminder_sent_at')
      // Cancelada en Google: no se le recuerda al lead una reunión que el
      // asesor ya borró de su calendario.
      .whereNull('scheduled_meetings.cancelled_at')
      .where('scheduled_meetings.start_time', '>', new Date(now))
      .where('scheduled_meetings.start_time', '<=', new Date(now + leadMs))
      .where('scheduled_meetings.created_at', '<=', new Date(now - minAgeMs))
      .orderBy('scheduled_meetings.start_time', 'asc');
  }

  /** Marca el recordatorio como enviado (o como intentado, si falló el envío). */
  async markReminderSent(id) {
    return db('scheduled_meetings').where({ id }).update({ reminder_sent_at: db.fn.now() });
  }

  /**
   * La reunión más reciente agendada con este contacto — se usa para
   * responderle con los datos reales (fecha/link) si pregunta por su
   * reunión después de que ya quedó agendada.
   */
  async getLatestForContact(waId) {
    return db('scheduled_meetings')
      .where({ wa_id: waId })
      .whereNull('cancelled_at')
      .orderBy('created_at', 'desc')
      .first();
  }

  /**
   * Borra el registro propio de reuniones agendadas con este contacto (no
   * cancela el evento real en Google Calendar). Se usa desde "Reiniciar
   * conversación" en el panel: sin esto, una reunión agendada en una prueba
   * anterior seguía apareciendo para siempre vía getLatestForContact(), y el
   * bot le recordaba esa reunión vieja al contacto aunque la sesión se
   * hubiera reiniciado.
   */
  async deleteForContact(waId) {
    return db('scheduled_meetings').where({ wa_id: waId }).delete();
  }

  /* ------------------------------- Calendario ------------------------------ */

  /**
   * Las reuniones de un rango de fechas, para la pantalla de Calendario.
   *
   * `advisorUserId` acota a las de un asesor; sin él salen las de todo el
   * equipo, que es como se mira la agenda comercial desde el Calendario.
   * Las fechas llegan como día de calendario y se expanden al día completo en
   * hora de Perú (UTC-5 todo el año, sin horario de verano), el mismo corte que
   * usa `getForDay()`.
   */
  async listRange({ from, to, advisorUserId = null } = {}) {
    const query = db('scheduled_meetings')
      .leftJoin('leads', 'leads.id', 'scheduled_meetings.lead_id')
      .leftJoin('users as asesor', 'asesor.id', 'scheduled_meetings.advisor_user_id')
      .leftJoin('users as autor', 'autor.id', 'scheduled_meetings.created_by')
      .select(
        'scheduled_meetings.*',
        'leads.full_name as lead_full_name',
        'leads.phone as lead_phone',
        'leads.email as lead_email',
        'leads.topic as lead_topic',
        'asesor.name as advisor_name',
        'asesor.email as advisor_email',
        'autor.name as created_by_name'
      )
      .orderBy('scheduled_meetings.start_time', 'asc');

    if (from) query.where('scheduled_meetings.start_time', '>=', limaDayStart(from));
    if (to) query.where('scheduled_meetings.start_time', '<', limaDayStart(to, 1));
    if (advisorUserId) query.where('scheduled_meetings.advisor_user_id', advisorUserId);

    return withContactLabel(await query);
  }

  async getById(id) {
    const [row] = await this.listRangeById(id);
    return row || null;
  }

  async listRangeById(id) {
    return withContactLabel(await db('scheduled_meetings')
      .leftJoin('leads', 'leads.id', 'scheduled_meetings.lead_id')
      .leftJoin('users as asesor', 'asesor.id', 'scheduled_meetings.advisor_user_id')
      // Quién la cargó sale también acá y no solo en `listRange()`: leer UNA
      // reunión y leerla dentro del mes no pueden devolver cosas distintas.
      .leftJoin('users as autor', 'autor.id', 'scheduled_meetings.created_by')
      .select(
        'scheduled_meetings.*',
        'leads.full_name as lead_full_name',
        'leads.phone as lead_phone',
        'asesor.name as advisor_name',
        'asesor.email as advisor_email',
        'autor.name as created_by_name'
      )
      .where('scheduled_meetings.id', id));
  }

  /**
   * Borra el registro de una reunión del panel. **No cancela** el evento en
   * Google Calendar: el panel no tiene permiso para borrar del calendario de
   * otra persona, y hacerlo a medias (borrar acá y dejarlo allá) sería peor que
   * decirlo. La pantalla lo avisa.
   */
  async remove(id) {
    return db('scheduled_meetings').where({ id }).delete();
  }
}

/**
 * Con quién es la reunión, dicho en una sola línea y resuelto en un solo sitio.
 *
 * Gana el nombre que se escribió al agendar (`contact_name`), después el del
 * lead. El marcador que el bot le pone a un contacto sin nombre de perfil no
 * cuenta como nombre: sacarlo a la agenda —"Contacto de WhatsApp" repetido en
 * cada fila— no identifica a nadie, mientras que el teléfono, que es el
 * respaldo, sí. Si no hay ninguno de los tres queda `null` y es la pantalla la
 * que decide cómo llamar a lo que no tiene nombre.
 *
 * Se calcula en cada lectura y no se guarda, por lo mismo que `is_locked` de un
 * hito: el nombre del lead puede corregirse mañana y una copia vieja seguiría
 * mostrando el de ayer.
 */
export function meetingContactName(row) {
  return firstRealName(row?.contact_name, row?.lead_full_name)
    || String(row?.lead_phone || row?.wa_id || '').trim()
    || null;
}

/** Le agrega `contact_label` a cada fila de un listado de reuniones. */
function withContactLabel(rows) {
  for (const row of rows) row.contact_label = meetingContactName(row);
  return rows;
}

/**
 * Medianoche de un día de calendario peruano, en UTC. `offsetDays` corre el
 * día: `limaDayStart('2026-10-05', 1)` es el arranque del 6.
 *
 * Perú no cambia de hora en todo el año (UTC-5), así que el día local empieza a
 * las 05:00 UTC. Construir el Date con la fecha pelada lo interpretaría en la
 * zona del servidor y el rango se correría un día.
 */
export function limaDayStart(dateIso, offsetDays = 0) {
  const [y, m, d] = String(dateIso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays, 5, 0, 0));
}
