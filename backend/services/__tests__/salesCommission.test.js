import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionAmount, commissionEligibility, SETTER_COMMISSION_PERCENT } from '../commissionService.js';
import { setterSeal } from '../leadService.js';

/*
 * La comisión de la setter: el 2% de la venta que cerró el closer con el lead
 * que ella le pasó.
 *
 * Lo que fijan estas pruebas es de quién es la comisión. El responsable del
 * lead CAMBIA en el camino —la setter lo trabaja, el closer lo cierra— así que
 * calcularla al final mirando quién lo tiene asignado se la daría siempre al
 * closer. Por eso el setter se sella al graduar y no se vuelve a tocar.
 */

test('el setter se sella con quien tenía el lead al graduarlo', () => {
  const lead = { assigned_user_id: 4, setter_user_id: null };
  assert.deepEqual(setterSeal(lead, { id: 9 }, 'user'), { setter_user_id: 4 });
});

test('un lead sin responsable sella a quien hizo el pase', () => {
  const lead = { assigned_user_id: null, setter_user_id: null };
  assert.deepEqual(setterSeal(lead, { id: 9 }, 'user'), { setter_user_id: 9 });
});

test('el bot no se sella como setter: no hay a quién comisionar', () => {
  const lead = { assigned_user_id: null, setter_user_id: null };
  assert.deepEqual(setterSeal(lead, { id: 'bot' }, 'bot'), {});
});

test('el sello no se reescribe: el closer que toma el lead no pasa a ser el setter', () => {
  const lead = { assigned_user_id: 7, setter_user_id: 4 };
  assert.deepEqual(setterSeal(lead, { id: 7 }, 'user'), {});
});

test('la comisión es el 2% del total, redondeado a céntimos', () => {
  assert.equal(SETTER_COMMISSION_PERCENT, 2);
  assert.equal(commissionAmount(3500, 2), 70);
  assert.equal(commissionAmount(1234.56, 2), 24.69);
  assert.equal(commissionAmount('2000', 2), 40);
});

test('sin setter no hay comisión: el lead entró directo al funnel de ventas', () => {
  const { ok, reason } = commissionEligibility({ setter_user_id: null, closer_user_id: 7, total_amount: 3000 });
  assert.equal(ok, false);
  assert.match(reason, /no tiene setter/i);
});

test('quien cierra su propio lead no se comisiona a sí mismo', () => {
  const { ok, reason } = commissionEligibility({ setter_user_id: 7, closer_user_id: 7, total_amount: 3000 });
  assert.equal(ok, false);
  assert.match(reason, /misma persona/i);
});

test('sin precio total no hay sobre qué calcular el 2%', () => {
  for (const total of [null, 0, '', undefined]) {
    const { ok } = commissionEligibility({ setter_user_id: 4, closer_user_id: 7, total_amount: total });
    assert.equal(ok, false, `un total ${JSON.stringify(total)} no puede comisionar`);
  }
});

test('un traspaso con precio registrado sí comisiona, y sobre el total de la venta', () => {
  const { ok, base } = commissionEligibility({ setter_user_id: 4, closer_user_id: 7, total_amount: '4800.50' });
  assert.equal(ok, true);
  assert.equal(base, 4800.5);
  assert.equal(commissionAmount(base, SETTER_COMMISSION_PERCENT), 96.01);
});
