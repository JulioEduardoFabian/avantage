import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_WINDOW_MONTHS, addDay, limaToday, monthAfter, monthOf, parseDay,
  periodsBetween, resolveRange, sqlWindow
} from '../financeDateRange.js';
import {
  inDateRange, matchingPreset, presetRange, rangeLabel
} from '../../../src/views/finance/dateRange.js';

/**
 * Los bordes de un rango de fechas son lo que se rompe en silencio: un "hasta"
 * que no incluye su propio día deja afuera lo cobrado el último día del mes, y
 * un recorte de meses que no coincide con el de los totales hace que la gráfica
 * y las tarjetas de arriba digan cifras distintas. Nada de esto necesita la
 * base, así que se verifica acá.
 *
 * El mismo archivo prueba el módulo del servidor y su espejo del navegador
 * (`src/views/finance/dateRange.js`): el filtro de las seis pestañas de
 * Finanzas y el recorte que hace el SQL tienen que partir el día por el mismo
 * lado, y en archivos separados nadie se entera el día que dejan de coincidir.
 */

test('un día inválido no se "corrige" a otro mes', () => {
  assert.equal(parseDay('2026-02-31'), null);
  assert.equal(parseDay('2026-13-01'), null);
  assert.equal(parseDay('cualquier cosa'), null);
  assert.equal(parseDay(''), null);
  assert.equal(parseDay(null), null);
});

test('un mes suelto se toma como su día 1, y un ISO con hora se recorta', () => {
  assert.equal(parseDay('2026-10'), '2026-10-01');
  assert.equal(parseDay('2026-10-05T00:00:00.000Z'), '2026-10-05');
});

test('sin rango pedido, periodsBetween devuelve null y no un tramo vacío', () => {
  // La diferencia importa: null es "no me pidieron rango" (y quien llama usa
  // su propia ventana por defecto); [] es "el rango pedido no tiene meses".
  assert.equal(periodsBetween(null, null), null);
  assert.equal(periodsBetween('', ''), null);
  assert.deepEqual(periodsBetween('2026-10-05', '2026-08-15'), []);
});

