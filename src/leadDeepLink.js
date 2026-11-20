/**
 * El enlace a la ficha de un lead en SU tablero, y la otra mitad: abrirla
 * cuando se entra por ahí.
 *
 * Las dos puntas viven en el mismo archivo a propósito. El Reporte de Leads
 * arma el enlace (`/admin/leads?lead=666`) y el tablero lo consume al cargar;
 * repartidas en las dos pantallas, el día que cambie el nombre del parámetro
 * el enlace sigue existiendo y simplemente deja de abrir nada — un fallo que
 * no rompe ninguna pantalla y que nadie reporta.
 *
 * A qué tablero va lo decide `lead.stage.board`, que el servidor ya resuelve
 * con `buildStageResolver()`: es la misma respuesta con la que el reporte
 * escribe "Funnel de Ventas" o "Setter Funnel" en la fila, así que el enlace
 * no puede mandar a un tablero distinto del que dice la pantalla.
 */

/** Cómo se llama cada tablero. Lo dicen la fila del reporte y el enlace. */
export const BOARD_LABEL = {
  ventas: 'Funnel de Ventas',
  setter: 'Setter Funnel'
};

/** La ruta de cada tablero y el permiso que el guard le exige. */
const BOARD_ROUTE = {
  ventas: { path: '/admin/leads', permission: 'leads.view' },
  setter: { path: '/admin/setter-funnel', permission: 'setter.view' }
};

/**
 * El tablero de un lead. Lo que no es Ventas es del setter, igual que en el
 * resto del panel: un status que no cae en ninguna columna conocida se ubica
 * en la primera del Setter Funnel, no en el limbo.
 */
export function leadBoard(lead) {
  return lead?.stage?.board === 'ventas' ? 'ventas' : 'setter';
}

/** El permiso que hace falta para que el enlace no termine en /dashboard. */
export function leadBoardPermission(lead) {
  return BOARD_ROUTE[leadBoard(lead)].permission;
}

/** El destino, tal como lo espera `<router-link :to>`. */
export function leadFunnelLink(lead) {
  return {
    path: BOARD_ROUTE[leadBoard(lead)].path,
    query: { lead: String(lead?.id ?? '') }
  };
}

/**
 * El id que pidió el enlace, y lo borra de la URL.
 *
 * Se borra porque el parámetro es una ORDEN de una vez ("abrí esta ficha") y
 * no un estado de la pantalla: dejándolo, cerrar la ficha y recargar la
 * volvería a abrir, y cualquier enlace que el usuario copie después arrastraría
 * un lead que ya no estaba mirando. El enlace sigue siendo compartible: quien
 * lo abre ve la ficha y recién ahí se limpia.
 */
export function consumeLeadParam(route, router) {
  const id = Number(route?.query?.lead);
  if (!Number.isInteger(id) || id <= 0) return null;

  const query = { ...route.query };
  delete query.lead;
  router.replace({ query });
  return id;
}
