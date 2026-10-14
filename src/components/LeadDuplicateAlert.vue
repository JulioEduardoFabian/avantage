<template>
  <div v-if="checking" class="dup-checking">Verificando si ya está registrado…</div>

  <div v-else-if="duplicates.length" class="dup-alert" role="alert">
    <div class="dup-alert-head">
      <span class="dup-alert-icon">⚠️</span>
      <div>
        <strong>{{ headline }}</strong>
        <p class="dup-alert-sub">{{ advice }}</p>
      </div>
    </div>

    <ul class="dup-list">
      <li v-for="lead in duplicates" :key="lead.id" class="dup-item">
        <div class="dup-item-main">
          <span class="dup-item-name">{{ lead.full_name || `Lead #${lead.id}` }}</span>
          <span class="dup-item-why">{{ reasonsLabel(lead.reasons) }}</span>
        </div>
        <div class="dup-item-meta">
          <span>{{ lead.phone || 'sin celular' }}</span>
          <span v-if="lead.dni">· DNI {{ lead.dni }}</span>
          <span v-if="lead.source">· {{ lead.source }}</span>
          <span v-if="lead.created_at">· cargado el {{ formatDate(lead.created_at) }}</span>
        </div>
        <div class="dup-item-owner">
          <span>{{ lead.assigned_user_name ? `A cargo de ${lead.assigned_user_name}` : 'Sin responsable asignado' }}</span>
          <!-- El botón se ofrece solo si la ficha está de verdad en esta
               pantalla (`openableIds`): el duplicado suele ser de otra persona
               del equipo, y ofrecer abrir algo que el servidor le va a negar es
               peor que no ofrecer nada. -->
          <button v-if="openableIds.includes(lead.id)" type="button" class="dup-item-link" @click="emit('open', lead)">
            Ver su ficha →
          </button>
          <span v-else-if="!lead.visible" class="dup-item-hidden">No está en tu cartera; pídela a quien reparte los leads.</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { reasonsLabel } from '../leadDuplicateCheck.js';

const emit = defineEmits(['open']);

/*
 * El aviso de "esta persona ya está cargada", compartido por los formularios
 * de alta manual (Setter Funnel, Funnel de Ventas y la ficha de la Base de
 * Datos). Es un componente y no un bloque copiado en cada vista porque el
 * criterio de qué se le muestra de una ficha ajena —nombre, dato repetido, de
 * quién es; nunca el lead entero— tiene que ser el mismo en todas.
 */
const props = defineProps({
  duplicates: { type: Array, default: () => [] },
  checking: { type: Boolean, default: false },
  /* Los ids que esta pantalla puede abrir con sus propios datos ya cargados.
     Lo decide la vista y no el componente: cada tablero muestra un subconjunto
     distinto de leads. */
  openableIds: { type: Array, default: () => [] },
  /* En la edición de una ficha el mensaje es otro: no es "no lo cargues", es
     "ese dato ya es de otra ficha". */
  mode: { type: String, default: 'create' }
});

const headline = computed(() => {
  const n = props.duplicates.length;
  if (props.mode === 'edit') {
    return n === 1
      ? 'Ese dato ya es de otra ficha'
      : `Ese dato ya es de otras ${n} fichas`;
  }
  return n === 1
    ? 'Esta persona ya está registrada'
    : `Hay ${n} fichas registradas con estos datos`;
});

const advice = computed(() =>
  props.mode === 'edit'
    ? 'Corrige el celular o el DNI: dos fichas con el mismo dato son la misma persona dos veces.'
    : 'No se carga dos veces: trabaja sobre la ficha que ya existe.'
);

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}
</script>

<style scoped>
.dup-checking {
  font-size: 0.78rem;
  color: var(--text-muted);
  padding: 0.3rem 0;
}

.dup-alert {
  border: 1px solid var(--accent-rose);
  border-left-width: 4px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-rose) 8%, transparent);
  padding: 0.65rem 0.75rem;
  margin-bottom: 0.65rem;
}

.dup-alert-head {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
}

.dup-alert-icon { font-size: 1rem; line-height: 1.2; }

.dup-alert-head strong {
  font-size: 0.86rem;
  color: var(--text-main);
}

.dup-alert-sub {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--text-sub);
}

.dup-list {
  list-style: none;
  margin: 0.55rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dup-item {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.55rem;
}

.dup-item-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
}

.dup-item-name {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text-main);
}

.dup-item-why {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--accent-rose);
  border: 1px solid var(--accent-rose);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
}

.dup-item-meta,
.dup-item-owner {
  font-size: 0.75rem;
  color: var(--text-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.dup-item-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: var(--primary);
  font-weight: 600;
  text-decoration: none;
}

.dup-item-link:hover { text-decoration: underline; }

.dup-item-hidden { font-style: italic; }
</style>
