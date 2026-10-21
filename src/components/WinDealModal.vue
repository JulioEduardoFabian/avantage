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

        <!--
          El dinero de un lead no siempre nace en este modal: el cronograma del
          contrato y la pantalla de Finanzas escriben las mismas cuotas. Si ya
          hay algo asentado se muestra acá antes de pedir nada, porque es lo que
          explica por qué el primer pago que se pide es menor — o por qué no se
          pide ninguno.
        -->
        <div v-if="settlement.registered > 0" class="win-registered">
          <p class="win-registered-head">
            Este lead ya tiene <strong>S/ {{ money(settlement.registered) }}</strong> registrado en Finanzas
          </p>
          <ul class="win-registered-list">
            <li v-for="row in settlement.installments" :key="row.id">
              <span class="win-reg-cuota">{{ row.cuota }}</span>
              <span class="win-reg-monto">S/ {{ money(row.monto) }}</span>
              <span :class="['pill', estadoPill(row.estado)]">{{ row.estado }}</span>
              <span class="win-reg-due">vence {{ shortDate(row.due_date) }}</span>
            </li>
          </ul>
          <p class="win-hint">
            <template v-if="fullyRegistered">
              El precio total ya está cubierto por esas cuotas: no hay un pago nuevo que
              registrar, solo falta marcar la venta como ganada.
            </template>
            <template v-else>
              Registra abajo solo lo que falta: quedan <strong>S/ {{ money(pendingAmount) }}</strong>.
            </template>
          </p>
        </div>

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
            <div v-if="!fullyRegistered" class="form-group">
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
            <!--
              El salario que le toca a quien consiguió el lead, por ESTE
              proyecto. Se pide acá porque es el momento en que se conoce el
              trato, y así el vendedor no necesita entrar a Finanzas (que
              además exige un permiso que no tiene por qué tener). Es
              opcional: si no se sabe todavía, se carga después desde la
              pestaña de Salarios.
            -->
            <div class="form-group">
              <label class="form-label">Salario por este proyecto (S/)</label>
              <input
                v-model="salaryAmount"
                type="number"
                step="0.01"
                min="0"
                class="form-input win-monto-input"
                placeholder="Opcional"
              />
            </div>
          </div>
          <p class="win-hint">
            El salario se le asigna automáticamente al responsable del proyecto y queda como un
            acuerdo en Salarios, donde después se registran sus pagos. No descuenta del balance
            hasta que se pague.
          </p>
          <p v-if="!fullyRegistered" class="win-hint">
            Si el cliente aún no paga el total, registra aquí solo lo que ya pagó y programa
            abajo las cuotas que faltan.
          </p>

          <div v-if="!fullyRegistered" class="form-group win-schedule">
            <label class="form-label">Cronograma de las cuotas que faltan</label>
            <PaymentScheduleEditor
              v-model="installments"
              :total="totalNumber"
              :base-amount="montoNumber + settlement.registered"
              :offset="scheduleOffset"
            />
            <p class="win-hint">
              Estas cuotas nacen ya registradas en Finanzas y son las que se imprimen en el
              contrato del cliente: se pueden reprogramar después desde el contrato o desde
              Finanzas, mientras no se hayan cobrado.
            </p>
          </div>

          <div v-if="!fullyRegistered" class="win-grid">
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

          <div v-if="!fullyRegistered" class="form-group">
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
            <span :class="['win-step', vouchers.length > 0 || fullyRegistered ? 'is-done' : '']">2. Voucher</span>
            <span class="win-arrow">→</span>
            <span class="win-step">3. Finanzas verifica</span>
            <span class="win-arrow">→</span>
            <span class="win-step">4. Proyecto activo</span>
          </div>

          <div class="win-actions">
            <button type="button" class="btn-secondary" :disabled="isSaving" @click="close">
              Cancelar
            </button>
            <button type="submit" class="btn-primary win-submit" :disabled="isSaving || isLoading">
              {{ submitLabel }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import PaymentScheduleEditor from './PaymentScheduleEditor.vue';
import { BANCOS } from '../views/finance/incomeOptions.js';

const props = defineProps({ lead: { type: Object, required: true } });
const emit = defineEmits(['close', 'won']);

const EMITIR_OPCIONES = ['factura', 'boleta', 'nrus', 'rxh', 'c. interno'];

const monto = ref('');
const totalAmount = ref('');
const salaryAmount = ref('');
const banco = ref('BCP');
const emitir = ref('boleta');
const vouchers = ref([]);
const installments = ref([]);
const isSaving = ref(false);
const isLoading = ref(true);
const errorMessage = ref('');
const montoInput = ref(null);

/** Lo que el lead ya tiene asentado en Finanzas antes de este cierre. */
const settlement = ref({ total: null, registered: 0, remaining: null, installments: [] });

/**
 * El precio total ya está cubierto por cuotas que existen: este cierre no
 * registra un pago nuevo, solo gana el lead y adopta ese cronograma. Pedir
 * "el primer pago" acá obligaba a duplicar un ingreso que el servidor rechaza.
 */
const fullyRegistered = computed(() => {
  const total = Number(totalAmount.value);
  if (!Number.isFinite(total) || total <= 0) return false;
  return settlement.value.registered >= total - 0.01;
});

const pendingAmount = computed(() => {
  const total = Number(totalAmount.value);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.round((total - settlement.value.registered) * 100) / 100);
});

