import { apiFetch } from './apiClient.js';

/*
 * Las columnas del Setter Funnel.
 *
 * Viven en la base (`setter_funnel_columns`, vía `/api/setter-funnel-columns`),
 * como las del Funnel de Ventas. Antes vivían en el `localStorage` del
 * navegador y por eso el tablero era de la MÁQUINA y no del equipo: el
 * 16/10/2026 la misma persona veía siete etapas en una computadora y cuatro en
 * otra, con los mismos 17 leads repartidos distinto. Y no era solo visual —
 * arrastrar un lead escribe `leads.status` con la clave de la columna, que sí
 * se guarda en el servidor, así que un lead movido a una etapa que solo existe
 * en una máquina aparecía en la primera columna de todas las demás.
 *
 * Este archivo lo usan dos pantallas: el Setter Funnel, que las dibuja y las
 * edita, y el Funnel de Ventas, que las usa para NOMBRAR las etapas de los
 * leads del otro tablero en la asignación masiva. Copiada la lista en la
 * segunda, el día que alguien renombra una etapa el reparto empieza a llamarla
 * por un nombre que ya no existe en ningún lado.
 */

/**
 * Las etapas de fábrica. Ya no son "lo que se usa si no hay nada guardado"
 * —de eso se encarga el servidor, que las sembró en la migración— sino el
 * respaldo para dibujar algo si la petición falla: un tablero vacío por una
 * caída de red se lee como "se borraron las etapas".
 */
export const DEFAULT_SETTER_COLUMNS = [
  { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬', color: '#2C8C99', final: false, position: 0 },
  { key: 'calificando', label: 'En Calificación', icon: '🎯', color: '#6F8125', final: false, position: 1 },
  { key: 'congelado', label: 'Congelado', icon: '🧊', color: '#8D9199', final: false, position: 2 },
  { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅', color: '#C9922E', final: false, position: 3 },
  { key: 'transferido_closer', label: 'Transferido a Closer', icon: '🤝', color: '#56624A', final: false, position: 4 },
  { key: 'ganado', label: 'Ganado / Cerrado', icon: '🏆', color: '#2F7D5A', final: true, position: 5 },
  { key: 'descartado', label: 'No Califica / Sin Resp.', icon: '🚫', color: '#B23A45', final: false, position: 6 }
];

async function leerColumnas(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las etapas del Setter Funnel.');
  return Array.isArray(data.columns) ? data.columns : [];
}

/**
 * Las etapas del equipo. Si la petición falla devuelve las de fábrica y lo
 * avisa en la consola: es preferible un tablero con las etapas base que uno
 * vacío, pero quien lo mire tiene que poder enterarse de que está viendo un
 * respaldo (por eso `fetchSetterColumns` sí lanza, para las pantallas que
 * quieran decirlo en voz alta).
 */
export async function loadSetterColumns() {
  try {
    return await fetchSetterColumns();
  } catch (error) {
    console.warn('No se pudieron cargar las etapas del Setter Funnel:', error);
    return JSON.parse(JSON.stringify(DEFAULT_SETTER_COLUMNS));
  }
}

export async function fetchSetterColumns() {
  return leerColumnas(await apiFetch('/api/setter-funnel-columns'));
}

/** `atIndex` inserta la etapa entre dos existentes (el botón "+" del tablero). */
export async function createSetterColumn({ label, icon, color, final: isFinal, atIndex = null }) {
  const response = await apiFetch('/api/setter-funnel-columns', {
    method: 'POST',
    body: JSON.stringify({ label, icon, color, final: isFinal, atIndex })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo crear la etapa.');
  return data.column;
}

export async function updateSetterColumn(key, { label, icon, color, final: isFinal }) {
  const response = await apiFetch(`/api/setter-funnel-columns/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ label, icon, color, final: isFinal })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la etapa.');
  return data.column;
}

export async function deleteSetterColumn(key) {
  const response = await apiFetch(`/api/setter-funnel-columns/${encodeURIComponent(key)}`, { method: 'DELETE' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la etapa.');
  return true;
}

export async function reorderSetterColumns(keys) {
  return leerColumnas(await apiFetch('/api/setter-funnel-columns/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ keys })
  }));
}

export async function resetSetterColumns() {
  return leerColumnas(await apiFetch('/api/setter-funnel-columns/reset', { method: 'POST' }));
}
