import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY } from '../quotationDocument.js';
import { officeCityName, officeQuestion } from '../officeLocation.js';
import { officeLocations } from '../../copy/whatsappBotCopy.js';

/*
 * "¿Tienen sede en Lima?" se contesta con una dirección exacta, así que lo que
 * se prueba acá es lo que puede salir mal: que la pregunta no se reconozca (y
 * caiga en la duda de confianza, que contesta Huancayo), o que se reconozca
 * donde no la hay (y al que está contando dónde vive se le responda con la
 * dirección de la oficina).
 */

const cities = (text) => officeQuestion(text).map((o) => o.city);

test('reconoce la pregunta por la sede, escrita como la escribe la gente', () => {
  for (const text of [
    '¿Tienen sede en Lima?',
    'tienen oficina en lima',
    'Buenas, están en Lima?',
    'hay sede en lima?',
    '¿atienden en Lima?',
    '¿ustedes son de Lima?',
    'su oficina queda en Lima? donde exactamente',
    'tienen un local en Lima',
    'sucursal por lima',
    'puedo ir a su oficina de Lima',
    'sede lima'
  ]) {
    assert.deepEqual(cities(text), ['LIMA'], text);
  }
});

test('contesta las dos sedes cuando la pregunta nombra las dos', () => {
  // Contestar una sola deja la mitad de la pregunta sin responder.
  assert.deepEqual(cities('¿Están en Lima o en Huancayo?'), ['LIMA', 'HUANCAYO']);
});

test('la otra sede también se reconoce: el catálogo manda, no una lista aparte', () => {
  assert.deepEqual(cities('¿están ubicados en Huancayo?'), ['HUANCAYO']);
  assert.deepEqual(cities('tienen oficina en hyo?'), ['HUANCAYO']);
});

test('no confunde la ciudad DEL CONTACTO con una pregunta por la sede', () => {
  // Todas son respuestas normales del perfilamiento. Contestarlas con la
  // dirección de la oficina es responderle algo que no preguntó.
  for (const text of [
    'Derecho, Universidad de Lima',
    'mi universidad está en Lima',
    'vivo en Lima',
    'yo estoy en lima',
    'soy de Lima',
    'mi dirección en Lima es Av. Brasil 123',
    'estudio en Lima'
  ]) {
    assert.deepEqual(cities(text), [], text);
  }
});

test('una mención de la oficina desempata: "vivo en Lima, ¿tienen sede acá?"', () => {
  assert.deepEqual(cities('Vivo en Lima, tienen alguna sede en Lima?'), ['LIMA']);
});

test('no inventa una sede donde no la hay', () => {
  // Arequipa no está en el catálogo: la pregunta sigue su camino normal (el
  // bloque de datos del LLM, que sí sabe dónde atendemos) en vez de recibir
  // un "¡sí!" por una oficina que no existe.
  assert.deepEqual(cities('¿tienen sede en Arequipa?'), []);
});

test('un dato suelto del agendamiento no es una pregunta por la sede', () => {
  for (const text of ['1', 'kevin@gmail.com', 'hola', '¿la reunión es por Meet?']) {
    assert.deepEqual(cities(text), [], text);
  }
});

test('la respuesta afirma, da la dirección completa y nombra la otra sede', () => {
  const reply = officeLocations(officeQuestion('¿tienen sede en Lima?'));
  const lima = COMPANY.offices.find((o) => o.city === 'LIMA');

  assert.match(reply, /^¡Sí! Tenemos oficina en Lima/);
  // La dirección sale del catálogo y llega hasta el piso y la oficina: el que
  // pregunta por la sede va a ir.
  assert.ok(reply.includes(lima.address), reply);
  assert.match(lima.address, /2\.º piso/);
  assert.match(lima.address, /oficina 10/);
  // La otra sede se nombra, y el Meet va al final como alternativa — nunca en
  // lugar de la dirección.
  assert.ok(reply.includes('Huancayo'), reply);
  assert.ok(reply.indexOf('Meet') > reply.indexOf(lima.address), reply);
  // El turno se gasta entero en responder: no se le pega el paso pendiente.
  assert.doesNotMatch(reply, /horario|coordinamos|agendamos/i);
});

test('officeCityName no grita la ciudad dentro de una frase', () => {
  assert.equal(officeCityName('LIMA'), 'Lima');
  assert.equal(officeCityName('HUANCAYO'), 'Huancayo');
});
