<template>
  <!--
    El filtro de fechas de las seis pestañas de Finanzas. Es un componente y no
    dos `<input type="date">` copiados en cada pantalla porque de él cuelgan
    tres cosas que tienen que ser iguales en todas: los atajos, el aviso de
    "estás mirando un recorte" y el no poder dejar un rango invertido.
  -->
  <div class="ledger-daterange" :class="{ 'is-active': Boolean(desde || hasta) }">
    <span class="ledger-daterange-icon" aria-hidden="true">📅</span>

    <label class="ledger-daterange-field">
      <span class="ledger-daterange-label">Desde</span>
      <input
        type="date"
        class="ledger-daterange-input"
        :value="desde"
        :max="hasta || undefined"
        :aria-label="`${noun}: desde`"
        @change="onDesde($event.target.value)"
      />
    </label>

    <span class="ledger-daterange-sep" aria-hidden="true">→</span>

    <label class="ledger-daterange-field">
      <span class="ledger-daterange-label">Hasta</span>
      <input
        type="date"
        class="ledger-daterange-input"
        :value="hasta"
        :min="desde || undefined"
        :aria-label="`${noun}: hasta`"
        @change="onHasta($event.target.value)"
      />
    </label>

    <!--
      Los atajos van en un desplegable y no en seis botones: la barra de cada
      pestaña ya lleva la búsqueda, el estado, el banco y los botones de alta, y
      seis pastillas más la parten en tres filas.
    -->
    <select
      class="ledger-daterange-preset"
      :value="activePreset"
      aria-label="Períodos frecuentes"
      @change="applyPreset($event.target.value)"
    >
      <option value="">Período…</option>
      <option v-for="p in RANGE_PRESETS" :key="p.key" :value="p.key">{{ p.label }}</option>
    </select>

    <button
      v-if="desde || hasta"
      type="button"
      class="ledger-daterange-clear"
      title="Quitar el filtro de fechas y volver a ver todo el histórico"
      @click="clear"
    >✕</button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { RANGE_PRESETS, matchingPreset, presetRange } from './dateRange.js';

const props = defineProps({
  desde: { type: String, default: '' },
  hasta: { type: String, default: '' },
  /** Cómo se nombra lo que se está filtrando, para las etiquetas de lectores de pantalla. */
  noun: { type: String, default: 'Fechas' }
});

const emit = defineEmits(['update:desde', 'update:hasta']);

const activePreset = computed(() => matchingPreset(props.desde, props.hasta));

/*
 * Un rango invertido no se rechaza con un error: se arrastra el otro extremo.
 * Los `min`/`max` de los inputs ya lo evitan en el calendario nativo, pero el
 * campo también se puede teclear, y una tabla vacía sin explicación se lee como
 * una pantalla rota en vez de como un rango imposible.
 */
function onDesde(value) {
  emit('update:desde', value || '');
  if (value && props.hasta && value > props.hasta) emit('update:hasta', value);
}

function onHasta(value) {
  emit('update:hasta', value || '');
  if (value && props.desde && value < props.desde) emit('update:desde', value);
}

function applyPreset(key) {
  const { desde, hasta } = presetRange(key);
  emit('update:desde', desde);
  emit('update:hasta', hasta);
}

function clear() {
  emit('update:desde', '');
  emit('update:hasta', '');
}
</script>
