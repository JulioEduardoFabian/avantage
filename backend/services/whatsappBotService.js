import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { WhatsappBotSettingsService } from './whatsappBotSettingsService.js';
import { buildKnowledgeBlock, meetingDurationLabel } from './whatsappBotPromptDefaults.js';
import { MIN_BOOKING_LEAD_MINUTES } from './googleCalendarService.js';
import { normalizeUniversity } from './universityNormalizer.js';
import { normalizeCareer } from './careerNormalizer.js';
import { sanitizeMeetLink } from './googleCalendarService.js';
import { criticalSignal, isTrustDoubt, mayBeRefusal, saysNotInterested } from './leadSignals.js';
import { coalesceTimeFragments } from './messageFragments.js';
import * as whatsappBotCopy from '../copy/whatsappBotCopy.js';
import { evaluateQualification, normalizeAcademicStatus, normalizeCycle, normalizeThesisSituation } from './leadQualification.js';
import { leadHasGraduated, loadSalesFunnelStatuses } from './salesFunnelStage.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from './leadService.js';

// Motivo que ve el equipo en la notificación de transferencia, por señal
// crítica detectada (ver `leadSignals.js`). Se redactan desde el punto de
// vista de quien va a retomar la conversación: lo primero que necesita saber
// es en qué estado emocional está el lead al que va a escribir.
const CRITICAL_SIGNAL_REASONS = {
  noShow: 'El lead dice que se quedó esperando y el asesor no entró a la reunión. URGENTE: contactarlo cuanto antes.',
  complaint: 'El lead puso una queja sobre el servicio. URGENTE: revisar su caso antes de responderle.',
  humanRequest: 'El lead pidió explícitamente hablar con una persona.',
  frustration: 'El lead se quejó de que el bot no lo entiende o le repite las preguntas: la conversación automática ya no avanza.'
};

const MAX_ACTIVITY_LOG = 100;

// Espera mínima estricta entre dos mensajes salientes del bot al MISMO
// contacto: evita ráfagas de mensajes instantáneos que WhatsApp puede marcar
// como comportamiento de spam/bot (afecta la calidad del número o lo lleva a
// una restricción). Es configurable por contacto desde el panel
// (whatsapp_bot_settings.message_gap_seconds); este valor solo es el
// respaldo si la configuración no está disponible.
const DEFAULT_MESSAGE_GAP_MS = (Number(process.env.WHATSAPP_BOT_MESSAGE_GAP_SECONDS) || 5) * 1000;

// Pausa breve de "está escribiendo" antes de un mensaje cuando ya pasó de
// sobra la espera mínima desde el mensaje anterior (para que no salga
// instantáneo tras una operación lenta como la llamada al LLM).
const TYPING_PAUSE_MS = 1500;

// Segundo extra que se suma a la espera de CADA mensaje, encima del gap
// configurado y del tiempo de tecleo. Con la campaña entrando muchos leads a
// la vez, las respuestas salían demasiado rápidas y se sentían automáticas;
// este margen fijo hace que Avan se tome un poco más entre mensaje y mensaje.
const EXTRA_MESSAGE_DELAY_MS = (Number(process.env.WHATSAPP_BOT_EXTRA_DELAY_SECONDS) || 1) * 1000;

// Cuánto "tarda en escribir" Avan, por palabra. El gap configurable de arriba
// existe por otra razón (no parecer spam ante WhatsApp) y es el mismo para
// todos los mensajes; esto es lo que hace que el ritmo se sienta de una
// persona: un mensaje largo tarda más en llegar que un "Perfecto 👀", porque
// escribirlo toma más. Recibir cuatro renglones al mismo tiempo que un acuse
// de dos palabras es de las cosas que más delatan a un bot.
const WORD_TYPING_MS = 180;
const MIN_TYPING_MS = 900;
// Tope: pasado cierto punto la espera deja de leerse como que alguien está
// escribiendo y empieza a leerse como que nadie contesta.
const MAX_TYPING_MS = 4500;

/**
 * Tiempo verosímil de tecleo para un texto, con una variación aleatoria de
 * ±15% para que dos mensajes del mismo largo no lleguen con el mismo retraso
 * exacto — la regularidad milimétrica es, en sí misma, una señal de bot.
 */
function typingTimeFor(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const jitter = 0.85 + Math.random() * 0.3;
  const ms = Math.round(words * WORD_TYPING_MS * jitter);
  return Math.min(Math.max(ms, MIN_TYPING_MS), MAX_TYPING_MS);
}

// Asesor cuyo Google Calendar usa el bot para agendar las llamadas que
// ofrece al terminar de calificar el tema (por ahora uno solo, fijo, en vez
// de resolver dinámicamente a partir de "assigned_to" del lead).
const BOOKING_ADVISOR_USER_ID = Number(process.env.GOOGLE_BOOKING_ADVISOR_USER_ID) || 1;

// Horizonte máximo de agendamiento: solo se ofrecen (y aceptan) horarios de
// hoy hasta N días más adelante. days = N + 1 en los constructores de bloques,
// que cuentan el día 0 = hoy. Por defecto 2: hoy, mañana y pasado mañana.
//
// Estaba en 1 (solo hoy y mañana) y era la causa de varios "Ese día no hay
// agenda" que el contacto leía como un error: quien pedía el miércoles un
// lunes, o "el sábado", nombraba un día perfectamente razonable que
// simplemente caía fuera de una ventana de dos días. Ampliarla más es
// decisión del equipo: basta con WHATSAPP_BOOKING_MAX_DAYS_AHEAD (p. ej. 6 =
// toda la semana), y los horarios ofrecidos siempre salen del horario semanal
// del asesor y de su calendario real.
const MAX_BOOKING_DAYS_AHEAD = Number(process.env.WHATSAPP_BOOKING_MAX_DAYS_AHEAD) || 2;
const BOOKING_WINDOW_DAYS = MAX_BOOKING_DAYS_AHEAD + 1;

// Tope de bloques al consultar TODA la ventana de agenda. Los bloques vienen
// en orden cronológico y el tope corta los últimos: con uno bajo (era 100) y
// una semana de agenda, los últimos días desaparecían de los días disponibles
// y el bot decía "ese día no hay agenda" teniendo espacio.
const UPCOMING_SLOTS_LIMIT = 1000;

// Horarios concretos que se proponen en el primer ofrecimiento cuando hay
// varios días con agenda, repartidos entre los días más próximos.
const FIRST_OFFER_SLOTS = 5;
const FIRST_OFFER_MAX_PER_DAY = 2;

// Cantidad de horarios que se le ofrecen al contacto a la vez.
const SLOTS_TO_OFFER = 3;

// Nunca se le manda una lista con menos de estos horarios cuando pidió una
// hora concreta: recibir una sola opción (y encima peor que la que pidió) lo
// obliga a volver a proponer a ciegas. Si el día que eligió no da para tanto,
// se completa con los bloques más cercanos de los otros días con agenda.
const MIN_SLOTS_TO_OFFER = 2;

// Cuántas respuestas seguidas que no eligen ninguna opción se toleran antes de
// pasarle la conversación a un asesor. Con el tope alto el bot repetía dos y
// tres veces el mismo "no reconocí esa opción", que es exactamente el bucle
// que hace que el contacto deje de responder: si a la segunda no coincidimos,
// lo coordina una persona.
const MAX_SLOT_CHOICE_ATTEMPTS = 2;

// El mismo tope, pero para el resto de pasos del agendamiento (modalidad,
// teléfono, día): cuántas respuestas seguidas que no se pueden leer como el
// dato del paso se toleran antes de pasarle la conversación a un asesor.
// Sin esto, elegir modalidad repetía "Responde *1* ... o *2*" sin límite ante
// cualquier cosa que no fuera un número ("👍🏼", "hasta la vista baby"): el
// contacto ya no estaba respondiendo al menú y el bot seguía insistiendo.
const MAX_STEP_MISSES = 2;

// Tope aparte para los turnos que SÍ se atendieron dentro de un mismo paso
// (preguntas sueltas respondidas y el paso retomado). Responderlas está bien,
// pero quien lleva cuatro mensajes preguntando cosas sin elegir opción quiere
// hablar con una persona, no recibir el mismo menú una quinta vez.
// Cuánto tiempo se considera que la lista de horarios sigue "a la vista" en
// el chat: dentro de esa ventana, retomar el paso es una línea y no el bloque
// entero repetido.
const SLOT_LIST_VISIBLE_MS = 3 * 60 * 60 * 1000;

const MAX_STEP_TURNS = 4;

// Estados del flujo de agendamiento (todos "esperan respuesta del contacto").
const SCHEDULING_STATUSES = ['scheduling_mode', 'scheduling_phone', 'scheduling_email', 'scheduling_date', 'scheduling_time', 'scheduling_confirm'];

// Paso previo al agendamiento para los leads que llegan del formulario de un
// anuncio: se les hace UNA pregunta cerrada ("¿coordinamos?") y los horarios
// salen recién cuando contestan. Ver `whatsappBotCopy.warmupAsk`. No entra en
// SCHEDULING_STATUSES porque todavía no hay nada que agendar: no existe
// `answers.__scheduling`, y todo lo que cuelga de esa lista (el debounce del
// agendamiento, el reenrutado a handleSchedulingTurn) lo da por hecho.
const WARMUP_STATUS = 'warmup';

/** Cómo se le nombra al contacto la modalidad que eligió. */
export function modeLabel(mode) {
  return mode === 'phone' ? 'llamada telefónica' : 'videollamada por Google Meet';
}

/**
 * ¿El contacto dijo que sí? Ante la duda NO se reserva: el paso de
 * confirmación existe precisamente para no agendar sobre una interpretación.
 *
 * Lo que descalifica un sí es que traiga una CORRECCIÓN detrás ("sí, pero el
 * jueves"), no que traiga palabras detrás. Antes se exigía que el mensaje
 * entero fuera la afirmación, y con eso "Si esta bien." —un sí redondo— caía
 * al camino de corrección: el 25/09 el bot le soltó a un lead el horario que
 * acababa de aceptar y le costó cuatro turnos más volver al mismo bloque.
 *
 * Por eso son dos piezas: una CABEZA que afirma y una cola de refuerzos que
 * no cambian el sentido ("sí, está bien", "ok perfecto", "sí claro gracias").
 * Cualquier palabra fuera de esas dos listas rompe la coincidencia, así que
 * "sí tengo una duda" o "sí, pero mejor el jueves" siguen sin ser un sí —
 * este último además lo veta `SCHEDULE_CHANGE_HINT_RE`.
 */
const AFFIRMATIVE_HEAD = String.raw`(?:s[ií]+|sip|sipi|claro|dale|ok(?:ey)?|okay|listo|perfecto|correcto|exacto|confirmo|confirmado|de\s+acuerdo|va|ya|as[ií]\s+es|me\s+parece|excelente|genial|(?:as[ií]\s+)?est[aá]\s+bien)`;

const AFFIRMATIVE_TAIL = String.raw`(?:s[ií]|claro|dale|ok(?:ey)?|okay|listo|perfecto|correcto|exacto|excelente|genial|va|ya|pues|entonces|que\s+s[ií]|bien|todo\s+bien|de\s+acuerdo|as[ií]\s+es|(?:as[ií]\s+)?est[aá]\s+bien|me\s+parece|sin\s+problema|adelante|confirmo|confirmado|por\s+favor|porfa|porfis|gracias|muchas\s+gracias)`;

const AFFIRMATIVE_RE = new RegExp(String.raw`^${AFFIRMATIVE_HEAD}(?:\s+${AFFIRMATIVE_TAIL})*$`, 'i');

export function isAffirmative(text) {
  const clean = normalize((text || '').trim()).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  if (SCHEDULE_CHANGE_HINT_RE.test(text || '')) return false;
  return AFFIRMATIVE_RE.test(clean);
}

/**
 * ¿El contacto dijo que no, y solo eso? Se exige la negación SUELTA ("no",
 * "ahora no", "por ahora no gracias") y no la palabra "no" en cualquier
 * parte: "no sé si el jueves me alcance" o "no entendí" son justo lo
 * contrario de un rechazo — son un lead que sigue conversando. Ante la duda
 * devuelve false, y quien llama lo manda a la conversación libre, que sabe
 * interpretarlo mejor que una regex.
 */
const EXPLICIT_NO_RE = /^(?:(?:por\s*)?(?:ahora|hoy|ahorita)\s*)?no+(?:\s*(?:gracias|por\s*ahora|por\s*el\s*momento|ahora|ahorita|todav[ií]a|quiero|me\s*interesa))?$/i;

export function isExplicitNo(text) {
  const clean = normalize((text || '').trim()).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  return EXPLICIT_NO_RE.test(clean);
}

// Descuento que se aplica si el lead elige reunión por Google Meet en vez de
// llamada telefónica (solo informativo: lo confirma el ).
const MEET_DISCOUNT_PCT = Number(process.env.WHATSAPP_MEET_DISCOUNT_PCT) || 10;

// Los mensajes de un contacto suelen llegar en varias burbujas seguidas
// (p. ej. "Hola" y luego, unos segundos después, el tema real). En vez de
// mandarle cada burbuja al LLM por separado, se espera este tiempo de
// silencio para juntar todo en un solo mensaje antes de procesar el turno.
// Al inicio de la conversación la espera es mayor: es cuando la gente escribe
// más entrecortado ("hola" / "quiero info sobre el costo").
const MESSAGE_DEBOUNCE_MS = Number(process.env.WHATSAPP_BOT_FIRST_MESSAGE_DEBOUNCE_MS) || 7000;

// En el agendamiento y después de agendar la espera es más corta: ahí el
// contacto casi siempre responde en una sola burbuja ("2", su correo, el
// número del horario), y hacerlo esperar lo mismo que en la conversación
// libre para confirmarle algo que ya eligió se siente lento.
const SCHEDULING_DEBOUNCE_MS = Number(process.env.WHATSAPP_BOT_SCHEDULING_DEBOUNCE_MS) || 5000;
const POST_BOOKING_DEBOUNCE_MS = Number(process.env.WHATSAPP_BOT_POST_BOOKING_DEBOUNCE_MS) || 5000;

// El "¿Confirmo <horario>?" es la excepción: ahí la respuesta llega partida
// mucho más seguido que en el resto del agendamiento, porque al sí se le pega
// un pedido ("Si esta bien.." + "Me envía enlace por este numero porfavor").
// Con los 5 s del resto de los pasos cada burbuja abría su propio turno y la
// reunión ya aceptada se perdía (caso real del 28/09). Es el único paso donde
// esperar de más no cuesta nada: el contacto acaba de decir que sí y lo que
// sigue es la confirmación, no una pregunta que lo tenga esperando.
const CONFIRM_DEBOUNCE_MS = Number(process.env.WHATSAPP_BOT_CONFIRM_DEBOUNCE_MS) || 12000;

// Cuando lo único que llegó es un saludo suelto ("hola", "buenas tardes"), la
// espera se amplía UNA vez por este tiempo extra. Un saludo no aporta ningún
// dato y casi siempre viene seguido del mensaje real unos segundos después:
// procesarlo por su cuenta gasta un turno de LLM que termina descartándose y
// retrasa la respuesta de verdad.
const GREETING_EXTRA_WAIT_MS = Number(process.env.WHATSAPP_BOT_GREETING_EXTRA_WAIT_MS) || 8000;

const GREETING_ONLY_RE = /^(?:hola+|ola+|buenas|buenos d[ií]as|buenas tardes|buenas noches|buen d[ií]a|hi|hey|saludos|qu[eé] tal|holi+)(?:\s+(?:hola+|buenas|d[ií]as|tardes|noches|amigo|se[ñn]or(?:ita)?|buen d[ií]a))*[\s!¡.,?¿]*$/i;

// Saludo de APERTURA al principio de una respuesta del bot: la palabra de
// saludo, opcionalmente el nombre del contacto, y su punto de cierre. Exigir
// ese punto (o el signo de admiración) es lo que evita que se coma frases que
// solo empiezan parecido ("Buenas noticias: hay agenda hoy").
const OPENING_GREETING_RE = /^\s*¡?\s*(?:hola+|buenas(?:\s+(?:tardes|noches))?|buenos\s+d[ií]as|buen\s+d[ií]a|qu[eé]\s+tal)(?:\s*,?\s*\p{L}+)?\s*[.!]+\s*/iu;

/**
 * Quita el saludo de apertura de una respuesta que NO es la primera de la
 * conversación. El prompt trae los ejemplos del primer mensaje escritos
 * literalmente ("Hola, Jair. ¿Ya tienes un tema en mente para tu tesis?") y el
 * modelo los copiaba tal cual en un turno posterior: el contacto recibía dos
 * aperturas seguidas, como si nadie hubiera leído la conversación. Si el
 * mensaje era SOLO el saludo se devuelve intacto, para no dejarlo vacío.
 */
function stripOpeningGreeting(reply) {
  const text = String(reply || '');
  const stripped = text.replace(OPENING_GREETING_RE, '').trimStart();
  if (!stripped || stripped === text) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** ¿El texto acumulado es solo un saludo, sin ningún contenido? */
function isGreetingOnly(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 0 && clean.length <= 40 && GREETING_ONLY_RE.test(clean);
}

// F4 — Bug real detectado en producción: una plantilla o el propio LLM
// interpolando un `location`/`field` ya extraído (que a veces empieza con
// "en...") después de la preposición fija "en" del texto produce artefactos
// como "...en En minería". Se colapsa esa preposición duplicada antes de
// mandar cualquier texto que combine estos campos.
function collapseDuplicatePreposition(text) {
  return String(text || '').replace(/\ben\s+en\b/gi, 'en').replace(/\s{2,}/g, ' ').trim();
}

// Seguimiento por inactividad: si el contacto deja a Avan "en visto" 1 hora,
// se le manda un recordatorio; si sigue una hora más sin responder, el lead
// se mueve a "Congelado" en el Setter Funnel y el bot deja de insistir.
// Silencio mínimo tras un mensaje del CONTACTO que quedó sin respuesta para
// considerarlo un turno perdido del bot y reintentarlo. Es mucho más corto
// que el recordatorio de inactividad (una hora) porque esto no es un lead que
// se tomó su tiempo: es una respuesta que se cayó, y cada minuto que pasa la
// hace más rara de recibir. El piso son cinco minutos para no pisar un turno
// que TODAVÍA se está procesando (el LLM más lento no llega ni a un minuto).
const MISSED_REPLY_RECOVERY_MS = 5 * 60 * 1000;

// Más allá de esto no se reintenta nada: WhatsApp no deja que el negocio
// escriba fuera de la ventana de 24 h desde el último mensaje del contacto
// sin una plantilla aprobada, así que el envío fallaría igual. Lo que quede
// más viejo es trabajo para una persona, no para un reintento automático.
const MISSED_REPLY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Un wa_id de WhatsApp real es solo dígitos (con o sin "+"). El simulador del
 * panel usa ids sintéticos ("sim-jc-...", "test-flow-..."), que sí quedan
 * guardados en la tabla de mensajes porque el motor conversacional necesita
 * el hilo — pero reintentarles un turno perdido no tiene ningún destinatario
 * del otro lado: el envío falla contra la API y el lead recuperado no existe.
 */
function isRealWaId(waId) {
  return /^\+?\d{7,20}$/.test(String(waId || '').trim());
}

const INACTIVITY_NUDGE_MS = 60 * 60 * 1000;
const INACTIVITY_FREEZE_MS = 60 * 60 * 1000;

// Los recordatorios salen en este orden, uno por cada intento. Hoy es uno
// solo: por decisión del equipo el bot insiste una vez y ya. Insistir dos
// veces recuperaba algún lead más, pero también es lo que hace que a un bot lo
// bloqueen. El texto no le reclama nada al contacto ("seguimos esperando tu
// respuesta" ponía la deuda de su lado).
//
// Si algún día vuelven a ser dos, basta con añadir el texto del segundo aquí:
// MAX_INACTIVITY_NUDGES sale del largo de esta lista, y el mensaje debe ser
// DISTINTO del primero — repetir el mismo palabra por palabra es justo lo que
// delata a un bot.
const INACTIVITY_NUDGE_TEXTS = [
  '¿Sigues por ahí? Cuando tengas un momento me cuentas 👀'
];

// Tras este número de recordatorios en la MISMA conversación el bot deja de
// insistir y el lead pasa a "Congelado" para que lo retome una persona. El
// contador (`nudge_count`) no se reinicia cuando el contacto responde, así
// que el tope vale para toda la conversación y no por racha de silencio.
const MAX_INACTIVITY_NUDGES = INACTIVITY_NUDGE_TEXTS.length;

// Franja de SILENCIO del recordatorio de inactividad (hora de Lima, [desde,
// hasta)): entre la 1 y las 5 de la madrugada el bot no manda nada, lo aplaza
// para cuando termine. El plazo para congelar corre desde que el recordatorio
// se manda de verdad (nudge_sent_at), así que también se aplaza — un lead que
// escribió de madrugada no se congela sin haber tenido chance de responder.
//
// La franja la fijó el equipo. Es estrecha a propósito: fuera de ella el bot
// puede escribir, incluso a medianoche. Si algún día aparecen quejas por la
// hora, estos dos números son lo único que hay que mover.
const NUDGE_QUIET_START_HOUR = 1;
const NUDGE_QUIET_END_HOUR = 5;

/**
 * ¿Esa hora de Lima cae dentro de la franja de silencio?
 *
 * La ventana puede cruzar la medianoche (21→8) o no (1→5), y la comparación
 * correcta es distinta en cada caso: con la fórmula de una sola forma
 * (`hora < fin || hora >= inicio`), una franja 1→5 da "siempre en silencio" y
 * el bot dejaría de mandar seguimientos para siempre. Por eso se distinguen
 * los dos casos en vez de escribir la comparación a mano en cada sitio.
 */
export function isWithinQuietHours(hour, start = NUDGE_QUIET_START_HOUR, end = NUDGE_QUIET_END_HOUR) {
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

// Estado de una sesión congelada por inactividad. Antes se marcaba como
// "completed" y el bot ya no le respondía a quien volvía a escribir más
// tarde (caso real: "Buen día, de dónde son?" quedó sin respuesta). Se
// distingue de "completed" para poder reactivarla en el siguiente mensaje.
const FROZEN_STATUS = 'frozen';

// Recordatorio previo a la reunión: se manda cuando faltan menos de estos 45
// minutos. Antes salía con 2 horas de anticipación, demasiado lejos de la hora
// real: a 45 minutos el lead todavía está a tiempo de acomodarse y el aviso le
// llega cuando la reunión ya es lo siguiente en su día. `MIN_AGE` deja fuera
// las reuniones recién agendadas, para que el recordatorio no salga a los
// minutos de confirmarlas; con la anticipación mínima de reserva
// (`MIN_BOOKING_LEAD_MINUTES`, 1 hora por defecto) ninguna cita entra en esta
// ventana apenas se confirma, así que basta un margen corto — del tamaño del
// barrido — para cubrir el caso de que esa anticipación se baje por variable
// de entorno.
const MEETING_REMINDER_LEAD_MS = 45 * 60 * 1000;
const MEETING_REMINDER_MIN_AGE_MS = 10 * 60 * 1000;

// Agenda diaria al vendedor: sale a partir de las 8 de la mañana (hora de
// Lima). El barrido que la dispara corre cada diez minutos, así que llega
// entre las 8:00 y las 8:10. La hora de corte evita que un servidor que
// estuvo caído toda la mañana mande la agenda del día a media tarde, cuando
// ya no le sirve a nadie: si no salió antes de esa hora, se da por perdida.
const DAILY_AGENDA_HOUR = 8;
const DAILY_AGENDA_CUTOFF_HOUR = 12;

const SHORT_DAY_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', weekday: 'long', day: 'numeric'
});

/**
 * Etiqueta corta de día para las frases del bot, ej. "viernes 28" (o "hoy" si
 * es hoy). `dateStr` es "YYYY-MM-DD" en calendario de Lima; se ancla al
 * mediodía UTC para que ninguna conversión de zona horaria lo empuje al día
 * anterior.
 */
function formatShortDayLabel(dateStr) {
  if (dateStr === limaTodayIso()) return 'hoy';
  const [y, m, d] = dateStr.split('-').map(Number);
  return SHORT_DAY_FORMATTER.format(new Date(Date.UTC(y, m - 1, d, 12))).replace(',', '');
}

/**
 * El mismo día pero listo para ir detrás de una preposición: "hoy" no lleva
 * artículo ("para hoy"), los demás sí ("para el domingo 6"). Sin esto salía
 * "Horarios para el hoy".
 */
function dayLabelWithArticle(dateStr) {
  const label = formatShortDayLabel(dateStr);
  return label === 'hoy' ? label : `el ${label}`;
}

function limaTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** ¿El texto que escribió el lead parece un número de teléfono usable? (7-15 dígitos) */
function looksLikePhone(value) {
  const d = digitsOnly(value);
  return d.length >= 7 && d.length <= 15;
}

/**
 * ¿El wa_id ES un número de teléfono real (no un BSUID tipo "PE.15518885...")?
 * Los BSUID de Instagram/Facebook traen 15 dígitos pero también un prefijo de
 * letras y un punto, así que se exige que el wa_id sea solo dígitos, con el
 * "+" inicial que algunos proveedores (YCloud) mandan en formato E.164. Sin
 * admitir ese "+" el bot daba por desconocido el número desde el que escribe
 * el contacto y llegaba a confirmar una llamada sin ningún teléfono.
 */
function waIdIsPhone(waId) {
  return /^\+?\d{8,15}$/.test(String(waId || ''));
}

/**
 * El número en formato internacional, para que el asesor pueda marcarlo tal
 * cual. Un celular peruano de 9 dígitos ("974412758") se completa con el 51:
 * el contacto lo escribe así aunque se le pida con código de país.
 */
function formatPhoneForAdvisor(value) {
  const digits = digitsOnly(value);
  // E.164 admite 15 dígitos como máximo: más que eso no es un teléfono (un
  // BSUID de Instagram, por ejemplo) y no se debe mostrar como si lo fuera.
  if (digits.length < 8 || digits.length > 15) return null;
  const withCountry = digits.length === 9 && digits.startsWith('9') ? `51${digits}` : digits;
  return `+${withCountry}`;
}

/**
 * "a este número", "al mismo", "por aquí": el contacto está diciendo que lo
 * llamen al número desde el que escribe. Antes esto no era un teléfono válido
 * y el paso se daba por no contestado.
 */
const THIS_NUMBER_RE = /\b(?:a|al)?\s*(?:est\w{0,2}|ese|el)\s*(?:mismo\s*)?(?:numero|celular|cel|telefono|whats(?:app)?)\b|\b[ae]l\s*mismo\b|\bpor\s*(?:aqui|aca)\b|\bdesde\s*(?:donde|el\s*que)\s*escribo\b/i;

function wantsThisNumber(text) {
  return THIS_NUMBER_RE.test(normalize(String(text || '').trim()));
}

