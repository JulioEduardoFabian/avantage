<template>
  <main class="container-fluid collections-page">
    <header class="collections-header">
      <div>
        <h2 class="section-heading">
          <span class="heading-icon">📞</span> Cobranzas
        </h2>
        <p class="section-subheading">
          Las cuotas que faltan cobrar y las que ya cobraste y Finanzas todavía no verificó.
          Marcar una como cobrada no la verifica: ese visto bueno lo sigue dando Finanzas.
        </p>
      </div>
      <button class="btn-action-secondary" :disabled="isLoading" @click="load">
        <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
        {{ isLoading ? 'Cargando…' : 'Actualizar' }}
      </button>
    </header>

    <section class="collections-stats">
      <div class="collections-stat">
        <span class="collections-stat-label">Por cobrar</span>
        <span class="collections-stat-value">S/ {{ money(summary.pendiente.total) }}</span>
        <span class="collections-stat-note">{{ summary.pendiente.n }} cuota(s)</span>
      </div>
      <div class="collections-stat is-overdue">
        <span class="collections-stat-label">Vencidas</span>
        <span class="collections-stat-value">S/ {{ money(summary.vencido.total) }}</span>
        <span class="collections-stat-note">{{ summary.vencido.n }} cuota(s) pasadas de fecha</span>
      </div>
      <div class="collections-stat is-collected">
        <span class="collections-stat-label">Cobrado, sin verificar</span>
        <span class="collections-stat-value">S/ {{ money(summary.cobrado.total) }}</span>
        <span class="collections-stat-note">{{ summary.cobrado.n }} cuota(s) esperando a Finanzas</span>
      </div>
    </section>

    <div class="collections-toolbar">
      <label class="collections-search">
        <span aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          placeholder="Buscar por cliente, teléfono, correo o código"
          aria-label="Buscar cuotas"
        />
      </label>
      <select v-model="estadoFilter" class="form-select collections-filter" aria-label="Filtrar por estado">
        <option value="">Todas</option>
        <option value="pendiente">Por cobrar</option>
        <option value="vencido">Solo vencidas</option>
        <option value="pagado">Cobradas sin verificar</option>
      </select>
    </div>

    <p v-if="errorMessage" class="info-box collections-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box collections-ok">✅ {{ successMessage }}</p>

    <div v-if="!isLoading && visible.length === 0" class="empty-state">
      <p class="empty-state-title">No hay nada que cobrar acá</p>
      <p class="empty-state-text">
        Aparecen las cuotas del cronograma mientras no estén verificadas por Finanzas.
      </p>
    </div>

    <div v-else class="data-table-wrapper collections-table-wrapper">
      <table class="data-table collections-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Cuota</th>
            <th>Vence</th>
            <th class="collections-num">Monto</th>
            <th>Estado</th>
            <th class="collections-actions-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id" :class="{ 'is-overdue-row': row.is_overdue }">
            <td>
              <span class="collections-client">{{ row.cliente || 'Sin nombre' }}</span>
              <span class="collections-contact">
                <a v-if="row.cliente_phone" :href="waLink(row.cliente_phone)" target="_blank" rel="noopener">
                  💬 {{ row.cliente_phone }}
                </a>
                <a v-if="row.cliente_email" :href="'mailto:' + row.cliente_email">✉️ {{ row.cliente_email }}</a>
              </span>
              <span v-if="row.responsable" class="collections-advisor">Responsable: {{ row.responsable }}</span>
            </td>
            <td>
              <span class="collections-code">{{ row.code || '—' }}</span>
              <span class="collections-sub">{{ row.cuota || 'Cuota' }}</span>
            </td>
            <td>
              <span class="collections-date">{{ formatDate(row.due_date) }}</span>
              <span class="collections-sub" :class="{ 'is-late': row.is_overdue }">{{ dueLabel(row) }}</span>
            </td>
            <td class="collections-num">S/ {{ money(row.monto) }}</td>
            <td>
              <span v-if="row.estado === 'pagado'" class="pill pill-success">
                Cobrada{{ row.cobrado_por ? ` por ${row.cobrado_por}` : '' }}
              </span>
              <span v-else class="pill" :class="row.is_overdue ? 'pill-danger' : 'pill-warning'">
                {{ row.is_overdue ? 'Vencida' : 'Por cobrar' }}
              </span>
              <span v-if="row.has_commission" class="collections-sub">💰 comisión registrada</span>
            </td>
            <td class="collections-actions-col">
              <button
                v-if="row.estado !== 'pagado'"
                type="button"
                class="btn-action-primary collections-btn"
                @click="openCollect(row)"
              >Marcar cobrado</button>
              <button
                v-else
                type="button"
                class="btn-action-ghost collections-btn"
                :disabled="savingId === row.id"
                title="La cuota vuelve a 'por cobrar' y se borra la comisión que generó, si todavía no se pagó"
                @click="revert(row)"
              >Deshacer</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Confirmación del cobro, con la comisión del 2% a la vista -->
    <div v-if="collecting" class="modal-overlay" @click.self="collecting = null">
      <div class="modal-content collections-modal">
        <div class="modal-header">
          <h3 class="modal-title">Registrar el cobro</h3>
          <button class="modal-close-btn" @click="collecting = null">✕</button>
        </div>
        <div class="modal-body">
          <p class="collections-modal-line">
            <strong>{{ collecting.cliente || 'Sin nombre' }}</strong> ·
            {{ collecting.code }} ({{ collecting.cuota || 'cuota' }})
          </p>
          <p class="collections-modal-amount">S/ {{ money(collecting.monto) }}</p>
          <p class="collections-modal-note">
            La cuota queda <strong>cobrada</strong> y a la espera de que Finanzas la verifique.
          </p>

          <label class="collections-check">
            <input v-model="withCommission" type="checkbox" />
            <span>
              Registrar mi comisión del 2%
              <strong>(S/ {{ money(collecting.monto * 0.02) }})</strong>
              <small>Queda como pendiente en Finanzas → Comisiones hasta que se pague.</small>
            </span>
          </label>

          <p v-if="modalError" class="info-box collections-alert">⚠️ {{ modalError }}</p>

          <div class="collections-modal-actions">
            <button type="button" class="btn-action-ghost" @click="collecting = null">Cancelar</button>
            <button type="button" class="btn-action-primary" :disabled="savingId !== null" @click="confirmCollect">
              {{ savingId !== null ? 'Registrando…' : 'Confirmar cobro' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';

const rows = ref([]);
const summary = reactive({
  pendiente: { total: 0, n: 0 },
  vencido: { total: 0, n: 0 },
  cobrado: { total: 0, n: 0 }
});
const isLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const search = ref('');
const estadoFilter = ref('');
const collecting = ref(null);
const withCommission = ref(true);
const modalError = ref('');
const savingId = ref(null);

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (estadoFilter.value === 'vencido' && !row.is_overdue) return false;
    if (estadoFilter.value === 'pendiente' && row.estado !== 'pendiente') return false;
    if (estadoFilter.value === 'pagado' && row.estado !== 'pagado') return false;
    if (!q) return true;
    return [row.cliente, row.cliente_phone, row.cliente_email, row.cliente_dni, row.code, row.cuota]
      .some((campo) => String(campo || '').toLowerCase().includes(q));
  });
});

