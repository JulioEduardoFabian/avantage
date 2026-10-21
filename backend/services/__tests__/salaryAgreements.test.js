import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentOf, TIPOS } from '../financeSalaryService.js';

/**
 * El salario por proyecto: cuánto se le paga a quien consiguió el lead, y los
 * pagos parciales con los que se va cubriendo.
 *
 * Lo que se prueba acá es la regla que decide cifras: el porcentaje de cada
 * pago. Que el acuerdo NO se descuente en el Resumen (es el compromiso, no
 * plata que salió) vive en las consultas de `getOverview()`, filtrando
 * `kind = 'pago'`.
 */

test('el porcentaje de un pago sale de su monto sobre el acuerdo', () => {
  // El caso que el equipo venía escribiendo a mano en el detalle:
  // "Pago del 40% del usuario Juan Diego".
  assert.equal(percentOf(-140, -350), 40);
  assert.equal(percentOf(-200, -500), 40);
  assert.equal(percentOf(-250, -1000), 25);
});

test('da igual el signo: los montos se guardan en negativo', () => {
  // La planilla guarda los egresos en negativo y el formulario los pide en
  // positivo; el porcentaje tiene que salir igual por los dos caminos.
  assert.equal(percentOf(200, 500), 40);
  assert.equal(percentOf(-200, 500), 40);
});

test('un pago que cubre todo el acuerdo es el 100%', () => {
  assert.equal(percentOf(-500, -500), 100);
});

test('se redondea a un decimal: "33.3%" y no catorce dígitos', () => {
  assert.equal(percentOf(-100, -300), 33.3);
});

test('sin acuerdo no hay porcentaje que calcular', () => {
  // Un pago suelto de la planilla de siempre no cuelga de ningún acuerdo.
  assert.equal(percentOf(-200, 0), null);
  assert.equal(percentOf(-200, null), null);
});

test('un pago de más del acuerdo se dice, no se recorta a 100', () => {
  // Si alguien pagó de más, esconderlo detrás de un 100% deja el error sin
  // forma de verse desde la tabla.
  assert.equal(percentOf(-600, -500), 120);
});

test('los dos tipos de fila son explícitos, no deducidos', () => {
  // De `kind` depende qué plata descuenta el Resumen Financiero; deducirlo de
  // "tiene proyecto" o "tiene hijos" es una regla implícita que se rompe sola.
  assert.deepEqual(TIPOS, ['pago', 'acuerdo']);
});
