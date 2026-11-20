import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_LABEL,
  consumeLeadParam,
  leadBoard,
  leadBoardPermission,
  leadFunnelLink
} from '../../../src/leadDeepLink.js';

/**
 * El enlace del Reporte de Leads a la ficha en su tablero. Las dos puntas
 * —armarlo y consumirlo— viven en el mismo módulo, así que acá se prueban
 * juntas: un enlace que apunta a un tablero y una pantalla que lee otro
 * parámetro no rompe nada, simplemente no abre nada, y eso nadie lo reporta.
 */

test('el tablero sale de la etapa del lead y lo desconocido es del setter', () => {
  assert.equal(leadBoard({ stage: { board: 'ventas' } }), 'ventas');
  assert.equal(leadBoard({ stage: { board: 'setter' } }), 'setter');
  // Misma regla que el tablero: lo que no cae en ninguna columna conocida se
  // ubica en el Setter Funnel, no en el limbo.
  assert.equal(leadBoard({ stage: null }), 'setter');
  assert.equal(leadBoard({}), 'setter');
  assert.equal(leadBoard(undefined), 'setter');
});

test('cada tablero tiene su ruta y el permiso que el guard le exige', () => {
  const ventas = { id: 666, stage: { board: 'ventas' } };
  const setter = { id: 42, stage: { board: 'setter' } };

  assert.deepEqual(leadFunnelLink(ventas), { path: '/admin/leads', query: { lead: '666' } });
  assert.deepEqual(leadFunnelLink(setter), { path: '/admin/setter-funnel', query: { lead: '42' } });

  // El permiso es el mismo que pide la ruta en el router: si se separan, el
  // enlace sale visible y termina rebotando al Dashboard.
  assert.equal(leadBoardPermission(ventas), 'leads.view');
  assert.equal(leadBoardPermission(setter), 'setter.view');

  assert.equal(BOARD_LABEL.ventas, 'Funnel de Ventas');
  assert.equal(BOARD_LABEL.setter, 'Setter Funnel');
});

test('el id del enlace se consume una vez y se borra de la URL', () => {
  const replaced = [];
  const router = { replace: (to) => replaced.push(to) };

  const id = consumeLeadParam({ query: { lead: '666', vista: 'tabla' } }, router);
  assert.equal(id, 666);
  // Lo demás de la URL se conserva: el parámetro es una orden de una vez, no
  // el estado de la pantalla.
  assert.deepEqual(replaced, [{ query: { vista: 'tabla' } }]);
});

test('sin parámetro válido no se toca la URL ni se abre nada', () => {
  const replaced = [];
  const router = { replace: (to) => replaced.push(to) };

  for (const query of [{}, { lead: '' }, { lead: 'abc' }, { lead: '0' }, { lead: '-3' }, { lead: '1.5' }]) {
    assert.equal(consumeLeadParam({ query }, router), null, JSON.stringify(query));
  }
  assert.equal(consumeLeadParam(undefined, router), null);
  assert.deepEqual(replaced, []);
});
