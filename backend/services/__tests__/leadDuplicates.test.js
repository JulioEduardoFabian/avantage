import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dniMatchKey,
  duplicateMessage,
  duplicateReasons,
  phoneMatchKey
} from '../leadService.js';

/*
 * Una persona es un lead, no uno por cada vez que alguien la carga a mano. Lo
 * que fijan estas pruebas es la regla con la que se reconoce que el lead que se
 * está cargando YA está en la base: el celular y el documento, comparados sin
 * los separadores que cada quien escribe distinto.
 */

test('el mismo DNI escrito de tres formas es el mismo DNI', () => {
  assert.equal(dniMatchKey('70123456'), '70123456');
  assert.equal(dniMatchKey('70.123.456'), '70123456');
  assert.equal(dniMatchKey(' 70 123 456 '), '70123456');
});

test('un carné con letras también sirve para comparar', () => {
  assert.equal(dniMatchKey('ce-001234x'), 'CE001234X');
});

/*
 * Lo que hay escrito a medias mientras alguien tipea no identifica a nadie: si
 * contara, el aviso saltaría contra media base al escribir los primeros dos
 * dígitos.
 */
test('un documento a medio escribir no se cruza con nada', () => {
  assert.equal(dniMatchKey('701'), null);
  assert.equal(dniMatchKey(''), null);
  assert.equal(dniMatchKey(null), null);
});

test('el mismo celular con otro formato es el mismo contacto', () => {
  const lead = { phone: '51987654321' };
  assert.deepEqual(duplicateReasons({ phone: '+51 987 654 321' }, lead), ['phone']);
  assert.deepEqual(duplicateReasons({ phone: '987654321' }, lead), ['phone']);
});

test('el celular y el DNI se informan por separado, y juntos cuando coinciden los dos', () => {
  const lead = { phone: '987654321', dni: '70123456' };
  assert.deepEqual(duplicateReasons({ phone: '987654321', dni: '11111111' }, lead), ['phone']);
  assert.deepEqual(duplicateReasons({ phone: '955000111', dni: '70.123.456' }, lead), ['dni']);
  assert.deepEqual(duplicateReasons({ phone: '987654321', dni: '70123456' }, lead), ['phone', 'dni']);
});

/*
 * Dos leads sin DNI no son la misma persona, y si lo fueran igual no hay forma
 * de saberlo. El campo vacío nunca puede ser la coincidencia que bloquea un
 * alta legítima.
 */
test('un campo vacío no es una coincidencia', () => {
  assert.deepEqual(duplicateReasons({ phone: '', dni: '' }, { phone: '', dni: '' }), []);
  assert.deepEqual(duplicateReasons({ phone: '987654321' }, { phone: null, dni: null }), []);
  assert.deepEqual(duplicateReasons({ dni: '70123456' }, { phone: '987654321' }), []);
});

/* El teléfono se compara con la misma regla que ya usaba el bot para no
 * crearle un gemelo al contacto que escribía por WhatsApp. */
test('el cruce de teléfono es el mismo que ya usaba el bot', () => {
  assert.equal(phoneMatchKey('+51 987 654 321'), phoneMatchKey('51987654321'));
});

/*
 * El aviso nombra el dato repetido y de quién es la ficha: "ya existe un lead
 * con estos datos" obliga a salir a buscarla, y mientras se busca es cuando se
 * carga igual.
 */
test('el aviso dice qué dato está repetido y quién tiene la ficha', () => {
  const msg = duplicateMessage([
    { id: 42, full_name: 'Rafael Gonzales', assigned_user_name: 'Lucía Ramos', reasons: ['phone'] }
  ]);
  assert.match(msg, /Rafael Gonzales/);
  assert.match(msg, /ese celular/);
  assert.match(msg, /Lucía Ramos/);
});

test('cuando coinciden los dos datos, el aviso los nombra a los dos', () => {
  const msg = duplicateMessage([{ id: 7, full_name: 'Ana', reasons: ['phone', 'dni'] }]);
  assert.match(msg, /ese celular y ese DNI/);
});

test('sin nombre ni responsable, el aviso igual identifica la ficha', () => {
  const msg = duplicateMessage([{ id: 9, full_name: null, reasons: ['dni'] }]);
  assert.match(msg, /#9/);
  assert.match(msg, /ese DNI/);
});
