import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agreedAmount,
  summariseDeals,
  unexpectedAmount
} from '../../../src/views/finance/dealCancellation.js';

/** Un cierre tal como lo arma `groupByLead()` en la pestaña INGRESOS. */
function cierre({ total = null, registered = 0, verificado = 0, porVerificar = 0, itf = 0, cancelled = false }) {
  return { total, registered, verificado, porVerificar, itf, cancelled };
}

const vivo = cierre({ total: 2000, registered: 2000, verificado: 1200, porVerificar: 300, itf: 0.1 });
const caido = cierre({ total: 3600, registered: 3600, cancelled: true });
const caidoConAlgoCobrado = cierre({ total: 1300, registered: 1300, verificado: 500, cancelled: true });

test('lo pactado sale del precio total y, sin él, de lo registrado', () => {
  assert.equal(agreedAmount(cierre({ total: 2000, registered: 500 })), 2000);
  assert.equal(agreedAmount(cierre({ total: null, registered: 500 })), 500);
});

test('lo que un cierre caído ya no va a traer descuenta lo que sí entró', () => {
  assert.equal(unexpectedAmount(caido), 3600);
  assert.equal(unexpectedAmount(caidoConAlgoCobrado), 800);
  // Cobrado de más: no hay nada que descartar, y nunca sale negativo.
  assert.equal(unexpectedAmount(cierre({ total: 1000, verificado: 1200, cancelled: true })), 0);
});

test('las cifras del trato cuentan solo los cierres que se están listando', () => {
  const grupos = [vivo, caido, caidoConAlgoCobrado];
  const ocultos = summariseDeals(grupos, (g) => !g.cancelled);

  assert.equal(ocultos.precioTotal, 2000);
  assert.equal(ocultos.registrado, 2000);
  assert.equal(ocultos.verificado, 1200);
  assert.equal(ocultos.porVerificar, 300);
  assert.equal(ocultos.itf, 0.1);
});

test('«No concretado» cuenta los caídos aunque no se estén listando', () => {
  const grupos = [vivo, caido, caidoConAlgoCobrado];
  const ocultos = summariseDeals(grupos, (g) => !g.cancelled);

  assert.equal(ocultos.cierresDescartados, 2);
  assert.equal(ocultos.descartado, 3600 + 800);
});

test('mostrar u ocultar los caídos no mueve «Por cobrar»', () => {
  const grupos = [vivo, caido, caidoConAlgoCobrado];
  const ocultos = summariseDeals(grupos, (g) => !g.cancelled);
  const todos = summariseDeals(grupos);

  // 2000 pactados − 1200 verificados − 300 por verificar = 500.
  assert.equal(ocultos.porCobrar, 500);
  assert.equal(todos.porCobrar, 500);

  // Y con los caídos a la vista, la tira vuelve a cuadrar sola:
  // precio total − verificado − por verificar − no concretado = por cobrar.
  assert.equal(
    Math.round((todos.precioTotal - todos.verificado - todos.porVerificar - todos.descartado) * 100) / 100,
    todos.porCobrar
  );
});

test('sin cierres caídos las dos lecturas son idénticas', () => {
  const grupos = [vivo, cierre({ total: 1000, registered: 1000, verificado: 1000 })];
  assert.deepEqual(summariseDeals(grupos, (g) => !g.cancelled), summariseDeals(grupos));
});
