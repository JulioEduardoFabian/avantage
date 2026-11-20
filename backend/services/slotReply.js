/**
 * Cómo contesta un contacto a la lista de horarios, leído con reglas.
 *
 * Sale de revisar las conversaciones del 14/09 al 01/11/2026 (análisis del
 * 18/11/2026). Dos fugas de la elección de horario, las dos con la lista ya en
 * pantalla:
 *
 *  1. El contacto ELIGIÓ —"2", "10.30", "la opción 3"— y en vez de reservarle,
 *     el bot le preguntaba "¿Confirmo *videollamada*, *Vie, 9 oct, 3:00 p.m.*?
 *     Responde *Sí*". Una vuelta más para algo que ya había dicho, y de los 177
 *     que recibieron esa pregunta 81 no volvieron a escribir. La confirmación
 *     existe para cuando el horario salió de INTERPRETAR una frase ("¿miércoles?
 *     salgo a las 4" terminó en una reunión el martes); repetirle lo que
 *     escribió letra por letra no protege de nada. `directSlotPick()` reconoce
 *     solo esas respuestas inequívocas, y con ellas se reserva directo.
 *
 *  2. El contacto dijo que la lista no le servía —"otro día", "otra hora",
 *     "no me calza ninguno", "en las tardes", "noche por favor"— y recibía
 *     "No te entendí bien 🤔" con la MISMA lista. A la segunda, transferido.
 *     Eso no es no entender: es la respuesta más clara que hay, y la única
 *     que pide algo concreto (otros horarios). `readSlotReply()` la reconoce
 *     para contestarle con otros horarios en vez de repetir los que ya rechazó.
 *
 * Son reglas y no el LLM a propósito, por lo mismo que la corrección de
 * carrera/universidad (`profileCorrection.js`): son frases cortas y de forma
 * fija, el paso de horarios es el más caro de perder, y tiene que funcionar
 * igual cuando el modelo tarda o falla — entre el 02 y el 16/11 el bot no
 * agendó una sola reunión. Lo que estas reglas no reconocen sigue su camino de
 * siempre (el LLM y después el "no te entendí"): ninguna devuelve un horario
 * ni un pedido que no esté escrito tal cual.
 *
 * Puro y sin dependencias: se prueba con las frases reales que se perdieron.
 */

