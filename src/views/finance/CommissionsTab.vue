<template>
  <section class="ledger-tab">
    <p class="ledger-hint">
      Dos comisiones del <strong>2%</strong>: la de la <strong>setter</strong>, por cada venta que
      el closer cerró con un lead que ella le pasó (sobre el precio total, al ganarse el lead), y la
      de <strong>cobranza</strong>, por cada cuota cobrada desde el módulo de Cobranzas (sobre lo
      que entró). Nacen solas con el 2% y acá se <strong>corrigen</strong>: el monto, la cuenta de
      la que sale el pago, su método y su comprobante. Lo marcado como pagado descuenta en el
      Resumen Financiero y en la tarjeta de <strong>esa</strong> cuenta.
    </p>

    <div class="ledger-controls">
      <label class="ledger-search">
        <span class="ledger-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="ledger-search-input"
          placeholder="Buscar por persona, cliente o tema"
          aria-label="Buscar comisiones"
        />
      </label>
      <select v-model="estadoFilter" class="ledger-filter" aria-label="Filtrar por estado">
        <option value="">Todo estado</option>
        <option value="pendiente">Por pagar</option>
        <option value="pagado">Pagada</option>
      </select>
      <select v-model="bancoFilter" class="ledger-filter" aria-label="Filtrar por banco">
        <option value="">Todo banco</option>
        <option v-for="b in bancos" :key="b" :value="b">{{ b }}</option>
        <option value="__sin">Sin cuenta</option>
      </select>
      <!--
        El rango corre sobre la fecha en que la comisión se DEVENGÓ
        (`created_at`, la columna "Registrada" de la tabla) y no sobre `paid_at`:
        esta pestaña es lo que se debe, y lo que importa de un período es qué se
        ganó en él. Cuándo se le abonó se ve en la propia píldora de estado.
      -->
      <LedgerDateRange v-model:desde="desde" v-model:hasta="hasta" noun="Fecha de devengo" />
      <button type="button" class="btn-secondary ledger-add-btn" @click="load" :disabled="isLoading">
        {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box ledger-success">✅ {{ successMessage }}</p>

    <p v-if="hasDateRange" class="ledger-range-notice">
      <span>
        Mostrando solo las comisiones devengadas <strong>{{ rangeLabel(desde, hasta) }}</strong>,
        y los dos recuadros cuentan únicamente esas.
      </span>
      <button type="button" class="ledger-range-notice-btn" @click="clearDateRange()">
        Ver todo el histórico
      </button>
    </p>

    <div class="commission-totals">
      <div class="commission-total-card">
        <span class="commission-total-label">Por pagar</span>
        <span class="commission-total-value">S/ {{ formatAmount(summary.pendiente.total) }}</span>
        <span class="commission-total-note">{{ summary.pendiente.n }} comisión(es)</span>
      </div>
      <div class="commission-total-card is-paid">
        <span class="commission-total-label">Ya pagado</span>
        <span class="commission-total-value">S/ {{ formatAmount(summary.pagado.total) }}</span>
        <span class="commission-total-note">{{ summary.pagado.n }} comisión(es)</span>
      </div>
    </div>

    <!--
      No hay botón de "+ nueva comisión" a propósito: una comisión nace de una
      venta ganada o de una cuota cobrada, y una cargada a mano no tendría de
      qué colgar. Lo que sí se corrige es su pago, con este formulario — el
      mismo que se abre con el lápiz de cada fila.
    -->
    <section v-if="editingRow" ref="formPanel" class="glass-panel ledger-form-panel">
      <h3 class="ledger-form-title">
        Comisión de <strong>{{ editingRow.beneficiario }}</strong>
        <span class="ledger-muted">
          · {{ ROLE_LABEL[editingRow.role] || editingRow.role }} ·
          base S/ {{ formatAmount(editingRow.base_amount) }}
        </span>
      </h3>
      <form class="ledger-form" @submit.prevent="submit">
        <div class="ledger-form-grid">
          <div class="form-group">
            <label class="form-label">Monto de la comisión (S/) *</label>
            <input v-model="form.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
            <!-- El % no se pide: se deriva del monto sobre la base de esa
                 venta, y lo recalcula el servidor al guardar. Pedirlo además
                 del monto son dos campos que pueden decir cosas distintas. -->
            <p v-if="formPercent != null" class="ledger-receipt-hint">
              Es el {{ formPercent }}% de la base. El porcentaje de la tabla se recalcula al guardar.
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select v-model="form.estado" class="form-select">
              <option value="pendiente">Por pagar</option>
              <option value="pagado">Pagada</option>
            </select>
          </div>
          <!-- La fecha del pago es la que fecha el egreso en el Resumen: una
               comisión de una venta de agosto pagada en octubre salió de caja
               en octubre. Solo tiene sentido si ya se pagó. -->
          <div class="form-group">
            <label class="form-label">Fecha del pago</label>
            <input
              v-model="form.paidAt"
              type="date"
              class="form-input"
              :disabled="form.estado !== 'pagado'"
            />
            <p v-if="form.estado !== 'pagado'" class="ledger-receipt-hint">
              Se guarda cuando la marques como pagada.
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Método de pago</label>
            <input v-model="form.metodoPago" type="text" class="form-input" list="commission-metodos" placeholder="Ej: Transferencia" />
            <datalist id="commission-metodos">
              <option value="Efectivo" />
              <option value="Transferencia" />
              <option value="Yape" />
              <option value="Plin" />
            </datalist>
          </div>
          <!-- La cuenta de la que sale el pago. De esto cuelga que el egreso
               reste en la tarjeta de ESA cuenta del Resumen y no en el cajón
               "Sin cuenta", que es lo que hacía que el saldo de una cuenta
               dijera más de lo que hay. -->
          <div class="form-group">
            <label class="form-label">Banco del que sale</label>
            <select v-model="form.banco" class="form-select">
              <option value="">— Sin especificar —</option>
              <option v-for="b in bancos" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Detalle</label>
            <input v-model="form.detalle" type="text" class="form-input" placeholder="Opcional" />
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Comprobantes (imágenes o PDF, opcional)</label>
            <input
              ref="fileInput"
              type="file"
              accept="image/*,application/pdf"
              multiple
              class="form-input"
              @change="onFileChange"
            />
            <p class="ledger-receipt-hint">
              Puedes seleccionar varios archivos a la vez (hasta {{ MAX_RECEIPTS }}).
              Se añaden a los {{ editingRow.receipts?.length || 0 }} que ya tiene; para quitar
              alguno usa la ✕ de su miniatura en la tabla.
            </p>
          </div>
        </div>
        <div class="commission-form-actions">
          <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
            {{ isSaving ? 'Guardando...' : 'Guardar cambios' }}
          </button>
          <button type="button" class="btn-action-ghost" @click="closeForm">Cancelar</button>
        </div>
      </form>
    </section>

    <AppLoader
      v-if="isLoading"
      variant="table"
      icon="💰"
      title="Cargando comisiones…"
      subtitle="Consultando comisiones devengadas de setters y cobranzas."
    />

    <div v-else-if="visible.length === 0" class="empty-state">
      <p class="empty-state-title">
        {{ rows.length === 0 ? 'Todavía no hay comisiones' : 'Ninguna comisión coincide' }}
      </p>
      <p v-if="rows.length === 0" class="empty-state-text">
        La de la setter nace sola al ganarse un lead que pasó por el Setter Funnel y tiene precio
        total registrado; la de cobranza, al marcar una cuota como cobrada en Cobranzas.
      </p>
      <p v-else class="empty-state-text">
        <template v-if="hasDateRange">
          No se devengó ninguna comisión {{ rangeLabel(desde, hasta) }}.
        </template>
        Ajusta la búsqueda o los filtros para volver a ver el registro.
      </p>
    </div>

    <div v-else class="data-table-wrapper ledger-table-wrapper">
      <table class="data-table ledger-table">
        <thead>
          <tr>
            <th>Para</th>
            <th>Venta</th>
            <th class="ledger-num">Base</th>
            <th class="ledger-num">%</th>
            <th class="ledger-num">Comisión</th>
            <th>Estado</th>
            <th>Banco</th>
            <th>Comprobantes</th>
            <th>Registrada</th>
            <th class="ledger-col-actions" aria-label="Acciones"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id">
            <td>
              <span class="ledger-eyebrow">{{ ROLE_LABEL[row.role] || row.role }}</span>
              <span class="ledger-stack-main">{{ row.beneficiario }}</span>
            </td>
            <td>
              <span class="ledger-stack-main">{{ row.cliente || 'Sin nombre' }}</span>
              <span class="ledger-eyebrow">
                <template v-if="row.income_code">Cobro de {{ row.income_code }} · {{ row.income_cuota || 'cuota' }}</template>
                <template v-else>Venta completa · Lead #{{ row.lead_id }}</template>
              </span>
            </td>
            <td class="ledger-num"><span class="ledger-amount">{{ formatAmount(row.base_amount) }}</span></td>
            <td class="ledger-num">{{ Number(row.percent) }}%</td>
            <td class="ledger-num"><strong class="ledger-amount">{{ formatAmount(row.monto) }}</strong></td>
            <td>
              <button
                type="button"
                class="pill pill-toggle"
                :class="row.estado === 'pendiente' ? 'pill-warning' : 'pill-success'"
                :disabled="savingId === row.id"
                :title="row.estado === 'pendiente' ? 'Marcar como pagada' : 'Volver a por pagar'"
                @click="toggleEstado(row)"
              >
                {{ row.estado === 'pendiente' ? 'Por pagar' : paidLabel(row) }}
              </button>
            </td>
            <td>
              <span v-if="row.banco">{{ row.banco }}</span>
              <span v-else class="ledger-muted">—</span>
              <span v-if="row.metodo_pago" class="ledger-eyebrow">{{ row.metodo_pago }}</span>
            </td>
            <td>
              <ReceiptCell
                :receipts="row.receipts"
                :urls="receiptUrls"
                @upload="(e) => uploadReceipts(row.id, e)"
                @remove="removeReceipt"
              />
            </td>
            <td class="ledger-date">{{ formatDate(row.created_at) }}</td>
            <td class="ledger-col-actions">
              <div class="ledger-row-actions">
                <button type="button" class="ledger-icon-btn" title="Editar comisión" aria-label="Editar comisión" @click="startEdit(row)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { dayOnly, formatAmount, formatDate } from './format.js';
import { inDateRange, rangeLabel } from './dateRange.js';
import { bancos } from './incomeOptions.js';
import { loadReceiptUrl } from './receiptImage.js';
import LedgerDateRange from './LedgerDateRange.vue';
import ReceiptCell from './ReceiptCell.vue';
import AppLoader from '../../components/AppLoader.vue';
import './ledger.css';

/* De dónde sale cada comisión: la de la setter es por venta, la de cobranza
   por cuota cobrada. */
const ROLE_LABEL = { setter: 'Setter', cobranza: 'Cobranza' };

// Debe coincidir con MAX_FINANCE_RECEIPTS del backend.
const MAX_RECEIPTS = 10;

const rows = ref([]);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const savingId = ref(null);
const search = ref('');
const estadoFilter = ref('');
const bancoFilter = ref('');
const desde = ref('');
const hasta = ref('');

/** Las miniaturas de los comprobantes, id → object URL del blob. */
const receiptUrls = reactive({});
/** La comisión que se está corrigiendo; null = el formulario está cerrado. */
const editingRow = ref(null);
const formPanel = ref(null);
const fileInput = ref(null);
let pendingFiles = [];

const form = reactive({
  monto: '',
  estado: 'pendiente',
  paidAt: '',
  metodoPago: '',
  banco: '',
  detalle: ''
});

const hasDateRange = computed(() => Boolean(desde.value || hasta.value));

function clearDateRange() {
  desde.value = '';
  hasta.value = '';
}

/**
 * "Pagada" con su fecha, cuando la hay. Se comprueba el dato crudo y no lo que
 * devuelve `formatDate()`: ese escribe un guión cuando no hay fecha, y la
 * píldora terminaba diciendo "Pagada —".
 */
function paidLabel(row) {
  return dayOnly(row.paid_at) ? `Pagada ${formatDate(row.paid_at)}` : 'Pagada';
}

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (estadoFilter.value && row.estado !== estadoFilter.value) return false;
    // "Sin cuenta" es una opción del filtro y no la ausencia de filtro: las
    // comisiones de antes de que existiera la columna son justo las que hay
    // que encontrar para completarles de dónde salió el pago.
    if (bancoFilter.value === '__sin') {
      if (row.banco) return false;
    } else if (bancoFilter.value && row.banco !== bancoFilter.value) {
      return false;
    }
    // `created_at` es un `timestamp` y no una columna `DATE`, así que su día
    // se recorta del tramo ISO igual que lo hace la columna "Registrada" de la
    // tabla (`formatDate`): el filtro y lo que se ve en pantalla tienen que
    // partir el día por el mismo lado.
    if (!inDateRange(row.created_at, desde.value, hasta.value)) return false;
    if (!q) return true;
    return [row.beneficiario, row.cliente, row.tema, row.detalle, row.banco, row.metodo_pago]
      .some((campo) => String(campo || '').toLowerCase().includes(q));
  });
});

