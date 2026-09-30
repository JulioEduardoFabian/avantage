<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content win-modal">
      <div class="win-hero">
        <span class="win-confetti" aria-hidden="true">🎉</span>
        <h3 class="win-title">¡Felicitaciones!</h3>
        <p class="win-subtitle">
          Cerraste el trato con <strong>{{ clientName }}</strong>.
          Registra el primer pago y deja pactadas las cuotas que faltan.
        </p>
      </div>

      <div class="modal-body">
        <p v-if="errorMessage" class="info-box win-alert">⚠️ {{ errorMessage }}</p>

        <form @submit.prevent="submit">
          <div class="win-grid">
            <div class="form-group">
              <label class="form-label">Precio total del cierre (S/) *</label>
              <input
                ref="montoInput"
                v-model="totalAmount"
                type="number"
                step="0.01"
                min="0.01"
                class="form-input win-monto-input"
                placeholder="0.00"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label">Monto de este primer pago (S/) *</label>
              <input
                v-model="monto"
                type="number"
                step="0.01"
                min="0.01"
                class="form-input win-monto-input"
                placeholder="0.00"
                required
              />
            </div>
          </div>
          <p class="win-hint">
            Si el cliente aún no paga el total, registra aquí solo lo que ya pagó y programa
            abajo las cuotas que faltan.
          </p>

          <div class="form-group win-schedule">
            <label class="form-label">Cronograma de las cuotas que faltan</label>
            <PaymentScheduleEditor
              v-model="installments"
              :total="totalNumber"
              :base-amount="montoNumber"
              :offset="1"
            />
            <p class="win-hint">
              Estas cuotas nacen ya registradas en Finanzas y son las que se imprimen en el
              contrato del cliente: se pueden reprogramar después desde el contrato o desde
              Finanzas, mientras no se hayan cobrado.
            </p>
          </div>

          <div class="win-grid">
            <div class="form-group">
              <label class="form-label">Banco</label>
              <select v-model="banco" class="form-select">
                <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Comprobante a emitir</label>
              <select v-model="emitir" class="form-select">
                <option v-for="e in EMITIR_OPCIONES" :key="e" :value="e">{{ e }}</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Voucher del pago (opcional)</label>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              class="form-input"
              @change="onVoucherChange"
            />
            <p class="win-hint">
              <template v-if="vouchers.length > 0">
                {{ vouchers.length }} archivo(s) — el ingreso quedará como <strong>pagado</strong>,
                a la espera de que Finanzas lo verifique.
              </template>
              <template v-else>
                Si todavía no lo tienes, el ingreso queda <strong>pendiente</strong> y lo puedes
                subir después desde la tarjeta del lead.
              </template>
            </p>
          </div>

          <div class="win-flow">
            <span :class="['win-step', 'is-done']">1. Venta cerrada</span>
            <span class="win-arrow">→</span>
            <span :class="['win-step', vouchers.length > 0 ? 'is-done' : '']">2. Voucher</span>
            <span class="win-arrow">→</span>
            <span class="win-step">3. Finanzas verifica</span>
            <span class="win-arrow">→</span>
            <span class="win-step">4. Proyecto activo</span>
          </div>

          <div class="win-actions">
            <button type="button" class="btn-secondary" :disabled="isSaving" @click="close">
              Cancelar
            </button>
            <button type="submit" class="btn-primary win-submit" :disabled="isSaving">
              {{ isSaving ? 'Registrando...' : '🏆 Registrar y ganar el lead' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import PaymentScheduleEditor from './PaymentScheduleEditor.vue';
import { BANCOS } from '../views/finance/incomeOptions.js';

const props = defineProps({ lead: { type: Object, required: true } });
const emit = defineEmits(['close', 'won']);

const EMITIR_OPCIONES = ['factura', 'boleta', 'nrus', 'rxh', 'c. interno'];

const monto = ref('');
const totalAmount = ref('');
const banco = ref('BCP');
const emitir = ref('boleta');
const vouchers = ref([]);
const installments = ref([]);
const isSaving = ref(false);
const errorMessage = ref('');
const montoInput = ref(null);

const totalNumber = computed(() => {
  const value = Number(totalAmount.value);
  return Number.isFinite(value) && value > 0 ? value : null;
});

const montoNumber = computed(() => Number(monto.value) || 0);

const clientName = computed(() => {
  const lead = props.lead;
  return (lead.full_name || '').trim() || lead.topic || `Lead #${lead.id}`;
});

onMounted(() => montoInput.value?.focus());

function onVoucherChange(event) {
  vouchers.value = Array.from(event.target.files || []).slice(0, 10);
}

function close() {
  if (isSaving.value) return;
  emit('close');
}

/**
 * El cierre es una sola llamada: mueve el lead a la etapa ganadora, crea su
 * proyecto (bloqueado) y registra el ingreso. Si falla, el lead no se mueve,
 * y así no quedan proyectos ganados sin su primer pago registrado.
 */
async function submit() {
  const amount = Number(monto.value);
  const total = Number(totalAmount.value);
  if (!Number.isFinite(total) || total <= 0) {
    errorMessage.value = 'El precio total del cierre debe ser mayor a 0.';
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    errorMessage.value = 'El monto del primer pago debe ser mayor a 0.';
    return;
  }
  if (amount > total) {
    errorMessage.value = 'El primer pago no puede ser mayor al precio total del cierre.';
    return;
  }

  const schedule = [];
  for (const [index, row] of installments.value.entries()) {
    const value = Number(row.monto);
    if (!Number.isFinite(value) || value <= 0) {
      errorMessage.value = `La cuota ${index + 2} del cronograma necesita un monto mayor a 0.`;
      return;
    }
    if (!row.dueDate) {
      errorMessage.value = `La cuota ${index + 2} del cronograma necesita una fecha de vencimiento.`;
      return;
    }
    schedule.push({ monto: value, dueDate: row.dueDate, emitir: emitir.value, banco: banco.value });
  }
  const planned = amount + schedule.reduce((sum, row) => sum + row.monto, 0);
  if (planned > total + 0.01) {
    errorMessage.value = `El cronograma suma S/ ${planned.toFixed(2)} y el precio total es S/ ${total.toFixed(2)}.`;
    return;
  }

  isSaving.value = true;
  errorMessage.value = '';
  try {
    const fd = new FormData();
    fd.append('monto', String(amount));
    fd.append('totalAmount', String(total));
    fd.append('banco', banco.value);
    fd.append('emitir', emitir.value);
    // El cronograma viaja como JSON porque el mismo POST sube los vouchers
    // (multipart), que no admite objetos anidados.
    if (schedule.length > 0) fd.append('installments', JSON.stringify(schedule));
    for (const file of vouchers.value) fd.append('receipts', file);

    const response = await apiFetch(`/api/leads/${props.lead.id}/win`, { method: 'POST', body: fd });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo registrar el cierre de venta.');

    emit('won', data);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.win-modal {
  max-width: 540px;
  overflow: hidden;
}

.win-hero {
  padding: 1.75rem 1.5rem 1.4rem;
  text-align: center;
  background: linear-gradient(160deg, rgba(46, 125, 70, 0.14), rgba(46, 125, 70, 0.02));
  border-bottom: 1px solid var(--border-color);
}

.win-confetti {
  font-size: 2.2rem;
  display: block;
  line-height: 1;
  margin-bottom: 0.5rem;
}

.win-title {
  margin: 0 0 0.35rem;
  font-family: var(--font-heading);
  font-size: 1.35rem;
  color: var(--accent-emerald);
}

.win-subtitle {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-muted);
}

.win-subtitle strong { color: var(--text-main); }

.win-alert {
  border-color: rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
  margin-bottom: 1rem;
}

.win-monto-input {
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.02em;
}

.win-schedule { margin-top: 1rem; }

.win-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.win-hint {
  margin: 0.45rem 0 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-muted);
}

/* Recordatorio de que el proyecto no se abre hasta el visto bueno de finanzas. */
.win-flow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 1.1rem 0 0.25rem;
  padding: 0.6rem;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
}

.win-step {
  font-family: var(--font-mono);
  font-size: 0.63rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.win-step.is-done { color: var(--accent-emerald); font-weight: 600; }
.win-arrow { font-size: 0.7rem; color: var(--text-muted); }

.win-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
}

.win-actions .btn-secondary,
.win-actions .win-submit {
  width: auto;
  padding: 0.6rem 1.15rem;
  font-size: 0.85rem;
}
</style>
