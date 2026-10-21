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
import { computed, ref } from 'vue';
import { apiFetch } from '../apiClient.js';

export const commercialTeam = ref([]);

/**
 * ¿Esta persona es setter?
 *
 * Por el NOMBRE de su rol, y no por el permiso `setter.view`: los
 * administradores también lo tienen —tienen todos— y lo que hay que distinguir
 * acá no es quién puede entrar al Setter Funnel sino a quién se le reparte el
 * trabajo del setter. Se busca la palabra suelta, así que "Setter Junior" o
 * "Setter de turno noche" entran solos el día que el equipo los cree, igual que
 * con el criterio por permiso del área comercial.
 *
 * Vive acá, con la lista del equipo, porque es una pregunta sobre esa lista: en
 * cada pantalla que la copie, el día que el rol se llame distinto una va a
 * decir una cosa y otra, otra.
 */
export function isSetter(user) {
  const rol = String(user?.role_name || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  return rol.split(/[^a-z]+/).includes('setter');
}

/** Solo los setters, en el mismo orden que el equipo completo. */
export const setterTeam = computed(() => commercialTeam.value.filter(isSetter));

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
