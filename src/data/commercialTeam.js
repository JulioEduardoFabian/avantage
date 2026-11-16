/**
 * Los usuarios del área comercial (los que tienen `leads.view` o `setter.view`).
 *
 * Para OFRECER un lead se usa `assignableTeam`, que es esta lista menos quien
 * está en ella por tener todos los permisos; `commercialTeam` crudo queda para
 * lo que de verdad es el área entera, como el filtro "Responsable" del tablero
 * —ahí tiene que aparecer también quien ya tiene leads a su nombre—.
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
import { computed, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { worksLeads } from './leadRoles.js';

export const commercialTeam = ref([]);

/**
 * A quién se le puede asignar un lead: el área comercial, menos quien está ahí
 * por tener todos los permisos.
 *
 * Si NINGÚN rol del panel se llama de forma comercial, se ofrece el área
 * completa en vez de un desplegable vacío: con la lista vacía no habría forma
 * de asignar un lead, que es peor que ofrecer de más. La pantalla lo dice
 * (`assignableIsFallback`) en lugar de disimularlo — un filtro que se apaga
 * solo y en silencio es un filtro que nadie entiende.
 */
export const assignableTeam = computed(() => {
  const propios = commercialTeam.value.filter(worksLeads);
  return propios.length > 0 ? propios : commercialTeam.value;
});

/** ¿Se está ofreciendo el área completa porque ningún rol coincidió? */
export const assignableIsFallback = computed(
  () => commercialTeam.value.length > 0 && !commercialTeam.value.some(worksLeads)
);

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
