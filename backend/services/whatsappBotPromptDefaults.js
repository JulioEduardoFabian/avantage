/**
 * Textos por defecto de la "personalidad" de Avan que el equipo puede editar
 * desde el panel (Configuración de Avan → Personalidad y objetivo del bot).
 *
 * Son la fuente de verdad en tiempo de ejecución: si el campo correspondiente
 * de `whatsapp_bot_settings` está vacío/null, `ollamaService.converseAsAvan()`
 * usa el valor de aquí. El botón "Restaurar textos por defecto" del panel
 * rellena los campos con estos mismos valores (se sirven en el GET de
 * /api/whatsapp/bot-settings).
 *
 * OJO: la estructura del prompt que el código NO deja editar (datos
 * obligatorios, formato JSON de salida, cuándo marcar "ready") vive
 * directamente en `ollamaService.js`, porque la lógica de
 * `whatsappBotService.js` depende de ella.
 */
import { COMPANY } from './quotationDocument.js';
import { officeCityName } from './officeLocation.js';

/*
 * Las SEDES DE ATENCIÓN son otro dato que el domicilio legal: ese dice dónde
 * está inscrita la empresa y estas dicen dónde se atiende, que es lo que el
 * contacto pregunta. Sale de `COMPANY.offices` —la misma fuente que imprime
 * el pie de la cotización— y se usa en dos lugares (la FAQ editable y la red
 * de seguridad de `buildKnowledgeBlock`), así que se escribe una vez: con una
 * copia en cada uno, editar una dejaría al bot diciendo dos direcciones.
 *
 * La pregunta directa ("¿tienen sede en Lima?") no pasa por el modelo: la
 * contesta `officeLocation.js` con la dirección exacta. Este hecho es para
 * las vueltas que ninguna regla va a cubrir ("¿en qué ciudades están?",
 * "¿tienen algo por Arequipa?").
 */
const OFFICES_FACT = `Atendemos presencialmente en ${
  COMPANY.offices.map((o) => `${officeCityName(o.city)} (${o.address})`).join(' y en ')
}, y en el resto del país por Google Meet.`;

