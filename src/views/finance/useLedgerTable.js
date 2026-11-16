import { computed, reactive, ref, watch } from 'vue';
import { inDateRange } from './dateRange.js';

export const PAGE_SIZES = [25, 50, 100];

function compare(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

/**
 * Búsqueda, filtros, orden y paginación en cliente para las tablas del libro
 * contable. Los endpoints de Finanzas devuelven el histórico completo de una
 * sola vez, así que resolverlo aquí mantiene la tabla instantánea y permite
 * calcular los totales del subconjunto que se está mirando.
 *
 * @param rows       ref con las filas crudas del API.
 * @param searchText (fila) => texto sobre el que busca el campo de búsqueda.
 * @param sorters    { clave: (fila|grupo) => valor comparable } de columnas ordenables.
 * @param defaultSort { key, dir } orden inicial.
 * @param groupBy    opcional: (filas filtradas) => grupos. Cuando se pasa, lo
 *                   que se ordena y se pagina son los grupos (INGRESOS muestra
 *                   un registro por cierre, con sus cuotas dentro), mientras que
 *                   la búsqueda y los filtros se siguen aplicando fila a fila.
 * @param groupFilter opcional: (grupo) => si se lista. Va aparte de los filtros
 *                   de fila porque hay marcas que son del GRUPO y no de ninguna
 *                   de sus filas (un cierre dado por caído lo está entero), y
 *                   porque no cuenta como "la tabla está filtrada": de eso
 *                   depende que los cierres se abran solos, y esconder los
 *                   caídos no es buscar una cuota. `grouped` sigue devolviendo
 *                   todos los grupos, que es lo que permite seguir contando en
 *                   la tira de totales lo que no se está listando.
 * @param dateOf     (fila) => la fecha sobre la que corre el filtro "desde /
 *                   hasta". Por defecto `row.fecha`, que es la columna que las
 *                   tres tablas del libro muestran y ordenan.
 */
export function useLedgerTable(rows, {
  searchText, sorters, defaultSort, groupBy = null, groupFilter = null,
  dateOf = (row) => row.fecha
}) {
  const search = ref('');
  const estado = ref('');
  const banco = ref('');
  /* El rango de fechas, en días de calendario e inclusivo en los dos extremos
     (ver `dateRange.js`). Vacío = todo el histórico, que es como arranca cada
     pestaña: un recorte puesto de fábrica esconde filas sin que nadie lo pida. */
  const desde = ref('');
  const hasta = ref('');
  const sort = reactive({ key: defaultSort.key, dir: defaultSort.dir });
  const page = ref(1);
  const pageSize = ref(PAGE_SIZES[0]);

  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    return rows.value.filter((row) => {
      if (estado.value && row.estado !== estado.value) return false;
      if (banco.value && row.banco !== banco.value) return false;
      if (!inDateRange(dateOf(row), desde.value, hasta.value)) return false;
      return !term || searchText(row).toLowerCase().includes(term);
    });
  });

  const grouped = computed(() => (groupBy ? groupBy(filtered.value) : filtered.value));

  /** Lo que de verdad se lista: `grouped` menos lo que el grupo mismo esconde. */
  const visible = computed(() => (groupFilter ? grouped.value.filter(groupFilter) : grouped.value));

  const sorted = computed(() => {
    const get = sorters[sort.key];
    if (!get) return visible.value;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...visible.value].sort((a, b) => compare(get(a), get(b)) * factor);
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(sorted.value.length / pageSize.value)));

  const paged = computed(() => {
    const start = (page.value - 1) * pageSize.value;
    return sorted.value.slice(start, start + pageSize.value);
  });

  const range = computed(() => {
    const total = sorted.value.length;
    if (total === 0) return { from: 0, to: 0, total };
    const from = (page.value - 1) * pageSize.value + 1;
    return { from, to: Math.min(from + pageSize.value - 1, total), total };
  });

  const isFiltered = computed(() => Boolean(
    search.value.trim() || estado.value || banco.value || desde.value || hasta.value
  ));

  /** ¿Hay un recorte de fechas puesto? Es lo que decide si se muestra el aviso. */
  const hasDateRange = computed(() => Boolean(desde.value || hasta.value));

  // Cambiar lo que se está mirando devuelve a la primera página; si la página
  // actual se queda sin filas (al borrar o al filtrar), se retrocede.
  watch([search, estado, banco, desde, hasta, pageSize], () => { page.value = 1; });
  watch(totalPages, (count) => { if (page.value > count) page.value = count; });

  function toggleSort(key) {
    if (!sorters[key]) return;
    if (sort.key === key) {
      sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sort.key = key;
      sort.dir = 'desc';
    }
  }

  function sortCaret(key) {
    if (sort.key !== key) return '';
    return sort.dir === 'asc' ? '↑' : '↓';
  }

  function clearFilters() {
    search.value = '';
    estado.value = '';
    banco.value = '';
    clearDateRange();
  }

  function clearDateRange() {
    desde.value = '';
    hasta.value = '';
  }

  return {
    search, estado, banco, desde, hasta, sort, page, pageSize,
    filtered, grouped, visible, paged, totalPages, range, isFiltered, hasDateRange,
    toggleSort, sortCaret, clearFilters, clearDateRange
  };
}
