<template>
  <main class="container-fluid documents-page">
    <header class="page-header">
      <div class="page-header-titles">
        <span class="page-eyebrow">Documentos emitidos</span>
        <h2 class="section-heading"><span class="heading-icon">📑</span> Documentos</h2>
        <p class="section-subheading">
          Todas las <strong>cotizaciones</strong> y <strong>contratos</strong> generados, de lo más reciente a lo más
          antiguo. Busca por el nombre del cliente para ver qué se le mandó y cuándo.
        </p>
      </div>
      <div class="documents-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            v-model="search"
            type="search"
            class="search-input"
            placeholder="Buscar por nombre del lead, código o n.º"
          />
        </div>
        <div class="kind-tabs">
          <button
            v-for="opt in kindFilters"
            :key="opt.value"
            type="button"
            class="kind-tab"
            :class="{ active: kindFilter === opt.value }"
            @click="kindFilter = opt.value"
          >{{ opt.label }}</button>
        </div>
        <button type="button" class="btn-secondary" :disabled="loading" @click="load">
          {{ loading ? '↻ Cargando…' : '↻ Actualizar' }}
        </button>
      </div>
    </header>

    <p v-if="errorMsg" class="state-banner state-error">⚠️ {{ errorMsg }}</p>
    <p v-else-if="!includesContracts && !loading" class="state-banner state-hint">
      🔒 Solo ves las cotizaciones: los contratos necesitan el permiso <code>contracts.manage</code>.
    </p>

    <div class="kpi-row" v-if="!loading || documents.length">
      <div class="kpi-tile">
        <span class="kpi-label">Documentos</span>
        <span class="kpi-value">{{ filtered.length }}</span>
        <span class="kpi-sub" v-if="filtered.length !== documents.length">de {{ documents.length }} en total</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-label">Cotizaciones</span>
        <span class="kpi-value">{{ countOf('cotizacion') }}</span>
      </div>
      <div class="kpi-tile" v-if="includesContracts">
        <span class="kpi-label">Contratos</span>
        <span class="kpi-value">{{ countOf('contrato') }}</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-label">Último emitido</span>
        <span class="kpi-value kpi-value-sm">{{ documents.length ? formatDate(documents[0].createdAt) : '—' }}</span>
      </div>
    </div>

    <AppLoader
      v-if="loading && !documents.length"
      variant="table"
      icon="📑"
      title="Cargando documentos emitidos…"
      subtitle="Sincronizando historial de cotizaciones y contratos."
    />

    <div v-else-if="!filtered.length" class="empty-state">
      <span class="empty-icon">{{ search ? '🔍' : '📭' }}</span>
      <p class="empty-text">
        {{ search ? `Sin documentos para "${search}"` : 'Todavía no se ha emitido ningún documento.' }}
      </p>
      <button v-if="search" type="button" class="btn-secondary" @click="search = ''">Limpiar búsqueda</button>
    </div>

    <div v-else class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Cliente</th>
            <th>Documento</th>
            <th>Monto</th>
            <th>Estado</th>
            <th>Emitido</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in paged" :key="`${doc.kind}-${doc.id}`">
            <td>
              <span class="kind-pill" :class="doc.kind === 'contrato' ? 'kind-contract' : 'kind-quote'">
                {{ doc.kind === 'contrato' ? '📄 Contrato' : '💰 Cotización' }}
              </span>
            </td>
            <td>
              <router-link
                v-if="doc.leadId"
                :to="{ path: '/admin/leads', query: { leadId: doc.leadId } }"
                class="lead-link"
                :title="'Ver el lead #' + doc.leadId"
              >{{ doc.leadName || 'Sin nombre' }}</router-link>
              <span v-else class="lead-link is-plain">{{ doc.leadName || 'Sin cliente asociado' }}</span>
            </td>
            <td>
              <span class="doc-title" :title="doc.title">{{ doc.title }}</span>
              <span v-if="doc.extra?.code" class="doc-code">{{ doc.extra.code }}</span>
              <span v-else class="doc-code">#{{ doc.id }}</span>
            </td>
            <td class="data-mono">{{ doc.amount != null ? money(doc.amount, doc.currency) : '—' }}</td>
            <td>
              <span class="pill" :class="statusClass(doc.status)">{{ doc.statusLabel || statusLabel(doc.status) }}</span>
            </td>
            <td class="data-mono">{{ formatDateTime(doc.createdAt) }}</td>
            <td class="col-actions">
              <button
                type="button"
                class="icon-btn"
                :disabled="opening === docKey(doc)"
                :title="`Abrir ${doc.kind === 'contrato' ? 'el contrato' : 'la cotización'}`"
                @click="openDocument(doc)"
              >{{ opening === docKey(doc) ? '⏳' : '👁️' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="totalPages > 1" class="pagination-bar">
      <button type="button" class="page-btn" :disabled="page <= 1" @click="page = 1">⏮</button>
      <button type="button" class="page-btn" :disabled="page <= 1" @click="page--">◀</button>
      <span class="page-info">Página {{ page }} de {{ totalPages }}</span>
      <button type="button" class="page-btn" :disabled="page >= totalPages" @click="page++">▶</button>
      <button type="button" class="page-btn" :disabled="page >= totalPages" @click="page = totalPages">⏭</button>
    </div>
  </main>
</template>

<script setup>
/**
 * Módulo de Documentos: cotizaciones y contratos en una sola lista.
 *
 * Antes, las cotizaciones solo se veían dentro de la ficha de su lead y los
 * contratos en su propia pantalla: para saber qué se le mandó a un cliente
 * había que abrir dos sitios y saber de antemano a qué lead pertenecía.
 *
 * El backend ya devuelve la lista mezclada y ordenada por fecha
 * (`documentService.js`); aquí solo se filtra y se pagina en memoria, que es
 * barato para el volumen de documentos que maneja el equipo y hace que
 * escribir en el buscador responda al instante.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';
import AppLoader from '../components/AppLoader.vue';

const PAGE_SIZE = 20;

const documents = ref([]);
const includesContracts = ref(true);
const loading = ref(false);
const errorMsg = ref('');
const search = ref('');
const kindFilter = ref('all');
const page = ref(1);
const opening = ref(null);

const kindFilters = computed(() => [
  { value: 'all', label: 'Todos' },
  { value: 'cotizacion', label: 'Cotizaciones' },
  ...(includesContracts.value ? [{ value: 'contrato', label: 'Contratos' }] : [])
]);

async function load() {
  loading.value = true;
  errorMsg.value = '';
  try {
    const res = await apiFetch('/api/documents');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los documentos.');
    documents.value = data.documents || [];
    includesContracts.value = (data.kinds || []).includes('contrato');
    if (!includesContracts.value && kindFilter.value === 'contrato') kindFilter.value = 'all';
  } catch (err) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

/** Sin tildes ni mayúsculas, igual que busca el backend. */
function searchable(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const filtered = computed(() => {
  const term = searchable(search.value).trim();
  return documents.value.filter((doc) => {
    if (kindFilter.value !== 'all' && doc.kind !== kindFilter.value) return false;
    if (!term) return true;
    return searchable(doc.leadName).includes(term)
      || searchable(doc.extra?.code).includes(term)
      || searchable(doc.title).includes(term)
      || String(doc.id) === term;
  });
});

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

// Al filtrar, la página en la que estaba puede ya no existir.
watch([search, kindFilter], () => { page.value = 1; });

function countOf(kind) {
  return documents.value.filter((d) => d.kind === kind).length;
}

function docKey(doc) {
  return `${doc.kind}-${doc.id}`;
}

/**
 * Los documentos se sirven como HTML detrás del token Bearer, así que no vale
 * un `<a href>` directo: hay que pedirlos con `apiFetch` y abrirlos desde un
 * blob (mismo camino que la cotización en el funnel de ventas).
 */
async function openDocument(doc) {
  opening.value = docKey(doc);
  try {
    const res = await apiFetch(doc.documentUrl);
    if (!res.ok) throw new Error('No se pudo obtener el documento.');
    const html = await res.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) {
      // El navegador bloqueó la ventana emergente: se descarga el archivo.
      const link = document.createElement('a');
      link.href = url;
      link.download = `${doc.kind}-${doc.id}.html`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    errorMsg.value = `No se pudo abrir el documento: ${err.message}`;
  } finally {
    opening.value = null;
  }
}

const STATUS_LABELS = {
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  borrador: 'Borrador',
  firmado: 'Firmado',
  anulado: 'Anulado'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

function statusClass(status) {
  if (['aceptada', 'firmado'].includes(status)) return 'pill-success';
  if (['rechazada', 'anulado'].includes(status)) return 'pill-danger';
  if (status === 'borrador') return 'pill-neutral';
  return 'pill-warning';
}

function money(amount, currency) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: currency || 'PEN' }).format(amount);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

onMounted(load);
</script>

<style scoped>
.documents-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.documents-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  padding: 0.3rem 0.6rem;
}

.search-icon { font-size: 0.8rem; opacity: 0.65; }

.search-input {
  border: none;
  background: transparent;
  color: var(--text-main);
  font-size: 0.83rem;
  min-width: 240px;
  outline: none;
}

.kind-tabs {
  display: flex;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 9px;
  padding: 2px;
  gap: 2px;
}

.kind-tab {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.7rem;
  border-radius: 7px;
  cursor: pointer;
}

.kind-tab.active {
  background: var(--surface-4);
  color: var(--text-main);
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
}

.kpi-tile {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.kpi-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.kpi-value { font-size: 1.35rem; font-weight: 700; color: var(--text-main); }
.kpi-value-sm { font-size: 0.95rem; }
.kpi-sub { font-size: 0.72rem; color: var(--text-muted); }

.table-wrapper {
  /* La tabla scrollea dentro de su caja: la página nunca se desplaza en
     horizontal aunque el nombre del documento sea largo. */
  overflow-x: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}

.kind-pill {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  white-space: nowrap;
}

.kind-quote {
  color: var(--accent-amber);
  background: rgba(201, 146, 46, 0.14);
  border: 1px solid rgba(201, 146, 46, 0.3);
}

.kind-contract {
  color: var(--accent-cyan);
  background: rgba(44, 140, 153, 0.14);
  border: 1px solid rgba(44, 140, 153, 0.3);
}

.lead-link {
  color: var(--text-main);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px dashed var(--border-color);
}

.lead-link:hover { border-bottom-style: solid; }
.lead-link.is-plain { border-bottom: none; color: var(--text-muted); font-weight: 500; }

.doc-title {
  display: block;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-code {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-muted);
}

.col-actions { text-align: right; white-space: nowrap; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 3rem 1rem;
  background: var(--bg-card);
  border: 1px dashed var(--border-color);
  border-radius: 12px;
}

.empty-icon { font-size: 2rem; opacity: 0.6; }
.empty-text { margin: 0; color: var(--text-muted); font-size: 0.88rem; }

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
}

.page-btn {
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  border-radius: 7px;
  padding: 0.25rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
}

.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-info { font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono); }
</style>
