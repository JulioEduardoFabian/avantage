import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePaymentFields } from '../commissionService.js';

/**
 * El pago de una comisión: cuánto se le paga, de qué cuenta sale y cuándo.
 *
 * Lo que se prueba acá es la regla que decide cifras y fechas. Que el egreso
 * reste en la tarjeta de SU cuenta vive en las consultas de `getOverview()`
 * (agrupadas por `banco`, igual que los salarios), y que el `%` se recalcule
 * desde el monto corregido vive en `update()`, que necesita la base de la
 * venta guardada en la fila.
 */

test('el monto se guarda en positivo y redondeado a dos decimales', () => {
  // Las dos altas automáticas lo guardan en positivo: el signo de egreso lo
  // pone el Resumen al leerlo, no la fila.
  assert.equal(normalizePaymentFields({ monto: 30 }).monto, 30);
  assert.equal(normalizePaymentFields({ monto: -30 }).monto, 30);
  assert.equal(normalizePaymentFields({ monto: 33.333 }).monto, 33.33);
});

test('un monto que no es un número distinto de cero se rechaza', () => {
  for (const monto of [0, '', null, undefined, 'mucho']) {
    assert.throws(() => normalizePaymentFields({ monto }), /monto/i);
  }
});

test('marcar pagada sin decir la fecha la pone en hoy', () => {
  const hoy = new Date().toISOString().slice(0, 10);
  assert.equal(normalizePaymentFields({ monto: 30, estado: 'pagado' }).paid_at, hoy);
  // Y una fecha escrita a mano manda: una comisión de agosto pagada en
  // octubre salió de caja en octubre, y de esa fecha cuelga el mes en que el
  // Resumen la descuenta.
  assert.equal(
    normalizePaymentFields({ monto: 30, estado: 'pagado', paidAt: '2026-10-05' }).paid_at,
    '2026-10-05'
  );
});

test('volver a pendiente suelta la fecha del pago', () => {
  // Dejarla puesta descontaría de caja algo que no salió.
  const data = normalizePaymentFields({ monto: 30, estado: 'pendiente', paidAt: '2026-10-05' });
  assert.equal(data.estado, 'pendiente');
  assert.equal(data.paid_at, null);
});

test('un estado que no existe se rechaza', () => {
  assert.throws(() => normalizePaymentFields({ monto: 30, estado: 'verificado' }), /Estado/i);
});

test('la cuenta vacía queda en null y no como texto en blanco', () => {
  // De `banco` cuelga en qué tarjeta del Resumen resta el egreso, así que un
  // " " guardado sería una cuenta que no existe.
  assert.equal(normalizePaymentFields({ monto: 30, banco: '   ' }).banco, null);
  assert.equal(normalizePaymentFields({ monto: 30, banco: ' BCP ' }).banco, 'BCP');
  assert.equal(normalizePaymentFields({ monto: 30 }).banco, null);
});

test('el porcentaje ausente no se escribe: lo resuelve quien conoce la base', () => {
  // `update()` lo recalcula desde el monto corregido y `base_amount`; acá, sin
  // la base a la vista, mandar un 0 borraría el 2% de la fila.
  assert.equal('percent' in normalizePaymentFields({ monto: 30 }), false);
  assert.equal('percent' in normalizePaymentFields({ monto: 30, percent: '' }), false);
  assert.equal(normalizePaymentFields({ monto: 30, percent: 2.5 }).percent, 2.5);
});

test('un porcentaje negativo o ilegible se rechaza', () => {
  assert.throws(() => normalizePaymentFields({ monto: 30, percent: -2 }), /porcentaje/i);
  assert.throws(() => normalizePaymentFields({ monto: 30, percent: 'dos' }), /porcentaje/i);
});
