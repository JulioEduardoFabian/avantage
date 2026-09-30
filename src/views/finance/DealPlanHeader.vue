<template>
  <div class="deal-plan-card" :class="{ 'is-collapsed': collapsed }">
    <!-- Main Header Bar -->
    <div class="deal-header-main">
      <!-- Toggle chevron -->
      <button
        type="button"
        class="deal-toggle-btn"
        :aria-expanded="!collapsed"
        :title="collapsed ? 'Ver las cuotas de este cierre' : 'Ocultar las cuotas'"
        @click="emit('toggle')"
      >
        <span class="deal-caret" :class="{ 'is-open': !collapsed }">▸</span>
      </button>

      <!-- Client Details -->
      <div class="deal-client-block" @click="emit('toggle')">
        <div class="deal-badges-row">
          <span class="deal-code-badge" title="Código de cliente">{{ group.code }}</span>
          <span v-if="group.leadDni" class="deal-dni-badge">DNI {{ group.leadDni }}</span>
          <span class="deal-cuotas-badge">{{ group.payments.length }} {{ group.payments.length === 1 ? 'cuota' : 'cuotas' }}</span>
          <span v-if="blockingPayment" class="deal-gate-badge" title="La 1ra cuota no está verificada">
            🔒 Proyecto bloqueado
          </span>
        </div>
        <div class="deal-name-line">
          <span class="deal-client-name">{{ group.leadName }}</span>
          <button
            v-if="group.leadId"
            type="button"
            class="deal-contact-btn"
            title="Ver y editar datos del cliente (nombre, DNI, correo)"
            @click.stop="showContact = true"
          >
            👤
          </button>
        </div>
      </div>

      <!-- Financial Progress Block -->
      <div v-if="group.leadId" class="deal-financial-block">
        <!--
          Con el filtro de banco puesto el bloque no habla del trato completo
          sino de lo que entró por esa cuenta: el precio total no se reparte
          entre bancos, así que se sustituye por lo cobrado ahí.
        -->
        <div v-if="group.bankScope" class="deal-price-row">
          <span class="deal-price-label">Cobrado por {{ group.bankScope }}:</span>
          <strong class="deal-total-value">S/ {{ formatAmount(group.registered) }}</strong>
          <span class="deal-scope-tag">solo {{ group.bankScope }}</span>
        </div>

        <div v-else class="deal-price-row">
          <span class="deal-price-label">Precio Total:</span>
          <template v-if="editingTotal">
            <input
              v-model="totalDraft"
              type="number"
              step="0.01"
              min="0.01"
              class="deal-total-input"
              placeholder="0.00"
            />
            <button type="button" class="deal-mini-btn" :disabled="savingTotal" @click="saveTotal">
              {{ savingTotal ? "…" : "✓" }}
            </button>
            <button type="button" class="deal-mini-btn is-cancel" @click="editingTotal = false">✕</button>
          </template>
          <template v-else>
            <strong v-if="group.total != null" class="deal-total-value">S/ {{ formatAmount(group.total) }}</strong>
            <span v-else class="deal-total-value is-empty">Sin definir</span>
            <button
              v-if="!collapsed"
              type="button"
              class="deal-edit-price-btn"
              title="Editar precio total del cierre"
              @click="startEditTotal"
            >
              ✎
            </button>
          </template>
        </div>

        <!-- Progress bar and legend -->
        <div v-if="group.total != null" class="deal-progress-box">
          <div class="deal-progress-bar" role="img" :aria-label="`${pctCubierto}% cubierto`">
            <span class="progress-seg seg-verificado" :style="{ width: segWidth(group.verificado) }" title="Verificado"></span>
            <span class="progress-seg seg-porverificar" :style="{ width: segWidth(group.porVerificar) }" title="Por verificar"></span>
            <span class="progress-seg seg-pendiente" :style="{ width: segWidth(group.pendiente) }" title="Pendiente"></span>
          </div>
          <div v-if="!collapsed" class="deal-progress-legend">
            <span class="legend-pct"><strong>{{ pctCubierto }}%</strong> cubierto</span>
            <span class="legend-chip chip-verificado">✓ S/ {{ formatAmount(group.verificado) }}</span>
            <span v-if="Number(group.porVerificar) > 0" class="legend-chip chip-porverificar">● S/ {{ formatAmount(group.porVerificar) }}</span>
            <span v-if="Number(group.pendiente) > 0" class="legend-chip chip-pendiente">⏳ S/ {{ formatAmount(group.pendiente) }}</span>
            <span v-if="Number(group.saldo) > 0" class="legend-chip chip-saldo">Por registrar S/ {{ formatAmount(group.saldo) }}</span>
          </div>
        </div>
      </div>

      <!-- Action Button -->
      <div class="deal-actions-block">
        <button
          v-if="group.leadId && !collapsed"
          type="button"
          class="deal-add-btn"
          :class="{ 'is-open': isAdding }"
          @click="toggleAdd"
        >
          {{ isAdding ? "✕ Cancelar" : "+ Agregar cuota" }}
        </button>
      </div>
    </div>

    <!-- Alert if initial payment blocks the project -->
    <div v-if="blockingPayment && !collapsed" class="deal-blocker-banner">
      <span class="banner-icon">🔒</span>
      <span class="banner-text">
        El proyecto de este cliente sigue <strong>bloqueado</strong> hasta verificar la <strong>{{ blockingPayment.cuota }}</strong> cuota.
      </span>
    </div>

    <p v-if="errorMessage" class="deal-alert">⚠️ {{ errorMessage }}</p>

    <LeadContactModal
      v-if="showContact"
      :lead-id="group.leadId"
      @close="showContact = false"
      @saved="onContactSaved"
    />

    <!-- Inline Add Payment Form -->
    <form v-if="isAdding" class="deal-add-form" @submit.prevent="addPayment">
      <div class="deal-form-header">
        <span class="deal-form-title">Registrar nueva cuota para <strong>{{ group.leadName }}</strong></span>
      </div>
      <div class="deal-add-grid">
        <label class="deal-field">
          <span>Fecha</span>
          <input v-model="draft.fecha" type="date" class="form-input" required />
        </label>
        <label class="deal-field">
          <span>Cuota</span>
          <select v-model="draft.cuota" class="form-select" required>
            <option v-for="c in CUOTAS" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="deal-field">
          <span>Emitir</span>
          <select v-model="draft.emitir" class="form-select" required>
            <option v-for="e in EMITIR_OPCIONES" :key="e" :value="e">{{ e }}</option>
          </select>
        </label>
        <label class="deal-field">
          <span>Monto (S/)</span>
          <input v-model="draft.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
        </label>
        <label class="deal-field">
          <span>Banco</span>
          <select v-model="draft.banco" class="form-select" required>
            <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
          </select>
        </label>
        <label class="deal-field">
          <span>Estado</span>
          <select v-model="draft.estado" class="form-select">
            <option value="pendiente">Pendiente</option>
            <option value="pagado">Pagado</option>
          </select>
        </label>
        <div class="deal-field deal-field-action">
          <button type="submit" class="btn-primary deal-submit-btn" :disabled="isSaving">
            {{ isSaving ? "Guardando..." : "Guardar cuota" }}
          </button>
        </div>
      </div>
      <p class="deal-add-hint">
        ITF estimado: S/ {{ formatAmount(itfPreview) }} · Los comprobantes y el archivo tributario se adjuntan desde la fila una vez creada.
      </p>
    </form>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { apiFetch } from "../../apiClient.js";
