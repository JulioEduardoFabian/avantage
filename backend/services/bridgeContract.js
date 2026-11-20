/**
 * El sobre con el que cualquier puente de datos de este CRM se describe a sí
 * mismo.
 *
 * Un "puente" acá es todo lo que entrega un conjunto de filas a algo que las va
 * a comparar contra otra fuente: la conciliación de Meta, la importación de
 * TikTok, la lista de pendientes de atribución, el exportable de Campañas. Y
 * todos tenían el mismo agujero: **recortaban en silencio**.
 *
 * Los tres casos reales de este repositorio, que son el motivo de que esto
 * exista:
 *
 *  - `forms.slice(0, MAX_FORMS)` en la importación de TikTok cortaba a 100
 *    formularios y no lo decía en ninguna parte del reporte.
 *  - `listForms()` de Meta corta a `MAX_PAGES` páginas de la Graph API; si
 *    quedaba un `paging.next`, los formularios que seguían simplemente no
 *    existían para la comparación.
 *  - `#getPaged()` de TikTok se detiene en la página 20 aunque `total_page`
 *    diga 35.
 *
 * El daño es el mismo en los tres y es peor que un error: la comparación
 * devuelve un resultado que parece completo. "Están todos" y "están todos los
 * que miré" se escriben igual en la pantalla, y de esa diferencia cuelga ir a
 * buscar leads perdidos o darlos por recuperados.
 *
 * Es puro: recibe números y devuelve el sobre. Un consumidor automático tiene
 * que poder contestar, sin leer este código, tres preguntas: **cuántas filas
 * hay en total**, **cuáles me diste** y **me falta algo**.
 */

/**
 * Nombre y versión de cada puente.
 *
 * La versión va en la respuesta y se sube a mano cuando cambia el significado
 * de un campo —no cuando se agrega uno—: quien guarda un archivo de hace tres
 * meses tiene que poder saber si lo puede comparar con el de hoy. Un campo
 * nuevo no rompe a nadie; uno que empieza a contar otra cosa, sí.
 */
export const BRIDGE_SCHEMAS = {
  tiktokLeads: { nombre: 'tiktok-leads', version: 2 },
  metaReconciliation: { nombre: 'meta-reconciliation', version: 2 },
  attributionConflicts: { nombre: 'attribution-conflicts', version: 1 }
};

/**
 * El sobre de una respuesta paginada o recortada.
 *
 * `total_filas` es lo que hay del otro lado y `filas` lo que vino en esta
 * respuesta; cuando no coinciden, `recortado` es true y `avisos` dice por qué.
 * Los tres juntos y no uno: un `total` sin `recortado` obliga al consumidor a
 * restar para enterarse, y el que no resta se lleva la mitad de los datos
 * creyendo que son todos.
 *
 * `limites` se publica siempre, incluso cuando nada se recortó: es lo que
 * permite saber de antemano si el pedido va a entrar — y cuál subir si no
 * entra. Un límite que solo se descubre al chocarlo es un límite indocumentado.
 */
export function bridgeEnvelope({ esquema, totalFilas = null, filas = 0, offset = 0, limites = {}, avisos = [] }) {
  const total = totalFilas === null ? null : Number(totalFilas);
  const recortado = total !== null && offset + filas < total;

  return {
    esquema: { ...esquema },
    total_filas: total,
    filas,
    offset,
    limites,
    recortado,
    /*
     * El aviso de recorte se agrega acá y no en cada llamador: puesto en el
     * llamador, el siguiente puente que alguien agregue se olvida de ponerlo —
     * y un recorte sin aviso es exactamente el fallo que esto cierra.
     */
    avisos: recortado
      ? [...avisos, `Se entregaron ${filas} de ${total} filas (desde ${offset}). `
        + 'La comparación NO cubre el resto: pedí las páginas que siguen antes de concluir que falta algo.']
      : avisos
  };
}

/**
 * El aviso de que una paginación se cortó por el tope de páginas.
 *
 * Devuelve `null` cuando no se cortó, para poder empujarlo a un arreglo de
 * avisos sin preguntar. El texto nombra el tope **y** cuántas páginas había,
 * porque sin el segundo número no se sabe si falta una página o treinta.
 */
