/**
 * Qué QUIERE el mensaje que acaba de llegar, contestado en un solo sitio y
 * con reglas, nunca con el LLM.
 *
 * Las intenciones que importan ya se detectaban, pero repartidas en tres
 * lugares con tres criterios: las cuatro señales críticas en `leadSignals.js`
 * (plantón, reclamo, pedido de persona, frustración), la pregunta de precio en
 * una constante dentro de `whatsappBotService.js`, y la urgencia **solo** en
 * `parseUrgency()`, que lee la ficha de un formulario de anuncio. Eso dejaba
 * dos huecos concretos:
 *
 * - **La urgencia escrita a mano no existía.** "Sustento el viernes",
 *   "lo necesito para mañana", "es urgente" entraban como texto cualquiera: el
 *   bot los trataba igual que a quien está averiguando para el otro semestre,
 *   y el asesor no se enteraba de la fecha. Es el dato que decide a quién se
 *   llama primero y el único que tiene vencimiento.
 * - **Un documento no era una intención, era un estorbo.** El PDF o la foto
 *   del plan de tesis caían en "no puedo abrir esto" (ver
 *   `handleUnreadableMessage`), que es verdad y no es lo importante: mandar un
 *   documento es pedir que alguien lo revise.
 *
 * Se contesta con reglas y no con el modelo por lo mismo que las señales
 * críticas: son los mensajes donde equivocarse cuesta más caro, y de varios de
 * ellos cuelga que la conversación se escale a una persona. Un detector que
 * "casi siempre" acierta es justo lo que no sirve acá.
 */

import { criticalSignal, detectLeadSignals } from './leadSignals.js';

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ¿Está preguntando por el PRECIO? Vivía como `PRICE_QUESTION_RE` dentro de
 * `whatsappBotService.js` y se mueve acá sin cambiarle una coma: del mismo
 * texto dependen el ancla de precio de la conversación libre, el atajo de la
 * segunda insistencia y `looksLikeQuestion()`, así que tener la regla en dos
 * sitios es como se llega a que el bot ancle el precio y después no reconozca
 * que se lo volvieron a preguntar.
 */
export const PRICE_QUESTION_RE = /(precio|costo|coste|tarifa|cotiza|presupuesto|inversi[oó]n)|cu[aá]nt[oa]s?\s+(?:me\s+)?(?:cuesta|sale|vale|ser[ií]a|es|est[aá])/i;

export function asksAboutPrice(text) {
  return PRICE_QUESTION_RE.test(String(text || ''));
}

/**
 * Urgencia declarada en texto libre.
 *
 * Tres familias y no una, porque se responden distinto: una **fecha tope**
 * ("sustento el viernes", "entrego el 20") es lo más fuerte que puede decir un
 * lead y lo que no se puede dejar para mañana; la **prisa** sin fecha ("es
 * urgente", "lo necesito ya") pide atención hoy; y el **plazo corto**
 * ("para esta semana", "en 3 días") ubica el caso sin ser ninguno de los dos.
 *
 * Lo que NO está acá a propósito: "rápido" suelto ("¿responden rápido?",
 * "¿lo hacen rápido?") es una pregunta sobre el servicio y no una urgencia del
 * contacto, y tratarla como tal pondría media bandeja en prioridad alta.
 */
