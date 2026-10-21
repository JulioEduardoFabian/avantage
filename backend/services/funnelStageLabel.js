import { db } from '../db/connection.js';
import { leadHasGraduated, loadSalesFunnelStatuses } from './salesFunnelStage.js';

/**
 * En qué etapa del funnel está un lead, dicho con el nombre que el equipo le
 * puso a esa columna.
 *
 * Los dos tableros leen la misma `leads.status`, pero sus etiquetas viven en
 * tablas distintas (`funnel_columns` y `setter_funnel_columns`), así que
 * traducir un status a algo legible necesita las dos y además saber a cuál de
 * los dos tableros pertenece el lead. Eso último NO se deduce del texto del
 * status —`leadHasGraduated()` mira primero el sello `sales_funnel_at`, que es
 * lo que sobrevive a que la columna se borre o se recree— y por eso esta
 * traducción vive acá y no copiada en cada pantalla que quiera mostrarla.
 *
 * Se usa en la bandeja de WhatsApp, que es donde más falta hacía: quien
 * contesta un mensaje no tenía forma de saber si del otro lado hay un contacto
 * recién llegado o un cliente al que ya se le cotizó.
 */

/**
 * Estados que no son columna de ningún tablero pero que igual aparecen en
 * `leads.status`: el que pone `createLead()` por defecto y los desenlaces
 * fijos que el equipo puede tener configurados con otra etiqueta (o no tener).
 * Sin esto, un lead "en_negociacion" en un tablero sin esa columna no tendría
 * nada que mostrar, que es justo el caso en el que saberlo más importa.
 */
const ESTADOS_FIJOS = {
  nuevo: 'Nuevo',
  inbox: 'Conversación abierta',
  abierto: 'Conversación abierta',
  contactado: 'Contactado',
  cita_agendada: 'Cita agendada',
  en_negociacion: 'En negociación',
  ganado: 'Ganado',
  perdido: 'Perdido'
};

/** `transferido_closer` → "Transferido closer", para lo que no tiene etiqueta. */
function humanizar(status) {
  const texto = String(status || '').replace(/[_-]+/g, ' ').trim();
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Trae de la base lo que hace falta para traducir muchos leads de una vez: las
 * columnas de los dos tableros y el conjunto de estados que significan "ya es
 * comercial". Son tres consultas a tablas chicas, y se hacen UNA por listado —
 * no una por lead.
 */
export async function loadFunnelStageIndex() {
  const [salesColumns, setterColumns, salesStatuses] = await Promise.all([
    db('funnel_columns').select('key', 'label', 'icon', 'color'),
    db('setter_funnel_columns').select('key', 'label', 'icon', 'color'),
    loadSalesFunnelStatuses()
  ]);
  return { salesColumns, setterColumns, salesStatuses };
}

/**
 * Devuelve `labelStatus(status, board)`: el nombre legible de UNA clave de
 * status, prefiriendo la etiqueta del tablero que se le indique.
 *
 * Es la mitad de `buildStageResolver()` que no necesita un lead, y existe
 * porque el Reporte de Leads tiene que nombrar también el status de DONDE
 * SALIÓ el lead (`lead_stage_changes.from_status`): ese ya no es el de la
 * ficha, así que no se puede resolver preguntándole al lead a qué tablero
 * pertenece. Vive acá y no en la pantalla del reporte para que una columna
 * renombrada se lea igual en el tablero, en la bandeja de WhatsApp y en el
 * reporte.
 */
export function buildStatusLabeler({ salesColumns = [], setterColumns = [] } = {}) {
  const porTablero = {
    ventas: new Map(salesColumns.map((column) => [column.key, column])),
    setter: new Map(setterColumns.map((column) => [column.key, column]))
  };

  return function labelStatus(status, board = 'setter') {
    if (!status) return null;
    const preferido = porTablero[board] ? board : 'setter';
    const otro = preferido === 'ventas' ? 'setter' : 'ventas';
    const column = porTablero[preferido].get(status) || porTablero[otro].get(status) || null;

    return {
      status,
      label: column?.label || ESTADOS_FIJOS[status] || humanizar(status),
      icon: column?.icon || null,
      color: column?.color || null
    };
  };
}

/**
 * Devuelve `stageOf(lead)`: `{ status, label, board, icon, color }` o `null`
 * si no hay lead o no tiene status.
 *
 * El tablero manda sobre la etiqueta: primero se busca la columna en el
 * tablero al que el lead pertenece, y solo si ahí no está se mira el otro.
 * Buscar en los dos a la vez haría que `cita_agendada` —que existe como
 * columna en los dos— se mostrara con la etiqueta del tablero equivocado.
 */
export function buildStageResolver({ salesColumns = [], setterColumns = [], salesStatuses = new Set() } = {}) {
  const labelStatus = buildStatusLabeler({ salesColumns, setterColumns });

  return function stageOf(lead) {
    const status = lead?.status;
    if (!status) return null;

    const board = leadHasGraduated(lead, salesStatuses) ? 'ventas' : 'setter';
    return { ...labelStatus(status, board), board };
  };
}

/**
 * Las etapas que puede ofrecer un filtro: las columnas de los dos tableros más
 * los desenlaces fijos que pueden estar en `leads.status` sin ser columna de
 * nadie.
 *
 * Se agrupan por clave y no por tablero porque el filtro compara contra
 * `leads.status`, que es UNA columna compartida: `cita_agendada` existe en los
 * dos tableros y filtrar por ella trae los leads de los dos, así que ofrecerla
 * dos veces prometería una distinción que la consulta no hace.
 */
export function stageOptions({ salesColumns = [], setterColumns = [] } = {}) {
  const options = [];
  const vistas = new Set();
  const agregar = (key, label, board) => {
    if (!key || vistas.has(key)) return;
    vistas.add(key);
    options.push({ key, label, board });
  };

  for (const column of setterColumns) agregar(column.key, `${column.icon || ''} ${column.label}`.trim(), 'setter');
  for (const column of salesColumns) agregar(column.key, `${column.icon || ''} ${column.label}`.trim(), 'ventas');
  for (const [key, label] of Object.entries(ESTADOS_FIJOS)) agregar(key, label, null);

  return options;
}
