<template>
  <!--
    La calificación comercial del lead: sí, no, o todavía sin revisar.

    Tres estados y no un interruptor, porque el vacío es un dato: es el que
    separa al lead que nadie miró del que se revisó y se descartó. Antes esta
    columna no existía —se derivaba de que el lead hubiera salido de "Nuevo"— y
    en la exportación de marketing decía "Sí" en 403 de 403 leads, con lo que
    no se podía medir la calidad de ningún anuncio.

    El criterio va ESCRITO y a la vista, no en la cabeza de cada uno: de la
    marca cuelga la decisión de cortarle el presupuesto a un anuncio, y dos
    personas calificando con criterios distintos vuelven la columna tan inútil
    como cuando decía "Sí" siempre.

    Vive en un componente porque las fichas de los dos tableros lo usan igual.
  -->
  <div class="lead-qualification">
    <div class="lq-row">
      <button
        v-for="option in OPTIONS"
        :key="String(option.value)"
        type="button"
        class="lq-btn"
        :class="[`lq-${option.key}`, { 'is-active': current === option.value }]"
        :disabled="saving"
        :title="option.title"
        @click.stop="choose(option.value)"
      >{{ option.label }}</button>
    </div>

    <p class="lq-meta">
      <template v-if="current === null">Sin calificar todavía</template>
      <template v-else>
        {{ current ? 'Calificado' : 'No calificado' }}
        <template v-if="lead.qualified_by_name"> por {{ lead.qualified_by_name }}</template>
        <template v-if="qualifiedOn"> · {{ qualifiedOn }}</template>
      </template>
      <button type="button" class="lq-help" @click.stop="showCriteria = !showCriteria">
        {{ showCriteria ? 'ocultar criterio' : 'ver criterio' }}
      </button>
    </p>

    <ul v-if="showCriteria" class="lq-criteria">
      <li v-for="item in QUALIFICATION_CRITERIA" :key="item">{{ item }}</li>
    </ul>

    <p v-if="error" class="lq-error">⚠️ {{ error }}</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { QUALIFICATION_CRITERIA } from '../leadQualificationCriteria.js';

const props = defineProps({
  lead: { type: Object, required: true }
});
const emit = defineEmits(['qualified']);

const OPTIONS = [
  { key: 'yes', value: true, label: 'Sí', title: 'Cumple el criterio: es un lead para trabajar' },
  { key: 'no', value: false, label: 'No', title: 'Revisado y descartado: no cumple el criterio' },
  { key: 'clear', value: null, label: '—', title: 'Volver a "sin calificar"' }
];

const saving = ref(false);
const error = ref('');
const showCriteria = ref(false);

/** `null` es un valor y no "falta el dato": hay que distinguirlo del `false`. */
const current = computed(() => {
  const value = props.lead?.qualified;
  return value === null || value === undefined ? null : !!value;
});

const qualifiedOn = computed(() => {
  if (!props.lead?.qualified_at) return '';
  const date = new Date(props.lead.qualified_at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'America/Lima' });
});

async function choose(value) {
  if (saving.value || current.value === value) return;
  saving.value = true;
  error.value = '';

  try {
    const { lead } = await apiFetch(`/api/leads/${props.lead.id}/qualified`, {
      method: 'PATCH',
      body: JSON.stringify({ qualified: value })
    });
    // El lead actualizado sube al tablero: la tarjeta y la ficha leen el mismo
    // objeto, así que refrescarlo acá dejaría las dos diciendo cosas distintas.
    emit('qualified', lead);
  } catch (e) {
    error.value = e.message || 'No se pudo guardar la calificación.';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.lead-qualification { display: flex; flex-direction: column; gap: 0.25rem; }

.lq-row { display: flex; gap: 0.25rem; }

.lq-btn {
  min-width: 2.25rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border-color, #d8dcc8);
  border-radius: 999px;
  background: var(--surface-2, #fff);
  color: var(--text-secondary, #5b6052);
  font: inherit;
  font-size: 0.78rem;
  line-height: 1.4;
  cursor: pointer;
}
.lq-btn:disabled { opacity: 0.6; cursor: default; }
.lq-yes.is-active { background: #2f6f3e; border-color: #2f6f3e; color: #fff; }
.lq-no.is-active { background: #9a3b36; border-color: #9a3b36; color: #fff; }
.lq-clear.is-active { background: var(--surface-3, #eceee3); color: var(--text-primary, #2c3028); }

.lq-meta {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-secondary, #6b7063);
}

.lq-help {
  margin-left: 0.35rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent, #4a6fa5);
  font: inherit;
  font-size: 0.72rem;
  text-decoration: underline;
  cursor: pointer;
}

.lq-criteria {
  margin: 0.1rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.72rem;
  color: var(--text-secondary, #6b7063);
}

.lq-error { margin: 0; font-size: 0.72rem; color: #9a3b36; }
</style>
