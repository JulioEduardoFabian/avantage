import test from 'node:test';
import assert from 'node:assert/strict';

import { esMejorLead, isWonLead } from '../campaignService.js';
import { phoneMatchKey } from '../leadService.js';

/*
 * Caso real del 05/10/2026: Rafael Anderson Gonzales Ureta estaba en la columna
 * "Ganado" del Funnel de Ventas y la trazabilidad de Campañas lo mostraba "En
 * espera de la reunión". La causa era una lista fija `['ganado']` en
 * `campaignService.js`: las columnas que crea el equipo generan su clave sola
 * (`col_mtc2nwec_fij`), así que la columna que ellos llaman "Ganado" nunca
 * coincidía con esa cadena.
 */

const CLAVE_COLUMNA_GANADO = 'col_mtc2nwec_fij';

test('reconoce el desenlace fijo "ganado"', () => {
  const statuses = new Set(['ganado']);
  assert.equal(isWonLead({ id: 1, status: 'ganado' }, statuses, new Set()), true);
});

test('reconoce la columna que el equipo marcó como final, con su clave generada', () => {
  // Es el caso de Rafael: su status es la clave de la columna, no 'ganado'.
  const statuses = new Set(['ganado', CLAVE_COLUMNA_GANADO]);
  assert.equal(isWonLead({ id: 7, status: CLAVE_COLUMNA_GANADO }, statuses, new Set()), true);
});

test('un lead con proyecto abierto cuenta como ganado aunque su columna no esté marcada final', () => {
  // El respaldo: si alguien recrea la columna sin marcarla, el cliente al que
  // ya se le está entregando trabajo no puede figurar como "en espera".
  const statuses = new Set(['ganado']);
  assert.equal(isWonLead({ id: 42, status: CLAVE_COLUMNA_GANADO }, statuses, new Set([42])), true);
});

test('un lead en seguimiento sigue sin contarse como ganado', () => {
  const statuses = new Set(['ganado', CLAVE_COLUMNA_GANADO]);
  assert.equal(isWonLead({ id: 3, status: 'en_negociacion' }, statuses, new Set()), false);
  assert.equal(isWonLead({ id: 4, status: 'cita_agendada' }, statuses, new Set()), false);
});

test('sin lead no hay venta ganada', () => {
  // Un contacto de WhatsApp que nunca llegó a crear ficha.
  assert.equal(isWonLead(null, new Set(['ganado']), new Set()), false);
});

/* ------------------------------------------------------------------------ */
/* De dos fichas del mismo teléfono, cuál representa la realidad comercial   */
/* ------------------------------------------------------------------------ */

const GANADOS = new Set(['ganado', CLAVE_COLUMNA_GANADO]);

function lead(id, status, { graduado = true, creado = '2026-09-01' } = {}) {
  return { id, status, sales_funnel_at: graduado ? '2026-09-10' : null, created_at: creado };
}

test('entre dos fichas graduadas gana la que está en Ganado, no la más nueva', () => {
  // Es el caso que dejaba a Campañas leyendo la ficha equivocada: "el más
  // reciente" era un desempate razonable mientras el gemelo era una ficha
  // recién creada, y una moneda al aire en cuanto las dos graduaron.
  const cerrada = lead(5, CLAVE_COLUMNA_GANADO, { creado: '2026-08-03' });
  const abierta = lead(10, 'cita_agendada', { creado: '2026-08-14' });

  assert.equal(esMejorLead(cerrada, abierta, GANADOS), true, 'la cerrada tiene que ganar');
  assert.equal(esMejorLead(abierta, cerrada, GANADOS), false);
});

test('si ninguna está ganada, sigue mandando la graduación y después la fecha', () => {
  const graduada = lead(1, 'en_negociacion', { graduado: true, creado: '2026-08-01' });
  const nueva = lead(2, 'nuevo', { graduado: false, creado: '2026-09-20' });
  assert.equal(esMejorLead(graduada, nueva, GANADOS), true);

  const vieja = lead(3, 'en_negociacion', { creado: '2026-08-01' });
  const reciente = lead(4, 'en_negociacion', { creado: '2026-09-20' });
  assert.equal(esMejorLead(reciente, vieja, GANADOS), true);
});

test('sin lista de ganados se comporta como antes', () => {
  // La firma vieja (dos argumentos) la siguen usando otras llamadas.
  const vieja = lead(3, 'ganado', { creado: '2026-08-01' });
  const reciente = lead(4, 'cita_agendada', { creado: '2026-09-20' });
  assert.equal(esMejorLead(reciente, vieja), true);
});

test('el teléfono se cruza por los últimos 9 dígitos, no por la cadena exacta', () => {
  // El wa_id llega como lo manda Meta y el teléfono del lead como lo escribió
  // la persona en el formulario. Son el mismo contacto.
  const esperado = phoneMatchKey('960506806');
  for (const variante of ['+51 960 506 806', '51960506806', '+51960506806', '960506806']) {
    assert.equal(phoneMatchKey(variante), esperado, `debería cruzar: ${variante}`);
  }
});