import { formatAmount } from "./format.js";
import { BANCOS, CUOTAS, EMITIR_OPCIONES, calcItf } from "./incomeOptions.js";
import LeadContactModal from "./LeadContactModal.vue";

const props = defineProps({
  /** Cierre (lead) con su plan de cobro y las cuotas que se están listando. */
  group: { type: Object, required: true },
  /** Plegado: solo se muestran nombre, precio total y barra de avance. */
  collapsed: { type: Boolean, default: false },
});

const emit = defineEmits(["saved", "toggle"]);

const errorMessage = ref("");
const isAdding = ref(false);
const isSaving = ref(false);
const editingTotal = ref(false);
const savingTotal = ref(false);
const totalDraft = ref("");

/** Cubierto = lo que ya está registrado en cuotas sobre el precio del cierre. */
const pctCubierto = computed(() => {
  const total = Number(props.group.total) || 0;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((props.group.registered / total) * 100));
});

const showContact = ref(false);

/**
 * El libro se recarga tras guardar: el nombre del cierre y el correo al que se
 * manda el comprobante vienen del lead, así que la tabla tiene que reflejarlo.
 */
function onContactSaved(lead) {
  showContact.value = false;
  emit("saved", { message: `Datos de ${lead.full_name || 'el cliente'} actualizados.` });
}

const itfPreview = computed(() => calcItf(draft.monto));

