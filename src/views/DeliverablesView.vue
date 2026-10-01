<template>
  <main class="container-fluid deliverables-page">
    <div class="dv-header">
      <div>
        <h2 class="section-heading"><span>📦</span> Entregables</h2>
        <p class="section-subheading" style="margin-bottom: 0;">
          Una fila por cuota del cronograma, con el pago y el trabajo subido juntos:
          responde de un golpe si <strong>el pago ya está verificado</strong> y si
          <strong>el entregable ya está en el proyecto</strong>.
        </p>
      </div>
      <button class="btn-secondary" :disabled="isLoading" @click="fetchOverview">
        {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
      </button>
    </div>

    <div v-if="loadError" class="info-box dv-alert">
      <h4 style="color: var(--accent-rose);">⚠️ No se pudo cargar el tablero</h4>
      <p>{{ loadError }}</p>
    </div>

    <!-- Contadores. Cuentan SIEMPRE todo el tablero, no lo filtrado: son el
         semáforo del día, y al hacer clic filtran la lista de abajo. -->
    <div class="dv-kpi-grid">
      <button
        v-for="tile in kpiTiles"
        :key="tile.key"
        type="button"
        class="dv-kpi"
        :class="[`is-${tile.tone}`, { 'is-active': stateFilter === tile.key }]"
        @click="toggleStateFilter(tile.key)"
      >
        <span class="dv-kpi-value">{{ tile.value }}</span>
        <span class="dv-kpi-label">{{ tile.icon }} {{ tile.label }}</span>
        <span class="dv-kpi-hint">{{ tile.hint }}</span>
      </button>
    </div>

    <div class="dv-filters glass-panel">
      <input
        v-model="search"
        type="text"
        class="form-input dv-search"
        placeholder="🔎 Buscar por cliente, tema, universidad o código de cuota…"
      />
      <label class="dv-check">
        <input v-model="onlyNeedsAttention" type="checkbox" />
        Solo lo que necesita atención
      </label>
      <label class="dv-check">
        <input v-model="showContractPlan" type="checkbox" />
        Mostrar lo comprometido en el contrato
      </label>
      <span class="dv-filter-count">
        {{ visibleProjects.length }} de {{ overview.projects.length }} proyectos
        <template v-if="stateFilter">· filtrando «{{ stateLabel(stateFilter) }}»</template>
      </span>
    </div>

    <p v-if="isLoading && overview.projects.length === 0" class="dv-empty">Cargando entregables…</p>

    <p v-else-if="visibleProjects.length === 0" class="dv-empty">
      <template v-if="overview.projects.length === 0">
        Todavía no hay proyectos. Un proyecto nace cuando un lead llega a la columna de cierre del
        <router-link to="/admin/leads">Funnel de Ventas</router-link>.
      </template>
      <template v-else>
        Ningún entregable coincide con el filtro. 🎉
      </template>
    </p>

    <!-- Un bloque por proyecto: operativamente se trabaja proyecto por proyecto,
         y así se puede ver el cronograma completo de un cliente de un vistazo. -->
    <section v-for="project in visibleProjects" :key="project.project_id" class="glass-panel dv-project">
      <header class="dv-project-head">
        <div class="dv-project-id">
          <router-link :to="`/admin/projects/${project.project_id}`" class="dv-project-topic">
            {{ project.topic }}
          </router-link>
          <p class="dv-project-client">
            {{ project.client_name || project.client_email || 'Cliente sin nombre' }}
            <span v-if="project.university"> · {{ project.university }}</span>
            <span v-if="project.field_of_study"> · {{ project.field_of_study }}</span>
          </p>
          <p v-if="project.is_locked" class="dv-project-locked">
            🔒 El proyecto está esperando que Finanzas verifique el pago inicial
            <template v-if="project.initial_payment_code">({{ project.initial_payment_code }})</template>:
            hasta entonces no se puede subir ningún entregable.
          </p>
        </div>
        <div class="dv-project-meta">
          <span class="dv-chip">{{ project.status }}</span>
          <span class="dv-chip">
            Tareas {{ project.completed_tasks }}/{{ project.total_tasks }} ·
            {{ project.progress_percentage }}%
          </span>
          <span v-if="project.deadline" class="dv-chip">Límite {{ formatDate(project.deadline) }}</span>
          <span
            v-for="chip in projectStateChips(project)"
            :key="chip.key"
            class="dv-chip"
            :class="`is-${chip.tone}`"
          >{{ chip.icon }} {{ chip.value }} {{ chip.label }}</span>
        </div>
      </header>

      <div class="dv-table-scroll">
        <table v-if="rowsFor(project).length > 0" class="dv-table">
          <thead>
            <tr>
              <th>Cuota</th>
              <th>Vence</th>
              <th>Pago</th>
              <th>Trabajo subido</th>
              <th>Estado</th>
              <th>Qué falta</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rowsFor(project)" :key="row.income_id" :class="{ 'is-overdue': row.is_overdue }">
              <td class="dv-cell-cuota">
                <strong>Cuota {{ row.cuota }}</strong>
                <span class="dv-code">{{ row.code }}</span>
                <span v-if="row.is_initial_payment" class="dv-tag">pago inicial</span>
              </td>
              <td class="dv-nowrap">
                {{ row.due_date ? formatDate(row.due_date) : '—' }}
                <span v-if="row.is_overdue" class="dv-overdue-tag" title="Venció y sigue sin verificarse">vencida</span>
              </td>
              <td>
                <span class="dv-badge" :class="`is-${paymentTone(row)}`">
                  {{ paymentLabel(row) }}
                </span>
              </td>
              <td>
                <template v-if="row.attachments.length > 0">
                  <div v-for="work in row.attachments" :key="work.update_id" class="dv-work">
                    📎 {{ work.attachment_original_name }}
                    <span class="dv-work-meta">
                      {{ work.author_name || 'Usuario' }} · {{ formatDateTime(work.created_at) }}
                    </span>
                  </div>
                </template>
                <span v-else-if="row.updates.length > 0" class="dv-muted">
                  Solo hitos de texto, sin archivo
                </span>
                <span v-else class="dv-muted">— sin subir —</span>
              </td>
              <td>
                <span class="dv-badge" :class="`is-${stateTone(row.state)}`">
                  {{ stateIcon(row.state) }} {{ row.state_label }}
                </span>
              </td>
              <td class="dv-pending">
                <span v-if="row.pending_reason">{{ row.pending_reason }}</span>
                <span v-else class="dv-muted">Nada: el cliente ya lo descarga.</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="project.deliverables.length === 0" class="dv-muted dv-no-rows">
          Este proyecto no tiene cuotas en el cronograma, así que no hay entregables que condicionar.
          El plan de cobro se arma en
          <router-link to="/admin/finance">Finanzas</router-link> o en el contrato del cliente.
        </p>
        <!-- Tiene cuotas, pero ninguna del estado filtrado. Se distingue del caso
             de arriba a propósito: decirle "no tiene cuotas" a quien sí las tiene
             manda a revisar el cronograma por nada. -->
        <p v-else class="dv-muted dv-no-rows">
          Ninguna de sus {{ project.deliverables.length }} cuotas está en «{{ stateLabel(stateFilter) }}».
        </p>
      </div>

      <!-- Trabajo subido que no libera ningún cobro. No es un error, pero es lo
           que hace que un entregable no aparezca en ninguna fila de arriba. -->
      <div v-if="project.unlinked_attachments.length > 0" class="dv-unlinked">
        <h4 class="dv-sub-title">
          ⚠️ {{ project.unlinked_attachments.length }}
          {{ project.unlinked_attachments.length === 1 ? 'entregable subido' : 'entregables subidos' }}
          sin cuota asociada
        </h4>
        <p class="dv-sub-hint">
          El cliente los descarga sin condición. Si alguno debía liberarse con un pago, átalo acá.
        </p>
        <div v-for="work in project.unlinked_attachments" :key="work.update_id" class="dv-unlinked-row">
          <span class="dv-unlinked-file">📎 {{ work.attachment_original_name }}</span>
          <span class="dv-work-meta">{{ work.author_name || 'Usuario' }} · {{ formatDateTime(work.created_at) }}</span>
          <select
            v-if="canLink"
            class="form-select dv-link-select"
            :disabled="project.is_locked || linkingUpdateId === work.update_id"
            :value="''"
            @change="linkToIncome(work, $event.target.value)"
          >
            <option value="">Atar a una cuota…</option>
            <option v-for="row in project.deliverables" :key="row.income_id" :value="row.income_id">
              Cuota {{ row.cuota }} · {{ row.code }}
              {{ row.payment_verified ? '(ya verificada)' : `(${row.payment_estado})` }}
            </option>
          </select>
        </div>
        <p v-if="project.is_locked && canLink" class="dv-sub-hint">
          Primero hay que verificar el pago inicial: con el proyecto bloqueado no se puede cambiar nada.
        </p>
      </div>

      <!-- Lo prometido por escrito. Se muestra al lado y no cruzado con las
           cuotas: una entrega del contrato es un compromiso, no un cobro, así
           que no comparten llave. Sirve para comparar fechas. -->
      <div v-if="showContractPlan && project.contract_deliverables.length > 0" class="dv-contract">
        <h4 class="dv-sub-title">📄 Comprometido en el contrato</h4>
        <ul class="dv-contract-list">
          <li v-for="item in project.contract_deliverables" :key="item.id">
            <span class="dv-nowrap dv-code">{{ item.due_date ? formatDate(item.due_date) : 'Por definir' }}</span>
            {{ item.avance }}
          </li>
        </ul>
      </div>
    </section>
  </main>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';
import { hasPermission } from '../auth.js';

/**
 * Tablero operativo de entregables: cruza las cuotas del cronograma
 * (`finance_income`) con el trabajo subido a la línea de tiempo del proyecto
 * (`project_updates.income_id`). Todo viene calculado del backend en
 * `GET /api/deliverables` — acá solo se filtra y se pinta, para que el estado de
 * un entregable no se derive de dos formas distintas.
 *
 * No se muestran importes a propósito: una cuota se nombra por su código, igual
 * que en el módulo de Proyectos. El dinero se consulta en Finanzas, que tiene su
 * propio permiso.
 */

const overview = ref({ projects: [], totals: emptyTotals() });
const isLoading = ref(false);
const loadError = ref('');
const search = ref('');
const stateFilter = ref('');
const onlyNeedsAttention = ref(false);
const showContractPlan = ref(false);
const linkingUpdateId = ref(null);

/** Atar un avance a una cuota es la única escritura del módulo. */
const canLink = computed(() => hasPermission('deliverables.view') || hasPermission('projects.view'));

function emptyTotals() {
  return {
    projects: 0, projects_needing_attention: 0, deliverables: 0,
    entregado: 0, retenido: 0, falta_trabajo: 0, pendiente: 0,
    overdue: 0, unlinked_attachments: 0
  };
}

const STATE_META = {
  entregado: { label: 'Entregados', icon: '✅', tone: 'ok', hint: 'Pago verificado y trabajo subido' },
  retenido: { label: 'Retenidos por pago', icon: '🔒', tone: 'warn', hint: 'Subido, falta que Finanzas verifique' },
  falta_trabajo: { label: 'Falta subir el trabajo', icon: '📤', tone: 'bad', hint: 'Pago verificado y sin entregable' },
  pendiente: { label: 'Pendientes', icon: '⏳', tone: 'neutral', hint: 'Sin pago verificado y sin subir' },
  overdue: { label: 'Cuotas vencidas', icon: '⚠️', tone: 'bad', hint: 'Vencieron y siguen sin verificarse' }
};

const kpiTiles = computed(() => ['entregado', 'retenido', 'falta_trabajo', 'pendiente', 'overdue'].map((key) => ({
  key,
  value: overview.value.totals[key] || 0,
  ...STATE_META[key]
})));

function stateLabel(key) {
  return STATE_META[key]?.label || key;
}

function stateIcon(key) {
  return STATE_META[key]?.icon || '';
}

function stateTone(key) {
  return STATE_META[key]?.tone || 'neutral';
}

function toggleStateFilter(key) {
  stateFilter.value = stateFilter.value === key ? '' : key;
}

/**
 * ¿Esta fila pasa el filtro de estado? "overdue" no es un estado sino una marca
 * que puede convivir con cualquiera, así que se comprueba aparte.
 */
function matchesStateFilter(row) {
  if (!stateFilter.value) return true;
  if (stateFilter.value === 'overdue') return row.is_overdue;
  return row.state === stateFilter.value;
}

/** Las filas de un proyecto ya filtradas por estado. */
function rowsFor(project) {
  return project.deliverables.filter(matchesStateFilter);
}

function matchesSearch(project) {
  const query = search.value.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    project.topic,
    project.client_name,
    project.client_email,
    project.university,
    project.field_of_study,
    ...project.deliverables.map((d) => d.code)
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

const visibleProjects = computed(() => overview.value.projects.filter((project) => {
  if (!matchesSearch(project)) return false;
  if (onlyNeedsAttention.value && !project.needs_attention) return false;
  // Con un filtro de estado activo, un proyecto sin ninguna fila de ese estado
  // no se muestra vacío: se esconde. La excepción son los entregables sueltos,
  // que son un pendiente real aunque no caigan en ninguna cuota.
  if (stateFilter.value && rowsFor(project).length === 0 && project.unlinked_attachments.length === 0) return false;
  return true;
}));

/** Resumen por estado de un proyecto, solo con lo que tiene algo que contar. */
function projectStateChips(project) {
  return ['retenido', 'falta_trabajo', 'overdue', 'entregado']
    .filter((key) => (project.counts[key] || 0) > 0)
    .map((key) => ({
      key,
      value: project.counts[key],
      label: STATE_META[key].label.toLowerCase(),
      icon: STATE_META[key].icon,
      tone: STATE_META[key].tone
    }));
}

/**
 * El estado del pago en los términos que usa Finanzas: "pagado" significa que
 * alguien subió el comprobante y está a la espera del visto bueno, no que el
 * dinero ya cuente.
 */
function paymentLabel(row) {
  if (row.payment_estado === 'verificado') return '✅ Verificado';
  if (row.payment_estado === 'pagado') return '🧾 En revisión';
  return '⏳ Sin pagar';
}

function paymentTone(row) {
  if (row.payment_estado === 'verificado') return 'ok';
  if (row.payment_estado === 'pagado') return 'warn';
  return 'neutral';
}

/**
 * Las fechas llegan como `AAAA-MM-DD` (un día de calendario, no un instante):
 * construir un `Date` con ellas las corre un día hacia atrás en Perú, así que se
 * formatean desde el texto. Mismo criterio que `src/views/finance/format.js`.
 */
function formatDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

/** `created_at` sí es un instante real (timestamp), así que va por Date. */
function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function fetchOverview() {
  isLoading.value = true;
  loadError.value = '';
  try {
    const response = await apiFetch('/api/deliverables');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener el tablero de entregables.');
    overview.value = { projects: data.projects || [], totals: { ...emptyTotals(), ...(data.totals || {}) } };
  } catch (error) {
    loadError.value = error.message || 'Error de conexión con el servidor.';
  } finally {
    isLoading.value = false;
  }
}

/**
 * Ata un entregable ya subido a la cuota que lo libera. Usa el mismo endpoint
 * que el detalle del proyecto para que la regla ("la cuota tiene que ser de este
 * cliente") se valide en un solo lugar del backend.
 */
async function linkToIncome(work, incomeId) {
  if (!incomeId) return;
  linkingUpdateId.value = work.update_id;
  try {
    const response = await apiFetch(`/api/project-updates/${work.update_id}/unlock-income`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incomeId: Number(incomeId) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo atar el entregable a la cuota.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    linkingUpdateId.value = null;
  }
}

onMounted(fetchOverview);
</script>

<style scoped>
.deliverables-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  max-width: 100%;
  box-sizing: border-box;
}

.dv-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.dv-alert {
  border-color: rgba(200, 85, 50, 0.4);
  margin-bottom: 1.25rem;
}

/* --- Contadores ---------------------------------------------------------- */

.dv-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.dv-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.dv-kpi:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.dv-kpi.is-active { border-color: var(--border-glow); box-shadow: 0 0 0 1px var(--border-glow); }

.dv-kpi-value {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  line-height: 1.1;
  color: var(--text-main);
}

.dv-kpi-label { font-size: 0.8rem; color: var(--text-sub); font-weight: 600; }
.dv-kpi-hint { font-size: 0.7rem; color: var(--text-muted); }

.dv-kpi.is-ok .dv-kpi-value { color: var(--accent-emerald); }
.dv-kpi.is-warn .dv-kpi-value { color: var(--accent-amber); }
.dv-kpi.is-bad .dv-kpi-value { color: var(--accent-rose); }

/* --- Filtros ------------------------------------------------------------- */

.dv-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1.25rem;
}

.dv-search { flex: 1 1 280px; min-width: 220px; }

.dv-check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--text-sub);
  cursor: pointer;
  white-space: nowrap;
}

