import { db } from '../db/connection.js';

/**
 * Comisiones por venta cerrada.
 *
 * Hoy hay una sola: la **setter** se lleva el 2% de la venta que el closer
 * cerró con el lead que ella le pasó. Es el devengo —lo que se le debe—, no el
 * pago: cuando se le pague, ese egreso se anota en la planilla de Salarios como
 * cualquier otro. Por eso esta tabla no entra en `finance_journal` ni suma en
 * los totales de Finanzas: mezclarlas contaría el mismo dinero dos veces.
 *
 * La comisión nace sola al ganar el lead (`leadService.updateLeadStatus()`, el
 * único camino por el que un lead llega a la etapa final) y no desde la ruta de
 * cierre: hay más de un camino a "Ganado" —el modal de cierre con el primer
 * pago y el arrastre en el Kanban de un lead que ya lo tenía— y puesta en cada
 * ruta, al tercero que se agregue se le olvida. Es la misma razón por la que el
 * aviso de proyecto nuevo vive en `projectService`.
 */

/** El 2% de la venta. Se guarda en cada fila: cambiarlo no reescribe el pasado. */
export const SETTER_COMMISSION_PERCENT = 2;

/**
 * El monto de la comisión, redondeado a dos decimales.
 *
 * Se redondea acá y se guarda ya redondeado porque es lo que se le va a pagar a
 * una persona: dejar el flotante crudo haría que la suma de la pantalla y la
 * suma de la planilla difirieran en céntimos.
 */
export function commissionAmount(base, percent) {
  const importe = Number(base) * (Number(percent) / 100);
  if (!Number.isFinite(importe)) return 0;
  return Math.round(importe * 100) / 100;
}

/**
 * ¿Este cierre genera comisión para la setter? Devuelve el motivo cuando no,
 * que es lo que después explica una venta sin comisión sin tener que adivinar.
 *
 * Reglas:
 *   - sin setter sellado no hay a quién pagarle (el lead entró directo al
 *     funnel de ventas, sin pasar por el setter);
 *   - si el que cerró es el mismo que lo pasó, no hay traspaso que comisionar;
 *   - sin precio total registrado no hay sobre qué calcular el 2%.
 */
export function commissionEligibility(lead) {
  if (!lead?.setter_user_id) return { ok: false, reason: 'El lead no tiene setter: nunca pasó por el Setter Funnel.' };
  if (lead.setter_user_id === lead.closer_user_id) {
    return { ok: false, reason: 'Lo cerró la misma persona que lo trabajó: no hay traspaso que comisionar.' };
  }
  const base = Number(lead.total_amount);
  if (!Number.isFinite(base) || base <= 0) {
    return { ok: false, reason: 'La venta no tiene precio total registrado.' };
  }
  return { ok: true, base };
}

export class CommissionService {
  /**
   * Registra la comisión de la setter por un lead recién ganado. Devuelve la
   * fila creada, la que ya existía, o null con el motivo si no corresponde.
   *
   * Es idempotente: un lead comisiona una sola vez por persona y rol (índice
   * único en la tabla), así que reabrir y volver a cerrar una venta no paga dos
   * veces.
   */
  async registerForWonLead(lead) {
    const elegible = commissionEligibility(lead);
    if (!elegible.ok) return { commission: null, reason: elegible.reason };

    const existente = await db('sales_commissions')
      .where({ lead_id: lead.id, user_id: lead.setter_user_id, role: 'setter' })
      .first();
    if (existente) return { commission: existente, reason: null };

    const setter = await db('users').where({ id: lead.setter_user_id }).first();
    if (!setter) return { commission: null, reason: 'El setter del lead ya no tiene cuenta en el panel.' };

    const project = await db('projects').where({ lead_id: lead.id }).first();
    const monto = commissionAmount(elegible.base, SETTER_COMMISSION_PERCENT);

    const [id] = await db('sales_commissions').insert({
      lead_id: lead.id,
      project_id: project?.id || null,
      user_id: setter.id,
      beneficiary_name: setter.name,
      role: 'setter',
      percent: SETTER_COMMISSION_PERCENT,
      base_amount: elegible.base,
      monto,
      estado: 'pendiente',
      detalle: `Lead #${lead.id} — ${lead.full_name || lead.topic || 'sin nombre'}`
    });

    return { commission: await this.getById(id), reason: null };
  }

  async getById(id) {
    return db('sales_commissions').where({ id }).first();
  }

  /**
   * Las comisiones con el cliente y el beneficiario ya resueltos, para la
   * pestaña de Finanzas. El nombre sale de `users` cuando la cuenta existe y de
   * la copia guardada cuando no.
   */
  async list({ estado = null, userId = null } = {}) {
    const query = db('sales_commissions as c')
      .leftJoin('leads', 'leads.id', 'c.lead_id')
      .leftJoin('users', 'users.id', 'c.user_id')
      .select(
        'c.*',
        db.raw('COALESCE(users.name, c.beneficiary_name) as beneficiario'),
        'leads.full_name as cliente',
        'leads.topic as tema',
        'leads.status as lead_status'
      )
      .orderBy('c.created_at', 'desc');

    if (estado) query.where('c.estado', estado);
    if (userId) query.where('c.user_id', userId);
    return query;
  }

  /** Totales para el encabezado de la pestaña: lo que se debe y lo ya pagado. */
  async summary() {
    const filas = await db('sales_commissions')
      .select('estado')
      .sum({ total: 'monto' })
      .count({ n: 'id' })
      .groupBy('estado');

    const resumen = { pendiente: { total: 0, n: 0 }, pagado: { total: 0, n: 0 } };
    for (const fila of filas) {
      resumen[fila.estado] = { total: Number(fila.total) || 0, n: Number(fila.n) || 0 };
    }
    return resumen;
  }

  /**
   * Marca la comisión como pagada (o la devuelve a pendiente si se marcó por
   * error). El pago en sí se registra en Salarios: acá solo se deja de deber.
   */
  async setEstado(id, estado, { paidAt = null } = {}) {
    if (!['pendiente', 'pagado'].includes(estado)) {
      throw new Error('Estado de comisión no válido.');
    }
    const fecha = estado === 'pagado' ? (paidAt || new Date().toISOString().slice(0, 10)) : null;
    await db('sales_commissions').where({ id }).update({ estado, paid_at: fecha });
    return this.getById(id);
  }
}
