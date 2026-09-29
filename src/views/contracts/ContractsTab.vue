<template>
  <section>
    <p v-if="errorMessage" class="info-box ct-alert">⚠️ {{ errorMessage }}</p>

    <div class="ct-layout">
      <!-- Lista + nuevo contrato -->
      <aside class="glass-panel ct-sidebar">
        <form class="ct-new" @submit.prevent="createContract">
          <h3 class="ct-panel-title">Nuevo contrato</h3>
          <div class="form-group">
            <label class="form-label">Cliente del funnel</label>
            <select v-model="newContract.leadId" class="form-select" required>
              <option value="" disabled>Selecciona un cliente…</option>
              <option v-for="lead in clientLeads" :key="lead.id" :value="lead.id">
                {{ lead.full_name || lead.phone || `Lead #${lead.id}` }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de contrato</label>
            <select v-model="newContract.templateId" class="form-select" required>
              <option value="" disabled>{{ templates.length ? 'Selecciona un tipo…' : 'Crea un tipo en "Tipos de contrato"' }}</option>
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
          </div>
          <button type="submit" class="btn-primary ct-full" :disabled="isCreating || !newContract.leadId || !newContract.templateId">
            {{ isCreating ? 'Creando…' : '+ Crear contrato' }}
          </button>
        </form>

        <div class="ct-list-head">
          <h3 class="ct-panel-title">Contratos ({{ filteredContracts.length }})</h3>
          <input v-model="search" type="search" class="form-input" placeholder="Buscar por cliente o número…" />
        </div>

        <div v-if="isLoading" class="empty-state"><p>Cargando…</p></div>
        <div v-else-if="filteredContracts.length === 0" class="empty-state">
          <p class="empty-state-title">Sin contratos</p>
          <p class="empty-state-text">Crea el primero desde el formulario de arriba.</p>
        </div>
        <ul v-else class="ct-list">
          <li v-for="c in filteredContracts" :key="c.id">
            <button type="button" class="ct-item" :class="{ 'is-active': editing?.id === c.id }" @click="selectContract(c.id)">
              <span class="ct-item-number">{{ contractNumber(c) }}</span>
              <span class="ct-item-client">{{ c.client_name || c.lead_name || 'Sin cliente' }}</span>
              <span class="ct-status" :class="`is-${c.status}`">{{ STATUS_LABELS[c.status] }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- Editor -->
      <section v-if="editing" class="glass-panel ct-editor">
        <div class="ct-toolbar">
          <div>
            <span class="ct-item-number">{{ contractNumber(editing) }}</span>
            <span v-if="isDirty" class="ct-dirty">● Cambios sin guardar</span>
          </div>
          <div class="ct-actions">
            <button type="button" class="btn-secondary" :disabled="isSaving" @click="openDocument">🖨️ Imprimir / PDF</button>
            <button type="button" class="btn-primary" :disabled="isSaving || !isDirty" @click="save">
              {{ isSaving ? 'Guardando…' : 'Guardar' }}
            </button>
            <button type="button" class="btn-secondary ct-danger" :disabled="isSaving" @click="remove">Eliminar</button>
          </div>
        </div>

        <div class="ct-grid">
          <div class="form-group ct-wide">
            <label class="form-label">Título del contrato</label>
            <input v-model="editing.title" class="form-input" />
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select v-model="editing.status" class="form-select">
              <option v-for="(label, key) in STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
        </div>

        <h3 class="ct-section-title">Datos de las partes</h3>
        <div class="ct-grid">
          <div class="form-group"><label class="form-label">Cliente</label><input v-model="editing.client_name" class="form-input" /></div>
          <div class="form-group"><label class="form-label">DNI</label><input v-model="editing.client_dni" class="form-input" /></div>
          <div class="form-group ct-wide"><label class="form-label">Domicilio</label><input v-model="editing.client_address" class="form-input" /></div>
          <div class="form-group"><label class="form-label">Correo</label><input v-model="editing.client_email" type="email" class="form-input" /></div>
          <div class="form-group"><label class="form-label">Teléfono</label><input v-model="editing.client_phone" class="form-input" /></div>
          <div class="form-group"><label class="form-label">Representante de la empresa</label><input v-model="editing.representative_name" class="form-input" placeholder="Por defecto: Julio Fabián Ninamango, Gerente General" /></div>
          <div class="form-group"><label class="form-label">Ciudad</label><input v-model="editing.city" class="form-input" /></div>
          <div class="form-group"><label class="form-label">Fecha del contrato</label><input v-model="editing.contract_date" type="date" class="form-input" /></div>
          <div class="form-group">
            <label class="form-label">Monto total</label>
            <div class="ct-amount-row">
              <select v-model="editing.currency" class="form-select"><option value="PEN">S/</option><option value="USD">US$</option></select>
              <input v-model="editing.total_amount" type="number" min="0" step="0.01" class="form-input" />
            </div>
          </div>
          <div class="form-group"><label class="form-label">Universidad</label><input v-model="editing.university" class="form-input" placeholder="Aparece en la cláusula primera" /></div>
          <div class="form-group"><label class="form-label">Carrera o mención</label><input v-model="editing.career" class="form-input" placeholder="Aparece en la cláusula primera" /></div>
          <div class="form-group ct-wide">
            <label class="form-label">Servicio contratado</label>
            <textarea v-model="editing.service_description" class="form-textarea" rows="2"></textarea>
          </div>
        </div>

        <h3 class="ct-section-title">
          Cronograma de pagos
          <span v-if="!editing.lead_id" class="ct-section-note">— disponible solo en contratos asociados a un cliente del funnel</span>
        </h3>
        <PaymentScheduleEditor
          v-if="editing.lead_id"
          v-model="installments"
          :total="totalNumber"
          :currency="editing.currency"
        />
        <p v-if="editing.lead_id" class="ct-schedule-note">
          Son las mismas cuotas que Finanzas cobra y que el cliente ve en su portal: lo que se
          pacte acá se aplica al guardar. Una cuota ya cobrada queda bloqueada.
          Escribe <code v-pre>{{cronograma_pagos}}</code> en una cláusula para imprimir esta tabla.
        </p>

        <h3 class="ct-section-title">Cronograma de entregas</h3>
        <DeliveryScheduleEditor v-model="deliverables" />
        <p class="ct-schedule-note">
          Las entregas pactadas con el cliente. A diferencia de las cuotas, viven solo en el
          contrato: no pasan por Finanzas.
          Escribe <code v-pre>{{cronograma_entregas}}</code> en una cláusula para imprimir esta tabla.
        </p>

        <details class="ct-details">
          <summary>Apertura y cierre del contrato</summary>
          <div class="form-group">
            <label class="form-label">Apertura (comparecencia de las partes)</label>
            <textarea v-model="editing.intro" class="form-textarea" rows="5"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Cierre</label>
            <textarea v-model="editing.closing" class="form-textarea" rows="3"></textarea>
          </div>
        </details>

        <h3 class="ct-section-title">Cláusulas ({{ editing.clauses.length }})</h3>
        <ClauseEditor v-model="editing.clauses" :suggestions="templateClauses" />
      </section>

      <section v-else class="glass-panel ct-editor empty-state">
        <p class="empty-state-title">Selecciona o crea un contrato</p>
        <p class="empty-state-text">Aquí podrás editar sus datos y cláusulas antes de imprimirlo.</p>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onActivated, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../../apiClient.js';
import ClauseEditor from '../../components/ClauseEditor.vue';
import PaymentScheduleEditor from '../../components/PaymentScheduleEditor.vue';
import DeliveryScheduleEditor from '../../components/DeliveryScheduleEditor.vue';
import { contractNumber, request, stripKeys, withKeys } from './contractsApi.js';

const STATUS_LABELS = { borrador: 'Borrador', firmado: 'Firmado', anulado: 'Anulado' };
// Campos del contrato: [columna en la API de lectura, campo en el PUT].
const FIELDS = [
  ['title', 'title'], ['status', 'status'], ['client_name', 'clientName'], ['client_dni', 'clientDni'],
  ['client_address', 'clientAddress'], ['client_email', 'clientEmail'], ['client_phone', 'clientPhone'],
  ['service_description', 'serviceDescription'], ['university', 'university'], ['career', 'career'],
  ['total_amount', 'totalAmount'], ['currency', 'currency'],
  ['city', 'city'], ['contract_date', 'contractDate'], ['representative_name', 'representativeName'],
  ['intro', 'intro'], ['closing', 'closing']
];

const route = useRoute();
const contracts = ref([]);
const clientLeads = ref([]);
const templates = ref([]);
const editing = ref(null);
const installments = ref([]);
const deliverables = ref([]);
const savedSnapshot = ref('');
const search = ref('');
const newContract = ref({ leadId: route.query.leadId ? Number(route.query.leadId) : '', templateId: '' });
const isLoading = ref(true);
const isCreating = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');

const snapshot = (c) => JSON.stringify([FIELDS.map(([col]) => c[col] ?? ''), stripKeys(c.clauses), schedulePayload()]);
const isDirty = computed(() => !!editing.value && snapshot(editing.value) !== savedSnapshot.value);

const totalNumber = computed(() => {
  const value = Number(editing.value?.total_amount);
  return Number.isFinite(value) && value > 0 ? value : null;
});

/**
 * Las cuotas se mandan como las espera la API: `id` para actualizar la cuota
 * existente, sin `id` para crear una nueva. Las bloqueadas (ya cobradas) viajan
 * igual, para que el backend sepa que NO se están quitando del cronograma.
 */
function schedulePayload() {
  return installments.value.map((row) => ({
    id: row.id || undefined,
    monto: Number(row.monto) || 0,
    dueDate: row.dueDate
  }));
}

/**
 * Las entregas se reemplazan enteras en cada guardado (no hay `id` que
 * conservar): el orden de la lista es el orden en que se imprimen, y el
 * backend descarta las filas sin descripción.
 */
function deliverablesPayload() {
  return deliverables.value.map((row) => ({
    dueDate: row.dueDate || null,
    avance: row.avance || ''
  }));
}

const filteredContracts = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return contracts.value;
  return contracts.value.filter((c) =>
    [contractNumber(c), c.client_name, c.lead_name].some((v) => String(v || '').toLowerCase().includes(q)));
});

