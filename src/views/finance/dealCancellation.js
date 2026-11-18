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

/**
 * Totales de la tira de INGRESOS sobre los cierres que se están mirando.
 *
 * Son DOS universos y no uno, porque la pantalla esconde los cierres caídos
 * salvo que se pidan:
 *
 *  - Las cifras del trato (precio total, registrado, verificado, por verificar,
 *    ITF) cuentan solo los cierres **visibles**. Antes contaban todos, así que
 *    «Precio total» decía una cifra que no se podía comprobar sumando lo que
 *    había en pantalla, y la diferencia era justo la plata de los cierres que
 *    ya nadie espera.
 *  - «No concretado» cuenta **siempre** los caídos, se vean o no: esconderlos
 *    es sacarlos de la lista de a quién cobrar, no olvidarse de que existieron.
 *    Un recuadro que desaparece al esconder las filas convierte el dato en algo
 *    que solo se encuentra sabiendo que hay que buscarlo.
 *
 * `porCobrar` se calcula cierre por cierre, y por eso vale lo mismo con los
 * caídos a la vista o escondidos: uno caído aporta cero —lo pactado, menos lo
 * que entró, menos lo que se descarta, que es esa misma resta—. Es lo que
 * permite esconderlos sin tocar la cifra que de verdad se mira.
 *
 * @param groups    cierres que pasaron la búsqueda y los filtros (todos).
 * @param isVisible (cierre) => si además se está listando en la tabla.
 */
export function summariseDeals(groups, isVisible = () => true) {
  const sums = {
    precioTotal: 0, registrado: 0, verificado: 0, porVerificar: 0,
    porCobrar: 0, itf: 0, descartado: 0
  };
  let cierresDescartados = 0;
  // Tratos con cronograma (casi siempre escrito por el contrato) cuyo lead
  // todavía no se ganó. Se cuentan siempre, como los caídos, para que el
  // interruptor que los muestra pueda decir cuántos hay aunque estén ocultos.
  let cierresSinGanar = 0;

  for (const group of groups || []) {
    if (group && group.closed === false) cierresSinGanar += 1;
    if (group?.cancelled) {
      cierresDescartados += 1;
      sums.descartado += unexpectedAmount(group);
    }
    if (!isVisible(group)) continue;

    const pactado = agreedAmount(group);
    const verificado = Number(group?.verificado) || 0;
    const porVerificar = Number(group?.porVerificar) || 0;

    sums.precioTotal += pactado;
    sums.registrado += Number(group?.registered) || 0;
    sums.verificado += verificado;
    sums.porVerificar += porVerificar;
    sums.itf += Number(group?.itf) || 0;
    sums.porCobrar += pactado - verificado - porVerificar
      - (group?.cancelled ? unexpectedAmount(group) : 0);
  }

  const totals = { cierresDescartados, cierresSinGanar };
  for (const [key, value] of Object.entries(sums)) {
    totals[key] = Math.round(value * 100) / 100;
  }
  return totals;
}