/**
 * Los dos recuadros se calculan sobre lo que se está mirando y ya no se leen
 * del `summary` que manda el servidor: ese cuenta el histórico entero, así que
 * con un rango de fechas puesto decía una cifra que no es la suma de ninguna
 * de las filas de abajo. Es el mismo criterio que la tira de totales de las
 * otras tres pestañas del libro (ver `useLedgerTable`), y acá no cuesta nada
 * porque `/api/commissions` ya devuelve todas las filas de una vez.
 */
const summary = computed(() => {
  const acumular = (estado) => {
    const filas = visible.value.filter((row) => row.estado === estado);
    return {
      // Sin valor absoluto, igual que `commissionService.summary()`: el monto de
      // una comisión se guarda en positivo, y "corregirlo" acá haría que las dos
      // mitades del sistema dejaran de contar lo mismo si alguna vez no lo fuera.
      total: filas.reduce((suma, row) => suma + (Number(row.monto) || 0), 0),
      n: filas.length
    };
  };
  return { pendiente: acumular('pendiente'), pagado: acumular('pagado') };
});

/** El % que representa lo que se está escribiendo, mientras se escribe. */
const formPercent = computed(() => {
  const base = Math.abs(Number(editingRow.value?.base_amount) || 0);
  const monto = Number(form.monto) || 0;
  if (!base || monto <= 0) return null;
  return Math.round((monto / base) * 10000) / 100;
});

