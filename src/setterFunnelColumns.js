/*
 * Las columnas del Setter Funnel.
 *
 * Viven en `localStorage` y no en la base —a diferencia de las del Funnel de
 * Ventas, que son `funnel_columns`—, así que este archivo es el único sitio que
 * sabe su clave de almacenamiento y sus valores por defecto. Lo necesitan dos
 * pantallas: el Setter Funnel, que las dibuja y las edita, y el Funnel de
 * Ventas, que las usa para NOMBRAR las etapas de los leads del otro tablero en
 * la asignación masiva. Copiada la lista en la segunda, el día que alguien
 * renombra una etapa el reparto empieza a llamarla por un nombre que ya no
 * existe en ningún lado.
 */

const STORAGE_KEY = 'setter_funnel_columns_v2';

export const DEFAULT_SETTER_COLUMNS = [
  { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬', color: '#2C8C99', final: false, position: 0 },
  { key: 'calificando', label: 'En Calificación', icon: '🎯', color: '#6F8125', final: false, position: 1 },
  { key: 'congelado', label: 'Congelado', icon: '🧊', color: '#8D9199', final: false, position: 2 },
  { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅', color: '#C9922E', final: false, position: 3 },
  { key: 'transferido_closer', label: 'Transferido a Closer', icon: '🤝', color: '#56624A', final: false, position: 4 },
  { key: 'ganado', label: 'Ganado / Cerrado', icon: '🏆', color: '#2F7D5A', final: true, position: 5 },
  { key: 'descartado', label: 'No Califica / Sin Resp.', icon: '🚫', color: '#B23A45', final: false, position: 6 }
];

/**
 * Las columnas guardadas, o las de fábrica si no hay ninguna (o si el acceso a
 * `localStorage` lanza, que es lo que pasa en una ventana privada).
 *
 * Devuelve siempre una copia: quien la recibe las edita en su propio estado.
 */
export function loadSetterColumns() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn('Error al cargar columnas guardadas:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTER_COLUMNS));
}

export function saveSetterColumns(columns) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
  } catch (e) {
    console.warn('No se pudo guardar columnas en localStorage:', e);
  }
}
