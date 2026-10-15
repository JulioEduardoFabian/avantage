import { db } from '../db/connection.js';
import { UserService } from './userService.js';

/**
 * Configuración del reparto automático de leads (`/admin/reparto`).
 *
 * Por ahora es SOLO la configuración: quién está en el grupo, con qué peso y
 * si está en pausa. Ningún camino de alta de leads la lee todavía — el día que
 * se active, el enganche va en `leadService.createLead()` (el punto por el que
 * pasan el bot, Meta y el evaluador) y usa `pickNext()` de `leadRouting.js`.
 *
 * Cada cambio vuelve a poner en cero los `current_weight`: la vuelta del
 * reparto arranca de nuevo con el equipo nuevo, y así la vista previa de la
 * pantalla es exactamente la secuencia que va a salir.
 */
export class LeadRoutingService {
  constructor({ userService = new UserService() } = {}) {
    this.users = userService;
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
      pool: { id: pool.id, name: pool.name, enabled: Boolean(pool.enabled) },
      members,
      candidates
    };
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
