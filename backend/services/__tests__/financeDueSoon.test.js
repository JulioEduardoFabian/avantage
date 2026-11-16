import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DUE_SOON_DAYS,
  daysBetween,
  dueLabel,
  dueState,
  limaToday,
  nextDueState
} from '../../../src/views/finance/dueSoon.js';

const HOY = '2026-11-16';
const pendiente = (due) => ({ estado: 'pendiente', due_date: due });

test('el plazo se cuenta en días de calendario, no en horas', () => {
  assert.equal(daysBetween(HOY, '2026-11-19'), 3);
  assert.equal(daysBetween(HOY, HOY), 0);
  assert.equal(daysBetween(HOY, '2026-11-10'), -6);
  // Cruzando mes y año, que es donde una resta de milisegundos se tuerce.
  assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3);
  assert.equal(daysBetween('no es fecha', HOY), null);
});

test('avisa desde tres días antes y no desde cuatro', () => {
  assert.equal(dueState(pendiente('2026-11-19'), HOY).urgent, true);
  assert.equal(dueState(pendiente('2026-11-20'), HOY).urgent, false);
  assert.equal(DUE_SOON_DAYS, 3);
});

test('pasarse de la fecha no es salir del aviso', () => {
  const vencida = dueState(pendiente('2026-11-10'), HOY);
  assert.equal(vencida.urgent, true);
  assert.equal(vencida.overdue, true);
  assert.equal(vencida.label, 'venció hace 6 días');

  const hoy = dueState(pendiente(HOY), HOY);
  assert.equal(hoy.urgent, true);
  assert.equal(hoy.overdue, false);
  assert.equal(hoy.label, 'vence hoy');
});

test('solo avisan las pendientes: lo pagado ya lo mandó el cliente', () => {
  assert.equal(dueState({ estado: 'pagado', due_date: '2026-11-10' }, HOY), null);
  assert.equal(dueState({ estado: 'verificado', due_date: '2026-11-10' }, HOY), null);
});

test('una cuota sin fecha pactada no puede avisar de nada', () => {
  assert.equal(dueState(pendiente(null), HOY), null);
  assert.equal(dueState(pendiente(''), HOY), null);
  assert.equal(dueState(null, HOY), null);
});

test('la fecha llega del API como ISO en UTC y se lee como día suelto', () => {
  assert.equal(dueState(pendiente('2026-11-17T00:00:00.000Z'), HOY).label, 'vence mañana');
});

test('el aviso del cierre es el de su cuota más urgente', () => {
  const alerta = nextDueState([
    pendiente('2026-12-20'),
    pendiente('2026-11-10'),
    pendiente('2026-11-18'),
    { estado: 'verificado', due_date: '2026-11-01' }
  ], HOY);
  assert.equal(alerta.due, '2026-11-10');
  assert.equal(alerta.overdue, true);
});

test('un cierre sin cuotas pendientes no avisa', () => {
  assert.equal(nextDueState([{ estado: 'verificado', due_date: '2026-11-01' }], HOY), null);
  assert.equal(nextDueState([], HOY), null);
});

test('el plazo se escribe como lo diría una persona', () => {
  assert.equal(dueLabel(-1), 'venció ayer');
  assert.equal(dueLabel(0), 'vence hoy');
  assert.equal(dueLabel(1), 'vence mañana');
  assert.equal(dueLabel(2), 'vence en 2 días');
});

test('el día de hoy es el de Lima y no el del reloj del navegador', () => {
  // 02:00 UTC del 17 es todavía el 16 en Lima (UTC-5): sin el huso, una cuota
  // del 19 se pondría roja un día antes.
  assert.equal(limaToday(new Date('2026-11-17T02:00:00.000Z')), '2026-11-16');
});
