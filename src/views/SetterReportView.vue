<template>
  <main class="container-fluid setter-report-page">
    <header class="sr-header">
      <div>
        <h2 class="section-heading">
          <span class="heading-icon">🎧</span> Reporte de Setters
        </h2>
        <p class="section-subheading">
          Cuántos leads le tocaron a cada setter, cuántas reuniones consiguió, cuántos cerraron
          y en qué etapa quedaron los demás. Cada cifra se compara con el período anterior.
        </p>
      </div>
      <div class="sr-controls">
        <div class="sr-segmented" role="group" aria-label="Período del reporte">
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

    <div v-if="error" class="sr-error" role="alert">{{ error }}</div>

    <template v-if="report">
      <p v-if="scopeNote" class="sr-scope">ℹ️ {{ scopeNote }}</p>

      <p class="sr-period">
        Período: <strong>{{ periodLabel(report.period.months) }}</strong>
        · comparado con {{ periodLabel(report.period.previous) }}
      </p>

      <!-- Lo que hay que saber antes de mirar los gráficos -->
      <section v-if="highlights.length" class="sr-highlights" aria-label="Puntos clave">
        <div v-for="h in highlights" :key="h.text" class="sr-highlight" :class="`is-${h.tone}`">
          <span aria-hidden="true">{{ h.icon }}</span>
          <span>{{ h.text }}</span>
        </div>
      </section>

      <!-- Bloque 1: Indicadores principales de conversión (8 KPIs) -->
      <div class="sr-kpi-section-head">
        <span class="sr-kpi-section-title">🎯 Resultados de Conversión y Cierre</span>
        <button
          type="button"
          class="sr-diag-toggle"
          @click="showAttentionKpis = !showAttentionKpis"
        >
          {{ showAttentionKpis ? '▴ Ocultar diagnóstico de atención' : '▾ Ver diagnóstico de velocidad y atención (6 métricas)' }}
        </button>
      </div>
      <section class="sr-kpis">
        <article v-for="tile in conversionKpiTiles" :key="tile.key" class="sr-kpi sr-kpi-primary">
          <span class="sr-kpi-label">{{ tile.label }}</span>
          <span class="sr-kpi-value" :class="tile.valueClass">{{ tile.value }}</span>
          <span v-if="tile.delta" class="sr-kpi-delta" :class="`is-${tile.delta.tone}`">
            <span aria-hidden="true">{{ tile.delta.arrow }}</span>
            {{ tile.delta.text }}
            <span class="sr-kpi-prev">vs. {{ tile.previous }}</span>
          </span>
          <span v-if="tile.note" class="sr-kpi-note">{{ tile.note }}</span>
        </article>
      </section>

      <!-- Bloque 2: Diagnóstico de velocidad y atención (6 KPIs) -->
      <section v-if="showAttentionKpis" class="sr-kpis sr-kpis-attention">
        <article v-for="tile in attentionKpiTiles" :key="tile.key" class="sr-kpi sr-kpi-diag">
          <span class="sr-kpi-label">{{ tile.label }}</span>
          <span class="sr-kpi-value" :class="tile.valueClass">{{ tile.value }}</span>
          <span v-if="tile.delta" class="sr-kpi-delta" :class="`is-${tile.delta.tone}`">
            <span aria-hidden="true">{{ tile.delta.arrow }}</span>
            {{ tile.delta.text }}
            <span class="sr-kpi-prev">vs. {{ tile.previous }}</span>
          </span>
          <span v-if="tile.note" class="sr-kpi-note">{{ tile.note }}</span>
        </article>
      </section>

      <!-- ===================== CADA SETTER ===================== -->
      <h3 class="sr-section-title">Cada setter en el período</h3>

      <div v-if="report.setters.length === 0" class="sr-empty">
        No hay leads con responsable en este período. Los leads se atribuyen por su setter sellado
        al graduar y, si todavía no graduaron, por quien los tiene asignados.
      </div>

      <section v-else class="sr-grid">
        <article class="sr-card sr-card-wide">
          <header class="sr-card-head sr-card-head-flex">
            <div>
              <h4>Tabla comparativa</h4>
              <p>
                Los leads que entraron en el período atribuidos a cada setter, y hasta dónde llegaron.
                Las tasas se calculan sobre SUS leads, así que se pueden comparar entre personas
                aunque hayan recibido cantidades distintas.
              </p>
            </div>
            <div class="sr-table-mode-pills" role="group" aria-label="Columnas visibles en la tabla">
              <button
                type="button"
                class="sr-mode-pill"
                :class="{ 'is-active': tableViewMode === 'all' }"
                @click="tableViewMode = 'all'"
              >📐 Completa (12)</button>
              <button
                type="button"
                class="sr-mode-pill"
                :class="{ 'is-active': tableViewMode === 'conversion' }"
                @click="tableViewMode = 'conversion'"
              >🎯 Solo Conversión</button>
              <button
                type="button"
                class="sr-mode-pill"
                :class="{ 'is-active': tableViewMode === 'attention' }"
                @click="tableViewMode = 'attention'"
              >⏱️ Solo Atención</button>
            </div>
          </header>

          <div class="sr-table-wrap">
            <table class="sr-table">
              <thead>
                <tr>
                  <th scope="col">Setter</th>
                  <th scope="col" class="num">Leads</th>
                  <template v-if="tableViewMode !== 'attention'">
                    <th scope="col" class="num">Pasaron a Ventas</th>
                    <th scope="col" class="num">Con reunión</th>
                    <th scope="col" class="num">Cerrados</th>
                    <th scope="col" class="num">Cierre / reunión</th>
                    <th scope="col" class="num">Días a la reunión</th>
                  </template>
                  <template v-if="tableViewMode !== 'conversion'">
                    <th scope="col" class="num sr-col-divider">Sin respuesta</th>
                    <th scope="col" class="num">Calificados</th>
                    <th scope="col" class="num">Dormidos</th>
                    <th scope="col" class="num">Sin mover</th>
                    <th scope="col" class="num">Movimientos</th>
                  </template>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in report.setters" :key="s.id">
                  <th scope="row" class="sr-person">
                    <span class="sr-avatar" :style="{ background: avatarColor(s.name) }" aria-hidden="true">
                      {{ initials(s.name) }}
                    </span>
                    <span class="sr-person-text">
                      <span class="sr-person-name">{{ s.name }}</span>
                      <span class="sr-person-role">
                        {{ s.role || 'Sin rol' }}<template v-if="s.formerMember"> · ya no está en el área</template>
                      </span>
                    </span>
                  </th>
                  <td data-label="Leads" class="num">
                    <strong>{{ integer(s.leads) }}</strong>
                    <span class="sr-mini-track" aria-hidden="true">
                      <span class="sr-mini-bar" :style="{ width: relWidth(s.leads), background: 'var(--viz-lead)' }"></span>
                    </span>
                  </td>
                  <template v-if="tableViewMode !== 'attention'">
                    <td data-label="Pasaron a Ventas" class="num">
                      {{ integer(s.graduated) }}
                      <span class="sr-rate">{{ pct(s.graduationRate) }}</span>
                    </td>
                    <td data-label="Con reunión" class="num">
                      <strong>{{ integer(s.withMeeting) }}</strong>
                      <span class="sr-rate">{{ pct(s.meetingRate) }}</span>
                      <span v-if="s.meetingsCancelled" class="sr-sub">
                        {{ s.meetingsCancelled }} cancelada{{ s.meetingsCancelled === 1 ? '' : 's' }}
                      </span>
                    </td>
                    <td data-label="Cerrados" class="num">
                      <strong>{{ integer(s.won) }}</strong>
                      <span class="sr-rate">{{ pct(s.winRate) }}</span>
                    </td>
                    <td data-label="Cierre / reunión" class="num">{{ pct(s.meetingToWinRate) }}</td>
                    <td data-label="Días a la reunión" class="num">{{ days(s.daysToMeeting) }}</td>
                  </template>
                  <template v-if="tableViewMode !== 'conversion'">
                    <td data-label="Sin respuesta" class="num sr-col-divider">
                      <strong :class="{ 'text-warn': s.noFirstResponse > 0 }">{{ integer(s.noFirstResponse) }}</strong>
                      <span v-if="s.responseMedianMin !== null" class="sr-sub">
                        med. {{ minutes(s.responseMedianMin) }} · P90 {{ minutes(s.responseP90Min) }}
                      </span>
                    </td>
                    <td data-label="Calificados" class="num">
                      {{ integer(s.qualifiedYes + s.qualifiedNo) }}
                      <span class="sr-rate">{{ pct(s.qualificationCoverage) }}</span>
                      <span v-if="s.qualifiedPending" class="sr-sub">
                        {{ s.qualifiedPending }} sin calificar
                      </span>
                    </td>
                    <td data-label="Dormidos" class="num">
                      <span :class="{ 'text-warn': s.stale > 0 }">{{ integer(s.stale) }}</span>
                      <span v-if="s.staleDaysMedian !== null" class="sr-sub">med. {{ days(s.staleDaysMedian) }}</span>
                    </td>
                    <td data-label="Sin mover" class="num">
                      <span :class="{ 'text-warn': s.unmoved > 0 }">{{ integer(s.unmoved) }}</span>
                    </td>
                    <td data-label="Movimientos" class="num">
                      {{ integer(s.activity.moves) }}
                      <span v-if="s.activity.blocked" class="sr-sub">
                        {{ s.activity.blocked }} bloqueado{{ s.activity.blocked === 1 ? '' : 's' }}
                      </span>
                    </td>
                  </template>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Equipo</th>
                  <td data-label="Leads" class="num"><strong>{{ integer(report.team.leads) }}</strong></td>
                  <template v-if="tableViewMode !== 'attention'">
                    <td data-label="Pasaron a Ventas" class="num">
                      {{ integer(report.team.graduated) }}
                      <span class="sr-rate">{{ pct(report.team.graduationRate) }}</span>
                    </td>
                    <td data-label="Con reunión" class="num">
                      <strong>{{ integer(report.team.withMeeting) }}</strong>
                      <span class="sr-rate">{{ pct(report.team.meetingRate) }}</span>
                    </td>
                    <td data-label="Cerrados" class="num">
                      <strong>{{ integer(report.team.won) }}</strong>
                      <span class="sr-rate">{{ pct(report.team.winRate) }}</span>
                    </td>
                    <td data-label="Cierre / reunión" class="num">{{ pct(report.team.meetingToWinRate) }}</td>
                    <td data-label="Días a la reunión" class="num">{{ days(report.team.daysToMeeting) }}</td>
                  </template>
                  <template v-if="tableViewMode !== 'conversion'">
                    <td data-label="Sin respuesta" class="num sr-col-divider">
                      <strong>{{ integer(report.team.noFirstResponse) }}</strong>
                      <span v-if="report.team.responseMedianMin !== null" class="sr-sub">
                        med. {{ minutes(report.team.responseMedianMin) }} · P90 {{ minutes(report.team.responseP90Min) }}
                      </span>
                    </td>
                    <td data-label="Calificados" class="num">
                      {{ integer(report.team.qualifiedYes + report.team.qualifiedNo) }}
                      <span class="sr-rate">{{ pct(report.team.qualificationCoverage) }}</span>
                    </td>
                    <td data-label="Dormidos" class="num">{{ integer(report.team.stale) }}</td>
                    <td data-label="Sin mover" class="num">{{ integer(report.team.unmoved) }}</td>
                    <td data-label="Movimientos" class="num">{{ integer(totalMoves) }}</td>
                  </template>
                </tr>
              </tfoot>
            </table>
          </div>
          <p v-if="report.unassigned.leads" class="sr-footnote">
            El total del equipo incluye {{ report.unassigned.leads }}
            lead{{ report.unassigned.leads === 1 ? '' : 's' }} sin responsable, que no se reparten
            entre las filas porque no los trabajó nadie.
          </p>
        </article>

        <article class="sr-card sr-card-wide">
          <header class="sr-card-head">
            <h4>¿En qué estado quedaron sus leads?</h4>
            <p>
              La composición de la cartera de cada uno, al día de hoy. Una fila casi toda azul es
              trabajo todavía en juego; mucho rojo con pocos cierres es una cartera que se está
              quemando. El total va escrito al lado del nombre porque las barras están al 100%.
            </p>
          </header>
          <ReportStackedBars
            :rows="compositionRows"
            :series="COMPOSITION_SERIES"
            category-label="Setter"
            empty-text="Sin leads con responsable en el período."
          />
        </article>

        <article class="sr-card sr-card-wide">
          <header class="sr-card-head">
            <h4>¿Cuánto esperó cada lead su primera respuesta?</h4>
            <p>
              El reparto de los leads de cada uno por lo que tardaron en recibir la primera
              respuesta, venga de Avan, del panel o de una llamada anotada en la ficha. La mediana
              del equipo la baja el acuse automático, que sale en segundos; lo que se mira acá es
              el otro extremo: el azul más oscuro y, sobre todo, el rojo — un lead sin respuesta no
              falla, simplemente nadie lo atendió. Pasa el mouse por un segmento para ver su
              mediana y su P90.
            </p>
          </header>
          <ReportStackedBars
            :rows="responseRows"
            :series="responseSeries"
            category-label="Setter"
            empty-text="Sin leads con responsable en el período."
          />
        </article>

        <article class="sr-card">
          <header class="sr-card-head">
            <h4>Reuniones conseguidas</h4>
            <p>
              Leads con al menos una reunión agendada que sigue en pie. Es el resultado que mide
              directamente al setter: lo que pase después en la reunión ya es del closer.
            </p>
          </header>
          <ReportBarList
            :rows="meetingRows"
            color="var(--viz-meet)"
            empty-text="Nadie consiguió reuniones en el período."
          />
        </article>

        <article class="sr-card">
          <header class="sr-card-head">
            <h4>Conversión lead → venta</h4>
            <p>
              De los leads de cada uno, qué porcentaje terminó en venta cerrada. Con pocos leads
              un porcentaje dice poco, así que va con el conteo al lado.
            </p>
          </header>
          <ReportBarList
            :rows="conversionRows"
            color="var(--viz-won)"
            empty-text="Sin ventas cerradas en el período."
          />
        </article>
      </section>

      <!-- ===================== MES A MES ===================== -->
      <h3 class="sr-section-title">Mes a mes</h3>

      <div class="sr-focus" role="group" aria-label="Elegir de quién se muestra el detalle">
        <button
          type="button"
          class="sr-focus-chip"
          :class="{ 'is-active': focusId === null }"
          :aria-pressed="focusId === null"
          @click="focusId = null"
        >Todo el equipo</button>
        <button
          v-for="s in report.setters"
          :key="s.id"
          type="button"
          class="sr-focus-chip"
          :class="{ 'is-active': focusId === s.id }"
          :aria-pressed="focusId === s.id"
          @click="focusId = s.id"
        >{{ s.name }}</button>
      </div>

      <section class="sr-grid">
        <article class="sr-card sr-card-wide">
          <header class="sr-card-head">
            <h4>{{ focus ? focus.name : 'Todo el equipo' }}: leads, reuniones y cierres por mes</h4>
            <p>
              Cada lead cuenta en el mes en que ENTRÓ, también su reunión y su cierre aunque hayan
              ocurrido después: es la única forma de que las tres barras de un mes se puedan
              comparar entre sí. Por lo mismo, los meses más recientes todavía pueden crecer.
            </p>
          </header>
          <ReportBarChart
            :labels="monthLabels"
            :tooltip-titles="monthTitles"
            :series="monthlySeries"
            :extra-rows="monthlyExtras"
            :format="integer"
            :compact-format="integer"
            :axis-format="integer"
            :height="250"
            :aria-label="`Leads, reuniones y cierres por mes de ${focus ? focus.name : 'todo el equipo'}`"
          />
        </article>

        <article class="sr-card">
          <header class="sr-card-head">
            <h4>{{ focus ? `Etapa actual de los leads de ${focus.name}` : 'Etapa actual de los leads del equipo' }}</h4>
            <p>
              Dónde están parados hoy, con el nombre que el equipo le puso a cada columna de sus
              tableros. Es el detalle de la barra de composición de arriba.
            </p>
          </header>
          <ReportBarList
            :rows="stageRows"
            color="var(--viz-lead)"
            empty-text="Sin leads en el período."
          />
        </article>

        <article class="sr-card">
          <header class="sr-card-head">
            <h4>Actividad registrada</h4>
            <p>
              Movimientos de etapa que cada persona hizo DURANTE el período, sin importar de cuándo
              sea el lead. Es lo que contesta «¿qué trabajó este mes?»: el resto del reporte mira los
              leads que entraron, así que el trabajo sobre leads viejos solo se ve acá.
            </p>
          </header>
          <ReportBarList
            :rows="activityRows"
            color="var(--viz-lead)"
            empty-text="Sin movimientos registrados en el período."
          />
        </article>
      </section>

      <section class="sr-notes">
        <p v-if="report.unassigned.leads">
          🫥 {{ report.unassigned.leads }} lead{{ report.unassigned.leads === 1 ? '' : 's' }}
          entraron sin responsable en el período
          <template v-if="report.unassigned.won">
            ({{ report.unassigned.won }}
            {{ report.unassigned.won === 1 ? 'terminó' : 'terminaron' }} en venta igual)</template>.
          Un lead sin responsable no lo ve nadie salvo quien reparte: se asignan desde el tablero
          o se configura el reparto automático.
        </p>
        <p v-if="report.unassigned.noFirstResponse">
          📵 De los leads sin responsable, {{ report.unassigned.noFirstResponse }}
          tampoco {{ report.unassigned.noFirstResponse === 1 ? 'tiene' : 'tienen' }} ninguna
          respuesta registrada. Es el peor caso del reporte y no aparece en ninguna fila de la
          tabla: nadie los tiene asignados, así que no hay a quién pedírselos.
        </p>
        <p v-if="report.team.appointmentWithoutMeeting">
          📅 {{ report.team.appointmentWithoutMeeting }}
          lead{{ report.team.appointmentWithoutMeeting === 1 ? '' : 's' }} del período
          {{ report.team.appointmentWithoutMeeting === 1 ? 'está' : 'están' }} en la etapa
          «cita agendada» sin una reunión con fecha y hora detrás, así que no
          {{ report.team.appointmentWithoutMeeting === 1 ? 'cuenta' : 'cuentan' }} en «Con reunión»:
          el closer no la ve en su Calendario y el bot no manda el recordatorio. Se cargan con
          «Agendar reunión» desde la ficha del lead.
        </p>
        <p>
          ⏱️ La primera respuesta sale de la ficha del lead y cubre tanto el mensaje de WhatsApp
          —lo mande Avan o una persona— como la primera nota, que es el único registro que deja una
          llamada. Se publican la mediana y el P90 juntos porque la mediana es casi siempre el acuse
          automático de Avan: una medida de centro no dice nada de la cola, y la cola es lo que se
          arregla. Los leads «dormidos» son los que siguen abiertos y llevan más de
          {{ report.staleDays }} días sin un solo movimiento.
        </p>
        <p v-if="report.team.meetingsCancelled">
          🗑️ {{ report.team.meetingsCancelled }}
          reunión{{ report.team.meetingsCancelled === 1 ? '' : 'es' }} de estos leads
          figura{{ report.team.meetingsCancelled === 1 ? '' : 'n' }} cancelada en Google y no
          cuenta{{ report.team.meetingsCancelled === 1 ? '' : 'n' }} como reunión conseguida.
        </p>
        <p>
          🧮 Un lead se le atribuye a su setter sellado al graduar y, mientras no graduó, a quien lo
          tiene asignado — las mismas columnas de las que cuelga la comisión de la setter.
          Los importes no se muestran acá: se consultan en Finanzas.
        </p>
        <!-- Sin punto final: la hora en español ya termina en "a. m." -->
        <p class="sr-generated">Generado {{ generatedLabel }}</p>
      </section>
    </template>

    <AppLoader
      v-else-if="isLoading"
      variant="dashboard"
      icon="🎧"
      title="Armando el reporte de setters…"
      subtitle="Analizando leads atribuidos, reuniones agendadas y tiempos de primera respuesta."
    />
  </main>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import AppLoader from '../components/AppLoader.vue';
