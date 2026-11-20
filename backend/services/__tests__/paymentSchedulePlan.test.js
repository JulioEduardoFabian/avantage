import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, splitEvenly } from '../../../src/paymentSchedulePlan.js';

/**
 * Las dos cuentas del cronograma de pagos que no pueden fallar: el reparto en
 * cuotas iguales y el corrimiento de la fecha de vencimiento. De acá salen las
 * filas de `finance_income`, que son las que el cliente paga.
 */

test('el precio total se parte en cuotas iguales', () => {
  assert.deepEqual(splitEvenly(1500, 1), [1500]);
  assert.deepEqual(splitEvenly(1500, 2), [750, 750]);
  assert.deepEqual(splitEvenly(1500, 3), [500, 500, 500]);
});

/*
 * El céntimo del redondeo va a la última cuota. Repartido "a ojo" (333.33 tres
 * veces), el cronograma queda un céntimo corto y nunca dice "completo ✓"; de
 * más, `replaceScheduleForLead()` lo rechaza por pasarse del precio del lead.
 */
test('la suma de las cuotas da exactamente el total', () => {
  for (const [total, count] of [[1000, 3], [1500, 7], [999.99, 4], [0.05, 3], [2500, 6]]) {
    const shares = splitEvenly(total, count);
    assert.equal(shares.length, count);
    const sum = shares.reduce((acc, value) => acc + value, 0);
    assert.equal(Math.round(sum * 100), Math.round(total * 100), `${total} en ${count} cuotas`);
  }
});

test('la diferencia del redondeo cae en la última cuota', () => {
  assert.deepEqual(splitEvenly(1000, 3), [333.33, 333.33, 333.34]);
});

// Sin saldo que repartir (el cierre ya cubrió el precio) no se propone nada:
// una cuota en cero no es una cuota.
test('un saldo agotado o negativo no inventa cuotas', () => {
  assert.deepEqual(splitEvenly(0, 2), [0, 0]);
  assert.deepEqual(splitEvenly(-50, 2), [0, 0]);
});

test('el vencimiento se corre de mes sin arrastrar el huso del navegador', () => {
  assert.equal(addMonths('2026-10-26', 1), '2026-11-26');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-10-26', 0), '2026-10-26');
});

test('una fecha vacía o rota no rompe el cronograma', () => {
  assert.equal(addMonths('', 1), '');
  assert.equal(addMonths(null, 1), '');
});
