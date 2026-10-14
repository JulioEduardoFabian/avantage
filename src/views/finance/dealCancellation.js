/**
 * Un cierre que no llegó a concretarse: el cliente firmó, quedó pactado un
 * precio y un cronograma, y después se cayó.
 *
 * La marca vive en el lead (`leads.deal_cancelled_at`, se pone desde la fila
 * del cierre en Finanzas) y las cuotas NO se tocan: lo que ya se cobró entró
 * de verdad y tiene que seguir en los libros, y deshacerlo es borrar la marca.
 * Lo único que cambia es cuánto se espera cobrar.
 *
 * Esa resta vive acá y no copiada en cada pantalla porque la usan dos: la tira
 * de totales de la pestaña INGRESOS (para sacarlo de «Por cobrar») y la banda
 * de la propia fila (para decir cuánto se deja de esperar). Dos copias de la
 * misma resta es como se llega a que el recuadro diga un número y la fila otro.
 */

/** Lo pactado del cierre; sin precio total, lo que se alcanzó a registrar. */
export function agreedAmount(deal) {
  const total = deal?.total;
  return total != null ? Number(total) || 0 : Number(deal?.registered) || 0;
}

/**
 * Lo que este cierre ya no va a traer: lo pactado menos lo que sí entró
 * (verificado) o está a punto (cobrado, a la espera del visto bueno de
 * Finanzas). Nunca negativo: si se cobró de más, no hay nada que descartar.
 */
export function unexpectedAmount(deal) {
  const entrado = (Number(deal?.verificado) || 0) + (Number(deal?.porVerificar) || 0);
  return Math.max(0, Math.round((agreedAmount(deal) - entrado) * 100) / 100);
}
