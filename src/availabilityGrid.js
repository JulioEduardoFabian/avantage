/**
 * La aritmética del horario semanal de disponibilidad.
 *
 * Vive fuera de las vistas porque la misma cuenta se hace en tres sitios: el
 * Calendario (que pinta el cruce de varios asesores sobre la grilla), el modal
 * que muestra el horario de uno solo, y "Mi Disponibilidad" cuando resume la
 * semana. Copiada en cada pantalla, una arregla el borde de las 20:30 y las
 * otras siguen cortando mal.
 *
 * Dos convenciones que no son obvias y que atraviesan todo el módulo:
 *  - el día va de 0 = **lunes** a 6 = domingo, que NO es el `getDay()` del
 *    navegador (ahí 0 es domingo). Es como lo guarda `advisor_availability`;
 *  - un bloque son 30 minutos y se nombra por su INICIO: el de las 20:30 cubre
 *    hasta las 21:00.
 */

export const SLOT_MINUTES = 30;

/** El rango que se dibuja, el mismo que ofrece "Mi Disponibilidad". */
export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 21;

export const DAYS = [
  { value: 0, label: 'Lunes', short: 'Lun' },
  { value: 1, label: 'Martes', short: 'Mar' },
  { value: 2, label: 'Miércoles', short: 'Mié' },
  { value: 3, label: 'Jueves', short: 'Jue' },
  { value: 4, label: 'Viernes', short: 'Vie' },
  { value: 5, label: 'Sábado', short: 'Sáb' },
  { value: 6, label: 'Domingo', short: 'Dom' }
];

/** Los inicios de bloque del día, de 07:00 a 20:30. */
export const TIME_SLOTS = (() => {
  const slots = [];
  for (let minutos = DAY_START_HOUR * 60; minutos < DAY_END_HOUR * 60; minutos += SLOT_MINUTES) {
    slots.push(hhmm(minutos));
  }
  return slots;
})();

export function minutesOf(value) {
  const [h, m] = String(value).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function hhmm(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * El día de la semana de una fecha, en la convención de acá (0 = lunes).
 */
export function weekdayOf(date) {
  return (date.getDay() + 6) % 7;
}

/**
 * Cuántos de los asesores elegidos están libres en cada bloque.
 *
 * Devuelve `{ "<día>-<hh:mm>": cantidad }`. Se cuenta en vez de responder
 * sí/no porque con tres asesores elegidos lo útil no es solo dónde coinciden
 * los tres —que a menudo es en ningún lado— sino dónde coinciden dos: la
 * pantalla pinta más fuerte el bloque donde están todos y más suave el resto,
 * y así una franja casi buena se ve en lugar de desaparecer.
 */
export function countAvailability(slots) {
  const conteo = {};
  for (const slot of slots || []) {
    const clave = `${slot.day_of_week}-${String(slot.start_time).slice(0, 5)}`;
    conteo[clave] = (conteo[clave] || 0) + 1;
  }
  return conteo;
}

/**
 * Los bloques sueltos unidos en rangos corridos: 09:00 y 09:30 son
 * "09:00 a 10:00", y un hueco en el medio los parte. Es lo que hay que leer
 * antes de proponer una hora; la grilla de casillas se lee peor.
 *
 * `starts` son los inicios en minutos (o en "hh:mm"), de un mismo día.
 */
export function mergeRanges(starts) {
  const ordenados = [...(starts || [])]
    .map((valor) => (typeof valor === 'number' ? valor : minutesOf(valor)))
    .sort((a, b) => a - b);
  if (ordenados.length === 0) return [];

  const tramos = [];
  let inicio = ordenados[0];
  let previo = ordenados[0];

  for (const actual of ordenados.slice(1)) {
    if (actual - previo > SLOT_MINUTES) {
      tramos.push({ start: inicio, end: previo + SLOT_MINUTES });
      inicio = actual;
    }
    previo = actual;
  }
  tramos.push({ start: inicio, end: previo + SLOT_MINUTES });
  return tramos;
}

export function formatRange(range) {
  return `${hhmm(range.start)} a ${hhmm(range.end)}`;
}

/** "3 h 30 min" a partir de minutos, para los totales de la cabecera. */
export function formatDuration(minutes) {
  const horas = Math.floor(minutes / 60);
  const resto = minutes % 60;
  if (horas === 0) return `${resto} min`;
  if (resto === 0) return `${horas} h`;
  return `${horas} h ${resto} min`;
}