// Direcciones de correo dentro de un texto libre. Se excluyen explícitamente
// los caracteres que suelen venir pegados en un mensaje de WhatsApp
// ("(", ",", ";", comillas...) para no arrastrarlos dentro de la dirección.
const EMAIL_RE = /[^\s<>()[\],;:"']+@[^\s<>()[\],;:"']+\.[a-z]{2,}/i;

/**
 * Extrae la dirección de correo de un texto libre, o null si no hay ninguna.
 *
 * Es importante que sea una EXTRACCIÓN y no un simple test: el contacto casi
 * nunca manda el correo solo ("mi correo es kevin@gmail.com pero quiero saber
 * cuánto dura la reunión"). Guardar el mensaje entero como correo hacía que
 * Google Calendar rechazara el invitado y la reunión no llegara a crearse.
 */
function extractEmail(value) {
  const match = String(value || '').match(EMAIL_RE);
  return match ? match[0].replace(/[.,;:]+$/, '').toLowerCase() : null;
}

/**
 * Los leads que llegan de un anuncio de Meta con formulario ("Click to
 * WhatsApp" + preguntas propias) abren la conversación con un mensaje
 * armado por Meta, no escrito por la persona: varias líneas "¿Pregunta?:
 * Respuesta" (nivel académico, universidad, nombre, teléfono...) en vez de
 * una frase natural. El LLM de conversación, ocupado en redactar el saludo
 * de apertura, a veces no extrae estos datos aunque estén ahí explícitos —
 * visto en producción con leads reales cuya universidad y nivel quedaban
 * sin guardar. Se parsean acá, determinísticamente, línea por línea, como
 * red de seguridad: sea cual sea lo que devuelva el LLM, si el patrón
 * matchea, estos datos SIEMPRE quedan guardados.
 */
function parseFormAnswerLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.match(/^[^\S\n]*[¿"'“]*\s*(.+?)\s*[?"'”]*\s*:\s*(.+)$/))
    .filter(Boolean)
    .map((match) => ({ label: match[1].trim(), value: match[2].trim() }))
    .filter((pair) => pair.label && pair.value);
}

/** "Título profesional" / "Maestría" / etc. -> uno de los tres niveles canónicos, o null. */
function mapAcademicLevel(value) {
  const v = normalize(String(value || ''));
  if (/doctorado/.test(v)) return 'Posgrado (Doctorado)';
  if (/maestria|magister|master/.test(v)) return 'Posgrado (Maestría)';
  if (/bachiller|titulo|pregrado|licenciatura/.test(v)) return 'Pregrado (Bachiller/Título)';
  return null;
}

// Palabras clave por campo, no el texto exacto de la pregunta: el equipo de
// Ads cambia la redacción de las preguntas del formulario sin avisar al
// código.
const FORM_LEVEL_LABEL_RE = /sacando|nivel\s+acad[eé]mico|grado\s+acad[eé]mico/i;
const FORM_UNIVERSITY_LABEL_RE = /universidad/i;
const FORM_FIELD_LABEL_RE = /carrera/i;
// El formulario trae el nombre REAL ("Full name: Luis B. Palomino Rodriguez"),
// que casi siempre es mejor que el del perfil de WhatsApp. Los perfiles reales
// del 23/09 eran "La Vida Continua...." y "😎": de ninguno sale un nombre de
// pila utilizable, así que los dos leads recibieron un "¡Hola!" pelado
// teniendo el nombre escrito dos líneas más abajo. Va anclado (^...$) a
// propósito, al revés que los demás: sin anclar, "nombre" aparece dentro de
// otras preguntas del formulario ("¿A nombre de quién va la factura?").
const FORM_NAME_LABEL_RE = /^(?:full\s*name|name|nombres?(?:\s+(?:completos?|y\s+apellidos?))?|apellidos?\s+y\s+nombres?)$/i;
// "¿En qué punto estás (con tu tesis)?" / "¿En qué etapa de tu tesis estás?"
// — pregunta de avance del formulario.
const FORM_PROGRESS_LABEL_RE = /en\s+qu[eé]\s+punto|en\s+qu[eé]\s+etapa|etapa\s+(?:de\s+)?(?:tu\s+)?tesis|qu[eé]\s+tan\s+avanzado|avance\s+(?:de\s+)?(?:tu\s+)?tesis|estado\s+de\s+(?:tu\s+)?tesis/i;
// "¿Qué necesitas resolver?" — el servicio que el lead viene buscando.
const FORM_NEED_LABEL_RE = /qu[eé]\s+necesitas|necesitas\s+resolver|qu[eé]\s+servicio|en\s+qu[eé]\s+te\s+(?:podemos\s+)?ayudamos?/i;
// "¿Para cuándo necesitas avanzar?" — con cuánta prisa viene.
const FORM_URGENCY_LABEL_RE = /para\s+cu[aá]ndo|cu[aá]ndo\s+necesitas|qu[eé]\s+urgencia|para\s+qu[eé]\s+fecha/i;
// Mismas frases que el prompt del LLM ya trata como "no tiene tema, empieza
// de cero" cuando la persona las escribe directamente en el chat (ver
// ollamaService.js): si el formulario la responde así de entrada, es la
// misma señal y evita la pregunta redundante "¿ya tienes un tema en mente?"
// seguida, turnos después, de la misma respuesta escrita a mano.
// "Aún no tengo tema" es una de las opciones del formulario actual y decía
// exactamente lo mismo que las de abajo, pero no matcheaba: el lead que la
// elegía quedaba sin `problem`, igual que el que ya tenía la tesis terminada.
const FORM_NO_PROGRESS_VALUE_RE = /todav[ií]a\s*no\s*empiez\w*|a[uú]n\s*no\s*empiez\w*|no\s*he\s*empezado|sin\s*empezar|desde\s*cero|sin\s*avance|no\s*tengo\s*avance|no\s*tengo\s*tema|sin\s*tema/i;

/**
 * Etapa de la tesis declarada en el formulario -> valor canónico. Es lo que
 * decide con qué se le ofrece ayudar al lead al proponerle la reunión: no es
 * lo mismo alguien que no tiene tema que alguien con la tesis casi terminada,
 * y hasta ahora a los dos se les decía "para ayudarte a definir tu tema".
 */
function mapThesisStage(value) {
  const v = normalize(String(value || ''));
  if (FORM_NO_PROGRESS_VALUE_RE.test(v)) return 'sin_tema';
  if (/casi\s*termin|terminad|sustenta|por\s*termin|finaliz/.test(v)) return 'final';
  if (/cap[ií]tul/.test(v)) return 'capitulos';
  if (/proyecto|plan\s*de\s*tesis|anteproyecto/.test(v)) return 'proyecto';
  return null;
}

/**
 * "¿Para cuándo necesitas avanzar?" -> valor canónico, o null. Era el tercer
 * campo del formulario que se preguntaba y se tiraba: el lead declara que
 * tiene prisa y el bot le hablaba exactamente igual que al que está mirando
 * opciones para el año que viene.
 */
function mapLeadUrgency(value) {
  const v = normalize(String(value || ''));
  if (/lo\s*antes\s*posible|cuanto\s*antes|urgente|de\s*inmediato|ya\s*mismo|esta\s*semana/.test(v)) return 'asap';
  if (/este\s*mes|proximas?\s*semanas?|en\s*(dos|tres|\d+)\s*semanas?/.test(v)) return 'pronto';
  if (/explorando|solo\s*estoy|cotizando|sin\s*apuro|no\s*tengo\s*apuro|mas\s*adelante|proximo\s*(ciclo|semestre|ano)/.test(v)) return 'explorando';
  if (/\d\s*(a|-)?\s*\d*\s*meses|en\s*unos\s*meses/.test(v)) return 'meses';
  return null;
}

/**
 * Cómo arranca la propuesta de reunión según la prisa que declaró el lead.
 * No cambia lo que se le ofrece (la agenda es la que es), pero sí reconoce lo
 * que acaba de decir, que es justo lo que no pasaba.
 */
export function urgencyOpener(urgency) {
  switch (urgency) {
    case 'asap': return 'Coordinemos cuanto antes';
    case 'explorando': return 'Coordinemos, sin compromiso,';
    default: return 'Coordinemos';
  }
}

/** "¿Qué necesitas resolver?" -> valor canónico, o null si no se reconoce. */
function mapLeadNeed(value) {
  const v = normalize(String(value || ''));
  if (/correccion|observacion|levantamiento/.test(v)) return 'correcciones';
  if (/acompanamiento\s*completo|completo|de\s*principio\s*a\s*fin/.test(v)) return 'acompanamiento';
  if (/por\s*etapas|asesoria\s*por\s*etapas/.test(v)) return 'por_etapas';
  return null;
}

// Cómo se escriben esos valores canónicos en la ficha del lead, para que el
// asesor llegue a la reunión sabiendo lo mismo que el bot.
const STAGE_LABELS = {
  sin_tema: 'Sin tema definido',
  proyecto: 'Proyecto / plan de tesis',
  capitulos: 'Capítulos en desarrollo',
  final: 'Tesis casi terminada'
};
const NEED_LABELS = {
  correcciones: 'Correcciones / levantamiento de observaciones',
  acompanamiento: 'Acompañamiento completo',
  por_etapas: 'Asesoría por etapas'
};
const URGENCY_LABELS = {
  asap: 'Lo antes posible',
  pronto: 'Este mes',
  meses: 'En los próximos meses',
  explorando: 'Todavía explorando'
};

/**
 * Con qué se le ofrece ayudar en la reunión, según lo que el lead YA declaró
 * en el formulario. El levantamiento de observaciones manda sobre la etapa:
 * es lo más concreto que puede pedir alguien, y lo pide igual con la tesis a
 * medias que casi terminada.
 */
export function schedulingPurpose({ stage = null, need = null, hasTopic = false } = {}) {
  if (need === 'correcciones') return 'ayudarte con el levantamiento de observaciones';
  switch (stage) {
    case 'sin_tema': return 'ayudarte a definir tu tema';
    case 'proyecto': return 'revisar tu proyecto de tesis';
    case 'capitulos': return 'revisar el avance de tus capítulos';
    case 'final': return 'ayudarte a cerrar tu tesis';
    default: return hasTopic ? 'revisar tu tema' : 'ayudarte a definir tu tema';
  }
}
// El formulario de Click-to-WhatsApp de Meta agrega el teléfono que la
// persona ya tiene registrado en Facebook/Instagram ("Phone number: +51...").
// Si no se guarda, el bot se lo vuelve a pedir en el paso de agendar aunque
// ya lo tenga delante — el lead nota la pregunta redundante y se frustra.
const FORM_PHONE_LABEL_RE = /phone|tel[eé]fono|celular/i;

export function extractLeadFormFields(text) {
  const fields = {};
  for (const { label, value } of parseFormAnswerLines(text)) {
    if (!fields.fullName && FORM_NAME_LABEL_RE.test(label)) {
      // Solo se acepta si de ahí sale un nombre de pila saludable: el campo
      // es de texto libre y llega con cualquier cosa ("...", "xd", un correo).
      if (firstNameOf(value)) fields.fullName = value;
    } else if (!fields.level && FORM_LEVEL_LABEL_RE.test(label)) {
      const level = mapAcademicLevel(value);
      if (level) fields.level = level;
    } else if (!fields.university && FORM_UNIVERSITY_LABEL_RE.test(label)) {
      fields.university = value;
    } else if (!fields.field && FORM_FIELD_LABEL_RE.test(label)) {
      fields.field = value;
    } else if (!fields.stage && FORM_PROGRESS_LABEL_RE.test(label)) {
      const stage = mapThesisStage(value);
      if (stage) fields.stage = stage;
      if (!fields.problem && stage === 'sin_tema') fields.problem = 'Sin tema definido (desde cero)';
    } else if (!fields.need && FORM_NEED_LABEL_RE.test(label)) {
      const need = mapLeadNeed(value);
      if (need) fields.need = need;
    } else if (!fields.urgency && FORM_URGENCY_LABEL_RE.test(label)) {
      const urgency = mapLeadUrgency(value);
      if (urgency) fields.urgency = urgency;
    } else if (!fields.phone && FORM_PHONE_LABEL_RE.test(label) && looksLikePhone(value)) {
      fields.phone = digitsOnly(value);
    }
  }
  return fields;
}

/**
 * ¿Este texto es el resumen automático de un formulario de un anuncio de Meta
 * Ads ("¿Pregunta?: Respuesta" línea a línea), y no un mensaje escrito a mano
 * por el contacto? Misma condición que usa runConversationTurn() para saltar
 * la pregunta de apertura; se expone aparte para que el panel (bandeja de
 * WhatsApp) pueda etiquetar la conversación sin duplicar la regla.
 */
export function isAdFormMessage(text) {
  const fields = extractLeadFormFields(text);
  return !!(fields.level || fields.university || fields.field || fields.problem || fields.stage || fields.need);
}

/**
 * Cierre de los menús de horarios.
 *
 * Antes decía siempre lo mismo: «Responde con el número que prefieras, o "no"
 * si prefieres que te contacten después». Al lead al que ninguno de los tres
 * horarios le servía, la única salida que se le nombraba era la que apaga el
 * bot y despierta a una persona — y la tomaba. Caso real: un lead escribió a
 * las 22:15, vio tres horarios de la mañana siguiente, respondió "No" y se
 * transfirió a un asesor a las 22:22. El flujo SÍ sabe atender "mejor a las
 * 6" o "el jueves" (lo resuelven _answerDayRequestWhileChoosing y el paso de
 * horario), pero eso no se le decía en ningún momento.
 *
 * Lo que se ofrece se ajusta a lo que de verdad hay: solo se le invita a
 * pedir OTRO DÍA si existe otro día con agenda. Si no, se le invita a pedir
 * otra hora, que es lo que sí se le puede cumplir.
 */
export function slotMenuFooter(slots = [], availableDays = []) {
  const shownDays = new Set((slots || []).map((slot) => slot.date).filter(Boolean));
  const hasOtherDay = shownDays.size > 1 || (availableDays || []).some((day) => !shownDays.has(day));
  const alternative = hasOtherDay
    ? 'dime qué día y hora te vienen mejor'
    : 'dime a qué hora te viene mejor y la busco';
  return `Responde con el número que prefieras. Si ninguno te acomoda, ${alternative}, o "no" si prefieres que te contacten después.`;
}

/** Interpreta la elección de modalidad de llamada: 'phone' | 'meet' | null. */
// El lead pide llamada telefónica en vez de Google Meet (texto ya normalizado).
// El sustantivo SOLO también cuenta ("Telefono", "Celular"): pedir la llamada
// así es lo más natural del mundo cuando la pregunta en pantalla es "¿por Meet
// o por teléfono?", y exigir "por telefono" o "telefonica" dejaba fuera
// justamente esa respuesta. Caso real: un lead contestó "Telefono" al menú de
// horarios, el mensaje no matcheó, se trató como una duda cualquiera (se le
// contestó "puede ser telefónica o por Meet" y se le repitió la lista), eligió
// un horario y se le confirmó una reunión por Google Meet con el descuento de
// Meet. Tuvo que reclamar ("Pedí por teléfono") y terminó transferido.
const PHONE_MODE_RE = /\b(telefono|telefonica(mente)?|telefonico|llamad[ao]s?|llamenme|llamame|me llamen|me pueden llamar|celular)\b/;

// ...salvo que en el mismo mensaje nombre el Meet. "No puedo por llamada,
// mejor meet" tiene las dos modalidades y la que vale es la que eligió, no la
// que descartó — sin esto, ampliar la expresión de arriba lo pasaría a
// telefónica por haber escrito la palabra "llamada".
const MEET_MODE_RE = /\b(meet|videollamada|video llamada|videoconferencia|virtual|zoom)\b/;

/**
 * ¿El contacto está pidiendo que la reunión sea por llamada telefónica (en vez
 * de por Google Meet, que es la modalidad por defecto)?
 */
export function asksForPhoneCall(text) {
  const n = normalize(text || '');
  return PHONE_MODE_RE.test(n) && !MEET_MODE_RE.test(n);
}

// ¿Queda algo parecido a un día o a una hora en el mensaje? Sirve para no
// mandar a interpretar como fecha un "telefono" pelado (texto normalizado).
// Los números de más de dos cifras no cuentan: en un "llámenme al 999888777"
// el número es el teléfono, no la hora.
const WHEN_HINT_RE = /(?<!\d)\d{1,2}(?!\d)|\b(hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|temprano|mediodia|madrugada)\b/;

function parseCallMode(text) {
  const n = normalize(text || '');
  const isRefusal = ['no', 'ninguna', 'ninguno'].includes(n.trim());
  if (isRefusal) return null;
  if (/(^|\D)1(\D|$)/.test(n) || n.includes('telefon') || n.includes('llamada telef') || n.includes('celular') || n.includes('numero')) return 'phone';
  if (/(^|\D)2(\D|$)/.test(n) || n.includes('meet') || n.includes('video') || n.includes('virtual') || n.includes('descuento') || n.includes('zoom')) return 'meet';
  return null;
}

const MEETING_DATETIME_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true
});

const LIMA_LONG_DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long'
});

const LIMA_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

/** Hora de Lima ("HH:MM", 24h) de un instante ISO. */
function limaTimeOf(isoStr) {
  return LIMA_TIME_FORMATTER.format(new Date(isoStr));
}

/** Minutos desde medianoche de un "HH:MM" (null si no es una hora). */
function clockMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

// Margen para las horas que NO dijo el contacto sino que dedujo el parser de
// un "en la tarde" (~15:00): ahí no se busca el bloque idéntico, basta con
// que el día tenga algo alrededor.
const VAGUE_TIME_TOLERANCE_MINUTES = 90;

/**
 * Días (de los bloques libres que se le pasen) en los que la hora que pidió
 * el contacto está disponible.
 *
 * Responder solo con una hora ("3:30") cuando se le acaban de nombrar los
 * días es lo normal si esa hora es una de las que se le dijeron: para él el
 * día va implícito. Antes eso caía en "No identifiqué el día", que le pedía
 * repetir algo que acababa de decir. Con los bloques en la mano el día sale
 * del calendario: el que llame primero se queda con la hora (van ordenados),
 * que es justo lo que espera quien responde "3:30" a un "hoy de 3:30 a 6".
 */
export function daysMatchingPreferredTime(slots, preferredTime, precision = 'exact') {
  const target = clockMinutes(preferredTime);
  if (target === null) return [];
  const tolerance = precision === 'exact' ? 0 : VAGUE_TIME_TOLERANCE_MINUTES;
  const days = [];
  for (const slot of slots || []) {
    const minutes = clockMinutes(limaTimeOf(slot.startTime));
    if (minutes === null || Math.abs(minutes - target) > tolerance) continue;
    if (!days.includes(slot.date)) days.push(slot.date);
  }
  return days.sort();
}

/** "18:00" -> "6:00 p.m.", para nombrarle al lead la hora que él pidió. */
function formatClockLabel(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const period = h < 12 ? 'a.m.' : 'p.m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * "YYYY-MM-DD" de un valor que puede venir como Date (lo que devuelve MySQL
 * para una columna DATE) o como cadena. Se usa para comparar el día del último
 * envío de la agenda con el de hoy.
 *
 * mysql2 arma ese Date con `new Date(year, month - 1, day)` (hora local del
 * proceso, no UTC), así que para recuperar el mismo year/month/day hay que
 * leerlo con los getters LOCALES (getFullYear/getMonth/getDate). Formatearlo
 * antes con Intl usando timeZone: 'America/Lima' lo reinterpretaba pasando
 * por UTC: si el proceso corre en una zona horaria distinta a Lima, el día
 * se corría uno hacia atrás y la comparación con "hoy" nunca coincidía — la
 * agenda se reintentaba sin parar en cada barrido de diez minutos.
 */
