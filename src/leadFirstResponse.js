/**
 * "A este lead nadie le contestó todavía", la regla que pinta el aviso en la
 * tarjeta de los dos tableros.
 *
 * Vive en un módulo y no en cada vista por lo mismo que `leadCardDate.js`: es
 * la misma tarjeta del mismo lead, y con una copia por pantalla el mismo lead
 * terminaría avisando en una y no en la otra.
 *
 * El plazo son 24 horas y se cuenta desde que el lead ENTRÓ al CRM. No se
 * cuenta desde que se le asignó un responsable porque eso no deja rastro en
 * ninguna tabla: asignar no es un movimiento de funnel (ver
 * `leadService.assignLead()`), así que "hace cuánto que es tuyo" no es un dato
 * que exista.
 *
 * Un lead ya cerrado no avisa aunque nunca se le haya respondido por acá: el
 * que tiene proyecto abierto se atendió de sobra, y el aviso sirve para
 * perseguir lo que falta, no para auditar el pasado.
 */

/** El plazo, en milisegundos. */
export const FIRST_RESPONSE_SLA_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Hay que avisar por este lead?
 *
 * @param {object} lead la fila del lead como viaja al tablero
 * @param {Date}   [now]
 */
export function needsFirstResponse(lead, now = new Date()) {
  if (!lead) return false;
  if (lead.first_response_at) return false;
  // Con proyecto abierto el lead ya está en producción: avisar ahí es ruido.
  if (lead.project_id) return false;

  const created = lead.created_at ? new Date(lead.created_at) : null;
  if (!created || Number.isNaN(created.getTime())) return false;

  return now.getTime() - created.getTime() >= FIRST_RESPONSE_SLA_MS;
}

/**
 * Cuánto lleva esperando, en lenguaje llano — el mismo registro que usa la
 * pantalla de Entregables: "faltan 3 días" dice más que una fecha ISO cuando
 * de lo que se trata es de decidir a quién llamar primero.
 */
export function waitingLabel(lead, now = new Date()) {
  if (!lead?.created_at) return '';
  const created = new Date(lead.created_at);
  if (Number.isNaN(created.getTime())) return '';

  const hours = Math.floor((now.getTime() - created.getTime()) / (60 * 60 * 1000));
  if (hours < 48) return `sin responder desde hace ${hours} h`;
  return `sin responder desde hace ${Math.floor(hours / 24)} días`;
}