/** Minúsculas, sin tildes, sin emojis ni signos de cierre, espacios simples. */
export function normalizeReply(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    .replace(/[¡¿!,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
}

// Lo que puede ir antes de la elección sin cambiarla: "sí, la 2", "ok 1",
// "dale el de las 3".
const LEADING_YES = '(?:(?:si|ok|okay|okey|dale|listo|perfecto|ya|bueno|claro|de acuerdo|esta bien)\\s+)?';
// Lo que puede ir después: "2 porfa", "la 3 gracias".
const TRAILING_COURTESY = '(?:\\s+(?:por ?favor|porfa|gracias|please|plis))?';

const NUMBER_PICK_RE = new RegExp(
  `^${LEADING_YES}(?:(?:la|el|opcion|numero|nro|n°|#)\\s*)*(\\d)${TRAILING_COURTESY}$`
);

const ORDINALS = { primer: 1, primera: 1, primero: 1, segunda: 2, segundo: 2, tercer: 3, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5 };
const ORDINAL_PICK_RE = new RegExp(
  `^${LEADING_YES}(?:la\\s+|el\\s+)?(${Object.keys(ORDINALS).join('|')})(?:\\s+opcion)?${TRAILING_COURTESY}$`
);

const TIME_PICK_RE = new RegExp(
  `^${LEADING_YES}(?:(?:a\\s+las?|el\\s+de\\s+las?|la\\s+de\\s+las?|las?)\\s+)?` +
  '(\\d{1,2})(?:\\s*[:.h]\\s*(\\d{2}))?\\s*' +
  '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|de la manana|de la tarde|de la noche)?' +
  `${TRAILING_COURTESY}$`
);

/**
 * El índice del horario que el contacto eligió de forma INEQUÍVOCA, o null.
 *
 * Inequívoco es: el número de la opción ("2", "la 2", "opción 3"), su ordinal
 * ("la segunda") o la hora de un único horario de la lista ("10.30", "a las
 * 3 pm", "el de las 3"). Cualquier otra cosa —una pregunta, un día nombrado,
 * una hora que coincide con dos horarios— devuelve null y se interpreta como
 * siempre.
 *
 * @param slots  los horarios que el contacto tiene en pantalla, en ese orden.
 * @param timeOf (slot) => "HH:MM" en hora de Lima.
 */
export function directSlotPick(text, slots, timeOf) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return null;
  const raw = String(text || '');
  if (raw.includes('?')) return null;
  const t = normalizeReply(raw);
  if (!t) return null;

  const number = t.match(NUMBER_PICK_RE);
  if (number) {
    const n = Number(number[1]);
    return n >= 1 && n <= list.length ? n - 1 : null;
  }

  const ordinal = t.match(ORDINAL_PICK_RE);
  if (ordinal) {
    const n = ORDINALS[ordinal[1]];
    return n >= 1 && n <= list.length ? n - 1 : null;
  }

  const time = t.match(TIME_PICK_RE);
  if (time && typeof timeOf === 'function') {
    const hour = Number(time[1]);
    const minute = time[2] ? Number(time[2]) : 0;
    if (hour > 23 || minute > 59) return null;
    const meridiem = time[3] || '';
    const isPm = /^p|tarde|noche/.test(meridiem);
    const isAm = /^a|manana/.test(meridiem);
    const candidates = new Set();
    if (isPm) candidates.add(hour % 12 + 12);
    else if (isAm) candidates.add(hour % 12);
    else {
      candidates.add(hour);
      if (hour < 12) candidates.add(hour + 12);
    }
    const wanted = [...candidates].map((h) => `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    const matches = list
      .map((slot, index) => ({ index, time: timeOf(slot) }))
      .filter((entry) => wanted.includes(entry.time));
    // Con dos horarios a la misma hora (en días distintos) "a las 3" no dice
    // cuál: eso lo decide el camino normal, que confirma antes de reservar.
    return matches.length === 1 ? matches[0].index : null;
  }

  return null;
}

/** Momento del día de una hora "HH:MM" de Lima. */
export function partOfDay(hhmm) {
  const hour = Number(String(hhmm || '').split(':')[0]);
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export const PART_LABELS = { morning: 'la mañana', afternoon: 'la tarde', evening: 'la noche' };

/** Hora representativa de cada momento, para ordenar por cercanía. */
export const PART_ANCHORS = { morning: '09:00', afternoon: '15:00', evening: '19:00' };

// Un día concreto ("el sábado", "hoy", "mañana", "el 24") lo resuelve el
// camino de fechas, que busca los horarios de ESE día. "Mañana" como día y no
// como momento: "por la mañana" / "en las mañanas" es lo otro.
const NAMED_DAY_RE = /\b(hoy|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}\s+de\s+[a-z]+)\b|(?<!\b(?:la|las|de)\s)\bmanana\b/;

// "Trabajo en el día" es la forma más común de decir "solo puedo de noche".
const EVENING_RE = /\b(noche|noches|nocturno)\b|\btrabajo\s+(?:en\s+el\s+dia|de\s+dia|todo\s+el\s+dia|en\s+las\s+mananas|por\s+las\s+mananas)\b/;
const AFTERNOON_RE = /\b(?:en|por|de)\s+(?:la|las)?\s*tardes?\b|^tardes?$|\b(?:tarde|tardes)\s+(?:por ?favor|porfa|mejor)\b/;
const MORNING_RE = /\b(?:en|por|de)\s+(?:la|las)\s+mananas?\b|\btemprano\b/;

const OTHER_DAY_RE = /\b(otros?|algun otro|diferentes?|distintos?)\s+dias?\b|\botra\s+fecha\b|\botro\s+dia\b/;
const OTHER_TIME_RE = /\b(otros?|otras?|algun otro|algunas? otras?|diferentes?|distintos?)\s+(horas?|horarios?)\b|\bmas\s+(tarde|temprano)\b/;
const NONE_FIT_RE = /\b(ninguno|ninguna)\b|\bno\s+me\s+(calza|calzan|acomoda|acomodan|queda|quedan|sirve|sirven|conviene|convienen|cuadra|cuadran)\b|\bno\s+puedo\s+(en|a)\s+(esos?|esas?)\b|\besos?\s+horarios?\s+no\b/;
const YES_WITHOUT_PICK_RE = /^(?:si|ok|okay|okey|dale|listo|claro|perfecto|ya|de acuerdo|esta bien|bueno|si claro|si de acuerdo)(?:\s+(?:por ?favor|porfa|gracias|claro|me parece))?$|^si\s+(?:podemos|quiero|me gustaria)\s+(?:coordinar|agendar|programar)(?:\s+(?:una|la))?\s+reunion$/;

/**
 * Qué pidió el contacto en vez de elegir un horario, o null si no es nada de
 * esto (ahí sigue el camino de siempre).
 *
 *   - `other_day`: "otro día", "no habría otro día en las tardes".
 *   - `other_time`: "otra hora", "otro horario", "más tarde".
 *   - `none_fit`: "no me calza ninguno", "en ninguno de esos horarios puedo".
 *   - `part_of_day`: solo un momento del día — "noche por favor", "en las tardes".
 *   - `yes_without_pick`: aceptó la reunión sin elegir — "Listo", "Si porfavor".
 *
 * `part` es el momento del día que nombró ('morning' | 'afternoon' |
 * 'evening' | null), y viaja con cualquiera de los tipos.
 *
 * Un mensaje que nombra un día concreto devuelve null: "el sábado en la tarde"
 * lo contesta mejor el camino de fechas, que busca ese día. Y con dígitos solo
 * se acepta el momento del día ("después de las 6 en la noche"): "otro día, el
 * 2 está bien" es una elección, no un rechazo.
 */
export function readSlotReply(text) {
  const t = normalizeReply(text);
  if (!t) return { kind: null, part: null };
  if (NAMED_DAY_RE.test(t)) return { kind: null, part: null };

  const part = EVENING_RE.test(t) ? 'evening'
    : AFTERNOON_RE.test(t) ? 'afternoon'
      : MORNING_RE.test(t) ? 'morning'
        : null;
  const hasDigits = /\d/.test(t);

  if (!hasDigits) {
    if (OTHER_DAY_RE.test(t)) return { kind: 'other_day', part };
    if (NONE_FIT_RE.test(t)) return { kind: 'none_fit', part };
    if (OTHER_TIME_RE.test(t)) return { kind: 'other_time', part: part || (/\bmas\s+tarde\b/.test(t) ? 'evening' : null) };
    if (YES_WITHOUT_PICK_RE.test(t)) return { kind: 'yes_without_pick', part: null };
  }
  if (part) return { kind: 'part_of_day', part };
  return { kind: null, part: null };
}
