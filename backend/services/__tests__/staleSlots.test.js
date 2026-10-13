import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappBotService, slotHasPassed, staleSchedulingSlot } from '../whatsappBotService.js';

/*
 * Horarios vencidos. El 11/10 a Delia le preguntaron "¿Confirmo *Vie, 9 oct,
 * 3:00 p.m.*?" dos días después de esa fecha, y el 05/10 a Alex "¿Confirmo… el
 * *mar, 29 set*?": se habían quedado a medio agendar y, al volver a escribir,
 * el paso pendiente les repetía el horario de entonces.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-11T22:26:00.000Z');
const slotAt = (ms, label) => ({ date: new Date(ms).toISOString().slice(0, 10), startTime: new Date(ms).toISOString(), label });

const PAST = slotAt(NOW - 48 * HOUR, 'Vie, 9 oct, 3:00 p.m.');
const SOON = slotAt(NOW + 5 * 60 * 1000, 'en cinco minutos');
const FUTURE = slotAt(NOW + 20 * HOUR, 'Lun, 12 oct, 4:30 p.m.');

test('un horario que ya empezó, o empieza en minutos, está pasado', () => {
  assert.equal(slotHasPassed(PAST, NOW), true);
  assert.equal(slotHasPassed(SOON, NOW), true, 'nadie llega a conectarse en cinco minutos');
  assert.equal(slotHasPassed(FUTURE, NOW), false);
  assert.equal(slotHasPassed(null, NOW), false);
});

test('detecta el horario vencido de cada paso', () => {
  assert.equal(staleSchedulingSlot('scheduling_confirm', { awaitingConfirm: PAST }, NOW), PAST);
  assert.equal(staleSchedulingSlot('scheduling_confirm', { awaitingConfirm: FUTURE }, NOW), null);
  assert.equal(staleSchedulingSlot('scheduling_phone', { pendingSlot: PAST }, NOW), PAST);
  assert.equal(staleSchedulingSlot('scheduling_email', { pendingSlot: PAST }, NOW), PAST);
});

test('en la lista de horarios solo cuenta si vencieron todos', () => {
  // Si queda uno vigente la lista sigue sirviendo; elegir el vencido lo frena bookSlot.
  assert.equal(staleSchedulingSlot('scheduling_time', { slots: [PAST, FUTURE] }, NOW), null);
  assert.equal(staleSchedulingSlot('scheduling_time', { slots: [PAST, SOON] }, NOW), PAST);
});

function makeBot(answers, status) {
  const bot = Object.create(WhatsappBotService.prototype);
  let session = { wa_id: '51929892817', status, bot_enabled: true, answers: JSON.stringify(answers) };
  bot.sent = [];
  bot.logged = [];
  bot.prompted = 0;
  bot.send = async (waId, text) => { bot.sent.push(text); };
  bot.logActivity = (entry) => { bot.logged.push(entry); };
  bot.getSession = async () => session;
  bot.updateSession = async (waId, patch) => { session = { ...session, ...patch }; };
  bot.session = () => session;
  bot.promptForDate = async () => { bot.prompted += 1; };
  return bot;
}

test('volver a escribir con un horario vencido pendiente ofrece horarios al día', async () => {
  const bot = makeBot({ __scheduling: { awaitingConfirm: PAST, misses: 1 } }, 'scheduling_confirm');

  await bot._reofferBecauseSlotPassed('51929892817', PAST, 'Hola 👋 Quiero información para avanzar mi tesis.');

  assert.match(bot.sent[0], /Vie, 9 oct, 3:00 p\.m\..*ya pasó/);
  assert.equal(bot.prompted, 1, 'se le muestran los horarios vigentes');
  const scheduling = JSON.parse(bot.session().answers).__scheduling;
  assert.equal(scheduling.awaitingConfirm, undefined, 'el horario vencido se suelta');
  assert.equal(scheduling.when, undefined, 'un saludo no es un pedido de día');
  assert.equal(bot.session().status, 'scheduling_time');
});

test('si al volver nombra un día, se usa para buscar los horarios', async () => {
  const bot = makeBot({ __scheduling: { pendingSlot: PAST } }, 'scheduling_email');

  await bot._reofferBecauseSlotPassed('51929892817', PAST, 'mejor el jueves en la tarde');

  assert.equal(JSON.parse(bot.session().answers).__scheduling.when, 'mejor el jueves en la tarde');
});

test('no se pide confirmar ni se reserva un horario que ya pasó', async () => {
  const bot = makeBot({ __scheduling: { slots: [PAST, FUTURE] } }, 'scheduling_time');
  let created = false;
  bot.googleCalendarService = { createMeetEvent: async () => { created = true; } };

  await bot.bookSlot('51929892817', PAST);
  assert.doesNotMatch(bot.sent.join('\n'), /¿Confirmo/);
  assert.equal(bot.prompted, 1);

  await bot.confirmSlot('51929892817', PAST);
  assert.equal(created, false, 'no se crea un evento en el pasado');
  assert.equal(bot.prompted, 2);
});
