import { db } from '../db/connection.js';

/**
 * Las etapas del Setter Funnel, ahora en la base y no en el navegador.
 *
 * Vivían en `localStorage`, así que el tablero era de la MÁQUINA y no del
 * equipo: la misma persona veía siete etapas en una computadora y cuatro en
 * otra, con los mismos leads repartidos distinto (16/10/2026). Y como arrastrar
 * un lead escribe `leads.status` con la clave de la columna —que sí es
 * compartida—, cada máquina le ensuciaba el tablero a las demás.
 *
 * Es un espejo de `funnelColumnService` pero sobre `setter_funnel_columns`, y
 * esa separación es deliberada: `loadSalesFunnelStatuses()` trata toda clave de
 * `funnel_columns` como "ya es un lead comercial" y `loadWinningStatuses()`
 * toma las `final` como venta ganada. Ver la cabecera de la migración
 * `20261114000000_create_setter_funnel_columns.js` para lo que se rompería si
 * se unieran.
 */

/**
 * Las etapas de fábrica. Son las mismas que sembró la migración, repetidas acá
 * porque de esto cuelga el botón "Restablecer": una migración no se vuelve a
 * ejecutar, así que no puede ser la fuente de un valor que se pide dos veces.
 * Su espejo en el frontend (`src/setterFunnelColumns.js`) es solo el respaldo
 * para dibujar algo si la petición falla.
 */
export const DEFAULT_SETTER_COLUMNS = [
  { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬', color: '#2C8C99', final: false },
  { key: 'calificando', label: 'En Calificación', icon: '🎯', color: '#6F8125', final: false },
  { key: 'congelado', label: 'Congelado', icon: '🧊', color: '#8D9199', final: false },
  { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅', color: '#C9922E', final: false },
  { key: 'transferido_closer', label: 'Transferido a Closer', icon: '🤝', color: '#56624A', final: false },
  { key: 'ganado', label: 'Ganado / Cerrado', icon: '🏆', color: '#2F7D5A', final: true },
  { key: 'descartado', label: 'No Califica / Sin Resp.', icon: '🚫', color: '#B23A45', final: false }
];

export class SetterFunnelColumnService {
  async getAllColumns() {
    return db('setter_funnel_columns').orderBy('position', 'asc');
  }

  async getColumnByKey(key) {
    return db('setter_funnel_columns').where({ key }).first();
  }

  /**
   * Crea una etapa. `atIndex` la inserta en medio del tablero (el botón "+"
   * entre dos columnas): las de la derecha corren un lugar en la MISMA
   * operación, porque dejar que el cliente mande después el orden completo
   * convierte una columna nueva en dos escrituras que pueden quedar a medias.
   */
  async createColumn({ key, label, icon, color, final: isFinal, atIndex = null }) {
    const columns = await this.getAllColumns();
    const position = Number.isInteger(atIndex)
      ? Math.min(Math.max(atIndex, 0), columns.length)
      : columns.length;

    await db.transaction(async (trx) => {
      await trx('setter_funnel_columns')
        .where('position', '>=', position)
        .increment('position', 1);
      await trx('setter_funnel_columns').insert({
        key,
        label,
        icon: icon || '📌',
        color: color || '#2C8C99',
        final: Boolean(isFinal),
        position
      });
    });

    return this.getColumnByKey(key);
  }

  async updateColumn(key, { label, icon, color, final: isFinal }) {
    const payload = {};
    if (label !== undefined) payload.label = label;
    if (icon !== undefined) payload.icon = icon;
    if (color !== undefined) payload.color = color;
    if (isFinal !== undefined) payload.final = Boolean(isFinal);

    if (Object.keys(payload).length > 0) {
      await db('setter_funnel_columns').where({ key }).update(payload);
    }
    return this.getColumnByKey(key);
  }

  /**
   * Borra una etapa. Los leads que estaban en ella los reubica el cliente
   * ANTES de llamar acá (el modal obliga a elegir a qué columna van), igual
   * que en el tablero de Ventas: la reasignación pasa por
   * `PATCH /api/leads/:id/status`, que es el único camino que mueve el funnel
   * y el que deja el movimiento registrado en `lead_stage_changes`.
   */
  async deleteColumn(key) {
    await db.transaction(async (trx) => {
      const column = await trx('setter_funnel_columns').where({ key }).first();
      if (!column) return;
      await trx('setter_funnel_columns').where({ key }).del();
      await trx('setter_funnel_columns')
        .where('position', '>', column.position)
        .decrement('position', 1);
    });
    return { success: true };
  }

  /** Reordena según el arreglo completo de claves recibido. */
  async reorderColumns(orderedKeys) {
    await db.transaction(async (trx) => {
      for (const [index, key] of orderedKeys.entries()) {
        await trx('setter_funnel_columns').where({ key }).update({ position: index });
      }
    });
    return this.getAllColumns();
  }

  /**
   * Vuelve a las etapas de fábrica.
   *
   * Conserva las etapas creadas por el equipo que TENGAN leads: restablecer es
   * para recuperar las de fábrica que alguien borró, no para vaciarle el
   * tablero a quien tenga trabajo repartido en una etapa suya — esos leads
   * caerían todos en la primera columna sin aviso. Las etapas propias vacías sí
   * se van, que es lo que se está pidiendo.
   */
  async resetToDefaults() {
    const enUso = new Set(await db('leads').whereNull('sales_funnel_at').distinct('status').pluck('status'));
    const propias = (await this.getAllColumns()).filter((column) => (
      !DEFAULT_SETTER_COLUMNS.some((base) => base.key === column.key) && enUso.has(column.key)
    ));

    await db.transaction(async (trx) => {
      await trx('setter_funnel_columns').del();
      await trx('setter_funnel_columns').insert([
        ...DEFAULT_SETTER_COLUMNS.map((column, position) => ({ ...column, position })),
        ...propias.map((column, i) => ({
          key: column.key,
          label: column.label,
          icon: column.icon,
          color: column.color,
          final: Boolean(column.final),
          position: DEFAULT_SETTER_COLUMNS.length + i
        }))
      ]);
    });

    return this.getAllColumns();
  }
}
