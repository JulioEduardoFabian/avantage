/**
 * La aritmética del cronograma de pagos: repartir un saldo en cuotas iguales
 * y correr una fecha de vencimiento.
 *
 * Vive aparte de `PaymentScheduleEditor.vue` porque es justo lo que tiene que
 * cuadrar al céntimo —de estas cifras salen las filas de `finance_income`, que
 * son las que el cliente paga— y hay que poder probarlo sin montar el
 * componente.
 */
import { limaDay } from './leadCardDate.js';

/** Hoy en Lima (YYYY-MM-DD). */
export function todayISO() {
  return limaDay(new Date());
}

/**
 * Corre una fecha `YYYY-MM-DD` unos meses, con aritmética en UTC.
 *
 * El huso NO puede entrar acá: con el reloj del navegador en otra zona, un
 * `new Date('2026-10-26')` local se corre un día y el cronograma termina
 * venciendo el 25. Es la misma razón por la que el modal de reuniones escribe
 * el huso de Lima a mano.
 */
export function addMonths(isoDay, months) {
  const [year, month, day] = String(isoDay || '').split('-').map(Number);
  if (!year || !month || !day) return isoDay || '';
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

/**
 * Reparte `pending` en `count` cuotas iguales, redondeando a céntimos.
 *
 * La diferencia del redondeo va a la ÚLTIMA cuota (S/ 1000 en tres queda
 * 333.33 · 333.33 · 333.34) para que la suma dé exactamente el total: si
 * sobra o falta un céntimo, el cronograma nunca llega a decir "completo ✓" y
 * `replaceScheduleForLead()` lo rechaza por pasarse del precio.
 */
export function splitEvenly(pending, count) {
  if (count <= 0) return [];
  const cents = Math.round((Number(pending) || 0) * 100);
  if (cents <= 0) return new Array(count).fill(0);
  const share = Math.floor(cents / count);
  const shares = new Array(count).fill(share);
  shares[count - 1] = cents - share * (count - 1);
  return shares.map((value) => value / 100);
}
