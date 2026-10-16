import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappBotService } from '../whatsappBotService.js';
import { detectProfileCorrection } from '../profileCorrection.js';
import { normalizeUniversity, findUniversityMentions } from '../universityNormalizer.js';

/**
 * Conversación real del 15/10/2026 con +51933977853 ("MrB"), perdida entera
 * por dos errores encadenados:
 *
 *   1. dijo "Universidad católica Sedes Sapientiae" y el bot le confirmó
 *      "Pontificia Universidad Católica del Perú" — "catolica" era alias de
 *      la PUCP y su entrada iba antes en el catálogo;
 *   2. escribió "No es la pontificia", "Es la Sapientiae" y "Es esta
 *      universidad" en pleno paso de elección de horario, que solo sabe leer
 *      números: recibió dos "No te entendí bien 🤔" con la misma lista, se
 *      agotaron los intentos y la conversación se transfirió a un asesor.
 *
 * Un minuto después escribió "10:00 am" —un horario de la lista que tenía
 * delante— y, con el bot ya en pausa por la transferencia, nadie lo leyó.
 */

function makeBot({ session = null } = {}) {
  const bot = Object.create(WhatsappBotService.prototype);
  const sent = [];
  const logged = [];
  let saved = session;

  bot.sent = sent;
  bot.logged = logged;
  bot.sendCounter = new Map();
  bot.send = async (waId, text) => {
    sent.push(text);
    bot.sendCounter.set(waId, (bot.sendCounter.get(waId) || 0) + 1);
  };
  bot.logActivity = (entry) => { logged.push(entry); };
  bot.updateSession = async (waId, patch) => { saved = { ...(saved || {}), ...patch }; };
  bot.getSession = async () => saved;
  bot.savedSession = () => saved;
  bot.savedAnswers = () => JSON.parse(saved.answers);
  // La ficha del lead se guarda aparte (`leadService.updateLead`): acá solo
  // interesa que se intente, no lo que escriba.
  bot.syncedProfiles = [];
  bot._syncLeadProfile = async (waId, answers) => { bot.syncedProfiles.push(answers); };
  bot.dispatched = [];
  bot.dispatchByStatus = async (waId, text) => { bot.dispatched.push(text); };
  return bot;
}

const SLOTS = [
  { date: '2026-10-16', startTime: '2026-10-16T14:30:00.000Z', label: 'Vie, 16 oct, 9:30 a.m.' },
  { date: '2026-10-16', startTime: '2026-10-16T15:00:00.000Z', label: 'Vie, 16 oct, 10:00 a.m.' },
  { date: '2026-10-16', startTime: '2026-10-16T15:30:00.000Z', label: 'Vie, 16 oct, 10:30 a.m.' }
];

function schedulingSession(answers = {}) {
  return {
    wa_id: '51933977853',
    status: 'scheduling_time',
    bot_enabled: true,
    answers: JSON.stringify({
      field: 'Ingeniería ambiental',
      university: 'Pontificia Universidad Católica del Perú',
      ...answers,
      __scheduling: { mode: 'meet', slots: SLOTS, availableDays: ['2026-10-16'], ...(answers.__scheduling || {}) }
    })
  };
}

// ---------------------------------------------------------------------------
// Error 1 — el catálogo tapaba el nombre propio de la universidad
// ---------------------------------------------------------------------------

test('"Universidad católica Sedes Sapientiae" ya no se confirma como la PUCP', async () => {
  const resolved = await normalizeUniversity('Universidad católica Sedes Sapientiae');
  assert.equal(resolved.name, 'Universidad Católica Sedes Sapientiae');
  assert.equal(resolved.confidence, 'alta');
});

test('ninguna "católica" del país termina resuelta como la PUCP', async () => {
  const casos = [
    ['Universidad Católica de Santa María', 'Universidad Católica de Santa María'],
    ['Universidad Católica San Pablo', 'Universidad Católica San Pablo'],
    ['USAT', 'Universidad Católica Santo Toribio de Mogrovejo'],
    ['uladech', 'Universidad Católica Los Ángeles de Chimbote']
  ];
  for (const [escrito, esperado] of casos) {
    const resolved = await normalizeUniversity(escrito);
    assert.equal(resolved.name, esperado, `"${escrito}" debe resolver a ${esperado}`);
  }
});

test('"la católica" a secas no resuelve a ninguna: son seis universidades distintas', async () => {
  const resolved = await normalizeUniversity('la católica', {
    // Ni con un LLM muy seguro de sí mismo: el término es ambiguo y punto.
    resolveWithLLM: async () => ({ name: 'Pontificia Universidad Católica del Perú', confident: true })
  });
  assert.equal(resolved.confidence, 'media', 'con confianza media el bot se queda con lo que escribió el contacto');
  assert.equal(resolved.name, 'la católica');
});

test('las siglas que ya funcionaban siguen resolviendo igual', async () => {
  for (const [sigla, esperado] of [
    ['pucp', 'Pontificia Universidad Católica del Perú'],
    ['UNAC', 'Universidad Nacional del Callao'],
    ['uncp', 'Universidad Nacional del Centro del Perú'],
    ['untels', 'Universidad Nacional Tecnológica de Lima Sur'],
    ['unt', 'Universidad Nacional de Trujillo'],
    ['unsa', 'Universidad Nacional de San Agustín'],
    ['unsaac', 'Universidad Nacional de San Antonio Abad del Cusco'],
    ['Villarreal', 'Universidad Nacional Federico Villarreal']
  ]) {
    const resolved = await normalizeUniversity(sigla);
    assert.equal(resolved.name, esperado, `"${sigla}" debe seguir resolviendo a ${esperado}`);
  }
});

