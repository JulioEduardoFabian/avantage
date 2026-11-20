import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directSlotPick, readSlotReply } from '../slotReply.js';
import { WhatsappBotService } from '../whatsappBotService.js';

/**
 * Las frases son las REALES del análisis de conversaciones del 18/11/2026
 * (14/09 al 01/11/2026): cada una terminó en "No te entendí bien 🤔", en un
 * asesor, o en un "¿Confirmo…?" que el lead ya no contestó.
 */

const LIST = ['09:30', '10:00', '10:30', '12:30', '15:00'].map((time) => ({ time }));
const timeOf = (slot) => slot.time;

test('el número de la opción, con o sin adornos, elige ese horario', () => {
  assert.equal(directSlotPick('2', LIST, timeOf), 1);
  assert.equal(directSlotPick('la opción 3', LIST, timeOf), 2);
  assert.equal(directSlotPick('sí, la 2', LIST, timeOf), 1);
  assert.equal(directSlotPick('Ok 1', LIST, timeOf), 0);
  assert.equal(directSlotPick('dale el 2 porfa', LIST, timeOf), 1);
  assert.equal(directSlotPick('la segunda', LIST, timeOf), 1);
});

test('la hora de un horario de la lista también lo elige', () => {
  assert.equal(directSlotPick('10.30', LIST, timeOf), 2);
  assert.equal(directSlotPick('10:30 am', LIST, timeOf), 2);
  assert.equal(directSlotPick('el de las 3', LIST, timeOf), 4, '"las 3" en horario de oficina es la tarde');
  assert.equal(directSlotPick('3 pm', LIST, timeOf), 4);
});

test('lo que no es una elección inequívoca no se reserva solo', () => {
  assert.equal(directSlotPick('2?', LIST, timeOf), null, 'una pregunta no es una elección');
  assert.equal(directSlotPick('93', LIST, timeOf), null, 'un dedazo no se adivina');
  assert.equal(directSlotPick('9', LIST, timeOf), null, 'ni opción 9 ni un horario a las 9 en punto');
  assert.equal(directSlotPick('Lunes 19', LIST, timeOf), null);
  assert.equal(directSlotPick('2', [], timeOf), null, 'sin lista no hay nada que elegir');
});

test('una hora que coincide con dos horarios no elige ninguno', () => {
  const twoDays = [{ time: '15:00' }, { time: '15:00' }];
  assert.equal(directSlotPick('a las 3', twoDays, timeOf), null);
});

test('pedir otro día u otra hora se reconoce, con el momento del día si lo dijo', () => {
  assert.deepEqual(readSlotReply('No habría otro día en las tardes'), { kind: 'other_day', part: 'afternoon' });
  assert.deepEqual(readSlotReply('Otro dia'), { kind: 'other_day', part: null });
  assert.deepEqual(readSlotReply('otra hora'), { kind: 'other_time', part: null });
  assert.deepEqual(readSlotReply('¿tienen otro horario?'), { kind: 'other_time', part: null });
});

test('"ninguno me sirve" es un pedido de otros horarios, no un rechazo del servicio', () => {
  assert.equal(readSlotReply('No me calza ninguno de estos horarios').kind, 'none_fit');
  assert.equal(readSlotReply('En ninguno de esos horarios puedo').kind, 'none_fit');
});

test('nombrar solo un momento del día se reconoce', () => {
  assert.deepEqual(readSlotReply('Noche por favor'), { kind: 'part_of_day', part: 'evening' });
  assert.deepEqual(readSlotReply('Trabajo en el día todos los días'), { kind: 'part_of_day', part: 'evening' });
  assert.deepEqual(readSlotReply('por la mañana'), { kind: 'part_of_day', part: 'morning' });
});

test('un sí a la reunión sin número se reconoce', () => {
  for (const text of ['Listo', 'Si porfavor', 'Si, podemos coordinar una reunión']) {
    assert.equal(readSlotReply(text).kind, 'yes_without_pick', text);
  }
});

test('un día concreto lo resuelve el camino de fechas, no estas reglas', () => {
  for (const text of ['Mañana no tienen algún espacio en su agenda', 'Sábado a las 11?', 'Hoy entonces', 'el sábado en la tarde']) {
    assert.equal(readSlotReply(text).kind, null, text);
  }
});

test('lo que no pide nada concreto sigue su camino de siempre', () => {
  for (const text of ['No', 'Ya responderé', 'salgo de la universidad un poco tarde', 'otro día, el 2 está bien']) {
    assert.equal(readSlotReply(text).kind, null, text);
  }
});