import ReportBarChart from '../components/report/ReportBarChart.vue';
import ReportBarList from '../components/report/ReportBarList.vue';
import ReportStackedBars from '../components/report/ReportStackedBars.vue';
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
const STORAGE_KEY = 'reporteSetters.months';

/**
 * El orden de los segmentos es el que se validó contra daltonismo: el oliva y
 * el rojo nunca se tocan (con deuteranopía son el mismo color), y entre ellos
 * queda el azul. Cambiar el orden deshace justo eso.
 */
const COMPOSITION_SERIES = [
  { key: 'won', label: 'Ganado', color: 'var(--viz-won)' },
  { key: 'open', label: 'En proceso', color: 'var(--viz-lead)' },
  { key: 'lost', label: 'Perdido', color: 'var(--viz-lost)' }
];

/**
 * La rampa de los tramos de respuesta, de más rápido a más lento. Los tramos
 * y sus nombres los manda el servidor (`report.responseBuckets`), que es quien
 * los calcula; acá solo se les pone color, en orden. Si algún día se agrega un
 * tramo, el último color se repite en vez de romper la barra — y se ve, que es
 * lo que hace falta para venir a agregar el tono que falta.
 */
const RESPONSE_COLORS = [
  'var(--viz-resp-1)', 'var(--viz-resp-2)', 'var(--viz-resp-3)', 'var(--viz-resp-4)'
];

