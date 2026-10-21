<template>
  <section class="ledger-tab">
    <p class="ledger-hint">
      Código autogenerado por día. El monto admite valores negativos y el ITF se propone
      sobre su valor absoluto, pero se puede corregir con lo que cobró el banco. Los asientos <strong>pendientes</strong> no suman en los
      totales de arriba: solo cuenta el dinero que ya se movió, así que haz clic en el
      estado de una fila para cambiarlo.
    </p>

    <div class="ledger-controls">
      <label class="ledger-search">
        <span class="ledger-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="ledger-search-input"
          placeholder="Buscar por código, detalle, área o destino"
          aria-label="Buscar asientos"
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
        {{ isFormOpen ? (editingRow ? '✕ Cancelar edición' : '✕ Cerrar') : '+ Nuevo asiento' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box ledger-success">✅ {{ successMessage }}</p>

    <section v-if="isFormOpen" class="glass-panel ledger-form-panel">
      <h3 v-if="editingRow" class="ledger-form-title">
        Editando el asiento <strong>{{ editingRow.code }}</strong>
      </h3>
      <form class="ledger-form" @submit.prevent="submit">
        <div class="ledger-form-grid">
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input v-model="form.fecha" type="date" class="form-input" required />
          </div>
          <div class="form-group">
            <label class="form-label">Monto</label>
            <input v-model="form.monto" type="number" step="0.01" class="form-input" placeholder="Puede ser negativo" required />
          </div>
          <div class="form-group">
            <label class="form-label">Moneda</label>
            <select v-model="form.moneda" class="form-select">
              <option value="soles">Soles</option>
              <option value="dolares">Dólares</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">ITF (S/)</label>
            <input
              v-model="form.itf"
              type="number"
              step="0.01"
              min="0"
              class="form-input"
              :placeholder="formatAmount(itfSugerido)"
              @input="onItfInput"
            />
            <p v-if="itfEditado" class="ledger-receipt-hint">
              La fórmula daría S/ {{ formatAmount(itfSugerido) }}.
              <button type="button" class="ledger-inline-link" @click="usarItfSugerido">Usar ese</button>
            </p>
          </div>
          <div class="form-group">
            <label class="form-label">Banco</label>
            <select v-model="form.banco" class="form-select" required>
              <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select v-model="form.estado" class="form-select">
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Área de la empresa</label>
            <input v-model="form.area" type="text" class="form-input" list="journal-areas" placeholder="Ej: Ventas, Operaciones..." />
            <datalist id="journal-areas">
              <option value="Ventas" />
              <option value="Marketing" />
              <option value="Operaciones" />
              <option value="Administración" />
              <option value="Recursos Humanos" />
              <option value="Finanzas" />
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Asiento por destino</label>
            <input v-model="form.asientoPorDestino" type="text" class="form-input" placeholder="Ej: Gasto por servicios..." />
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Detalle</label>
            <textarea v-model="form.detalle" class="form-textarea" rows="2" placeholder="Descripción del movimiento" required></textarea>
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
              <template v-if="editingRow">
                Se añaden a los {{ editingRow.receipts?.length || 0 }} que ya tiene; para
                quitar alguno usa la ✕ de su miniatura en la tabla.
              </template>
            </p>
          </div>
        </div>

        <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
          {{ isSaving ? 'Guardando...' : (editingRow ? 'Guardar cambios' : 'Guardar asiento') }}
        </button>
      </form>
    </section>

    <div v-if="isLoading" class="empty-state"><p>Cargando libro diario...</p></div>

    <div v-else-if="rows.length === 0" class="empty-state">
      <p class="empty-state-title">Libro diario vacío</p>
      <p class="empty-state-text">Registra el primer asiento con "+ Nuevo asiento".</p>
    </div>

    <template v-else>
      <dl class="ledger-summary">
        <div class="ledger-summary-item">
          <dt>Asientos</dt>
          <dd>{{ range.total }}</dd>
        </div>
        <div class="ledger-summary-item" title="Solo asientos pagados">
          <dt>Ingresos</dt>
          <dd class="is-in">S/ {{ formatAmount(totals.ingresos) }}</dd>
        </div>
        <div class="ledger-summary-item" title="Solo asientos pagados">
          <dt>Egresos</dt>
          <dd class="is-out">S/ {{ formatAmount(totals.egresos) }}</dd>
        </div>
        <!-- El ITF también sale de la cuenta, así que el neto lo descuenta: las
             columnas de arriba son la suma de las filas y por eso no lo
             incluyen, pero "lo que quedó" sin restarlo no es lo que quedó. -->
        <div class="ledger-summary-item" title="Ingresos menos egresos ya pagados, descontando el ITF que cobró el banco">
          <dt>Neto</dt>
          <dd>S/ {{ formatAmount(totals.ingresos - totals.egresos - totals.itf) }}</dd>
        </div>
        <div class="ledger-summary-item" title="Saldo de los asientos que siguen pendientes (no entra en el neto)">
          <dt>Pendiente</dt>
          <dd class="is-pending">S/ {{ formatAmount(totals.pendiente) }}</dd>
        </div>
        <div
          class="ledger-summary-item"
          title="Solo asientos pagados. Lo que el banco cobró por esas operaciones: se descuenta en el Resumen Financiero"
        >
          <dt>ITF</dt>
          <dd>S/ {{ formatAmount(totals.itf) }}</dd>
        </div>
      </dl>

      <div v-if="paged.length === 0" class="empty-state">
        <p class="empty-state-title">Ningún asiento coincide</p>
        <p class="empty-state-text">
          Ajusta la búsqueda o los filtros para volver a ver el registro.
        </p>
        <button type="button" class="btn-secondary ledger-submit-btn" @click="clearFilters()">
          Quitar filtros
        </button>
      </div>

      <template v-else>
        <div class="data-table-wrapper ledger-table-wrapper">
          <table class="data-table ledger-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'fecha' }" @click="toggleSort('fecha')">
                    Fecha <span class="ledger-sort-caret">{{ sortCaret('fecha') }}</span>
                  </button>
                </th>
                <th>Detalle</th>
                <th class="ledger-num">
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'monto' }" @click="toggleSort('monto')">
                    Monto <span class="ledger-sort-caret">{{ sortCaret('monto') }}</span>
                  </button>
                </th>
                <th class="ledger-num">ITF</th>
                <th>Banco</th>
                <th>Estado</th>
                <th>Clasificación</th>
                <th>Comprobantes</th>
                <th class="ledger-col-actions" aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in paged"
                :key="row.id"
                :class="Number(row.monto) < 0 ? 'ledger-row-out' : 'ledger-row-in'"
              >
                <td class="ledger-code">{{ row.code }}</td>
                <td class="ledger-date">{{ formatDate(row.fecha) }}</td>
                <td>
                  <span class="ledger-detalle" :title="row.detalle">{{ row.detalle }}</span>
                </td>
                <td class="ledger-num">
                  <span class="ledger-amount-cur">{{ currencySymbol(row.moneda) }}</span>
                  <span class="ledger-amount" :class="{ 'is-negative': Number(row.monto) < 0 }">
                    {{ formatAmount(row.monto) }}
                  </span>
                </td>
                <td class="ledger-num">
                  <span v-if="Number(row.itf) > 0">{{ formatAmount(row.itf) }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>{{ row.banco }}</td>
                <td>
                  <!--
                    El estado se cambia desde la propia celda: marcar un asiento
                    como pagado es lo que más se hace en esta tabla y abrir el
                    formulario entero —con su fecha, su monto y sus
                    comprobantes— para cambiar una palabra invita a tocar de
                    paso algo que nadie quería tocar.
                  -->
                  <button
                    type="button"
                    class="pill pill-toggle"
                    :class="row.estado === 'pagado' ? 'pill-success' : 'pill-warning'"
                    :disabled="estadoSavingId === row.id"
                    :title="row.estado === 'pagado' ? 'Marcar como pendiente' : 'Marcar como pagado'"
                    @click="toggleEstado(row)"
                  >{{ row.estado }}</button>
                </td>
                <td>
                  <span v-if="row.area" class="ledger-eyebrow">{{ row.area }}</span>
                  <span class="ledger-stack-main">{{ row.asiento_por_destino || '—' }}</span>
                </td>
                <td>
                  <div class="receipt-cell">
                    <span
                      v-for="rcpt in row.receipts"
                      :key="rcpt.id"
                      class="receipt-thumb"
                      :title="receiptTitle(rcpt)"
                    >
                      <a
                        v-if="receiptUrls[rcpt.id]"
                        :href="receiptUrls[rcpt.id]"
                        target="_blank"
                        rel="noopener"
                        class="receipt-thumb-link"
                      >
                        <span v-if="isPdfReceipt(rcpt.mime_type, rcpt.original_name)" class="receipt-thumb-pdf">PDF</span>
                        <img v-else :src="receiptUrls[rcpt.id]" alt="Comprobante" />
                      </a>
                      <span v-else-if="rcpt.missing" class="receipt-thumb-missing">!</span>
                      <span v-else class="receipt-thumb-loading">…</span>
                      <button
                        type="button"
                        class="receipt-remove"
                        title="Eliminar comprobante"
                        @click="removeReceipt(rcpt.id)"
                      >✕</button>
                    </span>
                    <label class="receipt-add" title="Agregar comprobantes (imágenes o PDF)">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        hidden
                        @change="(e) => uploadReceipts(row.id, e)"
                      />
                      +
                    </label>
                  </div>
                </td>
                <td class="ledger-col-actions">
                  <div class="ledger-row-actions">
                    <button type="button" class="ledger-icon-btn" title="Editar asiento" aria-label="Editar asiento" @click="startEdit(row)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button type="button" class="ledger-icon-btn is-danger" title="Eliminar asiento" aria-label="Eliminar asiento" @click="removeRow(row.id)">
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
          noun="asientos"
        />
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { isPdfReceipt, loadReceiptUrl } from './receiptImage.js';
import { BANCOS, calcItf } from './incomeOptions.js';
import { currencySymbol, dayOnly, formatAmount, formatDate } from './format.js';
import { useLedgerTable } from './useLedgerTable.js';
import LedgerPagination from './LedgerPagination.vue';
import './ledger.css';

const props = defineProps({
  openFormTrigger: { type: Number, default: 0 }
});

// Debe coincidir con MAX_FINANCE_RECEIPTS del backend.
const MAX_RECEIPTS = 10;

const isFormOpen = ref(false);
const isSaving = ref(false);
const isLoading = ref(false);
/** La fila cuyo estado se está guardando, para no aceptar dos clics seguidos. */
const estadoSavingId = ref(null);
const errorMessage = ref('');
const successMessage = ref('');

watch(() => props.openFormTrigger, (val) => {
  if (val > 0) {
    openCreate();
  }
});

const rows = ref([]);
const receiptUrls = reactive({});
const fileInput = ref(null);
const editingRow = ref(null);
let pendingFiles = [];

const {
  search, estado: estadoFilter, banco: bancoFilter, sort, page, pageSize,
  filtered, paged, totalPages, range, toggleSort, sortCaret, clearFilters
} = useLedgerTable(rows, {
  searchText: (row) => [row.code, row.detalle, row.area, row.asiento_por_destino, row.banco]
    .filter(Boolean).join(' '),
  sorters: {
    fecha: (row) => dayOnly(row.fecha),
    monto: (row) => Number(row.monto) || 0
  },
  defaultSort: { key: 'fecha', dir: 'desc' }
});

/**
 * Totales del subconjunto que se está mirando (búsqueda y filtros incluidos),
 * solo sobre los asientos en soles: sumar monedas distintas daría una cifra
 * que no significa nada.
 *
 * Ingresos, egresos e ITF cuentan únicamente los asientos en estado "pagado":
 * un asiento pendiente es dinero que todavía no entró ni salió, así que
 * inflaría el neto. Lo pendiente se muestra aparte en su propio total.
 */
const totals = computed(() => {
  let ingresos = 0;
  let egresos = 0;
  let itf = 0;
  let pendiente = 0;
  for (const row of filtered.value) {
    if (row.moneda !== 'soles') continue;
    const monto = Number(row.monto) || 0;
    if (row.estado !== 'pagado') {
      pendiente += monto;
      continue;
    }
    if (monto >= 0) ingresos += monto;
    else egresos += -monto;
    itf += Number(row.itf) || 0;
  }
  return { ingresos, egresos, itf, pendiente };
});

/**
 * El ITF que propone la fórmula del área para el monto que se está escribiendo.
 * Es una PROPUESTA: el campo se puede corregir, porque el banco cobra lo que
 * cobra (cuentas exoneradas, traspasos entre cuentas propias, redondeos).
 * `calcItf` sale de `incomeOptions.js`, que es donde vive la fórmula para todo
 * el módulo: la copia que había acá podía quedar diciendo otra cosa.
 */
const itfSugerido = computed(() => calcItf(form.monto));

const itfEditado = computed(() => {
  if (form.itf === '' || form.itf === null) return false;
  return Math.abs(Number(form.itf) - itfSugerido.value) > 0.005;
});

/*
 * Mientras nadie toque el campo, el ITF sigue al monto (lo que hacía cuando
 * era de solo lectura). En cuanto alguien lo corrige deja de moverse solo:
 * recalcularlo por debajo le borraría la corrección a quien acaba de hacerla.
 */
const itfTocado = ref(false);

watch(
  () => form.monto,
  () => { if (!itfTocado.value) form.itf = itfSugerido.value; }
);

function onItfInput() {
  itfTocado.value = true;
}

function usarItfSugerido() {
  itfTocado.value = false;
  form.itf = itfSugerido.value;
}

function emptyForm() {
  return {
    fecha: new Date().toISOString().slice(0, 10),
    detalle: '',
    monto: '',
    // Vacío = "usá la fórmula"; se rellena solo al escribir el monto.
    itf: '',
    moneda: 'soles',
    banco: 'BCP',
    estado: 'pendiente',
    area: '',
    asientoPorDestino: ''
  };
}

const form = reactive(emptyForm());

function onFileChange(event) {
  pendingFiles = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
}

function resetForm() {
  Object.assign(form, emptyForm());
  itfTocado.value = false;
  pendingFiles = [];
  if (fileInput.value) fileInput.value.value = '';
}

/** Texto del tooltip de una miniatura, avisando si el archivo ya no está. */
function receiptTitle(rcpt) {
  const name = rcpt.original_name || 'Comprobante';
  return rcpt.missing ? `${name} — el archivo ya no está en el servidor` : name;
}

function openCreate() {
  editingRow.value = null;
  resetForm();
  isFormOpen.value = true;
}

function closeForm() {
  isFormOpen.value = false;
  editingRow.value = null;
  resetForm();
}

/** Abre el formulario con los datos del asiento para editarlo en su sitio. */
function startEdit(row) {
  editingRow.value = row;
  resetForm();
  Object.assign(form, {
    fecha: dayOnly(row.fecha),
    detalle: row.detalle || '',
    monto: row.monto ?? '',
    itf: row.itf ?? '',
    moneda: row.moneda || 'soles',
    banco: row.banco || 'BCP',
    estado: row.estado || 'pendiente',
    area: row.area || '',
    asientoPorDestino: row.asiento_por_destino || ''
  });
  // Un ITF guardado que no coincide con la fórmula se corrigió a mano: se marca
  // como tocado para que cambiar el monto no lo pise en silencio.
  itfTocado.value = Math.abs(Number(row.itf || 0) - calcItf(row.monto)) > 0.005;
  isFormOpen.value = true;
  errorMessage.value = '';
}

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

/** Solo se descargan las miniaturas de la página visible. */
async function hydrateReceipts() {
  await Promise.all(paged.value.map(async (row) => {
    await Promise.all((row.receipts || []).map(async (rcpt) => {
      // `missing` lo marca el backend: el archivo ya no está en disco, así que
      // no tiene sentido pedirlo (la fila muestra el aviso en su lugar).
      if (rcpt.missing || receiptUrls[rcpt.id]) return;
      try {
        receiptUrls[rcpt.id] = await loadReceiptUrl(`/api/finance/journal-receipts/${rcpt.id}`);
      } catch {
        rcpt.missing = true;
      }
    }));
  }));
}

watch(paged, hydrateReceipts);

async function fetchRows() {
  isLoading.value = true;
  try {
    const response = await apiFetch('/api/finance/journal');
    const data = await response.json();
    // Un fallo del servidor no puede parecer "libro diario vacío": sin este
    // aviso una tabla que no se pudo leer se ve igual que una sin asientos.
    if (!response.ok) throw new Error(data.error || 'No se pudo obtener el libro diario.');
    rows.value = data.journal || [];
    await hydrateReceipts();
  } catch (error) {
    errorMessage.value = error.message || 'No se pudo obtener el libro diario.';
  } finally {
    isLoading.value = false;
  }
}

async function submit() {
  isSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  const editing = editingRow.value;
  try {
    const fd = new FormData();
    fd.append('fecha', form.fecha);
    fd.append('detalle', form.detalle);
    fd.append('monto', form.monto);
    // Vacío viaja como cadena vacía y el servidor lo lee como "calculalo con
    // la fórmula" (`resolveItf`): un 0 escrito a mano, en cambio, se respeta.
    fd.append('itf', form.itf ?? '');
    fd.append('moneda', form.moneda);
    fd.append('banco', form.banco);
    fd.append('estado', form.estado);
    fd.append('area', form.area);
    fd.append('asientoPorDestino', form.asientoPorDestino);
    for (const file of pendingFiles) fd.append('receipts', file);

    const response = await apiFetch(
      editing ? `/api/finance/journal/${editing.id}` : '/api/finance/journal',
      { method: editing ? 'PUT' : 'POST', body: fd }
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || (editing ? 'No se pudo editar el asiento.' : 'No se pudo registrar el asiento.'));
    }

    successMessage.value = editing
      ? `Asiento ${data.journal?.code || ''} actualizado.`
      : `Asiento ${data.journal?.code || ''} registrado.`;
    setTimeout(() => { successMessage.value = ''; }, 3000);
    closeForm();
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

/**
 * Pagado ⇄ pendiente de un clic.
 *
 * Al volver, se escribe la fila que ya está en memoria en vez de recargar la
 * tabla entera: recargar devolvería al usuario al principio de la paginación y
 * volvería a descargar las miniaturas de los comprobantes, todo para cambiar
 * una palabra. Los totales de arriba se recalculan solos porque salen de
 * `filtered`.
 */
async function toggleEstado(row) {
  const siguiente = row.estado === 'pagado' ? 'pendiente' : 'pagado';
  estadoSavingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/journal/${row.id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: siguiente })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado del asiento.');
    // El estado que vale es el que devolvió el servidor, no el que se supuso.
    row.estado = data.journal?.estado ?? siguiente;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    estadoSavingId.value = null;
  }
}

async function uploadReceipts(journalId, event) {
  const files = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
  event.target.value = '';
  if (files.length === 0) return;
  errorMessage.value = '';
  try {
    const fd = new FormData();
    for (const file of files) fd.append('receipts', file);
    const response = await apiFetch(`/api/finance/journal/${journalId}/receipts`, {
      method: 'POST',
      body: fd
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo subir el comprobante.');
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function removeReceipt(receiptId) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  try {
    const response = await apiFetch(`/api/finance/journal-receipts/${receiptId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el comprobante.');
    forgetReceiptUrl(receiptId);
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function removeRow(id) {
  if (!confirm('¿Eliminar este asiento? Esta acción no se puede deshacer.')) return;
  try {
    const response = await apiFetch(`/api/finance/journal/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el asiento.');
    for (const rcpt of rows.value.find((r) => r.id === id)?.receipts || []) {
      forgetReceiptUrl(rcpt.id);
    }
    if (editingRow.value?.id === id) closeForm();
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

onMounted(fetchRows);
onBeforeUnmount(releaseUrls);
</script>
