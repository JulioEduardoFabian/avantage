/**
 * Opciones y cálculos que comparten la pestaña de INGRESOS y el desplegable
 * del plan de cobro. Deben coincidir con las constantes equivalentes del
 * backend (`backend/services/financeLedgerService.js`): si allá cambia la
 * lista, aquí el formulario dejaría de validar igual.
 */
/**
 * Ordinales de cuota. La lista crece más allá de las tres originales porque el
 * cronograma que se pacta al cerrar la venta puede partirse en tantos pagos
 * como acuerden las partes.
 */
export const CUOTAS = [
  "1era", "2da", "3era", "4ta", "5ta", "6ta",
  "7ma", "8va", "9na", "10ma", "11va", "12va",
];

/** El ordinal que le toca a la cuota n.º `index + 1` del cronograma. */
export function cuotaLabel(index) {
  return CUOTAS[index] || `${index + 1}va`;
}

export const EMITIR_OPCIONES = ["factura", "boleta", "nrus", "rxh", "c. interno"];
/**
 * Cuentas donde entra o sale el dinero, en el orden en que se muestran en
 * todo el módulo (ingresos, libro diario, gastos fijos, salarios, resumen y
 * el modal de cierre ganado). "BCP Finanzas" es la cuenta del área de
 * finanzas, distinta de la operativa ("BCP").
 */
export const BANCOS = ["BCP", "BCP Finanzas", "Interbank", "Efectivo"];

/** Sufijo de clase CSS de un banco ("BCP Finanzas" → "bcp-finanzas"). */
export function bankSlug(banco) {
  return String(banco || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

/** ITF según la fórmula del Excel: IF(|monto|<1000, 0, INT(|monto|/1000)*0.05). */
export function calcItf(monto) {
  const a = Math.abs(Number(monto) || 0);
  if (a < 1000) return 0;
  return Math.round(Math.floor(a / 1000) * 0.05 * 100) / 100;
}

/** Clase del pill según la etapa del cobro (pendiente → pagado → verificado). */
export function estadoPillClass(estado) {
  if (estado === "verificado") return "pill-success";
  if (estado === "pagado") return "pill-info";
  return "pill-warning";
}
