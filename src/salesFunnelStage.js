/**
 * ¿Un lead ya "graduó" del Setter Funnel al Funnel de Ventas?
 *
 * Los dos tableros (`SetterFunnelView` y `LeadsView`) leen la MISMA columna
 * `leads.status`, así que lo único que separa un lead del setter de un lead
 * comercial es el valor de ese campo. La regla estaba escrita dos veces y de
 * dos formas distintas —`SETTER_ONLY_STATUSES` en LeadsView, una lista fija de
 * cuatro estados en SetterFunnelView— y ninguna contemplaba las columnas que el
 * equipo crea a mano: un lead en "Seguimiento" (clave `col_mtc2nwec_fij`) no
 * coincidía con nada y el Setter Funnel lo mostraba de nuevo en su primera
 * columna, como si volviera a ser un contacto sin calificar.
 *
 * Es el espejo de `backend/services/salesFunnelStage.js`, que es el que impide
 * que el bot lo mueva.
 */

/**
 * Etapas que SOLO existen en el Setter Funnel: el bot todavía califica al
 * contacto. `transferido_closer` está acá a propósito — es un lead que el bot
 * pasó a una persona SIN llegar a agendar, así que sigue siendo del setter.
 */
export const SETTER_ONLY_STATUSES = ['conversacion_abierta', 'calificando', 'congelado', 'transferido_closer', 'descartado'];

/**
 * Etapas de bandeja de entrada: aparecen en la primera columna de AMBOS
 * tableros, así que no prueban nada. `nuevo` es además el estado con el que
 * nacen los leads del evaluador público y de las campañas.
 */
export const INBOX_STATUSES = ['nuevo', 'inbox', 'abierto'];

/**
 * Etapas que significan "ya es un lead comercial" aunque el tablero de Ventas
 * no tenga una columna con ese nombre.
 */
export const GRADUATED_STATUSES = ['cita_agendada', 'en_negociacion', 'ganado', 'perdido'];

/**
 * Construye el conjunto de estados que hoy significan "está en el Funnel de
 * Ventas", a partir de las columnas configuradas (`GET /api/funnel-columns`).
 * Sin columnas cargadas quedan los estados fijos, que ya cubren lo esencial.
 */
export function buildSalesFunnelStatuses(columns = []) {
  const statuses = new Set(GRADUATED_STATUSES);
  for (const column of columns) {
    const key = column?.key;
    if (!key) continue;
    if (SETTER_ONLY_STATUSES.includes(key)) continue;
    if (INBOX_STATUSES.includes(key)) continue;
    statuses.add(key);
  }
  return statuses;
}

/** ¿Este estado es de un lead del Funnel de Ventas? */
export function isSalesFunnelStatus(status, salesStatuses) {
  if (!status) return false;
  if (SETTER_ONLY_STATUSES.includes(status)) return false;
  if (INBOX_STATUSES.includes(status)) return false;
  return salesStatuses.has(status);
}
