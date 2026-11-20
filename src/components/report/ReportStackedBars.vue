<template>
  <figure class="rsb">
    <div class="rsb-legend" role="list">
      <span v-for="s in series" :key="s.key" class="rsb-legend-item" role="listitem">
        <span class="rsb-swatch" :style="{ background: s.color }" aria-hidden="true"></span>
        {{ s.label }}
      </span>
    </div>

    <ul class="rsb-rows" role="list" @mouseleave="hover = null">
      <li v-for="row in rows" :key="row.key" class="rsb-row">
        <div class="rsb-head">
          <span class="rsb-label">{{ row.label }}</span>
          <strong class="rsb-total">{{ row.totalText || row.total }}</strong>
        </div>

        <div class="rsb-track">
          <template v-for="(s, i) in series" :key="s.key">
            <span
              v-if="row.values[s.key] > 0"
              class="rsb-seg"
              :class="{ 'is-first': isFirst(row, i), 'is-last': isLast(row, i) }"
              :style="{ width: `${share(row, s.key)}%`, background: s.color }"
              tabindex="0"
              :aria-label="`${row.label} · ${s.label}: ${row.values[s.key]} (${fmtShare(share(row, s.key))})`"
              @mouseenter="hover = { row: row.key, key: s.key }"
              @focus="hover = { row: row.key, key: s.key }"
              @blur="hover = null"
            >
              <!--
                La cifra va DENTRO del segmento cuando entra: es lo que releva el
                aviso de contraste de un relleno claro, y lo que hace que la
                identidad no dependa solo del color.
              -->
              <span v-if="share(row, s.key) >= 14" class="rsb-seg-value">{{ row.values[s.key] }}</span>
            </span>
          </template>
          <span v-if="!row.total" class="rsb-empty-track"></span>
        </div>

        <div class="rsb-note">
          <template v-if="row.total">
            <span v-for="s in presentSeries(row)" :key="s.key" class="rsb-chip">
              <span class="rsb-swatch" :style="{ background: s.color }" aria-hidden="true"></span>
              {{ s.label }} {{ row.values[s.key] }} ({{ fmtShare(share(row, s.key)) }})
            </span>
          </template>
          <span v-else>{{ emptyRowText }}</span>
        </div>

        <div
          v-if="hover && hover.row === row.key"
          class="rsb-tooltip"
          role="status"
        >
          <strong>{{ seriesOf(hover.key)?.label }}</strong>
          {{ row.values[hover.key] }} de {{ row.total }} · {{ fmtShare(share(row, hover.key)) }}
          <span v-if="row.hints?.[hover.key]" class="rsb-hint">{{ row.hints[hover.key] }}</span>
        </div>
      </li>
      <li v-if="rows.length === 0" class="rsb-no-rows">{{ emptyText }}</li>
    </ul>

    <details v-if="rows.length" class="rsb-table">
      <summary>Ver tabla</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ categoryLabel }}</th>
            <th v-for="s in series" :key="s.key" scope="col">{{ s.label }}</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <th scope="row">{{ row.label }}</th>
            <td v-for="s in series" :key="s.key">{{ row.values[s.key] || 0 }}</td>
            <td>{{ row.total }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<script setup>
import { ref } from 'vue';

/**
 * Barras apiladas al 100%: una fila por persona, y dentro la composición de sus
 * leads.
 *
 * Es al 100% y no a escala porque lo que se compara es la COMPOSICIÓN —quién
 * tiene su cartera trabada y quién la cierra—, y con barras a escala la fila del
 * que más leads tiene tapa a todas las demás. Lo que se pierde así es el tamaño,
 * y por eso el total va escrito al lado del nombre: sin él, tres leads se ven
 * igual que ochenta.
 *
 * Tres cosas que no son decoración: los segmentos van separados por 2 px de
 * fondo (pegados, dos rellenos contiguos se leen como uno solo), cada uno lleva
 * su cifra escrita cuando entra —y todos la llevan en los chips de abajo—, y hay
 * tabla: la identidad de un segmento nunca depende solo de su color.
 */
const props = defineProps({
  // [{ key, label, total, totalText?, values: { [serieKey]: n }, hints? }]
  rows: { type: Array, required: true },
  // [{ key, label, color }] — el ORDEN es el de los segmentos, de izquierda a
  // derecha. Los colores validados van en la vista, no acá.
  series: { type: Array, required: true },
  categoryLabel: { type: String, default: 'Persona' },
  emptyText: { type: String, default: 'Sin datos en el período.' },
  emptyRowText: { type: String, default: 'Sin leads en el período.' }
});

const hover = ref(null);

const seriesOf = (key) => props.series.find((s) => s.key === key) || null;
const presentSeries = (row) => props.series.filter((s) => row.values[s.key] > 0);
const share = (row, key) => (row.total ? ((Number(row.values[key]) || 0) / row.total) * 100 : 0);
const fmtShare = (value) => `${(Math.round(value * 10) / 10).toString().replace('.', ',')}%`;

/** Las esquinas redondeadas van solo en los extremos visibles de la barra. */
const visibleKeys = (row) => props.series.filter((s) => row.values[s.key] > 0).map((s) => s.key);
const isFirst = (row, i) => visibleKeys(row)[0] === props.series[i].key;
const isLast = (row, i) => visibleKeys(row).at(-1) === props.series[i].key;
</script>

<style scoped>
.rsb { margin: 0; }
.rsb-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin-bottom: 0.6rem;
  font-size: 0.78rem;
  color: var(--text-sub);
}
.rsb-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
.rsb-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.rsb-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.85rem; }
.rsb-row { position: relative; }
.rsb-head { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.82rem; }
.rsb-label { color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rsb-total { color: var(--text-main); font-variant-numeric: tabular-nums; white-space: nowrap; }

.rsb-track {
  display: flex;
  gap: 2px;
  margin-top: 0.3rem;
  height: 20px;
}
.rsb-seg {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 3px;
  transition: width 0.3s ease;
  cursor: default;
}
.rsb-seg.is-first { border-radius: 4px 0 0 4px; }
.rsb-seg.is-last { border-radius: 0 4px 4px 0; }
.rsb-seg.is-first.is-last { border-radius: 4px; }
.rsb-seg:focus-visible { outline: 2px solid var(--text-main); outline-offset: 1px; }
.rsb-seg-value {
  font-size: 0.7rem;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}
.rsb-empty-track { flex: 1; border-radius: 4px; background: var(--border-color); }

.rsb-note {
  margin-top: 0.3rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.75rem;
  font-size: 0.73rem;
  color: var(--text-muted);
}
.rsb-chip { display: inline-flex; align-items: center; gap: 0.3rem; }

.rsb-tooltip {
  position: absolute;
  right: 0;
  top: -0.3rem;
  padding: 0.35rem 0.6rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-size: 0.76rem;
  color: var(--text-sub);
  pointer-events: none;
  z-index: 5;
}
.rsb-tooltip strong { color: var(--text-main); margin-right: 0.3rem; }
.rsb-hint { display: block; color: var(--text-muted); }

.rsb-no-rows { font-size: 0.82rem; color: var(--text-muted); }
.rsb-table { margin-top: 0.6rem; font-size: 0.78rem; color: var(--text-muted); }
.rsb-table summary { cursor: pointer; width: fit-content; }
.rsb-table table { width: 100%; margin-top: 0.4rem; border-collapse: collapse; }
.rsb-table th, .rsb-table td {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid var(--border-color);
  text-align: right;
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}
.rsb-table th:first-child { text-align: left; font-weight: 500; }
</style>
