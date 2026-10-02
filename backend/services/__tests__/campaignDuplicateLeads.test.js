import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esMejorLead } from '../campaignService.js';

/**
 * Un teléfono puede tener más de una fila en `leads`: la misma persona que
 * escribió por WhatsApp y además llenó un formulario de Meta, o que llenó el
 * formulario dos veces.
 *
 * El índice por teléfono del reporte de campañas se armaba con `new Map()` a
 * secas, así que ganaba la última fila que devolviera MySQL — sin ORDER BY, en
 * la práctica la más nueva. Al recuperar 38 leads perdidos de Meta, varias de
 * esas filas nuevas ("conversación abierta") taparon a sus gemelas, y el
 * tablero pasó de 40 citas agendadas y 3 ganados a 39 y 1: los contactos
 * seguían ahí, pero se leían con el estado equivocado.
 *
 * La regla es la misma que la de `leadService.findByPhone()` a propósito: es
 * la misma pregunta, y dos respuestas distintas para ella es como se llega a
 * que dos pantallas cuenten cosas diferentes.
 */

const sinSello = { id: 2, status: 'conversacion_abierta', sales_funnel_at: null, created_at: '2026-10-02 10:00:00' };
const graduado = { id: 1, status: 'ganado', sales_funnel_at: '2026-09-20 09:00:00', created_at: '2026-09-15 08:00:00' };

test('el lead que graduó al Funnel de Ventas le gana al gemelo recién creado', () => {
  // Este es el caso exacto que rompió el tablero: el gemelo es más nuevo, pero
  // el que vale es el que el closer está trabajando.
  assert.equal(esMejorLead(sinSello, graduado), false);
  assert.equal(esMejorLead(graduado, sinSello), true);
});

test('entre dos sin sellar gana el más reciente', () => {
  const viejo = { id: 1, sales_funnel_at: null, created_at: '2026-09-01 08:00:00' };
  const nuevo = { id: 2, sales_funnel_at: null, created_at: '2026-09-30 08:00:00' };

  assert.equal(esMejorLead(nuevo, viejo), true);
  assert.equal(esMejorLead(viejo, nuevo), false);
});

test('entre dos sellados gana el más reciente', () => {
  const primero = { id: 1, sales_funnel_at: '2026-09-10 08:00:00', created_at: '2026-09-01 08:00:00' };
  const segundo = { id: 2, sales_funnel_at: '2026-09-11 08:00:00', created_at: '2026-09-05 08:00:00' };

  assert.equal(esMejorLead(segundo, primero), true);
  assert.equal(esMejorLead(primero, segundo), false);
});

test('el sello pesa más que la fecha, aunque el gemelo sea mucho más nuevo', () => {
  const selladoViejo = { id: 1, sales_funnel_at: '2026-01-05 08:00:00', created_at: '2026-01-01 08:00:00' };
  const sueltoNuevo = { id: 2, sales_funnel_at: null, created_at: '2026-10-02 08:00:00' };

  assert.equal(esMejorLead(sueltoNuevo, selladoViejo), false);
});
