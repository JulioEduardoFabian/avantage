<!--
  Editor del cronograma de entregas: una fila por entrega (fecha + avance).

  Es el hermano de PaymentScheduleEditor, pero con una diferencia de fondo: las
  cuotas son dinero real que Finanzas cobra (y por eso tienen candados y un
  total que cuadrar), mientras que una entrega es solo un compromiso escrito en
  el contrato. Acá no hay nada que cuadrar ni que bloquear.

  Antes esta tabla se tecleaba dentro del texto de la cláusula quinta, y el
  resultado era el esperable: contratos emitidos con la tabla vacía.
-->
<template>
  <div class="ds-wrap">
    <div v-if="rows.length > 0" class="ds-table">
      <div class="ds-head">
        <span>Fecha</span>
        <span>Avance / entregable</span>
        <span aria-label="Acciones"></span>
      </div>

      <div v-for="(row, index) in rows" :key="row.key" class="ds-row">
        <input
          v-model="row.dueDate"
          type="date"
          class="form-input ds-input"
          @input="emitRows"
        />
        <input
          v-model="row.avance"
          type="text"
          maxlength="500"
          class="form-input ds-input"
          placeholder="Ej. Capítulo I y II"
          @input="emitRows"
        />
        <button
          type="button"
          class="ds-remove"
          title="Quitar la entrega"
          @click="removeRow(index)"
        >
          ✕
        </button>
      </div>
    </div>

    <p v-else class="ds-empty">
      Todavía no hay entregas programadas. Si lo dejas vacío, la cláusula imprime una fila
      «Por definir».
    </p>

    <div class="ds-footer">
      <button type="button" class="ds-add" @click="addRow">+ Agregar entrega</button>
      <p class="ds-summary">
        <template v-if="rows.length">
          {{ rows.length }} {{ rows.length === 1 ? 'entrega' : 'entregas' }}
          <template v-if="undated > 0"> · {{ undated }} sin fecha</template>
        </template>
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Array, default: () => [] }
});
const emit = defineEmits(['update:modelValue']);

// Misma razón que en el editor de cuotas: sin una `key` estable por fila,
// borrar una del medio hace que Vue reutilice el input equivocado y el usuario
// ve el texto de otra fila en el campo que acaba de editar.
let nextKey = 0;
const rows = ref([]);

watch(() => props.modelValue, (value) => {
  const incoming = (value || []).map((row) => ({ key: row.key ?? `d${nextKey++}`, ...row }));
  if (JSON.stringify(strip(incoming)) === JSON.stringify(strip(rows.value))) return;
  rows.value = incoming;
}, { immediate: true, deep: true });

const undated = computed(() => rows.value.filter((r) => !r.dueDate).length);

function strip(list) {
  return list.map(({ dueDate = null, avance = '' }) => ({ dueDate, avance }));
}

/**
 * La entrega nueva se propone dos semanas después de la última: es el ritmo
 * habitual entre avances, y así la mayoría de las filas se crean sin escribir
 * la fecha a mano. La primera entrega del contrato suele ser "Firma de
 * contrato", que va sin fecha propia.
 */
function addRow() {
  const last = rows.value[rows.value.length - 1];
  const base = last?.dueDate ? new Date(`${last.dueDate}T12:00:00`) : null;
  if (base) base.setDate(base.getDate() + 14);

  rows.value.push({
    key: `d${nextKey++}`,
    dueDate: base ? base.toISOString().slice(0, 10) : '',
    avance: rows.value.length === 0 ? 'Firma de contrato' : ''
  });
  emitRows();
}

function removeRow(index) {
  rows.value.splice(index, 1);
  emitRows();
}

function emitRows() {
  emit('update:modelValue', rows.value.map((row) => ({ ...row })));
}
</script>

<style scoped>
.ds-wrap {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
}

.ds-table {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.ds-head,
.ds-row {
  display: grid;
  grid-template-columns: 10rem 1fr 1.75rem;
  gap: 0.5rem;
  align-items: center;
}

.ds-head {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ds-input {
  padding: 0.4rem 0.5rem;
  font-size: 0.82rem;
}

.ds-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1;
  padding: 0.25rem;
}

.ds-remove:hover { color: var(--accent-rose); }

.ds-empty {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.ds-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--border-color);
}

.ds-add {
  background: none;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
  color: var(--text-sub);
  cursor: pointer;
}

.ds-add:hover { color: var(--text-main); border-color: var(--text-muted); }

.ds-summary {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
