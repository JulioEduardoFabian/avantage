/**
 * En qué cajón cae cada envío que una plataforma nos devuelve, contestado en UN
 * solo sitio para las dos conciliaciones.
 *
 * Hasta ahora las dos reportaban `en_la_plataforma`, `en_crm`, `faltantes` y
 * `fallidos`, y con eso una diferencia nunca se terminaba de explicar: "faltan
 * 37" podía ser 37 leads perdidos, o 12 duplicados que la plataforma devuelve
 * dos veces, 9 personas que ya estaban en el CRM de antes, 6 formularios sin un
 * dato con el que llamar a nadie y 10 que llegaron fuera de su propio corte.
 * Cada uno de esos cinco se arregla distinto, y tres de ellos no se arreglan:
 * están bien así. Mezclados, la conciliación produce una alarma que nadie puede
 * cerrar — y una alarma que nadie puede cerrar se deja de mirar.
 *
 * Es puro y no toca la base: recibe un envío ya resuelto contra el CRM y
 * devuelve su cajón. Está acá y no copiado en cada servicio porque dos
 * criterios para lo mismo es como se llega a que la conciliación de Meta y la
 * de TikTok digan números que no se pueden comparar entre sí.
 *
 * Los cajones son **excluyentes y ordenados por prioridad**, y eso es una
 * propiedad y no un detalle: su suma tiene que ser el total de envíos del
 * corte, que es lo único que permite afirmar que la comparación cerró.
 */

export const BUCKETS = {
  /** Envío nuevo, de alguien que no estaba: es el que hay que importar. */
  nuevo: 'nuevos',
  /**
   * La plataforma devolvió este mismo envío (o este mismo teléfono) más de una
   * vez en el corte. No es un lead perdido ni un lead nuevo: es la misma
   * persona contada dos veces, y contarla como faltante infla la brecha.
   */
  duplicado: 'duplicados',
  /**
   * La persona ya estaba en el CRM de **antes** del corte y volvió a llenar un
   * formulario. No es un lead nuevo —el equipo ya la tiene y puede estar
   * trabajándola— y tampoco es un lead perdido. Es el caso que hace que el
   * total de la plataforma sea legítimamente mayor que el de altas del CRM.
   */
  reingreso: 'reingresos',
  /**
   * Sin teléfono y sin correo: no hay con qué llamar a nadie ni con qué cruzar
   * la ficha. Entra al CRM igual (un lead incompleto es justo el que
   * desaparecía del reporte) pero se cuenta aparte, porque un formulario que
   * no deja un dato de contacto es un problema del formulario y no de la
   * importación.
   */
  invalido: 'invalidos',
  /**
   * El envío es anterior al inicio del corte que se pidió: la plataforma lo
   * entregó tarde. Se cuenta aparte porque pertenece al día en que la persona
   * llenó el formulario y no al día en que lo recuperamos — mezclarlos es lo
   * que impide que el reporte cierre contra el Administrador de anuncios.
   */
  retrasado: 'retrasados'
};

/** Un contador con los cinco cajones en cero. */
export function emptyBuckets() {
  return Object.values(BUCKETS).reduce((acc, nombre) => ({ ...acc, [nombre]: 0 }), {});
}

/**
 * Los últimos 9 dígitos de un teléfono, o null.
 *
 * Se repite acá (y no se importa de `leadService`) a propósito: este módulo es
 * puro y no tiene que arrastrar la conexión a la base para clasificar un envío.
 * Es el mismo criterio que `phoneMatchKey`, y si alguno cambia hay un test que
 * los compara.
 */
export function phoneKeyOf(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-9) : null;
}

