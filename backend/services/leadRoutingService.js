import { db } from '../db/connection.js';
import { UserService } from './userService.js';
import { WhatsappBotSettingsService } from './whatsappBotSettingsService.js';
import { pickNext } from './leadRouting.js';

/**
 * Configuración del reparto automático de leads (`/admin/reparto`).
 *
 * Quién está en el grupo, con qué peso, si está en pausa — y `pickAssignee()`,
 * que es lo que de verdad elige. El enganche está en `leadService.createLead()`,
 * el punto por el que pasan los tres caminos automáticos (el bot, los
 * formularios de Meta y el evaluador).
 *
 * **El reparto corre exactamente cuando el bot está apagado** (`isActive()`).
 * No hay un segundo interruptor propio: ver la migración
 * `20261112000000_alter_whatsapp_bot_settings_add_global_switch.js`. Mientras
 * Avan atiende, él es el que califica y agenda, y repartir a la vez pondría a
 * una persona a trabajar en paralelo la misma conversación.
 *
 * Cada cambio vuelve a poner en cero los `current_weight`: la vuelta del
 * reparto arranca de nuevo con el equipo nuevo, y así la vista previa de la
 * pantalla es exactamente la secuencia que va a salir.
 */
export class LeadRoutingService {
  constructor({ userService = new UserService(), botSettingsService = new WhatsappBotSettingsService() } = {}) {
    this.users = userService;
    this.botSettings = botSettingsService;
  }

  /**
   * ¿El reparto está repartiendo ahora mismo? Sí exactamente cuando el bot
   * está apagado.
   *
   * Es una función y no una columna para que no haya dos verdades: con un
   * `lead_routing_pools.enabled` propio, apagar el bot y olvidarse de activar
   * el reparto deja a los leads sin responsable Y sin bot — ni los ve nadie ni
   * los contesta nadie. Esa columna sigue existiendo para el día que haya más
   * de un grupo (repartir distinto por campaña o por universidad), donde sí
   * tiene sentido prender y apagar cada grupo por separado.
   */
  async isActive() {
    return !(await this.botSettings.isBotEnabled());
  }

