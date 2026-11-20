import { ref } from "vue";
import { apiFetch } from "../../apiClient.js";

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

/** Áreas de la empresa de fábrica del Libro Diario (espejo de `DEFAULT_AREAS` del backend). */
export const DEFAULT_AREAS = ["Ventas", "Marketing", "Operaciones", "Administración", "Recursos Humanos", "Finanzas"];

/*
 * Las listas VIGENTES: las de fábrica más las que el equipo agregó
 * (`/api/finance/options`). Son refs compartidos por todo el módulo, así que
 * una cuenta agregada en el Libro Diario aparece al instante en los
 * desplegables de las demás pestañas. Arrancan con las de fábrica para que la
 * pantalla funcione mientras la petición viaja o si falla.
 */
export const bancos = ref([...BANCOS]);
export const areas = ref([...DEFAULT_AREAS]);
/** Las agregadas, con su id: son las únicas que se pueden quitar. */
export const customOptions = ref([]);

function applyOptions(data) {
  if (Array.isArray(data?.banks) && data.banks.length) bancos.value = data.banks;
  if (Array.isArray(data?.areas) && data.areas.length) areas.value = data.areas;
  if (Array.isArray(data?.custom)) customOptions.value = data.custom;
}

let pending = null;
/** Carga las listas una vez por sesión (`force` para volver a pedirlas). */
export function loadFinanceOptions({ force = false } = {}) {
  if (pending && !force) return pending;
  pending = apiFetch("/api/finance/options")
    .then(async (res) => {
      if (res.ok) applyOptions(await res.json());
    })
    .catch(() => {});
  return pending;
}

async function mutate(url, options) {
  const res = await apiFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "No se pudo guardar el cambio.");
  applyOptions(data);
  return data;
}

/** Agrega un área (`kind: 'area'`) o una cuenta (`kind: 'banco'`). Devuelve el nombre guardado. */
export async function addFinanceOption(kind, label) {
  const data = await mutate("/api/finance/options", {
    method: "POST",
    body: JSON.stringify({ kind, label }),
  });
  return data.option?.label || label;
}

export function removeFinanceOption(id) {
  return mutate(`/api/finance/options/${id}`, { method: "DELETE" });
}

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
