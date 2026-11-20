import { normalizeThesisSituation } from './leadQualification.js';

/**
 * Memoria estructurada de la conversación del bot.
 *
 * Los cinco datos con los que de verdad se atiende un caso de tesis
 * —**carrera, universidad, nivel, etapa y la consulta principal**— vivían
 * solo en el JSON `whatsapp_bot_sessions.answers`, y eso tiene dos agujeros
 * que se ven apenas se mira una conversación real:
 *
 * (1) **No llegaban a la ficha del lead.** `_syncLeadProfile()` escribía la
 *     carrera, la universidad y la terna académica (condición, ciclo,
 *     situación) y dejaba fuera el **nivel** (`answers.level`), la **etapa**
 *     (`answers.stage`) y la **consulta principal** (`answers.problem`), que
 *     son justamente los tres que el asesor necesita antes de la reunión. El
 *     lead se quedaba con `topic = "Consulta por WhatsApp de 51987…"` para
 *     siempre, teniendo el tema escrito tres mensajes más arriba.
 *
 * (2) **Se perdían al reiniciar la sesión.** `resetSession()` borra la fila
 *     —lo hace el panel, y también el barrido al congelar y reabrir—, así que
 *     un contacto que volvía después de eso era interrogado de cero sobre lo
 *     que ya había contestado. La ficha del lead sí sobrevive a todo eso, y de
 *     ahí la otra mitad de este módulo: `rehydrateAnswers()`.
 *
 * O sea que la memoria son dos caminos entre los MISMOS cinco datos y no uno:
 * la sesión escribe a la ficha y la ficha siembra la sesión nueva. Vive en un
 * módulo puro y aparte porque de ese mapeo dependen las dos direcciones, y con
 * una copia en cada punta el día que cambie un nombre de campo la ida seguiría
 * guardando y la vuelta dejaría de leer, sin que nada falle a la vista.
 */

/**
 * `answers.stage` (lo que el formulario y el LLM entienden del avance) contra
 * el catálogo cerrado de `THESIS_SITUATIONS`, que es el mismo selector que la
 * Base de Datos de leads: lo que no calza con el catálogo no se guarda, por la
 * misma razón que `normalizeThesisSituation` existe — un valor huérfano no se
 * puede editar después desde la pantalla.
 */
const STAGE_TO_SITUATION = {
  sin_tema: 'Tesis sin avance',
  proyecto: 'Proyecto / Plan de Tesis',
  capitulos: 'Borrador de Tesis (Capítulos 1-3)',
  final: 'Tesis Completa / En Revisión'
};

/**
 * El servicio que pide, cuando no dijo en qué punto está. Es un respaldo y no
 * un sinónimo: "quiero levantar observaciones" dice dónde está la tesis
 * (terminada y revisada) sin nombrar ninguna etapa, y sin esto esa ficha
 * llegaba al asesor sin una sola pista del avance.
 */
const NEED_TO_SITUATION = {
  correcciones: 'Levantamiento de Observaciones'
};

/**
 * Lo que `leads.topic` dice cuando NADIE escribió todavía el tema: son los
 * textos que generan los caminos de alta automática. Se reconocen para poder
 * pisarlos con la consulta real del contacto —y solo a ellos—: un `topic` que
 * alguien escribió o corrigió a mano es un dato del equipo, y el bot no tiene
 * por qué saber más que la persona que lo atendió.
 *
 * `topic` es `notNullable`, así que "vacío" también llega como cadena vacía.
 */
const PLACEHOLDER_TOPIC_RE = /^(?:consulta\s+por\s+whatsapp\s+de\b|asesor[ií]a\s+(?:de\s+tesis\s*$|para\b)|tema\s+de\s+tesis\s+por\s+definir\s*$|prospecto\b)/i;

/** True si `leads.topic` sigue siendo el texto que puso el alta automática. */
export function isPlaceholderTopic(topic) {
  const clean = String(topic || '').trim();
  if (!clean) return true;
  return PLACEHOLDER_TOPIC_RE.test(clean);
}

/**
 * La etapa de la tesis que se desprende de la sesión, o null si no hay con qué
 * saberla. Prioridad: lo que ya está normalizado en la sesión, después la
 * etapa declarada, y de último el servicio que pide.
 */
export function thesisSituationFrom(answers = {}) {
  const already = normalizeThesisSituation(answers.thesisSituation);
  if (already) return already;
  const fromStage = STAGE_TO_SITUATION[answers.stage];
  if (fromStage) return fromStage;
  return NEED_TO_SITUATION[answers.need] || null;
}

