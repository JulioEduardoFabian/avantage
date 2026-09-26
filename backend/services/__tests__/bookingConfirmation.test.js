import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAffirmative, modeLabel, cannotAttendMeeting } from '../whatsappBotService.js';

/*
 * Paso de confirmación antes de reservar. Existe por casos reales en los que
 * el bot agendó sobre una interpretación equivocada:
 *
 *   - "¿Miércoles? salgo del trabajo a las 4 pm" → agendó MARTES 4 pm, y
 *     cuando el lead dijo "No puedo martes" igual le llegó el recordatorio.
 *   - "Telefono" → agendó Google Meet.
 *
 * La regla es: ante la duda NO se reserva. Solo una afirmación reconocible y
 * sin correcciones detrás cuenta como "sí".
 */

test('un sí claro confirma', () => {
  for (const yes of ['sí', 'si', 'Sí', 'SI', 'sip', 'claro', 'dale', 'ok', 'Listo', 'perfecto', 'confirmo', 'de acuerdo', 'así es']) {
    assert.equal(isAffirmative(yes), true, `"${yes}" debería contar como sí`);
  }
});

test('un sí con emoji o signos sigue siendo un sí', () => {
  assert.equal(isAffirmative('sí!'), true);
  assert.equal(isAffirmative('Dale 👍'), true);
  assert.equal(isAffirmative('ok.'), true);
});

test('un no nunca confirma', () => {
  for (const no of ['no', 'No puedo martes', 'nop', 'mejor no']) {
    assert.equal(isAffirmative(no), false, `"${no}" no puede contar como sí`);
  }
});

// El caso que más caro salió: el lead dice "sí" pero corrige el día en la
// misma frase. Tomarlo como confirmación reserva el día equivocado.
test('un sí con una corrección detrás NO confirma: lleva un cambio de día u hora', () => {
  assert.equal(isAffirmative('sí, pero el jueves'), false);
  assert.equal(isAffirmative('si a las 5 mejor'), false);
  assert.equal(isAffirmative('ok pero mañana'), false);
  assert.equal(isAffirmative('claro, aunque prefiero más tarde'), false);
});

/*
 * El 25/09 un lead eligió "10.00 a.m", el bot pidió confirmación y él
 * contestó "Si esta bien." — el bot lo tomó como corrección y le soltó el
 * horario que acababa de aceptar. Le costó cuatro turnos más volver al mismo
 * bloque. Lo que descalifica un sí es traer una CORRECCIÓN detrás, no traer
 * palabras detrás.
 */
test('un sí con refuerzo detrás sigue siendo un sí', () => {
  for (const yes of [
    'Si esta bien.', 'Sí, está bien', 'está bien', 'Así está bien',
    'ok perfecto', 'sí claro gracias', 'si por favor', 'dale pues',
    'listo gracias', 'claro que sí', 'si confirmo', 'perfecto gracias', 'sí sí'
  ]) {
    assert.equal(isAffirmative(yes), true, `"${yes}" debería contar como sí`);
  }
});

// El refuerzo no puede abrir la puerta a cualquier cosa: una palabra fuera
// de la lista rompe la coincidencia, y ahí vuelve a mandar la regla de oro.
test('un sí seguido de otra cosa que no es refuerzo NO confirma', () => {
  assert.equal(isAffirmative('si tengo una duda'), false);
  assert.equal(isAffirmative('Si esta bien pero mejor el jueves'), false);
  assert.equal(isAffirmative('sí me puedes llamar mañana'), false);
  assert.equal(isAffirmative('estoy bien'), false);
});

test('un mensaje vacío o ambiguo no confirma', () => {
  assert.equal(isAffirmative(''), false);
  assert.equal(isAffirmative('   '), false);
  assert.equal(isAffirmative('mmm'), false);
  assert.equal(isAffirmative('¿a qué hora era?'), false);
});

// "Telefono" → el bot agendaba Google Meet. La confirmación tiene que decir
// en voz alta la modalidad para que el error se vea antes de reservar.
test('la confirmación nombra la modalidad que eligió el contacto', () => {
  assert.equal(modeLabel('phone'), 'llamada telefónica');
  assert.equal(modeLabel('meet'), 'videollamada por Google Meet');
  assert.equal(modeLabel(undefined), 'videollamada por Google Meet');
});

/* ------------------------------------------------------------------ */

/*
 * Un contacto que ya tiene reunión y avisa que no puede: su recordatorio
 * automático tiene que callarse. Caso real: escribió "No puedo martes" y el
 * bot le mandó igual el recordatorio del martes.
 */
test('avisar que no se puede asistir silencia el recordatorio', () => {
  for (const t of [
    'No puedo martes',
    'no voy a poder',
    'no podré asistir',
    'quiero cancelar la reunión',
    'podemos reagendar?',
    'necesito cambiar la hora',
    'lo movemos para otro día?'
  ]) {
    assert.equal(cannotAttendMeeting(t), true, `"${t}" debería silenciar el recordatorio`);
  }
});

// No se puede silenciar el recordatorio de quien solo tiene una duda: se
// quedaría sin aviso de una reunión a la que sí pensaba ir.
test('una pregunta cualquiera NO silencia el recordatorio', () => {
  for (const t of [
    '¿cuánto cuesta la asesoría?',
    'gracias!',
    '¿me pasas el link otra vez?',
    'ahí nos vemos',
    'perfecto'
  ]) {
    assert.equal(cannotAttendMeeting(t), false, `"${t}" no debería silenciar nada`);
  }
});
