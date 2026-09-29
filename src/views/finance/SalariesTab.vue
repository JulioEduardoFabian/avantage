<template>
  <section class="ledger-tab">
    <p class="ledger-hint">
      Pagos al personal con su fecha y su estado. Cada salario es un egreso y se registra en
      <strong>negativo</strong>. Este registro es <strong>independiente</strong> de la
      contabilidad: no aparece en el resumen financiero, en el libro diario ni en los gastos fijos.
    </p>

    <div class="ledger-controls">
      <label class="ledger-search">
        <span class="ledger-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="ledger-search-input"
          placeholder="Buscar por persona, cargo, periodo o detalle"
          aria-label="Buscar salarios"
        />
      </label>
      <select v-model="estadoFilter" class="ledger-filter" aria-label="Filtrar por estado">
        <option value="">Todo estado</option>
        <option value="pagado">Pagado</option>
        <option value="pendiente">Pendiente</option>
      </select>
      <select v-model="bancoFilter" class="ledger-filter" aria-label="Filtrar por banco">
        <option value="">Todo banco</option>
        <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
      </select>
      <button type="button" class="btn-primary ledger-add-btn" @click="isFormOpen ? closeForm() : openCreate()">
        {{ isFormOpen ? (editingRow ? '✕ Cancelar edición' : '✕ Cerrar') : '+ Registrar salario' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box ledger-success">✅ {{ successMessage }}</p>

    <section v-if="isFormOpen" class="glass-panel ledger-form-panel">
      <h3 v-if="editingRow" class="ledger-form-title">
        Editando el salario de <strong>{{ editingRow.persona }}</strong>
      </h3>
      <form class="ledger-form" @submit.prevent="submit">
        <div class="ledger-form-grid">
          <div class="form-group">
            <label class="form-label">Persona</label>
            <input v-model="form.persona" type="text" class="form-input" placeholder="Nombre completo" required />
          </div>
          <div class="form-group">
            <label class="form-label">Cargo</label>
            <input v-model="form.cargo" type="text" class="form-input" placeholder="Ej: Asesor de tesis" />
          </div>
          <div class="form-group">
            <label class="form-label">Fecha de pago</label>
            <input v-model="form.fecha" type="date" class="form-input" required />
          </div>
          <div class="form-group">
            <label class="form-label">Periodo que cubre</label>
            <input v-model="form.periodo" type="text" class="form-input" list="salary-periodos" placeholder="Ej: Setiembre 2026" />
            <datalist id="salary-periodos">
              <option v-for="p in PERIODO_SUGERIDOS" :key="p" :value="p" />
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Monto (se registra como egreso, en negativo)</label>
            <input v-model="form.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select v-model="form.estado" class="form-select">
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Moneda</label>
            <select v-model="form.moneda" class="form-select">
              <option value="soles">Soles</option>
              <option value="dolares">Dólares</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Método de pago</label>
            <input v-model="form.metodoPago" type="text" class="form-input" list="salary-metodos" placeholder="Ej: Transferencia" />
            <datalist id="salary-metodos">
              <option value="Efectivo" />
              <option value="Transferencia" />
              <option value="Yape" />
              <option value="Plin" />
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Banco</label>
            <select v-model="form.banco" class="form-select">
              <option value="">— Sin especificar —</option>
              <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Detalle</label>
            <textarea v-model="form.detalle" class="form-textarea" rows="2" placeholder="Notas adicionales (opcional)"></textarea>
          </div>
        </div>

        <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
          {{ isSaving ? 'Guardando...' : (editingRow ? 'Guardar cambios' : 'Guardar salario') }}
        </button>
      </form>
    </section>

    <div v-if="isLoading" class="empty-state"><p>Cargando salarios...</p></div>

    <div v-else-if="rows.length === 0" class="empty-state">
      <p class="empty-state-title">Sin salarios registrados</p>
      <p class="empty-state-text">Usa "+ Registrar salario" para anotar el primer pago al personal.</p>
    </div>

    <template v-else>
      <dl class="ledger-summary">
        <div class="ledger-summary-item">
          <dt>Pagos</dt>
          <dd>{{ range.total }}</dd>
        </div>
        <div class="ledger-summary-item" title="Personas distintas en lo que se está mirando">
          <dt>Personas</dt>
          <dd>{{ totals.personas }}</dd>
        </div>
        <div class="ledger-summary-item" title="Pagos que todavía no se hicieron">
          <dt>Pendientes</dt>
          <dd>{{ totals.pendientes }}</dd>
        </div>
        <div class="ledger-summary-item" title="Suma de los salarios en soles (egreso)">
          <dt>Total soles</dt>
          <dd class="is-out">S/ {{ formatAmount(totals.soles) }}</dd>
        </div>
        <div class="ledger-summary-item" title="Suma de los salarios en dólares (egreso)">
          <dt>Total dólares</dt>
          <dd class="is-out">US$ {{ formatAmount(totals.dolares) }}</dd>
        </div>
      </dl>

      <div v-if="paged.length === 0" class="empty-state">
        <p class="empty-state-title">Ningún salario coincide</p>
        <p class="empty-state-text">Ajusta la búsqueda o los filtros para volver a ver la planilla.</p>
        <button type="button" class="btn-secondary ledger-submit-btn" @click="clearFilters()">
          Quitar filtros
        </button>
      </div>

      <template v-else>
        <div class="data-table-wrapper ledger-table-wrapper">
          <table class="data-table ledger-table">
            <thead>
              <tr>
                <th>
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'persona' }" @click="toggleSort('persona')">
                    Persona <span class="ledger-sort-caret">{{ sortCaret('persona') }}</span>
                  </button>
                </th>
                <th>
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'fecha' }" @click="toggleSort('fecha')">
                    Fecha <span class="ledger-sort-caret">{{ sortCaret('fecha') }}</span>
                  </button>
                </th>
                <th>Periodo</th>
                <th class="ledger-num">
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'monto' }" @click="toggleSort('monto')">
                    Monto <span class="ledger-sort-caret">{{ sortCaret('monto') }}</span>
                  </button>
                </th>
                <th>Estado</th>
                <th>Método</th>
                <th>Banco</th>
                <th>Detalle</th>
                <th class="ledger-col-actions" aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in paged" :key="row.id">
                <td>
                  <span v-if="row.cargo" class="ledger-eyebrow">{{ row.cargo }}</span>
                  <span class="ledger-stack-main">{{ row.persona }}</span>
                </td>
                <td class="ledger-date">{{ formatDate(row.fecha) }}</td>
                <td>
                  <span v-if="row.periodo">{{ row.periodo }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td class="ledger-num salary-amount-out">
                  <span class="ledger-amount-cur">{{ currencySymbol(row.moneda) }}</span>
                  <span class="ledger-amount">{{ formatAmount(row.monto) }}</span>
                </td>
                <td>
                  <button
                    type="button"
                    class="pill salary-status-pill"
                    :class="row.estado === 'pendiente' ? 'pill-warning' : 'pill-success'"
                    :disabled="statusSavingId === row.id"
                    :title="row.estado === 'pendiente' ? 'Marcar como pagado' : 'Marcar como pendiente'"
                    @click="toggleStatus(row)"
                  >
                    {{ row.estado === 'pendiente' ? 'Pendiente' : '✓ Pagado' }}
                  </button>
                </td>
                <td>
                  <span v-if="row.metodo_pago">{{ row.metodo_pago }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>
                  <span v-if="row.banco">{{ row.banco }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>
                  <span v-if="row.detalle" class="ledger-detalle" :title="row.detalle">{{ row.detalle }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td class="ledger-col-actions">
                  <div class="ledger-row-actions">
                    <button type="button" class="ledger-icon-btn" title="Editar salario" aria-label="Editar salario" @click="startEdit(row)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button type="button" class="ledger-icon-btn is-danger" title="Eliminar salario" aria-label="Eliminar salario" @click="removeRow(row)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <LedgerPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total-pages="totalPages"
          :range="range"
          noun="pagos"
        />
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { currencySymbol, dayOnly, formatAmount, formatDate } from './format.js';
import { useLedgerTable } from './useLedgerTable.js';
import LedgerPagination from './LedgerPagination.vue';
import './ledger.css';

const props = defineProps({
  openFormTrigger: { type: Number, default: 0 }
});

const BANCOS = ['BCP', 'Interbank', 'Efectivo'];

const isFormOpen = ref(false);
const isSaving = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

const rows = ref([]);
const editingRow = ref(null);
const statusSavingId = ref(null);

watch(() => props.openFormTrigger, (val) => {
  if (val > 0) openCreate();
});

const {
  search, estado: estadoFilter, banco: bancoFilter, sort, page, pageSize,
  filtered, paged, totalPages, range, toggleSort, sortCaret, clearFilters
} = useLedgerTable(rows, {
  searchText: (row) => [row.persona, row.cargo, row.periodo, row.detalle, row.metodo_pago, row.banco]
    .filter(Boolean).join(' '),
  sorters: {
    fecha: (row) => dayOnly(row.fecha),
    persona: (row) => row.persona || '',
    // El monto se guarda en negativo: se ordena por su magnitud para que
    // "mayor primero" siga siendo el salario más alto.
    monto: (row) => Math.abs(Number(row.monto) || 0)
  },
  defaultSort: { key: 'fecha', dir: 'desc' }
});

/**
 * Totales del subconjunto que se está mirando. Cada moneda se suma por
 * separado: juntarlas daría una cifra que no significa nada.
 */
const totals = computed(() => {
  let soles = 0;
  let dolares = 0;
  let pendientes = 0;
  const personas = new Set();
  for (const row of filtered.value) {
    const monto = Number(row.monto) || 0;
    if (row.moneda === 'dolares') dolares += monto;
    else soles += monto;
    if (row.estado === 'pendiente') pendientes += 1;
    if (row.persona) personas.add(row.persona.toLowerCase());
  }
  return { soles, dolares, pendientes, personas: personas.size };
});

/** Los tres últimos meses como sugerencia de periodo, el actual primero. */
const PERIODO_SUGERIDOS = (() => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = d.toLocaleDateString('es-PE', { month: 'long' });
    out.push(`${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`);
  }
  return out;
})();

function emptyForm() {
  return {
    persona: '',
    cargo: '',
    fecha: new Date().toISOString().slice(0, 10),
    periodo: '',
    monto: '',
    moneda: 'soles',
    estado: 'pagado',
    metodoPago: '',
    banco: '',
    detalle: ''
  };
}

const form = reactive(emptyForm());

function openCreate() {
  editingRow.value = null;
  Object.assign(form, emptyForm());
  isFormOpen.value = true;
}

function closeForm() {
  isFormOpen.value = false;
  editingRow.value = null;
  Object.assign(form, emptyForm());
}

/** Abre el formulario con los datos del pago para editarlo en su sitio. */
function startEdit(row) {
  editingRow.value = row;
  Object.assign(form, {
    persona: row.persona || '',
    cargo: row.cargo || '',
    fecha: dayOnly(row.fecha),
    periodo: row.periodo || '',
    // Se edita en positivo; el servidor le vuelve a poner el signo de egreso.
    monto: row.monto != null ? Math.abs(Number(row.monto)) : '',
    moneda: row.moneda || 'soles',
    estado: row.estado || 'pagado',
    metodoPago: row.metodo_pago || '',
    banco: row.banco || '',
    detalle: row.detalle || ''
  });
  isFormOpen.value = true;
}

function flashSuccess(message) {
  successMessage.value = message;
  setTimeout(() => { successMessage.value = ''; }, 3000);
}

async function fetchRows() {
  isLoading.value = true;
  try {
    const response = await apiFetch('/api/finance/salaries');
    const data = await response.json();
    // Un fallo del servidor no puede parecer "sin salarios registrados".
    if (!response.ok) throw new Error(data.error || 'No se pudieron obtener los salarios.');
    rows.value = data.salaries || [];
  } catch (error) {
    errorMessage.value = error.message || 'No se pudieron obtener los salarios.';
  } finally {
    isLoading.value = false;
  }
}

async function submit() {
  isSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const editing = editingRow.value;
    const response = await apiFetch(
      editing ? `/api/finance/salaries/${editing.id}` : '/api/finance/salaries',
      {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el salario.');

    flashSuccess(editing
      ? `Salario de ${data.salary?.persona || 'la persona'} actualizado.`
      : `Salario de ${data.salary?.persona || 'la persona'} registrado.`);
    closeForm();
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

async function toggleStatus(row) {
  const nextEstado = row.estado === 'pendiente' ? 'pagado' : 'pendiente';
  statusSavingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/salaries/${row.id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nextEstado })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado del salario.');
    row.estado = data.salary?.estado ?? nextEstado;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    statusSavingId.value = null;
  }
}

async function removeRow(row) {
  if (!confirm(`¿Eliminar el salario de ${row.persona} del ${formatDate(row.fecha)}? Esta acción no se puede deshacer.`)) return;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/salaries/${row.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el salario.');
    if (editingRow.value?.id === row.id) closeForm();
    flashSuccess('Salario eliminado.');
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

onMounted(fetchRows);
</script>

<style scoped>
.salary-amount-out { color: #EF4444; }

.salary-status-pill {
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  border: none;
  white-space: nowrap;
}

.salary-status-pill:hover { filter: brightness(0.97); }
.salary-status-pill:disabled { opacity: 0.6; cursor: wait; }
</style>
