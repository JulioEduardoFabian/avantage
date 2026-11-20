<!--
  Editor del cronograma de pagos: una fila por cuota (monto + vencimiento).

  Lo comparten el modal de "lead ganado" y el contrato porque en los dos lados
  se edita el MISMO plan —las cuotas reales de Finanzas—, así que las reglas
  ("no pasarse del precio total", "una cuota cobrada no se toca") tienen que
  leerse igual desde cualquiera de las dos pantallas.
-->
<template>
  <div class="ps-wrap">
    <div v-if="rows.length > 0" class="ps-table">
      <div class="ps-head">
        <span>Cuota</span>
        <span>Monto ({{ symbol }})</span>
        <span>Vence</span>
        <span aria-label="Acciones"></span>
      </div>

      <div v-for="(row, index) in rows" :key="row.key" class="ps-row" :class="{ 'is-locked': row.locked }">
        <span class="ps-ordinal">
          {{ cuotaLabel(offset + index) }}
          <span v-if="row.locked" class="ps-locked-tag" :title="lockedTitle(row)">🔒 {{ row.estado }}</span>
        </span>
        <input
          v-model="row.monto"
          type="number"
          step="0.01"
          min="0.01"
          class="form-input ps-input"
          :disabled="row.locked"
          placeholder="0.00"
          @input="onMontoInput(row)"
        />
        <input
          v-model="row.dueDate"
          type="date"
          class="form-input ps-input"
          :disabled="row.locked"
          @input="emitRows"
        />
        <button
          type="button"
          class="ps-remove"
          :disabled="row.locked"
          :title="row.locked ? 'Esta cuota ya se cobró' : 'Quitar la cuota'"
          @click="removeRow(index)"
        >
          ✕
        </button>
      </div>
    </div>

    <p v-else class="ps-empty">
      Todavía no hay cuotas programadas. Agrega las que falten para completar el precio del cierre.
    </p>

    <div class="ps-footer">
      <button type="button" class="ps-add" @click="addRow">+ Agregar cuota</button>
      <p class="ps-summary" :class="summaryClass">
        Programado <strong>{{ symbol }} {{ scheduled.toFixed(2) }}</strong>
        <template v-if="total !== null">
          de {{ symbol }} {{ total.toFixed(2) }} ·
          <template v-if="remaining > 0.005">falta {{ symbol }} {{ remaining.toFixed(2) }}</template>
          <template v-else-if="remaining < -0.005">excede por {{ symbol }} {{ Math.abs(remaining).toFixed(2) }}</template>
          <template v-else>cronograma completo ✓</template>
        </template>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { cuotaLabel } from '../views/finance/incomeOptions.js';
import { addMonths, splitEvenly, todayISO } from '../paymentSchedulePlan.js';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  /** Precio total del cierre; `null` cuando todavía no se fijó. */
  total: { type: Number, default: null },
  /** Monto que ya cuenta para el total pero no se edita acá (el primer pago del cierre). */
  baseAmount: { type: Number, default: 0 },
  /** Cuántas cuotas van antes de las de esta lista, para numerarlas bien. */
  offset: { type: Number, default: 0 },
  currency: { type: String, default: 'PEN' }
});
const emit = defineEmits(['update:modelValue']);

// Copia local con una `key` estable por fila: sin ella, borrar una cuota del
// medio hace que Vue reutilice el input equivocado y el usuario ve el monto
// de otra fila en el campo que acaba de editar.
let nextKey = 0;
const rows = ref([]);

watch(() => props.modelValue, (value) => {
  const incoming = (value || []).map((row) => ({
    key: row.key ?? `r${nextKey++}`,
    ...row,
    // Una cuota que llega de afuera (un contrato ya guardado, un cronograma
    // que Finanzas ya registró) se respeta tal cual: el reparto automático
    // solo toca las que propuso este editor y nadie corrigió.
    manual: row.manual ?? true
  }));
  if (JSON.stringify(strip(incoming)) === JSON.stringify(strip(rows.value))) return;
  rows.value = incoming;
}, { immediate: true, deep: true });

const symbol = computed(() => (props.currency === 'USD' ? 'US$' : 'S/'));

const scheduled = computed(() =>
  props.baseAmount + rows.value.reduce((sum, row) => sum + (Number(row.monto) || 0), 0));

const remaining = computed(() => (props.total === null ? 0 : props.total - scheduled.value));

const summaryClass = computed(() => {
  if (props.total === null) return '';
  if (remaining.value < -0.005) return 'is-over';
  if (Math.abs(remaining.value) <= 0.005) return 'is-complete';
  return '';
});

function strip(list) {
  return list.map(({ id = null, monto, dueDate, locked = false }) => ({ id, monto, dueDate, locked }));
}

