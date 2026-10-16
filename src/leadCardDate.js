/**
 * Cómo se escribe la fecha de registro de un lead en la tarjeta de los dos
 * tableros.
 *
 * Vive acá y no en cada vista porque el Setter Funnel y el Funnel de Ventas
 * muestran la MISMA tarjeta del MISMO lead: con una copia en cada pantalla, el
 * día que alguien cambie el formato en una, el mismo lead va a decir dos
 * fechas distintas según desde dónde se lo mire.
 */

/**
 * El día de calendario de Lima (`YYYY-MM-DD`), que es como lo escribe un
 * `<input type="date">`. Con el huso del navegador, un lead registrado a las
 * 23:00 caería en el día siguiente para una laptop configurada en otra zona —
 * y de eso dependen los filtros "Registrado: desde / hasta".
 */
export function limaDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

/**
 * Día y mes, y el año solo si no es el actual: en una tarjeta de 52 px de alto
 * cada carácter compite con el nombre, y "2026" en todas las filas no dice
 * nada. La fecha completa con la hora queda en el `title` (`formatLeadDate`) y
 * en la ficha.
 */
export function formatCardDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = limaDay(dateStr).slice(0, 4) === limaDay(new Date()).slice(0, 4);
  return d.toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' })
  });
}

/** La fecha completa con la hora, para el `title` de la tarjeta y la ficha. */
export function formatLeadDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
