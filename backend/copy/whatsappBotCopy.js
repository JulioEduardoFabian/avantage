/**
 * Textos determinísticos que Avan manda por WhatsApp — el equipo comercial
 * los edita acá sin tocar la lógica del bot (`whatsappBotService.js`). Los
 * textos que redacta el LLM turno a turno (la conversación libre) no viven
 * aquí; esto es solo para los mensajes de negocio fijos donde la redacción
 * exacta importa (precio, handoffs, etc.) — se va completando fase a fase.
 */

import { COMPANY } from '../services/quotationDocument.js';

/**
 * F1 — Primera vez que un lead pregunta por el precio: NO se da un número ni
 * un rango (decisión del equipo comercial: el precio se reserva y el foco
 * pasa a conseguir la reunión) — se explica que depende del caso y se pone
 * el peso en agendar la reunión gratuita con el asesor, que es quien lo
 * detalla.
 */
export function priceAnchor(contactName, durationLabel) {
  const hello = contactName ? `¡Hola, ${contactName}! ` : '';
  // La duración llega desde el panel (`meetingDurationLabel`), no escrita a
  // mano acá: este texto decía "20 min" mientras el panel decía otra cosa, y
  // el lead recibía dos duraciones distintas en la misma conversación.
  const duration = durationLabel ? `dura ${durationLabel} ` : '';
  return (
    `${hello}El costo depende de tu carrera, tu nivel académico y el alcance de tu tesis, así que prefiero que te lo detalle el asesor con el número exacto para tu caso 🙌\n\n` +
    `Para eso es justo la reunión: es *totalmente gratis*, ${duration}y no te compromete a nada — ahí te resuelve el precio y todas tus dudas. ¿Coordinamos?`
  );
}

/** F1 — Segunda vez que insiste con el precio: texto distinto al de la 1ª + handoff. */
export function priceInsistedHandoff() {
  return 'Entiendo que quieres el número exacto ya 🙌 Te paso directo con el asesor para que te lo confirme y resuelva tus dudas al detalle.';
}

/**
 * F1 — Insiste con el precio durante el agendamiento (después de haber
 * recibido ya el ancla de precio en la conversación libre): texto distinto
 * a los dos de arriba, para que nunca se repita la misma evasiva dos veces
 * en una misma conversación.
 */
export function priceInsistedDuringScheduling() {
  return 'El precio y las formas de pago te los explica el asesor con calma. Te lo paso ahora para que lo coordinen directamente 🙌';
}

/**
 * Acuse para las señales críticas de `leadSignals.js` (plantón en la reunión,
 * queja, pedido explícito de hablar con una persona, o frustración con el
 * propio bot). Va ANTES del mensaje de transferencia de `handOffToAdvisor`,
 * que es genérico: este es el que reconoce lo que la persona acaba de decir.
 *
 * Cada texto se escribió con una regla en mente: reconocer el problema y
 * asumirlo, sin excusas y sin pedirle nada más a alguien que ya está molesto.
 * En particular, NUNCA se le responde con una pregunta ni se le ofrece
 * reagendar: a quien se quedó esperando en un Meet vacío, un "¿agendamos
 * otra?" se le lee como que nadie registró lo que pasó.
 */
export function criticalSignalAck(signal) {
  switch (signal) {
    case 'noShow':
      return 'Lamento muchísimo que te hayas quedado esperando, eso no debió pasar 🙏 Ya estoy avisando al equipo para que lo revisen ahora mismo.';
    case 'complaint':
      return 'Lamento que hayas tenido esta experiencia, y haces bien en escribirnos 🙏 Paso tu caso con prioridad para que lo revisen.';
    case 'humanRequest':
      return 'Claro que sí, sin problema.';
    // El bot reconociendo su propia falla: es preferible a seguir insistiendo
    // con el flujo automático, que es exactamente lo que la persona está
    // reclamando. Caso real: un lead escribió "apaga tu bot, necesito hablar
    // con alguien que sepa" después de recibir tres veces la misma evasiva.
    case 'frustration':
      return 'Tienes razón y te pido disculpas: me estoy repitiendo en vez de ayudarte 🙏 Mejor que siga una persona del equipo.';
    default:
      return 'Déjame pasarte con una persona del equipo para que te ayude mejor 🙌';
  }
}

