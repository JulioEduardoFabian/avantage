import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWinDeal, parseAmount } from '../winDeal.js';

/*
 * El dinero de un lead no siempre nace en el modal de cierre: el cronograma del
 * contrato y la pantalla de Finanzas escriben las mismas filas de
 * `finance_income`. Cuando el cliente ya pagó todo y alguien lo asentó por esos
 * caminos, el cierre pedía igual "el primer pago" y moría contra la validación
 * del total ("supera el saldo pendiente de este lead: S/ 0.00"): la plata
 * estaba completa y el lead no se podía ganar.
 */

const settlementOf = (registered, total, count = 1) => ({
  total,
  registered,
  remaining: total == null ? null : Math.round((total - registered) * 100) / 100,
  installments: Array.from({ length: count }, (_, i) => ({ id: i + 1, monto: registered / count }))
});

test('con el precio ya cubierto por cuotas existentes, el cierre no registra otro pago', () => {
  const plan = planWinDeal({ settlement: settlementOf(3000, 3000), monto: '', totalAmount: '3000' });
  assert.equal(plan.hasAmount, false);
  assert.equal(plan.amount, 0);
  assert.equal(plan.total, 3000);
  assert.equal(plan.planned, 3000);
});

test('sin nada registrado, el primer pago sigue siendo obligatorio', () => {
  assert.throws(
    () => planWinDeal({ settlement: settlementOf(0, null, 0), monto: '', totalAmount: '3000' }),
    /primer pago es obligatorio/
  );
});

test('un cierre normal (nada registrado antes) no cambia', () => {
  const plan = planWinDeal({ settlement: settlementOf(0, null, 0), monto: '1000', totalAmount: '3000' });
  assert.equal(plan.hasAmount, true);
  assert.equal(plan.amount, 1000);
  assert.equal(plan.total, 3000);
  assert.equal(plan.setsTotal, true);
});

/*
 * Lo ya asentado cuenta para el total: el pago nuevo solo puede ser por el
 * saldo que falta, y el error lo dice con las dos cifras en vez de hablar de un
 * "saldo pendiente" que el vendedor no sabe de dónde sale.
 */
test('el pago nuevo se suma a lo ya registrado para medirlo contra el total', () => {
  const plan = planWinDeal({ settlement: settlementOf(1000, 3000), monto: '2000', totalAmount: '3000' });
  assert.equal(plan.planned, 3000);

  assert.throws(
    () => planWinDeal({ settlement: settlementOf(1000, 3000), monto: '2500', totalAmount: '3000' }),
    /ya registrados en Finanzas/
  );
});

test('las cuotas del cronograma entran en la cuenta junto con lo ya registrado', () => {
  const plan = planWinDeal({
    settlement: settlementOf(500, 3000),
    monto: '500',
    totalAmount: '3000',
    installments: [{ monto: 1000 }, { monto: 1000 }]
  });
  assert.equal(plan.planned, 3000);

  assert.throws(
    () => planWinDeal({
      settlement: settlementOf(500, 3000),
      monto: '500',
      totalAmount: '3000',
      installments: [{ monto: 1500 }, { monto: 1000 }]
    }),
    /Las cuotas suman S\/ 3500\.00/
  );
});

test('el precio total no puede quedar por debajo de lo ya registrado', () => {
  assert.throws(
    () => planWinDeal({ settlement: settlementOf(3000, 3000), monto: '', totalAmount: '2000' }),
    /no puede ser menor a lo que este lead ya tiene/
  );
});

test('un monto que no es un número mayor a 0 se rechaza antes de tocar nada', () => {
  for (const monto of ['0', '-50', 'abc']) {
    assert.throws(
      () => planWinDeal({ settlement: settlementOf(0, null, 0), monto, totalAmount: '3000' }),
      /mayor a 0/,
      `un monto ${monto} no puede pasar`
    );
  }
});

/*
 * Sin precio total no hay techo contra el cual medir: son los leads viejos, que
 * nunca lo fijaron. Lo que se registre entra igual.
 */
test('sin precio total no hay nada que validar contra el techo', () => {
  const plan = planWinDeal({ settlement: settlementOf(0, null, 0), monto: '900', totalAmount: '' });
  assert.equal(plan.total, null);
  assert.equal(plan.setsTotal, false);
  assert.equal(plan.planned, 900);
});

test('el campo vacío y el cero no son lo mismo', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(undefined), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount('0'), 0);
});
