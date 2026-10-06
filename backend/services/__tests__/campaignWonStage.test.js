import test from 'node:test';
import assert from 'node:assert/strict';

import { isWonLead } from '../campaignService.js';

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