function readStoredMonths() {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return PERIODS.includes(n) ? n : 6;
  } catch {
    // Ventana privada: el acceso lanza y el valor por defecto alcanza.
    return 6;
  }
}

const months = ref(readStoredMonths());
const report = ref(null);
const isLoading = ref(false);
const error = ref('');
/** `null` = todo el equipo. Es solo de la pantalla: no se vuelve a pedir nada. */
const focusId = ref(null);
const showAttentionKpis = ref(true);
const tableViewMode = ref('all'); // 'all' | 'conversion' | 'attention'

async function load() {
  isLoading.value = true;
  error.value = '';
  try {
    const response = await apiFetch(`/api/setter-report?months=${months.value}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el reporte.');
    report.value = data;
    // El setter enfocado puede no tener leads en la ventana nueva.
    if (focusId.value && !data.setters.some((s) => s.id === focusId.value)) focusId.value = null;
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

// --- Formatos propios de esta pantalla ---
const days = (v) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')} d`);

/**
 * Minutos escritos como los diría una persona. Un "0,3 min" no se entiende de
 * un vistazo y es justo el valor que más aparece: el acuse de Avan sale en
 * segundos, así que por debajo del minuto se escribe en segundos.
 */
function minutes(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (n < 1) return `${Math.round(n * 60)} s`;
  if (n < 60) return `${String(Math.round(n * 10) / 10).replace('.', ',')} min`;
  const horas = Math.floor(n / 60);
  const resto = Math.round(n % 60);
  return resto ? `${horas} h ${resto} min` : `${horas} h`;
}

const shortMonth = (key) => shortMonthOf(key, months.value === 12);
const monthLabels = computed(() => report.value.monthly.months.map(shortMonth));
const monthTitles = computed(() => report.value.monthly.months.map(longMonth));

const generatedLabel = computed(() => new Date(report.value.generatedAt).toLocaleString('es-PE', {
  dateStyle: 'long', timeStyle: 'short'
}));

const scopeNote = computed(() => {
  const scope = report.value?.scope;
  if (scope === 'mine') return 'Ves solo tus propios números: el reporte respeta la misma visibilidad que tu tablero de leads.';
  if (scope === 'setter') return 'Ves tus leads y los que todavía no pasaron al Funnel de Ventas, la misma visibilidad que tu tablero.';
  return '';
});

/**
 * El color del círculo sale del nombre, igual que en la tabla de Proyectos: así
 * la misma persona se ve siempre del mismo color y no hay nada que guardar.
 */
function avatarColor(name) {
  let hash = 0;
  for (const char of String(name || '')) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return `hsl(${hash} 42% 38%)`;
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

const maxLeads = computed(() => Math.max(1, ...report.value.setters.map((s) => s.leads)));
const relWidth = (value) => `${Math.max(((Number(value) || 0) / maxLeads.value) * 100, value ? 2 : 0)}%`;

const totalMoves = computed(() => report.value.setters.reduce((total, s) => total + s.activity.moves, 0));

const focus = computed(() => report.value.setters.find((s) => s.id === focusId.value) || null);

// --- KPIs del equipo ---
const kpiTiles = computed(() => {
  const k = report.value.kpis;
  const t = report.value.team;
  return [
    {
      key: 'leads', label: 'Leads atribuidos', value: integer(k.leads.current),
      delta: delta(k.leads.change), previous: integer(k.leads.previous),
      note: `${report.value.setters.length} ${report.value.setters.length === 1 ? 'persona' : 'personas'} con leads`
    },
    {
      key: 'meetings', label: 'Leads con reunión', value: integer(k.withMeeting.current),
      delta: delta(k.withMeeting.change), previous: integer(k.withMeeting.previous),
      note: `${integer(t.meetings)} ${t.meetings === 1 ? 'reunión' : 'reuniones'} en total`
    },
    {
      key: 'meetingRate', label: 'Tasa de reunión', value: pct(k.meetingRate.current),
      delta: pointDelta(k.meetingRate.current, k.meetingRate.previous), previous: pct(k.meetingRate.previous)
    },
    {
      key: 'graduated', label: 'Pasaron a Ventas', value: integer(t.graduated),
      note: `${pct(t.graduationRate)} de los leads del período`
    },
    {
      key: 'won', label: 'Ventas cerradas', value: integer(k.won.current),
      delta: delta(k.won.change), previous: integer(k.won.previous)
    },
    {
      key: 'winRate', label: 'Conversión lead → venta', value: pct(k.winRate.current),
      delta: pointDelta(k.winRate.current, k.winRate.previous), previous: pct(k.winRate.previous)
    },
    {
      key: 'meetingToWin', label: 'Cierre por reunión', value: pct(k.meetingToWinRate.current),
      delta: pointDelta(k.meetingToWinRate.current, k.meetingToWinRate.previous),
      previous: pct(k.meetingToWinRate.previous),
      note: 'De los leads con reunión, cuántos cerraron'
    },
    {
      key: 'speed', label: 'Días hasta la reunión', value: days(k.daysToMeeting.current),
      // Tardar menos es mejor: la flecha dice qué pasó y el color, si está bien.
      delta: pointDelta(k.daysToMeeting.current, k.daysToMeeting.previous, {
        higherIsBetter: false, unit: 'd'
      }),
      previous: days(k.daysToMeeting.previous),
      note: 'Mediana desde que entra el lead'
    },
    /*
     * Los cuatro de atención. Van juntos y en este orden porque se leen como
     * una sola frase: a cuántos no se les contestó, cuánto tardó el caso
     * típico y cuánto el caso malo. La mediana sola decía ~20 segundos en un
     * período con 51 leads esperando más de una hora, así que el P90 va al
     * lado y no escondido en un gráfico.
     */
    {
      key: 'noResponse', label: 'Leads sin respuesta', value: integer(k.noFirstResponse.current),
      valueClass: t.noFirstResponse > 0 ? 'text-warn' : '',
      // Menos es mejor: la flecha dice qué pasó y el color, si está bien.
      delta: delta(k.noFirstResponse.change, { higherIsBetter: false }),
      previous: integer(k.noFirstResponse.previous),
      note: t.responseRate !== null ? `Se contestó al ${pct(t.responseRate)} de los leads` : null
    },
    {
      key: 'responseTime', label: '1ª respuesta (mediana)', value: minutes(t.responseMedianMin),
      note: t.responseP90Min !== null
        ? `P90: ${minutes(t.responseP90Min)} · 1 de cada 10 esperó al menos eso`
        : null
    },
    {
      key: 'humanResponse', label: 'Atención humana (mediana)', value: minutes(t.humanResponseMedianMin),
      note: `${integer(t.respondedByHuman)} de ${integer(t.leads)} contestados por alguien del panel`
    },
    {
      key: 'qualification', label: 'Calificación registrada', value: pct(t.qualificationCoverage),
      valueClass: (t.qualificationCoverage || 0) < 50 ? 'text-warn' : '',
      note: `${integer(t.qualifiedPending)} ${t.qualifiedPending === 1 ? 'lead' : 'leads'} sin calificar`
    },
    {
      key: 'stale', label: `Dormidos +${report.value.staleDays} días`, value: integer(t.stale),
      valueClass: t.stale > 0 ? 'text-warn' : '',
      delta: delta(k.stale.change, { higherIsBetter: false }), previous: integer(k.stale.previous),
      note: t.staleDaysMedian !== null ? `Mediana: ${days(t.staleDaysMedian)} sin moverse` : null
    },
    {
      key: 'unmoved', label: 'Leads sin un solo movimiento', value: integer(t.unmoved),
      valueClass: t.unmoved > 0 ? 'text-warn' : '',
      note: t.leads ? `${pct(Math.round((t.unmoved / t.leads) * 1000) / 10)} de los leads del período` : null
    }
  ];
});

const conversionKpiTiles = computed(() => kpiTiles.value.slice(0, 8));
const attentionKpiTiles = computed(() => kpiTiles.value.slice(8));

/** Las series de la barra de atención: los tramos del servidor + la ausencia. */
const responseSeries = computed(() => [
  ...(report.value.responseBuckets || []).map((bucket, i) => ({
    key: bucket.key,
    label: bucket.label,
    color: RESPONSE_COLORS[i] || RESPONSE_COLORS[RESPONSE_COLORS.length - 1]
  })),
  { key: 'none', label: 'Sin respuesta', color: 'var(--viz-resp-none)' }
]);

/**
 * Una fila por setter con el reparto de sus leads por tiempo de respuesta. El
 * total es SUS leads, así que los cinco segmentos cierran siempre al 100% y
 * dos personas con carteras de tamaño distinto se pueden comparar.
 */
const responseRows = computed(() => report.value.setters.map((s) => ({
  key: String(s.id),
  label: s.name,
  total: s.leads,
  totalText: `${integer(s.leads)} ${s.leads === 1 ? 'lead' : 'leads'}`,
  values: { ...s.responseBuckets, none: s.noFirstResponse },
  hints: {
    none: s.responseMedianMin !== null
      ? `De los contestados: mediana ${minutes(s.responseMedianMin)} · P90 ${minutes(s.responseP90Min)}`
      : 'A ninguno de sus leads le quedó una respuesta registrada'
  }
})));

// --- Puntos clave ---
/** Con menos de esto, un porcentaje es anécdota y no un dato comparable. */
const MIN_LEADS_PARA_TASA = 10;

const highlights = computed(() => {
  const list = [];
  const k = report.value.kpis;
  const setters = report.value.setters;

  if (k.meetingRate.current !== null && k.meetingRate.previous !== null) {
    const diff = Math.round((k.meetingRate.current - k.meetingRate.previous) * 10) / 10;
    if (Math.abs(diff) >= 3) {
      list.push({
        icon: diff > 0 ? '📈' : '📉',
        tone: diff > 0 ? 'good' : 'bad',
        text: `La tasa de reunión ${diff > 0 ? 'subió' : 'bajó'} ${pct(Math.abs(diff))} frente al período anterior (${pct(k.meetingRate.current)}).`
      });
    }
  }

  const topMeetings = [...setters].sort((a, b) => b.withMeeting - a.withMeeting)[0];
  if (topMeetings?.withMeeting > 0 && setters.length > 1) {
    list.push({
      icon: '🏅', tone: 'neutral',
      text: `${topMeetings.name} consiguió más reuniones: ${topMeetings.withMeeting} de sus ${topMeetings.leads} leads (${pct(topMeetings.meetingRate)}).`
    });
  }

  const mejorTasa = setters
    .filter((s) => s.leads >= MIN_LEADS_PARA_TASA && s.meetingRate !== null)
    .sort((a, b) => b.meetingRate - a.meetingRate)[0];
  if (mejorTasa && topMeetings && mejorTasa.id !== topMeetings.id) {
    list.push({
      icon: '🎯', tone: 'neutral',
      text: `La mejor tasa de reunión es de ${mejorTasa.name}: ${pct(mejorTasa.meetingRate)} con ${mejorTasa.leads} leads.`
    });
  }

  /*
   * La atención va arriba de todo cuando hay leads sin contestar: de los
   * hallazgos del reporte es el único que se puede arreglar hoy mismo y el
   * único donde cada día que pasa cuesta un lead. Se nombra el P90 y no la
   * mediana a propósito — la mediana es el acuse de Avan y no dice nada del
   * lead que nadie atendió.
   */
  const t = report.value.team;
  if (t.noFirstResponse > 0) {
    list.unshift({
      icon: '📵', tone: 'bad',
      text: `${t.noFirstResponse} de ${t.leads} leads del período no tienen ninguna respuesta registrada`
        + (t.responseP90Min !== null ? `, y 1 de cada 10 de los que sí esperó al menos ${minutes(t.responseP90Min)}.` : '.')
    });
  }

  const lento = setters
    .filter((s) => s.leads >= MIN_LEADS_PARA_TASA && s.noFirstResponse > 0)
    .sort((a, b) => (b.noFirstResponse / b.leads) - (a.noFirstResponse / a.leads))[0];
  if (lento && setters.length > 1) {
    list.push({
      icon: '⏱️', tone: 'warn',
      text: `${lento.name} es quien más leads tiene sin contestar: ${lento.noFirstResponse} de ${lento.leads}.`
    });
  }

  if (t.qualificationCoverage !== null && t.qualificationCoverage < 50) {
    list.push({
      icon: '🏷️', tone: 'warn',
      text: `Solo el ${pct(t.qualificationCoverage)} de los leads tiene calificación registrada: sin ella no se`
        + ' puede medir la calidad de ningún anuncio, que es para lo único que sirve esa marca.'
    });
  }

  if (t.appointmentWithoutMeeting > 0) {
    list.push({
      icon: '📅', tone: 'warn',
      text: `${t.appointmentWithoutMeeting} lead${t.appointmentWithoutMeeting === 1 ? ' está' : 's están'} en`
        + ' «cita agendada» sin una reunión con fecha y hora: nadie puede ir a buscarla en la agenda.'
    });
  }

  const quieto = [...setters].sort((a, b) => b.unmoved - a.unmoved)[0];
  if (quieto?.unmoved > 0) {
    list.push({
      icon: '⏸️', tone: 'warn',
      text: `${quieto.name} tiene ${quieto.unmoved} lead${quieto.unmoved === 1 ? '' : 's'} sin un solo movimiento registrado.`
    });
  }

  if (report.value.unassigned.leads > 0) {
    list.push({
      icon: '🫥', tone: 'warn',
      text: `${report.value.unassigned.leads} lead${report.value.unassigned.leads === 1 ? '' : 's'} del período quedaron sin responsable: no aparecen en el tablero de nadie.`
    });
  }

  return list.slice(0, 4);
});

// --- Filas de los gráficos ---
const compositionRows = computed(() => report.value.setters.map((s) => ({
  key: String(s.id),
  label: s.name,
  total: s.leads,
  totalText: `${integer(s.leads)} ${s.leads === 1 ? 'lead' : 'leads'}`,
  values: { won: s.won, open: s.open, lost: s.lost },
  hints: {
    open: `${s.openSales} en el Funnel de Ventas · ${s.openSetter} todavía en el Setter Funnel`
  }
})));

/**
 * La cifra grande cuenta LEADS con reunión y la nota cuenta REUNIONES: son dos
 * unidades distintas (un lead puede tener dos reuniones), así que la nota lo
 * dice con la palabra "reuniones" en vez de dejar un número suelto al lado.
 */
const meetingRows = computed(() => report.value.setters.map((s) => ({
  label: s.name,
  value: s.withMeeting,
  display: `${integer(s.withMeeting)} de ${integer(s.leads)}`,
  note: [
    `${pct(s.meetingRate)} de sus leads`,
    `${integer(s.meetings)} ${s.meetings === 1 ? 'reunión' : 'reuniones'}${s.meetingsManual ? ` (${s.meetingsManual} a mano)` : ''}`
  ].join(' · ')
})));

const conversionRows = computed(() => report.value.setters
  .filter((s) => s.winRate !== null)
  .sort((a, b) => b.winRate - a.winRate)
  .map((s) => ({
    label: s.name,
    value: s.winRate,
    display: pct(s.winRate),
    note: `${s.won} de ${s.leads} leads${s.leads < MIN_LEADS_PARA_TASA ? ' · pocos leads, tomar con pinzas' : ''}`
  })));

const stageRows = computed(() => {
  const stages = focus.value ? focus.value.stages : report.value.teamStages;
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return stages.map((stage) => ({
    label: `${stage.icon ? `${stage.icon} ` : ''}${stage.label}`,
    value: stage.count,
    display: `${integer(stage.count)} ${stage.count === 1 ? 'lead' : 'leads'}`,
    note: [
      total ? pct(Math.round((stage.count / total) * 1000) / 10) : null,
      stage.board === 'ventas' ? 'Funnel de Ventas' : stage.board === 'setter' ? 'Setter Funnel' : null
    ].filter(Boolean).join(' · ')
  }));
});

const activityRows = computed(() => [...report.value.setters]
  .filter((s) => s.activity.moves > 0)
  .sort((a, b) => b.activity.moves - a.activity.moves)
  .map((s) => ({
    label: s.name,
    value: s.activity.moves,
    display: `${integer(s.activity.moves)} ${s.activity.moves === 1 ? 'movimiento' : 'movimientos'}`,
    note: `sobre ${s.activity.leadsTouched} lead${s.activity.leadsTouched === 1 ? '' : 's'}${s.activity.blocked ? ` · ${s.activity.blocked} intento${s.activity.blocked === 1 ? '' : 's'} bloqueado${s.activity.blocked === 1 ? '' : 's'}` : ''}`
  })));

const monthlySource = computed(() => (focus.value ? focus.value.monthly : report.value.monthly));

const monthlySeries = computed(() => [
  { key: 'leads', label: 'Leads', color: 'var(--viz-lead)', values: monthlySource.value.leads },
  { key: 'meet', label: 'Con reunión', color: 'var(--viz-meet)', values: monthlySource.value.withMeeting },
  { key: 'won', label: 'Cerrados', color: 'var(--viz-won)', values: monthlySource.value.won }
]);

const monthlyExtras = computed(() => monthlySource.value.months.map((_, i) => {
  const leads = monthlySource.value.leads[i] || 0;
  const meet = monthlySource.value.withMeeting[i] || 0;
  return [
    { label: 'Tasa de reunión', value: pct(leads ? Math.round((meet / leads) * 1000) / 10 : null) },
    { label: 'Conversión a venta', value: pct(leads ? Math.round(((monthlySource.value.won[i] || 0) / leads) * 1000) / 10 : null) }
  ];
}));
</script>

<style scoped>
/*
 * Paleta de los gráficos, validada con el script de la guía de visualización
 * contra los dos fondos (`node scripts/validate_palette.js`):
 *
 *   - El trío azul · magenta · oliva del gráfico mensual pasa los seis chequeos
 *     en claro y en oscuro, todos los pares (el peor: ΔE 8,6 con protanopía).
 *   - La barra de composición va en el orden Ganado · En proceso · Perdido
 *     justamente para que el oliva y el rojo NO queden pegados: con
 *     deuteranopía esos dos son el mismo color (ΔE 1,5). Con el azul en medio,
 *     el peor par adyacente sube a ΔE 16,8.
 *
 * El modo oscuro tiene sus propios pasos, no es un volteo automático: los
 * mismos tonos sobre el fondo oscuro no llegan al piso de contraste.
 */
.setter-report-page {
  --viz-lead: #2F6DC0;
  --viz-meet: #A64D8C;
  --viz-won: #6F8125;
  --viz-lost: #D03B3B;

  /*
   * Los tramos de la primera respuesta son datos ORDENADOS y no categorías, así
   * que van en una rampa de un solo tono —más oscuro cuanto más esperó el
   * lead— y no en cuatro colores distintos: una escala secuencial se lee en
   * orden sin leyenda y es la única que sobrevive a cualquier daltonismo,
   * porque la diferencia es de claridad y no de tono. "Sin respuesta" queda
   * fuera de la rampa en rojo porque no es un tiempo más largo: es la ausencia
   * de respuesta, y mezclarla al final del azul la haría leer como "muy lento".
   *
   * Los cinco tonos están elegidos contra el BLANCO y no contra el fondo de la
   * página: el valor va escrito en blanco dentro de cada segmento
   * (`.rsb-seg-value`) y los segmentos cubren la barra entera, así que el fondo
   * nunca se ve por detrás. Todos pasan 4.5:1 con blanco (4,51 · 6,53 · 9,63 ·
   * 13,93 · 6,54) y los pares contiguos quedan en ΔE 10,6 a 13,1, también
   * simulando deuteranopía. Por eso mismo son los mismos en los dos temas: lo
   * que tiene que contrastar es el texto de adentro, que es blanco en ambos.
   */
  --viz-resp-1: #4178BE;
  --viz-resp-2: #2F5E9E;
  --viz-resp-3: #1F4578;
  --viz-resp-4: #122C52;
  --viz-resp-none: #B3261E;

  padding: var(--page-py) var(--page-px) var(--page-pb);
}
:root[data-theme="dark"] .setter-report-page {
  --viz-lead: #4A88DA;
  --viz-meet: #B55C9D;
  --viz-won: #7C9A2E;
  --viz-lost: #DE6B6B;
}

.sr-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.sr-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
.sr-segmented {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card-solid);
}
.sr-segmented button {
  border: 0;
  background: transparent;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-sub);
  cursor: pointer;
}
.sr-segmented button + button { border-left: 1px solid var(--border-color); }
.sr-segmented button.is-active { background: var(--primary); color: #fff; font-weight: 600; }

.sr-error {
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-rose);
  color: var(--accent-rose);
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}
.sr-scope {
  padding: 0.5rem 0.7rem;
  margin: 0 0 0.6rem;
  border-radius: var(--radius-md);
  border: 1px solid rgba(16, 94, 255, 0.35);
  background: rgba(16, 94, 255, 0.07);
  font-size: 0.82rem;
  color: var(--text-sub);
}
.sr-period { font-size: 0.82rem; color: var(--text-muted); margin: 0 0 0.6rem; }
.sr-period strong { color: var(--text-sub); text-transform: capitalize; }

.sr-highlights {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.sr-highlight {
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
.sr-highlight.is-good { border-left-color: var(--accent-emerald); }
.sr-highlight.is-bad { border-left-color: var(--viz-lost); }
.sr-highlight.is-warn { border-left-color: var(--accent-amber); }
.sr-highlight.is-neutral { border-left-color: var(--viz-lead); }

.sr-kpi-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.sr-kpi-section-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-sub);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sr-diag-toggle {
  border: 1px solid var(--border-color);
  background: var(--bg-card-solid);
  color: var(--text-sub);
  font-family: var(--font-body);
  font-size: 0.76rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sr-diag-toggle:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.sr-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.6rem;
  margin-bottom: 0.85rem;
}
.sr-kpis-attention {
  padding: 0.75rem;
  background: var(--surface-1);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
  margin-bottom: 1.15rem;
}
.sr-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem 0.85rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}
.sr-kpi-primary::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--viz-lead);
}
.sr-card-head-flex {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}
.sr-card-head-flex p { margin-bottom: 0; max-width: 68ch; }
.sr-table-mode-pills {
  display: inline-flex;
  background: var(--surface-2);
  padding: 0.2rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  gap: 0.2rem;
}
.sr-mode-pill {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.32rem 0.65rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.sr-mode-pill.is-active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  box-shadow: var(--shadow-sm);
}
.sr-col-divider {
  border-left: 1px dashed var(--border-strong);
}
.sr-kpi-label { font-size: 0.74rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.sr-kpi-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-main);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.sr-kpi-delta { font-size: 0.76rem; font-weight: 600; }
.sr-kpi-delta.is-good { color: var(--accent-emerald); }
.sr-kpi-delta.is-bad { color: var(--accent-rose); }
.sr-kpi-delta.is-neutral { color: var(--text-muted); }
.sr-kpi-prev { font-weight: 400; color: var(--text-muted); margin-left: 0.2rem; }
.sr-kpi-note { font-size: 0.74rem; color: var(--text-muted); }
.text-warn { color: var(--accent-amber); }

