/**
 * Señales críticas en el mensaje de un lead que NUNCA deben depender de que
 * el LLM las interprete bien.
 *
 * El motor conversacional (`ollamaService.converseAsAvan`) está afinado para
 * una cosa: entender el caso de tesis y llevar a la reunión. Eso hace que un
 * mensaje que se sale de ese guion —"nadie entró al Meet", "quiero hablar con
 * una persona", "ya te dije mi carrera"— compita con el objetivo del prompt, y
 * el modelo tiende a contestarlo con la siguiente pregunta de su agenda en vez
 * de atender lo que la persona realmente dijo. Son justo los mensajes donde
 * equivocarse cuesta más caro: un lead que ya está molesto y recibe otra
 * pregunta del bot no vuelve.
 *
 * Por eso se detectan acá, con reglas determinísticas, ANTES de gastar un
 * turno del LLM: sea cual sea lo que el modelo hubiera contestado, estos
 * mensajes se responden con un texto fijo y se pasan a una persona.
 *
 * El orden de prioridad importa: un mensaje puede disparar varias señales a la
 * vez ("estuve esperando y nadie entró, quiero hablar con alguien") y lo que
 * corresponde responder es lo más específico y lo que más pesa — la disculpa
 * por el plantón, no el acuse de "te paso con un asesor".
 */

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El asesor no apareció a una reunión ya agendada. Es la señal más urgente de
 * todas: la persona hizo el esfuerzo de agendar Y de conectarse, y el plantón
 * es nuestro. Responderle con cualquier otra cosa (y sobre todo con un
 * "¿agendamos otra?") se lee como que a nadie le importó.
 */
const NO_SHOW_RE = /nadie\s+(entro|se\s+conecto|aparecio|llego|vino|me\s+atendio|me\s+respondio)|no\s+(entro|entraron|aparecio|llego|llegaron|se\s+conecto)\s+nadie|estuve\s+esperando|quede\s+esperando|me\s+dejaron\s+(plantad|esperando|colgad)|sala\s+(?:estaba\s+|esta\s+)?vacia|no\s+(?:habia|hay)\s+nadie|el\s+asesor\s+no\s+(entro|llego|se\s+conecto|aparecio|me\s+atendio)|no\s+me\s+(atendieron|contestaron|respondieron|aceptan|acepto|aceptaron|dejan\s+entrar)/;

/**
 * El lead está EN la reunión AHORA MISMO: entró al Meet y espera que alguien
 * lo admita. No es un plantón —todavía— y tratarlo como tal es perder la
 * reunión por un minuto de diferencia: lo que necesita es que alguien del
 * equipo entre YA, no una disculpa.
 *
 * Es la señal más urgente del sistema y la única que se mide en minutos. Salió
 * de cuatro casos reales entre el 24/09 y el 03/10 —"Estoy en sala de espera",
 * "Me encuentro en la sala de espera", "Me estoy uniendo", "No hay nadie quien
 * me acepte..."— en los que el bot no respondió absolutamente nada y nadie del
 * equipo se enteró. Los cuatro habían hecho todo bien: agendaron y se
 * conectaron.
 *
 * Se evalúa ANTES que `noShow` porque los dos textos se parecen; la diferencia
 * es el tiempo verbal, y de eso depende si la reunión todavía se puede salvar.
 */
const WAITING_IN_MEETING_RE = /(?:estoy|me\s+encuentro|sigo|ya\s+estoy|aqui\s+estoy)\s+(?:en\s+(?:la\s+)?(?:sala|reunion|llamada|meet)|conectad|esperando\s+en)|en\s+(?:la\s+)?sala\s+de\s+espera|me\s+estoy\s+uniendo|ya\s+(?:me\s+uni|entre|ingrese|estoy\s+dentro)|ya\s+(?:estoy\s+)?en\s+el\s+(?:meet|link|enlace)|no\s+me\s+(?:aceptan|acepta|dejan\s+entrar)|(?:nadie|no\s+hay\s+nadie)\s+(?:que|quien)\s+me\s+(?:acepte|admita|deje\s+entrar)|esperando\s+(?:a\s+)?que\s+me\s+(?:acepten|admitan|dejen\s+entrar)/;

