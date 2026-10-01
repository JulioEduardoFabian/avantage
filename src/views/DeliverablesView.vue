<template>
  <main class="container-fluid deliverables-page">
    <div class="dv-header">
      <div>
        <h2 class="section-heading"><span>📦</span> Entregables</h2>
        <p class="section-subheading" style="margin-bottom: 0;">
          Qué hay que entregar en cada proyecto, qué ya se entregó y cómo se cruza con el cobro.
          La entrega se hace por fuera (correo, WhatsApp, presencial) y se registra acá.
        </p>
      </div>
      <button class="btn-secondary" :disabled="isLoading" @click="fetchOverview">
        {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
      </button>
    </div>

    <div v-if="loadError" class="info-box dv-alert">
      <h4 style="color: var(--accent-rose);">⚠️ Algo salió mal</h4>
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
        placeholder="🔎 Buscar por cliente, proyecto, entregable o código de cuota…"
      />
      <label class="dv-check">
        <input v-model="onlyNeedsAttention" type="checkbox" />
        Solo lo que necesita atención
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
      <template v-else>Ningún entregable coincide con el filtro.</template>
    </p>

    <section v-for="project in visibleProjects" :key="project.project_id" class="glass-panel dv-project">
      <header class="dv-project-head">
        <div>
          <router-link :to="`/admin/projects/${project.project_id}`" class="dv-project-topic">
            {{ project.topic }}
          </router-link>
          <p class="dv-project-client">
            {{ project.client_name || project.client_email || 'Cliente sin nombre' }}
            <span v-if="project.university"> · {{ project.university }}</span>
            <span v-if="project.field_of_study"> · {{ project.field_of_study }}</span>
          </p>
          <p v-if="project.is_locked" class="dv-project-locked">
            🔒 El proyecto espera que Finanzas verifique el pago inicial
            <template v-if="project.initial_payment_code">({{ project.initial_payment_code }})</template>.
          </p>
        </div>
        <div class="dv-project-meta">
          <span class="dv-chip">{{ project.status }}</span>
          <span class="dv-chip">Tareas {{ project.completed_tasks }}/{{ project.total_tasks }} · {{ project.progress_percentage }}%</span>
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
              <th>Entregable</th>
              <th>Vence</th>
              <th>Cuota / Pago</th>
              <th>Entrega</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rowsFor(project)" :key="row.id" :class="{ 'is-overdue': row.is_overdue }">
              <td class="dv-cell-title">
                <strong>{{ row.title }}</strong>
                <span v-if="row.description" class="dv-desc">{{ row.description }}</span>
                <span v-if="row.notes" class="dv-desc">📝 {{ row.notes }}</span>
              </td>
              <td class="dv-nowrap">
                {{ row.due_date ? formatDate(row.due_date) : 'Por definir' }}
                <span v-if="row.is_overdue" class="dv-overdue-tag" title="La fecha pasó y sigue sin entregarse">vencida</span>
              </td>
              <td>
                <template v-if="row.income_id">
                  <span class="dv-badge" :class="`is-${paymentTone(row)}`">{{ paymentLabel(row) }}</span>
                  <span class="dv-code">Cuota {{ row.income_cuota }} · {{ row.income_code }}</span>
                  <span v-if="row.payment_overdue" class="dv-overdue-tag">cuota vencida</span>
                </template>
                <span v-else class="dv-muted">Sin cuota atada</span>
              </td>
              <td>
                <template v-if="row.status === 'entregado'">
                  <div>✅ {{ formatDate(row.delivered_at) }}</div>
                  <span class="dv-work-meta">
                    {{ channelLabel(row.delivery_channel) }}
                    <template v-if="row.delivered_by_name">· {{ row.delivered_by_name }}</template>
                  </span>
                  <button
                    v-if="row.has_attachment"
                    type="button"
                    class="dv-link-btn"
                    @click="downloadAttachment(row)"
                  >📎 {{ row.attachment_original_name }}</button>
                </template>
                <span v-else class="dv-muted">— sin entregar —</span>
              </td>
              <td>
                <span class="dv-badge" :class="`is-${stateTone(row.state)}`">
                  {{ stateIcon(row.state) }} {{ row.state_label }}
                </span>
                <span v-if="row.pending_reason" class="dv-pending">{{ row.pending_reason }}</span>
              </td>
              <td class="dv-actions">
                <button
                  v-if="row.status !== 'entregado'"
                  type="button"
                  class="btn-secondary dv-mini-btn"
                  @click="openDeliverModal(project, row)"
                >✓ Entregar</button>
                <button
                  v-else
                  type="button"
                  class="btn-secondary dv-mini-btn"
                  title="Se marcó por error: vuelve a pendiente (el archivo se conserva)"
                  :disabled="busyId === row.id"
                  @click="undeliver(row)"
                >↩ Revertir</button>
                <button type="button" class="btn-secondary dv-mini-btn" @click="openEditModal(project, row)">✎</button>
                <button
                  type="button"
                  class="btn-secondary dv-mini-btn is-danger"
                  :disabled="busyId === row.id"
                  @click="removeDeliverable(row)"
                >✕</button>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-else-if="project.deliverables.length === 0" class="dv-muted dv-no-rows">
          Este proyecto todavía no tiene entregables registrados.
        </p>
        <p v-else class="dv-muted dv-no-rows">
          Ninguno de sus {{ project.deliverables.length }} entregables está en «{{ stateLabel(stateFilter) }}».
        </p>
      </div>

      <div class="dv-project-actions">
        <button type="button" class="btn-secondary dv-mini-btn" @click="openCreateModal(project)">
          + Agregar entregable
        </button>
        <!-- Lo que ya está escrito en el contrato no se vuelve a teclear. Copia,
             no lectura en vivo: un contrato emitido no cambia porque alguien
             reprograme una entrega. -->
        <button
          v-if="project.contract_plan_available > 0"
          type="button"
          class="btn-secondary dv-mini-btn"
          :disabled="busyId === `import-${project.project_id}`"
          @click="importFromContract(project)"
        >
          📄 Importar del contrato ({{ project.contract_plan_available }})
        </button>
      </div>
    </section>

    <!-- Alta / edición del plan -->
    <div v-if="editModal.open" class="modal-overlay" @click.self="closeEditModal">
      <div class="modal-content dv-modal">
        <div class="modal-header">
          <h3 class="dv-modal-title">{{ editModal.id ? '✎ Editar entregable' : '+ Nuevo entregable' }}</h3>
          <button type="button" class="btn-secondary dv-mini-btn" @click="closeEditModal">✕ Cerrar</button>
        </div>
        <form class="modal-body" @submit.prevent="saveDeliverable">
          <div class="form-group">
            <label class="form-label">Qué se entrega *</label>
            <input v-model="editModal.title" type="text" class="form-input" placeholder="Capítulo I y II" required />
          </div>
          <div class="form-group">
            <label class="form-label">Detalle (opcional)</label>
            <textarea v-model="editModal.description" class="form-input" rows="2"></textarea>
          </div>
          <div class="dv-form-row">
            <div class="form-group">
              <label class="form-label">Fecha pactada</label>
              <input v-model="editModal.dueDate" type="date" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Se entrega contra la cuota…</label>
              <select v-model="editModal.incomeId" class="form-select">
                <option value="">Sin cuota atada</option>
                <option v-for="item in editModal.schedule" :key="item.income_id" :value="item.income_id">
                  Cuota {{ item.cuota }} · {{ item.code }} ({{ item.estado }})
                </option>
              </select>
            </div>
          </div>
          <p class="dv-modal-hint">
            Atar una cuota no bloquea nada: sirve para que el tablero avise si se entrega
            antes de que Finanzas verifique el pago, o si ya se cobró y falta entregar.
          </p>
          <p v-if="editModal.error" class="dv-modal-error">{{ editModal.error }}</p>
          <div class="dv-modal-actions">
            <button type="button" class="btn-secondary" @click="closeEditModal">Cancelar</button>
            <button type="submit" class="btn-primary dv-submit" :disabled="editModal.saving">
              {{ editModal.saving ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Registro de la entrega -->
    <div v-if="deliverModal.open" class="modal-overlay" @click.self="closeDeliverModal">
      <div class="modal-content dv-modal">
        <div class="modal-header">
          <h3 class="dv-modal-title">✓ Registrar entrega</h3>
          <button type="button" class="btn-secondary dv-mini-btn" @click="closeDeliverModal">✕ Cerrar</button>
        </div>
        <form class="modal-body" @submit.prevent="submitDelivery">
          <p class="dv-modal-subject">{{ deliverModal.title }}</p>
          <div class="dv-form-row">
            <div class="form-group">
              <label class="form-label">Fecha de entrega</label>
              <input v-model="deliverModal.deliveredAt" type="date" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Por dónde se entregó</label>
              <select v-model="deliverModal.channel" class="form-select">
                <option value="">Sin especificar</option>
                <option v-for="c in CHANNELS" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Copia del archivo (opcional)</label>
            <input type="file" class="form-input" @change="deliverModal.file = $event.target.files[0] || null" />
            <p class="dv-modal-hint">
              Respaldo interno. El cliente ya lo recibió por el canal de arriba: esto es para que
              mañana se pueda saber exactamente qué se mandó.
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Nota (opcional)</label>
            <textarea v-model="deliverModal.notes" class="form-input" rows="2"></textarea>
          </div>
          <p v-if="deliverModal.warnUnpaid" class="dv-modal-warn">
            ⚠️ La cuota de este entregable todavía no está verificada por Finanzas. Se puede
            registrar igual; quedará marcado como «Entregado sin cobrar».
          </p>
          <p v-if="deliverModal.error" class="dv-modal-error">{{ deliverModal.error }}</p>
          <div class="dv-modal-actions">
            <button type="button" class="btn-secondary" @click="closeDeliverModal">Cancelar</button>
            <button type="submit" class="btn-primary dv-submit" :disabled="deliverModal.saving">
              {{ deliverModal.saving ? 'Registrando…' : 'Registrar entrega' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';

/**
 * Módulo Entregables: CRUD sobre la tabla `deliverables` más el cruce con el
 * cobro. El estado operativo lo calcula el backend (`GET /api/deliverables`) y
 * acá solo se pinta, para que no se derive de dos formas distintas.
 *
 * No se muestran importes a propósito: una cuota se nombra por su código, igual
 * que en el módulo de Proyectos. El dinero se consulta en Finanzas.
 */

const overview = ref({ projects: [], totals: emptyTotals() });
const isLoading = ref(false);
const loadError = ref('');
const search = ref('');
const stateFilter = ref('');
const onlyNeedsAttention = ref(false);
const busyId = ref(null);

const CHANNELS = [
  { value: 'correo', label: '📧 Correo' },
  { value: 'whatsapp', label: '💬 WhatsApp' },
  { value: 'presencial', label: '🤝 Presencial' },
  { value: 'drive', label: '📁 Drive / enlace' },
  { value: 'otro', label: 'Otro' }
];

function emptyTotals() {
  return {
    projects: 0, projects_needing_attention: 0, deliverables: 0,
    entregado: 0, sin_cobrar: 0, por_entregar: 0, pendiente: 0, overdue: 0
  };
}

const STATE_META = {
  entregado: { label: 'Entregados', icon: '✅', tone: 'ok', hint: 'Entregado y con el pago verificado' },
  sin_cobrar: { label: 'Entregados sin cobrar', icon: '💸', tone: 'warn', hint: 'Salió el trabajo y el pago sigue sin verificar' },
  por_entregar: { label: 'Falta entregar', icon: '📤', tone: 'bad', hint: 'Ya se cobró y la entrega sigue pendiente' },
  pendiente: { label: 'Pendientes', icon: '⏳', tone: 'neutral', hint: 'Sin pago verificado y sin entregar' },
  overdue: { label: 'Entregas vencidas', icon: '⚠️', tone: 'bad', hint: 'Pasó la fecha pactada y no se entregó' }
};

const kpiTiles = computed(() => ['entregado', 'sin_cobrar', 'por_entregar', 'pendiente', 'overdue'].map((key) => ({
  key,
  value: overview.value.totals[key] || 0,
  ...STATE_META[key]
})));

const stateLabel = (key) => STATE_META[key]?.label || key;
const stateIcon = (key) => STATE_META[key]?.icon || '';
const stateTone = (key) => STATE_META[key]?.tone || 'neutral';

function toggleStateFilter(key) {
  stateFilter.value = stateFilter.value === key ? '' : key;
}

/** "overdue" no es un estado sino una marca que convive con cualquiera. */
function matchesStateFilter(row) {
  if (!stateFilter.value) return true;
  if (stateFilter.value === 'overdue') return row.is_overdue;
  return row.state === stateFilter.value;
}

const rowsFor = (project) => project.deliverables.filter(matchesStateFilter);

function matchesSearch(project) {
  const query = search.value.trim().toLowerCase();
  if (!query) return true;
  return [
    project.topic, project.client_name, project.client_email, project.university, project.field_of_study,
    ...project.deliverables.map((d) => `${d.title} ${d.income_code || ''}`)
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

const visibleProjects = computed(() => overview.value.projects.filter((project) => {
  if (!matchesSearch(project)) return false;
  if (onlyNeedsAttention.value && !project.needs_attention) return false;
  // Con un filtro de estado activo, un proyecto sin ninguna fila de ese estado
  // se esconde en vez de mostrarse vacío.
  if (stateFilter.value && rowsFor(project).length === 0) return false;
  return true;
}));

function projectStateChips(project) {
  return ['por_entregar', 'sin_cobrar', 'overdue', 'entregado']
    .filter((key) => (project.counts[key] || 0) > 0)
    .map((key) => ({
      key,
      value: project.counts[key],
      label: STATE_META[key].label.toLowerCase(),
      icon: STATE_META[key].icon,
      tone: STATE_META[key].tone
    }));
}

/** "pagado" en Finanzas significa "con comprobante, a la espera del visto bueno". */
function paymentLabel(row) {
  if (row.income_estado === 'verificado') return '✅ Verificado';
  if (row.income_estado === 'pagado') return '🧾 En revisión';
  return '⏳ Sin pagar';
}

function paymentTone(row) {
  if (row.income_estado === 'verificado') return 'ok';
  if (row.income_estado === 'pagado') return 'warn';
  return 'neutral';
}

const channelLabel = (value) => CHANNELS.find((c) => c.value === value)?.label || 'Canal sin registrar';

/**
 * Las fechas llegan como `AAAA-MM-DD` (un día de calendario, no un instante):
 * construir un `Date` con ellas las corre un día hacia atrás en Perú, así que se
 * formatean desde el texto. Mismo criterio que `src/views/finance/format.js`.
 */
function formatDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

// ------------------------------------------------------------------- LECTURA

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

// ----------------------------------------------------------- ALTA Y EDICIÓN

const editModal = reactive({
  open: false, id: null, projectId: null, title: '', description: '', dueDate: '', incomeId: '',
  schedule: [], saving: false, error: ''
});

function openCreateModal(project) {
  Object.assign(editModal, {
    open: true, id: null, projectId: project.project_id, title: '', description: '', dueDate: '',
    incomeId: '', schedule: project.schedule, saving: false, error: ''
  });
}

function openEditModal(project, row) {
  Object.assign(editModal, {
    open: true, id: row.id, projectId: project.project_id, title: row.title,
    description: row.description || '', dueDate: row.due_date || '', incomeId: row.income_id || '',
    schedule: project.schedule, saving: false, error: ''
  });
}

function closeEditModal() {
  editModal.open = false;
}

async function saveDeliverable() {
  editModal.saving = true;
  editModal.error = '';
  try {
    const payload = {
      title: editModal.title,
      description: editModal.description,
      dueDate: editModal.dueDate || null,
      incomeId: editModal.incomeId ? Number(editModal.incomeId) : null
    };
    const response = editModal.id
      ? await apiFetch(`/api/deliverables/${editModal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
      : await apiFetch('/api/deliverables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, projectId: editModal.projectId })
      });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el entregable.');
    editModal.open = false;
    await fetchOverview();
  } catch (error) {
    editModal.error = error.message;
  } finally {
    editModal.saving = false;
  }
}

async function removeDeliverable(row) {
  if (!confirm(`¿Eliminar el entregable "${row.title}"? También se borra el archivo guardado.`)) return;
  busyId.value = row.id;
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo eliminar el entregable.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

// ------------------------------------------------------------------ ENTREGA

const deliverModal = reactive({
  open: false, id: null, title: '', deliveredAt: '', channel: '', notes: '', file: null,
  warnUnpaid: false, saving: false, error: ''
});

function openDeliverModal(project, row) {
  Object.assign(deliverModal, {
    open: true, id: row.id, title: row.title, deliveredAt: todayIso(), channel: '', notes: row.notes || '',
    file: null,
    // Avisar ANTES y no después: entregar sin el pago verificado se puede, pero
    // quien lo registra tiene que saber que eso es lo que está haciendo.
    warnUnpaid: Boolean(row.income_id) && !row.payment_verified,
    saving: false, error: ''
  });
}

function closeDeliverModal() {
  deliverModal.open = false;
}

async function submitDelivery() {
  deliverModal.saving = true;
  deliverModal.error = '';
  try {
    const formData = new FormData();
    if (deliverModal.deliveredAt) formData.append('deliveredAt', deliverModal.deliveredAt);
    if (deliverModal.channel) formData.append('channel', deliverModal.channel);
    if (deliverModal.notes) formData.append('notes', deliverModal.notes);
    if (deliverModal.file) formData.append('attachment', deliverModal.file);

    const response = await apiFetch(`/api/deliverables/${deliverModal.id}/deliver`, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo registrar la entrega.');
    deliverModal.open = false;
    await fetchOverview();
  } catch (error) {
    deliverModal.error = error.message;
  } finally {
    deliverModal.saving = false;
  }
}

async function undeliver(row) {
  if (!confirm(`¿Marcar "${row.title}" como no entregado? El archivo guardado se conserva.`)) return;
  busyId.value = row.id;
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}/undeliver`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo revertir la entrega.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

async function importFromContract(project) {
  busyId.value = `import-${project.project_id}`;
  try {
    const response = await apiFetch(`/api/projects/${project.project_id}/deliverables/import-contract`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo importar el cronograma de entregas.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

/**
 * La descarga va por `apiFetch` y no por un `<a href>`: la ruta exige el Bearer
 * del panel, que un enlace directo no manda. Mismo patrón que el adjunto de un
 * avance en el detalle del proyecto.
 */
async function downloadAttachment(row) {
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}/attachment`);
    if (!response.ok) throw new Error('No se pudo descargar el archivo.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = row.attachment_original_name || 'entregable';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    loadError.value = error.message;
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

.dv-alert { border-color: rgba(200, 85, 50, 0.4); margin-bottom: 1.25rem; }

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

.dv-kpi-value { font-family: var(--font-heading); font-size: 1.5rem; line-height: 1.1; color: var(--text-main); }
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
.dv-empty { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

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
.dv-project-locked { font-size: 0.78rem; color: var(--accent-amber); margin: 0.4rem 0 0; max-width: 60ch; }

.dv-project-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: flex-end; }

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

.dv-project-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border-color);
}

/* --- Tabla --------------------------------------------------------------- */

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

.dv-cell-title { color: var(--text-main); min-width: 16ch; }
.dv-desc { display: block; font-size: 0.74rem; color: var(--text-muted); margin-top: 0.15rem; }
.dv-nowrap { white-space: nowrap; }

.dv-code { display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem; }

.dv-overdue-tag {
  display: inline-block;
  font-size: 0.65rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  border: 1px solid rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
  margin-top: 0.2rem;
}

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

.dv-work-meta { display: block; font-size: 0.7rem; color: var(--text-muted); }
.dv-muted { color: var(--text-muted); }
.dv-pending { display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.25rem; max-width: 30ch; }
.dv-no-rows { font-size: 0.82rem; padding: 0.5rem 0; }

.dv-link-btn {
  background: none;
  border: none;
  padding: 0;
  margin-top: 0.25rem;
  font-size: 0.74rem;
  color: var(--accent-cyan);
  cursor: pointer;
  text-align: left;
}

.dv-actions { display: flex; gap: 0.3rem; white-space: nowrap; }

.dv-mini-btn { padding: 0.25rem 0.6rem; font-size: 0.75rem; width: auto; }
.dv-mini-btn.is-danger { color: var(--accent-rose); }

/* --- Modales ------------------------------------------------------------- */

.dv-modal { max-width: 560px; }
.dv-modal-title { font-family: var(--font-heading); font-size: 1rem; color: var(--text-main); margin: 0; }
.dv-modal-subject { font-size: 0.9rem; color: var(--text-main); font-weight: 600; margin: 0 0 0.9rem; }

.dv-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

.dv-modal-hint { font-size: 0.74rem; color: var(--text-muted); margin: 0.35rem 0 0; }
.dv-modal-warn { font-size: 0.78rem; color: var(--accent-amber); margin: 0.75rem 0 0; }
.dv-modal-error { font-size: 0.8rem; color: var(--accent-rose); margin: 0.6rem 0 0; }

.dv-modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.1rem; }
.dv-submit { width: auto; padding: 0 1.25rem; }

@media (max-width: 720px) {
  .dv-project-meta { justify-content: flex-start; }
  .dv-filter-count { margin-left: 0; }
  .dv-form-row { grid-template-columns: 1fr; }
}
</style>