.sr-section-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  margin: 1rem 0 0.5rem;
}
.sr-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
.sr-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 0.85rem 0.95rem;
  box-shadow: var(--shadow-sm);
  min-width: 0;
}
.sr-card-wide { grid-column: 1 / -1; }
.sr-card-head h4 { font-size: 0.9rem; font-weight: 600; color: var(--text-main); margin: 0 0 0.2rem; }
.sr-card-head p { font-size: 0.76rem; color: var(--text-muted); margin: 0 0 0.75rem; line-height: 1.45; }
.sr-footnote { font-size: 0.72rem; color: var(--text-muted); margin: 0.5rem 0 0; }
.sr-empty, .sr-loading {
  padding: 1.5rem 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* --- Tabla comparativa --- */
.sr-table-wrap { overflow-x: auto; }
.sr-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.sr-table th, .sr-table td {
  padding: 0.5rem 0.55rem;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
  vertical-align: middle;
}
.sr-table thead th {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  white-space: nowrap;
}
.sr-table .num { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-sub); white-space: nowrap; }
.sr-table .num strong { color: var(--text-main); }
.sr-table tbody tr:hover { background: var(--bg-page-alt); }
.sr-table tfoot th, .sr-table tfoot td {
  border-top: 2px solid var(--border-strong);
  border-bottom: 0;
  font-weight: 600;
  color: var(--text-main);
}
.sr-rate { display: block; font-size: 0.72rem; color: var(--text-muted); }
.sr-sub { display: block; font-size: 0.7rem; color: var(--text-muted); }
.sr-person { display: flex; align-items: center; gap: 0.5rem; min-width: 150px; }
.sr-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
}
.sr-person-text { display: flex; flex-direction: column; min-width: 0; }
.sr-person-name { font-weight: 600; color: var(--text-main); }
.sr-person-role { font-size: 0.7rem; color: var(--text-muted); font-weight: 400; }
.sr-mini-track {
  display: block;
  height: 4px;
  margin-top: 0.25rem;
  border-radius: 2px;
  background: var(--border-color);
  overflow: hidden;
}
.sr-mini-bar { display: block; height: 100%; border-radius: 2px; }

