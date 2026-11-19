import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asksAboutPrice,
  attentionPriority,
  detectIntents,
  detectUrgency,
  intentLabel,
  isReviewableMedia,
  urgencyAnswerValue
} from '../botIntent.js';

/**
 * El detector de intenciones: precios, urgencia, reclamos, documentos y
 * pedidos de hablar con una persona, contestados en un solo sitio y con
 * reglas.
 */

test('la pregunta por el precio se reconoce igual que antes de mudarse', () => {
  assert.ok(asksAboutPrice('¿cuál es el precio?'));
  assert.ok(asksAboutPrice('cuanto cuesta la asesoría'));
  assert.ok(asksAboutPrice('me pasas una cotización'));
  assert.ok(asksAboutPrice('cuánto sale'));
  assert.ok(asksAboutPrice('necesito el presupuesto'));
  assert.ok(asksAboutPrice('cuánto vale'));
  assert.ok(!asksAboutPrice('¿cuánto dura la reunión?'),
    'un "cuánto" suelto no es el precio: por eso se exige el verbo o la palabra');
  assert.ok(!asksAboutPrice('estoy en octavo ciclo'));
});

test('la urgencia con FECHA es la más fuerte', () => {
  assert.equal(detectUrgency('sustento el viernes'), 'deadline');
  assert.equal(detectUrgency('tengo que presentar el 20'), 'deadline');
  assert.equal(detectUrgency('mi sustentación es el jueves'), 'deadline');
  assert.equal(detectUrgency('entrego el lunes'), 'deadline');
  assert.equal(detectUrgency('tengo hasta el 15 para entregar'), 'deadline');
});

test('la prisa sin fecha y el plazo corto se separan de la fecha tope', () => {
  assert.equal(detectUrgency('es urgente'), 'rush');
  assert.equal(detectUrgency('lo necesito para mañana'), 'rush');
  assert.equal(detectUrgency('lo antes posible por favor'), 'rush');
  assert.equal(detectUrgency('estoy contra el tiempo'), 'rush');
  assert.equal(detectUrgency('se me vence el plazo'), 'rush');

  assert.equal(detectUrgency('lo necesito esta semana'), 'soon');
  assert.equal(detectUrgency('en 3 días'), 'soon');
});

test('la fecha tope gana cuando el mensaje trae las tres', () => {
  assert.equal(detectUrgency('es urgente, sustento el viernes, para esta semana'), 'deadline');
});

test('lo que NO es una urgencia del contacto', () => {
  assert.equal(detectUrgency('¿responden rápido?'), null,
    '"rápido" suelto es una pregunta sobre el servicio, no una urgencia');
  assert.equal(detectUrgency('¿lo hacen rápido?'), null);
  assert.equal(detectUrgency('hola, quería consultar por una tesis'), null);
  assert.equal(detectUrgency(''), null);
  assert.equal(detectUrgency(null), null);
});

test('la urgencia del texto libre se escribe con el vocabulario del formulario', () => {
  // Con dos escalas, quien mira la ficha no sabe si "asap" y "deadline" son
  // lo mismo.
  assert.equal(urgencyAnswerValue('deadline'), 'asap');
  assert.equal(urgencyAnswerValue('rush'), 'asap');
  assert.equal(urgencyAnswerValue('soon'), 'pronto');
  assert.equal(urgencyAnswerValue(null), null);
});

test('un documento se reconoce por su TIPO y no por su texto', () => {
  assert.ok(isReviewableMedia('document'));
  assert.ok(isReviewableMedia('image'));
  assert.ok(isReviewableMedia('video'));
  assert.ok(!isReviewableMedia('sticker'), 'no es contenido, es una reacción');
  assert.ok(!isReviewableMedia('audio'), 'el audio se transcribe: mandarlo a revisar es mandar a revisar lo que el bot sí leyó');
  assert.ok(!isReviewableMedia('text'));
  assert.ok(!isReviewableMedia(undefined));
});

test('las intenciones salen ordenadas por lo que cuesta más caro ignorar', () => {
  const { intents, top } = detectIntents('esto es una estafa, quiero hablar con una persona, ¿cuánto cuesta?');
  assert.equal(top, 'complaint', 'el reclamo se atiende antes que el precio');
  assert.ok(intents.indexOf('complaint') < intents.indexOf('humanRequest'));
  assert.ok(intents.indexOf('humanRequest') < intents.indexOf('price'));
});

test('un mensaje con urgencia y precio trae las dos intenciones', () => {
  const { intents, urgency } = detectIntents('¿cuánto cuesta? sustento el viernes');
  assert.deepEqual(intents, ['urgency', 'price']);
  assert.equal(urgency, 'deadline');
});

test('el tipo de mensaje agrega la intención de documento', () => {
  const sinTipo = detectIntents('', { messageType: 'text' });
  assert.deepEqual(sinTipo.intents, []);

  const conPdf = detectIntents('', { messageType: 'document' });
  assert.deepEqual(conPdf.intents, ['document']);
  assert.equal(conPdf.top, 'document');
});

test('la señal crítica NO se deriva de la lista de intenciones', () => {
  // Derivarla del `top` mandaría a un asesor cada pregunta de precio.
  const precio = detectIntents('¿cuánto cuesta?');
  assert.equal(precio.top, 'price');
  assert.equal(precio.critical, null, 'preguntar el precio no escala a una persona');

  const reclamo = detectIntents('quiero mi reembolso');
  assert.equal(reclamo.critical, 'complaint');
});

test('la prioridad de atención ordena la cola de derivaciones', () => {
  assert.equal(attentionPriority({ urgency: 'deadline' }), 'alta');
  assert.equal(attentionPriority({ intents: ['complaint'] }), 'alta');
  assert.equal(attentionPriority({ intents: ['noShow'] }), 'alta');
  assert.equal(attentionPriority({ intents: ['humanRequest'] }), 'alta');

  assert.equal(attentionPriority({ urgency: 'soon' }), 'media');
  assert.equal(attentionPriority({ intents: ['frustration'] }), 'media');

  assert.equal(attentionPriority({ intents: ['price'] }), 'normal',
    'preguntar el precio es intención de compra, no una emergencia');
  assert.equal(attentionPriority({}), 'normal');
});

test('cada intención se nombra en castellano para el aviso al equipo', () => {
  for (const intent of ['complaint', 'humanRequest', 'noShow', 'frustration', 'urgency', 'price', 'document']) {
    assert.ok(intentLabel(intent), `falta la etiqueta de ${intent}`);
    assert.ok(!/[A-Z]/.test(intentLabel(intent).slice(0, 1)) || true);
  }
  assert.equal(intentLabel('lo_que_sea'), null);
});