function lockedTitle(row) {
  return row.estado === 'verificado'
    ? 'Finanzas ya verificó esta cuota.'
    : 'El cliente ya subió su comprobante: la cuota está en revisión.';
}

/**
 * Cuándo vence la cuota que se está agregando.
 *
 * La PRIMERA del plan vence hoy: es la que se cobra al firmar, y proponerla
 * para el mes siguiente obligaba a corregir la fecha en todos los cierres. Las
 * demás se proponen un mes después de la anterior, que es como se pactan.
 * `offset > 0` significa que este editor solo lleva la cola del cronograma (el
 * modal de cierre, donde el primer pago se registra arriba): ahí la de acá no
 * es la primera y le toca el mes siguiente.
 */
function nextDueDate() {
  const last = rows.value[rows.value.length - 1];
  if (last?.dueDate) return addMonths(last.dueDate, 1);
  if (rows.value.length === 0 && props.offset === 0) return todayISO();
  return addMonths(todayISO(), 1);
}

/**
 * Reparte el precio total entre las cuotas que propuso este editor.
 *
 * Lo que está bloqueado (ya cobrado) y lo que alguien escribió a mano se
 * respeta y se descuenta primero; el saldo se divide en partes iguales entre
 * las demás. Así, con un total de S/ 1500, agregar una cuota da 1500, agregar
 * la segunda deja 750 y 750, y la tercera 500/500/500 — que es como se pacta,
 * y era justo lo que había que escribir a mano cuota por cuota.
 *
 * Respetar lo escrito a mano no es un detalle: sin eso, agregar la última
 * cuota le borraría al vendedor el monto que acaba de pactar con el cliente.
 */
function redistribute() {
  if (props.total === null) return;
  const autoRows = rows.value.filter((row) => !row.locked && !row.manual);
  if (autoRows.length === 0) return;

  const fixed = props.baseAmount + rows.value
    .filter((row) => row.locked || row.manual)
    .reduce((sum, row) => sum + (Number(row.monto) || 0), 0);
  const shares = splitEvenly(props.total - fixed, autoRows.length);
  autoRows.forEach((row, index) => {
    row.monto = shares[index] > 0 ? shares[index].toFixed(2) : '';
  });
}

function addRow() {
  rows.value.push({
    key: `r${nextKey++}`,
    id: null,
    monto: '',
    dueDate: nextDueDate(),
    locked: false,
    manual: false
  });
  redistribute();
  emitRows();
}

function removeRow(index) {
  if (rows.value[index]?.locked) return;
  rows.value.splice(index, 1);
  // El dinero de la cuota que se fue tiene que volver a alguna parte: si no,
  // quitar una deja el cronograma incompleto y hay que recalcularlo a mano.
  redistribute();
  emitRows();
}

/**
 * Tocar el monto de una cuota la saca del reparto automático: a partir de ahí
 * manda lo que escribió la persona.
 */
function onMontoInput(row) {
  row.manual = true;
  emitRows();
}

// El precio total casi siempre se escribe DESPUÉS de armar el cronograma (o se
// corrige al negociar), así que las cuotas propuestas lo siguen. `baseAmount`
// entra por lo mismo: en el cierre es el primer pago, y lo que el cliente ya
// puso cambia cuánto queda por repartir.
watch([() => props.total, () => props.baseAmount], () => {
  redistribute();
  emitRows();
});

function emitRows() {
  emit('update:modelValue', rows.value.map((row) => ({ ...row })));
}
</script>

<style scoped>
.ps-wrap {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
}

.ps-table {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ps-head,
.ps-row {
  display: grid;
  grid-template-columns: 5.5rem 1fr 1fr 1.75rem;
  gap: 0.5rem;
  align-items: center;
}

.ps-head {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ps-ordinal {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-sub);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.ps-locked-tag {
  font-size: 0.58rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--accent-emerald);
}

.ps-input {
  padding: 0.4rem 0.5rem;
  font-size: 0.82rem;
}

.ps-row.is-locked .ps-input {
  opacity: 0.65;
  cursor: not-allowed;
}

.ps-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.25rem;
}

.ps-remove:hover:not(:disabled) { color: var(--accent-rose); }
.ps-remove:disabled { opacity: 0.3; cursor: not-allowed; }

.ps-empty {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.ps-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--border-color);
}

.ps-add {
  background: none;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
  color: var(--text-sub);
  cursor: pointer;
}

.ps-add:hover { color: var(--text-main); border-color: var(--text-muted); }

.ps-summary {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ps-summary.is-complete { color: var(--accent-emerald); }
.ps-summary.is-over { color: var(--accent-rose); }
</style>