/* --- Elegir de quién es el detalle --- */
.sr-focus { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.6rem; }
.sr-focus-chip {
  border: 1px solid var(--border-strong);
  background: var(--bg-card-solid);
  color: var(--text-sub);
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  cursor: pointer;
}
.sr-focus-chip.is-active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }

.sr-notes { margin-top: 1rem; font-size: 0.8rem; color: var(--text-muted); }
.sr-notes p { margin: 0 0 0.35rem; line-height: 1.5; }
.sr-generated { font-size: 0.72rem; }

@media (max-width: 900px) {
  .sr-grid { grid-template-columns: minmax(0, 1fr); }
}

/*
 * En el celular la tabla no se achica: se vuelve tarjetas, con el rótulo de
 * cada dato adentro (`data-label`). Nueve columnas en 380 px solo se pueden
 * leer arrastrando de lado, que es la misma razón por la que Cobranzas hace
 * esto. El total del equipo queda como una tarjeta más, la última.
 */
@media (max-width: 760px) {
  .sr-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .sr-table, .sr-table tbody, .sr-table tfoot, .sr-table tr, .sr-table th, .sr-table td { display: block; }
  .sr-table tr {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.6rem;
    margin-bottom: 0.5rem;
    background: var(--bg-card-solid);
  }
  .sr-table th, .sr-table td { border-bottom: 0; padding: 0.2rem 0; }
  /* El nombre con su círculo sigue siendo el encabezado de la tarjeta. */
  .sr-table th.sr-person, .sr-table tfoot th {
    display: flex;
    padding-bottom: 0.45rem;
    margin-bottom: 0.3rem;
    border-bottom: 1px solid var(--border-color);
  }
  /*
   * El rótulo flota a la izquierda y el valor queda a la derecha en la misma
   * línea; lo que el dato tenga debajo (la tasa, "2 canceladas") cae solo bajo
   * él. Con `flex` y `space-between`, en cambio, esos tres pedazos se
   * repartirían a lo ancho como si fueran columnas distintas.
   */
  .sr-table td[data-label] { text-align: right; overflow: hidden; }
  .sr-table td[data-label]::before {
    content: attr(data-label);
    float: left;
    font-size: 0.72rem;
    color: var(--text-muted);
    text-align: left;
  }
  .sr-mini-track { display: none; }
  .sr-table tfoot th, .sr-table tfoot td { border-top: 0; }
  .sr-table tfoot tr { border-color: var(--border-strong); border-width: 2px; }
}
@media (max-width: 520px) {
  .sr-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sr-kpi-value { font-size: 1.1rem; }
}
</style>
