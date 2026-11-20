/**
 * Cómo se escriben las cifras y los períodos de los reportes del panel.
 *
 * Vive aparte desde que hay más de un reporte: el nombre de un mes, un
 * porcentaje y la flecha de "mejoró / empeoró" los dicen todas las pantallas de
 * reporte, y con una copia por vista alcanza con que alguien cambie "ene 26"
 * por "enero" en una para que la misma ventana de meses se lea distinta según
 * desde dónde se mire. Las cifras de dinero NO están acá: son de las pantallas
 * que muestran importes, que son las que tienen el permiso del dinero.
 */

const intFmt = new Intl.NumberFormat('es-PE');

export const integer = (v) => intFmt.format(Number(v) || 0);

/** Un porcentaje con coma decimal, o una raya si no hay base para calcularlo. */
export const pct = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);

export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const splitKey = (key) => String(key).split('-').map(Number);

/**
 * `2026-10` → "oct". El año solo se escribe en enero —donde hace falta para no
 * leer dos eneros seguidos como el mismo— o cuando la ventana es tan larga que
 * cruza más de un año (`alwaysYear`): en un eje de doce barras cada carácter
 * compite con el de al lado.
 */
export function shortMonth(key, alwaysYear = false) {
  const [y, m] = splitKey(key);
  return m === 1 || alwaysYear ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : MONTHS_SHORT[m - 1];
}

export function longMonth(key) {
  const [y, m] = splitKey(key);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "enero 2026 – junio 2026", el período completo con sus dos extremos. */
export const periodLabel = (keys) => (
  keys?.length ? `${longMonth(keys[0])} – ${longMonth(keys[keys.length - 1])}` : ''
);

/**
 * La variación contra el período anterior, lista para pintar.
 *
 * La flecha dice si subió o bajó; el color, si eso es bueno. Que los egresos
 * suban —o que los días hasta la reunión suban— es una flecha hacia arriba en
 * rojo, y por eso son dos cosas distintas.
 */
export function delta(change, { higherIsBetter = true } = {}) {
  if (change === null || change === undefined) return null;
  if (change === 0) return { arrow: '→', text: 'sin cambio', tone: 'neutral' };
  const up = change > 0;
  return {
    arrow: up ? '▲' : '▼',
    text: `${up ? '+' : ''}${String(change).replace('.', ',')}%`,
    tone: up === higherIsBetter ? 'good' : 'bad'
  };
}

/**
 * Lo mismo para una cifra que YA es un porcentaje (o un plazo en días): la
 * diferencia va en puntos y no en "porcentaje de un porcentaje", que es lo que
 * hace que pasar del 10% al 12% se anuncie como "+20%".
 */
export function pointDelta(current, previous, { higherIsBetter = true, unit = 'pts' } = {}) {
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { arrow: '→', text: 'sin cambio', tone: 'neutral' };
  const up = diff > 0;
  return {
    arrow: up ? '▲' : '▼',
    text: `${up ? '+' : ''}${String(diff).replace('.', ',')} ${unit}`,
    tone: up === higherIsBetter ? 'good' : 'bad'
  };
}
