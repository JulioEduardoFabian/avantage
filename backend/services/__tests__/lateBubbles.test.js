import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatsappBotService,
  wasWrittenBeforeLastReply,
  looksLikeQuestion,
  lateBatchNeedsTurn
} from '../whatsappBotService.js';

/*
 * Burbujas tardías: lo que el contacto escribe mientras el bot está armando su
 * respuesta. Salieron de revisar las conversaciones del 06 al 13/10, donde el
 * buffer las procesaba después como respuesta a una pregunta que el contacto
 * todavía no había visto. Cada caso nombra el mensaje real.
 */

function makeBot(session) {
  const bot = Object.create(WhatsappBotService.prototype);
  const sent = [];
  const logged = [];
  const dispatched = [];
  bot.sent = sent;
  bot.logged = logged;
  bot.dispatched = dispatched;
  bot.sendCounter = new Map();
  bot.send = async (waId, text) => {
    sent.push(text);
    bot.sendCounter.set(waId, (bot.sendCounter.get(waId) || 0) + 1);
  };
  bot.logActivity = (entry) => { logged.push(entry); };
  bot.getSession = async () => session;
  bot.updateSession = async () => {};
  bot.dispatchByStatus = async (waId, text) => { dispatched.push(text); };
  bot.ollamaService = {
    classifySchedulingAside: async () => ({ isAside: false, answersStep: false, preferredWhen: null, answer: '' })
  };
  bot.settingsService = { get: async () => ({}) };
  bot.leadService = { findByPhone: async () => null };
  return bot;
}

const SLOTS = [
  { date: '2026-10-08', startTime: '2026-10-08T20:00:00.000Z', label: 'Jue, 8 oct, 3:00 p.m.' },
  { date: '2026-10-09', startTime: '2026-10-09T15:00:00.000Z', label: 'Vie, 9 oct, 10:00 a.m.' }
];

function schedulingSession(status) {
  return {
    wa_id: '51936029148',
    status,
    bot_enabled: true,
    answers: JSON.stringify({ __scheduling: { slots: SLOTS, pendingSlot: SLOTS[0] } })
  };
}

test('una burbuja escrita antes del último envío del bot es tardía', () => {
  // Josselyn, 08/10: "Culminé en diciembre" a las 18:09:13; la lista de
  // horarios salió a las 18:09:29.
  assert.equal(wasWrittenBeforeLastReply(1000, 2000), true);
  assert.equal(wasWrittenBeforeLastReply(3000, 2000), false, 'escrita después de leer la respuesta: es una respuesta');
  assert.equal(wasWrittenBeforeLastReply(1000, undefined), false, 'sin envíos previos no hay nada a lo que llegar tarde');
});

test('reconoce preguntas escritas sin signos', () => {
  for (const texto of ['Donde es su oficina', 'cuanto cuesta', 'Cuánto más o menos me van a costar', 'y como seria', '¿Hacen TSP?']) {
    assert.equal(looksLikeQuestion(texto), true, `debería ser pregunta: ${texto}`);
  }
  for (const texto of ['Culminé en diciembre del año pasado', 'Es de diseño preexperimental', 'Egresado', '1']) {
    assert.equal(looksLikeQuestion(texto), false, `no debería ser pregunta: ${texto}`);
  }
});

test('en la elección de horario, la burbuja tardía solo se procesa si es el número o una pregunta', () => {
  assert.equal(lateBatchNeedsTurn('scheduling_time', 'Culminé en diciembre del año pasado'), false);
  assert.equal(lateBatchNeedsTurn('scheduling_time', '2'), true);
  assert.equal(lateBatchNeedsTurn('scheduling_time', '¿cuánto dura?'), true);
});

test('en la confirmación, un "1" o un "sí" escrito antes de ver la fecha no vale por esa fecha', () => {
  // Josselyn mandó "1" a la lista y el "¿Confirmo…?" que llegó encima lo leyó
  // como un no: "Sin problema 🙌 Dime qué día y a qué hora te viene mejor".
  assert.equal(lateBatchNeedsTurn('scheduling_confirm', '1'), false);
  assert.equal(lateBatchNeedsTurn('scheduling_confirm', 'Sí'), false);
  assert.equal(lateBatchNeedsTurn('scheduling_confirm', '¿y el link?'), true);
});

test('la burbuja tardía frente a la lista de horarios no recibe "No te entendí"', async () => {
  const session = schedulingSession('scheduling_time');
  const bot = makeBot(session);

  await bot.handleSchedulingTurn('51936029148', session, 'Culminé en diciembre del año pasado', { lateBatch: true });

  assert.deepEqual(bot.sent, []);
  assert.deepEqual(bot.dispatched, [], 'no se procesa como respuesta al paso');
  assert.ok(bot.logged.some((e) => e.type === 'late_batch_ignored'));
});

test('el mismo texto, escrito después de ver la lista, sí se procesa como siempre', async () => {
  const session = schedulingSession('scheduling_time');
  const bot = makeBot(session);

  await bot.handleSchedulingTurn('51936029148', session, 'Culminé en diciembre del año pasado');

  assert.deepEqual(bot.dispatched, ['Culminé en diciembre del año pasado']);
});

test('callarse ante una burbuja tardía no dispara el "Se me cruzaron los cables"', async () => {
  // La red de `_runTurnGuarded` manda un mensaje si un paso del agendamiento
  // terminó sin respuesta; acá el silencio es deliberado.
  const session = schedulingSession('scheduling_time');
  const bot = makeBot(session);
  bot.runConversationTurn = async () => {};

  await bot._runTurnGuarded('51936029148', 'Es de diseño preexperimental', null, { lateBatch: true });
  assert.deepEqual(bot.sent, []);

  await bot._runTurnGuarded('51936029148', 'Es de diseño preexperimental', null);
  assert.equal(bot.sent.length, 1, 'sin la marca de tardía, la red sigue actuando');
});

test('el buffer marca como tardío lo que llegó antes del último envío', async () => {
  const bot = Object.create(WhatsappBotService.prototype);
  bot.pendingMessages = new Map();
  bot.inboundCounter = new Map();
  bot.lastSentAt = new Map();
  bot.logActivity = () => {};
  const turns = [];
  bot.runSerialized = (waId, fn) => fn();
  bot._runTurnGuarded = async (waId, text, mark, opts) => { turns.push({ text, ...opts }); };

  // El bot tiene un envío reservado para dentro de un minuto (está
  // "escribiendo"): lo que llegue ahora lo escribió antes de leerlo.
  bot.lastSentAt.set('519', Date.now() + 60_000);
  bot.bufferMessage('519', 'Egresado', 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(turns[0]?.lateBatch, true);

  // Ya leyó la respuesta: lo que escribe ahora es una respuesta normal.
  bot.pendingMessages.clear();
  bot.lastSentAt.set('520', Date.now() - 60_000);
  bot.bufferMessage('520', '2', 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(turns[1]?.lateBatch, false);
});
