import test from 'node:test';
import assert from 'node:assert/strict';

import { percentile } from '../campaignService.js';

/*
 * El reporte publica el P90 redondeado a un decimal, así que las pruebas
 * comparan igual: la interpolación en coma flotante devuelve 18.099999…, y
 * fijar ese valor en la prueba sería fijar el error de representación en vez
 * de la regla.
 */
const p90 = (valores) => Math.round(percentile(valores, 0.9) * 10) / 10;

/*
 * El P90 de la primera respuesta, que el reporte publica al lado de la
 * mediana.
 *
 * Viene de la auditoría comercial del corte del 10/11/2026: la mediana de
 * primera respuesta era de ~20 segundos —Avan acusa recibo al instante— y
 * debajo de esa cifra había 62 leads atendidos después de 15 minutos y 51
 * después de una hora. Una medida de centro no dice nada de la cola, y la cola
 * es la parte que se arregla; con la mediana sola, el funnel se presentaba
 * atendido y la decisión que salía de ahí era "no hay nada que hacer acá".
 *
 * Las dos se publican juntas a propósito. El P90 por sí solo tampoco serviría:
 * sin la mediana al lado no se puede distinguir un equipo lento de uno rápido
 * con unos pocos casos olvidados, y se corrigen distinto.
 */

test('el percentil interpola entre los dos valores que lo rodean', () => {
  // 10 valores: el P90 cae en la posición 8.1 de 0 a 9.
  const valores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  assert.equal(p90(valores), 18.1); // 9 + (100 - 9) * 0.1
  assert.equal(percentile(valores, 0.5), 5.5);
  assert.equal(percentile(valores, 0), 1);
  assert.equal(percentile(valores, 1), 100);
});

test('la lista no hace falta que venga ordenada', () => {
  assert.equal(percentile([100, 2, 1], 0.5), 2);
});

test('el caso que motivó la medida: la mediana baja esconde la cola', () => {
  /*
   * Nueve acuses de Avan en segundos y un lead al que recién le escribieron a
   * las tres horas. La mediana dice "medio minuto" y el P90, "hora y media".
   * Las dos son ciertas y solo la segunda señala lo que hay que atender.
   */
  const minutos = [0.3, 0.3, 0.3, 0.4, 0.4, 0.5, 0.5, 0.6, 90, 180];
  assert.equal(percentile(minutos, 0.5), 0.45, 'la mediana sigue siendo el acuse automático');
  assert.equal(p90(minutos), 99, 'el P90 muestra al lead que esperó horas');
});

test('un valor suelto es su propio percentil, y una lista vacía no inventa un cero', () => {
  assert.equal(percentile([7], 0.9), 7);
  /*
   * `null` y no 0: "nadie respondió todavía" no es "responden al instante", y
   * un cero ahí haría ver como inmejorable justo al anuncio cuyos leads nadie
   * atendió. Es la misma regla con la que el reporte distingue el cobrado CERO
   * del cobrado DESCONOCIDO.
   */
  assert.equal(percentile([], 0.9), null);
  assert.equal(percentile([null, undefined, NaN], 0.9), null);
});
