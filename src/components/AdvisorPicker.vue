<template>
  <!--
    Elegir a uno, a varios o a nadie del área comercial.

    Es un desplegable propio y no un <select multiple>: el nativo obliga a
    mantener Ctrl apretado para sumar a alguien —medio equipo lo descubre
    borrando su selección anterior— y en el celular se abre como una lista
    imposible de pintar. Acá cada fila es una casilla, y el botón resume a
    quién se eligió con sus círculos de iniciales, que es el mismo lenguaje con
    el que el panel dibuja a una persona en Proyectos y en los tableros.
  -->
  <div class="advisor-picker" ref="root">
    <button type="button" class="advisor-trigger" :class="{ 'is-open': isOpen }" @click="isOpen = !isOpen">
      <span v-if="selected.length === 0" class="advisor-trigger-label">Todo el equipo</span>
      <span v-else class="advisor-chips">
        <span
          v-for="advisor in selectedAdvisors.slice(0, 3)"
          :key="advisor.id"
          class="advisor-dot"
          :style="{ background: avatarColor(advisor.name) }"
          :title="advisor.name"
        >{{ initials(advisor.name) }}</span>
        <span v-if="selectedAdvisors.length > 3" class="advisor-dot is-more">+{{ selectedAdvisors.length - 3 }}</span>
        <span class="advisor-trigger-label">
          {{ selectedAdvisors.length === 1 ? selectedAdvisors[0].name : `${selectedAdvisors.length} asesores` }}
        </span>
      </span>
      <span class="advisor-caret">▾</span>
    </button>

    <div v-if="isOpen" class="advisor-menu">
      <button type="button" class="advisor-option is-all" @click="selectAll">
        <span class="advisor-option-name">Todo el equipo</span>
        <span v-if="selected.length === 0" class="advisor-check">✓</span>
      </button>

      <div class="advisor-menu-list custom-scrollbar">
        <label v-for="advisor in advisors" :key="advisor.id" class="advisor-option">
          <input
            type="checkbox"
            :checked="selected.includes(advisor.id)"
            @change="toggle(advisor.id)"
          />
          <span class="advisor-dot" :style="{ background: avatarColor(advisor.name) }">{{ initials(advisor.name) }}</span>
          <span class="advisor-option-name">{{ advisor.name }}</span>
          <span v-if="!advisor.google_connected" class="advisor-option-warn" title="Sin Google Calendar conectado">⚠️</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { avatarColor, initials } from '../avatars.js';

const props = defineProps({
  /** El área comercial. */
  advisors: { type: Array, default: () => [] },
  /** Ids elegidos; vacío = todo el equipo. */
  modelValue: { type: Array, default: () => [] }
});
const emit = defineEmits(['update:modelValue']);

const root = ref(null);
const isOpen = ref(false);

const selected = computed(() => props.modelValue || []);
const selectedAdvisors = computed(() => props.advisors.filter((a) => selected.value.includes(a.id)));

function toggle(id) {
  const actual = new Set(selected.value);
  if (actual.has(id)) actual.delete(id);
  else actual.add(id);
  emit('update:modelValue', [...actual]);
}

function selectAll() {
  emit('update:modelValue', []);
  isOpen.value = false;
}

// Cerrar al hacer clic afuera: sin esto el panel queda abierto tapando la
// grilla, que es justo lo que se está tratando de mirar.
function onDocumentClick(event) {
  if (isOpen.value && root.value && !root.value.contains(event.target)) isOpen.value = false;
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<style scoped>
.advisor-picker { position: relative; }

.advisor-trigger {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  color: var(--text-main);
  font-size: 0.78rem;
  cursor: pointer;
  max-width: 230px;
}

.advisor-trigger:hover,
.advisor-trigger.is-open { border-color: var(--primary); }

.advisor-trigger-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.advisor-chips { display: flex; align-items: center; gap: 0.25rem; min-width: 0; }
.advisor-caret { color: var(--text-muted); font-size: 0.7rem; }

.advisor-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.58rem;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.advisor-dot.is-more { background: var(--surface-2); color: var(--text-sub); }

.advisor-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 4px);
  right: 0;
  min-width: 240px;
  padding: 0.3rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

.advisor-menu-list { max-height: 260px; overflow-y: auto; }

.advisor-option {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  width: 100%;
  padding: 0.32rem 0.4rem;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-main);
  font-size: 0.78rem;
  text-align: left;
  cursor: pointer;
}

.advisor-option:hover { background: var(--surface-1); }
.advisor-option.is-all { border-bottom: 1px solid var(--border-color); border-radius: 0; margin-bottom: 0.25rem; }
.advisor-option input { accent-color: var(--primary); cursor: pointer; }
.advisor-option-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.advisor-option-warn { font-size: 0.7rem; }
.advisor-check { color: var(--primary); font-weight: 700; }
</style>
