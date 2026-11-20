/**
 * Cuándo una cuota pendiente pasa a ser un aviso.
 *
 * El cronograma guarda la fecha PACTADA de cada cuota (`finance_income.due_date`,
 * distinta de `fecha`, el día en que entró el dinero), pero la pantalla solo la
 * escribía: una cuota que vence pasado mañana se veía igual que una que vence
 * en marzo, así que para saber a quién hay que llamar esta semana había que
 * abrir los cierres uno por uno y leer fechas.
 *
 * Tres decisiones:
 *
 *  - Solo las **pendientes**. Una cuota `pagado` es plata que el cliente ya
 *    mandó y está esperando el visto bueno de Finanzas: no hay a quién
 *    perseguir, y pintarla de rojo manda a llamar a alguien que ya pagó.
 *  - La **vencida sigue siendo roja**, y con el mismo rojo: pasarse de la fecha
 *    no es salir del aviso, es la forma más grave de estar dentro. Lo que
 *    cambia es lo que dice ("venció hace 2 días"), porque de eso depende cómo
 *    se encara la llamada.
 *  - La cuenta se hace en **días de calendario de Lima** y no en horas: la
 *    fecha pactada es un día, no un instante, y con el reloj del navegador en
 *    otra zona la cuota se pondría roja un día antes o un día después. Es el
 *    mismo cuidado que `limaDay()` en la tarjeta del lead.
 *
 * El color nunca va solo: cada aviso lleva su frase escrita al lado. Rojo y
 * ámbar son el mismo color con deuteranopía, y "esta cuota es urgente" no
 * puede depender de distinguirlos.
 */

/** Días de antelación con los que una cuota pendiente empieza a avisar. */
export const DUE_SOON_DAYS = 3;

/** El día de calendario de Lima (`AAAA-MM-DD`), como lo escribe un `<input type="date">`. */
export function limaToday(now = new Date()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

/** Tramo `AAAA-MM-DD` de una fecha del API (llega como ISO en UTC). */
function dayOf(value) {
  return String(value || '').slice(0, 10);
}

/**
 * Días enteros entre dos días de calendario, positivo si `to` está en el
 * futuro. Se restan como fechas UTC a propósito: los dos son días sueltos, y
 * construirlos en la zona del navegador le mete el horario de verano de otro
 * país a una resta que no lo necesita.
 */
export function daysBetween(from, to) {
  const a = dayOf(from).split('-').map(Number);
  const b = dayOf(to).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3 || a.some(Number.isNaN) || b.some(Number.isNaN)) return null;
  const ms = Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2]);
  return Number.isNaN(ms) ? null : Math.round(ms / 86400000);
}

/** Cómo se cuenta el plazo en voz alta. Lo lee gente que no trabaja con fechas ISO. */
export function dueLabel(days) {
  if (days == null) return '';
  if (days < -1) return `venció hace ${Math.abs(days)} días`;
  if (days === -1) return 'venció ayer';
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

/**
 * El estado de vencimiento de una cuota, o `null` si no hay nada que avisar
 * (no está pendiente, o no tiene fecha pactada).
 *
 * `urgent` es lo único que mira la pantalla para pintar: la regla —qué cuenta
 * como urgente y desde cuándo— vive acá y no repartida entre la pastilla de
 * estado, el renglón de la cuota y la insignia del cierre, que son los tres
 * sitios que la dicen.
 */
export function dueState(row, today = limaToday()) {
  if (!row || row.estado !== 'pendiente') return null;
  const due = dayOf(row.due_date);
  if (!due) return null;

  const days = daysBetween(today, due);
  if (days == null) return null;

  return {
    days,
    due,
    overdue: days < 0,
    urgent: days <= DUE_SOON_DAYS,
    label: dueLabel(days)
  };
}

/**
 * El aviso de un cierre entero: el de su cuota pendiente más próxima a vencer
 * —la vencida gana, que es la que hay que cobrar primero—. Con los cierres
 * plegados de fábrica, sin esto el aviso solo existiría para quien ya hubiera
 * abierto la fila, o sea para quien ya fue a buscarlo.
 */
export function nextDueState(rows, today = limaToday()) {
  let soonest = null;
  for (const row of rows || []) {
    const state = dueState(row, today);
    if (state && (!soonest || state.days < soonest.days)) soonest = state;
  }
  return soonest;
}
