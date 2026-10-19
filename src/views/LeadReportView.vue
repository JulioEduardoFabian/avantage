<template>
  <main class="container-fluid lead-report-page">
    <header class="report-header">
      <div>
        <h2 class="section-heading">
          <span class="heading-icon">🧾</span> Reporte de Leads
        </h2>
        <p class="section-subheading">
          Todos los leads con su trazabilidad: quién movió a cada uno, hacia qué etapa y en qué
          fecha y hora. Los filtros eligen <strong>qué leads</strong> aparecen; de cada uno se
          muestra su historia completa.
        </p>
      </div>
      <button class="btn-action-secondary" :disabled="isLoading" @click="load">
        <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
        {{ isLoading ? 'Cargando…' : 'Actualizar' }}
      </button>
    </header>

    <section class="report-stats">
      <div class="report-stat">
        <span class="report-stat-label">Leads</span>
        <span class="report-stat-value">{{ summary.leads }}</span>
        <span class="report-stat-note">con los filtros aplicados</span>
      </div>
      <div class="report-stat is-moves">
        <span class="report-stat-label">Movimientos</span>
        <span class="report-stat-value">{{ summary.moves }}</span>
        <span class="report-stat-note">cambios de etapa registrados</span>
      </div>
      <div class="report-stat is-blocked">
        <span class="report-stat-label">Intentos bloqueados</span>
        <span class="report-stat-value">{{ summary.blocked }}</span>
        <span class="report-stat-note">movimientos que el sistema rechazó</span>
      </div>
      <div class="report-stat is-quiet">
        <span class="report-stat-label">Sin movimientos</span>
        <span class="report-stat-value">{{ summary.unmoved }}</span>
        <span class="report-stat-note">quietos desde que existe la bitácora</span>
      </div>
    </section>

    <div class="report-toolbar">
      <label class="report-search">
        <span aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          placeholder="Buscar por nombre, celular, correo, DNI, universidad o #id"
          aria-label="Buscar leads"
        />
      </label>

      <select v-model="actor" class="form-select report-filter" aria-label="Filtrar por quién movió el lead">
        <option value="">Movido por: cualquiera</option>
        <option v-for="option in actorOptions" :key="option.key" :value="option.key">
          {{ option.label }} ({{ option.moves }})
        </option>
      </select>

      <select v-model="status" class="form-select report-filter" aria-label="Filtrar por etapa actual">
        <option value="">Etapa actual: todas</option>
        <option v-for="option in stageFilterOptions" :key="option.key" :value="option.key">
          {{ option.label }}
        </option>
      </select>

      <label class="report-dates">
        <span>Movido entre</span>
        <input v-model="from" type="date" aria-label="Movimientos desde" />
        <span>y</span>
        <input v-model="to" type="date" aria-label="Movimientos hasta" />
      </label>

      <label class="report-check">
        <input v-model="onlyBlocked" type="checkbox" />
        <span>Solo con intentos bloqueados</span>
      </label>

      <button v-if="hasFilters" type="button" class="btn-action-ghost report-clear" @click="clearFilters">
        Limpiar filtros
      </button>
    </div>

    <p v-if="scopeNote" class="info-box report-scope">ℹ️ {{ scopeNote }}</p>
    <p v-if="errorMessage" class="info-box report-alert">⚠️ {{ errorMessage }}</p>

    <div v-if="!isLoading && leads.length === 0" class="empty-state">
      <p class="empty-state-title">No hay leads que mostrar</p>
      <p class="empty-state-text">
        {{ hasFilters
          ? 'Ningún lead coincide con estos filtros. Prueba a limpiarlos.'
          : 'Aquí aparecen los leads con sus cambios de etapa en cuanto haya alguno.' }}
      </p>
    </div>

    <template v-else>
      <div class="report-listhead">
        <span>{{ total }} lead(s) · página {{ page }} de {{ pages }}</span>
        <button type="button" class="btn-action-ghost report-expand-all" @click="toggleAll">
          {{ allExpanded ? 'Contraer todo' : 'Expandir todo' }}
        </button>
      </div>

      <div class="data-table-wrapper report-table-wrapper">
        <table class="data-table report-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Etapa actual</th>
              <th>Equipo</th>
              <th>Último movimiento</th>
              <th class="report-num">Movs.</th>
              <th class="report-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="lead in leads" :key="lead.id">
              <tr :class="{ 'is-open-row': isOpen(lead.id) }">
                <td data-label="Lead">
                  <span class="report-client">{{ lead.full_name || 'Sin nombre' }}</span>
                  <span class="report-sub">#{{ lead.id }}{{ lead.phone ? ` · ${lead.phone}` : '' }}</span>
                  <span class="report-sub">Registrado el {{ formatLeadDate(lead.created_at) }}</span>
                </td>
                <td data-label="Etapa actual">
                  <span class="pill" :class="boardPill(lead)">
                    {{ stageText(lead.stage) }}
                  </span>
                  <span class="report-sub">{{ boardName(lead) }}</span>
                </td>
                <td data-label="Equipo">
                  <span class="report-sub">Responsable: {{ lead.assigned_user_name || 'sin asignar' }}</span>
                  <span v-if="lead.setter_name" class="report-sub">Setter: {{ lead.setter_name }}</span>
                  <span v-if="lead.closer_name" class="report-sub">Closer: {{ lead.closer_name }}</span>
                </td>
                <td data-label="Último movimiento">
                  <template v-if="lead.last_move">
                    <span class="report-move-to">
                      → {{ stageText(lead.last_move.to) }}
                      <span v-if="lead.last_move.blocked" class="report-blocked-tag">bloqueado</span>
                    </span>
                    <span class="report-sub">por {{ lead.last_move.actorLabel }}</span>
                    <span class="report-sub">{{ formatLeadDate(lead.last_move.createdAt) }}</span>
                  </template>
                  <span v-else class="report-sub">Sin movimientos registrados</span>
                </td>
                <td class="report-num" data-label="Movimientos">
                  {{ lead.moves }}
                  <span v-if="lead.blocked_moves" class="report-sub">{{ lead.blocked_moves }} bloqueado(s)</span>
                </td>
                <td class="report-actions-col">
                  <button type="button" class="btn-action-ghost report-btn" @click="toggle(lead.id)">
                    {{ isOpen(lead.id) ? 'Ocultar' : 'Ver trazabilidad' }}
                  </button>
                </td>
              </tr>

              <!--
                La trazabilidad va en su propia fila y a todo el ancho: en una
                celda de la fila del lead, una línea de tiempo de diez pasos
                deforma la tabla entera.
              -->
              <tr v-if="isOpen(lead.id)" class="report-timeline-row">
                <td colspan="6">
                  <ol class="report-timeline">
                    <li
                      v-for="entry in lead.timeline"
                      :key="entry.id"
                      class="report-timeline-item"
                      :class="{ 'is-blocked': entry.blocked, 'is-derived': entry.derived }"
                    >
                      <div class="report-timeline-main">
                        <template v-if="entry.kind === 'alta'">
                          <strong>Registrado</strong>
                          <span class="report-timeline-origin">{{ altaOrigin(entry) }}</span>
                        </template>
                        <template v-else>
                          <span class="report-stage-from">{{ entry.from ? stageText(entry.from) : 'Sin etapa' }}</span>
                          <span class="report-stage-arrow">→</span>
                          <span class="report-stage-to">{{ stageText(entry.to) }}</span>
                          <span v-if="entry.blocked" class="report-blocked-tag">bloqueado</span>
                        </template>
                      </div>
                      <div class="report-timeline-meta">
                        {{ entry.kind === 'alta' ? '' : `${entry.actorLabel} · ` }}{{ formatLeadDate(entry.createdAt) }}
                      </div>
                      <p v-if="entry.reason" class="report-timeline-reason">{{ entry.reason }}</p>
                    </li>
                  </ol>
                  <p v-if="lead.moves === 0" class="report-timeline-empty">
                    Este lead no tiene cambios de etapa registrados: o no se movió, o se movió antes
                    de que existiera la bitácora.
                  </p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <nav v-if="pages > 1" class="report-pager">
        <button type="button" class="btn-action-ghost" :disabled="page <= 1 || isLoading" @click="goTo(page - 1)">
          ← Anterior
        </button>
        <span class="report-pager-label">Página {{ page }} de {{ pages }}</span>
        <button type="button" class="btn-action-ghost" :disabled="page >= pages || isLoading" @click="goTo(page + 1)">
          Siguiente →
        </button>
      </nav>
    </template>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { formatLeadDate } from '../leadCardDate.js';