/**
 * El cajón de un envío.
 *
 * @param {object}  envio
 * @param {string}  envio.platformLeadId  el id del envío en la plataforma
 * @param {string}  envio.phone           el teléfono que contestó el formulario
 * @param {string}  envio.email           el correo, si vino
 * @param {Date}    envio.createdTime     cuándo se envió, según la plataforma
 * @param {object}  contexto
 * @param {Date}    contexto.windowStart  inicio del corte pedido (o null)
 * @param {Set}     contexto.seenLeadIds  ids de envío ya vistos en esta corrida
 * @param {Set}     contexto.seenPhoneKeys teléfonos ya vistos en esta corrida
 * @param {object}  contexto.existingLead la ficha que ya existe, si hay
 */
export function classifySubmission(envio, contexto = {}) {
  const { platformLeadId, phone, email, createdTime } = envio || {};
  const { windowStart = null, seenLeadIds = new Set(), seenPhoneKeys = new Set(), existingLead = null } = contexto;

  /*
   * El duplicado va PRIMERO. Un envío repetido puede además no tener teléfono y
   * ser anterior al corte, y si cualquiera de esas dos ganara, la misma persona
   * se contaría una vez como repetida y otra como inválida — y la suma dejaría
   * de ser el total.
   */
  const key = phoneKeyOf(phone);
  const id = platformLeadId ? String(platformLeadId) : null;
  if ((id && seenLeadIds.has(id)) || (key && seenPhoneKeys.has(key))) return BUCKETS.duplicado;

  // Sin un dato de contacto no se puede ni llamar ni cruzar: es un problema del
  // formulario, y mezclarlo con los perdidos manda a buscar leads que están.
  if (!key && !String(email || '').trim()) return BUCKETS.invalido;

  /*
   * Retrasado antes que reingreso: lo que define a un envío retrasado es
   * CUÁNDO se envió, y eso no depende de si la persona ya estaba en la base.
   * Al revés, un reingreso viejo se contaría como reingreso del corte actual y
   * la cuenta del corte no cerraría contra el Administrador de anuncios.
   */
  if (windowStart && createdTime && new Date(createdTime) < new Date(windowStart)) {
    return BUCKETS.retrasado;
  }

  /*
   * Reingreso es la persona que ya estaba ANTES del corte. Si su ficha se creó
   * dentro del corte, es este mismo envío (o su gemelo) el que la creó, y
   * contarlo como reingreso escondería el alta que sí ocurrió.
   */
  if (existingLead) {
    const nacida = existingLead.created_at ? new Date(existingLead.created_at) : null;
    const antes = !windowStart || !nacida || nacida < new Date(windowStart);
    if (antes) return BUCKETS.reingreso;
  }

  return BUCKETS.nuevo;
}

/**
 * Qué universo cuenta cada cifra del reporte.
 *
 * Va escrito en la respuesta y no en un comentario del código porque el error
 * que evita se comete leyendo la pantalla: el Ads Manager tiene un campo
 * «conversiones» que **no** cuenta envíos de formulario —cuenta el evento de
 * conversión configurado en la campaña, que puede ser un clic, un mensaje
 * iniciado o una compra— y exigir que el CRM dé ese mismo número manda a buscar
 * leads que nunca existieron. La conciliación compara lo comparable: los envíos
 * que la plataforma entrega para un formulario contra las fichas que el CRM
 * tiene de esos mismos envíos, emparejadas por el id del envío.
 */
export const COMPARABILIDAD = {
  en_la_plataforma: 'Envíos de formulario que la plataforma entrega para el corte pedido, por formulario.',
  en_crm: 'Envíos de esos mismos que el CRM ya tiene, emparejados por el id del envío (no por teléfono).',
  no_comparable: 'El campo «conversiones» del Administrador de anuncios NO cuenta envíos de formulario: '
    + 'cuenta el evento de conversión configurado en la campaña (un clic, un mensaje iniciado, una compra). '
    + 'Que no coincida con el CRM no es una pérdida de leads, y exigir que coincida manda a buscar leads '
    + 'que nunca existieron. Para comparar contra el Ads Manager hay que mirar su reporte de '
    + 'clientes potenciales del formulario, no la columna de conversiones de la campaña.'
};
