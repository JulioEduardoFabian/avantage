/**
 * Las reglas de plata del cierre de venta, sacadas de la ruta y sin tocar la
 * base de datos.
 *
 * Están acá por dos razones. La primera es que el dinero de un lead NO siempre
 * nace en el modal de cierre: el cronograma del contrato
 * (`replaceScheduleForLead`) y la pantalla de Finanzas escriben las mismas
 * filas de `finance_income`. Cuando eso ya pasó, pedir "el primer pago" otra
 * vez chocaba contra la validación de `#assertWithinLeadTotal` ("supera el
 * saldo pendiente de este lead: S/ 0.00") y la venta no se podía ganar: el
 * dinero estaba completo y el lead no.
 *
 * La segunda es el orden. Puestas dentro de la ruta y DESPUÉS de mover el lead,
 * cualquiera de estas reglas dejaba el lead ya ganado y su proyecto abierto
 * pero sin ingreso — ganado a medias —, mientras el vendedor solo veía el
 * error y volvía a intentarlo. Verificadas acá, un cierre que no cuadra no
 * mueve nada.
 */

/** Dos decimales: el redondeo de la plata se hace una sola vez y en un sitio. */
function round(value) {
  return Math.round(value * 100) / 100;
}

export function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return Number(value);
}

/**
 * Decide qué registra este cierre a partir de lo que el lead YA tiene asentado
 * (`settlement`, de `financeLedgerService.getLeadSettlement()`) y de lo que
 * manda el modal. Devuelve `{ hasAmount, amount, total, planned }` o lanza el
 * error con el texto que lee el vendedor.
 *
 * `hasAmount: false` es el caso nuevo: las cuotas ya existen y cubren el
 * precio, así que el cierre solo gana el lead y adopta ese cronograma. Crear
 * otro ingreso ahí sería cobrar dos veces lo mismo.
 */
export function planWinDeal({ settlement, monto, totalAmount, installments = [] }) {
  const registered = round(Number(settlement?.registered) || 0);
  const amount = parseAmount(monto);
  const hasAmount = amount !== null;

  if (hasAmount && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error('El monto del primer pago debe ser un número mayor a 0.');
  }
  if (!hasAmount && registered <= 0) {
    throw new Error('El monto del primer pago es obligatorio: este lead todavía no tiene nada registrado en Finanzas.');
  }

  const setsTotal = totalAmount !== undefined && totalAmount !== null && String(totalAmount).trim() !== '';
  let total = settlement?.total != null ? Number(settlement.total) : null;
  if (setsTotal) {
    total = Number(totalAmount);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('El precio total del cierre debe ser un número mayor a 0.');
    }
    if (total < registered - 0.01) {
      throw new Error(
        `El precio total (S/ ${total.toFixed(2)}) no puede ser menor a lo que este lead ya tiene ` +
        `registrado en cuotas (S/ ${registered.toFixed(2)}).`
      );
    }
  }

  const scheduled = (Array.isArray(installments) ? installments : [])
    .reduce((sum, row) => sum + (Number(row?.monto) || 0), 0);
  const planned = round(registered + (hasAmount ? amount : 0) + scheduled);

  if (total != null && planned > total + 0.01) {
    throw new Error(
      `Las cuotas suman S/ ${planned.toFixed(2)}` +
      (registered > 0 ? ` (S/ ${registered.toFixed(2)} ya registrados en Finanzas)` : '') +
      ` y el precio total del cierre es S/ ${total.toFixed(2)}.`
    );
  }

  return { hasAmount, amount: hasAmount ? amount : 0, total, planned, registered, setsTotal };
}
