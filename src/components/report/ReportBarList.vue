<template>
  <ul class="rbl" role="list">
    <li v-for="row in rows" :key="row.label" class="rbl-row">
      <div class="rbl-head">
        <span class="rbl-label">
          <span v-if="row.icon" class="rbl-icon" aria-hidden="true">{{ row.icon }}</span>
          {{ row.label }}
        </span>
        <strong class="rbl-value">{{ row.display }}</strong>
      </div>
      <div class="rbl-track" aria-hidden="true">
        <span
          class="rbl-bar"
          :style="{ width: `${barWidth(row.value)}%`, background: row.color || color }"
        ></span>
      </div>
      <div v-if="row.note" class="rbl-note">{{ row.note }}</div>
    </li>
    <li v-if="rows.length === 0" class="rbl-empty">{{ emptyText }}</li>
  </ul>
</template>

<script setup>
import { computed } from 'vue';

/**
 * Ranking en barras horizontales: el nombre y la cifra en texto, la barra solo
 * para comparar de un vistazo. Sirve para lo que tiene nombres largos
 * (canales, áreas de gasto, personas), que en un eje horizontal no entran.
 */
const props = defineProps({
  rows: { type: Array, required: true }, // [{ label, value, display, note?, color?, icon? }]
  color: { type: String, default: 'var(--viz-1)' },
  emptyText: { type: String, default: 'Sin datos en el período.' }
});

const max = computed(() => Math.max(0, ...props.rows.map((r) => Number(r.value) || 0)));
const barWidth = (v) => {
  if (!max.value) return 0;
  const pct = ((Number(v) || 0) / max.value) * 100;
  return pct > 0 ? Math.max(pct, 1.5) : 0;
};
</script>

<style scoped>
.rbl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
.rbl-head { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.82rem; }
.rbl-label { color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rbl-icon { margin-right: 0.25rem; }
.rbl-value { color: var(--text-main); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rbl-track {
  margin-top: 0.25rem;
  height: 8px;
  border-radius: 4px;
  background: var(--border-color);
  overflow: hidden;
}
.rbl-bar { display: block; height: 100%; border-radius: 4px; transition: width 0.3s ease; }
.rbl-note { margin-top: 0.2rem; font-size: 0.74rem; color: var(--text-muted); }
.rbl-empty { font-size: 0.82rem; color: var(--text-muted); }
</style>
