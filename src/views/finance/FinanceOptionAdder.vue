<template>
  <div ref="rootEl" class="opt-adder">
    <button
      type="button"
      class="opt-adder-toggle"
      :aria-expanded="open"
      :title="`Agregar ${noun}`"
      @click="toggle"
    >＋ Agregar</button>

    <div v-if="open" class="opt-adder-panel" role="dialog" :aria-label="`Agregar ${noun}`" @keydown.esc="open = false">
      <div class="opt-adder-row">
        <input
          ref="inputEl"
          v-model="draft"
          type="text"
          class="form-input opt-adder-input"
          :maxlength="maxLength"
          :placeholder="placeholder"
          @keydown.enter.prevent="save"
        />
        <button type="button" class="btn-action-primary opt-adder-save" :disabled="saving || !draft.trim()" @click="save">
          {{ saving ? '...' : 'Agregar' }}
        </button>
      </div>
      <p v-if="error" class="opt-adder-error">{{ error }}</p>

      <template v-if="mine.length">
        <p class="opt-adder-caption">Agregadas por el equipo</p>
        <ul class="opt-adder-list">
          <li v-for="o in mine" :key="o.id">
            <span>{{ o.label }}</span>
            <button
              type="button"
              class="opt-adder-remove"
              :disabled="removingId === o.id"
              :title="`Quitar ${o.label}`"
              :aria-label="`Quitar ${o.label}`"
              @click="remove(o)"
            >✕</button>
          </li>
        </ul>
      </template>
      <p class="opt-adder-hint">{{ hint }}</p>
    </div>
  </div>
</template>

<script setup>
/**
 * "＋ Agregar" junto a un desplegable de Finanzas: suma un área de la empresa
 * o una cuenta (banco) a la lista compartida del módulo y deja quitar las que
 * agregó el equipo. Las de fábrica no se ofrecen para quitar. Al agregar
 * emite `added` con el nombre guardado, para que el formulario la seleccione.
 */
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { addFinanceOption, customOptions, removeFinanceOption } from './incomeOptions.js';

const props = defineProps({
  kind: { type: String, required: true }, // 'area' | 'banco'
});
const emit = defineEmits(['added']);

const isBank = computed(() => props.kind === 'banco');
const noun = computed(() => (isBank.value ? 'una cuenta' : 'un área'));
const maxLength = computed(() => (isBank.value ? 20 : 120));
const placeholder = computed(() => (isBank.value ? 'Ej: BBVA, Yape...' : 'Ej: Logística'));
const hint = computed(() => (isBank.value
  ? 'La cuenta queda disponible en todo Finanzas y suma su propia tarjeta en el Resumen. Una cuenta con movimientos no se puede quitar.'
  : 'Quitar un área no cambia los asientos que ya la usan.'));

const mine = computed(() => customOptions.value.filter((o) => o.kind === props.kind));

const open = ref(false);
const draft = ref('');
const error = ref('');
const saving = ref(false);
const removingId = ref(null);
const rootEl = ref(null);
const inputEl = ref(null);

function onOutside(event) {
  if (rootEl.value && !rootEl.value.contains(event.target)) open.value = false;
}

async function toggle() {
  open.value = !open.value;
  error.value = '';
  if (open.value) {
    document.addEventListener('mousedown', onOutside);
    await nextTick();
    inputEl.value?.focus();
  } else {
    document.removeEventListener('mousedown', onOutside);
  }
}

async function save() {
  if (!draft.value.trim() || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    const label = await addFinanceOption(props.kind, draft.value);
    emit('added', label);
    draft.value = '';
    open.value = false;
    document.removeEventListener('mousedown', onOutside);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function remove(option) {
  removingId.value = option.id;
  error.value = '';
  try {
    await removeFinanceOption(option.id);
  } catch (e) {
    error.value = e.message;
  } finally {
    removingId.value = null;
  }
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside));
</script>

<style scoped>
.opt-adder {
  position: relative;
  display: inline-flex;
}

.opt-adder-toggle {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
  white-space: nowrap;
}

.opt-adder-toggle:hover,
.opt-adder-toggle:focus-visible {
  text-decoration: underline;
}

.opt-adder-panel {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  z-index: 30;
  width: min(280px, 80vw);
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
  box-shadow: var(--shadow-md);
  text-align: left;
}

.opt-adder-row {
  display: flex;
  gap: 0.4rem;
}

.opt-adder-input {
  flex: 1;
  min-width: 0;
}

.opt-adder-save {
  flex-shrink: 0;
}

.opt-adder-error {
  margin: 0.45rem 0 0;
  font-size: 0.78rem;
  color: var(--accent-rose);
}

.opt-adder-caption {
  margin: 0.65rem 0 0.25rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.opt-adder-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
}

.opt-adder-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.85rem;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-color);
}

.opt-adder-list li:last-child {
  border-bottom: none;
}

.opt-adder-remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
}

.opt-adder-remove:hover:not(:disabled) {
  color: var(--accent-rose);
  background: var(--bg-card-hover);
}

.opt-adder-hint {
  margin: 0.55rem 0 0;
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--text-muted);
}
</style>
