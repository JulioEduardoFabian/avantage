<template>
  <!--
    El horario de disponibilidad de un asesor, de SOLO lectura.

    Existe porque agendarle a otro (lo que el Calendario ya permite) obligaba a
    preguntarle por WhatsApp a qué hora puede: el dato ya estaba en el panel,
    pero solo lo veía su dueño en "Mi Disponibilidad".

    Se muestran los bloques **unidos en rangos** ("09:00 a 13:00") y no la
    grilla de media hora: quien mira esto está por elegir una hora, y
    veintiocho casillas pintadas se leen peor que una frase. Pintarlo sigue
    siendo de cada uno en su propia pantalla — acá no se edita nada.
  -->
  <div v-if="modelValue" class="modal-overlay" @click.self="close">
    <div class="modal-content availability-peek">
      <div class="modal-header">
        <h3 class="modal-title">🕘 Horario de disponibilidad</h3>
        <button class="modal-close-btn" @click="close">✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Asesor</label>
          <select v-model="advisorId" class="form-select" @change="load">
            <option v-for="advisor in advisors" :key="advisor.id" :value="advisor.id">{{ advisor.name }}</option>
          </select>
        </div>

        <p v-if="errorMessage" class="info-box peek-alert">⚠️ {{ errorMessage }}</p>
        <p v-else-if="isLoading" class="peek-state">Cargando el horario…</p>
        <p v-else-if="!hasAny" class="peek-state">
          {{ advisorName }} todavía no marcó ningún bloque disponible. Cada quien pinta el suyo en
          <strong>Disponibilidad</strong>.
        </p>

        <ul v-else class="peek-days">
          <li v-for="day in DAYS" :key="day.value" class="peek-day" :class="{ 'is-empty': !ranges[day.value] }">
            <span class="peek-day-name">{{ day.label }}</span>
            <span v-if="ranges[day.value]" class="peek-day-ranges">
              <span v-for="rango in ranges[day.value]" :key="rango" class="peek-range">{{ rango }}</span>
            </span>
            <span v-else class="peek-day-none">No disponible</span>
          </li>
        </ul>

        <p class="peek-foot">
          Es el horario semanal que repite todas las semanas, no las reuniones ya tomadas: esas se
          ven en la grilla del calendario.
        </p>

        <div class="peek-actions">
          <button type="button" class="btn-action-ghost" @click="close">Cerrar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { DAYS, formatRange, mergeRanges, minutesOf } from '../availabilityGrid.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** El área comercial, ya cargada por la pantalla que abre el modal. */
  advisors: { type: Array, default: () => [] },
  /** A quién mostrar al abrir. */
  advisorUserId: { type: [Number, String], default: null }
});
const emit = defineEmits(['update:modelValue']);

const advisorId = ref(null);
const slots = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');

const advisorName = computed(
  () => props.advisors.find((a) => a.id === advisorId.value)?.name || 'Esta persona'
);

/**
 * Los bloques de media hora unidos en rangos corridos, por día. La cuenta vive
 * en `availabilityGrid.js` porque el Calendario hace exactamente la misma para
 * pintar el cruce de varios asesores.
 */
const ranges = computed(() => {
  const porDia = {};
  for (const slot of slots.value) {
    (porDia[slot.day_of_week] ||= []).push(minutesOf(slot.start_time));
  }

  const resultado = {};
  for (const [dia, minutos] of Object.entries(porDia)) {
    resultado[Number(dia)] = mergeRanges(minutos).map(formatRange);
  }
  return resultado;
});

const hasAny = computed(() => slots.value.length > 0);

async function load() {
  if (!advisorId.value) return;
  isLoading.value = true;
  errorMessage.value = '';
  slots.value = [];
  try {
    const response = await apiFetch(`/api/availability/${advisorId.value}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el horario.');
    slots.value = data.slots || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.modelValue, (abierto) => {
  if (!abierto) return;
  const pedido = props.advisorUserId ? Number(props.advisorUserId) : null;
  advisorId.value = props.advisors.some((a) => a.id === pedido) ? pedido : props.advisors[0]?.id || null;
  load();
});

function close() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.availability-peek { max-width: 480px; }

.peek-state {
  margin: 0.75rem 0 0;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.peek-alert {
  margin-top: 0.75rem;
  border-color: rgba(200, 85, 50, 0.4);
  background: rgba(200, 85, 50, 0.08);
}

.peek-days {
  list-style: none;
  margin: 0.75rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.peek-day {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.peek-day.is-empty { opacity: 0.55; }

.peek-day-name {
  font-size: 0.78rem;
  font-weight: 600;
  min-width: 84px;
  color: var(--text-main);
}

.peek-day-ranges { display: flex; flex-wrap: wrap; gap: 0.25rem; }

.peek-range {
  font-size: 0.74rem;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  background: rgba(111, 129, 37, 0.18);
  color: var(--text-sub);
  white-space: nowrap;
}

.peek-day-none { font-size: 0.74rem; color: var(--text-muted); }

.peek-foot {
  margin: 0.7rem 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.peek-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}
</style>