/**
 * True si el lead avisa que ya está esperando en la reunión.
 *
 * Vive FUERA de `SIGNAL_TESTS` porque no se trata como las demás señales
 * críticas: esas terminan en `handOffToAdvisor()` —que cierra la sesión y
 * mueve el lead a "transferido"— y acá no hay nada que transferir, hay una
 * reunión en curso. Lo que corresponde es avisar al equipo en el acto y
 * decirle a la persona que ya se está avisando, sin tocar su funnel.
 */
export function isWaitingInMeeting(text) {
  const clean = normalize(text);
  if (!clean || clean.length > 200) return false;
  return WAITING_IN_MEETING_RE.test(clean);
}

/**
 * Queja explícita sobre el servicio o la empresa.
 *
 * OJO con lo que NO está acá a propósito: "no sirve" / "no me sirve" se ve
 * como queja pero en esta conversación es, casi siempre, una respuesta normal
 * del agendamiento ("ese horario no me sirve"). Escalarla a un asesor sería
 * abandonar a alguien que solo estaba pidiendo otra hora.
 */
const COMPLAINT_RE = /\b(?:queja|reclamo|pesim[oa]|estafa\w*|fraude|timo)\b|mal\s+servicio|muy\s+mal\s+(?:servicio|trabajo|atencion)|(?:quiero|exijo)\s+(?:mi\s+)?(?:devolucion|reembolso)|me\s+devuelven\s+(?:mi\s+)?(?:dinero|plata)|estoy\s+(?:muy\s+)?(?:molest|indignad|furios|enojad)/;

/**
 * Pide explícitamente hablar con una persona. Se honra siempre y de
 * inmediato: discutirlo, o "resolverlo" con una pregunta más del bot, es la
 * forma más rápida de perder a alguien que ya dijo lo que quiere.
 *
 * "Asesor" NO cuenta como pedido de persona por sí solo: es vocabulario
 * normal del propio bot ("te paso con un asesor", "la reunión es con un
 * asesor"), así que una pregunta como "¿la reunión es para hablar con un
 * asesor?" escalaría sin que nadie lo haya pedido. Solo cuenta cuando viene
 * con un verbo de deseo explícito ("quiero hablar con un asesor") o en
 * imperativo ("pásame con un asesor").
 */
const HUMAN_REQUEST_RE = /hablar\s+con\s+(?:alguien|una\s+persona|un\s+humano|una\s+humana|un\s+encargado|un\s+representante)|pasa(?:me|rme)?\s+con\s+(?:alguien|un\s+asesor|una\s+persona|un\s+humano)|quiero\s+(?:hablar|conversar|comunicarme)\s+con\s+(?:alguien|una\s+persona|un\s+humano|un\s+asesor)|atencion\s+(?:humana|de\s+una\s+persona)|(?:una\s+)?persona\s+real|no\s+(?:quiero|deseo)\s+(?:hablar\s+con\s+)?(?:un\s+|una\s+)?(?:bot|robot|maquina|inteligencia\s+artificial)|apagar?\s+(?:tu|el)\s+bot/;

/**
 * El lead se queja de que el BOT no lo entiende o le repite las preguntas.
 * Es la señal de que la conversación ya se rompió: seguir insistiendo con el
 * flujo automático solo confirma lo que la persona está reclamando. Caso real
 * en producción: un lead escribió "apaga tu bot, necesito hablar con alguien
 * que sepa" después de que el bot le repitiera la misma evasiva tres veces.
 */
const FRUSTRATION_RE = /ya\s+te\s+(dije|conte|respondi|explique|habia\s+dicho)|ya\s+lo\s+(dije|conte|respondi)|no\s+me\s+(entiendes|estas\s+entendiendo|escuchas|estas\s+escuchando|lees|estas\s+leyendo)|te\s+estoy\s+diciendo\s+que|otra\s+vez\s+(lo\s+mismo|la\s+misma)|siempre\s+(dices|repites|preguntas)\s+lo\s+mismo|no\s+entiendes\s+nada|me\s+(preguntas|estas\s+preguntando)\s+lo\s+mismo|ya\s+te\s+respondi\s+eso/;

