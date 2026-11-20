import { db } from '../db/connection.js';
import { assignmentPatch } from './leadService.js';
import { attentionPriority, intentLabel } from './botIntent.js';

/**
 * La derivación de una conversación al equipo, como un hecho con dueño y con
 * acuse (`lead_handoffs`).
 *
 * Hasta ahora `handOffToAdvisor()` hacía tres cosas —mover el lead a
 * "transferido_closer", avisarle al contacto y mandar un aviso al equipo— y
 * ninguna de las tres deja constancia de lo único que importa después: **a
 * quién le toca y si alguien lo atendió**. El aviso va a la campana y al
 * correo, o sea a una bandeja compartida donde se lee una vez y se pierde; de
 * las 17 transferencias del período medido, 0 terminaron en una reunión
 * agendada, y no había forma de saber si fue porque nadie las atendió o porque
 * se atendieron y no cerraron.
 *
 * `_followUpStaleHandoffs()` escalaba a las 3 h deduciendo el estado del
 * último saliente de la conversación, que es lo mejor que se podía hacer sin
 * una fila: deducido así, el dato existe solo mientras el barrido corre y no
 * se puede listar, ni contar, ni repartir.
 *
 * **La fila es la tarea.** No va a `tasks` y eso es deliberado: esa tabla
 * cuelga de `projects` en CASCADE —un lead transferido todavía no tiene
 * proyecto, y si alguna vez lo tiene, borrarlo se llevaría el rastro de la
 * derivación— y además su vocabulario (`pendiente`/`completado`) no tiene
 * dónde guardar a quién le toca ni cuándo se hizo cargo. Es la misma decisión
 * y las mismas razones por las que Entregables tiene tabla propia en vez de
 * reusar `project_updates`.
 *
 * Lo que NO hace: no decide nada del funnel. Mover el lead sigue siendo de
 * `updateLeadStatus()`, el punto único, y esta fila es el registro de que una
 * persona tiene que entrar — no una segunda versión de la etapa.
 */

function missingTable(error) {
  return error?.code === 'ER_NO_SUCH_TABLE';
}

/** Cómo llegó el acuse de atención. Ver `ackHandoffFromReply()`. */
export const ACK_CHANNELS = ['panel', 'respuesta', 'whatsapp_app'];

/**
 * Confirmación de atención DERIVADA de que una persona le escribió.
 *
 * Es el acuse que de verdad importa, porque no exige que nadie apriete nada:
 * la prueba de que un asesor se hizo cargo es que le escribió al contacto.
 *
 * Es una **función de módulo y no un método de la clase**, por la misma razón
 * y con el mismo patrón que `stampFirstResponseByPhone`: quien la llama es
 * `whatsappMessageService` en cada saliente, y hacerla método obligaría a ese
 * servicio a recibir inyectado un servicio que a su vez necesita el de leads y
 * el de reparto, ninguno de los cuales hace falta para un `UPDATE`.
 *
 * **Avan no acusa recibo de su propia transferencia.** Un saliente sin autor y
 * sin canal explícito es el bot —así se guarda `whatsapp_messages.sent_by`— y
 * contarlo como atención marcaría atendidas todas las derivaciones en el mismo
 * segundo en que se crean, con el mensaje "Te paso con un asesor 🙌". Por eso
 * un `sentBy` nulo solo cuenta cuando quien llama afirma que viene de la app
 * de WhatsApp Business, que es una persona escribiendo desde el celular.
 *
 * Nunca lanza y nunca se espera: el mensaje ya salió, y lo que se perdería si
 * falla es una marca de seguimiento.
 */
export async function ackHandoffFromReply(waId, { sentBy = null, sentByName = null, via = 'respuesta' } = {}) {
  if (!waId) return null;
  if (!sentBy && via !== 'whatsapp_app') return null;

  try {
    const open = await db('lead_handoffs')
      .where({ wa_id: waId })
      .whereNull('acknowledged_at')
      .orderBy('id', 'desc')
      .first();
    if (!open) return null;

    await db('lead_handoffs').where({ id: open.id }).update({
      acknowledged_at: db.fn.now(),
      acknowledged_by: sentBy || null,
      acknowledged_by_name: sentByName || null,
      acknowledged_via: via,
      updated_at: db.fn.now()
    });
    return await db('lead_handoffs').where({ id: open.id }).first();
  } catch (error) {
    if (!missingTable(error)) {
      console.error(`⚠️ [Derivación] No se pudo marcar la atención de ${waId}:`, error.message);
    }
    return null;
  }
}

