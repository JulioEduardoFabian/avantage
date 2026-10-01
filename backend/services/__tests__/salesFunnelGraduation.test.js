import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSalesFunnelStatus, leadHasGraduated } from '../salesFunnelStage.js';
import { phoneMatchKey } from '../leadService.js';

/**
 * El equipo de ventas reportó tres veces lo mismo: leads que el closer dejó
 * cotizados reaparecían en el Setter Funnel. Los topes anteriores preguntaban
 * "¿el status de este lead es la clave de una columna del tablero de Ventas?",
 * y esa pregunta deja de responder que sí en cuanto la columna cambia.
 *
 * Estas pruebas fijan la regla nueva: una vez sellado `sales_funnel_at`, el
 * lead es del closer pase lo que pase con las columnas.
 */

/** Las columnas tal como las arma el equipo: claves generadas, no legibles. */
const salesStatuses = new Set(['cita_agendada', 'en_negociacion', 'ganado', 'perdido', 'col_mtc2nwec_fij']);

test('un lead sellado sigue siendo del closer aunque borren su columna', () => {
  const lead = { status: 'col_borrada_hace_un_mes', sales_funnel_at: '2026-09-30 10:00:00' };

  // La regla vieja (solo el status) ya no lo reconoce...
  assert.equal(isSalesFunnelStatus(lead.status, salesStatuses), false);
  // ...pero el sello sí: el bot no puede volver a tocarlo.
  assert.equal(leadHasGraduated(lead, salesStatuses), true);
});

test('un lead sellado sigue siendo del closer aunque quedara con un status del setter', () => {
  // Es el daño ya hecho: el bot alcanzó a congelarlo antes del tope. Tiene que
  // volver a verse en el tablero de Ventas, no en el del setter.
  const lead = { status: 'congelado', sales_funnel_at: '2026-09-30 10:00:00' };
  assert.equal(leadHasGraduated(lead, salesStatuses), true);
});

test('un lead sellado sigue siéndolo aunque no se hayan podido cargar las columnas', () => {
  const lead = { status: 'col_mtc2nwec_fij', sales_funnel_at: '2026-09-30 10:00:00' };
  assert.equal(leadHasGraduated(lead, new Set()), true);
});

test('sin sello, la etapa sigue decidiendo (leads anteriores al marcador)', () => {
  assert.equal(leadHasGraduated({ status: 'col_mtc2nwec_fij' }, salesStatuses), true);
  assert.equal(leadHasGraduated({ status: 'ganado' }, salesStatuses), true);
});

test('un lead del setter sin sello no es del closer', () => {
  for (const status of ['conversacion_abierta', 'calificando', 'congelado', 'transferido_closer', 'descartado']) {
    assert.equal(leadHasGraduated({ status }, salesStatuses), false, `lo daría por comercial: ${status}`);
  }
});

test('las etapas de bandeja no gradúan a nadie: ahí entra el trabajo del bot', () => {
  for (const status of ['nuevo', 'inbox', 'abierto']) {
    assert.equal(leadHasGraduated({ status }, salesStatuses), false, `lo daría por comercial: ${status}`);
  }
});

/**
 * El otro camino por el que un lead "volvía" al setter: el bot no encontraba al
 * lead que ya existía porque el teléfono estaba guardado con otro formato, le
 * creaba un gemelo en "conversación abierta" y lo trabajaba de cero.
 */
test('el mismo número escrito de cualquier forma cruza igual', () => {
  const waId = '51987654321';
  for (const stored of ['+51 987 654 321', '51987654321', '987654321', '(051) 987-654-321', '+51-987.654.321']) {
    assert.equal(phoneMatchKey(stored), phoneMatchKey(waId), `no cruzaría: "${stored}"`);
  }
});

test('un teléfono demasiado corto no cruza con nadie', () => {
  for (const value of ['', null, undefined, '123', '9876']) {
    assert.equal(phoneMatchKey(value), null, `cruzaría por: "${value}"`);
  }
});

test('dos números distintos no se confunden', () => {
  assert.notEqual(phoneMatchKey('51987654321'), phoneMatchKey('51912345678'));
});