const templateClauses = computed(() =>
  templates.value.find((t) => t.id === editing.value?.template_id)?.clauses || []);

async function run(task) {
  errorMessage.value = '';
  try {
    return await task();
  } catch (err) {
    errorMessage.value = err.message;
    return null;
  }
}

function load(contract) {
  editing.value = { ...contract, clauses: withKeys(contract.clauses) };
  installments.value = (contract.installments || []).map((row) => ({
    id: row.id,
    monto: String(row.monto),
    dueDate: (row.due_date || row.fecha || '').slice(0, 10),
    // Una cuota con comprobante o verificada ya no se reprograma desde acá:
    // el dinero entró y el asiento tiene que seguir cuadrando con el banco.
    locked: row.estado !== 'pendiente' || (row.receipts || []).length > 0,
    estado: row.estado
  }));
  deliverables.value = (contract.deliverables || []).map((row) => ({
    dueDate: (row.due_date || '').slice(0, 10),
    avance: row.avance || ''
  }));
  savedSnapshot.value = snapshot(editing.value);
}

async function refreshList() {
  contracts.value = await request('/api/contracts');
}

async function loadTemplates() {
  templates.value = await request('/api/contract-templates');
  if (!templates.value.some((t) => t.id === newContract.value.templateId)) {
    newContract.value.templateId = templates.value[0]?.id || '';
  }
}