.dv-filter-count { font-size: 0.78rem; color: var(--text-muted); margin-left: auto; }

.dv-empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* --- Proyecto ------------------------------------------------------------ */

.dv-project { padding: 1.1rem 1.25rem; margin-bottom: 1rem; }

.dv-project-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  padding-bottom: 0.85rem;
  margin-bottom: 0.85rem;
  border-bottom: 1px solid var(--border-color);
}

.dv-project-topic {
  font-family: var(--font-heading);
  font-size: 1rem;
  color: var(--text-main);
  text-decoration: none;
  font-weight: 600;
}

.dv-project-topic:hover { color: var(--accent-cyan); }
.dv-project-client { font-size: 0.8rem; color: var(--text-muted); margin: 0.25rem 0 0; }

.dv-project-locked {
  font-size: 0.78rem;
  color: var(--accent-amber);
  margin: 0.4rem 0 0;
  max-width: 60ch;
}

.dv-project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  justify-content: flex-end;
}

.dv-chip {
  font-size: 0.72rem;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-sub);
  white-space: nowrap;
}

.dv-chip.is-ok { color: var(--accent-emerald); border-color: rgba(46, 125, 70, 0.4); }
.dv-chip.is-warn { color: var(--accent-amber); border-color: rgba(222, 117, 75, 0.4); }
.dv-chip.is-bad { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.4); }