export class LeadHandoffService {
  /**
   * @param {object} deps
   * @param {object} deps.leadService      para encontrar el lead por teléfono
   * @param {object} [deps.routingService] para asignar un asesor si no tiene
   */
  constructor({ leadService, routingService = null } = {}) {
    this.leadService = leadService;
    this.routingService = routingService;
  }

  /**
   * Registra que una conversación pasó a manos del equipo.
   *
   * Devuelve la fila creada (o la que ya estaba abierta), o null si no se pudo
   * registrar. **Nunca lanza**: la transferencia ya ocurrió —el lead se movió
   * de etapa y al contacto ya se le dijo que lo atiende una persona—, así que
   * un fallo al anotarlo no puede deshacer nada ni tumbar el turno. Misma
   * regla que la comisión de la setter y que el aviso de proyecto nuevo.
   */
  async open(waId, { reason = null, intents = [], urgency = null } = {}) {
    try {
      // Una sola derivación abierta por contacto. Un segundo pedido de hablar
      // con una persona mientras la primera sigue sin atenderse no es otra
      // tarea: es la misma, más urgente. Dos filas partirían la cola en dos y
      // bastaría atender una para que la otra quedara viva para siempre —el
      // mismo cuidado que la idempotencia de `attribution_conflicts`.
      const open = await this.openFor(waId);
      const priority = attentionPriority({ intents, urgency });

      if (open) return this.#escalate(open, { reason, intents, urgency, priority });

      const lead = await this.leadService.findByPhone(waId).catch(() => null);
      const advisor = await this.#resolveAdvisor(lead);

      const [id] = await db('lead_handoffs').insert({
        lead_id: lead?.id || null,
        wa_id: waId,
        reason: reason ? String(reason).slice(0, 500) : null,
        intents: JSON.stringify(intents || []),
        urgency: urgency || null,
        priority,
        assigned_user_id: advisor?.id || null,
        assigned_to: advisor?.name || null
      });

      return await db('lead_handoffs').where({ id }).first();
    } catch (error) {
      if (!missingTable(error)) {
        console.error(`❌ [Derivación] No se pudo registrar la de ${waId}:`, error.message);
      }
      return null;
    }
  }

  /** La derivación sin atender de este contacto, si hay una. */
  async openFor(waId) {
    try {
      return await db('lead_handoffs')
        .where({ wa_id: waId })
        .whereNull('acknowledged_at')
        .orderBy('id', 'desc')
        .first();
    } catch (error) {
      if (missingTable(error)) return null;
      throw error;
    }
  }

  /**
   * Sube la prioridad de una derivación que sigue abierta y le suma el motivo
   * nuevo. No se reescribe el motivo original: el primero explica por qué se
   * derivó y es el que hay que leer; el segundo explica por qué urge.
   */
  async #escalate(row, { reason, intents, urgency, priority }) {
    const ORDEN = { normal: 0, media: 1, alta: 2 };
    const patch = { nudges: Number(row.nudges || 0) + 1, updated_at: db.fn.now() };

    if ((ORDEN[priority] ?? 0) > (ORDEN[row.priority] ?? 0)) patch.priority = priority;
    if (urgency && !row.urgency) patch.urgency = urgency;
    if (reason && reason !== row.reason) {
      patch.reason = `${row.reason ? `${row.reason}\n` : ''}+ ${String(reason).slice(0, 300)}`.slice(0, 500);
    }
    if (intents?.length) {
      const previos = parseIntents(row.intents);
      const union = [...new Set([...previos, ...intents])];
      patch.intents = JSON.stringify(union);
    }