const SIGNAL_TESTS = [
  ['noShow', NO_SHOW_RE],
  ['complaint', COMPLAINT_RE],
  ['humanRequest', HUMAN_REQUEST_RE],
  ['frustration', FRUSTRATION_RE]
];

/**
 * Todas las señales presentes en el texto, como objeto de banderas. Útil para
 * la bitácora del panel (deja ver por qué se escaló una conversación).
 */
/**
 * El lead dice, sin ambigüedad, que ya no quiere seguir. No es una objeción
 * ("está caro", "ahora no puedo") sino un cierre: seguir mandándole horarios
 * —o el recordatorio "¿Sigues por ahí?" una hora después, como pasó— es
 * insistirle a alguien que ya se despidió.
 *
 * Se exige un mensaje CORTO: "no me interesa el horario de la tarde" o "no me
 * interesa el precio todavía" no son despedidas, y confundirlas costaría el
 * lead entero. Por eso también se descarta cualquier mensaje que hable de la
 * reunión, del precio o de la modalidad: ahí "no me interesa" califica a otra
 * cosa, no a la conversación.
 */
const NOT_INTERESTED_RE = /^(?:ya\s+)?(?:no\s+(?:me\s+interesa|estoy\s+interesad[oa]|deseo|quiero|necesito)|no\s+gracias|gracias\s*,?\s*(?:pero\s+)?no)\b|ya\s+(?:no\s+(?:me\s+interesa|quiero|deseo)|consegui|contrate|encontre|resolvi|tengo\s+(?:quien|asesor))/;

/** Palabras que hacen que "no me interesa" se refiera a OTRA cosa. */
const NOT_INTERESTED_EXCLUSIONS = /horario|hora\b|reunion|meet|llamada|telefon|precio|costo|cuanto|dia\b|fecha|manana|tarde|noche|descuento/;

export function saysNotInterested(text) {
  const clean = normalize(text);
  if (!clean || clean.length > 90) return false;
  if (NOT_INTERESTED_EXCLUSIONS.test(clean)) return false;
  return NOT_INTERESTED_RE.test(clean);
}

/**
 * Palabras que hacen SOSPECHAR una despedida, para decidir si vale la pena
 * gastar una consulta al LLM (`ollamaService.detectRefusal`) en este mensaje.
 *
 * `saysNotInterested` es deliberadamente estricto —exige que la despedida
 * ocupe el mensaje entero— y por eso el 28/09 se le siguieron ofreciendo
 * horarios a alguien que escribió "Buscaré en otro lado gracias igual" y
 * después "Ya le comenté que no": ninguna de las dos coincide con el regex, y
 * el bot insistió tres mensajes más.
 *
 * Este filtro es lo contrario: amplio a propósito, con muchos falsos positivos
 * ("no sé si el jueves pueda" lo dispara). No decide nada — solo evita
 * preguntarle al LLM por cada "ok" y cada correo. Quien decide de verdad es el
 * LLM, que sí distingue una objeción de una despedida.
 */
const MAYBE_REFUSAL_RE = /\bno\b|\bnop\b|\bnah\b|otro\s+lado|otra\s+parte|otro\s+sitio|por\s+mi\s+cuenta|deja(?:lo|me)?\s+as[ií]|olvida(?:lo)?|ya\s+(?:consegui|contrate|encontre|resolvi|tengo)|gracias\s+igual|igual\s+gracias|mas\s+adelante|otro\s+ciclo|proximo\s+ciclo|despues\s+vemos|lo\s+dejo|lo\s+dejamos|no\s+gracias|ya\s+no/;

export function mayBeRefusal(text) {
  const clean = normalize(text);
  if (!clean || clean.length > 160) return false;
  return MAYBE_REFUSAL_RE.test(clean);
}

