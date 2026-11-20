<template>
  <figure class="rbc">
    <div v-if="series.length > 1" class="rbc-legend" role="list">
      <span v-for="s in series" :key="s.key" class="rbc-legend-item" role="listitem">
        <span class="rbc-swatch" :style="{ background: s.color }" aria-hidden="true"></span>
        {{ s.label }}
      </span>
    </div>

    <div ref="wrap" class="rbc-plot" @mouseleave="hoverIdx = null">
      <svg
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="ariaLabel"
      >
        <!-- Grilla y eje: recesivos, solo para estimar -->
        <g>
          <template v-for="tick in ticks" :key="tick">
            <line
              :x1="PAD.left" :x2="width - PAD.right"
              :y1="y(tick)" :y2="y(tick)"
              :stroke="tick === 0 ? 'var(--border-strong)' : 'var(--border-color)'"
              :stroke-dasharray="tick === 0 ? '' : '3 4'"
              stroke-width="1"
            />
            <text :x="PAD.left - 8" :y="y(tick) + 4" text-anchor="end" class="rbc-axis">
              {{ axisFormat(tick) }}
            </text>
          </template>
        </g>

        <!-- Fondo del grupo bajo el cursor -->
        <rect
          v-if="hoverIdx !== null"
          :x="groupX(hoverIdx)" :y="PAD.top"
          :width="groupW" :height="plotH"
          class="rbc-hover-band"
        />

        <g v-for="(label, i) in labels" :key="label">
          <path
            v-for="(s, k) in series"
            :key="s.key"
            :d="barPath(i, k, s.values[i])"
            :fill="barColor(s, s.values[i])"
          />
          <text
            :x="groupX(i) + groupW / 2"
            :y="height - 8"
            text-anchor="middle"
            class="rbc-axis"
          >{{ showLabel(i) ? label : '' }}</text>
        </g>

        <!-- Etiqueta directa solo en el último grupo: el mes en curso -->
        <template v-if="labels.length && series.length <= 2">
          <text
            v-for="(s, k) in series"
            :key="`last-${s.key}`"
            :x="barX(labels.length - 1, k) + barW / 2"
            :y="valueLabelY(s.values[labels.length - 1])"
            text-anchor="middle"
            class="rbc-value"
          >{{ compactFormat(s.values[labels.length - 1]) }}</text>
        </template>

        <!-- Zonas de hover más grandes que la barra -->
        <rect
          v-for="(label, i) in labels"
          :key="`hit-${label}`"
          :x="groupX(i)" :y="0"
          :width="groupW" :height="height"
          fill="transparent"
          @mouseenter="hoverIdx = i"
          @focus="hoverIdx = i"
          @blur="hoverIdx = null"
          tabindex="0"
          :aria-label="`${label}: ${series.map((s) => `${s.label} ${format(s.values[i])}`).join(', ')}`"
        />
      </svg>

      <div
        v-if="hoverIdx !== null"
        class="rbc-tooltip"
        :style="tooltipStyle"
        role="status"
      >
        <div class="rbc-tooltip-title">{{ tooltipTitles?.[hoverIdx] || labels[hoverIdx] }}</div>
        <div v-for="s in series" :key="s.key" class="rbc-tooltip-row">
          <span class="rbc-swatch" :style="{ background: barColor(s, s.values[hoverIdx]) }"></span>
          <span class="rbc-tooltip-label">{{ s.label }}</span>
          <strong>{{ format(s.values[hoverIdx]) }}</strong>
        </div>
        <div v-for="extra in (extraRows?.[hoverIdx] || [])" :key="extra.label" class="rbc-tooltip-row is-extra">
          <span class="rbc-tooltip-label">{{ extra.label }}</span>
          <strong>{{ extra.value }}</strong>
        </div>
      </div>
    </div>

    <details class="rbc-table">
      <summary>Ver tabla</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ categoryLabel }}</th>
            <th v-for="s in series" :key="s.key" scope="col">{{ s.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(label, i) in labels" :key="label">
            <th scope="row">{{ tooltipTitles?.[i] || label }}</th>
            <td v-for="s in series" :key="s.key">{{ format(s.values[i]) }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { niceAxisMax } from '../../views/finance/chartGeometry.js';

/**
 * Barras verticales para el Reporte General: una o dos series en la MISMA
 * unidad (nunca dos ejes), con valores negativos hacia abajo cuando los hay
 * — el resultado de un mes en pérdida tiene que verse debajo de la línea.
 *
 * La geometría se calcula con el ancho real del contenedor en vez de estirar
 * un viewBox fijo: estirado, el texto del eje se deforma.
 */
const props = defineProps({
  labels: { type: Array, required: true },
  tooltipTitles: { type: Array, default: null },
  series: { type: Array, required: true }, // [{ key, label, color, negativeColor?, values }]
  extraRows: { type: Array, default: null }, // por grupo: [{ label, value }]
  format: { type: Function, default: (v) => String(v) },
  compactFormat: { type: Function, default: (v) => String(v) },
  axisFormat: { type: Function, default: (v) => String(v) },
  height: { type: Number, default: 230 },
  ariaLabel: { type: String, default: 'Gráfico de barras' },
  categoryLabel: { type: String, default: 'Mes' }
});

const PAD = { top: 18, right: 8, bottom: 28, left: 58 };
const GAP = 2;

const wrap = ref(null);
const width = ref(600);
const hoverIdx = ref(null);
let observer = null;

onMounted(() => {
  const measure = () => { if (wrap.value) width.value = Math.max(260, wrap.value.clientWidth); };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(wrap.value);
});
onBeforeUnmount(() => observer?.disconnect());

const plotW = computed(() => width.value - PAD.left - PAD.right);
const plotH = computed(() => props.height - PAD.top - PAD.bottom);
const allValues = computed(() => props.series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
const yMax = computed(() => niceAxisMax(Math.max(0, ...allValues.value)));
const yMin = computed(() => {
  const low = Math.min(0, ...allValues.value);
  return low < 0 ? -niceAxisMax(-low) : 0;
});
const ticks = computed(() => {
  const list = [0, yMax.value / 2, yMax.value];
  if (yMin.value < 0) list.push(yMin.value / 2, yMin.value);
  return list;
});
const y = (v) => PAD.top + ((yMax.value - v) / (yMax.value - yMin.value)) * plotH.value;

const groupW = computed(() => plotW.value / Math.max(1, props.labels.length));
const groupX = (i) => PAD.left + i * groupW.value;
const barW = computed(() => {
  const k = props.series.length;
  return Math.max(4, Math.min(30, (groupW.value * 0.7 - GAP * (k - 1)) / k));
});
const barX = (i, k) => {
  const total = barW.value * props.series.length + GAP * (props.series.length - 1);
  return groupX(i) + (groupW.value - total) / 2 + k * (barW.value + GAP);
};

/** Barra con el extremo de datos redondeado (4 px) y la base recta, anclada al cero. */
function barPath(i, k, raw) {
  const v = Number(raw) || 0;
  if (v === 0) return '';
  const x = barX(i, k);
  const w = barW.value;
  const base = y(0);
  const end = y(v);
  const r = Math.min(4, w / 2, Math.abs(base - end));
  if (v > 0) {
    return `M${x},${base} V${end + r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end + r} V${base} Z`;
  }
  return `M${x},${base} V${end - r} Q${x},${end} ${x + r},${end} H${x + w - r} Q${x + w},${end} ${x + w},${end - r} V${base} Z`;
}

const barColor = (s, v) => ((Number(v) || 0) < 0 && s.negativeColor ? s.negativeColor : s.color);
const valueLabelY = (v) => ((Number(v) || 0) < 0 ? y(v) + 13 : y(v) - 5);

// Con muchos meses en poco ancho, se rotula uno de cada dos.
const showLabel = (i) => groupW.value >= 44 || i % 2 === (props.labels.length - 1) % 2;

const tooltipStyle = computed(() => {
  const center = groupX(hoverIdx.value) + groupW.value / 2;
  const left = Math.min(Math.max(center, 90), width.value - 90);
  return { left: `${left}px` };
});
</script>

<style scoped>
.rbc { margin: 0; }
.rbc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin-bottom: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-sub);
}
.rbc-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
.rbc-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}
.rbc-plot { position: relative; width: 100%; }
.rbc-plot svg { display: block; overflow: visible; }
.rbc-plot rect[tabindex]:focus { outline: none; }
.rbc-axis { font-size: 10.5px; fill: var(--text-muted); font-family: var(--font-body); }
.rbc-value { font-size: 10.5px; font-weight: 600; fill: var(--text-sub); font-family: var(--font-body); }
.rbc-hover-band { fill: var(--text-main); opacity: 0.05; }
.rbc-tooltip {
  position: absolute;
  top: 0;
  transform: translate(-50%, -6px);
  min-width: 170px;
  padding: 0.5rem 0.65rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-size: 0.78rem;
  pointer-events: none;
  z-index: 5;
}
.rbc-tooltip-title { font-weight: 600; color: var(--text-main); margin-bottom: 0.3rem; }
.rbc-tooltip-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-sub);
  line-height: 1.6;
}
.rbc-tooltip-row strong { margin-left: auto; color: var(--text-main); font-variant-numeric: tabular-nums; }
.rbc-tooltip-row.is-extra { border-top: 1px dashed var(--border-color); margin-top: 0.2rem; padding-top: 0.2rem; }
.rbc-tooltip-label { white-space: nowrap; }
.rbc-table { margin-top: 0.35rem; font-size: 0.78rem; color: var(--text-muted); }
.rbc-table summary { cursor: pointer; width: fit-content; }
.rbc-table table { width: 100%; margin-top: 0.4rem; border-collapse: collapse; }
.rbc-table th, .rbc-table td {
  padding: 0.25rem 0.4rem;
  border-bottom: 1px solid var(--border-color);
  text-align: right;
  color: var(--text-sub);
  font-variant-numeric: tabular-nums;
}
.rbc-table th:first-child { text-align: left; font-weight: 500; }
</style>