function flashSuccess(message) {
  successMessage.value = message;
  setTimeout(() => { successMessage.value = ''; }, 3000);
}

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/commissions');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las comisiones.');
    rows.value = data.commissions || [];
    await hydrateReceipts();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

/* -------------------------- Comprobantes del pago ------------------------- */

function releaseUrls() {
  for (const key of Object.keys(receiptUrls)) {
    URL.revokeObjectURL(receiptUrls[key]);
    delete receiptUrls[key];
  }
}

function forgetReceiptUrl(id) {
  if (receiptUrls[id]) {
    URL.revokeObjectURL(receiptUrls[id]);
    delete receiptUrls[id];
  }
}

/** Solo las miniaturas de las filas que se están viendo. */
async function hydrateReceipts() {
  await Promise.all(visible.value.map(async (row) => {
    await Promise.all((row.receipts || []).map(async (rcpt) => {
      // `missing` lo marca el backend: el archivo ya no está en disco, así que
      // no tiene sentido pedirlo (la celda muestra el aviso en su lugar).
      if (rcpt.missing || receiptUrls[rcpt.id]) return;
      try {
        receiptUrls[rcpt.id] = await loadReceiptUrl(`/api/commission-receipts/${rcpt.id}`);
      } catch {
        rcpt.missing = true;
      }
    }));
  }));
}

