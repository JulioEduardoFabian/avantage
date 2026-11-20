/**
 * El rango de fechas que comparten las seis pestañas de Finanzas.
 *
 * Vive acá y no en cada pestaña por la misma razón que `dealCancellation.js` o
 * `src/leadCardDate.js`: "desde el 1 de octubre hasta hoy" tiene que significar
 * exactamente lo mismo en INGRESOS, en el Libro Diario, en Salarios, en
 * Comisiones, en Gastos Fijos y en el Resumen. Con una copia por pestaña, el
 * día que alguien corrija un borde (si el "hasta" incluye su propio día, si una
 * fila sin fecha entra o no) el mismo mes termina diciendo seis cifras
 * distintas según desde dónde se lo mire.
 *
 * Las dos fechas son días de calendario (`YYYY-MM-DD`), que es como las escribe
 * un `<input type="date">`, y el rango es **inclusivo en los dos extremos**:
 * quien escribe "hasta el 31/10" espera que el 31 cuente.
 */

import { limaDay } from '../../leadCardDate.js';
import { dayOnly } from './format.js';

/**
 * El "hoy" sale del reloj de Lima y no de `new Date().toISOString()`: con el
 * navegador configurado en otra zona, a las 20:00 de Lima el ISO ya es el día
 * siguiente y los presets («Hoy», «Este mes») arrancarían corridos.
 *
 * Ojo con la asimetría: el "hoy" se convierte a la zona de Lima, pero la fecha
 * de una FILA no — las columnas `fecha` son `DATE` y llegan del API como
 * `2026-09-14T00:00:00.000Z`, o sea un día de calendario disfrazado de
 * instante, así que se recorta con `dayOnly()` (ver la nota de `format.js`).
 * Pasarlas por `limaDay()` las correría un día hacia atrás.
 */
export function today() {
  return limaDay(new Date());
}

/**
 * ¿La fecha de esta fila cae dentro del rango? Sin rango, todo entra.
 *
 * Un extremo vacío queda **abierto**: "desde el 01/10" y nada más es todo lo de
 * esa fecha en adelante. Eso difiere de lo que hace el servidor con el Resumen
 * y con la matriz de Gastos Fijos, donde el extremo abierto se cierra en hoy
 * (`resolveRange()` en `backend/services/financeDateRange.js`), y la diferencia
 * es deliberada: aquellos dos son reportes de PERÍODO y sus cifras tienen que
 * contar los mismos meses que dibuja el gráfico, así que el tramo no puede
 * quedar sin cerrar. Una tabla no tiene ese problema —no hay gráfica con la que
 * cuadrar—, y poner un tope de "hoy" que no está escrito en ningún campo
 * esconde filas sin decirlo. Las dos pantallas de período nombran en su aviso
 * el tramo que de verdad contaron, justamente para que esto se vea.
 */
export function inDateRange(value, desde, hasta) {
  if (!desde && !hasta) return true;
  const day = dayOnly(value);
  // Una fila sin fecha no se puede ubicar en el tiempo: queda fuera de
  // cualquier rango en vez de colarse en todos.
  if (!day) return false;
  if (desde && day < desde) return false;
  if (hasta && day > hasta) return false;
  return true;
}

/**
 * Los atajos de la barra. Son los períodos con los que de verdad se cierra un
 * mes contable; lo que no esté acá se escribe a mano en los dos campos.
 */
export const RANGE_PRESETS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'semana', label: 'Últimos 7 días' },
  { key: 'mes-actual', label: 'Este mes' },
  { key: 'mes-pasado', label: 'Mes pasado' },
  { key: 'trimestre', label: 'Últimos 3 meses' },
  { key: 'anio-actual', label: 'Este año' }
];

/** Suma días a un día de calendario con aritmética en UTC (sin husos de por medio). */
export function addDays(day, amount) {
  const [y, m, d] = String(day || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const t = new Date(Date.UTC(y, m - 1, d + amount));
  return t.toISOString().slice(0, 10);
}

/** El primer y el último día del mes al que pertenece `day`. */
function monthBounds(day, monthsBack = 0) {
  const [y, m] = String(day || '').split('-').map(Number);
  if (!y || !m) return { desde: '', hasta: '' };
  const start = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const end = new Date(Date.UTC(y, m - monthsBack, 0));
  return { desde: start.toISOString().slice(0, 10), hasta: end.toISOString().slice(0, 10) };
}

/** El rango que representa un atajo. `hoy` es el día de Lima. */
export function presetRange(key, hoy = today()) {
  switch (key) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'semana':
      return { desde: addDays(hoy, -6), hasta: hoy };
    case 'mes-actual':
      return { desde: monthBounds(hoy).desde, hasta: hoy };
    case 'mes-pasado':
      return monthBounds(hoy, 1);
    case 'trimestre':
      // Dos meses atrás completos más el mes en curso: es el trimestre que se
      // mira para cerrar, no 90 días contados hacia atrás desde hoy.
      return { desde: monthBounds(hoy, 2).desde, hasta: hoy };
    case 'anio-actual':
      return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy };
    default:
      return { desde: '', hasta: '' };
  }
}

/** ¿Qué atajo describe este rango? Se usa para marcar el botón activo. */
export function matchingPreset(desde, hasta, hoy = today()) {
  if (!desde && !hasta) return '';
  return RANGE_PRESETS.find((p) => {
    const r = presetRange(p.key, hoy);
    return r.desde === desde && r.hasta === hasta;
  })?.key || '';
}

/** Cómo se dice el rango en una frase, para los rótulos de las tarjetas. */
export function rangeLabel(desde, hasta) {
  const escribir = (d) => {
    const [y, m, day] = dayOnly(d).split('-');
    return y && m && day ? `${day}/${m}/${y}` : '';
  };
  if (desde && hasta) return desde === hasta ? `el ${escribir(desde)}` : `del ${escribir(desde)} al ${escribir(hasta)}`;
  if (desde) return `desde el ${escribir(desde)}`;
  if (hasta) return `hasta el ${escribir(hasta)}`;
  return '';
}
