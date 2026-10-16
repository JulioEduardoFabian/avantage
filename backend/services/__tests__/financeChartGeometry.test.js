import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monotonePath, niceAxisMax, sampleCurveRange } from '../../../src/views/finance/chartGeometry.js';

/**
 * Las dos cosas del gráfico de Flujo de Fondos que pueden decir algo falso: la
 * escala del eje y la forma de la curva.
 */

test('el eje sube a una cifra limpia, no al máximo por 1.15', () => {
  // El caso real: el eje decía "S/ 22.5k · 14.9k · 7.4k", que no sirve para
  // estimar de un vistazo.
  assert.equal(niceAxisMax(19600), 20000);
  assert.equal(niceAxisMax(1043), 1250);
  assert.equal(niceAxisMax(8200), 10000);
  assert.equal(niceAxisMax(2600), 3000);
});

test('el techo nunca queda por debajo del dato', () => {
  for (const valor of [1, 999, 1000, 1001, 45678, 123456]) {
    assert.ok(niceAxisMax(valor) >= valor, `${valor} no entra bajo ${niceAxisMax(valor)}`);
  }
});

test('sin datos el eje igual tiene una escala usable', () => {
  assert.ok(niceAxisMax(0) > 0);
});

/* -------------------------------- La curva ------------------------------- */

// Y crece hacia ABAJO en un SVG: el valor más alto es el `y` más chico.
const BASE = 200;
const PICO = 40;

test('la curva no se hunde por debajo de la base entre dos meses en cero', () => {
  // Era el caso visible en pantalla: con un mes en cero, un pico y otra caída,
  // la curva anterior dibujaba ingresos NEGATIVOS entre medio.
  const puntos = [
    { x: 50, y: BASE }, { x: 150, y: BASE }, { x: 250, y: 190 },
    { x: 350, y: BASE }, { x: 450, y: PICO }, { x: 550, y: 120 }
  ];
  const { min, max } = sampleCurveRange(monotonePath(puntos));
  assert.ok(max <= BASE + 0.5, `la curva baja a ${max}, por debajo de la base ${BASE}`);
  assert.ok(min >= PICO - 0.5, `la curva sube a ${min}, por encima del pico ${PICO}`);
});

test('la curva nunca se pasa del rango de los puntos que une', () => {
  const puntos = [
    { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 20 },
    { x: 300, y: 180 }, { x: 400, y: 60 }
  ];
  const { min, max } = sampleCurveRange(monotonePath(puntos));
  assert.ok(min >= 20 - 0.5 && max <= 180 + 0.5, `rango ${min}–${max} fuera de 20–180`);
});

test('con un solo punto o ninguno no revienta', () => {
  assert.equal(monotonePath([]), '');
  assert.equal(monotonePath([{ x: 10, y: 20 }]), 'M 10 20');
});

test('la curva pasa exactamente por cada punto', () => {
  const puntos = [{ x: 0, y: 100 }, { x: 100, y: 40 }, { x: 200, y: 160 }];
  const d = monotonePath(puntos);
  // Los puntos de llegada de cada tramo son los datos, sin corrimientos.
  assert.ok(d.startsWith('M 0.0 100.0'));
  assert.ok(d.includes('100.0 40.0'), d);
  assert.ok(d.endsWith('200.0 160.0'), d);
});
