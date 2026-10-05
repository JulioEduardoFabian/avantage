import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, deliveryState, ESTADOS_COBRANZA } from '../collectionService.js';
import { collectionEligibility, commissionAmount, COLLECTION_COMMISSION_PERCENT } from '../commissionService.js';

/*
 * Cobranzas mira las cuotas que todavía no cerró Finanzas, y cobrar NO es
 * verificar: marcar "cobrado" deja la cuota en `pagado`, que es el estado que ya
 * significaba "el cliente pagó y falta el visto bueno".
 */

test('la cobranza se ocupa de lo no verificado, nada más', () => {
  assert.deepEqual(ESTADOS_COBRANZA, ['pendiente', 'pagado']);
  assert.equal(ESTADOS_COBRANZA.includes('verificado'), false);
});

/*
 * Los días hasta el vencimiento se calculan en el servidor para que el texto de
 * la fila ("venció hace 3 días") y el filtro de vencidas cuenten lo mismo. El
 * día de calendario se compara como texto: construir un Date con la fecha ISO
 * corría el día hacia atrás en la zona horaria de Perú.
 */
test('los días al vencimiento se cuentan por día de calendario', () => {
  assert.equal(daysUntil('2026-10-10', '2026-10-05'), 5);
  assert.equal(daysUntil('2026-10-05', '2026-10-05'), 0);
  assert.equal(daysUntil('2026-10-02', '2026-10-05'), -3);
  assert.equal(daysUntil(null, '2026-10-05'), null);
});

test('una cuota sin fecha pactada no está vencida', () => {
  assert.equal(daysUntil(undefined), null);
});

test('la comisión de cobranza es el 2% de lo que entró', () => {
  assert.equal(COLLECTION_COMMISSION_PERCENT, 2);
  const { ok, base } = collectionEligibility({ monto: 1200 });
  assert.equal(ok, true);
  assert.equal(commissionAmount(base, COLLECTION_COMMISSION_PERCENT), 24);
});

test('una cuota sin monto no comisiona: no se cobró nada', () => {
  for (const monto of [0, null, undefined, '']) {
    const { ok } = collectionEligibility({ monto });
    assert.equal(ok, false, `un monto ${JSON.stringify(monto)} no puede comisionar`);
  }
});

/*
 * La cuota cuyo trabajo YA salió es la deuda más urgente del tablero: el cliente
 * tiene su capítulo y nosotros no tenemos su plata. Es el mismo cruce que
 * Entregables llama `sin_cobrar`, visto desde el lado de quien cobra.
 */

test('un entregable ya entregado marca la cuota como trabajo entregado', () => {
  const estado = deliveryState({ estado: 'pendiente' }, [
    { title: 'Capítulo I', status: 'entregado', delivered_at: '2026-10-01' },
    { title: 'Anexos', status: 'pendiente', delivered_at: null }
  ]);
  assert.equal(estado.work_delivered, true);
  assert.equal(estado.delivered_count, 1);
  assert.equal(estado.last_delivered_at, '2026-10-01');
});

test('con varios entregados, la fecha que se muestra es la última', () => {
  const estado = deliveryState({ estado: 'pagado' }, [
    { status: 'entregado', delivered_at: '2026-09-20' },
    { status: 'entregado', delivered_at: '2026-10-02' }
  ]);
  assert.equal(estado.last_delivered_at, '2026-10-02');
});

test('sin entregables, o con todos pendientes, no hay trabajo entregado', () => {
  assert.equal(deliveryState({ estado: 'pendiente' }, []).work_delivered, false);
  assert.equal(deliveryState({ estado: 'pendiente' }, [{ status: 'pendiente' }]).work_delivered, false);
});

test('una cuota ya verificada no cuenta como "entregado sin cobrar": esa plata entró', () => {
  const estado = deliveryState({ estado: 'verificado' }, [{ status: 'entregado', delivered_at: '2026-10-01' }]);
  assert.equal(estado.work_delivered, false);
  assert.equal(estado.delivered_count, 1);
});

/*
 * El estado de entrega es una COLUMNA de la pantalla, así que se deriva en el
 * servidor: calcularlo en el navegador sería una segunda regla que se separa de
 * esta. "No asignado" es un estado con nombre y no una celda vacía — hay cuotas
 * que son solo plata (un pago adelantado, la cuota final) y eso no es un error
 * de carga.
 */

test('una cuota sin entregables atados queda como "no asignado"', () => {
  assert.equal(deliveryState({ estado: 'pendiente' }, []).delivery_status, 'no_asignado');
});

test('con entregables atados y ninguno entregado, está sin entregar', () => {
  const estado = deliveryState({ estado: 'pendiente' }, [{ status: 'pendiente' }, { status: 'pendiente' }]);
  assert.equal(estado.delivery_status, 'pendiente');
  assert.equal(estado.deliverables_count, 2);
});

test('si salió una parte del paquete, el estado es parcial', () => {
  const estado = deliveryState({ estado: 'pendiente' }, [
    { status: 'entregado', delivered_at: '2026-10-01' },
    { status: 'pendiente' }
  ]);
  assert.equal(estado.delivery_status, 'parcial');
  assert.equal(estado.delivered_count, 1);
  assert.equal(estado.deliverables_count, 2);
});

test('si salió todo lo que colgaba de la cuota, está entregado', () => {
  const estado = deliveryState({ estado: 'pendiente' }, [
    { status: 'entregado', delivered_at: '2026-10-01' },
    { status: 'entregado', delivered_at: '2026-10-03' }
  ]);
  assert.equal(estado.delivery_status, 'entregado');
});