// ---------------------------------------------------------------------------
// El paso de elección de horario del bot, con dobles.
// ---------------------------------------------------------------------------

// Todos en el futuro y en hora de Lima (UTC-5).
const S = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(h + 5, m);
  return { date, startTime: start.toISOString(), endTime: new Date(start.getTime() + 600000).toISOString(), label: `${date} ${hhmm}` };
};
const DAY1 = '2099-01-05';
const DAY2 = '2099-01-06';
const SHOWN = [S(DAY1, '09:30'), S(DAY1, '10:00'), S(DAY1, '10:30')];

function makeBot({ free = [], ollama = {} } = {}) {
  const bot = Object.create(WhatsappBotService.prototype);
  let saved = { status: 'scheduling_time', answers: JSON.stringify({ __scheduling: { slots: SHOWN, availableDays: [DAY1, DAY2] } }) };
  bot.sent = [];
  bot.logActivity = () => {};
  bot.send = async (waId, text) => { bot.sent.push(text); };
  bot.updateSession = async (waId, patch) => { saved = { ...saved, ...patch }; };
  bot.getSession = async () => saved;
  bot.session = () => saved;
  bot.ollamaService = {
    parseSchedulingChoice: async () => { throw new Error('no debería llegar al LLM'); },
    ...ollama
  };
  bot.googleCalendarService = {
    getUpcomingFreeSlots: async () => free,
    rankFreeSlots: (slots) => slots
  };
  return bot;
}

test('elegir el número reserva directo, sin preguntar "¿Confirmo…?"', async () => {
  const bot = makeBot();
  let confirmed = null;
  bot.confirmSlot = async (waId, slot) => { confirmed = slot; };
  bot.bookSlot = async () => { throw new Error('no debe pasar por la confirmación'); };

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), '2');

  assert.equal(confirmed?.label, `${DAY1} 10:00`);
  assert.equal(bot.sent.length, 0);
});

test('"otro día en las tardes" ofrece tardes de OTROS días', async () => {
  const free = [...SHOWN, S(DAY1, '15:00'), S(DAY2, '09:30'), S(DAY2, '15:30'), S(DAY2, '16:00')];
  const bot = makeBot({ free });

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'No habría otro día en las tardes');

  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0], /otros días en la tarde/);
  const { slots } = JSON.parse(bot.session().answers).__scheduling;
  assert.deepEqual(slots.map((s) => s.label), [`${DAY2} 15:30`, `${DAY2} 16:00`]);
  assert.doesNotMatch(bot.sent[0], /No te entendí/);
});

test('"ninguno me calza" no repite los horarios que ya rechazó', async () => {
  const free = [...SHOWN, S(DAY1, '12:30'), S(DAY2, '18:00')];
  const bot = makeBot({ free });

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'No me calza ninguno de estos horarios');

  const { slots, attempts } = JSON.parse(bot.session().answers).__scheduling;
  assert.deepEqual(slots.map((s) => s.label), [`${DAY1} 12:30`, `${DAY2} 18:00`]);
  assert.equal(attempts, 0, 'ofrecer otra lista es avanzar, no un intento fallido');
});

test('si en ese momento del día no hay nada, se le dice y se le ofrece lo más cercano', async () => {
  const free = [...SHOWN, S(DAY2, '15:00')];
  const bot = makeBot({ free });

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'Noche por favor');

  assert.match(bot.sent[0], /En la noche no tengo horarios libres/);
  assert.ok(JSON.parse(bot.session().answers).__scheduling.slots.length > 0);
});

test('sin ningún otro horario libre lo coordina una persona', async () => {
  const bot = makeBot({ free: SHOWN });
  let handedOff = null;
  bot.handOffToAdvisor = async (waId, reason) => { handedOff = reason; };

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'otra hora');

  assert.ok(handedOff);
  assert.match(bot.sent[0], /no tengo otros horarios libres/);
});

test('un "Listo" sin número pide el número una sola vez', async () => {
  const bot = makeBot({ ollama: { parseSchedulingChoice: async () => ({ index: null, preferredTime: null }) } });
  bot._answerDayRequestWhileChoosing = async () => false;
  bot._bookLastProposedIfAffirmative = async () => false;

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'Listo');
  assert.match(bot.sent[0], /Respóndeme solo con el número/);

  await bot.handleSchedulingTimeReply('51900000000', bot.session(), 'Listo');
  assert.doesNotMatch(bot.sent[1] || '', /Respóndeme solo con el número/, 'la segunda vez sigue el camino de siempre');
});