/* --- Tabla de entregables ------------------------------------------------ */

.dv-table-scroll { overflow-x: auto; }

.dv-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }

.dv-table th {
  text-align: left;
  padding: 0.4rem 0.6rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.dv-table td {
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-sub);
  vertical-align: top;
}

.dv-table tbody tr:last-child td { border-bottom: none; }
.dv-table tr.is-overdue td:first-child { box-shadow: inset 2px 0 0 var(--accent-rose); }

.dv-cell-cuota { white-space: nowrap; color: var(--text-main); }
.dv-nowrap { white-space: nowrap; }

.dv-code {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.dv-tag,
.dv-overdue-tag {
  display: inline-block;
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  margin-top: 0.2rem;
}

.dv-overdue-tag { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.4); }

.dv-badge {
  display: inline-block;
  font-size: 0.74rem;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  white-space: nowrap;
}

.dv-badge.is-ok { color: var(--accent-emerald); border-color: rgba(46, 125, 70, 0.4); }
.dv-badge.is-warn { color: var(--accent-amber); border-color: rgba(222, 117, 75, 0.4); }
.dv-badge.is-bad { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.4); }
.dv-badge.is-neutral { color: var(--text-muted); }

.dv-work { margin-bottom: 0.3rem; color: var(--text-main); }
.dv-work:last-child { margin-bottom: 0; }
.dv-work-meta { display: block; font-size: 0.7rem; color: var(--text-muted); }
.dv-muted { color: var(--text-muted); }
.dv-pending { max-width: 32ch; font-size: 0.78rem; }
.dv-no-rows { font-size: 0.82rem; padding: 0.5rem 0; }

/* --- Entregables sin cuota y plan del contrato --------------------------- */

.dv-unlinked,
.dv-contract {
  margin-top: 0.9rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border-color);
}

.dv-sub-title {
  font-family: var(--font-heading);
  font-size: 0.85rem;
  color: var(--text-main);
  margin: 0 0 0.25rem;
}

.dv-sub-hint { font-size: 0.75rem; color: var(--text-muted); margin: 0 0 0.6rem; }

.dv-unlinked-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  padding: 0.4rem 0;
}

.dv-unlinked-file { font-size: 0.82rem; color: var(--text-main); }
.dv-link-select { width: auto; min-width: 220px; margin-left: auto; font-size: 0.78rem; }

.dv-contract-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--text-sub);
}

.dv-contract-list li { margin-bottom: 0.3rem; }
.dv-contract-list .dv-code { display: inline-block; min-width: 7.5rem; }

@media (max-width: 720px) {
  .dv-project-meta { justify-content: flex-start; }
  .dv-filter-count { margin-left: 0; }
  .dv-link-select { margin-left: 0; width: 100%; }
}
</style>
