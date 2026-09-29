import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappBotService } from '../whatsappBotService.js';
import { mayBeRefusal, saysNotInterested } from '../leadSignals.js';
import { postponedFarewell } from '../../copy/whatsappBotCopy.js';

/**
 * Los cuatro fallos del 28/09/2026 que costaron un lead cada uno. Cada bloque
 * de acá abajo reproduce el mensaje REAL que se perdió, para que el arreglo no
 * se pueda deshacer sin que una prueba lo diga.
 *
 * Las pruebas construyen el servicio con `Object.create(prototype)` y le
 * inyectan dobles: los métodos que se ejercitan no tocan la base de datos ni
 * Google Calendar, solo coordinan otras llamadas del propio servicio.
 */
function makeBot({ ollama = {}, calendar = {}, session = null } = {}) {
  const bot = Object.create(WhatsappBotService.prototype);
  const sent = [];
  const logged = [];
  let saved = session;

  bot.sent = sent;
  bot.logged = logged;
  bot.ollamaService = ollama;
  bot.googleCalendarService = calendar;
  // El `send` real lleva la cuenta de lo enviado por contacto, y `_runTurnGuarded`
  // compara ese contador antes y después del turno: el doble tiene que hacer lo
  // mismo o la red de seguridad creería que el turno se quedó callado.
  bot.sendCounter = new Map();
  bot.send = async (waId, text) => {
    sent.push(text);
    bot.sendCounter.set(waId, (bot.sendCounter.get(waId) || 0) + 1);
  };
  bot.logActivity = (entry) => { logged.push(entry); };
  bot.updateSession = async (waId, patch) => { saved = { ...(saved || {}), ...patch }; };
  bot.getSession = async () => saved;
  bot.savedSession = () => saved;
  return bot;
}

const SLOT_MORNING = { date: '2026-09-28', startTime: '2026-09-28T14:30:00.000Z', label: 'Lun, 28 set, 9:30 a.m.' };
const SLOT_NOON = { date: '2026-09-28', startTime: '2026-09-28T17:30:00.000Z', label: 'Lun, 28 set, 12:30 p.m.' };
const SLOT_EVENING = { date: '2026-09-28', startTime: '2026-09-28T23:30:00.000Z', label: 'Lun, 28 set, 6:30 p.m.' };

// ---------------------------------------------------------------------------
// Fallo 04 — "salgo de la universidad un poco tarde"
// El bloque de 6:30 p.m. estaba en la lista que el lead tenía delante y
// recibió "No te entendí bien 🤔" con la misma lista de nuevo.
// ---------------------------------------------------------------------------

test('una disponibilidad dicha en palabras que calza con UN horario lo propone directo', async () => {
  const bot = makeBot({
    ollama: {
      matchSlotsToConstraint: async () => ({
        understood: true, fits: [2], constraint: 'sales tarde de la universidad', source: 'llm'
      })
    }
  });

  let booked = null;
  bot.bookSlot = async (waId, slot) => { booked = slot; };

  const answers = { __scheduling: {} };
  const scheduling = { slots: [SLOT_MORNING, SLOT_NOON, SLOT_EVENING] };

  const handled = await bot._answerAvailabilityConstraint(
    '51918974198', answers, scheduling, 'salgo de la universidad un poco tarde'
  );

  assert.equal(handled, true, 'el mensaje debe quedar atendido, no caer en "no te entendí"');
  assert.equal(booked?.label, 'Lun, 28 set, 6:30 p.m.', 'se propone el único bloque que le calza');
  assert.equal(bot.sent.length, 0, 'no se le manda una lista de un solo elemento: bookSlot hace la confirmación');
});

