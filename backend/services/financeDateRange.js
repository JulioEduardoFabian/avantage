/**
 * La ventana de fechas que recortan las pantallas de Finanzas, en reglas puras
 * y sin base de datos de por medio.
 *
 * Vive en su propio módulo —y no inline en `financeLedgerService.js`— porque de
 * acá cuelgan las dos consultas más caras del área (el resumen y la matriz de
 * gastos fijos) y porque los bordes de un rango son justo lo que se rompe en
 * silencio: un "hasta" que no incluye su propio día deja afuera lo cobrado el
 * último día del mes, y un recorte de meses que no coincide con el de los
 * totales hace que la gráfica y las tarjetas de arriba digan cifras distintas.
 * Separado, se puede probar sin levantar la base.
 *
 * Todas las fechas son días de calendario (`YYYY-MM-DD`): las columnas `fecha`
 * de `finance_income`, `finance_journal` y `finance_salaries` —y el `paid_at`
 * de `sales_commissions`— son de tipo `DATE`, así que comparar día contra día
 * es exacto y además usa el índice.
 */

/** Cuántos meses puede tener una ventana: más columnas no se leen en pantalla. */
export const MAX_WINDOW_MONTHS = 24;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Un día de calendario válido, o null. Acepta también `YYYY-MM` (lo toma como
 * el día 1) y recorta un ISO con hora, que es lo que manda un `<input
 * type="date">` cuando algo lo serializa de más.
 */
export function parseDay(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (MONTH_RE.test(text)) return `${text}-01`;
  const day = text.slice(0, 10);
  if (!DAY_RE.test(day)) return null;
  // Un 2026-02-31 pasa el patrón pero no existe: se descarta en vez de
  // convertirse en marzo a espaldas de quien lo escribió.
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? day : null;
}

/** El mes (`YYYY-MM`) al que pertenece un día. */
export function monthOf(day) {
  return String(day || '').slice(0, 7);
}

/**
 * El día de calendario de Lima. El "hoy" del servidor no puede ser
 * `new Date().toISOString()`: el proceso corre en UTC, así que a las 20:00 de
 * Lima el ISO ya es el día siguiente y un rango "desde el 1 hasta hoy"
 * incluiría un día que todavía no empezó.
 */