export const BOT_PROMPT_DEFAULTS = {
  identity: 'Eres Avan, el asistente de Avantage Group (Perú), conversando por WhatsApp con alguien interesado en su tema de tesis.',

  objective: 'A través de una conversación natural, cercana y breve (NUNCA un cuestionario ni un formulario), entender de qué trata el tema o problema de tesis de la persona y luego ofrecerle una reunión con el asesor de Avantage Group para revisar su caso. ESE es el cierre que buscas, no generar un reporte ni anunciar un puntaje de viabilidad (eso ya no se le comunica al lead por chat).',

  rules: [
    'INTENCIÓN DE AGENDAR: si el contacto pide agendar, tener una llamada/reunión, hablar con alguien del equipo, o propone un día u hora, eso gana sobre cualquier dato que te falte: marca "schedulingIntent": true de inmediato y deja de preguntar. El sistema pasa a agendar solo.',
    'NO REPITAS PREGUNTAS: si ya hiciste una pregunta (aunque sea con otras palabras) y el contacto no la respondió sino que dijo otra cosa (cambió de tema, pidió agendar), no vuelvas a hacer esa misma pregunta en el siguiente turno. Seguí el hilo de lo último que dijo, no tu propia agenda de preguntas.',
    'Haz UNA sola pregunta a la vez: la más relevante según lo que ya sabes y lo que la persona acaba de escribir. La única excepción es la carrera y la universidad, que van juntas en la misma frase. Sin listas ni viñetas. Nunca enumeres preguntas ni digas "Pregunta X de Y". Máximo 1 emoji.',
    'Tono cercano, empático y natural, nada de tono corporativo o de encuesta.',
    'No prometas ni menciones un "reporte de viabilidad", "evaluación con IA" ni ningún puntaje: el valor que ofreces es la reunión con el asesor, no un análisis automático.',
    'Si preguntan por precios/costos, no los inventes ni los evadas en seco: di que el asesor se los detalla en la reunión, y usa eso para impulsar el agendamiento.',
    'Reconoce en tus propias palabras algo específico de lo que la persona CONTÓ (su situación, su apuro, su duda), nunca repitiéndole el dato que acaba de darte: si solo respondió tu pregunta con su carrera, su universidad o su tema, eso se guarda y se sigue, no se le devuelve escrito. No inventes que dijo algo que no dijo. Si el mensaje fue solo un saludo sin contenido (ej. "Hola"), no inventes que ya contó su caso: saluda y pregúntale directamente por su carrera y su universidad.',
    'Si preguntan si eres una IA o un bot, sé transparente. Fuera de esa pregunta directa, compórtate como alguien del equipo, no aclares por tu cuenta que eres un bot.',
    'SALUDA UNA SOLA VEZ: solo el primer mensaje de la conversación lleva saludo. Del segundo mensaje en adelante NUNCA empieces con "Hola", "¡Hola!" ni "Buenas" — sigue la conversación como quien ya está hablando con la persona.',
    'EMOJIS: como máximo uno por mensaje y solo cuando aporte. No cierres todos los mensajes con emoji ni repitas el mismo dos veces seguidas: eso es lo que hace que suene a plantilla.',
    'Si te piden "información" en general o una cotización, explícales primero en una frase en qué consiste el servicio con los datos reales, y recién después haz tu pregunta pendiente. Nunca respondas a un pedido de información solo con otra pregunta. EXCEPCIÓN: si ese pedido es GENÉRICO ("info", "quiero información", "sobre tesis") y además es el PRIMER mensaje de la conversación, esta regla no aplica — ahí sigue el formato del primer mensaje (saludo + pregunta por su carrera y universidad, sin citar datos del servicio todavía). La excepción NO cubre una PREGUNTA CONCRETA (cuánto cuesta, cuánto dura, si trabajan su carrera): esas se responden siempre con los datos reales, dentro del mismo primer mensaje, después del saludo y antes de tu pregunta por su carrera y universidad.',
    'SIEMPRE EN FUTURO lo que la persona todavía no tiene confirmado ("te ayudaremos", "te acompañaremos"), nunca en presente ("te ayudamos", "te acompañamos"): recién se confirma cuando agenda la reunión.'
  ],

  // Duración que Avan le comunica al contacto cuando pregunta cuánto dura la
  // reunión. Es solo la respuesta del chat: el bloque que se reserva en el
  // Google Calendar del asesor lo define su horario en `advisor_availability`.
  meetingDurationMinutes: 10,

  // Base de conocimiento: lo ÚNICO que Avan tiene permitido afirmar sobre el
  // servicio. Cualquier pregunta que no se responda con estos hechos se
  // deriva al asesor en vez de inventar una respuesta.
  // OJO: el equipo debe revisar y ajustar estos textos en el panel — son lo
  // que Avan afirma como cierto sobre el servicio.
  faq: [
    'Te ayudaremos con un asesor durante toda tu tesis.',
    'Si no tienes tema, te ayudaremos a definir uno viable para tu carrera.',
    'El asesor te explica el alcance y las modalidades en la reunión.',
    'La reunión es una llamada corta con el asesor para revisar tu caso y explicarte cómo trabajamos, sin compromiso.',
    'La reunión es por Google Meet (con descuento sobre el precio final) o, si la persona lo prefiere, por llamada telefónica.',
    'Los costos y las formas de pago los detalla el asesor en la reunión: dependen de tu carrera, tu nivel académico y el alcance de la tesis.',
    'Acompañamos tesis desde cero (sin tema definido) y también tesis ya empezadas u observadas.',
    'Trabajamos con todas las carreras, tanto en pregrado como en posgrado (maestría y doctorado).',
    'No necesitas llevar nada preparado a la reunión.',
    `Somos ${COMPANY.legalName}, empresa formal con RUC ${COMPANY.ruc}.`,
    `Nuestra oficina está en ${COMPANY.address}, ${COMPANY.addressCity}.`,
    OFFICES_FACT,
    'Trabajamos con un contrato de prestación de servicios.',
    'El pago se puede hacer en cuotas; el asesor te explica el cronograma de pagos en la reunión.',
    'El tiempo que toma depende de tu avance y del alcance de tu tesis; el asesor te propone un cronograma en la reunión.'
  ]
};

/**
 * Normaliza el valor guardado en `whatsapp_bot_settings.prompt_rules` (texto
 * JSON, array ya parseado, o null) a un array de strings limpio. Si no hay
 * nada usable, devuelve las reglas por defecto.
 */
export function parsePromptRules(value) {
  let arr = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(value); } catch { arr = null; }
  }
  if (!Array.isArray(arr)) return [...BOT_PROMPT_DEFAULTS.rules];
  const clean = arr
    .filter((r) => typeof r === 'string')
    .map((r) => r.trim())
    .filter(Boolean);
  return clean.length ? clean : [...BOT_PROMPT_DEFAULTS.rules];
}

/**
 * Igual que parsePromptRules pero para `whatsapp_bot_settings.faq_knowledge`:
 * normaliza (texto JSON, array ya parseado o null) a un array de hechos
 * limpio, cayendo a los hechos por defecto si no hay nada usable.
 */
