import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinQuietHours } from '../whatsappBotService.js';

/*
 * Franja de silencio de los seguimientos. La comprobación vive en una función
 * propia porque la fórmula depende de si la franja cruza la medianoche, y
 * escribirla a mano se rompe en silencio: con la fórmula de una sola forma
 * (`hora < fin || hora >= inicio`), una franja de 1 a 5 da "siempre en
 * silencio" y el bot dejaría de mandar seguimientos para siempre.
 */

test('franja que NO cruza la medianoche (p. ej. 01:00–05:00)', () => {
  assert.equal(isWithinQuietHours(0, 1, 5), false, 'medianoche: el bot puede escribir');
  assert.equal(isWithinQuietHours(1, 1, 5), true, 'la 1 a.m. ya es silencio');
  assert.equal(isWithinQuietHours(3, 1, 5), true);
  assert.equal(isWithinQuietHours(4, 1, 5), true);
  assert.equal(isWithinQuietHours(5, 1, 5), false, 'a las 5 vuelve a poder escribir');
  assert.equal(isWithinQuietHours(12, 1, 5), false);
  assert.equal(isWithinQuietHours(23, 1, 5), false);
});

test('franja que SÍ cruza la medianoche (21:00–08:00) sigue funcionando', () => {
  assert.equal(isWithinQuietHours(20, 21, 8), false);
  assert.equal(isWithinQuietHours(21, 21, 8), true);
  assert.equal(isWithinQuietHours(23, 21, 8), true);
  assert.equal(isWithinQuietHours(0, 21, 8), true);
  assert.equal(isWithinQuietHours(7, 21, 8), true);
  assert.equal(isWithinQuietHours(8, 21, 8), false);
});

/*
 * La franja configurada pasó de 01:00–05:00 a 22:00–08:00. La anterior era
 * demasiado estrecha: el 01/10 tres contactos que escribieron entre las 00:04
 * y las 00:28 recibieron su recordatorio a las 05:06 — fuera del silencio
 * según el código, pero son las cinco de la mañana.
 */
test('la franja configurada por defecto cubre la noche entera', () => {
  assert.equal(isWithinQuietHours(9), false, 'las 9 a.m.: el bot puede escribir');
  assert.equal(isWithinQuietHours(15), false);
  assert.equal(isWithinQuietHours(21), false, 'las 9 p.m. todavía es horario razonable');
  assert.equal(isWithinQuietHours(22), true, 'a las 10 p.m. empieza el silencio');
  assert.equal(isWithinQuietHours(0), true);
  assert.equal(isWithinQuietHours(2), true);
  assert.equal(isWithinQuietHours(5), true, 'las 5 a.m. YA NO son horario de escribir');
  assert.equal(isWithinQuietHours(7), true);
  assert.equal(isWithinQuietHours(8), false, 'a las 8 vuelve a poder escribir');
});
