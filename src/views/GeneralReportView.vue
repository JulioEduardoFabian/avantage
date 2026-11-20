<template>
  <main class="container-fluid general-report-page">
    <header class="gr-header">
      <div>
        <h2 class="section-heading">
          <span class="heading-icon">📊</span> Reporte General
        </h2>
        <p class="section-subheading">
          Ventas, caja, cartera y embudo comercial en un solo lugar. Cada cifra se compara con
          el período anterior de la misma duración.
        </p>
      </div>
      <div class="gr-controls">
        <div class="gr-segmented" role="group" aria-label="Período del reporte">
          <button
            v-for="option in PERIODS"
            :key="option"
            type="button"
            :class="{ 'is-active': months === option }"
            :aria-pressed="months === option"
            @click="months = option"
          >{{ option }} meses</button>
        </div>
        <button class="btn-action-secondary" :disabled="isLoading" @click="load">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando…' : 'Actualizar' }}
        </button>
      </div>
    </header>

    <div v-if="error" class="gr-error" role="alert">{{ error }}</div>

    <template v-if="report">
      <p class="gr-period">
        Período: <strong>{{ periodLabel(report.period.months) }}</strong>
        · comparado con {{ periodLabel(report.period.previous) }}
      </p>

      <!-- Lo que hay que saber antes de mirar los gráficos -->
      <section v-if="highlights.length" class="gr-highlights" aria-label="Puntos clave">
        <div v-for="h in highlights" :key="h.text" class="gr-highlight" :class="`is-${h.tone}`">
          <span class="gr-highlight-icon" aria-hidden="true">{{ h.icon }}</span>
          <span>{{ h.text }}</span>
        </div>
      </section>

      <!-- KPIs -->
      <section class="gr-kpis">
        <article v-for="tile in kpiTiles" :key="tile.key" class="gr-kpi" :class="`is-kpi-${tile.key}`">
          <span class="gr-kpi-label">{{ tile.label }}</span>
          <span class="gr-kpi-value" :class="tile.valueClass">{{ tile.value }}</span>
          <span v-if="tile.delta" class="gr-kpi-delta" :class="`is-${tile.delta.tone}`">
            <span aria-hidden="true">{{ tile.delta.arrow }}</span>
            {{ tile.delta.text }}
            <span class="gr-kpi-prev">vs. {{ tile.previous }}</span>
          </span>
          <span v-if="tile.note" class="gr-kpi-note">{{ tile.note }}</span>
        </article>
      </section>

      <!-- Ingresos -->
      <h3 class="gr-section-title">Ingresos y rentabilidad</h3>
      <section class="gr-grid">
        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Vendido vs. cobrado</h4>
            <p>Precio pactado de las ventas cerradas cada mes, frente al dinero que efectivamente
              entró a caja. Si lo vendido corre muy por delante de lo cobrado, la venta se está
              financiando con crédito al cliente.</p>
          </header>
          <ReportBarChart
            :labels="monthLabels"
            :tooltip-titles="monthTitles"
            :series="[
              { key: 'sales', label: 'Vendido', color: 'var(--viz-1)', values: report.monthly.sales },
              { key: 'cash', label: 'Cobrado', color: 'var(--viz-2)', values: report.monthly.cashIn }
            ]"
            :extra-rows="report.monthly.deals.map((d) => [{ label: 'Ventas cerradas', value: d }])"
            :format="money"
            :compact-format="moneyCompact"
            :axis-format="moneyCompact"
            aria-label="Vendido frente a cobrado por mes"
          />
        </article>

        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Resultado neto mensual</h4>
            <p>Lo cobrado menos todo lo que salió (libro diario, planilla, comisiones e ITF) —
              las mismas cifras de Finanzas. Debajo de la línea, el mes cerró en pérdida.</p>
          </header>
          <ReportBarChart
            :labels="monthLabels"
            :tooltip-titles="monthTitles"
            :series="[
              {
                key: 'net',
                label: 'Resultado neto',
                color: 'var(--viz-1)',
                negativeColor: 'var(--status-critical)',
                values: report.monthly.net
              }
            ]"
            :extra-rows="report.monthly.months.map((_, i) => [
              { label: 'Ingresos', value: money(report.monthly.cashIn[i]) },
              { label: 'Egresos', value: money(report.monthly.cashOut[i]) }
            ])"
            :format="money"
            :compact-format="moneyCompact"
            :axis-format="moneyCompact"
            aria-label="Resultado neto por mes"
          />
        </article>

        <article class="gr-card">
          <header class="gr-card-head">
            <h4>¿En qué se va el dinero?</h4>
            <p>Egresos pagados en el período, por destino. Las áreas salen del Libro Diario;
              planilla y comisiones de sus pestañas en Finanzas.</p>
          </header>
          <ReportBarList :rows="expenseRows" color="var(--viz-2)" empty-text="Sin egresos pagados en el período." />
        </article>

        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Ventas por closer</h4>
            <p>Monto pactado de las ventas que cerró cada persona en el período.</p>
          </header>
          <ReportBarList :rows="closerRows" empty-text="Sin ventas cerradas en el período." />
        </article>
      </section>

      <!-- Cartera -->
      <h3 class="gr-section-title">Cartera y cobranza</h3>
      <section class="gr-grid">
        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Cartera por antigüedad</h4>
            <p>Cuotas pendientes de pago según cuántos días pasaron desde su fecha pactada.
              Mientras más vieja la deuda, más difícil cobrarla.</p>
          </header>
          <div class="gr-mini-stats">
            <div>
              <span>Por cobrar</span>
              <strong>{{ money(report.receivables.total) }}</strong>
            </div>
            <div>
              <span>Vencido</span>
              <strong class="text-critical">{{ money(report.receivables.overdue) }}</strong>
            </div>
            <div>
              <span>Pagado, falta verificar</span>
              <strong>{{ money(report.receivables.toVerify.amount) }}</strong>
            </div>
          </div>
          <ReportBarList :rows="agingRows" empty-text="No hay cuotas pendientes." />
        </article>

        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Proyección de cobros</h4>
            <p>Lo que vence en los próximos meses según el cronograma pactado, más lo ya vencido
              que todavía se puede recuperar.</p>
          </header>
          <ReportBarChart
            :labels="projectionLabels"
            :tooltip-titles="projectionTitles"
            :series="[
              {
                key: 'projection',
                label: 'Por cobrar',
                color: 'var(--viz-1)',
                values: projectionValues
              }
            ]"
            :format="money"
            :compact-format="moneyCompact"
            :axis-format="moneyCompact"
            category-label="Vencimiento"
            aria-label="Proyección de cobros por mes de vencimiento"
          />
          <p class="gr-footnote">La primera barra («Vencido») es deuda atrasada, no un mes.</p>
        </article>

        <article class="gr-card gr-card-wide">
          <header class="gr-card-head">
            <h4>Efectividad de cobranza</h4>
            <p>De las cuotas que vencían cada mes, cuánto ya pagó el cliente. Un mes reciente
              bajo puede ser normal; uno viejo bajo es plata que se está perdiendo.</p>
          </header>
          <ReportBarChart
            :labels="monthLabels"
            :tooltip-titles="monthTitles"
            :series="[
              { key: 'due', label: 'Pactado', color: 'var(--viz-2)', values: report.collectionRate.map((r) => r.pactado) },
              { key: 'paid', label: 'Pagado', color: 'var(--viz-1)', values: report.collectionRate.map((r) => r.cobrado) }
            ]"
            :extra-rows="report.collectionRate.map((r) => [{ label: 'Efectividad', value: pct(r.rate) }])"
            :format="money"
            :compact-format="moneyCompact"
            :axis-format="moneyCompact"
            category-label="Mes de vencimiento"
            aria-label="Cuotas pactadas frente a pagadas por mes de vencimiento"
          />
        </article>
      </section>

      <!-- Comercial -->
      <h3 class="gr-section-title">Embudo comercial</h3>
      <section class="gr-grid">
        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Embudo de conversión</h4>
            <p>Los leads que entraron en el período y hasta dónde llegaron. Los más recientes
              todavía pueden avanzar, así que el último tramo crece con el tiempo.</p>
          </header>
          <ol class="gr-funnel">
            <li v-for="(step, i) in report.funnel" :key="step.label" class="gr-funnel-step">
              <div class="gr-funnel-head">
                <span>{{ step.label }}</span>
                <strong>{{ integer(step.count) }}</strong>
              </div>
              <div class="gr-funnel-track" aria-hidden="true">
                <span class="gr-funnel-bar" :style="{ width: funnelWidth(step) }"></span>
              </div>
              <div v-if="i > 0" class="gr-funnel-note">
                {{ pct(step.ofPrevious) }} de la etapa anterior · {{ pct(step.ofTotal) }} del total
              </div>
            </li>
          </ol>
        </article>

        <article class="gr-card">
          <header class="gr-card-head">
            <h4>Canales de captación</h4>
            <p>Leads del período por origen, con cuántos terminaron en venta. Un canal con mucho
              volumen y poca conversión trae ruido; uno chico con alta conversión merece más
              inversión.</p>
          </header>
          <ReportBarList :rows="channelRows" empty-text="Sin leads en el período." />
        </article>

        <article class="gr-card gr-card-wide">
          <header class="gr-card-head">
            <h4>Leads nuevos por mes</h4>
            <p>Volumen de contactos que entran al sistema: la materia prima de las ventas de los
              meses siguientes.</p>
          </header>
          <ReportBarChart
            :labels="monthLabels"
            :tooltip-titles="monthTitles"
            :series="[{ key: 'leads', label: 'Leads nuevos', color: 'var(--viz-2)', values: report.monthly.newLeads }]"
            :extra-rows="report.monthly.deals.map((d) => [{ label: 'Ventas cerradas en el mes', value: d }])"
            :format="integer"
            :compact-format="integer"
            :axis-format="integer"
            :height="190"
            aria-label="Leads nuevos por mes"
          />
        </article>
      </section>

      <section class="gr-notes">
        <p v-if="report.cancelled.count">
          ↩️ {{ report.cancelled.count }} {{ report.cancelled.count === 1 ? 'venta no se concretó' : 'ventas no se concretaron' }}
          en el período ({{ money(report.cancelled.amount) }}): no cuentan como vendido ni como cartera.
        </p>
        <p v-if="obligationsTotal > 0">
          ⏳ Obligaciones devengadas sin pagar: {{ money(report.obligations.salarios) }} de planilla
          y {{ money(report.obligations.comisiones) }} de comisiones. No restan en el resultado
          hasta que se paguen.
        </p>
        <p class="gr-generated">Generado {{ generatedLabel }}.</p>
      </section>
    </template>

    <AppLoader
      v-else-if="isLoading"
      variant="dashboard"
      icon="📊"
      title="Armando el reporte general…"
      subtitle="Cruzando ventas, caja, cartera de cobranza y embudo comercial."
    />
  </main>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import AppLoader from '../components/AppLoader.vue';