export function detectLeadSignals(text) {
  const clean = normalize(text);
  const signals = {};
  for (const [name, re] of SIGNAL_TESTS) signals[name] = re.test(clean);
  return signals;
}

/**
 * La señal de MAYOR prioridad presente en el texto, o null si no hay ninguna.
 * El orden de `SIGNAL_TESTS` es el orden de prioridad — ver la nota de arriba
 * sobre mensajes que disparan varias a la vez.
 */
export function criticalSignal(text) {
  const clean = normalize(text);
  for (const [name, re] of SIGNAL_TESTS) {
    if (re.test(clean)) return name;
  }
  return null;
}

/**
 * Duda sobre la legitimidad de la empresa: "¿no están en Perú?", "en tu
 * perfil dice España", "¿esto es real?", "no me da confianza", "¿dónde
 * quedan?".
 *
 * NO es una señal crítica y por eso vive fuera de `SIGNAL_TESTS`: escalarla a
 * una persona sería tratar como incendio lo que casi siempre es una pregunta
 * razonable, y de paso inundaría al equipo con cada "¿dónde están ubicados?".
 * Lo que necesita es lo contrario de una evasiva: datos verificables (razón
 * social, RUC, dirección) en un mensaje que no traiga el cierre pegado
 * detrás — ver `whatsappBotCopy.trustCredentials()`.
 *
 * Caso real: "No está en Perú?" seguido de "En tu perfil dice España". El bot
 * contestó "Sin problema, somos Avantage Group con oficina en Perú pero
 * trabajamos con clientes en diferentes países" y, en la MISMA burbuja, le
 * volvió a pedir que eligiera horario. El lead no volvió a escribir. Quien
 * pregunta esto está evaluando si lo están estafando: el turno se gasta
 * entero en responderle, y el horario se vuelve a pedir después.
 *
 * "Estafa"/"fraude" no están acá a propósito: eso ya no es una duda sino una
 * acusación, y `COMPLAINT_RE` lo escala a una persona (que es lo correcto).
 */
const TRUST_DOUBT_RE = /no\s+(?:estan?|son)\s+(?:de|en)\s+peru|(?:tu|el|su)\s+perfil\s+dice|(?:numero|prefijo|codigo)\s+(?:es\s+)?(?:de\s+)?(?:otro\s+pais|extranjero|españa|espana|mexico|colombia)|de\s+(?:que|donde)\s+pais\s+(?:son|eres|escriben|me\s+escribes)|donde\s+(?:quedan|estan)\s+(?:ubicad|situad)|donde\s+(?:queda|esta)\s+(?:su|la)\s+oficina|(?:esto|esta\s+empresa|su\s+empresa|ustedes)\s+(?:es|son)\s+real(?:es)?|es\s+(?:esto\s+)?real|son\s+(?:una\s+)?empresa\s+(?:formal|real|legal)|tienen\s+(?:ruc|oficina|local|direccion)|(?:estan|estas)\s+registrad|no\s+(?:me\s+)?(?:da|dan|inspira)\s+confianza|(?:me\s+)?(?:da|genera)\s+desconfianza|no\s+(?:confio|me\s+fio)|(?:son|es|seran)\s+confiables?|como\s+(?:se|puedo\s+saber)\s+(?:que|si)\s+(?:no\s+)?(?:es|son|me)\s+(?:seguro|confiable|estafa|real)|no\s+los?\s+conozco|nunca\s+(?:los\s+|les\s+)?(?:he\s+)?(?:escuchado|oido|visto|vi)\b|tienen\s+(?:pagina|web|sitio|redes)/;

/**
 * True si el mensaje pone en duda que la empresa sea real o esté en Perú.
 * Se evalúa antes que el LLM: la respuesta a esto no puede quedar sujeta a lo
 * que el modelo improvise, porque es el mensaje que decide si el lead sigue.
 */
export function isTrustDoubt(text) {
  return TRUST_DOUBT_RE.test(normalize(text));
}
