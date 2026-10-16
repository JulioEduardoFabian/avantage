import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveItf } from '../financeLedgerService.js';

/**
 * El ITF dejó de imponerse y pasó a proponerse: la fórmula del Excel del área
 * acierta casi siempre, pero el banco cobra lo que cobra (cuentas exoneradas,
 * traspasos entre cuentas propias, redondeos) y con el campo de solo lectura
 * esa diferencia se quedaba fuera de los libros.
 */

test('sin ITF se usa la fórmula del área', () => {
  assert.equal(resolveItf(undefined, 2500), 0.10);
  assert.equal(resolveItf(null, 5000), 0.25);
  // El formulario manda cadena vacía cuando nadie tocó el campo.
  assert.equal(resolveItf('', 5000), 0.25);
});

test('por debajo de S/ 1,000 la fórmula no cobra nada', () => {
  assert.equal(resolveItf(undefined, 999.99), 0);
});

test('la fórmula mira el valor absoluto: un egreso también paga ITF', () => {
  assert.equal(resolveItf(undefined, -2500), 0.10);
});

test('el ITF escrito a mano gana sobre la fórmula', () => {
  assert.equal(resolveItf(7.35, 2500), 7.35);
});

test('un cero escrito a mano NO es "no me lo dieron": es una cuenta exonerada', () => {
  // Tratarlo como ausente volvería imposible registrar el caso que más
  // justifica que el campo sea editable.
  assert.equal(resolveItf(0, 5000), 0);
  assert.equal(resolveItf('0', 5000), 0);
});

test('se redondea a dos decimales, como todo el dinero del módulo', () => {
  // Mismo redondeo que `calcItf` y que el resto de Finanzas. El campo pide
  // pasos de 0.01, así que acá no se persigue el medio centavo.
  assert.equal(resolveItf('3.456', 2500), 3.46);
  assert.equal(resolveItf('3.454', 2500), 3.45);
});

test('un ITF negativo o que no es número se rechaza', () => {
  assert.throws(() => resolveItf(-3, 2500), /mayor o igual a 0/);
  assert.throws(() => resolveItf('abc', 2500), /mayor o igual a 0/);
});