/**
 * Filtro de calificación (ver leadQualification.js): preguntas por el dato
 * que decide si se puede agendar, y cierres amables para quien no califica.
 * No se ofrece reunión en los cierres: el asesor no puede atender esos casos.
 */
export function askCycle() {
  return '¿En qué ciclo estás actualmente? 📚';
}

export function askInstituteField() {
  return '¿Cuál es tu carrera o especialidad en el instituto?';
}

export function lowCycleRejection() {
  return 'Genial que ya estés pensando en tu tesis desde ahora 💪 Trabajamos con alumnos a partir de 8.º ciclo, que es cuando la mayoría de universidades habilita el proceso de tesis. Cuando llegues ahí, escríbeme y te ayudamos. ¡Éxitos!';
}

export function instituteFieldRejection() {
  return 'Gracias por escribirnos 🙌 En institutos solo podemos evaluar casos de administración, negocios o educación, y por ahora tu especialidad no está dentro de las áreas que atendemos. ¡Te deseamos mucho éxito en tu proceso! 💪';
}

/**
 * El lead duda de que la empresa sea real o de que esté en Perú (ver
 * `isTrustDoubt` en leadSignals.js). Tres decisiones deliberadas acá:
 *
 * 1. NO se minimiza la duda. "Sin problema" —lo que el bot contestaba antes—
 *    le dice a alguien que está evaluando si lo están estafando que su
 *    pregunta no era importante.
 * 2. Solo datos verificables, no adjetivos. "Somos una empresa formal" no lo
 *    puede comprobar nadie; un RUC que se consulta en SUNAT, sí. Salen de
 *    COMPANY, la misma fuente que firma cotizaciones y contratos, así que no
 *    pueden contradecir a los documentos reales.
 * 3. El texto NO trae el cierre pegado. Volver a pedir el horario en la misma
 *    burbuja es lo que confirma la sospecha de que habla con un vendedor
 *    automático al que la duda le estorba — quien llama se encarga de que
 *    este turno se gaste entero en responder.
 *
 * Tampoco se inventa por qué el perfil de WhatsApp puede figurar con otro
 * país: no lo sabemos, y una explicación falsa acá cuesta más que no darla.
 */
export function trustCredentials() {
  return (
    'Es una duda totalmente válida, y prefiero que lo verifiques tú mismo antes de avanzar 🙌\n\n' +
    `Somos *${COMPANY.legalName}*, con RUC *${COMPANY.ruc}* — lo puedes consultar en la página de SUNAT.\n` +
    `📍 Nuestra oficina está en ${COMPANY.address}, ${COMPANY.addressCity}.\n` +
    `🌐 ${COMPANY.website}\n\n` +
    'El trabajo se formaliza con un contrato de prestación de servicios. Si quieres revisar algo más antes de seguir, dímelo con confianza.'
  );
}

/**
 * Vuelve a dudar después de que ya se le dieron las credenciales. Insistir
 * con los mismos datos no va a cerrar una desconfianza que sigue ahí: lo que
 * la cierra es una persona. Se le pasa a un asesor.
 */
export function trustDoubtHandoff() {
  return 'Entiendo que quieras estar seguro antes de avanzar, y haces bien en preguntarlo 🙌';
}

/**
 * El bot dejó un mensaje del contacto sin responder (una caída del LLM, un
 * envío fallido, un turno que se perdió) y el barrido lo detecta después.
 *
 * Va ANTES de la respuesta real, no en lugar de ella: el turno se reintenta
 * igual. Y la demora se reconoce como propia — el mensaje que salía antes en
 * esta situación era el recordatorio de inactividad ("¿Sigues por ahí?"), que
 * le preguntaba al contacto por un silencio que era del bot.
 */
export function missedReplyApology() {
  return 'Perdona la demora 🙏';
}

/**
 * Segundo turno perdido con el mismo contacto: el reintento automático
 * tampoco salió. No se intenta una tercera vez — lo que falla ya no se
 * arregla solo. Como los demás acuses previos a un handoff, este NO anuncia
 * la transferencia: eso lo dice `handOffToAdvisor` en el mensaje siguiente.
 */