/**
 * La consulta principal: el tema o problema que el contacto vino a resolver.
 * Se recorta a lo que entra en `leads.topic` (500) y se descarta lo que no
 * dice nada —"sí", "ok"—, que es lo que dejaría la ficha peor que el marcador.
 */
export function mainInquiryFrom(answers = {}) {
  const problem = String(answers.problem || '').trim().replace(/\s+/g, ' ');
  if (problem.length < 4) return null;
  return problem.slice(0, 500);
}

/**
 * Los campos de la ficha del lead que salen de la memoria de la sesión.
 *
 * Recibe el lead porque de él depende UNA decisión: si la consulta principal
 * se escribe o no (ver `isPlaceholderTopic`). Todo lo demás se escribe sin
 * preguntar, porque `updateLead` ignora lo que llega en `undefined` y acá solo
 * viaja lo que la conversación sí averiguó.
 */
export function leadProfilePayload(answers = {}, lead = null) {
  const payload = {};

  if (answers.field) payload.fieldOfStudy = answers.field;
  if (answers.university) payload.university = answers.university;
  if (answers.level) payload.academicLevel = answers.level;
  if (answers.academicStatus) payload.academicStatus = answers.academicStatus;
  if (answers.cycle) payload.academicCycle = answers.cycle;

  const situation = thesisSituationFrom(answers);
  if (situation) payload.thesisSituation = situation;

  const inquiry = mainInquiryFrom(answers);
  if (inquiry && isPlaceholderTopic(lead?.topic)) payload.topic = inquiry;

  return payload;
}

/**
 * Valores con los que nace una ficha y que NO son un dato: `field_of_study`
 * arranca en "General" y el nombre en "Prospecto". Sembrarlos haría que el bot
 * no le pregunte la carrera a nadie.
 */
const LEAD_DEFAULT_VALUES = new Set(['general', 'prospecto', 'sin especificar', '']);

/**
 * El camino de vuelta: la memoria que una sesión nueva hereda de la ficha.
 *
 * Solo los datos que el contacto ya nos dio y que el bot volvería a preguntar.
 * **No** se siembran los marcadores internos de la conversación (los `__*`:
 * horario propuesto, intentos gastados, avisos ya mandados) — esos son del
 * hilo que terminó, y arrastrarlos dejaría la sesión nueva creyéndose a mitad
 * de un agendamiento que ya no existe.
 */
export function rehydrateAnswers(lead = null) {
  if (!lead) return {};
  const answers = {};

  const field = String(lead.field_of_study || '').trim();
  if (field && !LEAD_DEFAULT_VALUES.has(field.toLowerCase())) answers.field = field;

  const university = String(lead.university || '').trim();
  if (university && !LEAD_DEFAULT_VALUES.has(university.toLowerCase())) answers.university = university;

  const level = String(lead.academic_level || '').trim();
  if (level && !LEAD_DEFAULT_VALUES.has(level.toLowerCase())) answers.level = level;

  const situation = normalizeThesisSituation(lead.thesis_situation);
  if (situation) answers.thesisSituation = situation;

  if (lead.academic_status) answers.academicStatus = lead.academic_status;
  if (lead.academic_cycle) answers.cycle = lead.academic_cycle;

  if (!isPlaceholderTopic(lead.topic)) answers.problem = String(lead.topic).trim();

  // El alta automática rellena el correo con un marcador para cumplir el
  // `notNullable` de la tabla; sembrarlo haría que el bot no pida el correo
  // real y la reunión se agende contra una dirección que no existe.
  const email = String(lead.email || '').trim();
  if (email.includes('@') && !/^(?:sin-correo|no-?reply|pendiente|prospecto)/i.test(email)) {
    answers.email = email;
  }

  return answers;
}

/**
 * Qué recuerda el bot de este contacto, un campo por dato. Es lo que se
 * publica en la bitácora y lo que deja comprobar de un vistazo si la memoria
 * se llenó: una sesión que llegó al agendamiento con cuatro de los cinco datos
 * en blanco es un perfilamiento que no ocurrió.
 */
export function memorySnapshot(answers = {}) {
  return {
    carrera: answers.field || null,
    universidad: answers.university || null,
    nivel: answers.level || null,
    etapa: thesisSituationFrom(answers),
    consulta: mainInquiryFrom(answers)
  };
}

/** Cuántos de los cinco datos de la memoria están completos. */
export function memoryCompleteness(answers = {}) {
  const facts = Object.values(memorySnapshot(answers));
  return { known: facts.filter(Boolean).length, total: facts.length };
}
