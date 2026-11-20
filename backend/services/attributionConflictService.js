import { db } from '../db/connection.js';
import { CONFLICT_REASONS } from './attributionEvidence.js';
import { BRIDGE_SCHEMAS, bridgeEnvelope } from './bridgeContract.js';

/**
 * Los emparejamientos de atribución que necesitan que los resuelva una
 * persona.
 *
 * Existe porque la alternativa es peor. Cuando la importación de TikTok no
 * encuentra la ficha por el `lead_id` del envío y el teléfono da con dos, hay
 * tres salidas: elegir una (lo que hacía antes, con un `ORDER BY` que es una
 * moneda al aire), descartar el envío en silencio, o anotarlo. Las dos primeras
 * producen un número que parece cierto y nadie puede auditar; esta tabla
 * produce un pendiente, que es lo que un pendiente es.
 *
 * No tiene pantalla todavía: se lee por la API (`GET
 * /api/attribution/conflicts`) y sale en el reporte de cada conciliación, que
 * es donde se mira el resultado de la corrida. Darle una pantalla propia es el
 * paso siguiente y no cambia nada de acá.
 *
 * Lo que se guarda está pensado para poder **aplicar** la resolución más tarde:
 * el `payload` es la atribución que no se escribió, tal como la mandó la
 * plataforma, porque TikTok conserva los leads de un formulario solo 90 días y
 * después ya no hay a quién volvérselos a pedir.
 */
export class AttributionConflictService {
  /**
   * Anota un pendiente, o actualiza el que ya existe para ese mismo envío.
   *
   * Es idempotente a propósito: la conciliación diaria vuelve a encontrar el
   * mismo caso en cada corrida mientras nadie lo resuelva, y sin esto la lista
   * de pendientes crecería una fila por día hasta volverse ilegible — que es
   * la forma más común de que una lista de pendientes deje de mirarse.
   *
   * Un caso ya resuelto NO se reabre: si alguien decidió que ese envío era de
   * esta ficha (o que no era de ninguna), volver a anotarlo sería desautorizar
   * la decisión en cada barrido.
   */
  async record({ platform, platformLeadId = null, phoneKey = null, reason, candidateLeadIds = [], payload = null }) {
    if (!platform || !reason) return null;

    const fila = {
      platform,
      platform_lead_id: platformLeadId ? String(platformLeadId) : null,
      phone_key: phoneKey ? String(phoneKey).slice(0, 16) : null,
      reason,
      candidate_lead_ids: JSON.stringify((candidateLeadIds || []).map(Number).filter(Boolean)),
      payload: payload ? JSON.stringify(payload) : null
    };

    if (fila.platform_lead_id) {
      const existente = await db('attribution_conflicts')
        .where({ platform: fila.platform, platform_lead_id: fila.platform_lead_id })
        .first();

      if (existente) {
        if (existente.resolved_at) return existente;
        await db('attribution_conflicts').where({ id: existente.id }).update({
          reason: fila.reason,
          candidate_lead_ids: fila.candidate_lead_ids,
          payload: fila.payload,
          detected_at: new Date()
        });
        return this.#byId(existente.id);
      }
    }

    const [id] = await db('attribution_conflicts').insert({ ...fila, detected_at: new Date() });
    return this.#byId(id);
  }

  /**
   * Los pendientes, sin resolver primero.
   *
   * El conteo viaja aparte del listado por lo mismo que en la bandeja de
   * WhatsApp: "12 pendientes" tiene que ser el total y no el tamaño de la
   * página disfrazado de dato.
   */
  async list({ platform = null, reason = null, resolved = false, limit = 100, offset = 0 } = {}) {
    const filtros = (query) => {
      if (platform) query.where('platform', platform);
      if (reason) query.where('reason', reason);
      if (resolved === true) query.whereNotNull('resolved_at');
      else if (resolved === false) query.whereNull('resolved_at');
      return query;
    };

    const tope = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const desde = Math.max(Number(offset) || 0, 0);

    const [{ total }] = await filtros(db('attribution_conflicts')).count({ total: '*' });

    const rows = await filtros(
      db('attribution_conflicts as c')
        .select('c.*', 'u.name as resolved_by_name')
        .leftJoin('users as u', 'u.id', 'c.resolved_by')
    )
      .orderBy('c.detected_at', 'desc')
      .limit(tope)
      .offset(desde);

    return {
      /*
       * El mismo sobre que las dos conciliaciones (`bridgeEnvelope`): total,
       * filas entregadas, offset, límites y el aviso de recorte. Compartirlo es
       * lo que permite consumir los tres puentes con un solo lector, y lo que
       * evita que el cuarto se invente su propia forma de decir "hay más".
       */
      ...bridgeEnvelope({
        esquema: BRIDGE_SCHEMAS.attributionConflicts,
        totalFilas: Number(total) || 0,
        filas: rows.length,
        offset: desde,
        limites: { por_pagina_max: 500, por_pagina_default: 100 }
      }),
      conflicts: rows.map((row) => ({
        ...row,
        candidate_lead_ids: parseJson(row.candidate_lead_ids, []),
        payload: parseJson(row.payload, null)
      }))
    };
  }

  /**
   * Marca un pendiente como resuelto.
   *
   * **No aplica la atribución**: escribirla es de quien tiene el lead delante y
   * pasa por los mismos métodos que todo lo demás (`attachTikTokLeadToExisting`
   * con el método `manual`). Acá solo queda asentado que alguien lo decidió y
   * quién, que es lo que convierte la lista en algo que se puede cerrar.
   */
  async resolve(id, { resolution, notes = null, actor = null } = {}) {
    const fila = await this.#byId(id);
    if (!fila) return null;

    await db('attribution_conflicts').where({ id }).update({
      resolved_at: new Date(),
      resolved_by: actor?.id || null,
      resolution: resolution ? String(resolution).slice(0, 20) : null,
      notes: notes ? String(notes).slice(0, 500) : null
    });

    return this.#byId(id);
  }

  /** Cuántos pendientes hay por motivo, para la tira de la pantalla. */
  async summary() {
    const rows = await db('attribution_conflicts')
      .whereNull('resolved_at')
      .select('reason')
      .count({ total: '*' })
      .groupBy('reason');

    const porMotivo = {};
    for (const motivo of Object.values(CONFLICT_REASONS)) porMotivo[motivo] = 0;
    for (const row of rows) porMotivo[row.reason] = Number(row.total) || 0;

    return {
      pendientes: Object.values(porMotivo).reduce((a, b) => a + b, 0),
      por_motivo: porMotivo
    };
  }

  async #byId(id) {
    const row = await db('attribution_conflicts as c')
      .select('c.*', 'u.name as resolved_by_name')
      .leftJoin('users as u', 'u.id', 'c.resolved_by')
      .where('c.id', id)
      .first();
    if (!row) return null;
    return {
      ...row,
      candidate_lead_ids: parseJson(row.candidate_lead_ids, []),
      payload: parseJson(row.payload, null)
    };
  }
}

function parseJson(value, porDefecto) {
  if (value === null || value === undefined) return porDefecto;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return porDefecto;
  }
}