const DEADLINE_RE = /\b(?:sustent|defiend|defens|present|entreg|vence|plazo|fecha\s+l[ií]mite|deadline)\w*\s+(?:el|la|los|las|este|esta|mi|para)?\s*(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}\b)|\b(?:mi|la)\s+(?:sustentacion|defensa|presentacion|entrega)\s+(?:es|sera|la\s+tengo)\b|tengo\s+(?:que|hasta)\b[^.!?]{0,25}?\b(?:entregar|presentar|sustentar)/;
const RUSH_RE = /\bes\s+urgente\b|\burgente(?:mente)?\b|\burge\b|lo\s+antes\s+posible|cuanto\s+antes|de\s+inmediato|ya\s+mismo|para\s+(?:hoy|ahora|ayer|mañana|manana)|lo\s+necesito\s+(?:ya|hoy|urgente|para\s+(?:hoy|mañana|manana))|estoy\s+(?:contra\s+el\s+tiempo|a\s+(?:las\s+)?corrida)|no\s+me\s+(?:da|queda)\s+tiempo|se\s+me\s+(?:vence|acaba)\s+el\s+(?:plazo|tiempo)/;
const SHORT_TERM_RE = /esta\s+semana|en\s+(?:\d{1,2}|dos|tres|cuatro|cinco)\s+d[ií]as|para\s+(?:el\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|antes\s+del?\s+(?:\d{1,2}|lunes|martes|miercoles|jueves|viernes)/;

/**
 * La urgencia del mensaje: `deadline` | `rush` | `soon`, o null.
 *
 * El orden es el de prioridad y no el de escritura: un mensaje puede traer las
 * tres ("es urgente, sustento el viernes, para esta semana") y lo que importa
 * es la más dura, que es la que tiene fecha.
 */
export function detectUrgency(text) {
  const clean = normalize(text);
  if (!clean || clean.length > 300) return null;
  if (DEADLINE_RE.test(clean)) return 'deadline';
  if (RUSH_RE.test(clean)) return 'rush';
  if (SHORT_TERM_RE.test(clean)) return 'soon';
  return null;
}

/**
 * La urgencia traducida al catálogo que ya guarda la sesión (`answers.urgency`,
 * el de `parseUrgency()` de las fichas de formulario), para que el texto libre
 * y el formulario escriban el MISMO vocabulario: con dos escalas, el asesor
 * que mira la ficha no sabe si "asap" y "deadline" son lo mismo.
 */
const URGENCY_TO_ANSWERS = { deadline: 'asap', rush: 'asap', soon: 'pronto' };

export function urgencyAnswerValue(urgency) {
  return URGENCY_TO_ANSWERS[urgency] || null;
}

/**
 * Mandó un archivo que hay que mirar con ojos humanos.
 *
 * Se decide por el TIPO de mensaje de WhatsApp y no por su texto: el cuerpo de
 * un documento es su nombre de archivo o su epígrafe, y adivinar por ahí es
 * adivinar. El sticker queda fuera —no es contenido, es una reacción— y el
 * audio también: ese ya tiene su propio camino (se transcribe con Whisper y
 * entra como si lo hubieran escrito), así que pedirle a alguien que lo revise
 * a mano sería mandar a revisar algo que el bot sí pudo leer.
 */
const REVIEWABLE_MEDIA_TYPES = new Set(['document', 'image', 'video']);

export function isReviewableMedia(messageType) {
  return REVIEWABLE_MEDIA_TYPES.has(String(messageType || '').toLowerCase());
}

/**
 * Las intenciones del mensaje, ordenadas por lo que corresponde atender
 * primero. Es la lista completa y no la ganadora porque las dos preguntas se
 * hacen: el enrutado necesita una ("¿qué hago con esto?") y la bitácora de
 * calidad necesita todas ("¿de qué venía hablando el lead que se perdió?").
 *
 * El orden sale de qué cuesta más caro ignorar, que es el mismo criterio de
 * `SIGNAL_TESTS`: primero lo que ya está roto (el reclamo, el pedido de
 * persona), después lo que tiene fecha (la urgencia), y de último lo que es
 * una consulta normal (precio, documento).
 */
const INTENT_ORDER = ['complaint', 'humanRequest', 'noShow', 'frustration', 'urgency', 'price', 'document'];

/**
 * @param {string} text  El texto del mensaje.
 * @param {{ messageType?: string }} [opciones]
 * @returns {{ intents: string[], top: string|null, urgency: string|null, signals: object }}
 */
export function detectIntents(text, { messageType = 'text' } = {}) {
  const signals = detectLeadSignals(text);
  const urgency = detectUrgency(text);

  const present = new Set();
  for (const [name, hit] of Object.entries(signals)) {
    if (hit) present.add(name);
  }
  if (urgency) present.add('urgency');
  if (asksAboutPrice(text)) present.add('price');
  if (isReviewableMedia(messageType)) present.add('document');

  const intents = INTENT_ORDER.filter((name) => present.has(name));

  return {
    intents,
    top: intents[0] || null,
    urgency,
    signals,
    // La señal crítica se sigue preguntando a `leadSignals` y no se deriva de
    // esta lista: de ella depende el escalado a una persona, y acá se agregaron
    // intenciones (precio, documento, urgencia) que NO escalan. Derivarla del
    // `top` mandaría a un asesor cada pregunta de precio.
    critical: criticalSignal(text)
  };
}

/**
 * Cómo se nombra una intención en un aviso al equipo. En español y en una
 * frase, porque esto se lee en la campana del panel y en un correo, no en un
 * log: "humanRequest" no le dice nada a quien tiene que actuar.
 */
const INTENT_LABELS = {
  complaint: 'un reclamo',
  humanRequest: 'un pedido de hablar con una persona',
  noShow: 'un plantón en la reunión',
  frustration: 'frustración con el bot',
  urgency: 'una urgencia declarada',
  price: 'una consulta de precio',
  document: 'un documento para revisar'
};

export function intentLabel(intent) {
  return INTENT_LABELS[intent] || null;
}

/**
 * Prioridad de atención del contacto: `alta` | `media` | `normal`.
 *
 * Es lo que viaja a la derivación al CRM para que la cola tenga un orden. La
 * urgencia con fecha y lo que ya está roto van arriba; una pregunta de precio
 * es intención de compra pero no una emergencia, así que no desplaza a un
 * reclamo.
 */
export function attentionPriority({ intents = [], urgency = null } = {}) {
  if (urgency === 'deadline') return 'alta';
  if (intents.some((i) => ['complaint', 'noShow', 'humanRequest'].includes(i))) return 'alta';
  if (urgency || intents.includes('frustration')) return 'media';
  return 'normal';
}