  async #defaultPool() {
    let pool = await db('lead_routing_pools').orderBy('id', 'asc').first();
    if (!pool) {
      const [id] = await db('lead_routing_pools').insert({ name: 'General', enabled: false });
      pool = await db('lead_routing_pools').where({ id }).first();
    }
    return pool;
  }

  async #resetRound(poolId) {
    await db('lead_routing_members').where({ pool_id: poolId }).update({ current_weight: 0 });
  }

  /**
   * El grupo con sus miembros y a quién más se puede sumar.
   *
   * Cada miembro trae dos avisos que la pantalla muestra al lado de su nombre:
   * `eligible` (sigue siendo del área comercial; si no, el reparto lo saltea) y
   * `can_see_setter_funnel`. El segundo existe porque los leads automáticos
   * nacen en el Setter Funnel: repartirle uno a quien no puede abrir ese
   * tablero —el rol Closer, tal como viene— es mandarlo a un buzón que no lee.
   */
  async getConfig() {
    const pool = await this.#defaultPool();
    const rows = await db('lead_routing_members')
      .join('users', 'users.id', 'lead_routing_members.user_id')
      .join('roles', 'roles.id', 'users.role_id')
      .where('lead_routing_members.pool_id', pool.id)
      .select(
        'lead_routing_members.*',
        'users.name as user_name',
        'users.email as user_email',
        'roles.name as role_name'
      )
      .orderBy('lead_routing_members.position', 'asc')
      .orderBy('lead_routing_members.id', 'asc');

    const team = await this.users.listCommercialTeam();
    const commercialIds = new Set(team.map((user) => user.id));

    const members = await Promise.all(rows.map(async (row) => {
      const user = await this.users.getUserWithPermissions(row.user_id);
      const permissions = new Set(user?.permissions || []);
      return {
        id: row.id,
        user_id: row.user_id,
        name: row.user_name,
        email: row.user_email,
        role_name: row.role_name,
        weight: Number(row.weight),
        active: Boolean(row.active),
        position: row.position,
        current_weight: Number(row.current_weight) || 0,
        eligible: commercialIds.has(row.user_id),
        can_see_setter_funnel: permissions.has('setter.view')
      };
    }));

    const inPool = new Set(members.map((member) => member.user_id));
    const candidates = team.filter((user) => !inPool.has(user.id));

    return {
      // `active` es lo que la pantalla muestra en la banda de arriba, y sale
      // del interruptor del bot y no de `pool.enabled` (ver `isActive()`).
      pool: { id: pool.id, name: pool.name, active: await this.isActive() },
      members,
      candidates
    };
  }

  /**
   * A quién le toca el próximo lead. Devuelve la fila de `users` elegida, o
   * `null` si el reparto no está corriendo o no quedó nadie elegible (y ahí el
   * lead nace sin responsable, igual que hoy).
   *
   * Todo el peso de esta función está en la transacción: lee los
   * `current_weight`, elige y los vuelve a escribir **bajo bloqueo de fila**
   * (`forUpdate`). Sin eso, dos mensajes de WhatsApp que entran en el mismo
   * instante leen el mismo estado, eligen a la misma persona y le escriben el
   * mismo peso — el otro lead no es que se reparta mal, es que desaparece de
   * la cuenta y la proporción configurada deja de cumplirse.
   *
   * La pregunta de quién sigue siendo del área comercial se resuelve ANTES de
   * abrir la transacción: son varias consultas (permisos efectivos de cada
   * uno) y tenerlas dentro alargaría el bloqueo justo en el camino por el que
   * entra cada lead.
   */
  async pickAssignee() {
    if (!(await this.isActive())) return null;

    const pool = await this.#defaultPool();
    const team = await this.users.listCommercialTeam();
    const commercialIds = new Set(team.map((user) => user.id));

    const chosenUserId = await db.transaction(async (trx) => {
      const rows = await trx('lead_routing_members')
        .where({ pool_id: pool.id })
        .orderBy('position', 'asc')
        .orderBy('id', 'asc')
        .forUpdate();

      const members = rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        weight: Number(row.weight),
        active: Boolean(row.active),
        current_weight: Number(row.current_weight) || 0,
        eligible: commercialIds.has(row.user_id)
      }));

      const { chosen, weights } = pickNext(members);
      if (!chosen) return null;

      // Se guardan los pesos de TODOS y no solo el del elegido: el reparto
      // ponderado suave es un estado conjunto — el turno del próximo depende
      // de cuánto acumularon los que esta vez no salieron.
      for (const member of members) {
        const next = weights.get(member.id);
        if (next === member.current_weight) continue;
        await trx('lead_routing_members').where({ id: member.id }).update({ current_weight: next });
      }
      return chosen.user_id;
    });

    if (!chosenUserId) return null;
    return this.users.findCommercialMember(chosenUserId);
  }

  async addMember(userId, weight = 1) {
    const user = await this.users.findCommercialMember(userId);
    if (!user) throw routingError('Esa persona no existe o no pertenece al área comercial.', 422);
    const pool = await this.#defaultPool();
    const already = await db('lead_routing_members').where({ pool_id: pool.id, user_id: user.id }).first();
    if (already) throw routingError(`${user.name} ya está en el reparto.`, 409);

    const last = await db('lead_routing_members').where({ pool_id: pool.id }).max('position as max').first();
    await db('lead_routing_members').insert({
      pool_id: pool.id,
      user_id: user.id,
      weight: normalizeWeight(weight),
      position: (Number(last?.max) || 0) + 1
    });
    await this.#resetRound(pool.id);
    return this.getConfig();
  }

  async updateMember(id, { weight, active } = {}) {
    const member = await db('lead_routing_members').where({ id }).first();
    if (!member) throw routingError('Esa persona ya no está en el reparto.', 404);
    const patch = {};
    if (weight !== undefined) patch.weight = normalizeWeight(weight);
    if (active !== undefined) patch.active = Boolean(active);
    if (Object.keys(patch).length > 0) {
      await db('lead_routing_members').where({ id }).update(patch);
      await this.#resetRound(member.pool_id);
    }
    return this.getConfig();
  }

  async removeMember(id) {
    const member = await db('lead_routing_members').where({ id }).first();
    if (member) {
      await db('lead_routing_members').where({ id }).del();
      await this.#resetRound(member.pool_id);
    }
    return this.getConfig();
  }

  /** El orden decide los empates: con pesos iguales, empieza el de más arriba. */
  async reorderMembers(ids) {
    const pool = await this.#defaultPool();
    await db.transaction(async (trx) => {
      for (const [index, id] of ids.entries()) {
        await trx('lead_routing_members').where({ id, pool_id: pool.id }).update({ position: index + 1 });
      }
    });
    await this.#resetRound(pool.id);
    return this.getConfig();
  }
}

const MAX_WEIGHT = 20;

function normalizeWeight(value) {
  const weight = Math.round(Number(value));
  if (!Number.isFinite(weight) || weight < 1 || weight > MAX_WEIGHT) {
    throw routingError(`El peso tiene que ser un número entre 1 y ${MAX_WEIGHT}.`, 422);
  }
  return weight;
}

function routingError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