test('una disponibilidad que calza con VARIOS horarios muestra solo esos y nombra la restricción', async () => {
  const bot = makeBot({
    ollama: {
      matchSlotsToConstraint: async () => ({
        understood: true, fits: [1, 2], constraint: 'trabajas en la mañana', source: 'llm'
      })
    }
  });

  const answers = { __scheduling: {} };
  const scheduling = { slots: [SLOT_MORNING, SLOT_NOON, SLOT_EVENING], availableDays: ['2026-09-28'] };

  const handled = await bot._answerAvailabilityConstraint('51918974198', answers, scheduling, 'trabajo en la mañana');

  assert.equal(handled, true);
  assert.equal(bot.sent.length, 1);
  const reply = bot.sent[0];
  assert.match(reply, /trabajas en la mañana/, 'la respuesta nombra la restricción en vez de mandar una lista muda');
  assert.match(reply, /12:30 p\.m\./);
  assert.match(reply, /6:30 p\.m\./);
  assert.doesNotMatch(reply, /9:30 a\.m\./, 'el horario que NO le calza no se vuelve a ofrecer');
  assert.doesNotMatch(reply, /no te entend/i);
});

test('un mensaje que no dice nada sobre cuándo puede sigue cayendo en el "no te entendí"', async () => {
  const bot = makeBot({
    ollama: {
      matchSlotsToConstraint: async () => ({ understood: false, fits: [], constraint: null, source: 'llm' })
    }
  });

  const handled = await bot._answerAvailabilityConstraint(
    '51918974198', { __scheduling: {} }, { slots: [SLOT_MORNING] }, 'ok gracias'
  );

  assert.equal(handled, false, 'devuelve false para que quien llama responda como siempre');
  assert.equal(bot.sent.length, 0);
});

test('sin horarios a la vista no se le pregunta nada al LLM', async () => {
  let asked = false;
  const bot = makeBot({
    ollama: { matchSlotsToConstraint: async () => { asked = true; return { understood: true, fits: [], constraint: null }; } }
  });

  const handled = await bot._answerAvailabilityConstraint('51918974198', { __scheduling: {} }, { slots: [] }, 'salgo tarde');

  assert.equal(handled, false);
  assert.equal(asked, false, 'sin lista que comparar la consulta al LLM no aporta nada');
});

test('si el LLM falla, la restricción no tumba el turno', async () => {
  const bot = makeBot({
    ollama: { matchSlotsToConstraint: async () => { throw new Error('timeout'); } }
  });

  const handled = await bot._answerAvailabilityConstraint(
    '51918974198', { __scheduling: {} }, { slots: [SLOT_MORNING] }, 'salgo tarde'
  );

  assert.equal(handled, false, 'se sigue al camino de siempre en vez de propagar el error');
});

// ---------------------------------------------------------------------------
// Fallo 01 — el "sí" que llegó en su propia burbuja
// "Si esta bien.." y "Me envía enlace por este numero porfavor" abrieron dos
// turnos: el primero soltó el bloque y la reunión de 6:30 p.m. se perdió.
// ---------------------------------------------------------------------------

test('un "sí" tardío reserva el bloque que se le había propuesto', async () => {
  const bot = makeBot();
  let confirmed = null;
  bot.confirmSlot = async (waId, slot) => { confirmed = slot; };

  // El bloque tiene que estar en el futuro para que `usableProposedSlot` lo dé
  // por vigente: se calcula sobre la hora real de ejecución de la prueba.
  const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const scheduling = { lastProposed: { ...SLOT_EVENING, startTime: future } };
  const answers = { __scheduling: scheduling };

  const handled = await bot._bookLastProposedIfAffirmative('51975898607', answers, scheduling, 'si esta bien');

  assert.equal(handled, true);
  assert.equal(confirmed?.label, 'Lun, 28 set, 6:30 p.m.');
  assert.equal(scheduling.lastProposed, undefined, 'el bloque rescatado no queda para un segundo rescate');
});

test('un bloque ya vencido no se rescata', async () => {
  const bot = makeBot();
  let confirmed = null;
  bot.confirmSlot = async (waId, slot) => { confirmed = slot; };

  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const scheduling = { lastProposed: { ...SLOT_EVENING, startTime: past } };

  const handled = await bot._bookLastProposedIfAffirmative('51975898607', { __scheduling: scheduling }, scheduling, 'si');

  assert.equal(handled, false);
  assert.equal(confirmed, null);
});