function confirmDiscard() {
  return !isDirty.value || confirm('Hay cambios sin guardar en el contrato actual. ¿Descartarlos?');
}

async function selectContract(id) {
  if (editing.value?.id === id || !confirmDiscard()) return;
  await run(async () => load(await request(`/api/contracts/${id}`)));
}

async function createContract() {
  if (!confirmDiscard()) return;
  isCreating.value = true;
  await run(async () => {
    load(await request('/api/contracts', { method: 'POST', body: JSON.stringify(newContract.value) }));
    await refreshList();
  });
  isCreating.value = false;
}

async function save() {
  isSaving.value = true;
  const ok = await run(async () => {
    const payload = Object.fromEntries(FIELDS.map(([col, field]) => [field, editing.value[col]]));
    payload.clauses = stripKeys(editing.value.clauses);
    if (editing.value.lead_id) payload.installments = schedulePayload();
    payload.deliverables = deliverablesPayload();
    load(await request(`/api/contracts/${editing.value.id}`, { method: 'PUT', body: JSON.stringify(payload) }));
    await refreshList();
    return true;
  });
  isSaving.value = false;
  return !!ok;
}

async function remove() {
  if (!confirm(`¿Eliminar el contrato ${contractNumber(editing.value)}? Esta acción no se puede deshacer.`)) return;
  await run(async () => {
    await request(`/api/contracts/${editing.value.id}`, { method: 'DELETE' });
    editing.value = null;
    await refreshList();
  });
}

/**
 * Abre el documento A4 en una pestaña nueva. La pestaña se abre ANTES de la
 * llamada a la API (en el mismo clic) para que el navegador no la bloquee
 * como ventana emergente; si hay cambios sin guardar, se guardan primero
 * para que el documento refleje lo que se ve en pantalla.
 */
async function openDocument() {
  const win = window.open('', '_blank');
  if (isDirty.value && !(await save())) {
    win?.close();
    return;
  }
  await run(async () => {
    const response = await apiFetch(`/api/contracts/${editing.value.id}/document`);
    if (!response.ok) throw new Error('No se pudo generar el documento.');
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/html' }));
    if (win) {
      win.location.href = url;
    } else {
      // El navegador bloqueó la pestaña: se descarga el archivo.
      const link = document.createElement('a');
      link.href = url;
      link.download = `${contractNumber(editing.value)}.html`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}

onMounted(async () => {
  await run(async () => {
    [clientLeads.value] = await Promise.all([request('/api/contracts/client-leads'), loadTemplates(), refreshList()]);
  });
  isLoading.value = false;
});

// Al volver desde "Tipos de contrato" se recargan los tipos (pudieron cambiar).
let firstActivation = true;
onActivated(() => {
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  run(loadTemplates);
});
</script>