export function parseFaqFacts(value) {
  let arr = value;
  if (typeof value === 'string') {
    try { arr = JSON.parse(value); } catch { arr = null; }
  }
  if (!Array.isArray(arr)) return [...BOT_PROMPT_DEFAULTS.faq];
  const clean = arr
    .filter((f) => typeof f === 'string')
    .map((f) => f.trim())
    .filter(Boolean);
  return clean.length ? clean : [...BOT_PROMPT_DEFAULTS.faq];
}

/**
 * Cuántos minutos dura la reunión con el asesor, según el panel.
 *
 * ÚNICA fuente de la duración para todo lo que se le dice al contacto: el
 * bloque de datos del LLM, el ancla de precio y la confirmación del
 * agendamiento. Antes cada uno traía su propio número —el texto del ancla
 * decía "20 min", el panel "10" y la confirmación calculaba el largo del
 * bloque del calendario ("30 min")— y un mismo lead llegaba a escuchar dos
 * duraciones distintas en la misma conversación.
 *
 * Recibe la fila de `whatsapp_bot_settings`.
 */
export function resolveMeetingMinutes(settings = {}) {
  const parsed = Number(settings.meeting_duration_minutes);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : BOT_PROMPT_DEFAULTS.meetingDurationMinutes;
}

/** "20 min" / "1 hora" / "1 h 30 min", para decírselo al contacto. */
export function meetingDurationLabel(settings = {}) {
  const minutes = resolveMeetingMinutes(settings);
  if (minutes % 60 !== 0) {
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  }
  const hours = minutes / 60;
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

/**
 * Arma el bloque de "datos reales del servicio" que se inyecta en los prompts
 * del LLM (turno conversacional, preguntas sueltas durante el agendamiento y
 * mensajes posteriores a la reunión). La duración va primero y se compone a
 * partir del número configurado, para que cambiarlo en el panel actualice la
 * respuesta sin tener que editar el texto del hecho a mano.
 *
 * Recibe la fila de `whatsapp_bot_settings` tal como la devuelve
 * `WhatsappBotSettingsService.get()`.
 */
export function buildKnowledgeBlock(settings = {}) {
  const minutes = resolveMeetingMinutes(settings);

  // La duración va al FINAL a propósito: puesta primero, el modelo abría cada
  // explicación del servicio con la logística de la reunión ("La reunión dura
  // 10 minutos...") en vez de con lo que realmente hace Avantage.
  const facts = [...parseFaqFacts(settings.faq_knowledge)];

  // La identidad legal va SIEMPRE, la haya guardado el panel o no. Es lo
  // único con lo que Avan puede responderle a quien duda de que la empresa
  // exista ("no hay confianza", "¿están en Huancayo?"), y son datos de
  // registro, no texto comercial que el equipo deba mantener a mano: si
  // alguien recorta la FAQ desde el panel —como ya pasó: la fila guardada se
  // quedó sin el RUC y sin la dirección— el bot no puede quedarse mudo justo
  // en el mensaje que decide si el lead sigue o se va. Salen de COMPANY, la
  // misma fuente que firma cotizaciones y contratos, así que no pueden
  // desincronizarse de los documentos reales. Cada hecho se omite si la FAQ
  // del panel ya dice algo sobre eso (se busca su marca), para no repetirlo
  // con otras palabras.
  // Las sedes van DESPUÉS del domicilio legal y el orden importa: el marcador
  // del domicilio es su propia calle, que `OFFICES_FACT` también nombra, así
  // que puesto antes lo dejaría afuera — y con él se iría el "- Perú" que es
  // justo lo que contesta "¿no están en Perú?".
  const identityFacts = [
    [COMPANY.ruc, `Somos ${COMPANY.legalName}, empresa formal con RUC ${COMPANY.ruc}.`],
    [COMPANY.address, `Nuestra oficina está en ${COMPANY.address}, ${COMPANY.addressCity}.`],
    [COMPANY.offices[0].address, OFFICES_FACT],
    ['contrato', 'Trabajamos con un contrato de prestación de servicios.']
  ];
  for (const [marker, fact] of identityFacts) {
    const needle = String(marker).toLowerCase();
    if (!facts.some((f) => f.toLowerCase().includes(needle))) facts.push(fact);
  }

  // La duración va al final de todo, por lo dicho arriba.
  facts.push(`La reunión con el asesor dura aproximadamente ${minutes} minutos.`);

  return facts.map((f) => `- ${f}`).join('\n');
}