/*
 * Reporte de Leads: la bitácora de etapas (`lead_stage_changes`) de todos los
 * leads a la vez.
 *
 * Los filtros y la paginación se resuelven en el SERVIDOR y no acá: filtrar en
 * el navegador sobre lo cargado es "buscá entre los primeros 25", y el
 * movimiento que se viene a investigar es justo el que no está a mano. Por eso
 * cada cambio de filtro vuelve a pedir la página (el buscador, con un respiro
 * de 350 ms para no pedirla en cada tecla).
 *
 * Los nombres de etapa, el nombre de quien movió el lead y el estado de cada
 * movimiento vienen armados del servidor: son el mismo vocabulario que usan el
 * tablero y la bandeja de WhatsApp, y una copia acá terminaría diciendo otra
 * cosa el día que alguien renombre una columna.
 */

const leads = ref([]);
const total = ref(0);
const page = ref(1);
const pages = ref(1);
const scope = ref('all');
const summary = reactive({ leads: 0, moves: 0, blocked: 0, unmoved: 0 });
const actorOptions = ref([]);
const stageOptions = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');

const search = ref('');
const actor = ref('');
const status = ref('');
const from = ref('');
const to = ref('');
const onlyBlocked = ref(false);

/** Qué leads tienen la trazabilidad desplegada (los ids, no el objeto). */
const open = ref(new Set());