export function pageCapNotice({ que, paginasLeidas, paginasTotales, tope }) {
  if (!paginasTotales || paginasTotales <= paginasLeidas) return null;

  return `${que}: se leyeron ${paginasLeidas} de ${paginasTotales} páginas (tope ${tope}). `
    + 'Lo que está más allá del tope no entró en la comparación, así que una diferencia '
    + 'puede ser de acá y no de la plataforma. Subí el tope o acotá el rango de fechas.';
}

/**
 * El aviso de que una lista se recortó por un tope de elementos.
 *
 * El mismo caso que `pageCapNotice` pero para un `slice`: la importación de
 * TikTok recorre como máximo `MAX_FORMS` formularios, y en una cuenta con más
 * los que sobran no se comparan contra nada.
 */
export function listCapNotice({ que, revisados, totales, tope }) {
  if (!totales || totales <= revisados) return null;

  return `${que}: se revisaron ${revisados} de ${totales} (tope ${tope}). `
    + 'Los que quedaron fuera no se compararon contra la plataforma: sus leads no figuran '
    + 'ni como presentes ni como faltantes.';
}

/**
 * El acceso **mínimo** que hace falta para cada cosa, y qué deja de funcionar
 * sin él.
 *
 * Va escrito y en un solo sitio porque el reflejo ante un 403 de una API de
 * anuncios es pedir todos los permisos y volver a autorizar la app, y eso es
 * exactamente lo que no hay que hacer: amplía el alcance del token a ciegas,
 * y un token con más permisos de los que usa es un token que, filtrado, hace
 * más daño. Cada entrada nombra UN permiso y UNA consecuencia, así que ante un
 * fallo se agrega el que corresponde y nada más.
 *
 * El caso que lo motiva: la ruta de Smart+ de TikTok no está habilitada en esta
 * cuenta. Lo que falta está nombrado acá, y mientras no esté el CRM reporta la
 * pieza creativa como desconocida en vez de inferirla — ver `smartPlus` en
 * `tiktokAdsService.js`.
 */
export const MINIMUM_ACCESS = {
  'tiktok:lead_generation': {
    para: 'Traer los envíos de los formularios instantáneos de TikTok.',
    sin_el: 'Las campañas se sincronizan perfecto y no entra un solo lead, sin que nada falle a la vista.',
    como: 'Scope de Lead Generation en la app de TikTok Business; hay que reautorizar para emitir un token nuevo.'
  },
  'tiktok:ads_management': {
    para: 'Campañas, grupos, anuncios y sus métricas de gasto.',
    sin_el: 'No hay gasto con el que calcular costo por lead ni ROAS.',
    como: 'Ya concedido.'
  },
  'tiktok:smart_plus_creative': {
    para: 'Saber qué pieza creativa de una campaña Smart+ trajo cada lead.',
    sin_el: 'El gasto se reporta al anuncio padre y la pieza queda como desconocida — que es lo correcto '
      + 'mientras el dato no se pueda leer. NO se infiere por descarte.',
    como: 'Pendiente de confirmar con TikTok qué endpoint expone el nivel hijo de Smart+ en esta cuenta. '
      + 'Hasta entonces no se amplía ningún otro scope: el padre alcanza para repartir el presupuesto.'
  },
  'meta:pages_manage_metadata': {
    para: 'Leer si la app está suscrita al campo `leadgen` de la Página.',
    sin_el: 'No se puede comprobar que Meta esté avisando de los leads nuevos; recuperar los perdidos '
      + 'sigue funcionando igual.',
    como: 'Permiso de Página; el fallo viaja como dato y no tumba la conciliación.'
  },
  'meta:pages_manage_ads': {
    para: 'Listar todos los formularios de la Página.',
    sin_el: 'Se comparan solo los formularios que ya tienen algún lead en el CRM; uno que nunca entregó '
      + 'ninguno queda fuera de la comparación.',
    como: 'Permiso de Página sobre un token de PÁGINA (uno de usuario de sistema pasa el debug_token y '
      + 'falla toda llamada de alcance de página).'
  }
};