import ReportBarChart from '../components/report/ReportBarChart.vue';
import ReportBarList from '../components/report/ReportBarList.vue';
import {
  delta,
  integer,
  longMonth,
  pct,
  periodLabel,
  pointDelta,
  shortMonth as shortMonthOf
} from '../components/report/reportFormat.js';

const PERIODS = [3, 6, 12];
const STORAGE_KEY = 'reporteGeneral.months';

function readStoredMonths() {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return PERIODS.includes(n) ? n : 6;
  } catch {
    return 6;
  }
}

const months = ref(readStoredMonths());
const report = ref(null);
const isLoading = ref(false);
const error = ref('');

async function load() {
  isLoading.value = true;
  error.value = '';
  try {
    const response = await apiFetch(`/api/general-report?months=${months.value}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el reporte.');
    report.value = data;
  } catch (e) {
    error.value = e.message;
  } finally {
    isLoading.value = false;
  }
}

watch(months, (value) => {
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* ventana privada */ }
  load();
});
onMounted(load);

// --- Formatos ---
const moneyFmt = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN', maximumFractionDigits: 0 });
const money = (v) => moneyFmt.format(Number(v) || 0);
function moneyCompact(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}S/ ${(abs / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1e3) return `${sign}S/ ${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}S/ ${Math.round(abs)}`;
}
// Con doce barras en el eje, el año va en todas: sin él no se sabe si la
// primera "oct" es la de este año o la del anterior.
const shortMonth = (key) => shortMonthOf(key, months.value === 12);

const monthLabels = computed(() => report.value.monthly.months.map(shortMonth));
const monthTitles = computed(() => report.value.monthly.months.map(longMonth));

const generatedLabel = computed(() => new Date(report.value.generatedAt).toLocaleString('es-PE', {
  dateStyle: 'long', timeStyle: 'short'
}));

// --- KPIs ---
const kpiTiles = computed(() => {
  const k = report.value.kpis;
  const r = report.value.receivables;
  return [
    {
      key: 'sales', label: 'Vendido (pactado)', value: money(k.sales.current),
      delta: delta(k.sales.change), previous: moneyCompact(k.sales.previous)
    },
    {
      key: 'deals', label: 'Ventas cerradas', value: integer(k.deals.current),
      delta: delta(k.deals.change), previous: integer(k.deals.previous),
      note: `Ticket promedio ${money(k.ticket.current)}`
    },
    {
      key: 'cashIn', label: 'Cobrado (caja)', value: money(k.cashIn.current),
      delta: delta(k.cashIn.change), previous: moneyCompact(k.cashIn.previous)
    },
    {
      key: 'cashOut', label: 'Egresos', value: money(k.cashOut.current),
      delta: delta(k.cashOut.change, { higherIsBetter: false }), previous: moneyCompact(k.cashOut.previous)
    },
    {
      key: 'net', label: 'Resultado neto', value: money(k.net.current),
      valueClass: k.net.current < 0 ? 'text-critical' : '',
      delta: delta(k.net.change), previous: moneyCompact(k.net.previous),
      note: k.margin.current === null ? null : `Margen ${pct(k.margin.current)} de lo cobrado`
    },
    {
      key: 'leads', label: 'Leads nuevos', value: integer(k.newLeads.current),
      delta: delta(k.newLeads.change), previous: integer(k.newLeads.previous)
    },
    {
      key: 'conversion', label: 'Conversión lead → venta', value: pct(k.conversion.current),
      delta: pointDelta(k.conversion.current, k.conversion.previous), previous: pct(k.conversion.previous)
    },
    {
      key: 'overdue', label: 'Cartera vencida', value: money(r.overdue),
      valueClass: r.overdue > 0 ? 'text-critical' : '',
      note: r.total > 0 ? `${pct(r.overdueShare)} de ${money(r.total)} por cobrar` : 'Nada pendiente de cobro'
    }
  ];
});

// --- Puntos clave ---
const highlights = computed(() => {
  const list = [];
  const k = report.value.kpis;
  const r = report.value.receivables;

  if (k.sales.change !== null) {
    list.push({
      icon: k.sales.change >= 0 ? '📈' : '📉',
      tone: k.sales.change >= 0 ? 'good' : 'bad',
      text: `Las ventas ${k.sales.change >= 0 ? 'subieron' : 'bajaron'} ${pct(Math.abs(k.sales.change))} frente al período anterior.`
    });
  }
  if (k.sales.current > 0 && k.cashIn.current < k.sales.current * 0.6) {
    list.push({
      icon: '⚠️', tone: 'warn',
      text: `Se cobró ${money(k.cashIn.current)} contra ${money(k.sales.current)} vendido: buena parte de la venta todavía es crédito al cliente.`
    });
  }
  if (k.net.current < 0) {
    list.push({ icon: '🔻', tone: 'bad', text: `El período cierra en pérdida: ${money(k.net.current)}.` });
  }
  if (r.overdueShare !== null && r.overdueShare >= 25) {
    list.push({
      icon: '⏰', tone: 'bad',
      text: `El ${pct(r.overdueShare)} de la cartera está vencido (${money(r.overdue)}).`
    });
  }
  const best = report.value.channels
    .filter((c) => !c.isOther && c.leads >= 5 && c.conversion !== null)
    .sort((a, b) => b.conversion - a.conversion)[0];
  if (best && best.conversion > 0) {
    list.push({
      icon: '🎯', tone: 'neutral',
      text: `El canal que mejor convierte es «${best.label}»: ${pct(best.conversion)} de sus leads compraron.`
    });
  }
  return list.slice(0, 4);
});

// --- Filas de las listas ---
const expenseRows = computed(() => report.value.expenses.map((e) => ({
  label: e.label, value: e.amount, display: money(e.amount),
  note: report.value.kpis.cashOut.current
    ? `${pct(Math.round((e.amount / report.value.kpis.cashOut.current) * 1000) / 10)} de los egresos`
    : null
})));

const closerRows = computed(() => report.value.closers.map((c) => ({
  label: c.label, value: c.amount, display: money(c.amount),
  note: `${c.count} ${c.count === 1 ? 'venta' : 'ventas'} · ticket ${money(c.count ? c.amount / c.count : 0)}`
})));

const channelRows = computed(() => report.value.channels.map((c) => ({
  label: c.label, value: c.leads, display: `${integer(c.leads)} leads`,
  note: `${c.won} ${c.won === 1 ? 'venta' : 'ventas'} · conversión ${pct(c.conversion)}${c.amount ? ` · ${money(c.amount)}` : ''}`
})));

/** Los tramos de deuda llevan color de estado Y su nombre: nunca el color solo. */
const AGING_STYLE = {
  por_vencer: { color: 'var(--status-good)', icon: '🟢' },
  d1_30: { color: 'var(--status-warning)', icon: '🟡' },
  d31_60: { color: 'var(--status-serious)', icon: '🟠' },
  d61_90: { color: 'var(--status-critical)', icon: '🔴' },
  d90: { color: 'var(--status-critical)', icon: '⛔' }
};
const agingRows = computed(() => report.value.receivables.aging.map((b) => ({
  label: b.label,
  value: b.amount,
  display: money(b.amount),
  note: `${b.count} ${b.count === 1 ? 'cuota' : 'cuotas'}`,
  ...AGING_STYLE[b.key]
})));

const projectionLabels = computed(() => ['Vencido', ...report.value.receivables.projection.months.map((m) => shortMonth(m.month))]);
const projectionTitles = computed(() => ['Ya vencido', ...report.value.receivables.projection.months.map((m) => longMonth(m.month))]);
const projectionValues = computed(() => [
  report.value.receivables.projection.overdue,
  ...report.value.receivables.projection.months.map((m) => m.amount)
]);

const funnelWidth = (step) => {
  const total = report.value.funnel[0]?.count || 0;
  if (!total) return '0%';
  return `${Math.max((step.count / total) * 100, step.count ? 1.5 : 0)}%`;
};

const obligationsTotal = computed(() => {
  const o = report.value.obligations;
  return o ? (Number(o.salarios) || 0) + (Number(o.comisiones) || 0) : 0;
});
</script>

<style scoped>
/*
 * Paleta de los gráficos. Las dos series (oliva de marca + azul) pasaron el
 * validador de daltonismo en los dos temas; el naranja de marca junto al oliva
 * no (ΔE 3 para deuteranopía). Los colores de estado se reservan para la
 * antigüedad de la deuda y siempre van con su nombre.
 */
.general-report-page {
  --viz-1: #6F8125;
  --viz-2: #2F6DC0;
  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-serious: #ec835a;
  --status-critical: #d03b3b;
  padding: var(--page-py) var(--page-px) var(--page-pb);
}
:root[data-theme="dark"] .general-report-page {
  --viz-1: #7C9A2E;
  --viz-2: #4A88DA;
}

.gr-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.gr-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.gr-segmented {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card-solid);
}
.gr-segmented button {
  border: 0;
  background: transparent;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-sub);
  cursor: pointer;
}
.gr-segmented button + button { border-left: 1px solid var(--border-color); }
.gr-segmented button.is-active { background: var(--primary); color: #fff; font-weight: 600; }

.gr-error {
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-rose);
  color: var(--accent-rose);
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
.gr-period { font-size: 0.82rem; color: var(--text-muted); margin: 0 0 0.6rem; }
.gr-period strong { color: var(--text-sub); text-transform: capitalize; }

.gr-highlights {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.gr-highlight {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  border-left-width: 4px;
  background: var(--bg-card);
  font-size: 0.82rem;
  color: var(--text-sub);
  line-height: 1.4;
}
.gr-highlight.is-good { border-left-color: var(--accent-emerald); }
.gr-highlight.is-bad { border-left-color: var(--status-critical); }
.gr-highlight.is-warn { border-left-color: var(--status-warning); }
.gr-highlight.is-neutral { border-left-color: var(--viz-2); }

.gr-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.6rem;
  margin-bottom: 1rem;
}
.gr-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.85rem 0.95rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.gr-kpi:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.gr-kpi::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--viz-1);
}
.gr-kpi.is-kpi-cashIn::before,
.gr-kpi.is-kpi-net::before { background: var(--accent-emerald); }
.gr-kpi.is-kpi-cashOut::before { background: var(--accent-amber); }
.gr-kpi.is-kpi-overdue::before { background: var(--status-critical); }
.gr-kpi.is-kpi-leads::before,
.gr-kpi.is-kpi-conversion::before { background: var(--viz-2); }
.gr-kpi-label { font-size: 0.74rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.gr-kpi-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-main);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.gr-kpi-delta { font-size: 0.76rem; font-weight: 600; }
.gr-kpi-delta.is-good { color: var(--accent-emerald); }
.gr-kpi-delta.is-bad { color: var(--accent-rose); }
.gr-kpi-delta.is-neutral { color: var(--text-muted); }
.gr-kpi-prev { font-weight: 400; color: var(--text-muted); margin-left: 0.2rem; }
.gr-kpi-note { font-size: 0.74rem; color: var(--text-muted); }
.text-critical { color: var(--accent-rose); }

.gr-section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 1rem 0 0.5rem;
}
.gr-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.gr-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 0.85rem 0.95rem;
  box-shadow: var(--shadow-sm);
  min-width: 0;
}
.gr-card-wide { grid-column: 1 / -1; }
.gr-card-head h4 { font-size: 0.9rem; font-weight: 600; color: var(--text-main); margin: 0 0 0.2rem; }
.gr-card-head p { font-size: 0.76rem; color: var(--text-muted); margin: 0 0 0.75rem; line-height: 1.45; }
.gr-footnote { font-size: 0.72rem; color: var(--text-muted); margin: 0.3rem 0 0; }

.gr-mini-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.85rem;
}
.gr-mini-stats div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.55rem;
  border-radius: var(--radius-md);
  background: var(--bg-page-alt);
}
.gr-mini-stats span { font-size: 0.7rem; color: var(--text-muted); }
.gr-mini-stats strong { font-size: 0.95rem; color: var(--text-main); font-variant-numeric: tabular-nums; }
.gr-mini-stats strong.text-critical { color: var(--accent-rose); }

.gr-funnel { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.gr-funnel-head { display: flex; justify-content: space-between; font-size: 0.84rem; color: var(--text-sub); }
.gr-funnel-head strong { color: var(--text-main); font-variant-numeric: tabular-nums; }
.gr-funnel-track { margin-top: 0.25rem; height: 14px; border-radius: 4px; background: var(--border-color); overflow: hidden; }
.gr-funnel-bar { display: block; height: 100%; border-radius: 4px; background: var(--viz-1); transition: width 0.3s ease; }
.gr-funnel-note { margin-top: 0.2rem; font-size: 0.74rem; color: var(--text-muted); }

.gr-notes { margin-top: 1rem; font-size: 0.8rem; color: var(--text-muted); }
.gr-notes p { margin: 0 0 0.35rem; }
.gr-generated { font-size: 0.72rem; }
.gr-loading { padding: 2rem 0; text-align: center; color: var(--text-muted); }

@media (max-width: 900px) {
  .gr-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) {
  .gr-mini-stats { grid-template-columns: minmax(0, 1fr); }
  .gr-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .gr-kpi-value { font-size: 1.1rem; }
}
</style>
