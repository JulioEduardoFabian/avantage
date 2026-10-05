import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentPatch, freeTextBreaksLink } from '../leadService.js';

/*
 * Asignar un lead a alguien del área comercial escribe DOS columnas:
 * `assigned_user_id` (el enlace con la cuenta, la verdad) y `assigned_to` (la
 * copia legible que ya leían la Base de Datos, el buscador de los dos tableros
 * y el bot). Lo que fijan estas pruebas es que no se separen: una ficha que
 * dice "Kevin" en un lado y "Lucía" en el otro es peor que no tener la función.
 */

test('asignar escribe el enlace y el nombre juntos', () => {
  assert.deepEqual(
    assignmentPatch({ id: 7, name: 'Lucía Ramos' }),
    { assigned_user_id: 7, assigned_to: 'Lucía Ramos' }
  );
});

test('dejar sin asignar limpia las dos columnas, no solo el enlace', () => {
  assert.deepEqual(
    assignmentPatch(null),
    { assigned_user_id: null, assigned_to: null }
  );
});

/*
 * La ficha de la Base de Datos manda `assignedTo` como texto en CADA guardado,
 * casi siempre con el nombre que el lead ya tenía. Si eso soltara el enlace,
 * corregir un DNI dejaría el lead "sin asignar" en los tableros.
 */
test('guardar la ficha con el mismo nombre no suelta el enlace', () => {
  const lead = { assigned_user_id: 7, assigned_to: 'Lucía Ramos' };
  assert.equal(freeTextBreaksLink(lead, 'Lucía Ramos'), false);
  assert.equal(freeTextBreaksLink(lead, '  lucía ramos  '), false);
});

test('escribir a mano otro nombre sí suelta el enlace', () => {
  const lead = { assigned_user_id: 7, assigned_to: 'Lucía Ramos' };
  assert.equal(freeTextBreaksLink(lead, 'Kevin'), true);
  assert.equal(freeTextBreaksLink(lead, ''), true);
});

test('un lead que nunca tuvo enlace no tiene nada que soltar', () => {
  assert.equal(freeTextBreaksLink({ assigned_to: 'Kevin' }, 'Otro'), false);
  assert.equal(freeTextBreaksLink(null, 'Otro'), false);
});
