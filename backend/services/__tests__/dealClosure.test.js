import test from 'node:test';
import assert from 'node:assert/strict';

import { isClosedDeal } from '../dealClosure.js';
import { summariseDeals } from '../../../src/views/finance/dealCancellation.js';

const winning = new Set(['ganado', 'col_mtc2nwec_fij']);

test('un lead en cotización con cuotas del contrato no es una venta cerrada', () => {
  assert.equal(isClosedDeal({ status: 'cotizado' }, winning), false);
});

test('la columna ganadora del equipo cierra la venta, no solo la cadena "ganado"', () => {
  assert.equal(isClosedDeal({ status: 'ganado' }, winning), true);
  assert.equal(isClosedDeal({ status: 'col_mtc2nwec_fij' }, winning), true);
});

test('el proyecto abierto y la plata que se movió también cuentan como venta', () => {
  assert.equal(isClosedDeal({ status: 'cotizado', hasProject: true }, winning), true);
  assert.equal(isClosedDeal({ status: 'cotizado', hasMoney: true }, winning), true);
});

test('los tratos sin ganar se cuentan aunque no se listen', () => {
  const ganado = { total: 1000, registered: 1000, closed: true };
  const sinGanar = { total: 6000, registered: 6000, closed: false };
  const totals = summariseDeals([ganado, sinGanar], (g) => g.closed);
  assert.equal(totals.cierresSinGanar, 1);
  assert.equal(totals.precioTotal, 1000);
  assert.equal(totals.porCobrar, 1000);
});