test('sin una afirmación clara no se reserva nada', async () => {
  const bot = makeBot();
  let confirmed = null;
  bot.confirmSlot = async (waId, slot) => { confirmed = slot; };

  const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const scheduling = { lastProposed: { ...SLOT_EVENING, startTime: future } };

  const handled = await bot._bookLastProposedIfAffirmative(
    '51975898607', { __scheduling: scheduling }, scheduling, 'mejor el jueves'
  );

  assert.equal(handled, false, 'reservar ante la duda es justo lo que el paso de confirmación evita');
  assert.equal(confirmed, null);
});

// El paso de confirmación espera más que el resto: es donde la respuesta llega
// partida en dos burbujas con más frecuencia.
test('el paso de confirmación agrupa por más tiempo que los demás pasos', () => {
  const bot = Object.create(WhatsappBotService.prototype);
  const confirm = bot.debounceForStatus('scheduling_confirm');
  const other = bot.debounceForStatus('scheduling_time');
  assert.ok(confirm > other, `la espera al confirmar (${confirm} ms) debe superar la de elegir horario (${other} ms)`);
});

// ---------------------------------------------------------------------------
// Fallo 02 — los tres rechazos ignorados
// "Buscaré en otro lado gracias igual" y "Ya le comenté que no" no coincidían
// con el regex estricto, así que el bot siguió ofreciendo horarios.
// ---------------------------------------------------------------------------

test('las despedidas reales del 28/09 pasan el pre-filtro que consulta al LLM', () => {
  assert.equal(saysNotInterested('Buscaré en otro lado gracias igual'), false,
    'el regex estricto NO las reconoce: es justo el motivo por el que hace falta el LLM');
  assert.equal(saysNotInterested('Ya le comenté que no'), false);

  assert.equal(mayBeRefusal('Buscaré en otro lado gracias igual'), true);
  assert.equal(mayBeRefusal('Ya le comenté que no'), true);
  assert.equal(mayBeRefusal('No'), true);
});

test('el pre-filtro no gasta una consulta al LLM en mensajes que siguen la conversación', () => {
  assert.equal(mayBeRefusal('Medicina humana, San Antonio Abad del Cusco'), false);
  assert.equal(mayBeRefusal('1'), false);
  assert.equal(mayBeRefusal('Si esta bien.. Me envía enlace por este numero porfavor'), false);
  assert.equal(mayBeRefusal('kargalc76@gmail.com'), false);
});

test('una objeción con la palabra "no" la decide el LLM, y el LLM dice que sigue', async () => {
  const bot = makeBot({
    ollama: { detectRefusal: async () => ({ refusing: false, kind: null, source: 'llm' }) }
  });

  // "no sé si el jueves me alcance" dispara el pre-filtro (tiene "no") pero es
  // un lead negociando el horario, no despidiéndose.
  const closed = await bot._closedAfterRefusal('51918974198', 'no sé si el jueves me alcance');

  assert.equal(closed, false);
  assert.equal(bot.sent.length, 0);
});

test('un "ya no me interesa" cierra sin prometer que lo llamará una persona', async () => {
  const bot = makeBot({
    ollama: { detectRefusal: async () => ({ refusing: true, kind: 'not_interested', source: 'llm' }) }
  });
  bot.closeAsNotInterested = async () => { bot.sent.push('[cerrado: no interesado]'); };

  const closed = await bot._closedAfterRefusal('51918974198', 'Buscaré en otro lado gracias igual');

  assert.equal(closed, true);
  assert.deepEqual(bot.sent, ['[cerrado: no interesado]']);
});