test('findUniversityMentions devuelve TODAS las universidades nombradas, en orden', () => {
  assert.deepEqual(
    findUniversityMentions('No es la pontificia\nEs la Sapientiae'),
    ['Pontificia Universidad Católica del Perú', 'Universidad Católica Sedes Sapientiae']
  );
});

// ---------------------------------------------------------------------------
// Error 2 — la corrección no se entendía
// ---------------------------------------------------------------------------

const STORED = { university: 'Pontificia Universidad Católica del Perú', field: 'Ingeniería ambiental' };

test('"No es la pontificia / Es la Sapientiae" se lee como la universidad NUEVA, no la descartada', () => {
  const correction = detectProfileCorrection('No es la pontificia\nEs la Sapientiae', STORED);
  assert.deepEqual(
    { field: correction.field, value: correction.value },
    { field: 'university', value: 'Universidad Católica Sedes Sapientiae' }
  );
});

test('"No es la pontificia" sola descarta la nuestra sin proponer otra: hay que preguntar', () => {
  const correction = detectProfileCorrection('No es la pontificia', STORED);
  assert.equal(correction.field, 'university');
  assert.equal(correction.value, null, 'no se vuelve a guardar justo lo que el contacto acaba de descartar');
});

test('"Es esta universidad" señala algo que no está en el texto: tampoco hay valor', () => {
  const correction = detectProfileCorrection('Es esta universidad', STORED);
  assert.equal(correction.field, 'university');
  assert.equal(correction.value, null);
});

test('una corrección de carrera se reconoce con el valor nuevo', () => {
  const correction = detectProfileCorrection('no es ingeniería ambiental, es ingeniería industrial', STORED);
  assert.deepEqual(
    { field: correction.field, value: correction.value },
    { field: 'field', value: 'ingeniería industrial' }
  );
});

test('elegir horario, pedir otro día o despedirse NO son correcciones (son del paso)', () => {
  for (const texto of ['2', 'la 1 por favor', 'mejor el jueves a las 10', 'No puedo a esa hora', 'ya quedó, gracias', 'mañana temprano']) {
    assert.equal(detectProfileCorrection(texto, STORED), null, `"${texto}" no es una corrección`);
  }
});

test('repetir la universidad que ya tenemos guardada no se toma como corrección', () => {
  assert.equal(detectProfileCorrection('es la pucp', STORED), null);
});

// ---------------------------------------------------------------------------
// El arreglo completo, por el camino real del agendamiento
// ---------------------------------------------------------------------------

test('corregir la universidad eligiendo horario: se guarda, se acusa y el paso sigue', async () => {
  const bot = makeBot({ session: schedulingSession() });

  await bot.handleSchedulingTurn('51933977853', bot.savedSession(), 'No es la pontificia\nEs la Sapientiae');

  const answers = bot.savedAnswers();
  assert.equal(answers.university, 'Universidad Católica Sedes Sapientiae', 'la ficha queda con la universidad correcta');
  assert.equal(bot.syncedProfiles.length, 1, 'el lead se actualiza, no solo la sesión del bot');
  assert.equal(bot.dispatched.length, 0, 'el mensaje no llega al paso de horarios: no es un número mal leído');
  assert.equal(bot.sent.length, 1, 'un solo mensaje: el acuse y el paso retomado van juntos');
  assert.match(bot.sent[0], /Sedes Sapientiae/, 'se le devuelve escrito el nombre corregido');
  assert.match(bot.sent[0], /n[úu]mero/i, 'y en el mismo mensaje se retoma la elección de horario');
  assert.doesNotMatch(bot.sent[0], /No te entend/i);
});

test('la corrección no gasta los intentos que terminan en una transferencia', async () => {
  const bot = makeBot({ session: schedulingSession({ __scheduling: { attempts: 1, misses: 1 } }) });

  await bot.handleSchedulingTurn('51933977853', bot.savedSession(), 'Es la Sapientiae');

  const scheduling = bot.savedAnswers().__scheduling;
  assert.equal(scheduling.attempts, 0, 'corregir es progreso, no un intento fallido');
  assert.equal(scheduling.misses, 0);
  assert.ok(scheduling.slots?.length, 'los horarios ofrecidos siguen sobre la mesa');
});

test('descartó la nuestra sin decir la correcta: se le pregunta y el paso sigue en pie', async () => {
  const bot = makeBot({ session: schedulingSession() });

  await bot.handleSchedulingTurn('51933977853', bot.savedSession(), 'No es la pontificia');

  assert.equal(bot.dispatched.length, 0);
  assert.equal(bot.sent.length, 1);
  assert.match(bot.sent[0], /Pontificia/, 'se le muestra lo anotado para que confirme o corrija de una vez');
  assert.match(bot.sent[0], /n[úu]mero/i, 'sin soltar la elección de horario');
  assert.equal(bot.savedAnswers().__scheduling.correctionAsks, 1);
});

test('no se pregunta por el mismo dato en bucle: pasado el tope vuelve al camino normal', async () => {
  const bot = makeBot({ session: schedulingSession({ __scheduling: { correctionAsks: 2 } }) });

  await bot.handleSchedulingTurn('51933977853', bot.savedSession(), 'Es esta universidad');

  assert.equal(bot.sent.length, 0, 'el bot no insiste una tercera vez con la misma pregunta');
  assert.deepEqual(bot.dispatched, ['Es esta universidad'], 'el mensaje sigue por el camino de siempre');
});