const hasFilters = computed(() =>
  Boolean(search.value || actor.value || status.value || from.value || to.value || onlyBlocked.value));

const allExpanded = computed(() => leads.value.length > 0 && leads.value.every((lead) => open.value.has(lead.id)));

/**
 * Las etapas que ofrece el filtro son las de los dos tableros; se muestran
 * todas porque el reporte mira los dos a la vez (es su razón de ser: ver de
 * dónde a dónde se movió un lead, incluso cruzando de tablero).
 */
const stageFilterOptions = computed(() => stageOptions.value);

/**
 * Por qué la lista puede ser más corta de lo que alguien espera. El reporte usa
 * la misma visibilidad que el funnel, así que decirlo es la diferencia entre
 * una pantalla que se explica y una que parece vacía por error.
 */
const scopeNote = computed(() => {
  if (scope.value === 'mine') return '👤 Ves solo los leads que tienes asignados o de los que eres setter o closer, los mismos de tu tablero.';
  if (scope.value === 'setter') return '👤 Ves tus leads y todos los que todavía no pasaron al Funnel de Ventas.';
  return '';
});

function isOpen(id) {
  return open.value.has(id);
}

function toggle(id) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

function toggleAll() {
  open.value = allExpanded.value ? new Set() : new Set(leads.value.map((lead) => lead.id));
}

/** `{ icon, label }` del servidor, dicho en una línea. */
function stageText(stage) {
  if (!stage) return 'Sin etapa';
  return `${stage.icon || ''} ${stage.label}`.trim();
}

function boardName(lead) {
  return lead.stage?.board === 'ventas' ? 'Funnel de Ventas' : 'Setter Funnel';
}

function boardPill(lead) {
  return lead.stage?.board === 'ventas' ? 'pill-sales' : 'pill-setter';
}

