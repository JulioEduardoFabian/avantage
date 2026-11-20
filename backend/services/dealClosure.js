/**
 * ¿Las cuotas de este lead son de una VENTA CERRADA o de un trato que todavía
 * no se ganó?
 *
 * El cronograma no nace solo al ganar: el contrato (`PUT /api/contracts/:id`,
 * campo `installments`) lo escribe en `finance_income` en cuanto se guarda, y
 * el contrato se arma ANTES de cerrar —es lo que se le manda al cliente para
 * que firme—. Así que un lead en cotización con su contrato en borrador ya
 * tiene cuotas, y la pestaña INGRESOS lo listaba como un cierre más, con su
 * «venció hace 6 días» en rojo, sin que nadie lo hubiera puesto en Ganado
 * (reporte del 18/11/2026: Alvaro P. y Rodrigo Medina).
 *
 * No se arregla dejando de escribir las cuotas: el cierre de venta las ADOPTA
 * (`getLeadSettlement()` + `planWinDeal()`), y el contrato imprime la tabla
 * del cronograma desde ellas. Lo que cambia es cómo se las lista.
 *
 * Son los mismos tres caminos que `isWonLead()` de Campañas, con el tercero un
 * poco más ancho: la etapa ganadora (`loadWinningStatuses()`), el proyecto
 * abierto (respaldo por si alguien recrea la columna sin marcarla `final`) y
 * **plata que se movió** — una cuota `pagado` o `verificado`. Acá basta
 * `pagado` y no hace falta `verificado` porque lo que se decide es si
 * esconderla, y esconder una cuota que el cliente dice haber pagado es esconder
 * justo lo que Finanzas tiene que verificar.
 *
 * Pura y fuera del servicio para poder probarla sin base de datos.
 */
export function isClosedDeal({ status, hasProject = false, hasMoney = false } = {}, winningStatuses = new Set()) {
  return winningStatuses.has(status) || Boolean(hasProject) || Boolean(hasMoney);
}
