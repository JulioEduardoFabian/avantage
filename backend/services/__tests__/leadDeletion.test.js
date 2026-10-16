import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletionBlockReason } from '../leadService.js';

/**
 * El tope del borrado de un lead, que es lo que sostiene el botón "Eliminar"
 * del modal de duplicados.
 *
 * No es una precaución de más: `projects`, `quotes`, `sales_commissions`, las
 * notas y el historial de etapas cuelgan del lead en CASCADE —borrar la ficha
 * borra el proyecto entero— y `finance_income` y `contracts` en SET NULL, así
 * que las cuotas sobreviven pero se quedan sin cliente y desaparecen del
 * cierre en INGRESOS y de Cobranzas. El botón queda justo al lado de una ficha
 * marcada "🏆 con proyecto".
 */

const VACIO = { projects: 0, income: 0, contracts: 0, quotes: 0, commissions: 0 };

test('una ficha sin nada colgando se puede borrar', () => {
  assert.equal(deletionBlockReason(VACIO), null);
  // Sin datos del lead tampoco se bloquea: el que decide es el servidor al
  // borrar, y esto solo apaga el botón antes de intentarlo.
  assert.equal(deletionBlockReason(null), null);
});

test('un proyecto bloquea el borrado y la razón dice qué se perdería', () => {
  const motivo = deletionBlockReason({ ...VACIO, projects: 1 });
  assert.match(motivo, /proyecto abierto/);
  assert.match(motivo, /se borraría el proyecto/);
});

test('las cuotas bloquean: sobreviven al borrado pero se quedan sin cliente', () => {
  const motivo = deletionBlockReason({ ...VACIO, income: 3 });
  assert.match(motivo, /3 cuota/);
  assert.match(motivo, /sin cliente/);
  // No se nombra un proyecto que esta ficha no tiene.
  assert.doesNotMatch(motivo, /se borraría el proyecto/);
});

test('un contrato emitido también bloquea', () => {
  assert.match(deletionBlockReason({ ...VACIO, contracts: 1 }), /1 contrato/);
});

test('una cotización y una comisión devengada bloquean', () => {
  assert.match(deletionBlockReason({ ...VACIO, quotes: 2 }), /2 cotizaci/);
  assert.match(deletionBlockReason({ ...VACIO, commissions: 1 }), /comisi/);
});

test('con varias cosas colgando se nombran todas, no solo la primera', () => {
  // Quien elige cuál de las dos fichas borrar necesita ver el panorama
  // completo de una vez, no descubrirlo de a un intento por vez.
  const motivo = deletionBlockReason({ projects: 1, income: 2, contracts: 1, quotes: 1, commissions: 1 });
  assert.match(motivo, /proyecto abierto/);
  assert.match(motivo, /2 cuota/);
  assert.match(motivo, /1 contrato/);
  assert.match(motivo, /cotizaci/);
  assert.match(motivo, /comisi/);
});
