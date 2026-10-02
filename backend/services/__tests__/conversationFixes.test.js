import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExplicitYes, nextDataQuestion, extractLeadFormFields, isAdFormMessage } from '../whatsappBotService.js';

/**
 * Correcciones salidas de revisar las conversaciones del 01/10/2026, donde de
 * 25 contactos solo 1 llegó a agendar. Cada prueba fija el caso real que la
 * motivó: sin eso, dentro de tres meses parecen reglas arbitrarias.
 */

// --------------------------------------------------------- "ok" es un sí

/*
 * Soraya preguntó el precio, el bot cerró con "¿Coordinamos?", ella contestó
 * "Ok" y el bot le repitió palabra por palabra la pregunta que ya le había
 * hecho dos turnos antes. Ese "Ok" era una aceptación.
 */
test('reconoce la aceptación suelta', () => {
  for (const text of ['ok', 'Ok', 'OK', 'okay', 'sí', 'si', 'siii', 'dale', 'claro', 'listo',
    'perfecto', 'vale', 'de acuerdo', 'por supuesto', 'está bien', 'coordinemos', 'ya', 'dale gracias']) {
    assert.equal(isExplicitYes(text), true, `debería ser un sí: "${text}"`);
  }
});

test('no toma por aceptación una frase que solo empieza con "sí" u "ok"', () => {
  // Son conversación, no un sí: ahí decide el LLM, que la entiende mejor que
  // una regex. Mismo criterio estricto que `isExplicitNo`.
  for (const text of ['ok pero cuánto cuesta', 'si tengo tema', 'claro que no', 'dale pero mañana',
    'sí, de ingeniería civil', 'ya tengo asesor']) {
    assert.equal(isExplicitYes(text), false, `no debería ser un sí: "${text}"`);
  }
});

test('un mensaje vacío no es una aceptación', () => {
  for (const text of ['', '   ', null, undefined]) {
    assert.equal(isExplicitYes(text), false);
  }
});

// ------------------------------------- una pregunta por mensaje, en orden

/*
 * Pedir carrera y universidad juntas era pedir dos cosas en el mensaje que
 * decide si te contestan: 9 de 25 contactos abandonaron ahí.
 */
test('la primera pregunta es SOLO la carrera', () => {
  const question = nextDataQuestion({});
  assert.match(question, /carrera/i);
  assert.doesNotMatch(question, /universidad/i);
});

test('después de la carrera viene la universidad, y después el tema', () => {
  assert.match(nextDataQuestion({ field: 'Antropología' }), /universidad/i);
  assert.match(nextDataQuestion({ field: 'Antropología', university: 'UNSA' }), /tema/i);
});

test('con los tres datos ya no queda nada que preguntar', () => {
  assert.equal(nextDataQuestion({ field: 'Antropología', university: 'UNSA', problem: 'IA generativa' }), null);
});

// ------------------------------------------- el nombre que escribe la gente

/*
 * "Jesus Mi Fortaleza" mandó su ficha SIN dos puntos y presentándose como
 * Lourdes. El parser exigía ":" así que no leyó nada, y el bot la llamó
 * "Jesus" toda la conversación — hasta en la confirmación de su reunión.
 */
const FICHA_SIN_DOS_PUNTOS = [
  '▪️ Nombre Lourdes',
  '▪️ Carrera Antropología',
  '▪️ Universidad UNSA',
  '▪️ Ciudad de residencia Arequipa'
].join('\n');

test('lee la ficha aunque no lleve dos puntos', () => {
  const fields = extractLeadFormFields(FICHA_SIN_DOS_PUNTOS);
  assert.equal(fields.fullName, 'Lourdes');
  assert.equal(fields.field, 'Antropología');
  assert.equal(fields.university, 'UNSA');
  assert.equal(isAdFormMessage(FICHA_SIN_DOS_PUNTOS), true);
});

test('sigue leyendo la ficha con dos puntos, como siempre', () => {
  const fields = extractLeadFormFields('Nombre: Lourdes\nCarrera: Antropología\nUniversidad: UNSA');
  assert.equal(fields.fullName, 'Lourdes');
  assert.equal(fields.university, 'UNSA');
});

test('una frase normal no se lee como ficha', () => {
  // Sin dos puntos solo se acepta lo que EMPIEZA por una etiqueta conocida:
  // si no, cualquier frase se leería como "etiqueta valor".
  for (const text of [
    'quiero información para avanzar mi tesis',
    'estoy en el último ciclo y no tengo tema',
    'mi hermana estudia en la universidad continental'
  ]) {
    assert.deepEqual(extractLeadFormFields(text), {}, `no debería leerse como ficha: "${text}"`);
  }
});

test('la etiqueta sin valor no inventa un dato', () => {
  assert.deepEqual(extractLeadFormFields('▪️ Nombre'), {});
  assert.deepEqual(extractLeadFormFields('Carrera:'), {});
});

test('un nombre que no es un nombre no se adopta', () => {
  // El campo es texto libre y llega con cualquier cosa; `firstNameOf` es el
  // filtro, y acá se comprueba que siga puesto en este camino.
  assert.equal(extractLeadFormFields('▪️ Nombre xd').fullName, undefined);
  assert.equal(extractLeadFormFields('▪️ Nombre ...').fullName, undefined);
});
