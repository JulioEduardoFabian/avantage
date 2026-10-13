import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADOS_DIARIO, FinanceLedgerService } from '../financeLedgerService.js';

/*
 * El estado de un asiento del libro diario se cambia de un clic desde la tabla
 * (`PATCH /api/finance/journal/:id/estado` → `updateJournalEstado`), y no
 * reenviando el asiento entero por el PUT del formulario: mandar fecha, monto,
 * banco y detalle para cambiar una palabra reescribe de paso campos que nadie
 * tocó —un ITF recalculado, una fecha normalizada distinto— en una vuelta que
 * solo quería decir "esto ya se pagó".
 *
 * De este estado cuelgan los totales de la pestaña: lo pendiente es dinero que
 * todavía no se movió y suma aparte.
 */

const ledger = new FinanceLedgerService();

test('el libro diario solo conoce pagado y pendiente', () => {
  assert.deepEqual(ESTADOS_DIARIO, ['pagado', 'pendiente']);
  assert.equal(
    ESTADOS_DIARIO.includes('verificado'),
    false,
    'verificar es del ciclo de vida de un ingreso, no de un asiento'
  );
});

test('un estado que no existe se rechaza antes de tocar la base', async () => {
  for (const invalido of ['verificado', 'PAGADO', '', null, undefined]) {
    await assert.rejects(() => ledger.updateJournalEstado(1, invalido), /estado debe ser/i);
  }
});