/**
 * De dónde salió el lead, en el primer hito de la línea de tiempo. Lo cargado a
 * mano dice quién lo cargó —es a quien hay que preguntarle por una ficha
 * incompleta—; lo que entró solo dice por dónde entró, y si no se sabe calla en
 * vez de inventar un autor.
 */
function altaOrigin(entry) {
  if (entry.actorLabel) return `cargado a mano por ${entry.actorLabel}`;
  return entry.source ? `entró por ${entry.source}` : '';
}

function clearFilters() {
  search.value = '';
  actor.value = '';
  status.value = '';
  from.value = '';
  to.value = '';
  onlyBlocked.value = false;
}

function goTo(next) {
  page.value = Math.min(Math.max(1, next), pages.value);
  load();
}

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value) });
    if (search.value.trim()) params.set('search', search.value.trim());
    if (actor.value) params.set('actor', actor.value);
    if (status.value) params.set('status', status.value);
    if (from.value) params.set('from', from.value);
    if (to.value) params.set('to', to.value);
    if (onlyBlocked.value) params.set('onlyBlocked', '1');

    const response = await apiFetch(`/api/lead-report?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el Reporte de Leads.');

    leads.value = data.leads || [];
    total.value = data.total || 0;
    pages.value = data.pages || 1;
    // Una página más allá de la última (un enlace viejo, una URL escrita a
    // mano) mostraría "página 9 de 2" sobre una lista vacía.
    page.value = Math.min(data.page || 1, pages.value);
    scope.value = data.scope || 'all';
    Object.assign(summary, data.summary || {});
    actorOptions.value = data.options?.actors || [];
    stageOptions.value = data.options?.stages || [];
    // Al cambiar de página o de filtro, lo desplegado era de otras filas.
    open.value = new Set();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

/*
 * Cualquier filtro vuelve a la primera página: quedarse en la 4 de un resultado
 * que ahora tiene dos páginas muestra una lista vacía que parece un error.
 */
let searchTimer = null;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    load();
  }, 350);
});

watch([actor, status, from, to, onlyBlocked], () => {
  page.value = 1;
  load();
});

onMounted(load);
</script>

<style scoped>
.lead-report-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
}

.report-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.report-stats {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.report-stat {
  flex: 1 1 190px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.report-stat.is-moves { border-left-color: var(--accent-cyan); }
.report-stat.is-blocked { border-left-color: var(--accent-rose); }
.report-stat.is-quiet { border-left-color: var(--accent-amber); }

.report-stat-label { font-size: 0.72rem; color: var(--text-muted); }
.report-stat-value { font-size: 1.15rem; font-weight: 700; color: var(--text-main); }
.report-stat-note { font-size: 0.7rem; color: var(--text-muted); }

.report-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.report-search {
  flex: 1 1 300px;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.report-search input {
  flex: 1;
  border: none;
  background: none;
  color: var(--text-main);
  font-size: 0.85rem;
  outline: none;
}

.report-filter { max-width: 230px; }

.report-dates,
.report-check {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
  font-size: 0.78rem;
  color: var(--text-muted);
}

.report-dates input {
  border: none;
  background: none;
  color: var(--text-main);
  font-size: 0.78rem;
  outline: none;
}

.report-check { cursor: pointer; }
.report-clear { padding: 0.3rem 0.65rem; font-size: 0.78rem; }

.report-scope { border-color: rgba(16, 94, 255, 0.35); background: rgba(16, 94, 255, 0.07); }
.report-alert { border-color: rgba(200, 85, 50, 0.4); background: rgba(200, 85, 50, 0.08); }

.report-listhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.report-expand-all { padding: 0.25rem 0.6rem; font-size: 0.75rem; }

.report-table-wrapper { overflow-x: auto; }
.report-table td { vertical-align: top; }
.report-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.report-actions-col { text-align: right; white-space: nowrap; }

.report-client { display: block; font-weight: 600; color: var(--text-main); }
.report-sub { display: block; font-size: 0.72rem; color: var(--text-muted); }
.report-move-to { display: block; font-size: 0.82rem; color: var(--text-main); }

.pill-setter { background: rgba(44, 140, 153, 0.16); color: var(--accent-cyan); }
.pill-sales { background: rgba(16, 94, 255, 0.16); color: var(--primary); }

.report-blocked-tag {
  display: inline-block;
  margin-left: 0.3rem;
  padding: 0 0.3rem;
  border-radius: var(--radius-sm, 4px);
  background: rgba(200, 85, 50, 0.18);
  color: var(--accent-rose);
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.report-btn { padding: 0.3rem 0.65rem; font-size: 0.78rem; }

.is-open-row { background: var(--surface-1); }
.report-timeline-row td { background: var(--surface-1); padding-top: 0.2rem; }

/* La línea de tiempo: un riel a la izquierda y un punto por hito, para que la
   trayectoria se lea de corrido y no como una lista de frases sueltas. */
.report-timeline {
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0 0 0 0.9rem;
  border-left: 2px solid var(--border-color);
}

.report-timeline-item {
  position: relative;
  padding: 0.3rem 0 0.45rem 0.6rem;
}

.report-timeline-item::before {
  content: '';
  position: absolute;
  left: -1.42rem;
  top: 0.62rem;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--primary);
}

.report-timeline-item.is-derived::before { background: var(--text-muted); }
.report-timeline-item.is-blocked::before { background: var(--accent-rose); }

.report-timeline-main { font-size: 0.84rem; color: var(--text-main); }
.report-timeline-origin { color: var(--text-muted); font-size: 0.78rem; margin-left: 0.3rem; }
.report-stage-from { color: var(--text-muted); }
.report-stage-arrow { margin: 0 0.3rem; color: var(--text-muted); }
.report-stage-to { font-weight: 600; }
.report-timeline-meta { font-size: 0.72rem; color: var(--text-muted); }
.report-timeline-reason {
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  color: var(--text-muted);
  font-style: italic;
}

.report-timeline-empty {
  margin: 0.3rem 0 0.2rem;
  font-size: 0.74rem;
  color: var(--text-muted);
}

.report-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.report-pager-label { font-size: 0.78rem; color: var(--text-muted); }

/*
 * En el celular la tabla no se achica: se vuelve tarjetas, con el rótulo de
 * cada celda adentro (`data-label`). Seis columnas en 380 px solo se leen
 * arrastrando la tabla de lado, y este reporte se mira también desde el
 * teléfono cuando alguien pregunta "¿quién movió este lead?".
 */
@media (max-width: 760px) {
  .report-header { flex-direction: column; }
  .report-stat { flex-basis: 100%; }
  .report-filter,
  .report-search { max-width: none; flex: 1 1 100%; }
  .report-dates { flex: 1 1 100%; flex-wrap: wrap; }

  .report-table-wrapper { overflow-x: visible; }

  .report-table,
  .report-table tbody,
  .report-table tr,
  .report-table td {
    display: block;
    width: 100%;
  }

  .report-table thead { display: none; }

  .report-table tr {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 0.6rem 0.7rem;
    margin-bottom: 0.6rem;
    background: var(--bg-card-solid);
  }

  /* La trazabilidad abierta se pega a la tarjeta de su lead: separada por el
     margen, se lee como si fuera de otro. */
  .report-table tr.is-open-row { margin-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .report-table tr.report-timeline-row {
    border-top: none;
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .report-table td {
    border: none;
    padding: 0.22rem 0;
  }

  .report-table td[data-label]::before {
    content: attr(data-label);
    display: block;
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .report-table td[data-label="Lead"]::before { content: none; }
  .report-table td[data-label="Lead"] .report-client { font-size: 0.95rem; }

  .report-num,
  .report-actions-col { text-align: left; }

  .report-btn {
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.5rem;
    font-size: 0.84rem;
  }
}
</style>
