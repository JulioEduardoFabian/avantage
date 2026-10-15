import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dniMatchKey,
  duplicateMessage,
  duplicateReasons,
  groupDuplicateLeads,
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

/*
 * El botón "Duplicados" del Funnel de Ventas agrupa a la misma persona cargada
 * varias veces con la MISMA regla del tope del alta manual.
 */
test('agrupa por celular aunque uno venga con prefijo y espacios', () => {
  const grupos = groupDuplicateLeads([
    { id: 1, phone: '975 545 098', created_at: '2026-10-10' },
    { id: 2, phone: '+51975545098', created_at: '2026-10-03' },
    { id: 3, phone: '999888777', created_at: '2026-10-01' }
  ]);
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].reasons, ['phone']);
  // El más reciente primero.
  assert.deepEqual(grupos[0].leads.map((l) => l.id), [1, 2]);
});

test('une en un solo grupo a quien comparte celular con uno y DNI con otro', () => {
  const grupos = groupDuplicateLeads([
    { id: 1, phone: '987654321', dni: null, created_at: '2026-10-01' },
    { id: 2, phone: '51987654321', dni: '12345678', created_at: '2026-10-02' },
    { id: 3, phone: '911222333', dni: '12.345.678', created_at: '2026-10-03' }
  ]);
  assert.equal(grupos.length, 1);
  assert.deepEqual(grupos[0].reasons, ['phone', 'dni']);
  assert.deepEqual(grupos[0].leads.map((l) => l.id), [3, 2, 1]);
});

test('los datos vacíos o cortos no juntan a nadie', () => {
  const grupos = groupDuplicateLeads([
    { id: 1, phone: '', dni: null },
    { id: 2, phone: null, dni: '' },
    { id: 3, phone: '123', dni: '12' },
    { id: 4, phone: '123', dni: '12' }
  ]);
  assert.equal(grupos.length, 0);
});
