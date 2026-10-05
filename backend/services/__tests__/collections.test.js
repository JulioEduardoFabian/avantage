import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, ESTADOS_COBRANZA } from '../collectionService.js';
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
