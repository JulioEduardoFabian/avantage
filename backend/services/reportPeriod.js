/**
 * La aritmética que comparten los reportes del panel: la ventana de meses, las
 * claves `YYYY-MM`, la variación contra el período anterior y las divisiones
 * que no explotan.
 *
 * Vive aparte y no en `generalReportService.js` —donde nació— porque desde que
 * existe el Reporte de Setters son dos pantallas las que tienen que contar los
 * meses igual. Con una copia por reporte, el día que alguien corrija el cruce
 * de año o decida que "de 0 a algo no es +∞%" lo arregla en una sola y las dos
 * pantallas empiezan a decir cosas distintas del mismo período.
 */

/** Las ventanas que se ofrecen en pantalla. Fuera de esta lista no hay nada. */
export const ALLOWED_MONTHS = [3, 6, 12];
export const DEFAULT_MONTHS = 6;

export function normalizeMonths(value) {
  const n = Number(value);
  return ALLOWED_MONTHS.includes(n) ? n : DEFAULT_MONTHS;
}

const pad = (n) => String(n).padStart(2, '0');
export const monthKeyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
export const dayKeyOf = (date) => `${monthKeyOf(date)}-${pad(date.getDate())}`;

/** Las claves `YYYY-MM` de los últimos `count` meses, el actual incluido. */
export function lastMonthKeys(count, now = new Date()) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return keys;
}

/** Las claves `YYYY-MM` de los próximos `count` meses, el actual incluido. */
export function nextMonthKeys(count, now = new Date()) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.push(monthKeyOf(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }
  return keys;
}

/** El primer día del mes `YYYY-MM` como `YYYY-MM-01`. */
export const firstDayOf = (monthKey) => `${monthKey}-01`;

/** El primer día del mes siguiente a `YYYY-MM`: el tope abierto de la ventana. */
export function firstDayAfter(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return dayKeyOf(new Date(y, m, 1));
}

/** Normaliza lo que devuelve mysql2 (Date o texto) a `YYYY-MM-DD`. */
export function toDayKey(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dayKeyOf(value);
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/**
 * Variación porcentual contra el período anterior. `null` cuando no hay base:
 * pasar de 0 a algo no es "+∞%", es que antes no había nada que comparar.
 */
export function percentChange(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

/**
 * El percentil `p` (0 a 1) de una lista de números, por interpolación lineal.
 *
 * Vive acá y no en cada reporte porque es la respuesta a una pregunta que se
 * hacen los tres —Campañas y el de Setters la publican hoy, el General la va a
 * necesitar—: **la mediana sola engaña**. En el corte del 10/11/2026 la primera
 * respuesta tenía una mediana de ~20 segundos (Avan acusa recibo al instante) y
 * debajo de esa cifra había 62 leads atendidos después de 15 minutos y 51
 * después de una hora. Una medida de centro no dice nada de la cola, y la cola
 * es justo la parte que se arregla.
 *
 * El P90 por sí solo tampoco serviría: sin la mediana al lado no se distingue
 * un equipo lento de uno rápido con unos pocos casos olvidados, y se corrigen
 * distinto. Por eso las dos se publican juntas en las dos pantallas.
 *
 * Una lista vacía devuelve `null` y no 0: "nadie respondió todavía" no es
 * "responden al instante", y un cero ahí haría ver como inmejorable justo al
 * anuncio —o al setter— cuyos leads nadie atendió.
 */
export function percentile(values, p) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const pos = (nums.length - 1) * p;
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return nums[bajo];
  return nums[bajo] + (nums[alto] - nums[bajo]) * (pos - bajo);
}

/** División que no explota: sin denominador no hay tasa. */
export function ratio(part, total) {
  const t = Number(total) || 0;
  if (t === 0) return null;
  return Math.round(((Number(part) || 0) / t) * 1000) / 10;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