/**
 * La primera cuota del cronograma cuando todavía no está verificada: es la que
 * mantiene bloqueado el proyecto del cliente. El backend garantiza que el
 * marcador esté siempre en esa cuota y en una sola.
 */
const blockingPayment = computed(() => {
  const gating = props.group.payments.find((payment) => payment.is_initial_payment);
  return gating && gating.estado !== "verificado" ? gating : null;
});

function segWidth(value) {
  const total = Number(props.group.total) || 0;
  if (total <= 0) return "0%";
  return `${Math.min(100, ((Number(value) || 0) / total) * 100)}%`;
}

/** La siguiente cuota libre del cierre, para no repetir una ya registrada. */
function nextCuota() {
  const used = new Set(props.group.payments.map((p) => p.cuota));
  return CUOTAS.find((c) => !used.has(c)) || CUOTAS[CUOTAS.length - 1];
}

function emptyDraft() {
  const last = props.group.payments[props.group.payments.length - 1];
  return {
    fecha: new Date().toISOString().slice(0, 10),
    cuota: nextCuota(),
    emitir: last?.emitir || "boleta",
    // Lo habitual es cobrar todo lo que falta, así que el saldo va propuesto.
    monto: props.group.saldo > 0 ? String(props.group.saldo) : "",
    banco: last?.banco || BANCOS[0],
    estado: "pendiente",
  };
}

const draft = reactive(emptyDraft());

function toggleAdd() {
  isAdding.value = !isAdding.value;
  errorMessage.value = "";
  // El borrador se rehace al abrir: el saldo sugerido es el de este momento.
  if (isAdding.value) Object.assign(draft, emptyDraft());
}

function startEditTotal() {
  // Sin precio total todavía, lo ya registrado es la mejor propuesta: casi
  // siempre el cierre se pactó por esa cifra y solo falta dejarla escrita.
  totalDraft.value = props.group.total ?? props.group.registered ?? "";
  editingTotal.value = true;
}