test('un "más adelante" se cierra como pospuesto, no como descartado', async () => {
  const bot = makeBot({
    ollama: { detectRefusal: async () => ({ refusing: true, kind: 'postpone', source: 'llm' }) }
  });
  let postponed = false;
  let discarded = false;
  bot.closeAsPostponed = async () => { postponed = true; };
  bot.closeAsNotInterested = async () => { discarded = true; };

  const closed = await bot._closedAfterRefusal('51918974198', 'lo dejamos para el próximo ciclo');

  assert.equal(closed, true);
  assert.equal(postponed, true);
  assert.equal(discarded, false);
});

test('pedir una persona se transfiere, no se cierra', async () => {
  const bot = makeBot({
    ollama: { detectRefusal: async () => ({ refusing: true, kind: 'wants_human', source: 'llm' }) }
  });
  let handedOff = false;
  bot.handOffToAdvisor = async () => { handedOff = true; };
  bot.closeAsNotInterested = async () => { throw new Error('no debe cerrarse'); };

  const closed = await bot._closedAfterRefusal('51918974198', 'no quiero hablar con un bot');

  assert.equal(closed, true);
  assert.equal(handedOff, true);
});

test('el texto del "más adelante" no promete ningún contacto', () => {
  const copy = postponedFarewell('Katya');
  assert.match(copy, /Katya/);
  assert.doesNotMatch(copy, /asesor|te escribe|te contacta|te llama/i,
    'a quien lo deja para después no se le anuncia que alguien lo va a buscar');
});

// ---------------------------------------------------------------------------
// Fallo 03 — el silencio ante "Jueves a las 9 am"
// El turno reventó (Calendar o el LLM) y el buffer solo lo anotó en la
// bitácora: el lead más maduro del día quedó sin respuesta.
// ---------------------------------------------------------------------------

test('si el turno revienta en pleno agendamiento, el lead recibe una respuesta igual', async () => {
  const bot = makeBot({ session: { status: 'scheduling_time', bot_enabled: true } });
  bot.runConversationTurn = async () => { throw new Error('Google Calendar: invalid_grant'); };

  // El fallo queda atendido: no se relanza, porque el contacto ya recibió
  // respuesta y el error quedó en la bitácora con su mensaje completo.
  await bot._runTurnGuarded('51731532328137227', 'Jueves a las 9 am');

  assert.equal(bot.sent.length, 1, 'el contacto recibe algo: el silencio es el peor desenlace');
  assert.match(bot.sent[0], /qué día y a qué hora/i);

  const recovered = bot.logged.find((e) => e.type === 'silent_turn_recovered');
  assert.ok(recovered, 'la recuperación queda registrada para poder auditarla');
  assert.match(recovered.error, /invalid_grant/, 'y el error original no se pierde');
});

test('un turno que ya respondió no recibe el mensaje de recuperación', async () => {
  const bot = makeBot({ session: { status: 'scheduling_time', bot_enabled: true } });
  bot.runConversationTurn = async (waId) => { await bot.send(waId, 'Horarios para el martes: ...'); };

  await bot._runTurnGuarded('51731532328137227', 'el martes');

  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0], /Horarios/);
});

test('un turno que calla a propósito fuera del agendamiento se queda callado', async () => {
  // Bot pausado, sesión cerrada, turno obsoleto: todos terminan sin enviar nada
  // y eso es correcto. La red solo cubre los pasos de agendamiento.
  const bot = makeBot({ session: { status: 'completed', bot_enabled: true } });
  bot.runConversationTurn = async () => {};

  await bot._runTurnGuarded('51918974198', 'gracias');

  assert.equal(bot.sent.length, 0);
});

test('un fallo fuera del agendamiento se propaga sin inventar una respuesta', async () => {
  const bot = makeBot({ session: { status: 'active', bot_enabled: true } });
  bot.runConversationTurn = async () => { throw new Error('db down'); };

  await assert.rejects(() => bot._runTurnGuarded('51918974198', 'hola'), /db down/);
  assert.equal(bot.sent.length, 0);
});