function money(value) {
  return Number(value || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return 'Sin fecha';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year ? `${day}/${month}/${year}` : 'Sin fecha';
}

/**
 * La fecha en lenguaje llano: quien cobra decide a quién llamar hoy por esta
 * línea, no por la fecha.
 */
function dueLabel(row) {
  if (row.estado === 'pagado') return 'Esperando verificación';
  const dias = row.days_until_due;
  if (dias === null || dias === undefined) return 'Sin fecha pactada';
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  if (dias > 1) return `Faltan ${dias} días`;
  if (dias === -1) return 'Venció ayer';
  return `Venció hace ${Math.abs(dias)} días`;
}

function waLink(phone) {
  return `https://wa.me/${String(phone || '').replace(/\D/g, '')}`;
}

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/collections');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las cobranzas.');
    rows.value = data.collections || [];
    Object.assign(summary, data.summary || {});
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

function openCollect(row) {
  collecting.value = row;
  withCommission.value = true;
  modalError.value = '';
}

async function confirmCollect() {
  const row = collecting.value;
  if (!row) return;
  savingId.value = row.id;
  modalError.value = '';
  try {
    const response = await apiFetch(`/api/collections/${row.id}/collect`, {
      method: 'POST',
      body: JSON.stringify({ commission: withCommission.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo registrar el cobro.');

    successMessage.value = data.commission
      ? `Cobro registrado. Se te acreditó una comisión de S/ ${money(data.commission.monto)}.`
      : `Cobro registrado${data.commissionReason ? ` (sin comisión: ${data.commissionReason})` : ''}.`;
    setTimeout(() => { successMessage.value = ''; }, 6000);
    collecting.value = null;
    await load();
  } catch (error) {
    modalError.value = error.message;
  } finally {
    savingId.value = null;
  }
}

async function revert(row) {
  savingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/collections/${row.id}/revert`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo deshacer el cobro.');
    successMessage.value = data.removedCommissions
      ? 'Cobro deshecho; también se quitó la comisión que había generado.'
      : 'Cobro deshecho.';
    setTimeout(() => { successMessage.value = ''; }, 6000);
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.collections-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
}

.collections-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.collections-stats {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.collections-stat {
  flex: 1 1 200px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-amber);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.collections-stat.is-overdue { border-left-color: var(--accent-rose); }
.collections-stat.is-collected { border-left-color: var(--accent-emerald); }

.collections-stat-label { font-size: 0.72rem; color: var(--text-muted); }
.collections-stat-value { font-size: 1.15rem; font-weight: 700; color: var(--text-main); }
.collections-stat-note { font-size: 0.7rem; color: var(--text-muted); }

.collections-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.collections-search {
  flex: 1 1 320px;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.collections-search input {
  flex: 1;
  border: none;
  background: none;
  color: var(--text-main);
  font-size: 0.85rem;
  outline: none;
}

.collections-filter { max-width: 230px; }

.collections-alert { border-color: rgba(200, 85, 50, 0.4); background: rgba(200, 85, 50, 0.08); }
.collections-ok { border-color: rgba(46, 125, 70, 0.4); background: rgba(46, 125, 70, 0.08); }

.collections-table-wrapper { overflow-x: auto; }
.collections-table td { vertical-align: top; }
.collections-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.collections-actions-col { text-align: right; white-space: nowrap; }

.collections-client { display: block; font-weight: 600; color: var(--text-main); }
.collections-contact { display: flex; flex-direction: column; gap: 0.05rem; font-size: 0.74rem; }
.collections-contact a { color: var(--text-muted); text-decoration: none; }
.collections-contact a:hover { color: var(--primary); }
.collections-advisor { display: block; font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem; }

.collections-code { display: block; font-weight: 600; font-family: var(--font-mono, monospace); font-size: 0.8rem; }
.collections-sub { display: block; font-size: 0.72rem; color: var(--text-muted); }
.collections-sub.is-late { color: var(--accent-rose); font-weight: 600; }
.collections-date { display: block; font-size: 0.82rem; }

.is-overdue-row { background: rgba(200, 85, 50, 0.05); }

.collections-btn { padding: 0.3rem 0.65rem; font-size: 0.78rem; }

.pill-danger { background: rgba(200, 85, 50, 0.18); color: var(--accent-rose); }

.collections-modal { max-width: 460px; }
.collections-modal-line { margin: 0 0 0.25rem; font-size: 0.9rem; }
.collections-modal-amount { margin: 0 0 0.5rem; font-size: 1.6rem; font-weight: 700; color: var(--text-main); }
.collections-modal-note { margin: 0 0 0.9rem; font-size: 0.8rem; color: var(--text-muted); }

.collections-check {
  display: flex;
  gap: 0.55rem;
  align-items: flex-start;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  font-size: 0.85rem;
  cursor: pointer;
}

.collections-check small { display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.15rem; }

.collections-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

@media (max-width: 720px) {
  .collections-header { flex-direction: column; }
}
</style>