export function missedReplyHandoff() {
  return 'Perdona la demora, se me quedó tu mensaje sin responder 🙏';
}

/**
 * Primera pregunta a un lead que llegó del formulario de un anuncio.
 *
 * Antes acá salía directamente el menú de horarios: saludo, pitch y lista de
 * 4–5 franjas, los tres en el mismo minuto. El 23/09 lo recibieron cuatro
 * leads y no respondió ninguno — la primera pregunta de la conversación era
 * la decisión más cara de todo el funnel (comprometer un horario con un
 * asesor), pedida a alguien que todavía no sabe cuánto cuesta ni con quién
 * hablaría, y encima detrás de un muro de texto de un desconocido.
 *
 * Esto es lo que va en su lugar: UNA pregunta cerrada, que se contesta con
 * un "sí". Los horarios recién salen cuando ese "sí" llegó. Dos cosas se
 * dicen antes de pedir nada, porque las dos bajan el costo de contestar:
 *  - que la reunión es GRATIS y no compromete (el motivo más común para no
 *    contestar es no saber en qué se está metiendo), y
 *  - lo que entendimos de su formulario, que es lo único que prueba que
 *    alguien leyó lo que escribió.
 *
 * NO se menciona acá el descuento por Google Meet: es un 10% sobre un precio
 * que todavía no se le dijo, así que no incentiva nada e introduce el tema
 * del costo justo antes de pedirle el sí. Se dice al elegir la modalidad.
 */
export function warmupAsk({ understood = '', purpose = '', durationLabel = '' } = {}) {
  const opener = understood ? `Perfecto: ${understood}. ` : '';
  const duration = durationLabel ? ` de ${durationLabel}` : ' corta';
  return (
    `${opener}Te cuento: lo siguiente sería una reunión${duration} con uno de nuestros asesores para ${purpose}. ` +
    'Es *totalmente gratis* y no te compromete a nada 🙌\n\n' +
    '¿Te parece si la coordinamos? Respóndeme *sí* y te paso los horarios disponibles.'
  );
}

/**
 * El lead contestó que no al paso de arriba. No se insiste con horarios —
 * acaba de decir que no— pero tampoco se cierra la conversación como en
 * `notInterestedFarewell`: dijo que no a la REUNIÓN, no al servicio. Se le
 * deja la pregunta abierta más barata que hay, que es contar qué necesita.
 */
export function warmupDeclined(contactName) {
  const name = contactName ? `, ${contactName}` : '';
  return `Sin problema${name} 🙌 Si prefieres, cuéntame por acá en qué estás y te oriento sin necesidad de agendar nada. ` +
    'Y si más adelante quieres la reunión, me dices y la coordinamos.';
}

/**
 * El lead dijo que ya no le interesa. Se le agradece, se cierra y NO se le
 * vuelve a escribir: la conversación queda marcada como terminada para que el
 * barrido de inactividad no le mande "¿Sigues por ahí?" una hora después
 * (caso real del 22/09). La puerta queda abierta sin pedirle nada.
 */
export function notInterestedFarewell(contactName) {
  const name = contactName ? `, ${contactName}` : '';
  return `Entendido${name}, gracias por avisarme 🙌 Cierro por acá para no molestarte más. ` +
    'Si más adelante retomas tu tesis, escríbeme a este mismo número y te atiendo al toque.';
}

/**
 * El lead sí quiere la asesoría, pero no ahora ("el próximo ciclo", "cuando
 * junte el dinero"). Se cierra sin insistir y SIN prometerle que alguien lo va
 * a contactar: quien decide cuándo retomar es él. Es distinto de
 * `notInterestedFarewell` en que no da por perdido el interés, y distinto del
 * texto de transferencia en que nadie lo va a llamar hoy.
 */
export function postponedFarewell(contactName) {
  const name = contactName ? `, ${contactName}` : '';
  return `Perfecto${name}, lo dejamos para cuando te acomode 🙌 No te escribo más por ahora. ` +
    'Cuando quieras retomarlo me avisas por acá y seguimos desde donde lo dejamos.';
}
