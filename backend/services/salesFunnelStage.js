import { db } from '../db/connection.js';

/**
 * ¿Un lead ya "graduó" del Setter Funnel al Funnel de Ventas?
 *
 * Los dos tableros leen la MISMA columna `leads.status`, así que lo único que
 * separa un lead del setter de un lead comercial es el valor de ese campo. La
 * regla vivía duplicada en el frontend (`SETTER_ONLY_STATUSES` en
 * LeadsView.vue, `SALES_FUNNEL_STATUSES` en SetterFunnelView.vue) y en
 * contractService, y el bot de WhatsApp no la conocía en absoluto: por eso
 * podía congelar por inactividad a un lead que el closer ya estaba trabajando
 * y devolverlo al Setter Funnel en la columna "Congelados" (reporte del equipo
 * de ventas: leads en seguimiento, la mayoría ya cotizados, reapareciendo como
 * congelados). Este módulo es ahora el único lugar donde se responde esa
 * pregunta en el backend.
 *
 * La respuesta tiene dos partes y conviene no confundirlas:
 *
 *   - `isSalesFunnelStatus()` DETECTA la graduación leyendo el status. Solo
 *     sirve para eso, porque depende de que la columna siga existiendo.
 *   - `leadHasGraduated()` / `isLeadInSalesFunnel()` RECUERDAN la graduación:
 *     miran `leads.sales_funnel_at`, el sello que se escribe al entrar al
 *     funnel comercial. Es el que hay que usar sobre un lead concreto.
 */

/**
 * Etapas que SOLO existen en el Setter Funnel: el bot todavía califica al
 * contacto y nadie del área comercial lo trabaja aún. `transferido_closer`
 * está acá a propósito — es un lead que el bot pasó a una persona SIN llegar a
 * agendar, así que sigue siendo del setter.
 */
export const SETTER_ONLY_STATUSES = ['conversacion_abierta', 'calificando', 'congelado', 'transferido_closer', 'descartado'];

/**
 * Etapas de bandeja de entrada: aparecen en la primera columna de AMBOS
 * tableros, así que no prueban nada. `nuevo` es además el status por defecto de
 * `leadService.createLead()`, con el que entran los leads del evaluador público
 * y de las campañas — justo los que el bot tiene que trabajar. Tratarlas como
 * "ya es comercial" dejaría al bot sin su trabajo principal.
 */
const INBOX_STATUSES = ['nuevo', 'inbox', 'abierto'];

/**
 * Etapas que significan "ya es un lead comercial" aunque el tablero de Ventas
 * no tenga una columna con ese nombre: `cita_agendada` es la que pone el bot (y
 * el pase manual del setter) al graduarlo, y las otras tres son los desenlaces
 * que el equipo puede dejar configurados con cualquier etiqueta.
 */
const GRADUATED_STATUSES = ['cita_agendada', 'en_negociacion', 'ganado', 'perdido'];

/**
 * Conjunto de los status que hoy significan "está en el Funnel de Ventas".
 *
 * Las columnas del tablero de Ventas son configurables por el equipo y sus
 * claves se generan solas (`col_mtc2nwec_fij`), así que no se pueden listar en
 * el código: se leen de `funnel_columns`. Se consulta una vez y el resultado se
 * reparte entre todas las filas de un barrido, en vez de una consulta por lead.
 */
export async function loadSalesFunnelStatuses() {
  const columns = await db('funnel_columns').select('key');
  const statuses = new Set(GRADUATED_STATUSES);
  for (const column of columns) {
    if (SETTER_ONLY_STATUSES.includes(column.key)) continue;
    if (INBOX_STATUSES.includes(column.key)) continue;
    statuses.add(column.key);
  }
  return statuses;
}

/**
 * ¿Este status es de un lead del Funnel de Ventas? `salesStatuses` es lo que
 * devuelve `loadSalesFunnelStatuses()`.
 *
 * Es la regla que DETECTA la graduación, no la que la recuerda: solo mira el
 * texto del status, así que deja de reconocer al lead en cuanto su columna se
 * borra o se recrea. Para preguntar "¿este lead es del closer?" hay que usar
 * `isLeadInSalesFunnel()`/`leadHasGraduated()`, que además miran el marcador.
 */
export function isSalesFunnelStatus(status, salesStatuses) {
  if (!status) return false;
  if (SETTER_ONLY_STATUSES.includes(status)) return false;
  if (INBOX_STATUSES.includes(status)) return false;
  return salesStatuses.has(status);
}

/**
 * ¿Este lead ya es del closer? Es la pregunta que hay que hacer sobre un lead
 * (y no `isSalesFunnelStatus`, que solo mira el texto del status).
 *
 * Manda `leads.sales_funnel_at`: el sello que se escribe cuando el lead entra
 * al funnel comercial y que solo borra una persona que lo devuelva a propósito
 * al setter. Sobrevive a que el equipo borre, renombre o recree la columna en
 * la que estaba el lead — justo el caso en el que la regla por status dejaba de
 * reconocerlo y el bot volvía a moverlo al Setter Funnel.
 *
 * El status se sigue mirando como respaldo, para los leads que ya estaban en el
 * funnel comercial antes de que existiera el sello.
 */
export function leadHasGraduated(lead, salesStatuses) {
  if (!lead) return false;
  if (lead.sales_funnel_at) return true;
  return isSalesFunnelStatus(lead.status, salesStatuses);
}

/** Atajo para un solo lead, cuando no hay un barrido del que colgarse. */
export async function isLeadInSalesFunnel(lead) {
  if (!lead) return false;
  if (lead.sales_funnel_at) return true;
  if (!lead.status) return false;
  return leadHasGraduated(lead, await loadSalesFunnelStatuses());
}
