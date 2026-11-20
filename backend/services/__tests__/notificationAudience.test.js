import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_TYPES,
  NOTIFICATION_TYPES,
  audienceRoleIds,
  blockedTypesFor,
  routableTypes,
  routingMap
} from '../notificationAudience.js';

/**
 * El reparto de los avisos automáticos entre perfiles. La regla que más
 * importa es la del valor por defecto: sin configurar, todo sigue yendo a
 * todos — que es el comportamiento de siempre.
 */

test('sin reglas, a nadie se le esconde nada', () => {
  // Es el estado de hoy y el de un entorno donde la migración no corrió: una
  // tabla de configuración que falta no puede dejar al equipo sin avisos.
  assert.deepEqual(blockedTypesFor(1, []), []);
  assert.deepEqual(blockedTypesFor(null, []), []);
  assert.equal(audienceRoleIds('income_verified', []), null, 'null = va a todos');
});

test('un tipo repartido se le esconde a los demás perfiles', () => {
  const rows = [{ type: 'income_verified', role_id: 5 }];
  assert.deepEqual(blockedTypesFor(5, rows), [], 'al perfil elegido no se le esconde');
  assert.deepEqual(blockedTypesFor(2, rows), ['income_verified']);
  assert.deepEqual(audienceRoleIds('income_verified', rows), [5]);
});

test('los tipos que nadie repartió siguen yendo a todos', () => {
  // La pregunta es "qué se esconde" y no "qué se muestra", justamente para
  // esto: el tipo que se agregue mañana no está en ninguna lista y por eso va
  // a todos, en vez de desaparecer de todas las campanas sin que nadie note.
  const rows = [{ type: 'income_verified', role_id: 5 }];
  assert.ok(!blockedTypesFor(2, rows).includes('meeting_booked'));
  assert.ok(!blockedTypesFor(2, rows).includes('un_tipo_nuevo_de_manana'));
});

test('un tipo repartido a varios perfiles los incluye a todos', () => {
  const rows = [
    { type: 'unanswered_inbound', role_id: 2 },
    { type: 'unanswered_inbound', role_id: 3 }
  ];
  assert.deepEqual(blockedTypesFor(2, rows), []);
  assert.deepEqual(blockedTypesFor(3, rows), []);
  assert.deepEqual(blockedTypesFor(9, rows), ['unanswered_inbound']);
  assert.deepEqual(audienceRoleIds('unanswered_inbound', rows).sort(), [2, 3]);
});

test('un usuario sin perfil solo ve lo que no está repartido', () => {
  // No se le puede afirmar que le toca algo repartido por perfiles.
  const rows = [{ type: 'income_verified', role_id: 5 }];
  assert.deepEqual(blockedTypesFor(null, rows), ['income_verified']);
});

test('la fila repetida no cuenta dos veces', () => {
  const rows = [
    { type: 'income_verified', role_id: 5 },
    { type: 'income_verified', role_id: 5 }
  ];
  assert.deepEqual(routingMap(rows), { income_verified: [5] });
  assert.deepEqual(audienceRoleIds('income_verified', rows), [5]);
});

test('el catálogo cubre lo que el sistema de verdad avisa', () => {
  // Un tipo que el código crea y el catálogo no nombra no se puede repartir:
  // queda yendo a todos para siempre y nadie se entera de que falta.
  assert.ok(KNOWN_TYPES.has('unanswered_inbound'));
  assert.ok(KNOWN_TYPES.has('income_verified'));
  assert.ok(KNOWN_TYPES.has('project_created'));
  assert.ok(KNOWN_TYPES.has('whatsapp_reminder_undeliverable'));
  assert.ok(KNOWN_TYPES.has('media_for_review'));
});

test('cada tipo del catálogo se puede explicar en castellano', () => {
  // Una lista de claves como `whatsapp_reminder_undeliverable` no se reparte
  // entre perfiles porque nadie sabe qué significan.
  for (const t of NOTIFICATION_TYPES) {
    assert.ok(t.label && t.label.length > 3, `${t.type} sin etiqueta`);
    assert.ok(t.description && t.description.length > 10, `${t.type} sin descripción`);
    assert.ok(t.group, `${t.type} sin grupo`);
  }
});

test('no hay tipos repetidos en el catálogo', () => {
  const vistos = new Set();
  for (const t of NOTIFICATION_TYPES) {
    assert.ok(!vistos.has(t.type), `${t.type} está dos veces`);
    vistos.add(t.type);
  }
  assert.equal(routableTypes().length, NOTIFICATION_TYPES.length);
});

test('el aviso manual NO es enrutable', () => {
  // Esos ya eligen destinatario al mandarse; enrutarlos además por su tipo
  // haría que un aviso dirigido a tres personas se le escondiera a una.
  assert.ok(!routableTypes().some((t) => t.type === 'team_notice'));
});