function dayOnlyIso(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * El mensaje de la agenda diaria, tal como lo recibe el vendedor por WhatsApp.
 * Cada línea trae lo que necesita para presentarse a la cita sin abrir el
 * panel: la hora, con quién, y por dónde (link de Meet o número al que llamar).
 */
function buildDailyAgendaMessage(dateIso, meetings) {
  const [y, m, d] = String(dateIso).split('-').map(Number);
  const fecha = LIMA_LONG_DATE_FORMATTER.format(new Date(Date.UTC(y, m - 1, d, 12)));
  const encabezado = `📅 *Agenda de hoy* — ${fecha}`;

  if (meetings.length === 0) {
    return `${encabezado}\n\nNo hay reuniones agendadas para hoy. ¡Buen día! 🙌`;
  }

  const lineas = meetings.map((meeting, i) => {
    const hora = formatClockLabel(limaTimeOf(meeting.start_time));
    const quien = meeting.lead_full_name?.trim() || meeting.wa_id;
    const tema = (meeting.topic || meeting.lead_topic || '').trim();
    // Sin link de Meet es una llamada telefónica: el vendedor necesita el
    // número a la vista, no tener que ir a buscarlo al panel.
    const canal = meeting.meet_link
      ? `💻 ${sanitizeMeetLink(meeting.meet_link)}`
      : `📞 ${meeting.lead_phone?.trim() || meeting.wa_id}`;
    return `*${i + 1}. ${hora}* — ${quien}\n   ${canal}` + (tema ? `\n   📄 ${tema}` : '');
  });

  const total = `${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`;
  return `${encabezado}\n_${total}_\n\n${lineas.join('\n\n')}`;
}

function formatMeetingDateTimeLabel(isoStr) {
  const label = MEETING_DATETIME_FORMATTER.format(new Date(isoStr)).replace(/\./g, '').replace(/\s([ap])\s?m\b/, ' $1.m.');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Placeholder que usa findOrCreateFromWhatsApp() cuando WhatsApp no compartió
// un nombre de perfil real — no debe tratarse como el nombre del contacto.
const GENERIC_CONTACT_NAME = 'Contacto de WhatsApp';

/**
 * Cierra una frase con punto sin duplicar el que ya trae "p.m." al final: las
 * franjas horarias terminan en "6:30 p.m." y quedaba "6:30 p.m.." en pantalla.
 */
function endSentence(text) {
  const trimmed = String(text || '').trimEnd();
  if (!trimmed) return '';
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

/** "en 2 horas" / "en 45 minutos", para el recordatorio previo a la reunión. */
function formatTimeUntil(startTime) {
  const minutes = Math.round((new Date(startTime).getTime() - Date.now()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return '';
  if (minutes < 60) return `en ${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'en 1 hora' : `en ${hours} horas`;
}

/**
 * ¿`token` parece un nombre de pila real y no un usuario/apodo/correo?
 * Los nombres de perfil de WhatsApp muchas veces son handles
 * ("jquintanillaphocco", "Julinho_Cal🤗", "emiliorcabogado@gmail.con"):
 * saludar con eso ("¡Hola, jquintanillaphocco!") se lee peor que un "¡Hola!".
 * Pide: solo letras (con tildes/ñ, guion o apóstrofo internos), 2 a 14
 * caracteres, con alguna vocal y sin mezclas tipo "camelCase".
 */
/**
 * Palabras que encabezan un "nombre" de perfil sin ser un nombre de pila.
 * Caso real: el perfil se llamaba "La Vida Continua" y el bot abrió con
 * "¡Hola, La!". Un saludo sin nombre se lee bien; uno con la palabra
 * equivocada delata que nadie está leyendo del otro lado.
 */
const NOT_A_FIRST_NAME = new Set([
  'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'tu', 'su',
  'de', 'del', 'con', 'por', 'para', 'don', 'dona', 'sr', 'sra', 'srta',
  'ing', 'lic', 'dr', 'dra', 'prof', 'yo', 'soy', 'hola', 'buenas',
  'usuario', 'cliente', 'contacto', 'grupo', 'team', 'the'
]);

function looksLikeRealFirstName(token) {
  const t = String(token || '').trim();
  // Mínimo 3 letras: en español un nombre de pila de dos no existe en la
  // práctica, y ese umbral es lo que dejaba pasar artículos como "La".
  if (t.length < 3 || t.length > 14) return false;
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(t)) return false;   // dígitos, @, _, ., espacios, emojis → fuera
  if (/\p{Ll}\p{Lu}/u.test(t)) return false;             // "JulinhoCal", "McLovin"
  if (!/[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/.test(t)) return false;  // sin vocales no es un nombre
  if (NOT_A_FIRST_NAME.has(normalize(t))) return false;
  return true;
}

/**
 * ¿Ese valor es basura y no un dato? Se usa antes de guardar —y sobre todo
 * antes de repetirle al contacto— la carrera o la universidad que se extrajo.
 *
 * Casos reales: "Perfecto: Yy", "¡Hola, La!". Repetir una respuesta sin
 * sentido como si se hubiera entendido es peor que no mencionarla: el
 * contacto ve que el bot no está leyendo.
 */
export function looksLikeGarbageValue(text) {
  const t = normalize(String(text || '').trim());
  if (!t) return true;
  if (t.length < 3) return true;                     // "Yy", "xd", "aa"
  if (!/[aeiou]/.test(t)) return true;               // sin vocales
  if (/^(.)\1*$/.test(t.replace(/\s/g, ''))) return true;  // "aaa", "yyyy"
  if (!/[a-z]/.test(t)) return true;                 // solo números/símbolos
  return false;
}

/**
 * "ROMINA" -> "Romina", "milciades" -> "Milciades". Los formularios de Meta
 * llegan como los escribió el lead, y devolverle su nombre en mayúsculas
 * ("¡Hola, ROMINA!", caso real del 25/09) se lee como un correo masivo.
 */
function capitalizeName(name) {
  return String(name).replace(/\p{L}+/gu, (word) => word[0].toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es'));
}

export function firstNameOf(fullName) {
  if (!fullName || fullName === GENERIC_CONTACT_NAME) return null;
  const first = fullName.trim().split(/\s+/)[0] || '';
  return looksLikeRealFirstName(first) ? capitalizeName(first) : null;
}

/**
 * Con qué nombre saludar a un lead que llegó del formulario de un anuncio, y
 * si ese nombre debe reemplazar al que quedó en la ficha.
 *
 * El del formulario gana: lo escribió el propio estudiante. El de la ficha
 * viene del perfil de WhatsApp, o sea de cómo se llama el TELÉFONO, que
 * muchas veces no es suyo — el 25/09 el bot saludó "¡Hola, Areli!" a un
 * formulario a nombre de Milciades, y "¡Hola, Fabricio!" a uno de Paulo
 * César. Solo se le hace caso si de ahí sale un nombre de pila creíble
 * (`firstNameOf`): un "Full name" con basura no pisa nada.
 */
export function resolveFormLeadName(formName, contactName) {
  const formFirstName = firstNameOf(formName);
  return {
    greetName: formFirstName || contactName || null,
    // Un panel que dice "Areli" mientras el bot saluda "Milciades" deja al
    // asesor sin saber con quién está hablando.
    storeFormName: !!formName && (!contactName || (!!formFirstName && formFirstName !== contactName))
  };
}

/**
 * Título del evento de Google Calendar de una reunión agendada por el bot.
 *
 * Antes era "Asesoría de tesis - {tema}", y como el tema de la mayoría de los
 * leads es el mismo texto genérico ("Tema de tesis por definir: Caso de
 * estudio y propuesta en Perú"), el calendario del closer mostraba varias
 * reuniones seguidas con el título IDÉNTICO: no había forma de saber con quién
 * era cada una sin abrirlas una por una.
 *
 * Por eso el identificador del lead va PRIMERO: en la vista de día y en la de
 * agenda Google corta el título, y lo que tiene que sobrevivir al corte es con
 * quién es la reunión. El tema pasa a la descripción, a un clic de distancia.
 *
 * Se usa el nombre completo y no el de pila: dos "María" en la misma semana
 * vuelven a ser indistinguibles. Si no hay nombre utilizable se cae al
 * teléfono y, en último caso, al id de WhatsApp — incluso un alias raro
 * ("Julinho_Cal🤗") distingue mejor que nada.
 */
export function meetingEventTitle({ leadName, contactPhone = null, waId = '', isPhone = false } = {}) {
  const name = String(leadName || '').trim();
  const who = (name && name !== GENERIC_CONTACT_NAME)
    ? name
    : (contactPhone || (waIdIsPhone(waId) ? formatPhoneForAdvisor(waId) : null) || waId || 'Contacto');
  return `${isPhone ? '📞' : '💻'} ${who} — Asesoría de tesis`;
}

/**
 * El horario que se le nombró al lead en el recordatorio de inactividad, si
 * todavía se puede agendar. Entre que sale el mensaje y llega su "sí" pueden
 * pasar horas: reservar un bloque que ya empezó (o que arranca en diez
 * minutos) le crea al asesor una reunión imposible. Si venció, se devuelve
 * null y el lead vuelve al camino normal, que le muestra la lista al día.
 */
export function usableProposedSlot(slot) {
  const startsAt = slot?.startTime ? new Date(slot.startTime).getTime() : NaN;
  if (!Number.isFinite(startsAt)) return null;
  return startsAt > Date.now() + MIN_BOOKING_LEAD_MINUTES * 60 * 1000 ? slot : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Etiquetas para la lista numerada de horarios. Si los tres bloques caen el
 * mismo día (el caso normal, y el día ya se nombró en la frase de arriba) se
 * muestra solo la hora: repetir "Sáb, 5 set" tres veces es ruido. Si hay
 * varios días, cada opción lleva su fecha para que no se confundan.
 *
 * `timeLabel` puede faltar en sesiones guardadas antes de este cambio; en ese
 * caso se cae a la etiqueta completa.
 */
function slotOptionLabels(slots) {
  const list = slots || [];
  const sameDay = list.length > 0 && list.every((slot) => slot.date === list[0].date);
  return list.map((slot) => (sameDay && slot.timeLabel) ? slot.timeLabel : slot.label);
}

/**
 * Etiquetas COMPLETAS (con su fecha) para los mensajes que no nombran el día
 * en la frase de arriba: `slotOptionLabels` recorta la fecha cuando todos los
 * bloques caen el mismo día, y en un "para hoy ya no alcanzamos" el contacto
 * terminaba viendo "7:30 a.m." sin saber que era de otro día.
 */
function fullSlotLabels(slots) {
  return (slots || []).map((slot) => slot.label);
}

/**
 * La cercanía a la hora que pidió el contacto decide QUÉ bloques se le
 * ofrecen; el orden en que los lee es otra cosa. Mostrarlos rankeados salía
 * "5:30, 6:30, 5:00", que parece una lista tirada al azar. Se muestran en
 * orden de reloj: los tres siguen siendo los más cercanos —eso ya lo dice la
 * frase de arriba— y así la lista se lee como una lista.
 */
function orderSlotsForDisplay(slots) {
  return [...(slots || [])].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
}

/**
 * Elige hasta `total` horarios repartidos entre los días más próximos (como
 * mucho `perDay` por día, separados para no ofrecer 10:00 y 10:30 del mismo
 * día como si fueran dos opciones distintas), en orden de reloj.
 */
export function spreadSlotsAcrossDays(slots, total, perDay) {
  const byDay = new Map();
  for (const slot of orderSlotsForDisplay(slots)) {
    if (!byDay.has(slot.date)) byDay.set(slot.date, []);
    byDay.get(slot.date).push(slot);
  }
  const picked = [];
  for (const daySlots of byDay.values()) {
    if (picked.length >= total) break;
    const first = daySlots[0];
    const chosen = [first];
    // El segundo del día: el primero que esté al menos 3 horas después
    // (mañana vs. tarde); si no hay, el último del día.
    if (perDay > 1 && daySlots.length > 1) {
      const later = daySlots.find((s) => new Date(s.startTime) - new Date(first.startTime) >= 3 * 60 * 60 * 1000);
      chosen.push(later || daySlots[daySlots.length - 1]);
    }
    picked.push(...chosen.slice(0, Math.min(perDay, total - picked.length)));
  }
  return orderSlotsForDisplay(picked);
}

function numberedList(items) {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/** "el martes 8" → "El martes 8", para arrancar una frase con la etiqueta de día. */
function capitalizeFirst(text) {
  const s = String(text || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * ¿La respuesta del contacto es tan obviamente el dato que se le pidió que no
 * vale la pena gastar un turno de LLM en clasificarla? ("1", "51987654321",
 * "kevin@gmail.com"). Todo lo demás sí pasa por el clasificador, que es el
 * que detecta las preguntas sueltas en medio del agendamiento.
 */
function isObviousStepAnswer(status, text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.length > 60 || /[?¿]/.test(t)) return false;

  switch (status) {
    case 'scheduling_mode':
    case 'scheduling_time':
      return /^\d{1,2}$/.test(t);
    case 'scheduling_phone':
      return /^[\d\s+()-]{7,20}$/.test(t);
    case 'scheduling_email':
      // Un correo escrito solo, o un "mándamelo por aquí" (que el handler ya
      // sabe leer como "sigo sin correo"): ni uno ni otro necesitan al LLM.
      return /^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(t) || wantsLinkHere(t);
    case 'scheduling_confirm':
      // Un "sí" o un "no" a "¿Confirmo…?" no necesitan al LLM. Cualquier otra
      // cosa sí: puede traer la corrección del día o de la modalidad.
      return isAffirmative(t) || /^no+[\s!.,]*$/i.test(normalize(t));
    default:
      // scheduling_date: "mañana", "el jueves"... no hay forma barata de
      // distinguirlo de una pregunta, así que siempre se clasifica.
      return false;
  }
}

/**
 * ¿Se puede reservar directo la hora que pidió el contacto, sin pasarle la
 * lista para que confirme?
 *
 * Hacen falta las dos cosas:
 *   - Que la hora sea SUYA y no inferida. El parser convierte los momentos
 *     vagos en una hora representativa ("temprano" → 09:00), y tomar eso como
 *     una elección terminaba agendando una hora en punto que nadie dijo.
 *   - Que el mensaje sea una elección, no una consulta. "¿el martes
 *     temprano?" pregunta si hay espacio; cerrarle ahí mismo una reunión es
 *     responder que sí y de paso decidir por él.
 *
 * Cuando alguna falla no se pierde nada: se le muestran los horarios más
 * cercanos a lo que pidió y elige con un número.
 */
function canBookExactTime(text, parsed) {
  if (!parsed?.preferredTime || parsed.timePrecision !== 'exact') return false;
  return !/[?¿]/.test(String(text || ''));
}

/**
 * El contacto dice que NO puede asistir a la reunión que ya tiene agendada, o
 * pide moverla o cancelarla.
 *
 * Se reconoce con una expresión y no con el clasificador porque de esto
 * depende callar un recordatorio ya programado, y el clasificador marca como
 * "urgente" cosas que no tienen nada que ver (una pregunta de precio, otro
 * tema de tesis). Equivocarse hacia el lado de callar un recordatorio válido
 * es peor que dejarlo salir.
 *
 * Caso real: el lead escribió "No puedo martes" y el bot igual le mandó el
 * recordatorio del martes.
 */
const CANNOT_ATTEND_RE = new RegExp(
  '\\bno\\s+(?:voy\\s+a\\s+)?(?:puedo|podre|podr[eé]|voy|llego|alcanzo|asisto)\\b'
  + '|\\bno\\s+me\\s+(?:va|viene|queda)\\b'
  + '|\\b(?:cancel(?:ar|a|o|emos)|anul(?:ar|a|o))\\b'
  + '|\\b(?:reagend|reprogram)\\w*\\b'
  + '|\\bcambiar\\s+(?:la\\s+)?(?:hora|fecha|d[ií]a|reuni[oó]n|cita)\\b'
  + '|\\bmover\\s+(?:la\\s+)?(?:hora|reuni[oó]n|cita)\\b'
  + '|\\bpara\\s+otro\\s+d[ií]a\\b',
  'i'
);

export function cannotAttendMeeting(text) {
  return CANNOT_ATTEND_RE.test(normalize(String(text || '')));
}

/**
 * Pista barata de que el contacto está hablando de CUÁNDO en un paso que le
 * pide otra cosa (su correo o su teléfono). Se usa como filtro previo para no
 * gastar una llamada al LLM en cada dato mal escrito: solo si el texto huele
 * a día u hora se intenta interpretarlo como un cambio de horario.
 */
const SCHEDULE_CHANGE_HINT_RE = /\b(hoy|ma[ñn]ana|pasado\s+ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|temprano|tarde|noche|mediod[ií]a|hora|horario|d[ií]a|a\s+las?|am|pm|mejor|cambiar|cambio|mover|otro|otra)\b/i;

/**
 * ¿El contacto está preguntando por el PRECIO? Se pide explícito ("precio",
 * "cuánto cuesta") y no un "cuánto" suelto, para no confundirlo con "¿cuánto
 * dura la reunión?", que no tiene nada que ver con el costo.
 */
const PRICE_QUESTION_RE = /(precio|costo|coste|tarifa|cotiza|presupuesto|inversi[oó]n)|cu[aá]nt[oa]s?\s+(?:me\s+)?(?:cuesta|sale|vale|ser[ií]a|es|est[aá])/i;

// Formas en que el LLM pregunta por el tema, la carrera o la universidad. Se
// usan para detectar que está preguntando por algo que la persona YA
// respondió (o que ya vino en el formulario de un anuncio, ver
// extractLeadFormFields).
const ASKS_PROBLEM_RE = /tema\s+en\s+mente|qu[eé]\s+tema|alg[uú]n\s+tema|tu\s+tema\s+de\s+tesis|tienes\s+(?:un|alg[uú]n)\s+tema/i;
const ASKS_FIELD_RE = /(?:de|en)\s+qu[eé]\s+carrera|qu[eé]\s+carrera\s+(?:estudias|est[aá]s|cursas|llevas|sigues)|cu[aá]l\s+es\s+tu\s+carrera/i;
const ASKS_UNIVERSITY_RE = /(?:de|en)\s+qu[eé]\s+universidad|qu[eé]\s+universidad\s+(?:estudias|est[aá]s|cursas)|cu[aá]l\s+es\s+tu\s+universidad|d[oó]nde\s+estudias/i;

/**
 * ¿La respuesta del LLM está preguntando por un dato que ya tenemos?
 *
 * Pasa porque el bloque "lo que te falta preguntar" del prompt se arma con lo
 * que se sabía ANTES de leer el mensaje nuevo: si ese mensaje traía el dato
 * ("sobre arquitectura de la continental"), el modelo a veces lo extrae
 * correctamente pero igual hace la pregunta que tenía pendiente. También pasa
 * con leads de un formulario de Meta Ads cuya respuesta de avance ya implica
 * "sin tema" (extractLeadFormFields). La del tema no se revisa en el primer
 * turno: ese mensaje es el saludo de apertura, y reemplazarlo lo perdería.
 * Devuelve 'problem' | 'field' | 'university' | null.
 */
export function detectRedundantAsk(reply, answers, isFirstTurn = false) {
  const text = String(reply || '');
  if (!isFirstTurn && answers.problem && ASKS_PROBLEM_RE.test(text)) return 'problem';
  if (answers.field && ASKS_FIELD_RE.test(text)) return 'field';
  if (answers.university && ASKS_UNIVERSITY_RE.test(text)) return 'university';
  return null;
}

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * En el paso del correo, formas de decir "no te doy un correo, mándame el
 * link del Meet por acá mismo". Es el mismo desenlace que responder "no":
 * `emailSkipped = true` y el link se manda por WhatsApp.
 */
const LINK_HERE_RE = /\b(este\s+medio|por\s+(?:aqui|aca|whatsapp|wsp|el\s+chat|este\s+chat|este\s+medio)|aqui\s+(?:nomas|mismo|mejor|no\s+mas)|aca\s+(?:nomas|mismo|no\s+mas)|manda(?:melo)?\s+(?:el\s+link\s+)?(?:por\s+)?(?:aqui|aca|whatsapp)|deja(?:lo|me)?\s+(?:el\s+link\s+)?(?:por\s+)?(?:aqui|aca))\b/;

function wantsLinkHere(text) {
  return LINK_HERE_RE.test(normalize(String(text || '').trim()));
}

/**
 * ¿Vale la pena consultarle al LLM el nombre oficial de esta universidad? Si
 * el texto ya trae "universidad"/"instituto" escrito, se toma tal cual; una
 * sigla o un nombre corto ("unac", "la continental", "san marcos") sí se
 * normaliza.
 */
function shouldResolveUniversity(text) {
  return !/universidad|instituto|\bescuela\b|polit[eé]cn/i.test(String(text || ''));
}

/**
 * Similitud de tokens (Jaccard) entre dos mensajes, para no reenviarle al
 * contacto la MISMA pregunta cuando su respuesta intermedia no aportó nada
 * (un ".", un "ok"): recibir dos veces seguidas "¿En qué universidad
 * estudias?" se lee como que nadie leyó lo que escribió.
 */
function messageSimilarity(a, b) {
  const toks = (s) => new Set(
    normalize(String(s || ''))
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
  const A = toks(a);
  const B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Motor conversacional de Avan por WhatsApp: en cada turno, un LLM (Ollama
 * Cloud) decide qué responder y qué preguntar de forma natural, extrayendo
 * del hilo los datos necesarios para evaluar la tesis (tema, ámbito, nivel,
 * carrera, correo). Al reunir tema + correo, evalúa la viabilidad, envía el
 * reporte por correo, registra/actualiza el lead en el funnel de ventas, y
 * ofrece agendar una llamada en el calendario real del asesor.
 */
/**
 * Suma a `answers` la ficha académica que extrajo el LLM, reducida al
 * catálogo cerrado de leadQualification.js (lo que no calza se descarta).
 * Devuelve true si cambió algún dato.
 */
function mergeAcademicProfile(answers, extracted) {
  const before = JSON.stringify([answers.academicStatus, answers.cycle, answers.thesisSituation]);
  const cycle = normalizeCycle(extracted.cycle);
  const academicStatus = normalizeAcademicStatus(extracted.academicStatus) || (cycle ? 'Estudiante' : null);
  const thesisSituation = normalizeThesisSituation(extracted.thesisSituation);
  if (academicStatus) answers.academicStatus = academicStatus;
  if (cycle) answers.cycle = cycle;
  if (thesisSituation) answers.thesisSituation = thesisSituation;
  return JSON.stringify([answers.academicStatus, answers.cycle, answers.thesisSituation]) !== before;
}

/** Campos del lead que salen de la ficha académica (solo los que se conocen). */
function academicProfilePayload(answers) {
  const payload = {};
  if (answers.academicStatus) payload.academicStatus = answers.academicStatus;
  if (answers.cycle) payload.academicCycle = answers.cycle;
  if (answers.thesisSituation) payload.thesisSituation = answers.thesisSituation;
  return payload;
}

export class WhatsappBotService {
  constructor({ ollamaService, emailService, leadService, whatsappMessageService, settingsService, googleCalendarService, scheduledMeetingService, notificationService }) {
    this.ollamaService = ollamaService;
    this.emailService = emailService;
    this.leadService = leadService;
    this.whatsappMessageService = whatsappMessageService;
    this.scheduledMeetingService = scheduledMeetingService;
    this.notificationService = notificationService;
    this.settingsService = settingsService || new WhatsappBotSettingsService();
    this.googleCalendarService = googleCalendarService;
    // wa_id -> { messages: string[], timer: NodeJS.Timeout }, buffer temporal
    // de las burbujas de un contacto mientras se espera el silencio de
    // MESSAGE_DEBOUNCE_MS antes de procesar el turno conversacional.
    this.pendingMessages = new Map();
    // wa_id -> timestamp (reservado) del próximo envío permitido, para respetar
    // la espera mínima estricta entre mensajes incluso con envíos concurrentes.
    this.lastSentAt = new Map();
    // wa_id -> último texto enviado, para no mandar dos veces seguidas el
    // mismo mensaje (ver `send`). En memoria a propósito: solo interesa el
    // mensaje inmediatamente anterior, y tras un reinicio no hay duplicado
    // que evitar porque tampoco hay turno en curso.
    this.lastSentText = new Map();
    // wa_id -> cuántos mensajes se le han enviado en total. Solo se usa para
    // comparar el contador antes y después de un turno y así saber si el turno
    // le respondió ALGO: es la red de seguridad de `_runTurnGuarded`.
    this.sendCounter = new Map();
    // wa_id -> Promise del turno en curso. TODO lo que le responde al contacto
    // pasa por esta cola: nunca corren dos turnos en paralelo para el mismo
    // contacto (eso duplicaba mensajes y rompía la espera entre ellos).
    this.turnChains = new Map();
    // wa_id -> nº de mensajes entrantes recibidos de ese contacto. Un turno
    // anota el valor al empezar y lo vuelve a mirar antes de responder: si
    // cambió, el contacto siguió escribiendo mientras se preparaba la
    // respuesta, así que este turno se descarta y contesta el siguiente, ya
    // con TODO lo que escribió. Sin esto, cualquier burbuja que llegara
    // durante el turno (el LLM + la espera anti-spam tardan 10-15 s) generaba
    // una segunda respuesta suelta en vez de agruparse.
    this.inboundCounter = new Map();
    // wa_id -> message_id del último mensaje entrante, necesario para mostrarle
    // el indicador de "escribiendo..." de WhatsApp antes de responder.
    this.lastInboundMessageId = new Map();
    // Bitácora en memoria (más reciente primero) de lo que hace el bot: cuándo
    // agrupa mensajes, qué le manda al LLM de Ollama Cloud, qué responde, y si
    // el envío por WhatsApp tuvo éxito. Sirve para verificar visualmente desde
    // el panel de WhatsApp que el flujo está funcionando, sin depender de los
    // logs del servidor.
    this.activity = [];
  }

  logActivity(entry) {
    this.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    if (this.activity.length > MAX_ACTIVITY_LOG) this.activity.length = MAX_ACTIVITY_LOG;
  }

  /**
   * Encola `fn` para que se ejecute cuando termine cualquier procesamiento
   * anterior del mismo contacto. Garantiza que jamás corran dos turnos en
   * paralelo para un wa_id (la causa de los mensajes duplicados).
   */
  runSerialized(waId, fn) {
    const prev = this.turnChains.get(waId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => fn());
    this.turnChains.set(waId, next);
    // Limpieza al terminar (ok o error). Se hace con un handler que NO
    // relanza, para que esta rama de la promesa no genere un
    // "unhandledRejection" (la rama `next` que se devuelve sí propaga el
    // error, y de ella se encarga quien llama con su propio .catch).
    const cleanup = () => {
      if (this.turnChains.get(waId) === next) this.turnChains.delete(waId);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  getActivity() {
    return this.activity;
  }

  clearActivity() {
    this.activity = [];
  }

  async getSession(waId) {
    return db('whatsapp_bot_sessions').where({ wa_id: waId }).first();
  }

  async updateSession(waId, data) {
    await db('whatsapp_bot_sessions').where({ wa_id: waId }).update({ ...data, updated_at: db.fn.now() });
  }

  /**
   * Borra la sesión de un contacto para que su próximo mensaje se trate como
   * si fuera un contacto totalmente nuevo (pasa de nuevo por el buffer y el
   * saludo generado por el LLM). Útil para volver a probar la conversación
   * con un número que ya la completó o quedó pausado, sin tener que esperar
   * a un contacto nuevo. No borra el historial de mensajes visible en el
   * hilo, solo el estado interno del bot.
   *
   * También borra el registro propio de reuniones agendadas con ese contacto
   * (tabla scheduled_meetings, NO el evento real en Google Calendar): sin
   * esto, getLatestForContact() seguía trayendo una reunión de una prueba
   * anterior y el bot volvía a recordarle esa reunión vieja al contacto en
   * cuanto la conversación reiniciada llegaba de nuevo a "completed", aunque
   * la sesión se hubiera reiniciado.
   */
  async resetSession(waId) {
    const pending = this.pendingMessages.get(waId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingMessages.delete(waId);
    this.inboundCounter.delete(waId);

    await db('whatsapp_bot_sessions').where({ wa_id: waId }).delete();
    if (this.scheduledMeetingService) await this.scheduledMeetingService.deleteForContact(waId);
    this.logActivity({ type: 'reset', waId });
  }

  async setBotEnabled(waId, enabled) {
    const existing = await this.getSession(waId);
    if (existing) {
      await this.updateSession(waId, { bot_enabled: enabled });
    } else {
      await db('whatsapp_bot_sessions').insert({ wa_id: waId, status: 'active', bot_enabled: enabled, answers: JSON.stringify({}) });
    }
  }

  /**
   * Mueve al lead de este contacto a una etapa del Setter Funnel. El lead ya
   * existe siempre en este punto (whatsappWebhookService lo crea/encuentra
   * por teléfono antes de pasarle el mensaje al bot), así que solo se
   * actualiza su status; si por algún motivo no existe, se ignora en vez de
   * interrumpir la conversación.
   *
   * Un lead que YA graduó al Funnel de Ventas no se mueve nunca desde acá: el
   * bot solo manda leads HACIA el funnel comercial (`cita_agendada`), jamás de
   * vuelta. Sin este tope, el barrido de inactividad le pisaba el status a
   * leads que el closer estaba trabajando —cotizados, en seguimiento— y los
   * devolvía al Setter Funnel en la columna "Congelados", como si nadie los
   * hubiera atendido. Es un tope y no un arreglo de un camino puntual a
   * propósito: cualquier camino futuro del bot queda cubierto.
   */
  async moveFunnelStage(waId, status) {
    try {
      const lead = await this.leadService.findByPhone(waId);
      if (!lead) return;

      if (leadHasGraduated(lead, await loadSalesFunnelStatuses())) {
        this.logActivity({
          type: 'funnel_move_blocked',
          waId,
          reason: `El lead #${lead.id} ya está en el Funnel de Ventas (etapa "${lead.status}"): el bot no lo mueve a "${status}".`
        });
        return;
      }

      // El actor viaja hasta `leadService.updateLeadStatus()`, que repite el
      // tope del lado de la base de datos y deja el intento en la bitácora:
      // este `if` evita el viaje, pero no es el que garantiza nada.
      await this.leadService.updateLeadStatus(lead.id, status, {
        actor: { type: 'bot', name: 'Bot de WhatsApp' },
        reason: 'Movimiento automático del bot de WhatsApp.'
      });
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al mover el lead de ${waId} a la etapa "${status}" del Setter Funnel:`, error);
    }
  }

  /**
   * El lead de este contacto, solo si ya graduó al Funnel de Ventas (lo
   * trabaja una persona). Devuelve `null` si sigue siendo del setter, si no
   * hay lead, o si la consulta falla: ante la duda el bot sigue trabajando,
   * porque dejar a un contacto sin respuesta por un error de base de datos es
   * peor que el problema que este guard evita.
   *
   * `salesStatuses` se pasa cuando ya se cargó para todo un barrido, para no
   * repetir la consulta a `funnel_columns` por cada fila.
   */
  async salesFunnelLead(waId, salesStatuses = null) {
    try {
      const lead = await this.leadService.findByPhone(waId);
      if (!lead) return null;
      const statuses = salesStatuses || await loadSalesFunnelStatuses();
      return leadHasGraduated(lead, statuses) ? lead : null;
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al comprobar si el lead de ${waId} ya está en el Funnel de Ventas:`, error.message);
      return null;
    }
  }

  /**
   * De una lista de contactos, cuáles tienen su lead ya en el Funnel de
   * Ventas. Una sola consulta por los teléfonos (más la de `funnel_columns`)
   * en vez de dos por cada fila del barrido.
   *
   * El cruce es por los últimos dígitos y no por la cadena exacta (ver
   * `phoneMatchKey`): el barrido recorre `wa_id`s crudos y el lead del closer
   * puede estar guardado como "+51 987 654 321". Con la comparación exacta, el
   * barrido no lo reconocía y lo congelaba igual.
   */
  async _salesFunnelWaIds(waIds) {
    if (waIds.length === 0) return new Set();
    try {
      const salesStatuses = await loadSalesFunnelStatuses();
      const byKey = new Map();
      for (const waId of waIds) {
        const key = phoneMatchKey(waId);
        if (key) byKey.set(key, waId);
      }

      const leads = await db('leads')
        .where(function () {
          this.whereIn('phone', waIds);
          if (byKey.size > 0) this.orWhereRaw(`${PHONE_MATCH_KEY_SQL} IN (${[...byKey.keys()].map(() => '?').join(',')})`, [...byKey.keys()]);
        })
        .select('phone', 'status', 'sales_funnel_at');

      const graduated = new Set();
      for (const lead of leads) {
        if (!leadHasGraduated(lead, salesStatuses)) continue;
        if (waIds.includes(lead.phone)) graduated.add(lead.phone);
        const waId = byKey.get(phoneMatchKey(lead.phone));
        if (waId) graduated.add(waId);
      }
      return graduated;
    } catch (error) {
      // Ante la duda el barrido sigue como antes: dejar de hacer seguimiento a
      // todos los leads del setter por un error de consulta sería peor.
      console.error('❌ [WhatsApp Bot] Error al listar los leads que ya están en el Funnel de Ventas:', error.message);
      return new Set();
    }
  }

  /**
   * ¿Este contacto tiene una reunión agendada que todavía no pasó? Es la única
   * excepción al silencio del bot con los leads del Funnel de Ventas: un lead
   * recién graduado a "cita_agendada" sigue recibiendo el recordatorio de SU
   * reunión y las respuestas sobre el link/la hora (ver
   * handlePostBookingMessage). Ese camino no mueve el funnel ni congela nada:
   * es el bot terminando su propio agendamiento, no trabajando al lead.
   */
  async hasUpcomingMeeting(waId) {
    try {
      const meeting = await db('scheduled_meetings')
        .where({ wa_id: waId })
        .where('start_time', '>=', db.fn.now())
        .first();
      return !!meeting;
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al buscar la reunión próxima de ${waId}:`, error.message);
      return false;
    }
  }

  /**
   * Mensaje de un lead que ya está en el Funnel de Ventas: el bot se retira en
   * vez de retomar la conversación (volvería a calificar o a ofrecer una cita a
   * alguien que ya tiene cotización y un closer asignado). Se pausa el bot para
   * ese contacto, que es el estado que el panel de WhatsApp ya sabe mostrar
   * ("bot pausado"), así el silencio se ve en vez de parecer una falla; y se
   * avisa UNA vez al equipo, porque alguien tiene que leer ese mensaje.
   */
  async standDownForSalesFunnel(waId, lead, text) {
    const pending = this.pendingMessages.get(waId);
    if (pending?.timer) clearTimeout(pending.timer);
    this.pendingMessages.delete(waId);

    this.logActivity({
      type: 'skipped',
      waId,
      text,
      reason: `El lead #${lead.id} ya está en el Funnel de Ventas (etapa "${lead.status}"): lo trabaja una persona y el bot no vuelve a responderle automáticamente.`
    });

    const session = await this.getSession(waId);
    if (session && !session.bot_enabled) return;

    await this.setBotEnabled(waId, false);

    await this.alertInternal({
      waId,
      type: 'sales_funnel_lead_message',
      title: `${lead.full_name || waId} escribió por WhatsApp`,
      body: `Este lead ya está en el Funnel de Ventas (etapa "${lead.status}"), así que el bot no le responde.\n\n`
        + `Escribió: "${text}"\n\n`
        + 'Hay que contestarle a mano desde el panel de WhatsApp.'
    });
  }

  /**
   * Envía un mensaje del bot respetando: (1) el indicador de "escribiendo..."
   * de WhatsApp si está habilitado, y (2) una espera mínima estricta desde el
   * mensaje anterior al mismo contacto (message_gap_seconds), para no caer en
   * comportamiento de spam.
   */
  async send(waId, text, { requireOpenWindow = false } = {}) {
    // WhatsApp solo acepta texto libre dentro de las 24 h siguientes al último
    // mensaje del contacto. Una respuesta a un mensaje que acaba de llegar
    // siempre está dentro, así que el chequeo solo se exige en los envíos que
    // el bot inicia por su cuenta (recordatorios, seguimientos): son los que
    // quedaban en `failed` sin que nadie se enterara.
    if (requireOpenWindow && !(await this.whatsappMessageService.isCustomerWindowOpen(waId))) {
      const error = new Error('La ventana de 24 h de WhatsApp con este contacto está cerrada.');
      error.code = 'WINDOW_CLOSED';
      this.logActivity({ type: 'send_skipped_window_closed', waId, text });
      throw error;
    }

    let settings = {};
    try {
      settings = await this.settingsService.get();
    } catch { /* si falla, se usan los valores por defecto de abajo */ }

    const configuredGapMs = settings.message_gap_seconds != null
      ? Math.max(0, Number(settings.message_gap_seconds) * 1000)
      : DEFAULT_MESSAGE_GAP_MS;

    // La espera real es la mayor de las dos: el mínimo antispam configurado y
    // lo que tardaría una persona en TECLEAR este mensaje. Así un texto largo
    // se hace esperar más que un acuse corto, que es como se comporta alguien
    // del otro lado. El indicador de "escribiendo..." se manda justo abajo,
    // antes de la espera, para que ese rato se vea como lo que simula ser.
    const gapMs = Math.max(configuredGapMs, typingTimeFor(text)) + EXTRA_MESSAGE_DELAY_MS;

    // Reserva el momento del próximo envío ANTES de esperar: si dos send()
    // corren casi a la vez, el segundo ve el timestamp reservado por el
    // primero y se encola detrás con el gap completo (en vez de que ambos
    // calculen la espera sobre el mismo "último envío" y salgan juntos).
    const now = Date.now();
    const reserved = this.lastSentAt.get(waId) || 0;
    const sendAt = reserved === 0
      ? now + gapMs
      : Math.max(now + TYPING_PAUSE_MS + EXTRA_MESSAGE_DELAY_MS, reserved + gapMs);
    this.lastSentAt.set(waId, sendAt);
    const waitMs = sendAt - now;

    const typingEnabled = settings.typing_indicator_enabled == null ? true : !!settings.typing_indicator_enabled;
    if (typingEnabled) {
      const inboundId = this.lastInboundMessageId.get(waId);
      if (inboundId) {
        try {
          await this.whatsappMessageService.sendTypingIndicator(inboundId);
        } catch (error) {
          this.logActivity({ type: 'typing_indicator_failed', waId, error: error.message });
        }
      }
    }

    if (waitMs > 0) await sleep(waitMs);

    // Nunca dos mensajes seguidos prácticamente idénticos. La conversación
    // libre ya tenía su propio filtro, pero los pasos del agendamiento mandan
    // por aquí directo y podían repetir la misma pregunta palabra por palabra
    // (el contacto escribe en ráfaga, dos turnos se cruzan y recibe la misma
    // lista de horarios dos veces seguidas). El umbral es alto a propósito:
    // solo se calla el duplicado real, no una reformulación.
    const previous = this.lastSentText.get(waId);
    if (previous && messageSimilarity(text, previous) >= 0.9) {
      // Cuenta como respuesta a efectos de `_runTurnGuarded`: el turno sí tenía
      // algo que decir, y lo que se calla es solo la repetición literal de lo
      // que el contacto ya tiene en pantalla.
      this.sendCounter.set(waId, (this.sendCounter.get(waId) || 0) + 1);
      this.logActivity({ type: 'send_skipped_duplicate', waId, text });
      return;
    }

    try {
      await this.whatsappMessageService.sendTextMessage(waId, text);
      this.sendCounter.set(waId, (this.sendCounter.get(waId) || 0) + 1);
      this.lastSentText.set(waId, text);
      // Ancla el próximo gap al envío real (por si el sleep se desvió), sin
      // bajar de lo ya reservado.
      this.lastSentAt.set(waId, Math.max(Date.now(), sendAt));
      this.logActivity({ type: 'send_success', waId, text });
    } catch (error) {
      this.logActivity({ type: 'send_failed', waId, text, error: error.message });
      throw error;
    }
  }

  /**
   * Procesa un mensaje de texto entrante. Los turnos de conversación libre
   * (estado "active", incluyendo el primer contacto) se agrupan en el buffer
   * de silencio antes de mandarlos al LLM; la selección de horario tras
   * ofrecer agendar se procesa aparte, sin debounce.
   */
  async handleIncomingMessage(waId, text, messageId = null) {
    // Se guarda el id del mensaje entrante para poder mostrar el indicador de
    // "escribiendo..." de WhatsApp (que se envía referenciando ese id) antes
    // de cada respuesta del bot.
    if (messageId) this.lastInboundMessageId.set(waId, messageId);

    // El lead ya graduó al Funnel de Ventas: lo trabaja un closer, con
    // cotización de por medio, y el bot no tiene nada que hacer ahí — retomar
    // la conversación significaría volver a calificarlo o a ofrecerle una cita
    // que ya tuvo. Se comprueba ANTES del buffer para que no quede un turno
    // encolado del mensaje anterior.
    //
    // Única excepción: mientras tenga una reunión próxima agendada sigue
    // atendido por el camino post-agendamiento (responde por el link o la
    // hora, silencia el recordatorio si avisa que no puede). Ese camino no
    // mueve el funnel ni congela nada.
    const salesLead = await this.salesFunnelLead(waId);
    if (salesLead && !(await this.hasUpcomingMeeting(waId))) {
      await this.standDownForSalesFunnel(waId, salesLead, text);
      return;
    }

    // Si ya hay un buffer en curso para este wa_id, esta burbuja se suma a
    // las anteriores y se reinicia la espera de silencio, en vez de procesar
    // un turno por cada mensaje suelto.
    if (this.pendingMessages.has(waId)) {
      this.bufferMessage(waId, text);
      return;
    }

    const session = await this.getSession(waId);

    if (!session) {
      this.bufferMessage(waId, text);
      return;
    }

    if (!session.bot_enabled) {
      this.logActivity({
        type: 'skipped',
        waId,
        text,
        reason: 'El bot está pausado para este contacto (alguien respondió manualmente). Actívalo con "▶️ Activar bot" en el panel.'
      });
      return;
    }

    if (await this._isFrozenSession(waId, session)) {
      const status = await this.reactivateFrozenSession(waId, session);
      this.bufferMessage(waId, text, this.debounceForStatus(status));
      return;
    }

    if (session.status === 'completed') {
      // Si ya tiene una reunión real agendada, un mensaje nuevo puede ser
      // algo que sí necesita atención (reagendar, queja, pregunta por el
      // link) — se clasifica en vez de ignorarlo sin más. Si nunca llegó a
      // agendar (transferido a asesor sin reunión, descartado, etc.), sigue
      // igual que antes: el bot ya no vuelve a responder solo.
      const meeting = this.scheduledMeetingService ? await this.scheduledMeetingService.getLatestForContact(waId) : null;
      if (meeting) {
        // También pasan por el buffer: quien ya agendó escribe igual de
        // entrecortado que el resto ("gracias" / "una consulta...").
        this.bufferMessage(waId, text, this.debounceForStatus(session.status));
        return;
      }

      this.logActivity({
        type: 'skipped',
        waId,
        text,
        reason: 'La conversación ya está marcada como "completed" sin una reunión agendada; el bot no vuelve a responder automáticamente. Usa "🔄 Reiniciar conversación" en el panel para probarla de nuevo.'
      });
      return;
    }

    // Tanto la conversación libre ('active') como los pasos de agendamiento
    // se agrupan en el buffer de silencio: el contacto suele partir su
    // respuesta en varias burbujas ("mi correo es x@y.com" + "pero cuánto
    // dura la reunión?"), y procesarlas por separado hacía que la segunda se
    // interpretara como un dato inválido del paso. El turno que dispara el
    // buffer re-lee el estado real y enruta al handler que corresponda.
    await this.clearNudge(waId);
    this.bufferMessage(waId, text, this.debounceForStatus(session.status));
  }

  /**
   * ¿La sesión quedó congelada por inactividad? Además del estado "frozen",
   * reconoce las congeladas antes de que existiera ese estado: quedaron como
   * "completed" sin reunión y con el lead en la etapa "congelado".
   */
  async _isFrozenSession(waId, session) {
    if (session.status === FROZEN_STATUS) return true;
    if (session.status !== 'completed' || !session.nudge_sent_at) return false;
    const meeting = this.scheduledMeetingService ? await this.scheduledMeetingService.getLatestForContact(waId) : null;
    if (meeting) return false;
    const lead = await this.leadService.findByPhone(waId);
    return lead?.status === 'congelado';
  }

  /**
   * El contacto congelado volvió a escribir: se retoma la conversación en el
   * paso donde quedó y el lead vuelve a "En Calificación". El contador de
   * recordatorios vuelve a cero: volvió por su cuenta, así que la
   * conversación nueva merece sus propios intentos (si no, arrastraría el
   * tope ya agotado y el primer silencio la congelaría sin avisar). Si estaba
   * agendando, se descartan los días que se le ofrecieron (pudieron pasar
   * horas y ya no ser válidos) para que se recalculen con la agenda actual.
   * Devuelve el estado con el que queda la sesión.
   */
  async reactivateFrozenSession(waId, session) {
    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const previous = answers.__frozenFrom;
    delete answers.__frozenFrom;
    delete answers.__warmupSlot;

    let status = 'active';
    if (SCHEDULING_STATUSES.includes(previous) && answers.__scheduling) {
      // Los horarios que vio al elegir hora pudieron ya pasar: se vuelve a
      // elegir el día, que recalcula los bloques libres.
      status = previous === 'scheduling_time' ? 'scheduling_date' : previous;
      delete answers.__scheduling.availableDays;
      delete answers.__scheduling.availableWindows;
    } else {
      delete answers.__scheduling;
    }

    await db('whatsapp_bot_sessions').where({ wa_id: waId }).update({
      status, nudge_sent_at: null, nudge_count: 0, answers: JSON.stringify(answers), updated_at: db.fn.now()
    });
    await this.moveFunnelStage(waId, 'calificando');
    this.logActivity({ type: 'frozen_reactivated', waId, status });
    return status;
  }

  /**
   * Espera de agrupación que corresponde al estado de la sesión, para que la
   * bitácora y el buffer usen siempre el mismo criterio.
   */
  debounceForStatus(status) {
    // El calentamiento espera un "sí" suelto, del mismo tamaño que la
    // respuesta a cualquier paso del agendamiento: le toca la misma espera
    // corta y no la de la conversación libre.
    if (status === 'scheduling_confirm') return CONFIRM_DEBOUNCE_MS;
    if (status === WARMUP_STATUS || SCHEDULING_STATUSES.includes(status)) return SCHEDULING_DEBOUNCE_MS;
    if (status === 'completed') return POST_BOOKING_DEBOUNCE_MS;
    return MESSAGE_DEBOUNCE_MS;
  }

  /**
   * Enruta un mensaje al handler correcto según el estado ACTUAL de la sesión
   * (re-leído justo antes de procesar). Se usa desde la cola serializada para
   * que un mensaje encolado mientras corría otro turno no se procese con un
   * estado ya obsoleto.
   */
  async dispatchByStatus(waId, text) {
    const session = await this.getSession(waId);
    if (!session || !session.bot_enabled) return;

    // El lead se despidió: se cierra la conversación ANTES de enrutar el
    // turno. Sin esto la sesión seguía "active", el modelo improvisaba una
    // despedida y una hora después el barrido de inactividad le mandaba
    // "¿Sigues por ahí?" a alguien que acababa de decir que no le interesa.
    //
    // En 'active' no se comprueba acá: ese caso enruta a runConversationTurn(),
    // que ya lo hace al entrar. Comprobarlo dos veces gastaría dos consultas al
    // LLM por el mismo mensaje.
    if (session.status !== 'active' && await this._closedAfterRefusal(waId, text)) return;

    switch (session.status) {
      case 'scheduling_mode': return this.handleSchedulingModeReply(waId, session, text);
      case 'scheduling_phone': return this.handleSchedulingPhoneReply(waId, session, text);
      case 'scheduling_email': return this.handleSchedulingEmailReply(waId, session, text);
      case 'scheduling_confirm': return this.handleSchedulingConfirmReply(waId, session, text);
      case 'scheduling_date': return this.handleSchedulingDateReply(waId, session, text);
      case 'scheduling_time': return this.handleSchedulingTimeReply(waId, session, text);
      case WARMUP_STATUS: return this.handleWarmupTurn(waId, session, text);
      case 'active': return this.runConversationTurn(waId, text);
      default: return; // 'completed' u otro: no se hace nada aquí.
    }
  }

  /**
   * Borra el recordatorio de inactividad pendiente (si lo hay) apenas el
   * contacto vuelve a escribir, para que el barrido de checkStaleConversations()
   * no lo congele por una inactividad que ya terminó.
   */
  async clearNudge(waId) {
    const session = await this.getSession(waId);
    if (session?.nudge_sent_at) {
      await db('whatsapp_bot_sessions').where({ wa_id: waId }).update({ nudge_sent_at: null });
    }
  }

  /**
   * Agrega una burbuja al buffer de este wa_id y reinicia el temporizador de
   * silencio. Cuando el contacto deja de escribir por MESSAGE_DEBOUNCE_MS,
   * se dispara runConversationTurn() con todo lo acumulado unido en un solo
   * mensaje.
   */
  bufferMessage(waId, text, waitMs = MESSAGE_DEBOUNCE_MS) {
    this.inboundCounter.set(waId, (this.inboundCounter.get(waId) || 0) + 1);

    const pending = this.pendingMessages.get(waId) || { messages: [], timer: null };
    if (text && text.trim()) pending.messages.push(text.trim());
    // Una burbuja que llega mientras ya hay buffer conserva la espera con la
    // que se abrió (la del estado en que estaba el contacto).
    pending.waitMs = pending.waitMs ?? waitMs;

    this.logActivity({
      type: 'buffer',
      waId,
      text,
      bufferSize: pending.messages.length,
      waitMs: pending.waitMs
    });

    const fire = () => {
      // Las burbujas se unen y, en el mismo paso, se recompone lo que quedó
      // partido entre ellas (un "pm" mandado solo, después de la hora). Se
      // hace ACÁ y no más adelante para que el LLM, el parser de fechas y las
      // expresiones del agendamiento lean todos la misma frase coherente.
      const joined = coalesceTimeFragments(pending.messages.join('\n'));
      // La marca se toma AQUÍ, no dentro del turno: entre que el temporizador
      // dispara y el turno lee la sesión hay consultas a la base de datos, y
      // una burbuja que cayera justo ahí ya no se detectaría como posterior.
      const mark = this.inboundCounter.get(waId) || 0;

      // El buffer NO se borra al disparar: el turno tarda lo que tarde el LLM
      // más la espera del gap de envío (juntos, más de diez segundos), y en
      // todo ese rato este sigue siendo el punto de entrada del contacto. Si
      // se borrara, la burbuja que llegue mientras el bot está respondiendo
      // abriría su propio turno y saldrían dos respuestas encimadas — que es
      // como el contacto recibía dos saludos de apertura seguidos.
      pending.messages = [];
      pending.running = true;
      // Tras el primer turno ya no se prorroga por saludo: la prórroga existe
      // para no gastar el turno de apertura, no para retrasar un "gracias".
      pending.extendedForGreeting = true;

      const done = () => {
        if (this.pendingMessages.get(waId) !== pending) return;
        pending.running = false;
        if (pending.messages.length === 0) {
          this.pendingMessages.delete(waId);
          return;
        }
        // Llegó algo mientras respondíamos: se reabre la espera de silencio
        // con lo acumulado, en un solo turno más.
        this.logActivity({ type: 'buffer_reopened', waId, bufferSize: pending.messages.length, waitMs: pending.waitMs });
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(fire, pending.waitMs);
      };

      // A la cola serializada: si todavía hay un turno anterior en curso para
      // este contacto, este espera a que termine (y re-evalúa el estado)
      // en vez de correr en paralelo y duplicar mensajes.
      this.runSerialized(waId, () => this._runTurnGuarded(waId, joined, mark)).then(done, (error) => {
        this.logActivity({ type: 'conversation_turn_failed', waId, error: error.message });
        console.error(`❌ [WhatsApp Bot] Error en el turno de conversación con ${waId}:`, error);
        done();
      });
    };

    // Con un turno en curso no se arma temporizador: la espera de silencio la
    // reabre `done()` cuando ese turno termina. Armarlo aquí haría que la
    // burbuja disparara un segundo turno antes de que el primero acabara.
    if (!pending.running) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = setTimeout(() => {
        // Solo un saludo: se espera una vez más en vez de gastar un turno en
        // responder algo que no dice nada. Si en esa prórroga llega el mensaje
        // real, entra al mismo buffer y se responde todo junto.
        if (!pending.extendedForGreeting && isGreetingOnly(pending.messages.join(' '))) {
          pending.extendedForGreeting = true;
          this.logActivity({ type: 'buffer_extended', waId, text: pending.messages.join('\n'), waitMs: GREETING_EXTRA_WAIT_MS });
          pending.timer = setTimeout(fire, GREETING_EXTRA_WAIT_MS);
          return;
        }
        fire();
      }, pending.waitMs);
    }

    this.pendingMessages.set(waId, pending);
  }

  /**
   * Ejecuta un turno del motor conversacional: arma el contexto (respuestas
   * ya conocidas + hilo de mensajes reales de WhatsApp), le pide al LLM la
   * siguiente respuesta natural y los datos que pudo extraer, los guarda, y
   * si ya reunió lo mínimo (tema + correo) pasa a evaluar y ofrecer agendar.
   */
  /**
   * Corre un turno y garantiza que el contacto reciba SIEMPRE una respuesta si
   * estaba en pleno agendamiento.
   *
   * El 28/09 el lead más maduro del día (bachiller, con jurados, pidiendo
   * agendar) escribió "Jueves a las 9 am" y la conversación terminó ahí: nunca
   * llegó una respuesta. El paso de agendamiento consulta Google Calendar y al
   * LLM, y si cualquiera de esas llamadas revienta —token vencido, timeout de
   * red— la excepción subía hasta el buffer, que la registraba en la bitácora y
   * no mandaba nada. Para el lead eso es indistinguible de que lo dejaran en
   * visto, y es peor que cualquier respuesta imperfecta.
   *
   * La red solo se activa si (a) el turno falló o no envió nada y (b) el
   * contacto quedó en un paso de agendamiento, que es donde el silencio deja
   * una pregunta sin contestar. Los muchos caminos que callan a propósito
   * (bot pausado, sesión cerrada, turno obsoleto) no están en un paso de
   * agendamiento y no disparan nada.
   */
  async _runTurnGuarded(waId, incomingText, inboundMark = null) {
    const sentBefore = this.sendCounter.get(waId) || 0;
    let failure = null;

    try {
      await this.runConversationTurn(waId, incomingText, inboundMark);
    } catch (error) {
      failure = error;
      this.logActivity({ type: 'turn_error_recovering', waId, text: incomingText, error: error.message });
      console.error(`❌ [WhatsApp Bot] El turno con ${waId} falló; se intenta responder igual:`, error);
    }

    if ((this.sendCounter.get(waId) || 0) > sentBefore) {
      if (failure) throw failure;
      return;
    }

    // Nada enviado. ¿Se le debía una respuesta?
    let session = null;
    try {
      session = await this.getSession(waId);
    } catch (error) {
      this.logActivity({ type: 'turn_recovery_session_failed', waId, error: error.message });
    }

    const owesReply = session?.bot_enabled && SCHEDULING_STATUSES.includes(session.status);
    if (!owesReply) {
      if (failure) throw failure;
      return;
    }

    this.logActivity({ type: 'silent_turn_recovered', waId, status: session.status, text: incomingText, error: failure?.message || null });

    // A partir de acá el fallo se considera atendido y NO se vuelve a lanzar:
    // ya quedó en la bitácora (`turn_error_recovering` con el error completo) y
    // en la consola, y el contacto recibió una respuesta. Propagarlo además
    // haría que el buffer lo registre una segunda vez como turno fallido.
    try {
      // El "quiero hablar con alguien" que se le sugiere es literal a propósito:
      // es una de las frases que `criticalSignal` reconoce y transfiere al toque.
      await this.send(waId, 'Se me cruzaron los cables un segundo 🙈 ¿Me repites qué día y a qué hora te viene mejor? Si prefieres, dime "quiero hablar con alguien" y te paso con una persona.');
    } catch (error) {
      // Si tampoco se puede enviar, el problema es el canal: se transfiere para
      // que un asesor lo vea en el panel en vez de perderlo en la bitácora.
      this.logActivity({ type: 'turn_recovery_send_failed', waId, error: error.message });
      await this.notifySalesperson(waId, 'El bot no pudo responderle a este lead (falló el turno y el envío de recuperación). Revisar la conversación.')
        .catch(() => {});
    }
  }

  async runConversationTurn(waId, incomingText, inboundMark = null) {
    let session = await this.getSession(waId);

    // El lead pudo graduar al Funnel de Ventas mientras este mensaje esperaba
    // en el buffer o en la cola serializada (un closer lo arrastró de columna
    // justo ahora). Mismo criterio que en handleIncomingMessage y en el mismo
    // orden: antes de cualquier otra cosa, y con la excepción de la reunión
    // próxima, que mantiene vivo el camino post-agendamiento.
    const salesLead = await this.salesFunnelLead(waId);
    if (salesLead && !(await this.hasUpcomingMeeting(waId))) {
      await this.standDownForSalesFunnel(waId, salesLead, incomingText);
      return;
    }

    // Un plantón en la reunión, una queja o un "quiero hablar con alguien" se
    // atienden antes que nada y sin importar en qué paso esté la conversación:
    // seguir con el guion (otra pregunta, otro horario) a alguien que acaba de
    // decir eso es la forma más rápida de perderlo. Sin sesión todavía no hay
    // nada que escalar — ese caso sigue el flujo normal, que la crea.
    //
    // Se exige `bot_enabled` acá y no más abajo (donde está el guard general)
    // porque esto corre ANTES del enrutado por estado: si alguien pausó el bot
    // para atender manualmente entre que el mensaje entró al buffer y que se
    // procesa este turno, el bot tiene que quedarse callado, y una señal
    // crítica no es excepción — justamente ahí ya hay una persona respondiendo.
    if (session?.bot_enabled && await this._handleCriticalSignal(waId, session, incomingText)) return;

    // Misma idea que la señal crítica, un escalón más abajo: dudar de que la
    // empresa exista no es una queja (no se escala a una persona de entrada),
    // pero tampoco puede quedar en manos de lo que improvise el LLM. Va acá,
    // ANTES del enrutado por estado, para que valga igual en la conversación
    // libre y en pleno agendamiento — que es justo donde apareció el caso
    // real ("En tu perfil dice España") y donde el paso pendiente empujaba a
    // contestar de pasada y volver al horario en la misma burbuja.
    if (session?.bot_enabled && await this._handleTrustDoubt(waId, session, incomingText)) return;

    // El estado pudo cambiar mientras este turno esperaba en la cola
    // serializada (p. ej. un turno anterior ya pasó a ofrecer agendar). En ese
    // caso no se corre otro turno de conversación libre: se redirige el
    // mensaje al handler que corresponde al estado real.
    if (session && session.status !== 'active') {
      if (SCHEDULING_STATUSES.includes(session.status)) return this.handleSchedulingTurn(waId, session, incomingText);
      if (session.status === WARMUP_STATUS) return this.handleWarmupTurn(waId, session, incomingText, { inboundMark });
      if (session.status === 'completed') {
        // Sesión cerrada pero con reunión agendada: el mensaje (ya agrupado)
        // se clasifica en vez de ignorarse. Sin reunión no se responde nada,
        // igual que antes.
        const meeting = this.scheduledMeetingService ? await this.scheduledMeetingService.getLatestForContact(waId) : null;
        if (meeting) return this.handlePostBookingMessage(waId, meeting, incomingText);
      }
      return;
    }
    if (session && !session.bot_enabled) return;

    // La despedida en plena conversación libre: acá es donde faltaba
    // comprobarla. `dispatchByStatus` ya la miraba, pero la conversación libre
    // entra por este método directo desde el buffer sin pasar por ahí, así que
    // un "buscaré en otro lado" en pleno perfilamiento no cruzaba ninguna
    // comprobación y el turno siguiente ofrecía la reunión con cinco horarios.
    // Va DESPUÉS del enrutado por estado para no gastar dos consultas al LLM
    // con el mismo mensaje (los pasos de agendamiento ya la comprueban ellos).
    if (session && await this._closedAfterRefusal(waId, incomingText)) return;

    // Marca del contador de entrantes (ver `inboundCounter`): si al final del
    // turno cambió, el contacto siguió escribiendo y este turno quedó
    // obsoleto. Normalmente llega desde el temporizador del buffer, que la
    // toma en el instante exacto en que se cierra la agrupación.
    const mark = inboundMark ?? (this.inboundCounter.get(waId) || 0);

    // OJO: "existe la fila de sesión" NO es lo mismo que "la conversación ya
    // arrancó". setBotEnabled() también puede crear esa fila (ej. al tocar
    // "Activar bot" en el panel) sin que el contacto haya escrito todavía.
    // Por eso el primer turno real se detecta con `started_at`, que solo se
    // llena aquí, y no con la sola existencia de la fila.
    const isFirstTurn = !session || !session.started_at;

    if (!session) {
      await db('whatsapp_bot_sessions').insert({ wa_id: waId, status: 'active', bot_enabled: true, answers: JSON.stringify({}), started_at: db.fn.now() });
      // El contacto pasa de "Conversación Abierta" a "En Calificación" en el
      // Setter Funnel apenas Avan arranca la conversación con él.
      await this.moveFunnelStage(waId, 'calificando');
      session = await this.getSession(waId);
    } else if (!session.started_at) {
      await this.updateSession(waId, { started_at: db.fn.now() });
      await this.moveFunnelStage(waId, 'calificando');
      session = await this.getSession(waId);
    }

    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const settings = await this.settingsService.get();
    // Acotado a mensajes desde que arrancó ESTA sesión: si el contacto ya
    // había hablado con Avan antes y alguien reinició la conversación desde
    // el panel, esa sesión (y su fecha de inicio) es nueva, así que el LLM
    // no arrastra el hilo de la conversación anterior aunque siga guardado.
    const thread = await this.whatsappMessageService.getThread(waId, { limit: 40, since: session.started_at || session.created_at });
    const history = thread
      .filter((m) => m.body && m.body.trim())
      .map((m) => ({ direction: m.direction, text: m.body }));

    const lead = await this.leadService.findByPhone(waId);
    const contactName = firstNameOf(lead?.full_name);

    // Lead que llegó del formulario de un anuncio de Meta: su primer mensaje
    // ES el resumen del formulario ("¿Pregunta?: Respuesta" línea a línea),
    // con grado académico, universidad y/o avance ya declarados. Repetirle
    // "¿sobre qué tema te gustaría hacer tu tesis?" ahí ignora lo que acaba
    // de contestar dos líneas arriba — con esos datos alcanza para ofrecerle
    // la reunión de una vez, sin gastar el turno de apertura del LLM (que por
    // diseño siempre pregunta el tema) en repetir algo del formulario.
    if (isFirstTurn) {
      const formFields = extractLeadFormFields(incomingText);
      if (isAdFormMessage(incomingText)) {
        if (formFields.level) answers.level = formFields.level;
        if (formFields.university) answers.university = formFields.university;
        if (formFields.field) answers.field = normalizeCareer(formFields.field);
        if (formFields.problem) answers.problem = formFields.problem;
        if (formFields.phone) answers.phone = formFields.phone;
        // Etapa de la tesis y servicio que busca: se guardan para no ofrecerle
        // a todo el mundo lo mismo al proponerle la reunión (ver
        // schedulingPurpose) y para que el asesor los vea en la ficha del lead.
        if (formFields.stage) answers.stage = formFields.stage;
        if (formFields.need) answers.need = formFields.need;
        if (formFields.urgency) answers.urgency = formFields.urgency;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });

        // El nombre del formulario gana sobre el del perfil de WhatsApp. El
        // formulario lo escribió el propio estudiante; el perfil es como se
        // llama el TELÉFONO, que muchas veces no es suyo (el 25/09 el bot
        // saludó "¡Hola, Areli!" a un formulario a nombre de Milciades, y
        // "¡Hola, Fabricio!" a uno de Paulo César) o ni siquiera es un nombre
        // ("La Vida Continua....", "😎").
        //
        // Antes era al revés y el comentario decía justo esto, así que el
        // código contradecía su propia intención. Acá no hay riesgo de pisar
        // una corrección de un asesor: esto es el PRIMER turno de la sesión,
        // y el nombre guardado salió del perfil al crear el lead.
        const formName = formFields.fullName || null;
        const { greetName, storeFormName } = resolveFormLeadName(formName, contactName);
        if (storeFormName && lead?.id) {
          try {
            await this.leadService.updateLead(lead.id, { fullName: formName });
          } catch (error) {
            // El saludo ya sale bien con `greetName`; que la ficha se quede
            // con el alias no justifica tumbar el turno de apertura.
            console.error(`❌ [WhatsApp Bot] No se pudo guardar el nombre del formulario de ${waId}:`, error.message);
          }
        }

        this.logActivity({ type: 'ad_form_lead_fast_track', waId, formFields });
        await this.send(waId, `¡Hola${greetName ? `, ${greetName}` : ''}! Gracias por completar el formulario 🙌`);
        return this.startWarmup(waId, answers, settings);
      }
    }

    this.logActivity({
      type: 'llm_request',
      waId,
      prompt: incomingText,
      model: this.ollamaService.chatModel,
      host: this.ollamaService.host
    });
    const startedAt = Date.now();
    const result = await this.ollamaService.converseAsAvan({
      history,
      knownAnswers: answers,
      incomingText,
      isFirstTurn,
      toneInstructions: settings.tone_instructions,
      botIdentity: settings.bot_identity,
      botObjective: settings.bot_objective,
      promptRules: settings.prompt_rules,
      knowledgeBlock: buildKnowledgeBlock(settings),
      shortReplies: settings.short_replies_enabled == null ? true : !!settings.short_replies_enabled,
      contactName
    });
    this.logActivity({
      type: 'llm_response',
      waId,
      text: result.reply,
      source: result.source,
      latencyMs: Date.now() - startedAt
    });

    // Red de seguridad contra la segunda apertura: la conversación ya estaba
    // abierta, así que un "Hola, <nombre>." al inicio de la respuesta sobra.
    if (!isFirstTurn && result.reply) result.reply = stripOpeningGreeting(result.reply);
    if (result.reply) result.reply = collapseDuplicatePreposition(result.reply);

    const extracted = result.extracted || {};

    // Red de seguridad: si este mensaje trae el patrón de un formulario de
    // Meta Ads ("¿Pregunta?: Respuesta" línea a línea), esos datos priman
    // sobre lo que el LLM haya extraído — es texto literal del formulario,
    // no algo sujeto a interpretación, y el LLM a veces lo pasa por alto.
    const formFields = extractLeadFormFields(incomingText);
    if (formFields.level) extracted.level = formFields.level;
    if (formFields.university) extracted.university = formFields.university;
    if (formFields.field) extracted.field = formFields.field;
    if (formFields.phone) extracted.phone = formFields.phone;
    // "problem" es una señal más débil (interpretación de "sin avance", no un
    // dato literal como la universidad): solo se usa si el LLM no encontró un
    // tema real en el mismo mensaje, para no pisar un tema que sí dio.
    if (formFields.problem && !extracted.problem) extracted.problem = formFields.problem;

    if (extracted.problem) answers.problem = extracted.problem;
    if (extracted.location) answers.location = extracted.location;
    if (extracted.level) answers.level = extracted.level;
    // Un valor sin sentido no se guarda ni se repite: "Perfecto: Yy" le dice
    // al contacto que nadie está leyendo lo que escribe.
    if (extracted.field && looksLikeGarbageValue(extracted.field)) {
      this.logActivity({ type: 'garbage_value_ignored', waId, campo: 'carrera', valor: extracted.field });
      delete extracted.field;
    }
    if (extracted.university && looksLikeGarbageValue(extracted.university)) {
      this.logActivity({ type: 'garbage_value_ignored', waId, campo: 'universidad', valor: extracted.university });
      delete extracted.university;
    }

    if (extracted.field) answers.field = normalizeCareer(extracted.field);
    if (extracted.university && extracted.university !== answers.university) {
      // F4 — Las siglas peruanas se confunden fácil (casos reales: "UNAC"
      // leído como "Universidad Nacional del Centro" en vez de la del Callao,
      // "Villarreal" confirmado como "San Marcos"). normalizeUniversity()
      // prioriza un catálogo cerrado y determinístico sobre cualquier
      // respuesta del LLM — solo confía en el modelo cuando el catálogo no
      // reconoce nada, y aun así valida su respuesta contra el mismo
      // catálogo antes de aceptarla como confianza alta.
      const rawUniversity = extracted.university;
      const resolved = await normalizeUniversity(rawUniversity, {
        resolveWithLLM: shouldResolveUniversity(rawUniversity)
          ? (text) => this.ollamaService.resolveUniversity(text)
          : undefined
      });
      // Confianza media/baja: no se reemplaza lo que escribió el contacto por
      // una corrección sin verificar — es preferible guardar su texto tal
      // cual que confirmar una universidad equivocada.
      answers.university = resolved.confidence === 'alta' ? resolved.name : rawUniversity;
      this.logActivity({
        type: 'university_resolved',
        waId,
        raw: rawUniversity,
        resolved: resolved.name,
        confidence: resolved.confidence,
        source: resolved.source
      });
    }
    // Se guarda solo la dirección, aunque el LLM devuelva la frase completa.
    const extractedEmail = extractEmail(extracted.email);
    if (extractedEmail) answers.email = extractedEmail;
    // Igual que el correo: si lo mencionó por su cuenta en el chat (no solo en
    // el formulario), se guarda para no volver a pedírselo al agendar.
    if (extracted.phone && looksLikePhone(extracted.phone)) answers.phone = digitsOnly(extracted.phone);

    // Lo que dijo sobre cuándo quiere la reunión ("a las 5 hoy") se guarda para
    // no volver a preguntárselo cuando toque elegir día y hora.
    if (result.preferredWhen) answers.__when = result.preferredWhen;

    const profileChanged = mergeAcademicProfile(answers, extracted);

    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    if (profileChanged) await this._syncLeadProfile(waId, answers);

    // El contacto siguió escribiendo mientras se preparaba esta respuesta: lo
    // ya extraído queda guardado (arriba), pero no se responde. El turno que
    // dispare el buffer nuevo contestará una sola vez, con todo el contexto.
    if ((this.inboundCounter.get(waId) || 0) !== mark) {
      this.logActivity({ type: 'turn_superseded', waId, text: incomingText, reply: result.reply });
      return;
    }

    // Filtro de calificación: quien no califica (ciclo bajo, carrera de
    // instituto no atendida) se cierra apenas se sabe, sin esperar a
    // completar los datos. Si Avan acababa de preguntar el dato que faltaba
    // para agendar, este mensaje es la respuesta: se retoma el agendamiento.
    if (await this._qualificationGate(waId, answers, { askMissing: false })) return;
    if (answers.__resumeFinalize) {
      delete answers.__resumeFinalize;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      return this.finalize(waId, answers);
    }

    // F1 — Ancla de precio: la primera vez que preguntan por el precio, la
    // respuesta es SIEMPRE el mismo texto determinístico (rango real por
    // nivel + "la reunión es gratis") — nunca lo redacta el LLM, porque es
    // información de negocio, no algo para parafrasear turno a turno. La
    // segunda vez, un texto DISTINTO + handoff inmediato: no se repite la
    // misma evasiva dos veces (principio de diseño no negociable).
    if (PRICE_QUESTION_RE.test(incomingText || '')) {
      answers.__priceAsks = (answers.__priceAsks || 0) + 1;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });

      if (answers.__priceAsks >= 2) {
        this.logActivity({ type: 'price_insist_shortcut', waId, priceAsks: answers.__priceAsks, hasProblem: !!answers.problem });
        await this.send(waId, whatsappBotCopy.priceInsistedHandoff());
        await this.handOffToAdvisor(waId, 'El lead insistió con el precio antes de dar su tema: se pasa a un asesor.');
        return;
      }

      await this.send(waId, whatsappBotCopy.priceAnchor(isFirstTurn ? contactName : null, meetingDurationLabel(settings)));
      return;
    }

    // Para pasar a la reunión hacen falta los tres datos: tema, carrera y
    // universidad. Cuando se cumple, NO se manda `result.reply` (el LLM a
    // veces cierra con una pregunta suelta): offerScheduling() toma el hilo.
    // Red de seguridad contra la pregunta repetida: si el LLM pidió un dato que
    // la conversación ya tiene, se cambia su respuesta por la del dato que sí
    // falta (o se pasa a agendar, si ya no falta ninguno).
    const redundantAsk = detectRedundantAsk(result.reply, answers, isFirstTurn);
    if (redundantAsk) {
      // Mismo orden que el prompt: carrera y universidad (juntas, un solo
      // turno) y después el tema, preguntado de forma fácil.
      const nextQuestion = !answers.field && !answers.university
        ? '¡Perfecto! ¿De qué carrera eres y en qué universidad estudias?'
        : (!answers.field
          ? '¡Perfecto! ¿Y de qué carrera es tu tesis?'
          : (!answers.university
            ? '¡Perfecto! ¿Y en qué universidad estudias?'
            : (!answers.problem ? '¡Perfecto! ¿Ya tienes un tema o una idea para tu tesis, o empiezas desde cero?' : null)));

      this.logActivity({
        type: 'redundant_question_fixed',
        waId,
        asked: redundantAsk,
        original: result.reply,
        replacement: nextQuestion
      });

      if (nextQuestion) result.reply = nextQuestion;
      else result.ready = true;
    }

    // Pedir la reunión gana sobre cualquier dato que falte: si el contacto ya
    // dijo que quiere agendar (o propuso un día y una hora), se pasa a
    // agendar de inmediato. Los datos que no dio se completan con los valores
    // por defecto del panel y el asesor los ve en la reunión;
    // insistir con más preguntas a alguien que ya dijo "quiero reunirme" es
    // la forma más rápida de perderlo.
    // 'both' cuando no se tiene ninguno de los dos: se piden en un solo mensaje.
    const missingAcademic = (!answers.field && !answers.university)
      ? 'both'
      : (!answers.field ? 'field' : (!answers.university ? 'university' : null));
    if (result.schedulingIntent) {
      this.logActivity({ type: 'scheduling_fast_track', waId, text: incomingText, when: answers.__when || null });
      await this.finalize(waId, answers);
    } else if (result.ready && answers.problem && !missingAcademic) {
      // Si el contacto aprovechó el mensaje que completó los datos para
      // preguntar algo ("UNMSM. ¿Cuánto dura la reunión?"), la respuesta va
      // dentro de `result.reply` y se perdería, porque offerScheduling() manda
      // su propio texto. Se envía primero, pero SOLO si de verdad preguntó
      // algo: si no, `reply` es un acuse ("Perfecto 👀") o un anuncio del tipo
      // "vamos a agendar la reunión" que duplicaría el mensaje siguiente.
      const closingNote = (result.reply || '').trim();
      const askedSomething = /[?¿]/.test(incomingText || '');
      if (askedSomething && closingNote.length > 30 && !/[?¿]/.test(closingNote)) {
        await this.send(waId, closingNote);
      }
      await this.finalize(waId, answers);
    } else if (result.ready && answers.problem && missingAcademic) {
      // El LLM quiso cerrar sin todos los datos: se pide el que falte.
      const askMissing = {
        both: 'Perfecto 🙌 Antes de coordinar la reunión: ¿de qué carrera es tu tesis y en qué universidad estudias?',
        field: 'Perfecto 🙌 Antes de coordinar la reunión, cuéntame: ¿de qué carrera es tu tesis?',
        university: 'Perfecto 🙌 Una última cosa antes de coordinar la reunión: ¿en qué universidad estudias?'
      };
      await this.send(waId, askMissing[missingAcademic]);
    } else {
      await this._sendConversationalReply(waId, result.reply, answers, history);
    }
  }

  /**
   * Envía la respuesta del turno de conversación libre, pero si es
   * prácticamente la MISMA pregunta que el bot ya mandó en su mensaje anterior
   * (el contacto respondió un ".", un "ok" o algo que no aportó), no la repite
   * palabra por palabra: manda una reformulación corta según el dato que
   * todavía falta. Recibir dos veces seguidas la misma pregunta se lee como
   * que nadie leyó lo que escribió.
   */
  async _sendConversationalReply(waId, reply, answers, history) {
    const lastBot = [...(history || [])].reverse().find((m) => m.direction === 'outbound')?.text || null;

    if (lastBot && messageSimilarity(reply, lastBot) >= 0.6) {
      const rephrase = !answers.problem
        ? 'Para seguir necesito una idea de tu tema: ¿de qué trataría tu tesis, aunque sea en una frase?'
        : (!answers.field && !answers.university
          ? 'Me falta ubicarte: ¿qué carrera llevas y en qué universidad estudias?'
          : (!answers.field
            ? '¿Qué carrera estás llevando?'
            : (!answers.university ? '¿Y en qué universidad estudias?' : null)));

      this.logActivity({ type: 'redundant_message_suppressed', waId, original: reply, previous: lastBot, replacement: rephrase });
      await this.send(waId, rephrase || reply);
      return;
    }

    await this.send(waId, reply);
  }

  /**
   * Ya con el tema de tesis en mano, el objetivo pasa a agendar la llamada
   * con el asesor: se avisa al lead que lo va a conectar, y por detrás (sin
   * anunciarlo en el chat) se evalúa la viabilidad con IA y se crea/actualiza
   * el lead en el funnel de ventas, para que llegue con puntaje al CRM y el
   * equipo tenga un reporte de respaldo. Un fallo en la evaluación con IA no
   * debe impedir ofrecer la llamada, que es lo que realmente importa aquí.
   */
  async finalize(waId, answers, { warmedUp = false, proposedSlot = null } = {}) {
    if (await this._qualificationGate(waId, answers, { askMissing: true })) return;

    const settings = await this.settingsService.get();

    // F4 — trim explícito: `problem`/`location` vienen de extracción del LLM
    // y llegaban con espacios sueltos o ya conteniendo "en ..." al final, lo
    // que combinado con la preposición fija de abajo producía artefactos
    // como "...en En minería" (bug real detectado en producción).
    const problem = (answers.problem || 'Tema de tesis por definir').trim();
    const location = (answers.location || settings.default_location || 'Perú').trim();
    const level = answers.level || settings.default_academic_level || 'Pregrado (Bachiller/Título)';
    const field = answers.field || settings.default_field_of_study || 'Ingeniería de Sistemas y Computación';
    const university = answers.university || null;
    const email = answers.email || '';

    const synthesizedTopic = collapseDuplicatePreposition(`${problem}: Caso de estudio y propuesta en ${location}`);
    const additionalNotes = `Problema: ${problem} | Ámbito: ${location}` +
      (answers.field ? ` | Carrera: ${answers.field}` : '') +
      (university ? ` | Universidad: ${university}` : '') +
      (STAGE_LABELS[answers.stage] ? ` | Etapa: ${STAGE_LABELS[answers.stage]}` : '') +
      (NEED_LABELS[answers.need] ? ` | Necesita: ${NEED_LABELS[answers.need]}` : '') +
      (URGENCY_LABELS[answers.urgency] ? ` | Urgencia: ${URGENCY_LABELS[answers.urgency]}` : '') +
      ' | Origen: WhatsApp (Avan, bot automático)';

    // Antes había aquí un mensaje intro largo ("¡Genial! Con lo que me
    // cuentas...") que además duplicaba el "dame un momento" del LLM. Se
    // eliminó: el turno ya cerró con una respuesta breve y offerScheduling()
    // hace la siguiente pregunta directamente.

    // El status NO se toca aquí a propósito: el lead se queda en
    // "calificando" (Setter Funnel) mientras se resuelve el agendamiento.
    // Solo pasa a "cita_agendada" o "transferido_closer" — y recién ahí
    // entra al Funnel de Ventas — cuando se sabe el desenlace real (ver
    // handleSchedulingTimeReply / handOffToAdvisor).
    const leadPayload = {
      topic: synthesizedTopic,
      academicLevel: level,
      fieldOfStudy: field,
      email,
      additionalNotes,
      source: 'WhatsApp Directo'
    };
    if (university) leadPayload.university = university;
    Object.assign(leadPayload, academicProfilePayload(answers));

    try {
      const reportData = await this.ollamaService.evaluateThesisViability({
        topic: synthesizedTopic,
        academicLevel: level,
        fieldOfStudy: field,
        additionalNotes
      });
      leadPayload.overallViabilityScore = reportData.evaluation.overallViabilityScore;
      leadPayload.viabilityLevel = reportData.evaluation.viabilityLevel;

      if (email) {
        const emailStatus = await this.emailService.sendReportEmail(email, reportData);
        if (!emailStatus.success) {
          console.warn(`⚠️ [WhatsApp Bot] El correo a ${email} no se pudo confirmar como enviado.`);
        }
      }
    } catch (error) {
      // La evaluación con IA es un valor agregado para el CRM, no un
      // requisito para agendar: si falla, el lead igual se registra (sin
      // puntaje) y la conversación sigue directo a proponer la llamada.
      console.error(`❌ [WhatsApp Bot] Error al evaluar la viabilidad para ${waId} (no bloquea el agendamiento):`, error);
    }

    try {
      const existingLead = await this.leadService.findByPhone(waId);
      if (existingLead) {
        await this.leadService.updateLead(existingLead.id, leadPayload);
      } else {
        await this.leadService.createLead({ ...leadPayload, phone: waId });
      }
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al registrar el lead de ${waId}:`, error);
    }

    await this.offerScheduling(waId, { topic: synthesizedTopic, email, when: answers.__when || null, warmedUp, proposedSlot });
  }

  /**
   * Texto del recordatorio de inactividad, según en qué paso se quedó callado.
   *
   * El genérico ("¿Sigues por ahí?") se sigue usando en conversación libre,
   * donde no hay nada concreto que ofrecer. Pero al lead que se quedó mudo
   * frente a la LISTA de horarios, repetírsela —o preguntarle si sigue ahí,
   * que lo deja frente a la misma lista— es insistir con lo que ya ignoró
   * una vez. El 23/09 los cuatro leads que la recibieron la ignoraron.
   *
   * A ese se le nombra UN horario y se le pide un sí: la sesión pasa a
   * `scheduling_confirm` con ese horario pendiente, así que el "sí" lo reserva
   * por el mismo camino que cualquier otra confirmación (y cualquier otra
   * respuesta se sigue tratando como corrección, no como confirmación).
   *
   * Lo mismo vale —y más— para el lead que se quedó mudo en `warmup`, frente
   * al "respóndeme *sí* y te paso los horarios": es el punto del embudo donde
   * más se pierde (el 25/09, cinco de diez leads del formulario murieron ahí
   * y ninguno contestó el genérico). Ahí no hay `__scheduling` todavía, así
   * que el horario se deja en `answers.__warmupSlot` y lo recoge
   * `handleWarmupTurn`, que lo pasa por finalize() hasta `confirmSlot`.
   *
   * Si algo falla al buscar el horario, cae al texto genérico: el recordatorio
   * ya está reservado en la fila y quedarse sin mandar nada es peor.
   */
  async _inactivityNudgeText(session, nudgesSent) {
    const generic = INACTIVITY_NUDGE_TEXTS[Math.min(nudgesSent, INACTIVITY_NUDGE_TEXTS.length - 1)];
    const isWarmup = session.status === WARMUP_STATUS;
    if (!isWarmup && !['scheduling_date', 'scheduling_time'].includes(session.status)) return generic;

    try {
      const { answers, scheduling } = this._readScheduling(session);
      // En `warmup` todavía no existe `answers.__scheduling`: el lead ni
      // siquiera dijo que quiere la reunión. Eso no lo deja fuera — es justo
      // el paso donde más se pierde.
      if (!scheduling && !isWarmup) return generic;

      const [slot] = await this.googleCalendarService.getUpcomingFreeSlots(
        BOOKING_ADVISOR_USER_ID, { limit: 1, days: BOOKING_WINDOW_DAYS }
      );
      if (!slot) return generic;

      if (isWarmup) {
        // No se puede pasar a `scheduling_confirm` sin haber pasado por
        // finalize(), que es quien registra el lead y arma `__scheduling`.
        // El horario queda anotado y `handleWarmupTurn` lo toma cuando
        // conteste que sí, para que ese sí reserve ESTE bloque y no le
        // devuelva una lista distinta de la que aceptó.
        answers.__warmupSlot = slot;
        await this.updateSession(session.wa_id, { answers: JSON.stringify(answers) });
      } else {
        scheduling.awaitingConfirm = slot;
        await this.updateSession(session.wa_id, { status: 'scheduling_confirm', answers: JSON.stringify(answers) });
      }
      this.logActivity({ type: 'inactivity_nudge_slot_offer', waId: session.wa_id, slot: slot.label, step: session.status });

      return `¿Te reservo *${slot.label}* con el asesor? Respóndeme *sí* y te llega la confirmación 🙌 ` +
        'Si te viene mejor otro día u hora, dímelo y lo busco.';
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] No se pudo armar el recordatorio con horario para ${session.wa_id}:`, error.message);
      return generic;
    }
  }

  /**
   * Borra el horario que el recordatorio iba a proponerle al lead cuando el
   * mensaje NO llegó a salir (típicamente su ventana de 24 h ya cerrada). Sin
   * esto quedaría anotado un bloque que el lead nunca vio, y un "sí" suyo más
   * tarde —contestando a la pregunta original del warmup— se lo reservaría.
   */
  async _discardProposedSlot(waId) {
    try {
      const session = await this.getSession(waId);
      if (!session) return;
      const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
      if (answers.__warmupSlot === undefined) return;
      delete answers.__warmupSlot;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] No se pudo descartar el horario propuesto a ${waId}:`, error.message);
    }
  }

  /**
   * Paso de calentamiento para el lead que llega del formulario de un anuncio:
   * en vez del menú de horarios de entrada, UNA pregunta cerrada. Los horarios
   * salen en `handleWarmupTurn`, cuando contestó. El porqué está en
   * `whatsappBotCopy.warmupAsk`.
   *
   * El filtro de calificación corre ACÁ y no solo en finalize(): si al lead
   * hay que rechazarlo (instituto, ciclo muy temprano), tiene que enterarse
   * ahora y no después de que le ofrecimos una reunión y dijo que sí. Como
   * `_qualificationGate` deja anotado lo que ya preguntó, finalize() lo vuelve
   * a llamar sin repetirle nada.
   */
  async startWarmup(waId, answers, settings = null) {
    if (await this._qualificationGate(waId, answers, { askMissing: true })) return;

    const resolved = settings || await this.settingsService.get();

    // Mismo criterio que offerScheduling(): devolverle lo que entendimos es lo
    // único que le prueba que alguien leyó su formulario. `looksLikeGarbageValue`
    // evita el "Perfecto: Yy" cuando el campo llegó con basura.
    const understood = [answers.field, answers.university]
      .filter((value) => value && !looksLikeGarbageValue(value))
      .join(' en ');
    const hasTopic = !!answers.problem && !/sin tema definido/i.test(answers.problem);
    const purpose = schedulingPurpose({ stage: answers.stage, need: answers.need, hasTopic });

    await this.updateSession(waId, { status: WARMUP_STATUS, answers: JSON.stringify(answers) });
    this.logActivity({ type: 'warmup_ask', waId });
    await this.send(waId, whatsappBotCopy.warmupAsk({
      understood,
      purpose,
      durationLabel: meetingDurationLabel(resolved)
    }));
  }

  /**
   * Respuesta del lead a la pregunta de `startWarmup`.
   *
   * Tres caminos, y el tercero es el que importa: cualquier cosa que no sea
   * un sí ni un no limpio (una pregunta, "¿cuánto cuesta?", "estoy en Cusco")
   * NO se fuerza al agendamiento — la sesión vuelve a 'active' y el turno se
   * reprocesa como conversación libre, que es la que sabe responder eso. Un
   * lead que rompió el silencio para preguntar algo y recibe un menú de
   * horarios como respuesta es exactamente el bot que este cambio quita.
   */
  async handleWarmupTurn(waId, session, incomingText, { inboundMark = null } = {}) {
    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const text = String(incomingText || '').trim();

    if (isAffirmative(text)) {
      // Si el recordatorio de inactividad le nombró un horario concreto, su
      // "sí" es a ESE horario: se agenda ese y no se le vuelve a mostrar la
      // lista (ver `_inactivityNudgeText`). Si venció mientras no respondía,
      // `usableProposedSlot` lo descarta y sigue el camino normal.
      const proposedSlot = usableProposedSlot(answers.__warmupSlot);
      delete answers.__warmupSlot;
      this.logActivity({ type: 'warmup_accepted', waId, slot: proposedSlot?.label || null });
      await this.updateSession(waId, { status: 'active', answers: JSON.stringify(answers) });
      return this.finalize(waId, answers, { warmedUp: true, proposedSlot });
    }

    if (isExplicitNo(text)) {
      delete answers.__warmupSlot;
      this.logActivity({ type: 'warmup_declined', waId });
      const lead = await this.leadService.findByPhone(waId);
      // Vuelve a conversación libre, NO a 'completed': dijo que no a la
      // reunión, no al servicio. Si después cuenta qué necesita, el flujo
      // normal puede volver a ofrecérsela.
      await this.updateSession(waId, { status: 'active', answers: JSON.stringify(answers) });
      await this.send(waId, whatsappBotCopy.warmupDeclined(firstNameOf(lead?.full_name)));
      return;
    }

    // Se va a conversación libre: el horario propuesto ya no aplica — cuando
    // vuelva a agendar se le recalculan los bloques.
    delete answers.__warmupSlot;
    await this.updateSession(waId, { status: 'active', answers: JSON.stringify(answers) });
    return this.runConversationTurn(waId, incomingText, inboundMark);
  }

  /**
   * Aplica el filtro de leadQualification.js. Si el lead no califica, se le
   * cierra con un texto fijo, la sesión termina y pasa a "No Califica" en el
   * Setter Funnel. Si falta el dato que decide (ciclo, o carrera en un
   * instituto) y `askMissing`, se pregunta UNA sola vez: si no lo contesta,
   * no se le bloquea el agendamiento por eso.
   * Devuelve true si ya respondió (el turno no debe continuar).
   */
  async _qualificationGate(waId, answers, { askMissing }) {
    const verdict = evaluateQualification(answers);

    if (verdict.status === 'rejected') {
      await this.send(waId, verdict.reason === 'low_cycle'
        ? whatsappBotCopy.lowCycleRejection()
        : whatsappBotCopy.instituteFieldRejection());
      await this.updateSession(waId, { status: 'completed', answers: JSON.stringify(answers) });
      await this._syncLeadProfile(waId, answers);
      await this.moveFunnelStage(waId, 'descartado');
      this.logActivity({ type: 'lead_disqualified', waId, reason: verdict.reason });
      return true;
    }

    const asked = answers.__qualificationAsked || [];
    if (verdict.status === 'missing' && askMissing && !asked.includes(verdict.ask)) {
      answers.__qualificationAsked = [...asked, verdict.ask];
      answers.__resumeFinalize = true;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.send(waId, verdict.ask === 'cycle' ? whatsappBotCopy.askCycle() : whatsappBotCopy.askInstituteField());
      return true;
    }

    return false;
  }

  /** Guarda en el lead la ficha académica apenas se conoce (no solo al agendar). */
  async _syncLeadProfile(waId, answers) {
    try {
      const lead = await this.leadService.findByPhone(waId);
      if (!lead) return;
      const payload = academicProfilePayload(answers);
      if (answers.field) payload.fieldOfStudy = answers.field;
      if (answers.university) payload.university = answers.university;
      await this.leadService.updateLead(lead.id, payload);
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al guardar la ficha académica de ${waId}:`, error);
    }
  }

  /**
   * Atiende las señales críticas de `leadSignals.js` (plantón en la reunión,
   * queja, pedido de hablar con una persona, frustración con el propio bot).
   *
   * Corre ANTES de cualquier otra cosa y en CUALQUIER estado de la sesión, y
   * sin pasar por el LLM: son los mensajes donde equivocarse cuesta más caro,
   * así que no se deja la respuesta a criterio del modelo — se reconoce lo que
   * la persona dijo con un texto fijo y se pasa a un asesor.
   *
   * Devuelve true si ya se atendió el mensaje (el turno no debe continuar).
   */
  /**
   * El lead pone en duda que la empresa sea real o que esté en Perú
   * ("¿no están en Perú?", "en tu perfil dice España", "no me da confianza").
   * Devuelve true si consumió el turno — quien llama no debe seguir.
   *
   * Es el mensaje que decide si el lead sigue o se va, así que se responde
   * con datos verificables y con el turno ENTERO: no se le pega el paso
   * pendiente detrás. Antes, esta duda caía en el clasificador de preguntas
   * sueltas del agendamiento y salía como `respuesta + "Volviendo a los
   * horarios: 1. 4:30..."` en la misma burbuja — el lead leyó que su duda
   * estorbaba y no volvió a escribir. El horario se vuelve a pedir solo, en
   * el turno siguiente, por el camino normal de "respondió otra cosa".
   *
   * A la segunda duda ya no se insiste con los mismos datos: si después de
   * ver el RUC y la dirección sigue dudando, lo que falta no es información
   * sino una persona.
   */
  async _handleTrustDoubt(waId, session, incomingText) {
    if (!isTrustDoubt(incomingText)) return false;

    // Un "1" o un correo suelto nunca son una duda, por más que el texto
    // rime con el patrón: si el paso actual ya puede leer el mensaje como su
    // dato, manda el paso.
    if (isObviousStepAnswer(session.status, incomingText)) return false;

    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const asked = Number(answers.__trustDoubts || 0) + 1;
    answers.__trustDoubts = asked;
    await this.updateSession(waId, { answers: JSON.stringify(answers) });

    this.logActivity({ type: 'trust_doubt', waId, text: incomingText, attempt: asked });

    if (asked >= 2) {
      await this.send(waId, whatsappBotCopy.trustDoubtHandoff());
      await this.handOffToAdvisor(waId, 'El lead sigue dudando de que la empresa sea real después de recibir el RUC y la dirección. Necesita hablar con una persona antes de avanzar.');
      return true;
    }

    await this.send(waId, whatsappBotCopy.trustCredentials());
    return true;
  }

  async _handleCriticalSignal(waId, session, incomingText) {
    const signal = criticalSignal(incomingText);
    if (!signal) return false;

    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});

    // Una misma señal no escala dos veces. Quien insiste después de que ya se
    // le transfirió está esperando a la persona, no otra respuesta del bot:
    // repetirle el acuse —y volver a avisar al equipo por cada mensaje— solo
    // agrega ruido de los dos lados. Se calla, que es lo correcto aquí.
    const escalated = answers.__signalsEscalated || [];
    if (escalated.includes(signal)) {
      this.logActivity({ type: 'critical_signal_repeated', waId, signal, text: incomingText });
      return true;
    }

    answers.__signalsEscalated = [...escalated, signal];
    await this.updateSession(waId, { answers: JSON.stringify(answers) });

    this.logActivity({ type: 'critical_signal', waId, signal, text: incomingText });
    await this.send(waId, whatsappBotCopy.criticalSignalAck(signal));
    await this.handOffToAdvisor(waId, CRITICAL_SIGNAL_REASONS[signal]);
    return true;
  }

  /**
   * Cuando no se puede ofrecer agendar (Calendar no configurado/conectado, o
   * sin bloques libres), transfiere al lead a seguimiento manual: cierra la
   * sesión del bot y mueve el lead a "Transferido a Closer" — ahí sí entra
   * al Funnel de Ventas para que un asesor lo contacte directamente.
   */
  /**
   * El lead dijo que ya no le interesa: se le agradece, la sesión queda
   * cerrada ('completed', que el barrido de inactividad ya no toca) y el lead
   * pasa a "descartado" en el funnel, igual que un lead que no califica.
   *
   * No se le transfiere a un asesor: no hay nada que atender y meterlo en la
   * cola del closer haría que alguien lo llame para insistirle.
   */
  async closeAsNotInterested(waId, text) {
    const session = await this.getSession(waId);
    const answers = typeof session?.answers === 'string' ? JSON.parse(session.answers) : (session?.answers || {});
    delete answers.__scheduling;
    answers.__closedAt = new Date().toISOString();
    answers.__closedReason = 'no_interesado';

    const lead = await this.leadService.findByPhone(waId);
    await this.send(waId, whatsappBotCopy.notInterestedFarewell(firstNameOf(lead?.full_name)));
    await this.updateSession(waId, { status: 'completed', answers: JSON.stringify(answers) });
    await this.moveFunnelStage(waId, 'descartado');
    this.logActivity({ type: 'lead_not_interested', waId, text });
  }

  async handOffToAdvisor(waId, reason) {
    this.logActivity({ type: 'scheduling_offer_skipped', waId, reason });

    // Se marca la sesión como transferida (no solo "completed", que también
    // se usa para una reunión agendada con éxito) para que el panel pueda
    // distinguir "hay que actuar ya" de "ya quedó resuelto" — ver
    // notifySalesperson() y GET /api/whatsapp/conversations.
    const session = await this.getSession(waId);
    const answers = typeof session?.answers === 'string' ? JSON.parse(session.answers) : (session?.answers || {});
    answers.__handedOffAt = new Date().toISOString();
    answers.__handedOffReason = reason || null;

    await this.updateSession(waId, { status: 'completed', answers: JSON.stringify(answers) });
    await this.moveFunnelStage(waId, 'transferido_closer');
    // "El asesor se pondrá en contacto contigo pronto" sonaba a una llamada
    // agendada a futuro, no a "dejo de responderte yo, ahora te escribe una
    // persona" — un contacto que ya venía frustrado (repitiendo lo mismo sin
    // que el bot lo resolviera) seguía pidiendo "apaga tu bot, quiero hablar
    // con alguien" justo después de este mensaje, sin darse cuenta de que ya
    // se le había transferido.
    await this.send(waId, 'Te paso con un asesor para que te ayude directamente 🙌 En breve te escribe por aquí para coordinar todo.');
    await this.notifySalesperson(waId, reason);
  }

  /**
   * Avisa al equipo que un lead se transfirió a seguimiento manual: siempre
   * queda una notificación en el panel (la campana del navbar, confiable sin
   * importar nada más), y además se intenta avisar por WhatsApp al número
   * configurado en "Configuración del bot" — ese envío puede fallar si el
   * vendedor no le escribió al número de negocio en las últimas 24h (límite
   * de WhatsApp para mensajes que el negocio inicia sin plantilla aprobada);
   * si falla, no bloquea nada, la notificación del panel ya quedó registrada.
   */
  async notifySalesperson(waId, reason) {
    let contactLabel = waId;
    try {
      const lead = await this.leadService.findByPhone(waId);
      if (lead?.full_name) contactLabel = `${lead.full_name} (${waId})`;
    } catch {
      // El nombre es solo para que la notificación sea más legible; sin
      // lead encontrado se avisa igual con el número.
    }

    const body = `🆘 Lead transferido a un asesor: ${contactLabel}.${reason ? ` Motivo: ${reason}` : ''}`;

    await this.alertInternal({
      waId,
      type: 'whatsapp_lead_handed_off',
      title: 'Lead de WhatsApp transferido a un asesor',
      body
    });
  }

  /**
   * Aviso interno al equipo. Va SIEMPRE por dos canales que no dependen de
   * WhatsApp —la campana del panel y el correo— y solo intenta WhatsApp si la
   * ventana de 24 h con el número interno está abierta.
   *
   * El motivo es un caso real: las 3 alertas "🆘 Lead transferido a un asesor"
   * se mandaron como texto libre al número interno más de 24 h después de su
   * último mensaje, WhatsApp las rechazó, y los asesores nunca se enteraron de
   * esas transferencias. Un aviso interno no puede depender de que alguien le
   * haya escrito al número de negocio en el último día.
   *
   * Nunca reintenta: si el correo falla se registra y se sigue. Reintentar en
   * cada barrido repetiría el mismo error sin que el aviso llegue antes.
   */
  async alertInternal({ waId = null, type, title, body }) {
    const link = waId ? `/admin/whatsapp?waId=${encodeURIComponent(waId)}` : '/admin/whatsapp';

    if (this.notificationService) {
      try {
        await this.notificationService.create({ type, title, body, link });
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] Error al crear la notificación interna (${type}):`, error.message);
      }
    }

    let settings = {};
    try {
      settings = await this.settingsService.get();
    } catch { /* sin settings se usan los valores del entorno */ }

    const recipient = settings.sales_notification_email || process.env.INTERNAL_ALERT_EMAIL || null;
    if (recipient && this.emailService) {
      try {
        const result = await this.emailService.sendInternalAlertEmail(recipient, {
          subject: `[Avan] ${title}`,
          title,
          bodyText: body,
          actionUrl: `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}${link}`,
          actionLabel: 'Abrir la conversación'
        });
        if (!result?.success) {
          console.error(`❌ [WhatsApp Bot] No se pudo mandar la alerta interna por correo a ${recipient}: ${result?.error}`);
        }
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] Error al mandar la alerta interna por correo a ${recipient}:`, error.message);
      }
    } else {
      console.warn(`⚠️ [WhatsApp Bot] Alerta interna sin destinatario de correo (configura sales_notification_email o INTERNAL_ALERT_EMAIL): ${title}`);
    }

    // WhatsApp es el canal de cortesía, no el que garantiza el aviso.
    const salesPhone = settings.sales_notification_phone;
    if (salesPhone) {
      try {
        if (await this.whatsappMessageService.isCustomerWindowOpen(salesPhone)) {
          await this.whatsappMessageService.sendTextMessage(salesPhone, body);
        } else {
          this.logActivity({ type: 'internal_alert_whatsapp_skipped', waId: salesPhone, reason: 'ventana de 24 h cerrada' });
        }
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] No se pudo avisar por WhatsApp al vendedor sobre ${waId}:`, error.message);
      }
    }
  }

  /**
   * Tras conocer el tema, arranca el agendamiento: valida que el calendario
   * del asesor esté disponible y le pregunta al lead la MODALIDAD de la
   * llamada (telefónica o por Google Meet, con descuento). Según lo que elija se le
   * pide su número o su correo, y recién después se pasa a elegir día y hora.
   * Si Calendar no está listo o no hay bloques libres, se transfiere a
   * seguimiento manual sin bloquear la conversación.
   */
  async offerScheduling(waId, { topic, email, when = null, warmedUp = false, proposedSlot = null }) {
    try {
      if (!this.googleCalendarService?.isConfigured()) throw new Error('Google Calendar no configurado en el servidor');

      const connection = await this.googleCalendarService.getConnection(BOOKING_ADVISOR_USER_ID);
      if (!connection) throw new Error('El asesor por defecto no tiene Google Calendar conectado');

      const preview = await this.googleCalendarService.getUpcomingFreeSlots(BOOKING_ADVISOR_USER_ID, { limit: 1, days: BOOKING_WINDOW_DAYS });
      if (preview.length === 0) throw new Error(`Sin bloques libres en los próximos ${MAX_BOOKING_DAYS_AHEAD} días`);

      const session = await this.getSession(waId);
      const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
      // Google Meet es la modalidad por defecto (con su descuento): preguntar
      // "¿telefónica o Meet?" era un paso más antes de ver horarios, y cada
      // paso extra pierde leads. Si prefiere llamada, lo pide al elegir
      // horario (ver _switchToPhoneIfAsked).
      answers.__scheduling = { topic, email: email || null, mode: 'meet', phone: answers.phone || null, discount: MEET_DISCOUNT_PCT, when: when || answers.__when || null };
      await this.updateSession(waId, { answers: JSON.stringify(answers) });

      // Devolverle lo que entendimos antes de saltar a agendar: es el único
      // momento en que puede corregirnos si interpretamos mal su carrera o su
      // universidad, y sin eso el salto de "¿en qué universidad estudias?" a
      // "coordinemos una reunión" se siente como si nadie hubiera leído nada.
      const understood = [answers.field, answers.university].filter(Boolean).join(' en ');
      const opener = understood ? `Perfecto: ${understood}. ` : '';

      // "Revisar tu tema" da a entender que ya hay uno: si el lead dijo
      // explícitamente que no tiene tema (finalize() sigue adelante igual,
      // con un placeholder, para no perderlo insistiendo), decírselo así se
      // lee como que nadie escuchó "no tengo tema" — de ahí salía el reclamo
      // repetido en plena elección de modalidad.
      //
      // Y al revés: ofrecerle "definir tu tema" a quien acaba de declarar en
      // el formulario que tiene la tesis casi terminada, o que lo que quiere
      // es levantar observaciones, se lee igual de mal. La etapa y el servicio
      // que ya dijo mandan sobre el texto genérico.
      const hasTopic = !!answers.problem && !/sin tema definido/i.test(answers.problem);
      const purpose = schedulingPurpose({ stage: answers.stage, need: answers.need, hasTopic });
      // `warmedUp`: el lead viene de contestar que sí al paso de calentamiento,
      // donde ya se le devolvió lo que entendimos y para qué es la reunión.
      // Repetírselo acá palabra por palabra sería el mismo muro de texto que
      // este cambio vino a quitar, así que solo queda lo que ahí NO se dijo:
      // la modalidad y su descuento.
      await this.send(
        waId,
        warmedUp
          ? `¡Genial! La hacemos por Google Meet, que además te da ${MEET_DISCOUNT_PCT}% de descuento sobre el precio final; si prefieres una llamada telefónica, solo dímelo 🙌`
          : `${opener}${urgencyOpener(answers.urgency)} una reunión por Google Meet con nuestro asesor para ${purpose} 🙌 ` +
            `Por Google Meet tienes ${MEET_DISCOUNT_PCT}% de descuento sobre el precio final; si prefieres una llamada telefónica, solo dímelo.`
      );
      // El lead ya aceptó un horario concreto (se lo nombró el recordatorio de
      // inactividad): mostrarle ahora la lista sería cambiarle la oferta
      // después de que dijo que sí. Su sí vale como confirmación, así que se
      // reserva directo — el paso "¿Confirmo…?" existe para cuando el horario
      // salió de una interpretación, y acá no hay ninguna.
      if (proposedSlot) return this.confirmSlot(waId, proposedSlot);
      await this.promptForDate(waId);
    } catch (error) {
      // Si la conexión de Google Calendar del asesor caducó, avisar al equipo
      // en el panel para que la reconecte — si no, todos los leads que
      // lleguen a este punto se transfieren a mano en silencio.
      if (error.code === 'GOOGLE_RECONNECT_REQUIRED' && this.notificationService) {
        try {
          await this.notificationService.create({
            type: 'google_calendar_disconnected',
            title: 'Reconecta el Google Calendar del asesor',
            body: 'Avan no pudo ofrecer agendar una llamada: la conexión de Google Calendar caducó. Reconéctala en "Disponibilidad".',
            link: '/admin/availability'
          });
        } catch (notifyError) {
          console.error('❌ [WhatsApp Bot] Error al crear la notificación de Google Calendar desconectado:', notifyError);
        }
      }
      await this.handOffToAdvisor(waId, error.message);
    }
  }

  /**
   * Describe el paso de agendamiento en curso: `question` es lo que se le
   * acaba de preguntar al contacto (contexto para el clasificador), y
   * `restate` el mensaje con el que se retoma ese paso después de haberle
   * respondido una pregunta suelta.
   */
  _describeSchedulingStep(status, scheduling = {}) {
    switch (status) {
      case 'scheduling_mode':
        return {
          question: `¿Cómo prefieres la reunión? 1. Telefónica / 2. Por Google Meet (con ${MEET_DISCOUNT_PCT}% de descuento sobre el precio final)`,
          restate: `Volviendo a lo nuestro: ¿cómo prefieres la reunión?\n\n1. Telefónica\n2. Por Google Meet (con ${MEET_DISCOUNT_PCT}% de descuento sobre el precio final)`,
          restateShort: '¿La hacemos por teléfono (*1*) o por Google Meet (*2*)?'
        };
      case 'scheduling_phone':
        return {
          question: '¿A qué número te llamamos, con código de país?',
          restate: 'Y volviendo a la llamada: ¿a qué número te marcamos? (con código de país, ej: 51987654321)',
          restateShort: '¿A qué número te marcamos?'
        };
      case 'scheduling_email':
        return {
          question: '¿A qué correo te mando la invitación al calendario?',
          restate: 'Y para mandarte la invitación al calendario, ¿a qué correo te la envío? Si prefieres, dime "no" y te dejo el link por aquí.',
          restateShort: '¿A qué correo te mando la invitación?'
        };
      case 'scheduling_date': {
        const phrase = scheduling.availableWindows || this._availableDaysPhrase(scheduling.availableDays || []) || 'los próximos días';
        return {
          question: `¿Qué día prefieres para la llamada? La agenda disponible es: ${endSentence(phrase)}`,
          restate: `Volviendo a la agenda: tenemos ${endSentence(phrase)} ¿Qué día prefieres?`,
          restateShort: '¿Qué día te viene mejor?'
        };
      }
      case 'scheduling_time': {
        const list = numberedList(slotOptionLabels(scheduling.slots));
        return {
          question: `¿Cuál de estos horarios prefieres?\n${list}`,
          restate: `Volviendo a los horarios:\n\n${list}\n\n${slotMenuFooter(scheduling.slots, scheduling.availableDays)}`,
          restateShort: '¿Con cuál de esos horarios te quedas? Responde con su número.'
        };
      }
      case 'scheduling_confirm': {
        const confirm = `¿Confirmo *${modeLabel(scheduling.mode)}*, *${scheduling.awaitingConfirm?.label}*? Responde *Sí* o dime qué cambiar 🙂`;
        return { question: confirm, restate: confirm, restateShort: confirm };
      }
      default:
        return { question: '', restate: '', restateShort: '' };
    }
  }

  /**
   * Puerta de entrada a los pasos de agendamiento. Antes de que la máquina de
   * estados intente extraer su dato, se revisa si el contacto además hizo una
   * PREGUNTA (cuánto dura la reunión, cuánto cuesta, qué incluye). Sin esto,
   * cualquier pregunta hecha durante el agendamiento se perdía en silencio —
   * o peor, se interpretaba como un dato inválido ("No parece un correo
   * válido 🤔" ante un "¿qué tiempo demora la reunión?").
   *
   * Tres desenlaces:
   *   - No hay pregunta aparte → el paso sigue exactamente como antes.
   *   - Pregunta + el dato del paso → se responde y el paso continúa.
   *   - Solo pregunta → se responde y se retoma el paso en el mismo mensaje,
   *     sin cambiar de estado ni tratar el texto como un dato inválido.
   */
  async handleSchedulingTurn(waId, session, text) {
    const { scheduling } = this._readScheduling(session);
    const trimmed = (text || '').trim();

    // Casos que la máquina de estados ya resuelve bien por sí sola: no se
    // gasta una llamada al LLM en ellos.
    // Pedir llamada en vez de Google Meet mientras elige día u horario tampoco
    // es una duda suelta: lo resuelve el paso correspondiente
    // (_switchToPhoneIfAsked). Mandarlo al clasificador de dudas es lo que
    // hacía que la modalidad se perdiera: contestaba la pregunta sin cambiarla.
    const asksPhoneCall = ['scheduling_time', 'scheduling_date'].includes(session.status) && asksForPhoneCall(trimmed);
    if (!scheduling || this._isSchedulingRefusal(trimmed) || isObviousStepAnswer(session.status, trimmed) || asksPhoneCall) {
      return this.dispatchByStatus(waId, text);
    }

    const step = this._describeSchedulingStep(session.status, scheduling);

    let aside;
    try {
      const settings = await this.settingsService.get();
      const lead = await this.leadService.findByPhone(waId);
      aside = await this.ollamaService.classifySchedulingAside(trimmed, {
        stepQuestion: step.question,
        knowledgeBlock: buildKnowledgeBlock(settings),
        contactName: firstNameOf(lead?.full_name)
      });
    } catch (error) {
      // Que falle la respuesta a una duda no puede tumbar el agendamiento.
      this.logActivity({ type: 'scheduling_aside_failed', waId, text, error: error.message });
      return this.dispatchByStatus(waId, text);
    }

    this.logActivity({
      type: 'scheduling_aside',
      waId,
      text,
      status: session.status,
      isAside: aside.isAside,
      answersStep: aside.answersStep,
      preferredWhen: aside.preferredWhen,
      answer: aside.answer,
      source: aside.source
    });

    // Pidió otro día u otra hora cuando el bloque YA estaba reservado y solo
    // faltaba su correo. Guardarlo en `when` no serviría de nada —ese dato
    // solo se lee al proponer el día, que ya pasó—, así que se reabre la
    // elección de horario aquí mismo. Hay que hacerlo también en esta rama
    // porque el clasificador a veces lee el cambio de hora como una pregunta
    // aparte, y entonces el handler del paso nunca llega a verlo.
    if (aside.preferredWhen && session.status === 'scheduling_email') {
      const { answers: live, scheduling: liveScheduling } = this._readScheduling(await this.getSession(waId));
      if (liveScheduling?.pendingSlot && await this._reopenSlotChoiceIfTimeChange(waId, live, liveScheduling, text)) return;
    }

    // El contacto puede decir cuándo quiere la reunión en cualquiera de los
    // pasos previos a elegir el día ("via meet para las 3 de la tarde hoy"):
    // se guarda para que promptForDate no se lo vuelva a preguntar. En los
    // pasos de día y hora no hace falta, porque ahí el mensaje YA es la
    // respuesta y lo interpretan sus propios handlers.
    if (aside.preferredWhen && !['scheduling_date', 'scheduling_time'].includes(session.status)) {
      const { answers } = this._readScheduling(session);
      answers.__scheduling.when = aside.preferredWhen;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      this.logActivity({ type: 'preferred_when_captured', waId, status: session.status, when: aside.preferredWhen });
    }

    if (!aside.isAside) return this.dispatchByStatus(waId, text);

    if (aside.answersStep) {
      // Respondió la pregunta Y dio el dato: se le contesta y el handler del
      // paso manda por su cuenta el siguiente mensaje del flujo.
      await this.send(waId, aside.answer);
      return this.dispatchByStatus(waId, text);
    }

    // Solo preguntó. Responder está bien, pero si ya lleva varias preguntas
    // sin elegir nada, lo que quiere es hablar con alguien: se le contesta
    // esta última y la coordinación pasa a un asesor, en vez de devolverle el
    // mismo menú una vez más.
    const { answers: current, scheduling: live } = this._readScheduling(await this.getSession(waId));

    // PRECIO durante el agendamiento: no se insiste. La primera vez se le
    // contesta y se retoma el paso; si vuelve a preguntar por el precio sin
    // elegir horario, quiere números concretos ya — se le pasa a un asesor en
    // vez de repetir "el asesor te lo detalla en la reunión" una tercera vez.
    if (live && PRICE_QUESTION_RE.test(trimmed)) {
      live.priceAsks = (live.priceAsks || 0) + 1;
      if (live.priceAsks >= 2) {
        delete current.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(current) });
        await this.send(waId, whatsappBotCopy.priceInsistedDuringScheduling());
        await this.handOffToAdvisor(waId, 'El lead insistió con el precio durante el agendamiento.');
        return;
      }
      await this.updateSession(waId, { answers: JSON.stringify(current) });
    }

    if (live) {
      live.stepTurns = (live.stepTurns || 0) + 1;
      if (live.stepTurns >= MAX_STEP_TURNS) {
        await this.send(waId, aside.answer);
        delete current.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(current) });
        await this.handOffToAdvisor(waId, 'El lead siguió preguntando sin elegir una opción del agendamiento.');
        return;
      }
    }

    // Repetir el bloque completo de opciones se lee como un contestador. La
    // lista entera solo vale la pena cuando ya no está a la vista: si el bot
    // la mandó hace un rato y el lead sigue en el mismo hilo, le basta una
    // línea (caso real: recibió los mismos 4 horarios tres veces en 25
    // minutos, porque preguntó dos cosas entremedio).
    const restated = live ? (live.restated || 0) : 0;
    const listSentAt = live?.slotsSentAt ? Date.parse(live.slotsSentAt) : 0;
    const listStillVisible = listSentAt > 0 && (Date.now() - listSentAt) < SLOT_LIST_VISIBLE_MS;
    const restate = (restated >= 1 || listStillVisible) ? (step.restateShort || step.restate) : step.restate;
    if (live) {
      live.restated = restated + 1;
      await this.updateSession(waId, { answers: JSON.stringify(current) });
    }

    await this.send(waId, restate ? `${aside.answer}\n\n${restate}` : aside.answer);
  }

  /**
   * Registra que el contacto respondió algo que NO es el dato que pide el paso
   * actual. Devuelve true si con esta ya se agotó la insistencia y la
   * conversación pasó a un asesor — quien llama debe cortar ahí sin mandar
   * nada más.
   */
  async _registerStepMiss(waId, answers, scheduling, reason) {
    scheduling.misses = (scheduling.misses || 0) + 1;
    this.logActivity({ type: 'step_miss', waId, status: reason, misses: scheduling.misses });

    if (scheduling.misses >= MAX_STEP_MISSES) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, reason);
      return true;
    }

    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    return false;
  }

  /** El paso avanzó de verdad: se reinicia todo lo que cuenta insistencia. */
  _clearStepMisses(scheduling) {
    if (!scheduling) return;
    scheduling.misses = 0;
    scheduling.stepTurns = 0;
    scheduling.restated = 0;
  }

  /** Utilidad: lee `answers.__scheduling` de la sesión (o null si no existe). */
  _readScheduling(session) {
    const answers = typeof session?.answers === 'string' ? JSON.parse(session.answers) : (session?.answers || {});
    return { answers, scheduling: answers.__scheduling || null };
  }

  /**
   * Completa los horarios de un día con los más cercanos de otros días cuando
   * ese día no da para `MIN_SLOTS_TO_OFFER`. Solo aplica si el contacto pidió
   * una hora concreta: ahí lo que quiere es "algo parecido a las 7", no "lo
   * que haya el sábado", y ofrecerle una única opción peor lo deja adivinando
   * si al día siguiente hay algo mejor. La lista final se reordena entera para
   * que el primer número siga siendo el más parecido a lo que pidió.
   */
  async _fillNearbySlots(slots, preferredTime) {
    if (!preferredTime) return slots;
    if (slots.length >= MIN_SLOTS_TO_OFFER) return orderSlotsForDisplay(slots);

    const nearby = await this.googleCalendarService.getFreeSlotsNearTime(
      BOOKING_ADVISOR_USER_ID,
      preferredTime,
      { limit: SLOTS_TO_OFFER, days: BOOKING_WINDOW_DAYS }
    );

    const merged = [...slots];
    for (const slot of nearby) {
      if (merged.length >= SLOTS_TO_OFFER) break;
      if (!merged.some((existing) => existing.startTime === slot.startTime)) merged.push(slot);
    }

    const ranked = this.googleCalendarService.rankFreeSlots(merged, preferredTime).slice(0, SLOTS_TO_OFFER);
    return orderSlotsForDisplay(ranked);
  }

  /**
   * Durante la elección de horario, el contacto puede responder con un DÍA en
   * vez de un número ("para hoy no hay?", "mejor mañana"). `parseSchedulingChoice`
   * solo entiende horas, así que eso caía en "no reconocí esa opción" y de ahí
   * al bucle. Aquí se interpreta el día y se le contesta de verdad: con los
   * horarios de ese día si los hay, o diciéndole por qué no los hay.
   * Devuelve true si ya se le respondió.
   */
  async _answerDayRequestWhileChoosing(waId, answers, scheduling, text) {
    let parsed = null;
    try {
      parsed = await this.ollamaService.parseSchedulingDate(text, limaTodayIso(), MAX_BOOKING_DAYS_AHEAD);
    } catch (error) {
      this.logActivity({ type: 'day_request_parse_failed', waId, text, error: error.message });
      return false;
    }

    const date = parsed?.date;

    // No nombró un día concreto ("otro día en las tardes", "cualquier día por
    // la mañana"), pero sí un momento — antes esto se descartaba entero por no
    // tener fecha, y la respuesta era repetir la MISMA lista del mismo día sin
    // moverse un milímetro (el "no te entendí" de siempre). "Otro día" es
    // justo lo contrario de eso: se busca en los próximos días disponibles el
    // horario más cercano a lo que pidió, en vez de insistir con el día que ya
    // rechazó.
    if (!date) {
      // Ni día ni hora, pero puede haber dicho CUÁNDO PUEDE con sus palabras
      // ("salgo de la universidad un poco tarde", "trabajo en la mañana"). Eso
      // lo interpreta el LLM contra los horarios que tiene a la vista: antes
      // caía al "No te entendí bien 🤔" con el bloque que le servía en la
      // misma lista que acababa de recibir.
      if (!parsed?.preferredTime) {
        return this._answerAvailabilityConstraint(waId, answers, scheduling, text);
      }

      const ranked = await this.googleCalendarService.getFreeSlotsNearTime(
        BOOKING_ADVISOR_USER_ID, parsed.preferredTime, { limit: SLOTS_TO_OFFER, days: BOOKING_WINDOW_DAYS }
      );
      const nearSlots = orderSlotsForDisplay(ranked);
      if (nearSlots.length === 0) {
        // Se entendió el pedido (un momento del día, sin fecha concreta) pero
        // no hay ningún bloque que se le acerque: un "no te entendí" acá
        // sería falso — el problema no es que no se haya entendido, es que no
        // hay nada que ofrecer. Igual que con `deniedDays`: si ya se le
        // explicó esto mismo una vez, la segunda vez se pasa a un asesor en
        // vez de repetir la misma negativa.
        if ((scheduling.deniedTimes || []).includes(parsed.preferredTime)) {
          delete answers.__scheduling;
          await this.updateSession(waId, { answers: JSON.stringify(answers) });
          await this.handOffToAdvisor(waId, `El lead insiste con un horario sin espacio cercano (${parsed.preferredTime}).`);
          return true;
        }
        scheduling.deniedTimes = [...(scheduling.deniedTimes || []), parsed.preferredTime];
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.send(
          waId,
          `Por ahora no tengo ningún horario libre que se acerque a eso 🙏 ¿Te sirve alguna de estas opciones, o prefieres que te contacten después?\n\n${numberedList(fullSlotLabels(scheduling.slots))}`
        );
        return true;
      }

      scheduling.slots = nearSlots;
      scheduling.attempts = 0;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.send(
        waId,
        `Estos son los horarios más cercanos a lo que buscas:\n\n${numberedList(slotOptionLabels(nearSlots))}\n\n${slotMenuFooter(nearSlots, scheduling.availableDays)}`
      );
      return true;
    }

    // Lo que se le había ofrecido antes, para saber si está repreguntando por
    // el mismo día. Se guarda ahora porque `scheduling.slots` se reemplaza más
    // abajo con la lista nueva.
    const previousSlots = scheduling.slots;

    const slots = await this.googleCalendarService.getFreeSlotsForDate(
      BOOKING_ADVISOR_USER_ID, date, { limit: SLOTS_TO_OFFER, nearTime: parsed.preferredTime }
    );

    if (slots.length > 0) {
      // Solo se busca coincidencia exacta con una hora que el contacto DIJO.
      // Con un "temprano" el parser devuelve 09:00 y encontraría el bloque de
      // las 9 en punto, pero esa hora no es suya: ni se agenda sola ni se le
      // nombra como si la hubiera pedido.
      const askedExactTime = !!(parsed.preferredTime && parsed.timePrecision === 'exact');
      const exact = askedExactTime
        ? slots.find((slot) => limaTimeOf(slot.startTime) === parsed.preferredTime)
        : null;

      // Está libre y la eligió de verdad (no vino dentro de una pregunta): se
      // agenda sin dar otra vuelta.
      if (exact && canBookExactTime(text, parsed)) {
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        this.logActivity({ type: 'exact_time_booked', waId, when: text, slot: exact.label });
        await this.bookSlot(waId, exact);
        return true;
      }

      // Se le ofreció lo que pidió: la conversación avanzó y el contador de
      // respuestas sin coincidencia vuelve a cero.
      const offered = orderSlotsForDisplay(slots);
      scheduling.slots = offered;
      scheduling.attempts = 0;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });

      // Preguntó por el mismo día que ya se le había propuesto ("¿puede ser
      // mañana?" cuando lo ofrecido era justo mañana). Repetirle la lista tal
      // cual parece que no lo leímos: primero se le contesta que sí.
      const sameDayAsOffered = (previousSlots || []).length > 0
        && (previousSlots || []).every((slot) => slot.date === date);

      // Si nombró una hora y esa no está en la lista, se dice antes de
      // enseñarle otras. Recibir horarios sin el que pediste, y sin una
      // palabra al respecto, se lee como que nadie te escuchó.
      //
      // Y si la hora SÍ está libre pero no se agendó sola (preguntó en vez de
      // elegir), se le confirma que sí la hay: aquí decirle "no tenemos
      // disponibilidad" sería directamente falso.
      let intro;
      if (exact) {
        intro = `Sí, ${dayLabelWithArticle(date)} a las ${formatClockLabel(parsed.preferredTime)} lo tenemos libre. Confírmame con el número y lo agendo:`;
      } else if (askedExactTime) {
        intro = `A las ${formatClockLabel(parsed.preferredTime)} no tenemos disponibilidad ${dayLabelWithArticle(date)}. Estos son los más cercanos:`;
      } else if (sameDayAsOffered && !parsed.preferredTime) {
        // Solo cuando preguntó por el día a secas. Si además dijo un momento
        // ("el martes temprano"), la lista que se le manda ya NO es la de
        // antes, así que "esos horarios son justo el martes" no encajaría.
        intro = `Sí, esos horarios son justo ${dayLabelWithArticle(date)}:`;
      } else {
        intro = `📅 Para ${dayLabelWithArticle(date)} tenemos:`;
      }

      await this.send(
        waId,
        `${intro}\n\n${numberedList(slotOptionLabels(offered))}\n\n` +
        slotMenuFooter(offered, scheduling.availableDays)
      );
      return true;
    }

    // Ese día no da. Si ya se le explicó una vez y vuelve a pedirlo, repetir
    // la misma negativa es el otro bucle posible: ahí lo coordina una persona.
    if ((scheduling.deniedDays || []).includes(date)) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, `El lead insiste con un día sin espacio (${date}).`);
      return true;
    }
    scheduling.deniedDays = [...(scheduling.deniedDays || []), date];

    const reason = await this._unavailableDayReason(date);

    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    await this.send(
      waId,
      `${reason} Lo más cercano que tenemos:\n\n${numberedList(fullSlotLabels(scheduling.slots))}\n\n` +
      slotMenuFooter(scheduling.slots, scheduling.availableDays)
    );
    return true;
  }

  /**
   * El contacto dijo cuándo puede, pero no con un día ni con una hora: lo dijo
   * como lo dice cualquiera —"salgo de la universidad un poco tarde",
   * "trabajo en la mañana", "después de mis clases"—. Ni
   * `parseSchedulingChoice` ni `parseSchedulingDate` devuelven nada para una
   * frase así, y hasta ahora el resultado era "No te entendí bien 🤔" con la
   * misma lista de cinco horarios repetida. El 28/09 pasó con el bloque de las
   * 6:30 p.m. dentro de esa misma lista: el lead había elegido, y dos mensajes
   * después se fue.
   *
   * Acá la restricción se la interpreta el LLM contra los horarios que el
   * contacto tiene delante (`matchSlotsToConstraint`) y se responde nombrándola:
   *
   *   - un solo horario le calza → se le propone ese y pasa a confirmar, sin
   *     hacerlo elegir de una lista de uno;
   *   - varios → se le muestran SOLO esos, no la lista entera de nuevo;
   *   - ninguno → se le dice que en ese rango no hay, que es información útil,
   *     y se le ofrece lo más cercano.
   *
   * Devuelve true si ya respondió; false si el mensaje de verdad no decía nada
   * sobre cuándo puede (ahí sí corresponde el "no te entendí" de quien llama).
   */
  async _answerAvailabilityConstraint(waId, answers, scheduling, text) {
    const offered = scheduling.slots || [];
    if (offered.length === 0) return false;

    let read;
    try {
      read = await this.ollamaService.matchSlotsToConstraint(text, offered.map((s) => s.label));
    } catch (error) {
      this.logActivity({ type: 'constraint_parse_failed', waId, text, error: error.message });
      return false;
    }

    this.logActivity({ type: 'availability_constraint', waId, text, understood: read.understood, fits: read.fits, constraint: read.constraint, source: read.source });
    if (!read.understood) return false;

    const because = read.constraint ? `Si ${read.constraint}, ` : '';

    // Ningún bloque ofrecido le sirve. Se busca en el resto de la agenda antes
    // de darle una negativa: la lista que tenía delante son solo los primeros
    // bloques, no todo lo que hay.
    if (read.fits.length === 0) {
      const fresh = await this.googleCalendarService.getUpcomingFreeSlots(
        BOOKING_ADVISOR_USER_ID, { limit: UPCOMING_SLOTS_LIMIT, days: BOOKING_WINDOW_DAYS }
      );
      const others = orderSlotsForDisplay(fresh.filter((s) => !offered.some((o) => o.startTime === s.startTime)));

      if (others.length === 0) {
        delete answers.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        // Solo el motivo: el "te paso con un asesor" lo dice `handOffToAdvisor`
        // en su propio mensaje, y repetirlo acá lo diría dos veces seguidas.
        await this.send(waId, `${because}no me queda ningún bloque que te calce 🙏`);
        await this.handOffToAdvisor(waId, `No hay bloques compatibles con la disponibilidad del lead (${read.constraint || text}).`);
        return true;
      }

      scheduling.slots = others.slice(0, SLOTS_TO_OFFER);
      scheduling.attempts = 0;
      await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
      await this.send(
        waId,
        `${because}de los que te mandé ninguno te sirve. Estos son los otros que tengo:\n\n` +
        `${numberedList(slotOptionLabels(scheduling.slots))}\n\n${slotMenuFooter(scheduling.slots, scheduling.availableDays)}`
      );
      return true;
    }

    const fitting = read.fits.map((i) => offered[i]).filter(Boolean);

    // Uno solo: se le propone directo. Pedirle que elija con un número de una
    // lista de un elemento es una vuelta de más sobre algo que ya dijo.
    if (fitting.length === 1) {
      scheduling.slots = fitting;
      scheduling.attempts = 0;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      this.logActivity({ type: 'constraint_single_match', waId, slot: fitting[0].label });
      await this.bookSlot(waId, fitting[0]);
      return true;
    }

    scheduling.slots = fitting;
    scheduling.attempts = 0;
    await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
    await this.send(
      waId,
      `${because}estos son los que te calzan:\n\n${numberedList(slotOptionLabels(fitting))}\n\n` +
      slotMenuFooter(fitting, scheduling.availableDays)
    );
    return true;
  }

  /**
   * Por qué no se puede agendar en el día que pidió el contacto. El motivo
   * importa: si el día SÍ tenía bloques y lo único que sobra es la
   * anticipación mínima, decirle "no hay agenda" suena a mentira (él sabe que
   * el asesor atiende hoy). Se distingue repitiendo la consulta sin ese
   * margen. Y un día más allá del horizonte que abrimos no es "sin espacio":
   * es agenda que todavía no existe.
   */
  async _unavailableDayReason(date) {
    const dayLabel = date === limaTodayIso() ? 'hoy' : dayLabelWithArticle(date);

    const [y, m, d] = limaTodayIso().split('-').map(Number);
    const horizon = new Date(Date.UTC(y, m - 1, d + MAX_BOOKING_DAYS_AHEAD)).toISOString().slice(0, 10);
    if (date > horizon) return `Todavía no tenemos la agenda abierta para ${dayLabel}.`;

    const withoutLeadTime = await this.googleCalendarService.getFreeSlotsForDate(
      BOOKING_ADVISOR_USER_ID, date, { limit: 1, minLeadTimeMinutes: 0 }
    );
    const hours = Math.round(MIN_BOOKING_LEAD_MINUTES / 60);

    return withoutLeadTime.length > 0
      ? `Para ${dayLabel} ya no alcanzamos: el asesor necesita al menos ${hours === 1 ? 'una hora' : `${hours} horas`} de anticipación.`
      : `Para ${dayLabel} ya no queda espacio.`;
  }

  /** Frase común que aborta el agendamiento si el lead dice "no"/"después". */
  _isSchedulingRefusal(text) {
    return ['no', 'omitir', 'despues', 'después', 'luego', 'mas tarde', 'más tarde'].includes(normalize((text || '').trim()));
  }

  /**
   * Un "no" durante el agendamiento no siempre significa lo mismo, y hasta
   * ahora los tres casos recibían el mismo texto: "Te paso con un asesor 🙌 En
   * breve te escribe por aquí". A alguien que acababa de decir que no tres
   * veces se le anunciaba que ahora lo iba a llamar una persona (caso real del
   * 28/09). Acá se separan:
   *
   *   - ya no le interesa → se cierra y no se le vuelve a escribir;
   *   - lo quiere para más adelante → se cierra amable, sin meterlo en la cola
   *     del closer para que nadie lo llame a insistirle;
   *   - quiere hablar con una persona → eso sí se transfiere.
   *
   * El "no" suelto (regex) es ambiguo por sí mismo —contestado a "¿confirmo
   * las 10?" puede ser solo ese horario—, así que se le pregunta al LLM qué
   * tipo de no es. Si no hay LLM o no lo tiene claro, se mantiene el
   * comportamiento histórico (transferir a un asesor): ahí sí hay algo que
   * coordinar y alguien lo revisa.
   */
  async _resolveRefusal(waId, text, fallbackReason) {
    const { refusing, kind, source } = await this.ollamaService.detectRefusal(text);
    this.logActivity({ type: 'refusal_resolved', waId, text, refusing, kind, source });

    if (refusing && kind === 'not_interested') return this.closeAsNotInterested(waId, text);
    if (refusing && kind === 'postpone') return this.closeAsPostponed(waId, text);
    return this.handOffToAdvisor(waId, fallbackReason);
  }

  /**
   * ¿El contacto se está despidiendo? Si sí, se cierra la conversación acá y
   * el turno no sigue.
   *
   * Es la compuerta que faltaba: `offerScheduling()` se llama en cuanto el
   * perfil está completo, sin mirar si la persona todavía quiere algo, así que
   * el 28/09 un lead escribió "Buscaré en otro lado gracias igual" y el
   * siguiente mensaje del bot fue "Coordinemos una reunión" con cinco
   * horarios; después "Ya le comenté que no" recibió "No te entendí bien 🤔"
   * con la misma lista, y el "No" final terminó en "te paso con un asesor".
   * Tres insistencias sobre un rechazo explícito — además del lead, es lo que
   * baja la calificación de calidad del número en WhatsApp Business.
   *
   * Dos pasadas, de lo barato a lo caro: el regex estricto de siempre
   * (`saysNotInterested`) cierra sin consultar nada; si no coincide pero el
   * mensaje huele a despedida (`mayBeRefusal`), lo decide el LLM. Un mensaje
   * que no dispara ninguno de los dos no gasta ninguna llamada.
   * Devuelve true si ya cerró (el turno no debe continuar).
   */
  async _closedAfterRefusal(waId, text) {
    // "No quiero hablar con un bot" y "no quiero que me atienda una máquina"
    // los reconocen LOS DOS regex: el de pedir una persona y el de desinterés
    // (por el "no quiero"). Pedir una persona gana. En la conversación libre el
    // orden ya lo resolvía `_handleCriticalSignal`, que corre antes, pero
    // `dispatchByStatus` llega acá sin pasar por él: sin este desempate, a
    // alguien que pide un humano se le cerraba la conversación.
    if (criticalSignal(text) === 'humanRequest') {
      await this.handOffToAdvisor(waId, 'El lead pidió hablar con una persona.');
      return true;
    }

    if (saysNotInterested(text)) {
      await this.closeAsNotInterested(waId, text);
      return true;
    }

    if (!mayBeRefusal(text)) return false;

    const { refusing, kind, source } = await this.ollamaService.detectRefusal(text);
    this.logActivity({ type: 'refusal_checked', waId, text, refusing, kind, source });
    if (!refusing) return false;

    // "Quiero hablar con una persona" no es un rechazo: se transfiere, que es
    // exactamente lo que pidió.
    if (kind === 'wants_human') {
      await this.handOffToAdvisor(waId, 'El lead pidió hablar con una persona.');
      return true;
    }

    if (kind === 'postpone') await this.closeAsPostponed(waId, text);
    else await this.closeAsNotInterested(waId, text);
    return true;
  }

  /**
   * El lead quiere la asesoría pero no ahora ("el próximo ciclo", "cuando
   * junte el dinero"). Se cierra la sesión igual que con `closeAsNotInterested`
   * —para que el barrido de inactividad no le escriba— pero el lead NO pasa a
   * "descartado": queda donde está, con la nota de que lo retoma después, para
   * que el equipo pueda buscarlo más adelante sin que nadie lo llame hoy.
   */
  async closeAsPostponed(waId, text) {
    const session = await this.getSession(waId);
    const answers = typeof session?.answers === 'string' ? JSON.parse(session.answers) : (session?.answers || {});
    delete answers.__scheduling;
    answers.__closedAt = new Date().toISOString();
    answers.__closedReason = 'pospuesto';

    const lead = await this.leadService.findByPhone(waId);
    await this.send(waId, whatsappBotCopy.postponedFarewell(firstNameOf(lead?.full_name)));
    await this.updateSession(waId, { status: 'completed', answers: JSON.stringify(answers) });
    this.logActivity({ type: 'lead_postponed', waId, text });
  }

  /**
   * Rescata el bloque que se le propuso en el turno anterior cuando su "sí"
   * llegó tarde, en su propia burbuja. Pasa cuando el contacto parte la
   * respuesta ("Si esta bien.." / "Me envía enlace por acá") y cada pedazo
   * abre su propio turno: el primero suelta el bloque y el segundo llegaba a
   * un paso que ya no sabía de qué horario le estaban hablando. Sin esto la
   * reunión se perdía y había que agendar de cero.
   *
   * Solo se usa con una afirmación clara y mientras el bloque siga vigente
   * (`usableProposedSlot` descarta el que ya pasó de hora).
   * Devuelve true si ya reservó.
   */
  async _bookLastProposedIfAffirmative(waId, answers, scheduling, text) {
    const slot = usableProposedSlot(scheduling.lastProposed);
    if (!slot || !isAffirmative(text)) return false;

    delete scheduling.lastProposed;
    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    this.logActivity({ type: 'late_confirmation_recovered', waId, slot: slot.label, text });
    await this.confirmSlot(waId, slot);
    return true;
  }

  /**
   * Pasa al paso de agendamiento consultando la disponibilidad REAL del
   * asesor. Si solo hay un día con espacio, ofrece los horarios de ese día.
   * Si hay varios, ofrece horarios concretos repartidos entre los próximos
   * días (sin preguntar primero el día): el lead elige con un número o pide
   * otro día/hora.
   */
  async promptForDate(waId) {
    const upcoming = await this.googleCalendarService.getUpcomingFreeSlots(BOOKING_ADVISOR_USER_ID, { limit: UPCOMING_SLOTS_LIMIT, days: BOOKING_WINDOW_DAYS });
    const days = [...new Set(upcoming.map((s) => s.date))].sort();

    const { answers, scheduling } = this._readScheduling(await this.getSession(waId));

    if (days.length === 0) {
      // Entre la comprobación de offerScheduling y este punto se ocupó la
      // última franja: se transfiere a un asesor en vez de dejarlo colgado.
      if (scheduling) delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, 'Sin bloques libres al momento de proponer el día.');
      return;
    }

    if (scheduling) scheduling.availableDays = days;

    // Explicación de por qué no se puede el día que pidió, cuando pidió uno
    // que ya no tiene agenda. Se declara aquí porque los mensajes que la
    // llevan delante también son los de más abajo, si el atajo no aplica.
    let droppedDayNotice = '';

    // El contacto ya dijo cuándo quiere la reunión durante la conversación
    // ("¿puedo tener la reunión a las 5 hoy?"). Volver a preguntarle el día
    // después de eso es lo que más molesta: se interpreta lo que dijo y, si
    // ese día tiene espacio, se salta directo a los horarios más cercanos a
    // la hora que pidió. Se consume una sola vez.
    if (scheduling?.when) {
      const requested = scheduling.when;
      delete scheduling.when;
      try {
        const parsed = await this.ollamaService.parseSchedulingDate(requested, limaTodayIso(), MAX_BOOKING_DAYS_AHEAD);
        const { date, preferredTime } = parsed;

        // Puede haber dicho el día ("hoy a las 5"), solo la hora ("a las 5
        // porfa") o solo el día. Si solo dijo la hora, se asume el primer día
        // con agenda —hoy, si tiene espacio—, que es lo que espera alguien
        // que pide una reunión "a las 5" sin más.
        const explicitDate = date && days.includes(date) ? date : null;

        // Nombró un día que ya no tiene agenda — el caso típico es pedir
        // "hoy" a última hora. Antes se caía en silencio al primer día libre
        // y el contacto recibía horarios de otro día sin una sola palabra
        // sobre el que había pedido: se guarda para decírselo.
        const droppedDate = date && !explicitDate ? date : null;
        droppedDayNotice = droppedDate ? await this._unavailableDayReason(droppedDate) : '';

        const targetDate = explicitDate || (preferredTime ? days[0] : null);

        if (targetDate) {
          const daySlots = await this.googleCalendarService.getFreeSlotsForDate(BOOKING_ADVISOR_USER_ID, targetDate, { limit: SLOTS_TO_OFFER, nearTime: preferredTime });
          if (daySlots.length > 0) {
            // Solo se le puede afirmar o negar una hora que él haya dicho: la
            // que el parser dedujo de un "temprano" no es suya.
            const askedExactTime = !!(preferredTime && parsed.timePrecision === 'exact');
            const exact = askedExactTime
              ? daySlots.find((slot) => limaTimeOf(slot.startTime) === preferredTime)
              : null;

            // La hora exacta que ELIGIÓ está libre: no tiene sentido ofrecerle
            // una lista para que vuelva a elegir lo que ya eligió. Se agenda.
            // `droppedDate` lo bloquea porque ahí la coincidencia es en OTRO
            // día que el contacto nunca nombró: cerrarle eso solo sería
            // agendarle una reunión el día equivocado.
            if (exact && !droppedDate && canBookExactTime(requested, parsed)) {
              await this.updateSession(waId, { answers: JSON.stringify(answers) });
              this.logActivity({ type: 'exact_time_booked', waId, when: requested, slot: exact.label });
              await this.bookSlot(waId, exact);
              return;
            }

            const slots = await this._fillNearbySlots(daySlots, preferredTime);
            // Si la lista terminó mezclando días, cada opción ya lleva su
            // fecha y nombrar un solo día en la entradilla confundiría.
            const spansDays = new Set(slots.map((slot) => slot.date)).size > 1;

            let intro;
            if (droppedDayNotice) {
              intro = exact
                ? `${droppedDayNotice} ${capitalizeFirst(dayLabelWithArticle(targetDate))} a las ${formatClockLabel(preferredTime)} sí lo tenemos libre. Confírmame con el número y lo agendo:`
                : `${droppedDayNotice} ${askedExactTime ? `Estos son los más cercanos a las ${formatClockLabel(preferredTime)}:` : 'Lo más cercano que tenemos:'}`;
            } else if (exact) {
              // Está libre, pero no se agendó sola (preguntó en vez de
              // elegir): se le confirma que sí la hay. Decirle aquí "no
              // tenemos disponibilidad" sería directamente falso.
              intro = `${capitalizeFirst(dayLabelWithArticle(targetDate))} a las ${formatClockLabel(preferredTime)} sí lo tenemos libre. Confírmame con el número y lo agendo:`;
            } else if (!askedExactTime) {
              intro = `📅 Perfecto, para ${dayLabelWithArticle(targetDate)} hay estos horarios:`;
            } else if (explicitDate) {
              intro = `A las ${formatClockLabel(preferredTime)} no tenemos disponibilidad ${dayLabelWithArticle(targetDate)}. Estos son los más cercanos:`;
            } else if (spansDays) {
              // Solo dijo la hora y la lista salió de varios días: cada opción
              // lleva su fecha, así que nombrar un día aquí sobra.
              intro = `A las ${formatClockLabel(preferredTime)} no tenemos disponibilidad. Estos son los más cercanos:`;
            } else {
              intro = `A las ${formatClockLabel(preferredTime)} no tenemos disponibilidad. Lo más cercano para ${dayLabelWithArticle(targetDate)}:`;
            }

            scheduling.slots = slots;
            await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
            // Con un "para hoy ya no alcanzamos" delante, las opciones llevan
            // su fecha: si no, el contacto que pidió hoy ve "5:30 p.m." y no
            // tiene forma de saber que es de otro día.
            const labels = droppedDayNotice ? fullSlotLabels(slots) : slotOptionLabels(slots);
            await this.send(
              waId,
              `${intro}\n\n${numberedList(labels)}\n\n` +
              slotMenuFooter(slots, days)
            );
            return;
          }
        }
      } catch (error) {
        // Si no se pudo interpretar, se sigue por el camino normal.
        this.logActivity({ type: 'preferred_when_failed', waId, when: requested, error: error.message });
      }
    }

    // Un solo día disponible → sin rodeos: se muestran los horarios de una vez.
    if (days.length === 1) {
      const day = days[0];
      const slots = upcoming.filter((s) => s.date === day).slice(0, SLOTS_TO_OFFER);
      if (scheduling) {
        scheduling.slots = slots;
        scheduling.slotsSentAt = new Date().toISOString();
      }
      await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
      await this.send(
        waId,
        (droppedDayNotice
          ? `${droppedDayNotice} Tenemos agenda para ${dayLabelWithArticle(day)}. Estos son los horarios:\n\n`
          : `📅 Tenemos agenda para ${dayLabelWithArticle(day)}. Estos son los horarios:\n\n`) +
        `${numberedList(slotOptionLabels(slots))}\n\n` +
        slotMenuFooter(slots, days)
      );
      return;
    }

    // Varios días → horarios CONCRETOS, repartidos entre los días más
    // próximos, en vez de preguntar el día y describir franjas ("varios
    // horarios libres entre las 10 y las 7"): con horas exactas a la vista se
    // elige con un número. Si ninguna le sirve, puede pedir otro día u hora y
    // el paso de elección de horario lo resuelve (_answerDayRequestWhileChoosing).
    const offer = spreadSlotsAcrossDays(upcoming, FIRST_OFFER_SLOTS, FIRST_OFFER_MAX_PER_DAY);
    if (scheduling) {
      scheduling.slots = offer;
      scheduling.slotsSentAt = new Date().toISOString();
    }
    const lastDay = days[days.length - 1];
    await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
    await this.send(
      waId,
      (droppedDayNotice ? `${droppedDayNotice} ` : '📅 ') +
      `Estos son los próximos horarios libres para tu reunión con el asesor:

${numberedList(fullSlotLabels(offer))}

` +
      `Responde con el número que prefieras. Si ninguno te acomoda, dime qué día y hora te vienen mejor (tenemos agenda hasta ${dayLabelWithArticle(lastDay)}).`
    );
  }

  /**
   * Elección de modalidad: 1 = telefónica, 2 = por Meet (con descuento). Si
   * elige telefónica y no tenemos su número (contacto identificado solo por
   * BSUID de Instagram/Facebook), se le pide. Si elige Meet y no dio su
   * correo, se le pide.
   */
  async handleSchedulingModeReply(waId, session, text) {
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    if (this._isSchedulingRefusal(text)) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, 'El lead prefirió no agendar.');
      return;
    }

    const mode = parseCallMode(text);
    if (!mode) {
      // Se pregunta de nuevo UNA vez; a la siguiente lo coordina una persona.
      // Repetir el mismo "responde 1 o 2" ante un emoji o una despedida es el
      // bucle que hace que el contacto deje de responder.
      if (await this._registerStepMiss(waId, answers, scheduling, 'El lead no eligió modalidad de reunión.')) return;
      await this.send(waId, `Responde *1* para llamada telefónica, o *2* para Google Meet (con ${MEET_DISCOUNT_PCT}% de descuento).`);
      return;
    }

    this._clearStepMisses(scheduling);
    scheduling.mode = mode;
    scheduling.discount = mode === 'meet' ? MEET_DISCOUNT_PCT : 0;

    if (mode === 'phone') {
      // Ya se tiene un número usable sin preguntar: el wa_id es un teléfono
      // real, o ya lo dejó antes en el formulario del anuncio o en el chat
      // (ver extractLeadFormFields / extracted.phone más arriba). Pedirlo de
      // nuevo cuando ya está delante es la pregunta redundante que más nota
      // el lead — se siente como si nadie hubiera leído el formulario.
      const knownPhone = waIdIsPhone(waId) ? digitsOnly(waId) : scheduling.phone;
      if (knownPhone) {
        scheduling.phone = knownPhone;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.promptForDate(waId);
      } else {
        await this.updateSession(waId, { status: 'scheduling_phone', answers: JSON.stringify(answers) });
        await this.send(waId, 'Perfecto 📞 ¿A qué número te llamamos? (con código de país, ej: 51987654321)');
      }
      return;
    }

    // mode === 'meet'. El correo ya NO se pide aquí: escribirlo es lo más caro
    // de todo el flujo en un celular, y pedirlo antes de saber si hay un
    // horario que le sirva es cobrar la fricción por adelantado. Se pide al
    // final, cuando ya eligió su horario (ver `bookSlot`).
    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    await this.promptForDate(waId);
  }

  /**
   * El contacto pidió otro día u otra hora en un paso que le está pidiendo un
   * dato de contacto (su correo o su teléfono). Sin esto, "pero a las 11 puede
   * ser?" caía en la validación del correo y salía "No parece un correo
   * válido 🤔": el lead se quedaba sin ninguna forma de corregir el horario
   * que el bot acababa de fijar, y a los dos intentos se le agendaba igual el
   * horario que estaba tratando de cambiar.
   *
   * Devuelve true si se reabrió la elección de horario (y ya se le respondió).
   */
  async _reopenSlotChoiceIfTimeChange(waId, answers, scheduling, text) {
    const trimmed = (text || '').trim();
    // Filtro barato: solo se gasta una llamada al LLM si el texto huele a
    // día u hora. Un correo mal escrito o un número incompleto no la gastan.
    if (!SCHEDULE_CHANGE_HINT_RE.test(trimmed)) return false;

    let parsed = null;
    try {
      parsed = await this.ollamaService.parseSchedulingDate(trimmed, limaTodayIso(), MAX_BOOKING_DAYS_AHEAD);
    } catch (error) {
      this.logActivity({ type: 'time_change_parse_failed', waId, text: trimmed, error: error.message });
      return false;
    }
    if (!parsed || parsed.declined || (!parsed.date && !parsed.preferredTime)) return false;

    // Nombró un día → los horarios de ese día; solo una hora → los más
    // cercanos a esa hora en toda la ventana de agenda.
    let slots = parsed.date
      ? await this.googleCalendarService.getFreeSlotsForDate(
        BOOKING_ADVISOR_USER_ID, parsed.date, { limit: SLOTS_TO_OFFER, nearTime: parsed.preferredTime }
      )
      : await this.googleCalendarService.getFreeSlotsNearTime(
        BOOKING_ADVISOR_USER_ID, parsed.preferredTime, { limit: SLOTS_TO_OFFER, days: BOOKING_WINDOW_DAYS }
      );

    let notice = '';
    if (slots.length === 0) {
      // Lo que pidió no existe, pero la intención de cambiar sí es real: se le
      // explica y se le ofrece lo que sí hay, en vez de devolverlo al paso del
      // correo como si no hubiera dicho nada.
      notice = parsed.date ? `${await this._unavailableDayReason(parsed.date)} ` : 'Para esa hora ya no nos queda agenda. ';
      slots = await this.googleCalendarService.getUpcomingFreeSlots(
        BOOKING_ADVISOR_USER_ID, { limit: SLOTS_TO_OFFER, days: BOOKING_WINDOW_DAYS }
      );
      if (slots.length === 0) {
        delete answers.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.handOffToAdvisor(waId, 'El lead quiso cambiar de horario y ya no quedan bloques libres.');
        return true;
      }
    }

    // El bloque que se había reservado deja de valer: si no se borra, el paso
    // del correo lo agendaría igual en cuanto reciba cualquier respuesta.
    delete scheduling.pendingSlot;
    scheduling.slots = orderSlotsForDisplay(slots);
    this._clearStepMisses(scheduling);

    await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
    this.logActivity({ type: 'slot_choice_reopened', waId, text: trimmed, date: parsed.date, time: parsed.preferredTime });

    // Igual que arriba: si delante va un "ese día ya no se puede", las
    // opciones tienen que llevar su fecha para que se entiendan.
    const labels = notice ? fullSlotLabels(scheduling.slots) : slotOptionLabels(scheduling.slots);
    await this.send(
      waId,
      `${notice}Sin problema, cambiamos el horario 👍\n\n${numberedList(labels)}\n\n` +
      slotMenuFooter(scheduling.slots, scheduling.availableDays)
    );
    return true;
  }

  /** Captura el número de teléfono para la llamada telefónica. */
  async handleSchedulingPhoneReply(waId, session, text) {
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    if (this._isSchedulingRefusal(text)) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, 'El lead no quiso dejar su número.');
      return;
    }

    // "a este número": lo llaman al mismo del que escribe. Se toma el wa_id
    // en vez de insistir con una pregunta que el contacto ya dio por resuelta.
    if (!looksLikePhone(text) && wantsThisNumber(text) && waIdIsPhone(waId)) {
      this._clearStepMisses(scheduling);
      scheduling.phone = digitsOnly(waId);
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      if (await this._confirmPendingSlotIfAny(waId, answers, scheduling)) return;
      await this.promptForDate(waId);
      return;
    }

    if (!looksLikePhone(text)) {
      // Antes de tratarlo como un número inválido: puede estar cambiando el
      // día o la hora, no dándonos un teléfono.
      if (await this._reopenSlotChoiceIfTimeChange(waId, answers, scheduling, text)) return;
      if (await this._registerStepMiss(waId, answers, scheduling, 'El lead no dejó un número de contacto válido.')) return;
      await this.send(waId, 'No reconocí el número 🤔 Pásamelo con el código de país (ej: 51987654321). Si querías cambiar el horario, dime el día o la hora que prefieres.');
      return;
    }

    this._clearStepMisses(scheduling);
    scheduling.phone = digitsOnly(text);
    answers.phone = scheduling.phone;
    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    // Si el número era lo único que faltaba para cerrar un horario ya elegido,
    // se confirma ese mismo en vez de devolverlo a elegir día otra vez.
    if (await this._confirmPendingSlotIfAny(waId, answers, scheduling)) return;
    await this.promptForDate(waId);
  }

  /**
   * Cierra el agendamiento con el horario que había quedado reservado a la
   * espera de un dato (hoy, el teléfono). Devuelve true si confirmó.
   */
  async _confirmPendingSlotIfAny(waId, answers, scheduling) {
    const pendingSlot = scheduling.pendingSlot;
    if (!pendingSlot) return false;
    delete scheduling.pendingSlot;
    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    await this.confirmSlot(waId, pendingSlot);
    return true;
  }

  /** Captura el correo para enviar el link de Google Meet. */
  async handleSchedulingEmailReply(waId, session, text) {
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    const trimmed = (text || '').trim();
    const foundEmail = extractEmail(trimmed);

    if (foundEmail) {
      scheduling.email = foundEmail;
      this._clearStepMisses(scheduling);
    } else if (this._isSchedulingRefusal(trimmed) || normalize(trimmed).includes('no tengo') || wantsLinkHere(trimmed)) {
      // Sigue sin correo (dijo "no", "no tengo", o "mándamelo por aquí"): el
      // link de Google Meet se le manda por acá mismo. Se marca para no volver
      // a pedírselo si vuelve a pasar por este paso.
      scheduling.emailSkipped = true;
    } else {
      // Antes de tratarlo como un correo inválido: puede estar cambiando el
      // día o la hora ("pero a las 11 puede ser?"), que es justo el mensaje
      // que aquí se leía como un correo mal escrito.
      if (await this._reopenSlotChoiceIfTimeChange(waId, answers, scheduling, trimmed)) return;

      // No es un correo y no es un cambio de horario. Antes se le respondía
      // "No parece un correo válido 🤔" y se le volvía a pedir: respuestas
      // como "Voy", "Este medio" o "Perdón, pensé que era de noche" chocaban
      // contra ese muro y la conversación se trababa ahí.
      //
      // El correo es un extra —sirve para mandarle la invitación del
      // calendario—, no un requisito para tener la reunión. Así que no se
      // pregunta dos veces: se sigue sin él y el link va por WhatsApp.
      this.logActivity({ type: 'email_skipped_not_an_email', waId, text: trimmed });
      scheduling.emailSkipped = true;
    }

    // Con el horario ya elegido, este era el último dato: se agenda. El
    // `else` cubre las sesiones que venían del orden anterior (correo antes
    // del día) y que siguen vivas en la base cuando se despliega este cambio.
    const pendingSlot = scheduling.pendingSlot;
    if (pendingSlot) {
      delete scheduling.pendingSlot;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.confirmSlot(waId, pendingSlot);
      return;
    }

    await this.updateSession(waId, { answers: JSON.stringify(answers) });
    await this.promptForDate(waId);
  }

  /** Frase legible con los días que sí tienen espacio (ej. "hoy y el viernes 28"). */
  _availableDaysPhrase(days) {
    const labels = (days || []).map(formatShortDayLabel);
    if (labels.length === 0) return '';
    if (labels.length === 1) return labels[0];
    return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
  }

  /**
   * Interpreta con IA qué día pidió el lead. Solo se agenda en un día que de
   * verdad tenga espacio libre (los que se le nombraron al proponerle elegir);
   * si pide otro, se le recuerdan los días disponibles reales.
   */
  async handleSchedulingDateReply(waId, session, text) {
    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const scheduling = answers.__scheduling;
    if (!scheduling) {
      await this.updateSession(waId, { status: 'completed' });
      return;
    }

    const trimmed = (text || '').trim();
    if (['no', 'omitir', 'despues', 'después'].includes(normalize(trimmed))) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this._resolveRefusal(waId, trimmed, 'El lead prefirió no agendar.');
      return;
    }

    // Su "sí" al último horario propuesto pudo llegar en una burbuja aparte y
    // caer acá. Se reserva ese bloque antes de tratarlo como una elección de
    // día nueva: es la reunión que ya había aceptado.
    if (await this._bookLastProposedIfAffirmative(waId, answers, scheduling, trimmed)) return;

    // Pedir la llamada telefónica mientras elige el día es tan válido como
    // pedirla al elegir la hora: si solo se atiende en el paso de horario, el
    // que la pide antes se queda con la modalidad por defecto (Meet).
    if (await this._switchToPhoneIfAsked(waId, answers, scheduling, trimmed)) return;

    const todayIso = limaTodayIso();

    // Días con espacio real. Se recalculan siempre (pudo cambiar la agenda) y
    // se guardan para no volver a consultar en cada intento.
    let availableDays = scheduling.availableDays;
    if (!availableDays || availableDays.length === 0) {
      const upcoming = await this.googleCalendarService.getUpcomingFreeSlots(BOOKING_ADVISOR_USER_ID, { limit: UPCOMING_SLOTS_LIMIT, days: BOOKING_WINDOW_DAYS });
      availableDays = [...new Set(upcoming.map((s) => s.date))].sort();
      scheduling.availableDays = availableDays;
    }

    if (availableDays.length === 0) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, 'Sin bloques libres al procesar la fecha elegida.');
      return;
    }

    const daysPhrase = scheduling.availableWindows || this._availableDaysPhrase(availableDays);
    // `preferredTime` recoge la hora que el lead dijo junto con el día ("hoy
    // a las 6 pm"). Antes se descartaba y se le ofrecían siempre los primeros
    // bloques del día, aunque la hora que pidió estuviera libre.
    const parsedDate = await this.ollamaService.parseSchedulingDate(trimmed, todayIso, MAX_BOOKING_DAYS_AHEAD);
    const { declined, preferredTime, timePrecision } = parsedDate;
    let { date } = parsedDate;

    // El lead está posponiendo/declinando (ej. "mañana le escribo"), no
    // eligiendo un día: aunque mencione una palabra de fecha, insistir con
    // horarios ahí ignora que se está despidiendo.
    if (declined) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, 'El lead prefirió posponer el agendamiento.');
      return;
    }

    // Respondió SOLO con una hora, sin nombrar día. No es que no se entienda:
    // acaba de escuchar "hoy de 3:30 p.m. a 6:00 p.m." y para él el día va
    // implícito en la hora. Se asume el más próximo que tenga esa hora libre
    // —hoy, si la tiene—, igual que cuando la hora llega antes de proponerle
    // los días; la confirmación nombra la fecha completa, así que si se
    // refería a otro día lo ve ahí mismo y lo corrige.
    if (!date && preferredTime) {
      const freeSlots = await this.googleCalendarService.getUpcomingFreeSlots(BOOKING_ADVISOR_USER_ID, { limit: UPCOMING_SLOTS_LIMIT, days: BOOKING_WINDOW_DAYS });
      availableDays = [...new Set(freeSlots.map((s) => s.date))].sort();
      scheduling.availableDays = availableDays;

      if (availableDays.length === 0) {
        delete answers.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.handOffToAdvisor(waId, 'Sin bloques libres al interpretar la hora que pidió el lead.');
        return;
      }

      // Sin día, manda el calendario: el primero que tenga esa hora libre. Si
      // no la tiene ninguno se cae al primer día con agenda, para responderle
      // "a esa hora no tenemos, estos son los más cercanos" en vez de un "no
      // identifiqué el día" que ignora lo que pidió.
      const candidateDays = daysMatchingPreferredTime(freeSlots, preferredTime, timePrecision);
      date = candidateDays[0] || availableDays[0];
    }

    if (!date) {
      // Antes de admitir que no se entendió: pudo decir cuándo puede con sus
      // palabras ("salgo tarde de la universidad") en vez de nombrar un día.
      if (await this._answerAvailabilityConstraint(waId, answers, scheduling, trimmed)) return;
      if (await this._registerStepMiss(waId, answers, scheduling, 'No se logró identificar el día que quería el lead.')) return;
      await this.send(waId, `No identifiqué el día 🤔 Tenemos agenda ${endSentence(daysPhrase)} ¿Cuál prefieres?`);
      return;
    }

    if (!availableDays.includes(date)) {
      if (await this._registerStepMiss(waId, answers, scheduling, 'El lead insistió con días en los que no hay agenda.')) return;
      await this.send(waId, `Ese día no hay agenda. Tenemos ${endSentence(daysPhrase)} ¿Cuál te viene bien?`);
      return;
    }

    this._clearStepMisses(scheduling);

    const daySlots = await this.googleCalendarService.getFreeSlotsForDate(BOOKING_ADVISOR_USER_ID, date, { limit: SLOTS_TO_OFFER, nearTime: preferredTime });
    if (daySlots.length === 0) {
      // Se ocupó la última franja de ese día entre que se propuso y ahora.
      const fresh = await this.googleCalendarService.getUpcomingFreeSlots(BOOKING_ADVISOR_USER_ID, { limit: UPCOMING_SLOTS_LIMIT, days: BOOKING_WINDOW_DAYS });
      scheduling.availableDays = [...new Set(fresh.map((s) => s.date))].sort();
      delete scheduling.availableWindows;
      if (scheduling.availableDays.length === 0) {
        delete answers.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.handOffToAdvisor(waId, 'Sin bloques libres tras pedirle una fecha al lead.');
        return;
      }
      await this.updateSession(waId, { status: 'scheduling_date', answers: JSON.stringify(answers) });
      await this.send(waId, `Justo se ocupó ese día. Ahora tenemos ${endSentence(scheduling.availableWindows || this._availableDaysPhrase(scheduling.availableDays))} ¿Cuál prefieres?`);
      return;
    }

    // Solo se le puede afirmar o negar una hora que él haya dicho: la que el
    // parser dedujo de un "temprano" no es suya.
    const askedExactTime = !!(preferredTime && timePrecision === 'exact');
    const exact = askedExactTime ? daySlots.find((slot) => limaTimeOf(slot.startTime) === preferredTime) : null;

    // Si dijo día Y hora, esa hora está libre y la eligió de verdad, se agenda
    // directo: pedirle que elija de una lista lo que acaba de pedir es dar una
    // vuelta de más.
    if (exact && canBookExactTime(trimmed, parsedDate)) {
      scheduling.slots = daySlots;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      this.logActivity({ type: 'exact_time_booked', waId, when: trimmed, slot: exact.label });
      await this.bookSlot(waId, exact);
      return;
    }

    // Si pidió una hora concreta y justo esa no está libre, se dice
    // explícitamente en vez de mandarle una lista que parece ignorarlo. Y si
    // ese día apenas tiene un bloque, se completa con los de los otros días.
    const slots = await this._fillNearbySlots(daySlots, preferredTime);
    let intro;
    if (exact) {
      intro = `${capitalizeFirst(dayLabelWithArticle(date))} a las ${formatClockLabel(preferredTime)} sí lo tenemos libre. Confírmame con el número y lo agendo:`;
    } else if (!askedExactTime) {
      intro = `📅 Horarios para ${dayLabelWithArticle(date)}:`;
    } else {
      intro = `A las ${formatClockLabel(preferredTime)} no tenemos disponibilidad ese día. Estos son los más cercanos:`;
    }

    scheduling.slots = slots;
    await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });

    const list = numberedList(slotOptionLabels(slots));
    await this.send(waId, `${intro}\n\n${list}\n\n${slotMenuFooter(slots, availableDays)}`);
  }

  /**
   * Procesa la elección de horario: un número válido crea el evento real en
   * Google Calendar (con link de Google Meet), lo registra en `scheduled_meetings`
   * para la vista de "Próximas reuniones" del panel, y mueve el lead a "Cita
   * Agendada" (entra recién ahí al Funnel de Ventas). "no" transfiere a
   * seguimiento manual.
   */
  async handleSchedulingTimeReply(waId, session, text) {
    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    const scheduling = answers.__scheduling;

    if (!scheduling) {
      await this.updateSession(waId, { status: 'completed' });
      return;
    }

    const trimmed = (text || '').trim();
    if (['no', 'omitir', 'despues', 'después'].includes(normalize(trimmed))) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this._resolveRefusal(waId, trimmed, 'El lead prefirió no agendar.');
      return;
    }

    // Igual que en el paso del día: un "sí" que llega en su propia burbuja es
    // la confirmación del bloque que ya se le había propuesto.
    if (await this._bookLastProposedIfAffirmative(waId, answers, scheduling, trimmed)) return;

    if (await this._switchToPhoneIfAsked(waId, answers, scheduling, trimmed)) return;

    // Al LLM se le pasan las etiquetas completas (con fecha) para que pueda
    // interpretar "el de mañana"; al contacto se le muestran ya recortadas.
    const labels = scheduling.slots.map((s) => s.label);
    const { index, preferredTime } = await this.ollamaService.parseSchedulingChoice(trimmed, labels);
    const slot = index !== null ? scheduling.slots[index] : null;

    if (!slot) {
      // Nada de repetir la misma lista con un "no reconocí esa opción": eso
      // es el bucle. Primero se intenta entender qué pidió de verdad —otro
      // día u otra hora— y solo si no se logra coincidir se pasa a un asesor.
      scheduling.attempts = (scheduling.attempts || 0) + 1;

      if (await this._answerDayRequestWhileChoosing(waId, answers, scheduling, trimmed)) return;

      if (preferredTime) {
        const ranked = await this.googleCalendarService.getFreeSlotsNearTime(BOOKING_ADVISOR_USER_ID, preferredTime, { limit: SLOTS_TO_OFFER, days: BOOKING_WINDOW_DAYS });
        const nearSlots = orderSlotsForDisplay(ranked);
        if (nearSlots.length > 0) {
          scheduling.slots = nearSlots;
          scheduling.attempts = 0;
          await this.updateSession(waId, { answers: JSON.stringify(answers) });
          await this.send(
            waId,
            `Ese horario ya no está disponible, pero estos son los más cercanos a lo que buscas:\n\n${numberedList(slotOptionLabels(nearSlots))}\n\n${slotMenuFooter(nearSlots, scheduling.availableDays)}`
          );
          return;
        }
      }

      // Segunda respuesta seguida que no coincide: en vez de insistir con la
      // misma lista, lo coordina una persona.
      if (scheduling.attempts >= MAX_SLOT_CHOICE_ATTEMPTS) {
        delete answers.__scheduling;
        await this.updateSession(waId, { answers: JSON.stringify(answers) });
        await this.handOffToAdvisor(waId, 'No se logró coincidir en un horario con el lead.');
        return;
      }

      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.send(
        waId,
        `No te entendí bien 🤔 Responde con el número del horario que prefieras, dime otro día u hora que te venga mejor, o "no" si prefieres que te contacten después:\n\n${numberedList(fullSlotLabels(scheduling.slots))}`
      );
      return;
    }

    return this.bookSlot(waId, slot);
  }

  /**
   * La reunión es por Google Meet por defecto; si al elegir horario el lead
   * pide una llamada telefónica, se cambia la modalidad (sin el descuento de
   * Meet). Si en el mismo mensaje también eligió horario ("que me llamen, el
   * 2"), se sigue procesando esa elección; si no, se le vuelven a mostrar los
   * horarios. El número se pide solo si hace falta, al confirmar (confirmSlot).
   * Devuelve true si ya respondió.
   */
  async _switchToPhoneIfAsked(waId, answers, scheduling, text) {
    if (scheduling.mode === 'phone' || !asksForPhoneCall(text)) return false;

    scheduling.mode = 'phone';
    scheduling.discount = 0;
    if (!scheduling.phone && waIdIsPhone(waId)) scheduling.phone = digitsOnly(waId);
    this.logActivity({ type: 'switched_to_phone', waId, text });

    // Todavía no hay horarios sobre la mesa (pidió la llamada mientras se le
    // preguntaba el día): se confirma la modalidad y se vuelve a proponer la
    // agenda, en vez de mandarle una lista vacía. Si además dijo cuándo
    // ("llámenme mañana"), el mensaje se guarda como `when` para que
    // promptForDate lo tenga en cuenta y no le pregunte lo que ya dijo.
    if (!scheduling.slots?.length) {
      if (WHEN_HINT_RE.test(normalize(text).replace(PHONE_MODE_RE, ' '))) scheduling.when = text;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.send(waId, 'Listo, será por llamada telefónica 📞');
      await this.promptForDate(waId);
      return true;
    }

    await this.updateSession(waId, { answers: JSON.stringify(answers) });

    // También eligió horario en el mismo mensaje: que siga el flujo normal.
    if (/\d/.test(normalize(text).replace(PHONE_MODE_RE, ' '))) return false;

    await this.send(
      waId,
      `Listo, será por llamada telefónica 📞 ¿Qué horario prefieres?\n\n${numberedList(fullSlotLabels(scheduling.slots))}\n\nResponde con el número, o dime otro día u hora.`
    );
    return true;
  }

  /**
   * Crea la reunión real en el Google Calendar del asesor a partir de un
   * bloque ya elegido: registra el evento (con link de Google Meet), lo
   * guarda en `scheduled_meetings`, mueve el lead a "Cita Agendada" y le
   * confirma al contacto. Se llama tanto cuando elige un número de la lista
   * como cuando ya había dicho una hora exacta que estaba libre.
   */
  /**
   * Último paso antes de crear el evento. Ya no se pregunta por el correo:
   * el link de Meet llega por WhatsApp de todas formas, así que pedirlo solo
   * agregaba un paso más donde la conversación se podía atascar (un correo
   * mal escrito, o un contacto que no puede escribir y manda un audio en su
   * lugar — ver forceBookPendingSlot(), que sigue existiendo como salida
   * manual para sesiones viejas que sí llegaron a quedar en ese paso).
   * Se agenda directo con el horario ya elegido.
   */
  /**
   * Último paso antes de reservar: se le repite al contacto lo que se va a
   * agendar —modalidad, día y hora— y se espera su "sí".
   *
   * Existe porque el bot reservaba en cuanto creía haber entendido, y los
   * errores salían caros: alguien que escribió "¿Miércoles? salgo del trabajo
   * a las 4 pm" terminó con una reunión el MARTES, dijo "No puedo martes", y
   * aun así le llegó el recordatorio del martes. Repetir la interpretación en
   * una línea cuesta un turno; equivocarse cuesta el lead.
   *
   * TODOS los caminos de reserva pasan por aquí (elección por número y atajo
   * de hora exacta). Los únicos que van directo a `confirmSlot` son los que
   * vuelven a un horario que el contacto YA confirmó y al que solo le faltaba
   * su teléfono o su correo.
   */
  async bookSlot(waId, slot) {
    const session = await this.getSession(waId);
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    scheduling.awaitingConfirm = slot;
    await this.updateSession(waId, { status: 'scheduling_confirm', answers: JSON.stringify(answers) });
    this.logActivity({ type: 'booking_confirmation_asked', waId, slot: slot.label, mode: scheduling.mode || 'meet' });

    await this.send(waId, `¿Confirmo *${modeLabel(scheduling.mode)}*, *${slot.label}*? Responde *Sí* o dime qué cambiar 🙂`);
  }

  /**
   * Respuesta al "¿Confirmo…?". Un sí reserva; cualquier otra cosa se trata
   * como una corrección —nunca como una confirmación—: si nombra otro día u
   * hora se reinterpreta ahí mismo, y si no, se vuelve a ofrecer la lista.
   * Ante la duda NO se reserva: ese es justo el error que este paso existe
   * para evitar.
   *
   * El "sí" se reconoce en dos pasadas: primero el regex (gratis e
   * instantáneo) y, si no coincide, el LLM
   * (`ollamaService.parseConfirmationReply`). Hace falta la segunda porque el
   * regex exige que TODO el mensaje sea la afirmación, y un sí con un pedido
   * pegado —"Si esta bien.. Me envía enlace por este numero porfavor"— caía
   * al final de este método, soltaba el bloque y le preguntaba el día otra
   * vez: así se perdió una reunión ya confirmada el 28/09. El pedido extra se
   * atiende DESPUÉS de reservar, nunca en vez de reservar.
   */
  async handleSchedulingConfirmReply(waId, session, text) {
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    const slot = scheduling.awaitingConfirm;
    if (!slot) {
      await this.updateSession(waId, { status: 'scheduling_time', answers: JSON.stringify(answers) });
      return this.promptForDate(waId);
    }

    const trimmed = (text || '').trim();

    let decision = isAffirmative(trimmed) ? 'confirm' : null;
    let extraRequest = null;

    // Solo se le pregunta al LLM lo que el regex no resolvió, y solo si el
    // mensaje no es ya un rechazo obvio. `refuse` se ignora acá a propósito:
    // un "no" a ESTE horario no dice nada sobre el servicio, y decidir el
    // cierre definitivo lo hace `_resolveRefusal` más abajo.
    if (!decision && !this._isSchedulingRefusal(trimmed)) {
      const read = await this.ollamaService.parseConfirmationReply(trimmed, slot.label);
      this.logActivity({ type: 'confirm_reply_read', waId, text: trimmed, decision: read.decision, extraRequest: read.extraRequest, source: read.source });
      if (read.decision === 'confirm' || read.decision === 'change') decision = read.decision;
      extraRequest = read.extraRequest;
    }

    if (decision === 'confirm') {
      delete scheduling.awaitingConfirm;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      // El pedido que venía pegado al sí queda en la bitácora del panel. No
      // hace falta contestarlo aparte: `confirmSlot` manda el link y los datos
      // de la reunión, que es lo que se pide en la enorme mayoría de los casos.
      this.logActivity({ type: 'booking_confirmed', waId, slot: slot.label, extraRequest });
      return this.confirmSlot(waId, slot);
    }

    // Dijo que no, o pidió otra cosa. El horario tentativo se suelta antes de
    // reinterpretar: si no, una corrección a medias lo dejaría reservado. Pero
    // se recuerda como "el último que se le propuso": si su siguiente mensaje
    // es el sí que faltaba (porque partió la respuesta en dos burbujas y cada
    // una abrió su propio turno), se reserva ESE bloque en vez de volver a
    // empezar. Ver `_bookLastProposedIfAffirmative`.
    delete scheduling.awaitingConfirm;
    scheduling.lastProposed = slot;

    if (this._isSchedulingRefusal(trimmed)) {
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this._resolveRefusal(waId, trimmed, 'El lead no confirmó el horario propuesto.');
      return;
    }

    // Cambió la modalidad ("mejor llámame"): se atiende y se vuelve a
    // confirmar con la modalidad correcta, sin perder el horario.
    if (asksForPhoneCall(trimmed)) {
      scheduling.mode = 'phone';
      delete scheduling.discount;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      this.logActivity({ type: 'mode_switched_at_confirm', waId, mode: 'phone' });
      return this.bookSlot(waId, slot);
    }

    // Nombró un día o una hora: es una corrección, se reinterpreta como si
    // estuviera eligiendo de nuevo.
    await this.updateSession(waId, { status: 'scheduling_date', answers: JSON.stringify(answers) });
    if (SCHEDULE_CHANGE_HINT_RE.test(trimmed)) {
      return this.handleSchedulingDateReply(waId, await this.getSession(waId), trimmed);
    }

    await this.send(waId, 'Sin problema 🙌 Dime qué día y a qué hora te viene mejor.');
  }

  async confirmSlot(waId, slot) {
    const session = await this.getSession(waId);
    const { answers, scheduling } = this._readScheduling(session);
    if (!scheduling) { await this.updateSession(waId, { status: 'completed' }); return; }

    const isPhone = scheduling.mode === 'phone';
    const contactPhone = formatPhoneForAdvisor(scheduling.phone || (waIdIsPhone(waId) ? waId : null));

    // Una llamada telefónica sin número no es una reunión agendada: el asesor
    // se queda con una hora bloqueada y nadie a quien marcar. Pasa solo con
    // contactos sin teléfono real (Instagram/Facebook, wa_id tipo "PE.2249…"),
    // así que en vez de confirmar a medias se guarda el horario y se le pide
    // el número una vez más.
    if (isPhone && !contactPhone) {
      scheduling.pendingSlot = slot;
      await this.updateSession(waId, { status: 'scheduling_phone', answers: JSON.stringify(answers) });
      await this.send(
        waId,
        `Tengo tu horario reservado para *${slot.label}* 🙌 Solo me falta el número al que te llamamos ` +
        '(con código de país, ej: 51987654321).'
      );
      return;
    }

    const modalidadLabel = isPhone ? 'Llamada telefónica' : 'Videollamada por Google Meet';
    const discountText = scheduling.discount ? ` | Descuento aplicado: ${scheduling.discount}%` : '';

    // El lead se busca ANTES de crear el evento porque su nombre va en el
    // título (ver `meetingEventTitle`).
    const lead = await this.leadService.findByPhone(waId);

    try {
      const event = await this.googleCalendarService.createMeetEvent(BOOKING_ADVISOR_USER_ID, {
        summary: meetingEventTitle({ leadName: lead?.full_name, contactPhone, waId, isPhone }),
        description:
          `Agendada automáticamente por Avan (WhatsApp) con el contacto ${waId}.\n` +
          `Modalidad: ${modalidadLabel}${discountText}\n` +
          (scheduling.topic ? `Tema: ${scheduling.topic}\n` : '') +
          (isPhone && contactPhone ? `Teléfono del lead para la llamada: ${contactPhone}\n` : '') +
          (scheduling.email ? `Correo del lead: ${scheduling.email}\n` : ''),
        startTime: slot.startTime,
        endTime: slot.endTime,
        // Se vuelve a extraer por si la sesión venía de una versión anterior
        // que guardaba el mensaje completo: un invitado inválido hacía que
        // Google rechazara el evento y la reunión se perdiera.
        attendeeEmail: (!isPhone && extractEmail(scheduling.email)) || undefined
      });

      delete answers.__scheduling;
      await this.updateSession(waId, { status: 'completed', answers: JSON.stringify(answers) });

      if (lead) {
        const noteAppend = `\nReunión agendada (${isPhone ? 'telefónica' : 'Meet'}${scheduling.discount ? `, ${scheduling.discount}% dto` : ''}): ${slot.label}` +
          (isPhone && contactPhone ? ` — Tel: ${contactPhone}` : '') +
          (!isPhone && event.meetLink ? ` — ${event.meetLink}` : '');
        await this.leadService.updateLead(lead.id, { additionalNotes: `${lead.additional_notes || ''}${noteAppend}` });
      }
      await this.moveFunnelStage(waId, 'cita_agendada');

      if (this.scheduledMeetingService) {
        try {
          await this.scheduledMeetingService.create({
            leadId: lead?.id ?? null,
            waId,
            advisorUserId: BOOKING_ADVISOR_USER_ID,
            topic: scheduling.topic,
            startTime: slot.startTime,
            endTime: slot.endTime,
            meetLink: isPhone ? null : event.meetLink,
            calendarEventId: event.eventId
          });
        } catch (recordError) {
          console.error(`❌ [WhatsApp Bot] Error al registrar la reunión de ${waId} en scheduled_meetings:`, recordError);
        }
      }

      const name = firstNameOf(lead?.full_name);

      if (this.notificationService) {
        try {
          await this.notificationService.create({
            type: 'meeting_booked',
            title: `Reunión agendada con ${name || waId}`,
            body: `${slot.label} — ${isPhone ? '📞 Telefónica' : '💻 Meet'}${scheduling.discount ? ` (${scheduling.discount}% dto)` : ''}${scheduling.topic ? ` — ${scheduling.topic}` : ''}`,
            link: '/admin/availability'
          });
        } catch (notifyError) {
          console.error(`❌ [WhatsApp Bot] Error al crear la notificación de reunión agendada para ${waId}:`, notifyError);
        }
      }

      // La confirmación es el único mensaje que el contacto va a releer antes
      // de la reunión: lleva la hora con su zona, cuánto dura, dónde más le
      // llegó el link y cómo avisar si no puede. Sin eso vuelve a preguntar
      // por WhatsApp lo que ya se le dijo, o simplemente no aparece.
      // La duración que se le promete al contacto sale del panel, igual que la
      // del ancla de precio y la del bloque de datos del LLM. Antes se derivaba
      // del largo del hueco del calendario, que es la reserva interna del asesor
      // (30 min) y no lo que se le había dicho al lead que iba a durar.
      const durationLabel = meetingDurationLabel(await this.settingsService.get());
      const invitedEmail = isPhone ? null : extractEmail(scheduling.email);

      await this.send(
        waId,
        `✅ ¡Listo${name ? `, ${name}` : ''}! Tu ${isPhone ? 'llamada telefónica' : 'reunión por Google Meet'} con el asesor quedó agendada para *${slot.label}* (hora de Perú)${durationLabel ? ` y dura ${durationLabel}` : ''}.` +
        (isPhone
          ? `\n\n📞 Te llamaremos${contactPhone ? ` al ${contactPhone}` : ''}.`
          : (event.meetLink ? `\n\n🔗 Link de Google Meet: ${event.meetLink}` : '') +
            (invitedEmail ? `\n📩 También te llegó la invitación a ${invitedEmail}.` : '') +
            (scheduling.discount ? `\n🎁 Se aplicó el ${scheduling.discount}% de descuento sobre el precio final.` : '')) +
        '\n\nSi no puedes a esa hora, escríbeme por aquí y la movemos. ¡Te esperamos! 🙌'
      );
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al agendar la reunión para ${waId}:`, error);
      delete answers.__scheduling;
      await this.updateSession(waId, { answers: JSON.stringify(answers) });
      await this.handOffToAdvisor(waId, `Error técnico al crear el evento: ${error.message}`);
    }
  }

  /**
   * Override manual desde el panel: agenda el horario que el contacto ya
   * eligió sin esperar más el correo — para cuando se quedó atascado en ese
   * paso sin dar uno válido (p. ej. mandó un audio, que el bot no puede
   * transcribir, o insiste con texto que no es un correo). Hace exactamente
   * lo mismo que confirmSlot() habría hecho si hubiera contestado "no": el
   * evento se crea igual, solo que sin invitado en el calendario — el link
   * de Meet le llega por WhatsApp de todas formas.
   */
  async forceBookPendingSlot(waId) {
    const session = await this.getSession(waId);
    if (!session || session.status !== 'scheduling_email') {
      throw new Error('Esta conversación no está esperando un correo para agendar.');
    }
    const { scheduling } = this._readScheduling(session);
    const slot = scheduling?.pendingSlot;
    if (!slot) {
      throw new Error('No hay un horario pendiente de confirmar para este contacto.');
    }
    await this.confirmSlot(waId, slot);
  }

  /**
   * Barrido periódico (server.js, mismo setInterval que el de conversaciones
   * inactivas) del recordatorio previo: 45 minutos antes de la reunión se le
   * reenvía la hora y el link. Es lo más barato que hay contra el no-show —
   * la cita se agenda para hoy o mañana y en el medio no recibía nada.
   */
  async sendMeetingReminders() {
    if (!this.scheduledMeetingService) return;

    const pending = await this.scheduledMeetingService.getPendingReminders({
      leadMs: MEETING_REMINDER_LEAD_MS,
      minAgeMs: MEETING_REMINDER_MIN_AGE_MS
    });

    if (pending.length === 0) return;

    // Mismo criterio que el barrido de inactividad: si a ese contacto le
    // apagaron el bot (lo tomó un asesor), el recordatorio lo manda él. No se
    // marca como enviado, por si vuelven a encenderlo antes de la reunión.
    const disabled = new Set(
      (await db('whatsapp_bot_sessions')
        .whereIn('wa_id', [...new Set(pending.map((m) => m.wa_id))])
        .where('bot_enabled', false)
        .select('wa_id')).map((row) => row.wa_id)
    );

    for (const meeting of pending) {
      if (disabled.has(meeting.wa_id)) continue;

      const name = firstNameOf(meeting.lead_full_name);
      const startsIn = formatTimeUntil(meeting.start_time);
      const text =
        `⏰ ${name ? `${name}, te` : 'Te'} recuerdo tu reunión con el asesor: *${formatMeetingDateTimeLabel(meeting.start_time)}*${startsIn ? ` (${startsIn})` : ''}.` +
        (meeting.meet_link ? `\n\n🔗 ${sanitizeMeetLink(meeting.meet_link)}` : '\n\n📞 Te llamamos a este mismo número.');

      try {
        await this.send(meeting.wa_id, text, { requireOpenWindow: true });
        this.logActivity({ type: 'meeting_reminder_sent', waId: meeting.wa_id, meetingId: meeting.id });
      } catch (error) {
        // Se marca igual que si hubiera salido: reintentar en cada barrido
        // repetiría el mismo error (típicamente la ventana de 24 h de
        // WhatsApp ya cerrada) y el aviso tampoco llegaría a tiempo.
        console.error(`❌ [WhatsApp Bot] Error al mandar el recordatorio de la reunión ${meeting.id} a ${meeting.wa_id}:`, error.message);

        // Sin plantillas aprobadas no hay forma de escribirle al contacto
        // fuera de la ventana. Antes el recordatorio simplemente se perdía y
        // nadie lo sabía; ahora el aviso cambia de destinatario: se le pasa a
        // una persona, que sí puede llamarlo.
        if (error.code === 'WINDOW_CLOSED') {
          await this.alertInternal({
            waId: meeting.wa_id,
            type: 'whatsapp_reminder_undeliverable',
            title: 'Recordatorio de reunión sin entregar',
            body: `No se pudo avisar por WhatsApp a ${meeting.lead_full_name || meeting.wa_id} de su reunión `
              + `(${formatMeetingDateTimeLabel(meeting.start_time)}): su ventana de 24 h está cerrada. `
              + 'Contáctalo por otro medio si hace falta confirmarla.'
          });
        }
      }

      await this.scheduledMeetingService.markReminderSent(meeting.id);
    }
  }

  /**
   * Agenda del día para el vendedor: cada mañana, a partir de las 8, le manda
   * al correo de `sales_notification_email` las reuniones y llamadas que
   * tiene agendadas para hoy. Se manda por correo y no por WhatsApp porque a
   * las 8 a.m. lo normal es que la ventana de 24 h del negocio con ese número
   * ya esté cerrada, así que el envío nunca llegaba y el barrido de cada diez
   * minutos lo reintentaba sin éxito.
   *
   * Lo llama el mismo barrido de cada diez minutos que los recordatorios, así
   * que este método decide por su cuenta si toca mandarla: ya pasaron las 8,
   * todavía no es mediodía, y no se mandó ya la de hoy. La marca del último
   * envío vive en la base (`daily_agenda_sent_on`) para que un reinicio del
   * servidor no la repita.
   *
   * El aviso se registra SIEMPRE en las notificaciones del panel, aunque el
   * envío por correo falle.
   */
  async sendDailyAgendaToSalesperson({ force = false } = {}) {
    if (!this.scheduledMeetingService) return null;

    const today = limaTodayIso();
    const settings = await this.settingsService.get();

    if (!force) {
      const hour = Number(LIMA_TIME_FORMATTER.format(new Date()).slice(0, 2));
      if (hour < DAILY_AGENDA_HOUR || hour >= DAILY_AGENDA_CUTOFF_HOUR) return null;
      if (dayOnlyIso(settings.daily_agenda_sent_on) === today) return null;
    }

    const meetings = await this.scheduledMeetingService.getForDay(today);
    const body = buildDailyAgendaMessage(today, meetings);

    // Se marca ANTES de mandar: si el envío falla, reintentarlo en el barrido
    // siguiente repetiría el mismo error (la ventana de 24 h no se abre sola)
    // y el vendedor recibiría la agenda dos veces si justo funciona a medias.
    if (!force) {
      await db('whatsapp_bot_settings').where({ id: settings.id }).update({ daily_agenda_sent_on: today });
    }

    if (this.notificationService) {
      try {
        await this.notificationService.create({
          type: 'whatsapp_daily_agenda',
          title: meetings.length > 0
            ? `Agenda de hoy: ${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`
            : 'Agenda de hoy: sin reuniones',
          body,
          link: '/admin/whatsapp'
        });
      } catch (error) {
        console.error('❌ [WhatsApp Bot] Error al registrar la notificación de la agenda diaria:', error);
      }
    }

    const salesEmail = settings.sales_notification_email;
    if (!salesEmail) {
      console.warn('⚠️ [WhatsApp Bot] Agenda diaria sin destinatario: falta el correo del vendedor en el panel del bot.');
      return { sent: false, meetings: meetings.length, reason: 'sin_correo' };
    }

    try {
      const result = await this.emailService.sendDailyAgendaEmail(salesEmail, {
        subject: `📅 Agenda de hoy — ${meetings.length} ${meetings.length === 1 ? 'reunión' : 'reuniones'}`,
        bodyText: body
      });
      if (!result?.success) throw new Error(result?.error || 'Error al enviar el correo.');
      this.logActivity({ type: 'daily_agenda_sent', email: salesEmail, meetings: meetings.length });
      console.log(`📅 [WhatsApp Bot] Agenda del ${today} enviada por correo al vendedor (${meetings.length} reuniones).`);
      return { sent: true, meetings: meetings.length };
    } catch (error) {
      console.error('❌ [WhatsApp Bot] No se pudo mandar la agenda diaria al vendedor:', error.message);
      return { sent: false, meetings: meetings.length, reason: error.message };
    }
  }

  /**
   * Barrido periódico (llamado desde server.js con un setInterval, igual que
   * el sondeo de seguidores de Meta) para el seguimiento por inactividad: a
   * la hora de silencio manda un recordatorio único, y si sigue una hora más
   * sin responder, congela el lead en el Setter Funnel y apaga el bot para
   * ese contacto (no vuelve a insistir solo).
   */
  async checkStaleConversations() {
    const now = Date.now();

    const awaitingReply = await db('whatsapp_bot_sessions')
      .whereIn('status', ['active', WARMUP_STATUS, ...SCHEDULING_STATUSES])
      .where('bot_enabled', true)
      .whereNull('nudge_sent_at');

    const awaitingFreeze = await db('whatsapp_bot_sessions')
      .whereIn('status', ['active', WARMUP_STATUS, ...SCHEDULING_STATUSES])
      .where('bot_enabled', true)
      .whereNotNull('nudge_sent_at');

    // Red de seguridad: el status debería quedar en "completed" apenas se
    // agenda una reunión real (confirmSlot lo hace antes de mandar la
    // confirmación), así que en teoría estas dos consultas nunca deberían
    // traer a un contacto que ya cerró. Pero un contacto que YA tiene una
    // reunión próxima agendada no puede recibir un "¿Estás ahí?" ni quedar
    // congelado bajo NINGUNA circunstancia — así que se verifica también acá,
    // por si algún camino (una carrera entre mensajes, un reinicio manual a
    // medias, un bug futuro) deja la sesión en un status que no le
    // corresponde.
    const candidateWaIds = [...new Set([...awaitingReply, ...awaitingFreeze].map((s) => s.wa_id))];
    const withUpcomingMeeting = candidateWaIds.length > 0
      ? new Set(
        (await db('scheduled_meetings')
          .whereIn('wa_id', candidateWaIds)
          .where('start_time', '>=', db.fn.now())
          .select('wa_id')).map((row) => row.wa_id)
      )
      : new Set();

    // Contactos cuyo lead YA está en el Funnel de Ventas. Este barrido no los
    // toca de ninguna forma: ni "¿Sigues por ahí?" ni congelarlos. Era la
    // causa del bug que reportó ventas — un lead en seguimiento, ya cotizado,
    // recibía el recordatorio de inactividad y una hora después aparecía en la
    // columna "Congelados" del Setter Funnel, fuera del tablero del closer.
    // El silencio de un lead comercial no es inactividad del bot que haya que
    // perseguir: es una negociación en curso que alguien está llevando.
    const inSalesFunnel = await this._salesFunnelWaIds(candidateWaIds);

    // Quién habló ÚLTIMO en cada conversación candidata. Sin este dato el
    // barrido trataba todo silencio como inactividad del lead y le mandaba
    // "¿Sigues por ahí?" incluso cuando el que había dejado de responder era
    // el bot — le reclamaba al contacto un silencio propio (caso real: un
    // lead contestó "Soy de administracion", no recibió nada, y una hora
    // después le llegó el recordatorio). Un mensaje saliente también lo
    // registra el asesor que responde a mano desde WhatsApp Business
    // (recordOutboundEcho), así que una conversación ya atendida por una
    // persona tampoco entra por acá.
    //
    // Se ordena por `id` (orden de inserción) y no por `received_at`: dos
    // mensajes del mismo segundo son indistinguibles por fecha, y acá lo que
    // importa es exactamente cuál fue el último.
    const lastUnanswered = new Map();
    if (candidateWaIds.length > 0) {
      const lastIds = await db('whatsapp_messages')
        .whereIn('wa_id', candidateWaIds)
        .groupBy('wa_id')
        .max('id as last_id');
      const lastRows = await db('whatsapp_messages')
        .whereIn('id', lastIds.map((r) => r.last_id))
        .select('wa_id', 'direction', 'body', 'received_at');
      for (const row of lastRows) {
        if (row.direction !== 'inbound') continue;
        lastUnanswered.set(row.wa_id, { text: row.body || '', at: row.received_at });
      }
    }

    const limaHour = Number(LIMA_TIME_FORMATTER.format(new Date(now)).slice(0, 2));
    const isQuietHours = isWithinQuietHours(limaHour);

    for (const session of awaitingReply) {
      if (withUpcomingMeeting.has(session.wa_id)) continue;
      if (inSalesFunnel.has(session.wa_id)) continue;

      // El último mensaje es del contacto: esto NO es inactividad del lead,
      // es un turno que el bot perdió. No le corresponde un recordatorio
      // (sería reclamarle a él), sino reintentar la respuesta que le debemos.
      const unanswered = isRealWaId(session.wa_id) ? lastUnanswered.get(session.wa_id) : null;
      if (unanswered) {
        // El silencio se mide desde el mensaje sin responder y no desde
        // `updated_at` de la sesión: si el turno se cayó antes de guardar
        // nada, esa marca quedó vieja y no dice hace cuánto escribió.
        if (now - new Date(unanswered.at).getTime() < MISSED_REPLY_RECOVERY_MS) continue;
        if (isQuietHours) continue;
        await this._recoverMissedReply(session, unanswered.text);
        continue;
      }

      const silentMs = now - new Date(session.updated_at).getTime();
      if (silentMs < INACTIVITY_NUDGE_MS) continue;

      // Ya se le insistió el máximo de veces: no se le manda otro
      // recordatorio nunca más, se congela de una. Sin esta rama la sesión
      // se quedaría activa para siempre, porque el bucle de congelado solo
      // mira las filas que TIENEN `nudge_sent_at` y esta ya no va a volver a
      // tenerlo. Congelar no manda ningún mensaje, así que puede ocurrir
      // también en horario de silencio.
      const nudgesSent = Number(session.nudge_count || 0);
      if (nudgesSent >= MAX_INACTIVITY_NUDGES) {
        await this.freezeStaleSession(session);
        continue;
      }

      if (isQuietHours) continue;

      // Reserva la fila ANTES de enviar (con la condición nudge_sent_at IS
      // NULL en el propio UPDATE) para que dos barridos que se solapen
      // (p. ej. si el barrido anterior aún no terminó cuando arranca el
      // siguiente) no puedan mandar el mismo recordatorio dos veces: solo
      // uno de los dos logra actualizar la fila, el otro ve 0 filas
      // afectadas y no manda nada.
      const claimed = await db('whatsapp_bot_sessions')
        .where({ id: session.id })
        .whereNull('nudge_sent_at')
        .update({ nudge_sent_at: db.fn.now(), nudge_count: nudgesSent + 1 });
      if (!claimed) continue;

      try {
        const nudgeText = await this._inactivityNudgeText(session, nudgesSent);
        await this.send(session.wa_id, nudgeText, { requireOpenWindow: true });
        this.logActivity({ type: 'inactivity_nudge', waId: session.wa_id, attempt: nudgesSent + 1 });
      } catch (error) {
        // Incluye la ventana de 24 h cerrada: el seguimiento se da por
        // gastado igual (la fila ya quedó reservada arriba) en vez de
        // reintentarse en cada barrido contra un error que no se arregla solo.
        await this._discardProposedSlot(session.wa_id);
        console.error(`❌ [WhatsApp Bot] Error al mandar el recordatorio de inactividad a ${session.wa_id}:`, error.message);
      }
    }

    for (const session of awaitingFreeze) {
      if (withUpcomingMeeting.has(session.wa_id)) continue;
      if (inSalesFunnel.has(session.wa_id)) continue;

      // Red de seguridad: congelar por inactividad a alguien que escribió y
      // se quedó esperando es la misma injusticia que mandarle "¿Sigues por
      // ahí?", y encima silenciosa. En teoría no pasa (clearNudge borra
      // `nudge_sent_at` apenas el contacto escribe, así que la fila vuelve al
      // bucle de arriba), pero si alguna carrera lo deja acá, se atiende como
      // lo que es: un turno perdido.
      const unanswered = isRealWaId(session.wa_id) ? lastUnanswered.get(session.wa_id) : null;
      if (unanswered) {
        if (now - new Date(unanswered.at).getTime() < MISSED_REPLY_RECOVERY_MS) continue;
        if (isQuietHours) continue;
        await this._recoverMissedReply(session, unanswered.text);
        continue;
      }

      const silentSinceNudgeMs = now - new Date(session.nudge_sent_at).getTime();
      if (silentSinceNudgeMs < INACTIVITY_FREEZE_MS) continue;

      await this.freezeStaleSession(session);
    }

    await this._recoverOrphanInbounds(now, isQuietHours);
  }

  /**
   * Mensajes entrantes de contactos que NO tienen ninguna sesión del bot.
   *
   * Los dos bucles de arriba solo ven conversaciones con sesión, así que el
   * peor caso de todos se les escapaba: el mensaje que nunca llegó a
   * procesarse. Pasa porque el buffer de agrupación vive en memoria — si el
   * proceso se reinicia mientras un mensaje espera ahí, se pierde sin dejar
   * sesión, sin respuesta y sin recordatorio (el barrido tampoco lo veía),
   * y nadie se entera. Caso real: un lead mandó el formulario completo a las
   * 19:12 y no recibió absolutamente nada, ni el saludo ni el recordatorio.
   *
   * Sin sesión no hay dónde anotar el intento, así que la reserva es la fila
   * misma: se inserta la sesión ANTES de responder (con `onConflict ignore`,
   * que además resuelve la carrera con un mensaje nuevo del contacto), y así
   * el próximo barrido ya no lo ve como huérfano aunque el turno falle.
   * `started_at` se deja en NULL a propósito: es lo que marca el primer turno
   * real, y este contacto todavía no tuvo ninguno.
   */
  async _recoverOrphanInbounds(now, isQuietHours) {
    if (isQuietHours) return;

    const rows = await db('whatsapp_messages')
      .whereNotNull('wa_id')
      .where('wa_id', '!=', '')
      .where('received_at', '>=', new Date(now - MISSED_REPLY_MAX_AGE_MS))
      .whereNotExists(function () {
        this.select(db.raw('1'))
          .from('whatsapp_bot_sessions')
          .whereRaw('whatsapp_bot_sessions.wa_id = whatsapp_messages.wa_id');
      })
      .groupBy('wa_id')
      .max('id as last_id');

    if (rows.length === 0) return;

    const lastRows = await db('whatsapp_messages')
      .whereIn('id', rows.map((r) => r.last_id))
      .select('wa_id', 'direction', 'body', 'received_at');

    // Conversaciones donde YA salió algo alguna vez. Mirar solo el ÚLTIMO
    // mensaje no alcanzaba: si el asesor contestaba desde la app de WhatsApp
    // Business y el contacto escribía después, el último volvía a ser
    // entrante y el bot "revivía" encima de una conversación que ya estaba
    // atendiendo una persona — con un "Perdona la demora" y un turno entero.
    // Esto es una red de seguridad del arreglo de verdad (leer el campo
    // "message_echoes" en whatsappWebhookService): si esa suscripción se cae
    // en el panel de Meta, o el eco llega tarde, el bot igual no se mete.
    //
    // La recuperación que este barrido existe para hacer —un turno que se
    // perdió y dejó al contacto SIN ninguna respuesta— no tiene ningún
    // saliente por definición, así que esta condición no le quita nada.
    const answeredRows = await db('whatsapp_messages')
      .whereIn('wa_id', lastRows.map((r) => r.wa_id))
      .where('direction', 'outbound')
      .distinct('wa_id');
    const answeredWaIds = new Set(answeredRows.map((r) => r.wa_id));

    // Un lead que ya está en el Funnel de Ventas no se "recupera": que no
    // tenga sesión del bot es lo normal cuando lo trabaja una persona desde el
    // principio (o cuando alguien reinició la conversación), y revivir el bot
    // encima sería arrancarle una calificación a un lead ya cotizado.
    const inSalesFunnel = await this._salesFunnelWaIds(lastRows.map((r) => r.wa_id));

    for (const row of lastRows) {
      if (answeredWaIds.has(row.wa_id)) continue;
      if (inSalesFunnel.has(row.wa_id)) continue;
      if (row.direction !== 'inbound' || !isRealWaId(row.wa_id)) continue;
      if (now - new Date(row.received_at).getTime() < MISSED_REPLY_RECOVERY_MS) continue;

      const inserted = await db('whatsapp_bot_sessions')
        .insert({
          wa_id: row.wa_id,
          status: 'active',
          bot_enabled: true,
          answers: JSON.stringify({}),
          missed_reply_at: db.fn.now()
        })
        .onConflict('wa_id')
        .ignore();
      // Knex devuelve [] (o [0], según el motor) cuando el conflicto se
      // ignoró: la sesión apareció entre la consulta y el insert, así que de
      // este contacto se encarga el flujo normal.
      if (Array.isArray(inserted) ? (inserted.length === 0 || !inserted[0]) : !inserted) continue;

      this.logActivity({ type: 'orphan_inbound_recovered', waId: row.wa_id, text: row.body });

      try {
        await this.send(row.wa_id, whatsappBotCopy.missedReplyApology());
        await this.runSerialized(row.wa_id, () => this.runConversationTurn(row.wa_id, row.body || ''));
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] Error al recuperar el mensaje sin procesar de ${row.wa_id}:`, error);
      }
    }
  }

  /**
   * Reintenta un turno que el bot perdió: el contacto escribió, no recibió
   * nada, y ya pasó el margen de `MISSED_REPLY_RECOVERY_MS`.
   *
   * Solo se reintenta UNA vez por conversación. La reserva es la misma que la
   * del recordatorio (el UPDATE lleva la condición `missed_reply_at IS NULL`,
   * así que dos barridos solapados no pueden reintentar el mismo turno dos
   * veces). Si la fila ya estaba reservada, quiere decir que el reintento
   * anterior tampoco dejó respuesta: ahí se corta y pasa a un asesor, porque
   * lo que ya falló dos veces solo no se arregla — y el lead lleva rato
   * esperando algo que nunca llegó.
   *
   * La disculpa sale como mensaje aparte y ANTES de reintentar el turno: la
   * demora es nuestra y se dice así, en vez de preguntarle al contacto si
   * sigue ahí.
   */
  async _recoverMissedReply(session, lastText) {
    const waId = session.wa_id;

    const claimed = await db('whatsapp_bot_sessions')
      .where({ id: session.id })
      .whereNull('missed_reply_at')
      .update({ missed_reply_at: db.fn.now() });

    if (!claimed) {
      this.logActivity({ type: 'missed_reply_handoff', waId, text: lastText });
      try {
        await this.send(waId, whatsappBotCopy.missedReplyHandoff());
      } catch (error) {
        // Que no se pueda mandar el acuse no puede impedir la transferencia:
        // justamente el problema es que los envíos a este contacto fallan.
        console.error(`❌ [WhatsApp Bot] Error al avisar del turno perdido a ${waId}:`, error);
      }
      await this.handOffToAdvisor(waId, 'El bot dejó un mensaje de este lead sin responder y el reintento automático tampoco salió. Retomar la conversación a mano.');
      return;
    }

    this.logActivity({ type: 'missed_reply_recovered', waId, text: lastText });

    try {
      await this.send(waId, whatsappBotCopy.missedReplyApology());
      // Se reencola por la cola serializada del contacto, igual que un
      // mensaje nuevo: si justo ahora entrara otro mensaje suyo, los dos
      // turnos se ordenan en vez de pisarse.
      await this.runSerialized(waId, () => this.runConversationTurn(waId, lastText));
    } catch (error) {
      // El próximo barrido verá que el último mensaje SIGUE siendo del
      // contacto y, con la fila ya reservada, lo pasará a un asesor.
      console.error(`❌ [WhatsApp Bot] Error al reintentar el turno perdido de ${waId}:`, error);
    }
  }

  /**
   * Congela una sesión abandonada: el bot deja de insistir y el lead pasa a
   * "Congelado" en el Setter Funnel para que lo retome una persona. Se guarda
   * el paso en el que quedó (`__frozenFrom`) para retomarlo ahí mismo si el
   * contacto vuelve a escribir.
   *
   * Lo llaman los dos caminos del barrido: el contacto que no contestó al
   * recordatorio, y el que ya agotó el tope de recordatorios de la
   * conversación.
   */
  async freezeStaleSession(session) {
    try {
      // Red de seguridad: los dos bucles del barrido ya descartan los leads
      // comerciales, pero congelar es justamente la acción que los sacaba del
      // tablero del closer, así que se vuelve a comprobar en el único lugar
      // por donde pasan todos los caminos.
      if (await this.salesFunnelLead(session.wa_id)) {
        this.logActivity({
          type: 'freeze_skipped_sales_funnel',
          waId: session.wa_id,
          reason: 'El lead ya está en el Funnel de Ventas: el bot no lo congela ni lo devuelve al Setter Funnel.'
        });
        return;
      }

      const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
      answers.__frozenFrom = session.status;
      await db('whatsapp_bot_sessions').where({ id: session.id }).update({ status: FROZEN_STATUS, answers: JSON.stringify(answers) });
      await this.moveFunnelStage(session.wa_id, 'congelado');
      this.logActivity({ type: 'inactivity_frozen', waId: session.wa_id });
    } catch (error) {
      console.error(`❌ [WhatsApp Bot] Error al congelar la conversación de ${session.wa_id}:`, error);
    }
  }

  /**
   * Mensaje nuevo de un lead que YA tiene una reunión real agendada. En vez
   * de ignorarlo (como cualquier otra sesión "completed"), se clasifica con
   * IA: saludos/agradecimientos cortos no necesitan respuesta; preguntas
   * sobre la reunión (link/hora) se responden solas con los datos reales;
   * pedidos de reagendar, quejas o consultas nuevas generan una respuesta
   * breve y quedan marcados como urgentes en las notificaciones del panel
   * para que un asesor los revise.
   */
  async handlePostBookingMessage(waId, meeting, text) {
    const lead = await this.leadService.findByPhone(waId);
    const contactName = firstNameOf(lead?.full_name);

    const settings = await this.settingsService.get();
    const result = await this.ollamaService.classifyPostBookingMessage(text, {
      meetingLabel: formatMeetingDateTimeLabel(meeting.start_time),
      meetLink: sanitizeMeetLink(meeting.meet_link),
      knowledgeBlock: buildKnowledgeBlock(settings),
      contactName
    });

    this.logActivity({ type: 'post_booking_classified', waId, text, needsReply: result.needsReply, isUrgent: result.isUrgent, source: result.source });

    // Dijo que no puede, o pide mover/cancelar: lo primero es callar el
    // recordatorio de esa reunión. Mandarle "⏰ Te recuerdo tu reunión del
    // martes" a quien acaba de escribir "No puedo martes" es el peor mensaje
    // posible — pasó de verdad. Se marca el recordatorio como ya atendido
    // (la columna significa "enviado o intentado") y se escala a una persona
    // por correo, que es quien puede mover la reunión de verdad.
    if (cannotAttendMeeting(text)) {
      try {
        await this.scheduledMeetingService.markReminderSent(meeting.id);
        this.logActivity({ type: 'meeting_reminder_suppressed', waId, meetingId: meeting.id, text });
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] No se pudo silenciar el recordatorio de la reunión ${meeting.id}:`, error.message);
      }

      await this.alertInternal({
        waId,
        type: 'meeting_change_requested',
        title: `${contactName || waId} no puede asistir a su reunión`,
        body: `Reunión agendada para ${formatMeetingDateTimeLabel(meeting.start_time)}.\n\n`
          + `El contacto escribió: "${text}"\n\n`
          + 'Su recordatorio automático quedó silenciado. La reunión sigue en el calendario del asesor: '
          + 'hay que moverla o cancelarla a mano.'
      });
    }

    if (!result.needsReply) return;

    await this.send(waId, result.replyText || 'Un asesor del equipo te va a escribir directamente para ayudarte con eso. ¡Gracias! 🙌');

    if (result.isUrgent && this.notificationService) {
      try {
        await this.notificationService.create({
          type: 'post_booking_attention',
          title: `${contactName || waId} necesita seguimiento`,
          body: `Ya tiene una llamada agendada (${formatMeetingDateTimeLabel(meeting.start_time)}) pero escribió: "${text}"`,
          link: '/admin/whatsapp'
        });
      } catch (error) {
        console.error(`❌ [WhatsApp Bot] Error al crear la notificación de seguimiento para ${waId}:`, error);
      }
    }
  }
}