/**
 * Las cuotas nuevas se numeran después de las que ya existen: el cronograma es
 * uno solo, no empieza de cero en cada cierre.
 */
const scheduleOffset = computed(() => settlement.value.installments.length + 1);

const submitLabel = computed(() => {
  if (isLoading.value) return 'Cargando...';
  if (isSaving.value) return 'Registrando...';
  return fullyRegistered.value ? '🏆 Ganar el lead' : '🏆 Registrar y ganar el lead';
});

function money(value) {
  return Number(value || 0).toFixed(2);
}

function shortDate(value) {
  if (!value) return 'sin fecha';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : value;
}

function estadoPill(estado) {
  if (estado === 'verificado') return 'pill-success';
  if (estado === 'pagado') return 'pill-warning';
  return 'pill-neutral';
}

const totalNumber = computed(() => {
  const value = Number(totalAmount.value);
  return Number.isFinite(value) && value > 0 ? value : null;
});

const montoNumber = computed(() => Number(monto.value) || 0);

const clientName = computed(() => {
  const lead = props.lead;
  return (lead.full_name || '').trim() || lead.topic || `Lead #${lead.id}`;
});

/**
 * Lo ya registrado se lee al abrir, no al guardar: con el total prellenado el
 * vendedor ve de entrada cuánto falta, en vez de descubrirlo por un error del
 * servidor después de llenar el formulario.
 */
onMounted(async () => {
  try {
    const response = await apiFetch(`/api/leads/${props.lead.id}/win-preview`);
    const data = await response.json();
    if (response.ok) {
      settlement.value = data;
      if (data.total != null) totalAmount.value = String(data.total);
      else if (data.registered > 0) totalAmount.value = String(data.registered);
      // Solo se propone un monto cuando hay algo cobrado antes: en un cierre
      // normal el vendedor escribe lo que el cliente acaba de pagar, no el total.
      if (data.registered > 0 && data.remaining > 0) monto.value = String(data.remaining);
    }
  } catch {
    // Sin este dato el modal sigue sirviendo: el servidor vuelve a validar.
  } finally {
    isLoading.value = false;
    if (!fullyRegistered.value) montoInput.value?.focus();
  }
});

// Subir el precio total a mano vuelve a dejar un saldo por registrar: el campo
// del primer pago reaparece y se propone ese saldo.
watch(fullyRegistered, (covered) => {
  if (covered) monto.value = '';
  else if (!monto.value && pendingAmount.value > 0) monto.value = String(pendingAmount.value);
});

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
  const covered = fullyRegistered.value;
  const amount = covered ? 0 : Number(monto.value);
  const total = Number(totalAmount.value);
  const registered = settlement.value.registered;
  if (!Number.isFinite(total) || total <= 0) {
    errorMessage.value = 'El precio total del cierre debe ser mayor a 0.';
    return;
  }
  if (total < registered - 0.01) {
    errorMessage.value =
      `El precio total no puede ser menor a lo ya registrado en Finanzas (S/ ${money(registered)}).`;
    return;
  }
  if (!covered && (!Number.isFinite(amount) || amount <= 0)) {
    errorMessage.value = 'El monto del primer pago debe ser mayor a 0.';
    return;
  }
  if (registered + amount > total + 0.01) {
    errorMessage.value = registered > 0
      ? `El pago (S/ ${money(amount)}) más lo ya registrado (S/ ${money(registered)}) supera el precio total de S/ ${money(total)}.`
      : 'El primer pago no puede ser mayor al precio total del cierre.';
    return;
  }

  const schedule = [];
  for (const [index, row] of installments.value.entries()) {
    const value = Number(row.monto);
    if (!Number.isFinite(value) || value <= 0) {
      errorMessage.value = `La cuota ${scheduleOffset.value + index + 1} del cronograma necesita un monto mayor a 0.`;
      return;
    }
    if (!row.dueDate) {
      errorMessage.value = `La cuota ${scheduleOffset.value + index + 1} del cronograma necesita una fecha de vencimiento.`;
      return;
    }
    schedule.push({ monto: value, dueDate: row.dueDate, emitir: emitir.value, banco: banco.value });
  }
  const planned = registered + amount + schedule.reduce((sum, row) => sum + row.monto, 0);
  if (planned > total + 0.01) {
    errorMessage.value = `El cronograma suma S/ ${planned.toFixed(2)} y el precio total es S/ ${total.toFixed(2)}.`;
    return;
  }

  isSaving.value = true;
  errorMessage.value = '';
  try {
    const fd = new FormData();
    // Un cierre sobre cuotas que ya existen no manda monto: lo que no viaja no
    // se registra, y así el servidor no tiene que adivinar si el 0 es un pago.
    if (!covered) fd.append('monto', String(amount));
    fd.append('totalAmount', String(total));
    if (Number(salaryAmount.value) > 0) fd.append('salaryAmount', String(Number(salaryAmount.value)));
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

/* Lo que el lead ya tiene asentado en Finanzas, antes de pedir nada. */
.win-registered {
  margin-bottom: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.win-registered-head {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--text-sub);
}

.win-registered-head strong {
  font-family: var(--font-mono);
  color: var(--text-main);
}

.win-registered-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}

.win-registered-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.win-reg-cuota {
  font-family: var(--font-mono);
  text-transform: uppercase;
  color: var(--text-muted);
}

.win-reg-monto {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-main);
}

.win-reg-due { color: var(--text-muted); }

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