    await db('lead_handoffs').where({ id: row.id }).update(patch);
    return await db('lead_handoffs').where({ id: row.id }).first();
  }

  /**
   * A quién le toca.
   *
   * Primero el responsable que el lead ya tiene: la derivación no es el
   * momento de reasignar a nadie, y mandarle el caso a otro dejaría al que lo
   * venía trabajando sin enterarse.
   *
   * Si el lead NO tiene responsable —el caso normal de un lead nacido de una
   * conversación de WhatsApp, que se reparte solo con el bot apagado— se le
   * pide uno al reparto y se le escribe también al lead. No es un efecto de
   * paso: un lead sin responsable **no lo ve nadie** salvo quien reparte, así
   * que derivarlo sin asignarlo es dejar la tarea en una cola que una sola
   * persona del panel puede abrir. `botWillAttend: false` es literal acá: el
   * bot acaba de dejar de atenderlo, que es el supuesto exacto de `routesNow()`.
   */
  async #resolveAdvisor(lead) {
    if (lead?.assigned_user_id) return { id: lead.assigned_user_id, name: lead.assigned_to || null };
    if (!lead || !this.routingService) return null;

    try {
      const user = await this.routingService.pickAssignee({ botWillAttend: false });
      if (!user) return null;
      // Las DOS columnas, siempre juntas y por el único sitio que las escribe
      // (`assignmentPatch`): una ficha que dice un nombre en una pantalla y
      // otro en la otra es peor que no tener la función.
      await db('leads').where({ id: lead.id }).update(assignmentPatch(user));
      return user;
    } catch (error) {
      console.error('❌ [Derivación] No se pudo asignar un asesor:', error.message);
      return null;
    }
  }

  /**
   * Confirmación de atención hecha a mano, desde el panel.
   *
   * Existe además del acuse derivado porque hay atención que no pasa por
   * WhatsApp: el asesor llama por teléfono, que es lo que hace la mitad del
   * equipo, y el sistema no tiene cómo verlo. Sin el botón, esa derivación
   * quedaría escalando a las 3 h para siempre.
   */
  async acknowledge(id, { userId = null, userName = null } = {}) {
    const row = await db('lead_handoffs').where({ id }).first();
    if (!row) return null;
    // Ya atendida: no se vuelve a sellar. Interesa la PRIMERA atención, que es
    // la que se compara contra el plazo — misma regla que `first_response_at`.
    if (row.acknowledged_at) return row;

    await db('lead_handoffs').where({ id }).update({
      acknowledged_at: db.fn.now(),
      acknowledged_by: userId || null,
      acknowledged_by_name: userName || null,
      acknowledged_via: 'panel',
      updated_at: db.fn.now()
    });
    return await db('lead_handoffs').where({ id }).first();
  }

  /** Ídem `ackHandoffFromReply`, para quien ya tiene el servicio a mano. */
  async ackFromReply(waId, options = {}) {
    return ackHandoffFromReply(waId, options);
  }

  /**
   * La cola: las derivaciones del período con el nombre del lead y del asesor.
   *
   * `pending` es el filtro que contesta la pregunta del día ("¿qué falta
   * atender?"). El JOIN es a `leads` y no a una copia del nombre porque el
   * nombre del lead cambia —el bot lo corrige en cuanto la persona se
   * presenta— y una copia quedaría diciendo "Contacto de WhatsApp".
   */
  async list({ days = 30, pending = false, limit = 200, viewerId = null } = {}) {
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    try {
      const query = db('lead_handoffs as h')
        .leftJoin('leads as l', 'l.id', 'h.lead_id')
        .leftJoin('users as u', 'u.id', 'h.assigned_user_id')
        .where('h.created_at', '>=', since)
        .select(
          'h.*',
          'l.full_name as lead_name',
          'l.status as lead_status',
          'u.name as advisor_name'
        )
        // Lo pendiente primero y después por prioridad: esta lista se mira
        // para decidir a quién atender ahora, no para auditar el pasado.
        .orderByRaw('h.acknowledged_at IS NULL DESC')
        .orderByRaw("FIELD(h.priority, 'alta', 'media', 'normal')")
        .orderBy('h.created_at', 'desc')
        .limit(Math.min(Math.max(1, limit), 1000));

      if (pending) query.whereNull('h.acknowledged_at');
      /*
       * Cada quien ve lo suyo, igual que en los dos tableros: la cola de
       * derivaciones es "qué tengo que atender", y la de los demás no es
       * información que haga falta para atender la propia. Quien administra el
       * área comercial (`leads.manage_all`) la ve completa y entra sin
       * `viewerId` — la ruta es la que lo decide, como en `getAllLeads()`.
       *
       * Lo que NO tiene responsable entra igual en la lista de todos: una
       * derivación sin asesor es justamente la que hay que repartir, y
       * esconderla hasta que alguien la asigne la deja sin nadie que pueda
       * asignarla.
       */
      if (viewerId) {
        query.where((q) => q.where('h.assigned_user_id', viewerId).orWhereNull('h.assigned_user_id'));
      }

      const rows = await query;
      return rows.map((row) => ({
        ...row,
        intents: parseIntents(row.intents),
        intent_labels: parseIntents(row.intents).map(intentLabel).filter(Boolean),
        // El asesor se nombra con el JOIN y la copia queda de respaldo, por lo
        // mismo que `assigned_user_name` en los tableros: la copia es de
        // cuándo se derivó y la persona pudo haberse renombrado.
        assigned_to: row.advisor_name || row.assigned_to || null
      }));
    } catch (error) {
      if (missingTable(error)) return [];
      throw error;
    }
  }

  /**
   * Las derivaciones sin atender con más de `hours` horas. Es lo que consulta
   * el barrido para escalar hacia adentro, y reemplaza la deducción que hacía
   * mirando el último saliente de la conversación.
   */
  async staleUnattended({ hours = 3, limit = 50 } = {}) {
    const cutoff = new Date(Date.now() - Math.max(1, hours) * 60 * 60 * 1000);

    try {
      return await db('lead_handoffs')
        .whereNull('acknowledged_at')
        .where('created_at', '<=', cutoff)
        // Una sola escalada por derivación: el barrido corre cada diez
        // minutos, y sin esto la misma transferencia generaría un aviso por
        // vuelta — que es la forma más rápida de que el equipo deje de mirar
        // los avisos.
        .whereNull('escalated_at')
        .orderBy('created_at', 'asc')
        .limit(limit);
    } catch (error) {
      if (missingTable(error)) return [];
      throw error;
    }
  }

  /** Marca que ya se escaló hacia adentro, para no volver a avisar. */
  async markEscalated(id) {
    try {
      await db('lead_handoffs').where({ id }).update({ escalated_at: db.fn.now(), updated_at: db.fn.now() });
    } catch (error) {
      if (!missingTable(error)) console.error('❌ [Derivación] No se pudo marcar la escalada:', error.message);
    }
  }

  /**
   * Cuántas hay pendientes y cuánto llevan esperando. La MEDIANA y no el
   * promedio, por lo mismo que los plazos del Reporte de Setters: una
   * derivación olvidada hace tres semanas corre el promedio de toda la cola.
   */
  async summary({ days = 30 } = {}) {
    const rows = await this.list({ days, limit: 1000 });
    const pendientes = rows.filter((r) => !r.acknowledged_at);
    const atendidas = rows.filter((r) => r.acknowledged_at);

    const minutos = atendidas
      .map((r) => (new Date(r.acknowledged_at) - new Date(r.created_at)) / 60000)
      .filter((m) => Number.isFinite(m) && m >= 0)
      .sort((a, b) => a - b);

    return {
      dias: days,
      total: rows.length,
      pendientes: pendientes.length,
      atendidas: atendidas.length,
      sinAsesor: rows.filter((r) => !r.assigned_user_id).length,
      prioridadAlta: pendientes.filter((r) => r.priority === 'alta').length,
      medianaAtencionMin: minutos.length ? mediana(minutos) : null
    };
  }
}

function parseIntents(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mediana(ordenados) {
  const mid = Math.floor(ordenados.length / 2);
  const valor = ordenados.length % 2
    ? ordenados[mid]
    : (ordenados[mid - 1] + ordenados[mid]) / 2;
  return Math.round(valor);
}
