import { db } from '../db/connection.js';

/**
 * Bitácora de cambios de etapa de un lead: quién lo movió, desde dónde, hacia
 * dónde y cuándo — incluidos los intentos que el backend **rechazó**.
 *
 * No se confunde con `lead_notes`, que son apuntes que escribe una persona
 * sobre la conversación. Esto lo escribe el sistema solo, en cada cambio de
 * `leads.status`, y es lo que permite responder "¿por qué este lead volvió al
 * Setter Funnel?" sin adivinar (ver la migración
 * `20261026010000_create_lead_stage_changes_table.js`).
 */

/** Actor por defecto cuando el cambio no viene de una persona ni del bot. */
const SYSTEM_ACTOR = { type: 'system' };

/** Tipos de actor válidos; cualquier otro se registra como `system`. */
const ACTOR_TYPES = ['user', 'bot', 'system'];

export class LeadStageChangeService {
  /**
   * Registra un cambio de etapa. Nunca lanza: la bitácora no puede impedir que
   * el lead se mueva (ni que un tope lo frene), así que un fallo al escribirla
   * se queda en el log del servidor.
   */
  async record(leadId, { fromStatus, toStatus, actor, reason, blocked = false } = {}) {
    try {
      const { type, id, name } = normalizeActor(actor);
      await db('lead_stage_changes').insert({
        lead_id: leadId,
        from_status: fromStatus || null,
        to_status: toStatus,
        actor_type: type,
        actor_id: id,
        actor_name: name,
        reason: reason ? String(reason).slice(0, 255) : null,
        blocked: Boolean(blocked)
      });
    } catch (error) {
      console.error(`❌ [Leads] No se pudo registrar el cambio de etapa del lead #${leadId}:`, error.message);
    }
  }

  /** Historial de un lead, del cambio más reciente al más antiguo. */
  async listForLead(leadId, { limit = 50 } = {}) {
    const rows = await db('lead_stage_changes')
      .leftJoin('users', 'users.id', 'lead_stage_changes.actor_id')
      .where('lead_stage_changes.lead_id', leadId)
      .orderBy('lead_stage_changes.created_at', 'desc')
      .orderBy('lead_stage_changes.id', 'desc')
      .limit(limit)
      .select(
        'lead_stage_changes.id',
        'lead_stage_changes.from_status',
        'lead_stage_changes.to_status',
        'lead_stage_changes.actor_type',
        'lead_stage_changes.actor_id',
        'lead_stage_changes.reason',
        'lead_stage_changes.blocked',
        'lead_stage_changes.created_at',
        // El nombre vivo del usuario manda sobre la copia; la copia es el
        // respaldo para cuando ese usuario ya no existe (como en lead_notes).
        db.raw('COALESCE(users.name, lead_stage_changes.actor_name) as actor_name')
      );

    return rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorType: row.actor_type,
      actorId: row.actor_id,
      actorName: row.actor_name || null,
      reason: row.reason,
      blocked: Boolean(row.blocked),
      createdAt: row.created_at
    }));
  }
}

/**
 * Acepta tanto `{ type: 'user', id, name }` como el `req.user` crudo del token
 * (que trae `id` y `name` pero no `type`): si viene un id de usuario, es una
 * persona.
 */
function normalizeActor(actor) {
  if (!actor) return { type: SYSTEM_ACTOR.type, id: null, name: null };
  const type = ACTOR_TYPES.includes(actor.type)
    ? actor.type
    : (actor.id ? 'user' : 'system');
  return {
    type,
    id: type === 'user' && actor.id ? actor.id : null,
    name: actor.name ? String(actor.name).slice(0, 150) : null
  };
}