async function saveTotal() {
  savingTotal.value = true;
  errorMessage.value = "";
  try {
    const response = await apiFetch(`/api/finance/leads/${props.group.leadId}/total-amount`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalAmount: totalDraft.value === "" ? null : totalDraft.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo actualizar el precio total.");
    editingTotal.value = false;
    emit("saved", { message: "Precio total actualizado." });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    savingTotal.value = false;
  }
}

async function addPayment() {
  isSaving.value = true;
  errorMessage.value = "";
  try {
    const response = await apiFetch("/api/finance/income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, leadId: props.group.leadId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo registrar el pago.");
    isAdding.value = false;
    emit("saved", { message: `Pago ${data.income?.code || ""} agregado al cierre.` });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.deal-plan-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.85rem 1.25rem;
  background: var(--surface-1, #ffffff);
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-color, #e2e8f0);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
}

.deal-plan-card:hover {
  border-color: var(--border-strong, #cbd5e1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
}

.deal-header-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
  width: 100%;
}

.deal-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  background: var(--surface-2, #f8fafc);
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.deal-toggle-btn:hover {
  background: var(--surface-3, #f1f5f9);
  color: var(--text-main, #0f172a);
  border-color: var(--border-strong, #cbd5e1);
}

.deal-caret {
  display: inline-block;
  font-size: 0.8rem;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.deal-caret.is-open {
  transform: rotate(90deg);
}

.deal-client-block {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 220px;
  cursor: pointer;
}

.deal-badges-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.deal-code-badge {
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: var(--surface-2, #f1f5f9);
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  letter-spacing: 0.02em;
}

.deal-dni-badge {
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
  color: var(--text-muted, #94a3b8);
}

.deal-cuotas-badge {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-muted, #64748b);
  background: var(--surface-2, #f8fafc);
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
}

.deal-gate-badge {
  font-size: 0.68rem;
  font-weight: 600;
  color: #e11d48;
  background: rgba(225, 29, 72, 0.08);
  border: 1px solid rgba(225, 29, 72, 0.2);
  padding: 0.1rem 0.5rem;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.deal-name-line {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.deal-client-name {
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text-main, #0f172a);
  letter-spacing: -0.01em;
}

.deal-contact-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--surface-2, #f8fafc);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--text-muted, #64748b);
}

.deal-contact-btn:hover {
  background: var(--surface-3, #f1f5f9);
  border-color: var(--border-color, #e2e8f0);
}

/* Financial Progress Block */
.deal-financial-block {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  flex: 1 1 340px;
  min-width: 280px;
  flex-wrap: wrap;
}

.deal-price-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  white-space: nowrap;
}

.deal-scope-tag {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-3);
  border-radius: 9999px;
  padding: 0.1rem 0.5rem;
}

.deal-price-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted, #94a3b8);
  font-weight: 500;
}

.deal-total-value {
  font-family: var(--font-mono, monospace);
  font-size: 1.02rem;
  font-weight: 700;
  color: var(--text-main, #0f172a);
}

.deal-total-value.is-empty {
  font-size: 0.82rem;
  font-weight: 400;
  color: var(--text-muted, #94a3b8);
  font-style: italic;
}

.deal-edit-price-btn {
  background: none;
  border: none;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  padding: 0.15rem 0.35rem;
  border-radius: 4px;
  font-size: 0.8rem;
  transition: color 0.15s ease;
}

.deal-edit-price-btn:hover {
  color: var(--primary, #0ea5e9);
  background: var(--surface-2, #f8fafc);
}

.deal-total-input {
  width: 110px;
  padding: 0.25rem 0.5rem;
  font-size: 0.85rem;
  font-family: var(--font-mono, monospace);
  border: 1px solid var(--border-color, #cbd5e1);
  border-radius: 6px;
}

.deal-mini-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--surface-1, #ffffff);
  cursor: pointer;
}

.deal-mini-btn.is-cancel {
  color: var(--text-muted, #94a3b8);
}

.deal-progress-box {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1 1 200px;
  min-width: 180px;
}

.deal-progress-bar {
  display: flex;
  height: 6px;
  border-radius: 9999px;
  overflow: hidden;
  background: var(--surface-3, #f1f5f9);
}

.progress-seg {
  height: 100%;
  transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.seg-verificado {
  background: #10b981;
}

.seg-porverificar {
  background: #3b82f6;
}

.seg-pendiente {
  background: #f59e0b;
}

.deal-progress-legend {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
  font-size: 0.7rem;
  color: var(--text-muted, #64748b);
}

.legend-pct strong {
  color: var(--text-main, #0f172a);
  font-weight: 600;
}

.legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.68rem;
}

.chip-verificado {
  color: #059669;
}

.chip-porverificar {
  color: #2563eb;
}

.chip-pendiente {
  color: #d97706;
}

.chip-saldo {
  color: var(--text-muted, #94a3b8);
}

/* Actions Block */
.deal-actions-block {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.deal-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.85rem;
  border-radius: 8px;
  border: 1px solid rgba(14, 165, 233, 0.3);
  background: rgba(14, 165, 233, 0.06);
  color: var(--primary, #0284c7);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.deal-add-btn:hover {
  background: rgba(14, 165, 233, 0.12);
  border-color: rgba(14, 165, 233, 0.5);
}

.deal-add-btn.is-open {
  background: var(--surface-2, #f1f5f9);
  border-color: var(--border-color, #cbd5e1);
  color: var(--text-muted, #64748b);
}

/* Blocker Warning Banner */
.deal-blocker-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.8rem;
  border-radius: 8px;
  background: rgba(225, 29, 72, 0.05);
  border: 1px solid rgba(225, 29, 72, 0.18);
  font-size: 0.74rem;
  color: #be123c;
}

.banner-icon {
  font-size: 0.85rem;
  line-height: 1;
}

.banner-text strong {
  font-weight: 600;
}

.deal-alert {
  font-size: 0.75rem;
  color: #e11d48;
  margin: 0;
}

/* Inline Add Payment Form */
.deal-add-form {
  padding-top: 0.75rem;
  margin-top: 0.35rem;
  border-top: 1px dashed var(--border-color, #e2e8f0);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.deal-form-header {
  font-size: 0.75rem;
  color: var(--text-muted, #64748b);
}

.deal-add-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.65rem;
  align-items: end;
}

.deal-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.deal-field > span {
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--text-muted, #64748b);
}

.deal-field .form-input,
.deal-field .form-select {
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  border-radius: 6px;
  border: 1px solid var(--border-color, #cbd5e1);
  background: var(--surface-1, #ffffff);
}

.deal-field-action {
  display: flex;
  align-items: flex-end;
}

.deal-field-action .deal-add-btn {
  width: 100%;
  justify-content: center;
  padding: 0.45rem 0.8rem;
}

.deal-add-hint {
  font-size: 0.68rem;
  color: var(--text-muted, #94a3b8);
  margin: 0;
}
</style>
