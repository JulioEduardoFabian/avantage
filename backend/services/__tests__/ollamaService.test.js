import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaService } from '../ollamaService.js';

// fallbackParseSchedulingDate es la rama SIN IA de parseSchedulingDate (se usa
// cuando la llamada a Ollama Cloud falla o no hay API key configurada). Caso
// real: un lead pidió "otro día en las tardes" mientras elegía horario y,
// como esta rama solo reconocía horas exactas ("6pm", "18:30"), no reconocía
// "tardes" como nada — el bot terminaba repitiendo la MISMA lista de
// horarios de la mañana con un "no te entendí" que en realidad sí había
// entendido, solo no lo estaba buscando.
const ollama = new OllamaService();
const TODAY = '2026-09-15';

test('fallbackParseSchedulingDate reconoce "en las tardes" como las 15:00, sin fecha', () => {
  const result = ollama.fallbackParseSchedulingDate('No habría otro día en las tardes', TODAY);
  assert.equal(result.date, null);
  assert.equal(result.preferredTime, '15:00');
  assert.equal(result.timePrecision, 'vague');
  assert.equal(result.declined, false);
});

test('fallbackParseSchedulingDate reconoce "por la tarde" en singular', () => {
  assert.equal(ollama.fallbackParseSchedulingDate('mejor por la tarde', TODAY).preferredTime, '15:00');
});

test('fallbackParseSchedulingDate reconoce "de noche" como las 20:00', () => {
  const result = ollama.fallbackParseSchedulingDate('tienes algo de noche?', TODAY);
  assert.equal(result.preferredTime, '20:00');
});

test('fallbackParseSchedulingDate reconoce "temprano" y "en la mañana" como las 09:00', () => {
  assert.equal(ollama.fallbackParseSchedulingDate('prefiero temprano', TODAY).preferredTime, '09:00');
  assert.equal(ollama.fallbackParseSchedulingDate('algo en la mañana?', TODAY).preferredTime, '09:00');
});

test('fallbackParseSchedulingDate prioriza una hora exacta sobre un momento del día si ambos aparecen', () => {
  const result = ollama.fallbackParseSchedulingDate('mejor en la tarde, a las 3pm', TODAY);
  assert.equal(result.preferredTime, '15:00');
  assert.equal(result.timePrecision, 'exact');
});

test('fallbackParseSchedulingDate sigue combinando "mañana" (día) con "hoy" y horas exactas como antes', () => {
  const [y, m, d] = TODAY.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  assert.equal(ollama.fallbackParseSchedulingDate('mañana a las 10', TODAY).date, tomorrow);
  assert.equal(ollama.fallbackParseSchedulingDate('hoy a las 6pm', TODAY).date, TODAY);
});

// Caso real (18/09/2026, viernes): el bot ofreció "el sábado 19 de 9:30 a.m.
// a 12:30 p.m.", el lead pidió "Sábado a las 9:30am" y el modelo devolvió otra
// fecha — "Ese día no hay agenda" dos veces y traspaso a un asesor. El día
// nombrado por su nombre ahora se resuelve en código, no con el modelo.
const FRIDAY = '2026-09-18';

function withStubbedLLM(response) {
  const service = new OllamaService();
  service.hasLLM = () => true;
  service._generateJSON = async () => response;
  return service;
}

test('parseSchedulingDate corrige el sábado que el modelo calculó mal', async () => {
  const service = withStubbedLLM({ date: '2026-09-26', preferredTime: '09:30', declined: false });
  const result = await service.parseSchedulingDate('Sábado a las 9:30am porfavor', FRIDAY, 7);
  assert.equal(result.date, '2026-09-19');
  assert.equal(result.preferredTime, '09:30');
});

test('parseSchedulingDate resuelve "Sábado a las 11?" sin tomar el 11 como día del mes', async () => {
  const service = withStubbedLLM({ date: '2026-09-20', preferredTime: '11:00', declined: false });
  assert.equal((await service.parseSchedulingDate('Sábado a las 11?', FRIDAY, 7)).date, '2026-09-19');
});

test('parseSchedulingDate respeta un día del mes que no coincide con el nombre', async () => {
  const service = withStubbedLLM({ date: '2026-09-26', preferredTime: null, declined: false });
  assert.equal((await service.parseSchedulingDate('el sábado 26', FRIDAY, 14)).date, '2026-09-26');
});

test('parseSchedulingDate deja al modelo "el sábado de la próxima semana"', async () => {
  const service = withStubbedLLM({ date: '2026-09-26', preferredTime: null, declined: false });
  assert.equal((await service.parseSchedulingDate('el sábado de la próxima semana', FRIDAY, 14)).date, '2026-09-26');
});

test('parseSchedulingDate: el mismo día de la semana que hoy es hoy', async () => {
  const service = withStubbedLLM({ date: '2026-09-25', preferredTime: null, declined: false });
  assert.equal((await service.parseSchedulingDate('el viernes', FRIDAY, 7)).date, FRIDAY);
});

test('fallbackParseSchedulingDate reconoce el nombre del día antes que "mañana" como momento', () => {
  const result = ollama.fallbackParseSchedulingDate('el sábado en la mañana', FRIDAY);
  assert.equal(result.date, '2026-09-19');
  assert.equal(result.preferredTime, '09:00');
});

// Orden de preguntas (también sin IA): carrera + universidad primero, que se
// contestan sin pensar; el tema después, con la salida de "desde cero".
/*
 * La apertura pide SOLO la carrera. Pedir carrera y universidad juntas era
 * pedir dos cosas en el mensaje que decide si te contestan: el 01/10, de 25
 * contactos, 9 abandonaron sin responder nada justo ahí.
 */
test('fallbackConversationTurn abre preguntando SOLO la carrera', () => {
  const turn = ollama.fallbackConversationTurn({}, '¡Hola! Quiero más información', true);
  assert.match(turn.reply, /carrera/i);
  assert.doesNotMatch(turn.reply, /universidad/i);
  assert.deepEqual(turn.extracted, {});
  assert.equal(turn.ready, false);
});

test('la universidad se pregunta en el turno siguiente, cuando ya hay carrera', () => {
  const turn = ollama.fallbackConversationTurn({ field: 'Antropología' }, 'ok', false);
  assert.match(turn.reply, /universidad/i);
});

test('si contesta las dos de una, no se vuelve a preguntar ninguna', () => {
  // Partir la pregunta no puede castigar a quien igual responde todo junto.
  const turn = ollama.fallbackConversationTurn({}, 'Ingeniería civil, Universidad Continental', false);
  assert.equal(turn.extracted.field, 'Ingeniería civil');
  assert.match(turn.extracted.university, /Continental/);
  assert.doesNotMatch(turn.reply, /carrera|universidad/i);
});

test('fallbackConversationTurn pide el tema después de carrera y universidad', () => {
  const turn = ollama.fallbackConversationTurn({}, 'Ingeniería civil, Universidad Continental', false);
  assert.equal(turn.extracted.field, 'Ingeniería civil');
  assert.match(turn.extracted.university, /Continental/);
  assert.match(turn.reply, /tema.*desde cero/);
  assert.equal(turn.ready, false);
});

test('fallbackConversationTurn toma "desde cero" como respuesta al tema y cierra', () => {
  const turn = ollama.fallbackConversationTurn({ field: 'Derecho', university: 'UNCP' }, 'empiezo desde cero', false);
  assert.equal(turn.extracted.problem, 'Sin tema definido (desde cero)');
  assert.equal(turn.ready, true);
});
