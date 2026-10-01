import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksDelivery } from '../deliverableService.js';

/**
 * Reporte del equipo: un entregable atado a una cuota que todavía NO se pagó
 * ofrecía igual el botón "Marcar como entregado". Entregar ahí es regalar el
 * trabajo, así que la cuota sin pagar frena la entrega — y la regla vive en el
 * backend, no solo en el botón: una pestaña vieja o una llamada directa a la
 * API se saltarían una regla que solo existiera en la pantalla.
 */

test('una cuota sin pagar frena la entrega', () => {
  assert.equal(blocksDelivery('pendiente'), true);
});

test('una cuota ya pagada deja entregar aunque Finanzas no la haya verificado', () => {
  // El cliente pagó y subió su comprobante: lo único que falta es el visto
  // bueno interno. Frenar la entrega ahí sería castigarlo por un trámite
  // nuestro — esa entrega se registra y se ve como "Entregado sin cobrar".
  assert.equal(blocksDelivery('pagado'), false);
  assert.equal(blocksDelivery('verificado'), false);
});

test('sin cuota atada no hay cobro del que depender', () => {
  // `markDelivered` solo consulta la regla cuando hay `income_id`; con un
  // estado vacío tampoco debe bloquear.
  assert.equal(blocksDelivery(null), false);
  assert.equal(blocksDelivery(undefined), false);
});