watch(visible, hydrateReceipts);
onBeforeUnmount(releaseUrls);

async function uploadReceipts(commissionId, event) {
  const files = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
  event.target.value = '';
  if (files.length === 0) return;
  errorMessage.value = '';
  try {
    const fd = new FormData();
    for (const file of files) fd.append('receipts', file);
    const response = await apiFetch(`/api/commissions/${commissionId}/receipts`, { method: 'POST', body: fd });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo subir el comprobante.');
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function removeReceipt(receiptId) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  try {
    const response = await apiFetch(`/api/commission-receipts/${receiptId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el comprobante.');
    forgetReceiptUrl(receiptId);
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

/* ----------------------------- Edición del pago --------------------------- */

function onFileChange(event) {
  pendingFiles = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
}

async function startEdit(row) {
  editingRow.value = row;
  pendingFiles = [];
  if (fileInput.value) fileInput.value.value = '';
  errorMessage.value = '';
  Object.assign(form, {
    monto: row.monto != null ? String(Math.abs(Number(row.monto))) : '',
    estado: row.estado || 'pendiente',
    // Si todavía no se pagó, se propone hoy: es la fecha que el servidor va a
    // poner igual al marcarla pagada, y así se puede corregir antes de guardar.
    paidAt: dayOnly(row.paid_at) || new Date().toISOString().slice(0, 10),
    metodoPago: row.metodo_pago || '',
    banco: row.banco || '',
    detalle: row.detalle || ''
  });
  // El formulario se abre arriba de la tabla: con la fila más abajo, sin
  // desplazarse parece que el lápiz no hizo nada.
  await nextTick();
  formPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeForm() {
  editingRow.value = null;
  pendingFiles = [];
  if (fileInput.value) fileInput.value.value = '';
}

async function submit() {
  const editing = editingRow.value;
  if (!editing || !(Number(form.monto) > 0)) return;
  isSaving.value = true;
  errorMessage.value = '';
  try {
    // Multipart y no JSON: el mismo envío lleva los comprobantes adjuntos.
    const fd = new FormData();
    fd.append('monto', String(Number(form.monto)));
    fd.append('estado', form.estado);
    if (form.estado === 'pagado') fd.append('paidAt', form.paidAt || '');
    fd.append('metodoPago', form.metodoPago);
    fd.append('banco', form.banco);
    fd.append('detalle', form.detalle);
    for (const file of pendingFiles) fd.append('receipts', file);

    const response = await apiFetch(`/api/commissions/${editing.id}`, { method: 'PUT', body: fd });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la comisión.');
    flashSuccess(`Comisión de ${data.commission?.beneficiary_name || 'la persona'} actualizada.`);
    closeForm();
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

/**
 * Marcar pagada desde la píldora no abre el formulario: deja constancia de que
 * ya se le abonó, con la fecha de hoy. La cuenta, el método y el comprobante se
 * completan con el lápiz, y por eso la píldora no los toca.
 */
async function toggleEstado(row) {
  savingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/commissions/${row.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: row.estado === 'pendiente' ? 'pagado' : 'pendiente' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado.');
    Object.assign(row, data.commission);
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
.commission-totals {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  flex-wrap: wrap;
}

.commission-total-card {
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-amber);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.commission-total-card.is-paid { border-left-color: var(--accent-emerald); }

.commission-total-label { font-size: 0.72rem; color: var(--text-muted); }
.commission-total-value { font-size: 1.1rem; font-weight: 700; color: var(--text-main); }
.commission-total-note { font-size: 0.7rem; color: var(--text-muted); }

.commission-form-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
</style>