test('los meses del tramo incluyen los dos extremos', () => {
  assert.deepEqual(periodsBetween('2026-08-15', '2026-10-05'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(periodsBetween('2026-10-01', '2026-10-31'), ['2026-10']);
});

test('el tramo cruza el fin de año sin saltarse enero', () => {
  assert.deepEqual(
    periodsBetween('2026-11-20', '2027-02-03'),
    ['2026-11', '2026-12', '2027-01', '2027-02']
  );
});

test('sin "hasta", el tramo llega hasta hoy', () => {
  // Leerlo como "ese mes y nada más" era la trampa: quien pone solo el "desde"
  // está pidiendo "de ahí en adelante", y con el tramo cerrado en su propio mes
  // perdía todo lo posterior sin que nada lo dijera.
  const r = resolveRange({ from: '2026-08-15', today: '2026-10-30' });
  assert.deepEqual(r, { desde: '2026-08-15', hasta: '2026-10-30', periods: ['2026-08', '2026-09', '2026-10'] });
});

test('un "desde" en el futuro cierra el tramo en sí mismo y no al revés', () => {
  const r = resolveRange({ from: '2027-03-10', today: '2026-10-30' });
  assert.deepEqual(r, { desde: '2027-03-10', hasta: '2027-03-10', periods: ['2027-03'] });
});

test('sin "desde", el tramo arranca lo más atrás que entra en el tope', () => {
  const r = resolveRange({ to: '2026-10-31', today: '2026-10-30' });
  assert.equal(r.periods.length, MAX_WINDOW_MONTHS);
  assert.equal(r.periods[r.periods.length - 1], '2026-10');
  assert.equal(r.desde, r.periods[0] + '-01');
  assert.equal(r.hasta, '2026-10-31');
});

test('los dos extremos quedan cerrados, así los totales y la gráfica cuentan lo mismo', () => {
  for (const pedido of [{ from: '2026-08-15' }, { to: '2026-08-15' }, { from: '2026-01-01', to: '2026-03-31' }]) {
    const r = resolveRange({ ...pedido, today: '2026-10-30' });
    assert.ok(r.desde && r.hasta, JSON.stringify(pedido));
    assert.ok(r.desde <= r.hasta, JSON.stringify(pedido));
  }
});

test('el "hoy" del servidor es el día de Lima y no el UTC', () => {
  // A las 20:00 de Lima el ISO ya es el día siguiente: un rango "hasta hoy"
  // incluiría un día que todavía no empezó.
  assert.equal(limaToday(new Date('2026-10-31T02:00:00.000Z')), '2026-10-30');
  assert.equal(limaToday(new Date('2026-10-30T12:00:00.000Z')), '2026-10-30');
});

test('un tramo recortado devuelve el "desde" que de verdad se va a contar', () => {
  // Con el pedido, la tarjeta diría "del 01/01/2020 al 31/10/2026" sumando solo
  // los últimos dos años.
  const r = resolveRange({ from: '2020-01-01', to: '2026-10-31' });
  assert.equal(r.periods.length, MAX_WINDOW_MONTHS);
  assert.equal(r.desde, r.periods[0] + '-01');
  assert.equal(r.hasta, '2026-10-31');
  // El rango que entra entero no se toca.
  const corto = resolveRange({ from: '2026-08-15', to: '2026-10-05' });
  assert.equal(corto.desde, '2026-08-15');
});

test('un tramo largo se recorta a los ÚLTIMOS meses del tope', () => {
  const periods = periodsBetween('2020-01-01', '2026-10-31');
  assert.equal(periods.length, MAX_WINDOW_MONTHS);
  // Lo que se revisa de un rango de años es cómo viene terminando.
  assert.equal(periods[periods.length - 1], '2026-10');
  assert.equal(periods[0], '2024-11');
});

test('el "hasta" de la ventana SQL incluye su propio día', () => {
  // Se compara con `<` contra el día siguiente: así el borde es el mismo para
  // una columna DATE y para un timestamp.
  const window = sqlWindow({
    from: '2026-08-15', to: '2026-10-05', periods: ['2026-08', '2026-09', '2026-10']
  });
  assert.deepEqual(window, { from: '2026-08-15', before: '2026-10-06' });
});

test('un rango al revés dentro del mismo mes queda sin meses y sin ventana', () => {
  // Los dos extremos caen en octubre, así que recorrer los meses no alcanza
  // para detectarlo: la comparación es día contra día. Sin ella la ventana
  // salía `from > before` —una consulta que no puede devolver nada— y el
  // período vacío de la pantalla era correcto por accidente.
  assert.deepEqual(resolveRange({ from: '2026-10-31', to: '2026-10-01' }).periods, []);
  assert.deepEqual(periodsBetween('2026-10-31', '2026-10-01'), []);
  assert.equal(sqlWindow({ from: '2026-10-31', to: '2026-10-01', periods: ['2026-10'] }), null);
});

test('sin meses no hay ventana', () => {
  assert.equal(sqlWindow({ periods: [] }), null);
});

test('sin rango, la ventana SQL es la de los meses del gráfico', () => {
  assert.deepEqual(
    sqlWindow({ periods: ['2026-09', '2026-10'] }),
    { from: '2026-09-01', before: '2026-11-01' }
  );
});

test('si el tramo se recortó, la ventana sigue a los meses y no al rango pedido', () => {
  // Totales y gráfica tienen que contar lo mismo: con el `from` original, la
  // tarjeta de arriba sumaría meses que la curva no dibuja.
  const periods = periodsBetween('2020-01-01', '2026-10-31');
  const window = sqlWindow({ from: '2020-01-01', to: '2026-10-31', periods });
  assert.equal(window.from, periods[0] + '-01');
  assert.equal(window.before, '2026-11-01');
});

test('monthOf, monthAfter y addDay cruzan el fin de mes y de año', () => {
  assert.equal(monthOf('2026-10-05'), '2026-10');
  assert.equal(monthAfter('2026-12'), '2027-01-01');
  assert.equal(addDay('2026-10-31'), '2026-11-01');
  assert.equal(addDay('2026-12-31'), '2027-01-01');
  // 2028 es bisiesto.
  assert.equal(addDay('2028-02-28'), '2028-02-29');
});

/* --- El espejo del navegador: src/views/finance/dateRange.js -------------- */

test('el filtro del navegador es inclusivo en los dos extremos', () => {
  assert.equal(inDateRange('2026-10-01T00:00:00.000Z', '2026-10-01', '2026-10-31'), true);
  assert.equal(inDateRange('2026-10-31T00:00:00.000Z', '2026-10-01', '2026-10-31'), true);
  assert.equal(inDateRange('2026-09-30T00:00:00.000Z', '2026-10-01', '2026-10-31'), false);
  assert.equal(inDateRange('2026-11-01T00:00:00.000Z', '2026-10-01', '2026-10-31'), false);
});

test('el navegador y el SQL recortan el mismo tramo', () => {
  // El SQL compara `fecha >= from` y `fecha < before`; el navegador, día contra
  // día. El último día del rango tiene que entrar en los dos.
  const periods = periodsBetween('2026-10-01', '2026-10-31');
  const { from, before } = sqlWindow({ from: '2026-10-01', to: '2026-10-31', periods });
  for (const dia of ['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01']) {
    const entraEnSql = dia >= from && dia < before;
    assert.equal(
      inDateRange(dia + 'T00:00:00.000Z', '2026-10-01', '2026-10-31'),
      entraEnSql,
      dia
    );
  }
});

test('sin rango entra todo; con rango, una fila sin fecha no se cuela', () => {
  assert.equal(inDateRange(null, '', ''), true);
  assert.equal(inDateRange(null, '2026-10-01', ''), false);
  assert.equal(inDateRange('', '', '2026-10-31'), false);
});

test('un solo extremo filtra por ese lado y deja el otro abierto', () => {
  assert.equal(inDateRange('2026-01-05T00:00:00.000Z', '', '2026-10-31'), true);
  assert.equal(inDateRange('2027-01-05T00:00:00.000Z', '', '2026-10-31'), false);
  assert.equal(inDateRange('2027-01-05T00:00:00.000Z', '2026-10-01', ''), true);
});

test('los atajos y el botón activo dicen lo mismo', () => {
  const hoy = '2026-10-30';
  assert.deepEqual(presetRange('hoy', hoy), { desde: '2026-10-30', hasta: '2026-10-30' });
  assert.deepEqual(presetRange('semana', hoy), { desde: '2026-10-24', hasta: '2026-10-30' });
  assert.deepEqual(presetRange('mes-actual', hoy), { desde: '2026-10-01', hasta: '2026-10-30' });
  // "Mes pasado" es el mes completo, no 30 días hacia atrás.
  assert.deepEqual(presetRange('mes-pasado', hoy), { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepEqual(presetRange('trimestre', hoy), { desde: '2026-08-01', hasta: '2026-10-30' });
  assert.deepEqual(presetRange('anio-actual', hoy), { desde: '2026-01-01', hasta: '2026-10-30' });

  for (const key of ['hoy', 'semana', 'mes-actual', 'mes-pasado', 'trimestre', 'anio-actual']) {
    const { desde, hasta } = presetRange(key, hoy);
    assert.equal(matchingPreset(desde, hasta, hoy), key);
  }
  // Un rango escrito a mano no marca ningún atajo.
  assert.equal(matchingPreset('2026-10-07', '2026-10-09', hoy), '');
});

test('"mes pasado" cruza el fin de año', () => {
  assert.deepEqual(
    presetRange('mes-pasado', '2027-01-15'),
    { desde: '2026-12-01', hasta: '2026-12-31' }
  );
});

test('el rango se escribe en una frase que se pueda leer de corrido', () => {
  assert.equal(rangeLabel('2026-10-01', '2026-10-31'), 'del 01/10/2026 al 31/10/2026');
  assert.equal(rangeLabel('2026-10-05', '2026-10-05'), 'el 05/10/2026');
  assert.equal(rangeLabel('2026-10-05', ''), 'desde el 05/10/2026');
  assert.equal(rangeLabel('', '2026-10-05'), 'hasta el 05/10/2026');
  assert.equal(rangeLabel('', ''), '');
});
