import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstNameOf, resolveFormLeadName, usableProposedSlot } from '../whatsappBotService.js';
import { MIN_BOOKING_LEAD_MINUTES } from '../googleCalendarService.js';

/*
 * Con qué nombre abre el bot cuando el lead llega del formulario de un
 * anuncio. Casos reales del 25/09/2026:
 *
 *   - Perfil "Areli", formulario a nombre de Milciades → "¡Hola, Areli!"
 *   - Perfil "Fabricio", formulario de Paulo César → "¡Hola, Fabricio!" y,
 *     siete horas después en el MISMO hilo, "¡Hola Paulo César!"
 *   - Formulario "ROMINA" → "¡Hola, ROMINA!"
 *
 * El teléfono que llena el formulario muchas veces no es del estudiante (ese
 * día no coincidió con el número emisor en 5 de 10 casos), así que el perfil
 * de WhatsApp dice cómo se llama el aparato, no la persona.
 */

test('el nombre del formulario gana sobre el del perfil de WhatsApp', () => {
  const { greetName } = resolveFormLeadName('milciades', 'Areli');
  assert.equal(greetName, 'Milciades');
});

test('el nombre del formulario también se guarda en la ficha, para que el panel no diga otra cosa', () => {
  assert.equal(resolveFormLeadName('milciades', 'Areli').storeFormName, true);
  assert.equal(resolveFormLeadName('Paulo César mayhua', 'Fabricio').storeFormName, true);
});

test('si el formulario y la ficha traen el mismo nombre, no se reescribe nada', () => {
  const { greetName, storeFormName } = resolveFormLeadName('Romina Vargas', 'Romina');
  assert.equal(greetName, 'Romina');
  assert.equal(storeFormName, false);
});

// Un "Full name" con basura no puede pisar un nombre real: el perfil manda.
test('un formulario sin nombre utilizable deja en pie el del perfil', () => {
  for (const junk of ['xd', '😎', '...', '']) {
    const { greetName, storeFormName } = resolveFormLeadName(junk, 'Fabricio');
    assert.equal(greetName, 'Fabricio', `"${junk}" no debería reemplazar al nombre del perfil`);
    assert.equal(storeFormName, false, `"${junk}" no debería guardarse en la ficha`);
  }
});

test('sin ningún nombre, el saludo va sin nombre en vez de inventarlo', () => {
  assert.equal(resolveFormLeadName(null, null).greetName, null);
  assert.equal(resolveFormLeadName(null, null).storeFormName, false);
});

// "¡Hola, ROMINA!" se lee como un correo masivo. Los formularios de Meta
// llegan como los escribió el lead, en mayúsculas o en minúsculas.
test('el nombre se devuelve capitalizado, venga como venga del formulario', () => {
  assert.equal(firstNameOf('ROMINA'), 'Romina');
  assert.equal(firstNameOf('milciades'), 'Milciades');
  assert.equal(firstNameOf('JOSÉ ANTONIO'), 'José');
  assert.equal(firstNameOf('María Fernanda'), 'María');
});

test('un alias de perfil sigue sin dar un nombre de pila', () => {
  assert.equal(firstNameOf('La Vida Continua'), null);
  assert.equal(firstNameOf('jquintanillaphocco'), null);
});

/* ------------------------------------------------------------------ */

/*
 * Horario que el recordatorio de inactividad le nombra al lead que se quedó
 * mudo. Entre que sale el mensaje y llega su "sí" pueden pasar horas: si el
 * bloque ya empezó, agendarlo le deja al asesor una reunión imposible.
 */

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

test('un horario todavía lejano se puede reservar con el sí del lead', () => {
  const slot = { label: 'Sáb, 26 set, 9:30 a.m.', startTime: inMinutes(MIN_BOOKING_LEAD_MINUTES + 30) };
  assert.equal(usableProposedSlot(slot), slot);
});

test('un horario que ya pasó se descarta: el lead vuelve a ver la lista', () => {
  assert.equal(usableProposedSlot({ label: 'ayer', startTime: inMinutes(-60) }), null);
});

// Justo encima de la hora no sirve: el asesor necesita la misma anticipación
// mínima con la que se ofrecen los bloques.
test('un horario dentro de la anticipación mínima tampoco se reserva', () => {
  assert.equal(usableProposedSlot({ startTime: inMinutes(MIN_BOOKING_LEAD_MINUTES - 10) }), null);
});

test('una sesión sin horario propuesto no rompe nada', () => {
  assert.equal(usableProposedSlot(undefined), null);
  assert.equal(usableProposedSlot(null), null);
  assert.equal(usableProposedSlot({ label: 'sin fecha' }), null);
  assert.equal(usableProposedSlot({ startTime: 'no es una fecha' }), null);
});
