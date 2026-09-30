<template>
  <section class="ledger-tab">
    <div class="ledger-toolbar">
      <p class="ledger-hint">Gastos fijos recurrentes del negocio. El código se genera automáticamente por día.</p>
      <button type="button" class="btn-primary ledger-add-btn" @click="isFormOpen = !isFormOpen">
        {{ isFormOpen ? '✕ Cerrar' : '+ Registrar gasto fijo' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box ledger-success">✅ {{ successMessage }}</p>

    <section v-if="isFormOpen" class="glass-panel ledger-form-panel">
      <form class="ledger-form" @submit.prevent="submit">
        <div class="ledger-form-grid">
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input v-model="form.fecha" type="date" class="form-input" required />
          </div>
          <div class="form-group">
            <label class="form-label">Concepto</label>
            <input v-model="form.concepto" type="text" class="form-input" placeholder="Ej: Alquiler de oficina" required />
          </div>
          <div class="form-group">
            <label class="form-label">Método de pago</label>
            <input v-model="form.metodoPago" type="text" class="form-input" list="fixed-metodos" placeholder="Ej: Transferencia" />
            <datalist id="fixed-metodos">
              <option value="Efectivo" />
              <option value="Transferencia" />
              <option value="Tarjeta" />
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
          {{ isSaving ? 'Guardando...' : 'Guardar gasto fijo' }}
        </button>
      </form>
    </section>

    <div v-if="isLoading" class="empty-state"><p>Cargando gastos fijos...</p></div>
    <div v-else-if="rows.length === 0" class="empty-state">
      <p class="empty-state-title">Sin gastos fijos registrados</p>
      <p class="empty-state-text">Usa "+ Registrar gasto fijo" para anotar el primero.</p>
    </div>

    <!-- Panel de control de pago mensual -->
    <section v-else class="glass-panel fx-panel">
      <div class="fx-panel-head">
        <div>
          <h3 class="fx-panel-title">Control de pagos por mes</h3>
          <p class="fx-panel-sub">
            Clic en cada celda para alternar entre pagado y pendiente.
            Clic en el nombre del servicio para ver su detalle.
          </p>
        </div>
        <div class="fx-range">
          <button
            v-for="opt in RANGE_OPTIONS"
            :key="opt"
            type="button"
            class="tab-item"
            :class="{ 'is-active': panelMonths === opt }"
            @click="setPanelRange(opt)"
          >{{ opt }} meses</button>
        </div>
      </div>

      <div class="data-table-wrapper ledger-table-wrapper">
        <table class="data-table fx-matrix">
          <thead>
            <tr>
              <th class="fx-concept-col">Servicio</th>
              <th v-for="p in panel.periods" :key="p" class="fx-month-col">{{ monthLabel(p) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="exp in panel.expenses" :key="exp.id">
              <td class="fx-concept-col">
                <button type="button" class="fx-concept-name" @click="openDetail(exp.id)">
                  {{ exp.concepto }}
                </button>
                <span v-if="exp.metodo_pago || exp.banco" class="fx-concept-meta">
                  {{ [exp.metodo_pago, exp.banco].filter(Boolean).join(' · ') }}
                </span>
              </td>
              <td v-for="p in panel.periods" :key="p" class="fx-cell">
                <button
                  type="button"
                  class="pill fx-pay-pill"
                  :class="exp.payments[p].estado === 'pagado' ? 'pill-success' : 'pill-warning'"
                  :disabled="panelSavingKey === exp.id + p"
                  :title="exp.payments[p].estado === 'pagado'
                    ? `Pagado${exp.payments[p].paid_at ? ' el ' + formatDate(exp.payments[p].paid_at) : ''}`
                    : 'Pendiente de pago'"
                  @click="togglePayment(exp, p)"
                >
                  {{ exp.payments[p].estado === 'pagado' ? '✓ Pagado' : 'Pendiente' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Modal de detalle / edición del gasto fijo -->
    <div v-if="detailExpense" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-content fx-modal">
        <div class="modal-header">
          <div>
            <h3 class="fx-modal-title">{{ editForm.concepto || detailExpense.concepto }}</h3>
            <p class="fx-modal-sub">Gasto fijo {{ detailExpense.code }}</p>
          </div>
          <button class="btn-secondary modal-close-btn" @click="closeDetail">✕ Cerrar</button>
        </div>

        <div class="modal-body">
          <p v-if="detailError" class="info-box ledger-alert">⚠️ {{ detailError }}</p>

          <form class="fx-edit-form" @submit.prevent="saveDetail">
            <div class="form-group">
              <label class="form-label">Fecha</label>
              <input v-model="editForm.fecha" type="date" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Concepto</label>
              <input v-model="editForm.concepto" type="text" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Método de pago</label>
              <input v-model="editForm.metodoPago" type="text" class="form-input" list="fixed-metodos" />
            </div>
            <div class="form-group">
              <label class="form-label">Banco</label>
              <select v-model="editForm.banco" class="form-select">
                <option value="">— Sin especificar —</option>
                <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
            <div class="form-group fx-edit-wide">
              <label class="form-label">Detalle</label>
              <textarea v-model="editForm.detalle" class="form-textarea" rows="2"></textarea>
            </div>
          </form>
        </div>

        <div class="fx-modal-footer">
          <button
            type="button"
            class="btn-secondary fx-modal-delete"
            :disabled="isDeleting || isSavingDetail"
            @click="removeRow(detailExpense.id)"
          >{{ isDeleting ? 'Eliminando…' : '🗑️ Eliminar' }}</button>
          <div class="fx-modal-footer-right">
            <button type="button" class="btn-secondary" :disabled="isSavingDetail" @click="closeDetail">Cancelar</button>
            <button
              type="button"
              class="btn-primary"
              :disabled="isSavingDetail || !isDirty"
              @click="saveDetail"
            >{{ isSavingDetail ? 'Guardando…' : 'Guardar cambios' }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { BANCOS } from './incomeOptions.js';

const RANGE_OPTIONS = [6, 12];

const isFormOpen = ref(false);
const isSaving = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

const rows = ref([]);
const panel = ref({ periods: [], expenses: [] });
const panelMonths = ref(6);
const panelSavingKey = ref(null);
const detailExpense = ref(null);
const isDeleting = ref(false);
const detailError = ref('');
const isSavingDetail = ref(false);
const editForm = reactive({ fecha: '', concepto: '', metodoPago: '', banco: '', detalle: '' });

const isDirty = computed(() => {
  const e = detailExpense.value;
  if (!e) return false;
  return (
    editForm.fecha !== (e.fecha ? String(e.fecha).slice(0, 10) : '') ||
    editForm.concepto !== (e.concepto || '') ||
    editForm.metodoPago !== (e.metodo_pago || '') ||
    editForm.banco !== (e.banco || '') ||
    editForm.detalle !== (e.detalle || '')
  );
});

const form = reactive({
  fecha: new Date().toISOString().slice(0, 10),
  concepto: '',
  metodoPago: '',
  banco: '',
  detalle: ''
});

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function monthLabel(period) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const mes = d.toLocaleDateString('es-PE', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  return `${mes} ${String(y).slice(2)}`;
}

function openDetail(expenseId) {
  const exp = rows.value.find((r) => r.id === expenseId) || null;
  detailExpense.value = exp;
  detailError.value = '';
  if (exp) {
    editForm.fecha = exp.fecha ? String(exp.fecha).slice(0, 10) : '';
    editForm.concepto = exp.concepto || '';
    editForm.metodoPago = exp.metodo_pago || '';
    editForm.banco = exp.banco || '';
    editForm.detalle = exp.detalle || '';
  }
}

function closeDetail() {
  detailExpense.value = null;
  detailError.value = '';
}

async function saveDetail() {
  if (!detailExpense.value || !isDirty.value) return;
  isSavingDetail.value = true;
  detailError.value = '';
  try {
    const response = await apiFetch(`/api/finance/fixed-expenses/${detailExpense.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editForm })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron guardar los cambios.');
    successMessage.value = 'Gasto fijo actualizado.';
    setTimeout(() => { successMessage.value = ''; }, 3000);
    closeDetail();
    await Promise.all([fetchRows(), fetchPanel()]);
  } catch (error) {
    detailError.value = error.message;
  } finally {
    isSavingDetail.value = false;
  }
}

async function fetchRows() {
  isLoading.value = true;
  try {
    const response = await apiFetch('/api/finance/fixed-expenses');
    const data = await response.json();
    // Un fallo del servidor no puede parecer "sin gastos fijos".
    if (!response.ok) throw new Error(data.error || 'No se pudieron obtener los gastos fijos.');
    rows.value = data.expenses || [];
  } catch (error) {
    errorMessage.value = error.message || 'No se pudieron obtener los gastos fijos.';
  } finally {
    isLoading.value = false;
  }
}

async function fetchPanel() {
  try {
    const response = await apiFetch(`/api/finance/fixed-expenses/panel?months=${panelMonths.value}`);
    const data = await response.json();
    if (response.ok) panel.value = data;
  } catch (error) {
    /* el panel simplemente no se muestra */
  }
}

function setPanelRange(value) {
  if (panelMonths.value === value) return;
  panelMonths.value = value;
  fetchPanel();
}

async function togglePayment(expense, period) {
  const nextEstado = expense.payments[period].estado === 'pagado' ? 'pendiente' : 'pagado';
  panelSavingKey.value = expense.id + period;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/fixed-expenses/${expense.id}/payments/${period}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nextEstado })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el pago.');
    expense.payments[period] = {
      estado: data.payment?.estado ?? nextEstado,
      paid_at: data.payment?.paid_at ?? null
    };
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    panelSavingKey.value = null;
  }
}

async function submit() {
  isSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const response = await apiFetch('/api/finance/fixed-expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo registrar el gasto fijo.');

    form.concepto = '';
    form.metodoPago = '';
    form.detalle = '';
    successMessage.value = `Gasto fijo ${data.expense?.code || ''} registrado.`;
    setTimeout(() => { successMessage.value = ''; }, 3000);
    isFormOpen.value = false;
    await Promise.all([fetchRows(), fetchPanel()]);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

async function removeRow(id) {
  if (!confirm('¿Eliminar este gasto fijo y su historial de pagos? Esta acción no se puede deshacer.')) return;
  isDeleting.value = true;
  try {
    const response = await apiFetch(`/api/finance/fixed-expenses/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el gasto fijo.');
    detailExpense.value = null;
    await Promise.all([fetchRows(), fetchPanel()]);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  fetchRows();
  fetchPanel();
});
</script>

<style scoped>
.ledger-tab { display: flex; flex-direction: column; gap: 1rem; }

.ledger-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.ledger-hint { font-size: 0.8rem; color: var(--text-muted); max-width: 640px; margin: 0; }
.ledger-add-btn { width: auto; padding: 0.55rem 1.1rem; flex-shrink: 0; }

.ledger-alert { border-color: rgba(200, 85, 50, 0.4); color: var(--accent-rose); }
.ledger-success { border-color: rgba(46, 125, 70, 0.4); color: var(--accent-emerald); }

.ledger-form-panel { padding: 1.5rem; }

.ledger-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.ledger-form-grid .form-group { margin-bottom: 0; }
.ledger-form-wide { grid-column: 1 / -1; }

.ledger-submit-btn { width: auto; padding: 0.6rem 1.5rem; margin-top: 1.25rem; }

.ledger-table-wrapper { overflow-x: auto; }
.ledger-detalle { max-width: 260px; }
.ledger-delete-btn { padding: 0.3rem 0.55rem; font-size: 0.8rem; }

.fx-panel { padding: 1.35rem 1.5rem; margin-top: 0.5rem; }

.fx-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.fx-panel-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--text-main);
  margin: 0;
}

.fx-panel-sub { font-size: 0.76rem; color: var(--text-muted); margin: 0.2rem 0 0; }

.fx-range { display: flex; gap: 0.25rem; flex-shrink: 0; }
.fx-range .tab-item { padding: 0.35rem 0.7rem; font-size: 0.8rem; }

.fx-matrix th,
.fx-matrix td { white-space: nowrap; }

.fx-concept-col {
  position: sticky;
  left: 0;
  background: var(--bg-card-solid);
  z-index: 1;
  min-width: 170px;
}

.fx-concept-name {
  display: block;
  font: inherit;
  font-weight: 600;
  color: var(--primary);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.fx-concept-name:hover { text-decoration: underline; }
.fx-concept-meta { display: block; font-size: 0.72rem; color: var(--text-muted); }

.fx-modal { max-width: 460px; }

.fx-modal-title {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.fx-modal-sub { font-size: 0.75rem; color: var(--text-muted); margin: 0.15rem 0 0; }

.modal-close-btn { padding: 0.35rem 0.8rem; flex-shrink: 0; }

.fx-edit-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.fx-edit-form .form-group { margin-bottom: 0; min-width: 0; }
.fx-edit-wide { grid-column: 1 / -1; }

.fx-modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.fx-modal-footer-right {
  display: flex;
  gap: 0.6rem;
}

.fx-modal-footer .btn-primary,
.fx-modal-footer .btn-secondary {
  width: auto;
  padding: 0.55rem 1.2rem;
}

.fx-modal-delete {
  color: var(--accent-rose);
  border-color: rgba(200, 85, 50, 0.4);
}

.fx-month-col { text-transform: capitalize; text-align: center; }
.fx-cell { text-align: center; }

.fx-pay-pill {
  cursor: pointer;
  font: inherit;
  font-size: 0.72rem;
  border: none;
  white-space: nowrap;
}

.fx-pay-pill:hover { filter: brightness(0.97); }
.fx-pay-pill:disabled { opacity: 0.6; cursor: wait; }
</style>
