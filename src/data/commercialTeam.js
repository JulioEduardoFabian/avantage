/**
 * Los usuarios del área comercial (los que tienen el permiso `leads.view`), que
 * son a quienes se les puede asignar un lead.
 *
 * Se pide UNA vez por carga de la app y se deja en un `ref` compartido: la
 * lista la usa el botón de asignación de cada tarjeta, y con diez tarjetas por
 * columna en dos tableros serían decenas de llamadas idénticas al mismo
 * endpoint. Acá no hay respaldo cableado como en el catálogo de carreras: los
 * usuarios del panel no se pueden adivinar, y un desplegable vacío con su
 * mensaje ("nadie más tiene acceso al funnel") dice la verdad.
 *
 * Se carga al primer clic en un botón de asignar, no al arrancar: quien solo
 * mira el tablero no la pide nunca.
 */
import { ref } from 'vue';
import { apiFetch } from '../apiClient.js';

export const commercialTeam = ref([]);

let pendingLoad = null;

export function loadCommercialTeam({ force = false } = {}) {
  if (force) pendingLoad = null;
  pendingLoad ??= apiFetch('/api/leads/assignable-users')
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo obtener el área comercial.');
      commercialTeam.value = data.users || [];
    })
    .catch((error) => {
      // Un fallo no se cachea: el siguiente clic lo reintenta en vez de dejar
      // el desplegable vacío para siempre.
      pendingLoad = null;
      throw error;
    });
  return pendingLoad;
}