export function limaToday(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

/**
 * El rango que de verdad se va a aplicar, a partir de lo que pidió la pantalla.
 *
 * **Un extremo abierto se cierra**, y no se lee como "ese mes y nada más":
 *  - sin `hasta`, el tramo llega hasta **hoy** (o hasta el propio `desde` si
 *    alguien pide un rango que arranca en el futuro);
 *  - sin `desde`, el tramo arranca lo más atrás que permita el tope de meses.
 *
 * Cerrar los dos extremos no es una formalidad: de eso depende que los totales
 * y la gráfica cuenten **las mismas filas**. Con un extremo sin cerrar, la
 * tarjeta de arriba sumaría meses que la curva no dibuja, que es exactamente el
 * tipo de cifra que no cuadra con nada de lo que tiene al lado.
 *
 * Devuelve `null` cuando no se pidió ningún rango —quien llama usa entonces su
 * propia ventana por defecto— y `periods: []` cuando el rango es imposible (las
 * dos fechas al revés).
 */
export function resolveRange({ from = null, to = null, max = MAX_WINDOW_MONTHS, today = null } = {}) {
  const pedidoDesde = parseDay(from);
  const pedidoHasta = parseDay(to);
  if (!pedidoDesde && !pedidoHasta) return null;

  const hoy = parseDay(today) || limaToday();
  // Sin "hasta": hasta hoy. Si el rango arranca más adelante que hoy (una cuota
  // adelantada que alguien quiere mirar), el propio "desde" cierra el tramo en
  // vez de dejarlo al revés.
  const hasta = pedidoHasta || (pedidoDesde > hoy ? pedidoDesde : hoy);
  // Sin "desde": lo más atrás que entre en el tope de meses, contado desde el
  // mes del "hasta".
  const desde = pedidoDesde || firstDayOfMonthsBack(hasta, max - 1);

  if (desde > hasta) return { desde, hasta, periods: [] };

  const periods = monthsBetween(desde, hasta, max);
  /*
   * Si el tramo se recortó al tope de columnas, el "desde" que se devuelve es
   * el del primer mes que QUEDÓ y no el que se pidió: es el tramo que las
   * consultas van a contar (ver `sqlWindow()`), y es el que la pantalla escribe
   * en su aviso. Devolver el pedido haría que la tarjeta dijera "del 01/01/2020
   * al 31/10/2026" sumando solo los últimos dos años.
   */
  const primerDiaDelTramo = `${periods[0]}-01`;
  return {
    desde: desde > primerDiaDelTramo ? desde : primerDiaDelTramo,
    hasta,
    periods
  };
}

/** El primer día del mes que está `amount` meses antes del de `day`. */
function firstDayOfMonthsBack(day, amount) {
  const [y, m] = String(day || '').split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - amount, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Los meses (`YYYY-MM`) que toca el tramo, los dos extremos inclusive. Si es
 * más largo que `max` se devuelven los **últimos** `max`: de un rango de años
 * lo que se revisa es cómo viene terminando, y cien columnas no se leen.
 */
function monthsBetween(desde, hasta, max) {
  const out = [];
  let [y, m] = monthOf(desde).split('-').map(Number);
  const [ly, lm] = monthOf(hasta).split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

/**
 * Los meses del tramo pedido, o `null` si no se pidió rango. Atajo sobre
 * `resolveRange()` para quien solo necesita las columnas.
 */
export function periodsBetween(from, to, { max = MAX_WINDOW_MONTHS, today = null } = {}) {
  return resolveRange({ from, to, max, today })?.periods ?? null;
}

/** El primer día del mes siguiente a `period` (`YYYY-MM`). */
export function monthAfter(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  if (!y || !m) return null;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * La ventana que se escribe en el SQL, a partir del rango que pidió la pantalla
 * y de los meses que se van a graficar.
 *
 * - `from` es el día pedido si lo hay; si no, el primer día del primer mes del
 *   gráfico.
 * - `before` es el día **siguiente** al último del tramo, para poder comparar
 *   con `<` en vez de `<=`: el "hasta" tiene que incluir su propio día, y un
 *   `<= hasta` falla en cuanto la columna deja de ser `DATE` (`paid_at` lo es
 *   hoy; `created_at`, no). Con `< before` el borde es el mismo en los dos
 *   casos.
 *
 * Cuando no se pidió rango, la ventana es la de los meses del gráfico — que es
 * exactamente lo que hacía el resumen antes de que existiera el filtro.
 *
 * Devuelve `null` cuando no hay ventana que escribir: sin meses, o con las dos
 * fechas al revés dentro del mismo mes (31/10 → 01/10, que `periodsBetween` no
 * puede detectar porque los dos extremos caen en octubre). Sin ese control la
 * ventana salía `from > before`, o sea una consulta que no puede devolver nada:
 * el resultado en pantalla era el correcto —un período vacío— pero por
 * accidente, y "funciona porque el SQL no encuentra nada" es justo lo que deja
 * de funcionar en cuanto alguien cambia una comparación.
 */
export function sqlWindow({ from = null, to = null, periods = [] } = {}) {
  if (periods.length === 0) return null;
  const desde = parseDay(from);
  const hasta = parseDay(to);
  if (desde && hasta && desde > hasta) return null;
  const primerMes = periods[0];
  const ultimoMes = periods[periods.length - 1];
  return {
    // Si el rango pedido empieza antes del primer mes graficado (porque el
    // tramo se recortó a 24 columnas), manda el mes: los totales y la gráfica
    // tienen que contar lo mismo o la tarjeta de arriba no cuadra con la curva.
    from: desde && monthOf(desde) >= primerMes ? desde : `${primerMes}-01`,
    before: hasta && monthOf(hasta) <= ultimoMes ? addDay(hasta) : monthAfter(ultimoMes)
  };
}

/** El día siguiente, con aritmética en UTC (sin husos de por medio). */
export function addDay(day) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
