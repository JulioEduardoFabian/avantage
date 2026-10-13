import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WhatsappBotService,
  isAffirmative,
  isExplicitYes,
  shouldReopenClosedConversation
} from '../whatsappBotService.js';
import { describesThesisProgress, saysNotInterested } from '../leadSignals.js';

/*
 * Leads buenos que el bot daba por perdidos. Salieron de las conversaciones
 * del 06 al 13/10; cada caso nombra el mensaje real.
 */

test('contar el avance de la tesis no es una despedida', () => {
  // 07/10, maestría UNCP: "Cierro por acá para no molestarte más".
  // 08/10: "Ya tengo titulo" (venía por la maestría).
  for (const texto of [
    'Ya tengo el plan aprobado',
    'Ya tengo titulo',
    'Ya estoy en revision del asesor de universidad',
    'ya tengo mi proyecto avanzado',
    'Ya tengo asesor de la universidad pero me observaron'
  ]) {
    assert.equal(describesThesisProgress(texto), true, `es avance: ${texto}`);
  }
});

test('un rechazo de verdad sigue siendo rechazo aunque nombre la tesis', () => {
  for (const texto of [
    'ya tengo quien me haga la tesis',
    'Ya tengo la tesis, no gracias',
    'ya tengo asesor',
    'ya no necesito la tesis'
  ]) {
    assert.equal(describesThesisProgress(texto), false, `es rechazo: ${texto}`);
  }
  assert.equal(saysNotInterested('ya tengo asesor'), true, 'el regex de desinterés no cambió');
});

test('el cierre por rechazo no consulta al LLM cuando el mensaje cuenta el avance', async () => {
  const bot = Object.create(WhatsappBotService.prototype);
  let asked = false;
  bot.logActivity = () => {};
  bot.ollamaService = { detectRefusal: async () => { asked = true; return { refusing: true, kind: 'not_interested' }; } };
  bot.closeAsNotInterested = async () => { throw new Error('no debía cerrar'); };

  const closed = await bot._closedAfterRefusal('51925632460', 'Ya tengo el plan aprobado');
  assert.equal(closed, false);
  assert.equal(asked, false);
});

test('"No hay problema" y los dedazos de "sí" son un sí', () => {
  // 09/10: "No hay problema. Estamos en contacto." a "¿Confirmo Sáb, 10 oct?"
  // recibió "Dime qué día y a qué hora te viene mejor". 10/10: "Dii".
  for (const texto of ['No hay problema. Estamos en contacto.', 'Sin problema', 'Dii', 'Siii', 'zi']) {
    assert.equal(isAffirmative(texto), true, `afirma: ${texto}`);
  }
  assert.equal(isExplicitYes('no hay problema'), true);
  assert.equal(isAffirmative('di'), false, '"di" suelto no se fuerza a sí');
  assert.equal(isAffirmative('No hay problema, pero mejor el jueves'), false, 'una corrección no es un sí');
});

function confirmBot(read) {
  const bot = Object.create(WhatsappBotService.prototype);
  let session = {
    wa_id: '51967420284',
    status: 'scheduling_confirm',
    answers: JSON.stringify({ __scheduling: { awaitingConfirm: { label: 'Sáb, 10 oct, 10:00 a.m.', startTime: '2099-10-10T15:00:00.000Z' } } })
  };
  bot.sent = [];
  bot.send = async (waId, text) => { bot.sent.push(text); };
  bot.logActivity = () => {};
  bot.getSession = async () => session;
  bot.updateSession = async (waId, patch) => { session = { ...session, ...patch }; };
  bot.session = () => session;
  bot.ollamaService = { parseConfirmationReply: async () => read };
  return bot;
}

test('una respuesta ambigua al "¿Confirmo…?" repregunta por el mismo horario una vez', async () => {
  const bot = confirmBot({ decision: 'unclear', extraRequest: null });

  await bot.handleSchedulingConfirmReply('51967420284', bot.session(), 'Estamos en contacto entonces');
  assert.match(bot.sent[0], /Sáb, 10 oct, 10:00 a\.m\./);
  assert.equal(bot.session().status, 'scheduling_confirm', 'el horario que eligió no se suelta');

  await bot.handleSchedulingConfirmReply('51967420284', bot.session(), 'Estamos en contacto entonces');
  assert.match(bot.sent[1], /Dime qué día/, 'la segunda vez sí se abre la elección');
});

test('un cierre por error se reabre si vuelve a escribir algo de fondo', () => {
  const closedAt = Date.parse('2026-10-07T12:29:00.000Z');
  const session = { answers: JSON.stringify({ __closedReason: 'no_interesado', __closedAt: new Date(closedAt).toISOString() }) };
  const soon = closedAt + 60 * 1000;

  assert.equal(shouldReopenClosedConversation(session, 'Necesito apoyo en ciertos puntos', soon), true);
  assert.equal(shouldReopenClosedConversation(session, 'Gracias 🙏', soon), false, 'una cortesía no reabre');
  assert.equal(shouldReopenClosedConversation(session, 'ok gracias, igualmente', soon), false);
  assert.equal(shouldReopenClosedConversation(session, 'no gracias', soon), false);
  assert.equal(shouldReopenClosedConversation(session, 'Necesito apoyo', closedAt + 8 * 24 * 3600 * 1000), false, 'pasada la semana no');

  const descartado = { answers: JSON.stringify({ __closedReason: 'no_califica', __closedAt: new Date(closedAt).toISOString() }) };
  assert.equal(shouldReopenClosedConversation(descartado, 'Necesito apoyo', soon), false, 'solo los cierres por rechazo');
});
