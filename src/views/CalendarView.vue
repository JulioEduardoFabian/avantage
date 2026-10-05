<template>
  <main class="container-fluid calendar-page">
    <header class="calendar-header">
      <div class="calendar-titles">
        <h2 class="section-heading"><span class="heading-icon">📅</span> Calendario</h2>
        <p class="section-subheading">
          La agenda del área comercial: las reuniones del bot y las cargadas a mano, sobre el horario
          en que el equipo puede reunirse.
        </p>
      </div>

      <div class="calendar-header-actions">
        <AdvisorPicker v-model="selectedAdvisors" :advisors="advisors" />
        <button
          class="btn-action-secondary"
          :class="{ 'is-pressed': showAvailability }"
          :title="showAvailability ? 'Ocultar la disponibilidad' : 'Pintar la disponibilidad sobre el calendario'"
          @click="showAvailability = !showAvailability"
        >🟩 Disponibilidad</button>
        <button class="btn-action-secondary" @click="showPeek = true">🕘 Ver horario</button>
        <button class="btn-action-primary" @click="openCreate(selectedDay)">+ Nueva reunión</button>
      </div>
    </header>

    <div class="calendar-toolbar">
      <div class="calendar-nav">
        <button class="btn-action-ghost calendar-nav-btn" :title="view === 'mes' ? 'Mes anterior' : 'Día anterior'" @click="step(-1)">◀</button>
        <h3 class="calendar-period">{{ periodLabel }}</h3>
        <button class="btn-action-ghost calendar-nav-btn" :title="view === 'mes' ? 'Mes siguiente' : 'Día siguiente'" @click="step(1)">▶</button>
        <button class="btn-action-ghost calendar-nav-btn" @click="goToday">Hoy</button>
        <span v-if="isLoading" class="calendar-loading">Cargando…</span>
      </div>

      <div class="calendar-views">
        <button
          v-for="opcion in VIEWS"
          :key="opcion.value"
          type="button"
          class="calendar-view-btn"
          :class="{ 'is-active': view === opcion.value }"
          @click="view = opcion.value"
        >{{ opcion.label }}</button>
      </div>
    </div>

    <!-- Lo que se está cruzando, dicho con palabras: el color solo no alcanza. -->
    <section v-if="showAvailability" class="calendar-legend">
      <span class="legend-scope">
        {{ scopeLabel }}
        <strong v-if="commonMinutes[focusWeekday]">· {{ formatDuration(commonMinutes[focusWeekday]) }} en común el {{ DAYS[focusWeekday].label.toLowerCase() }}</strong>
        <strong v-else>· sin bloques en común el {{ DAYS[focusWeekday].label.toLowerCase() }}</strong>
      </span>
      <span class="legend-keys">
        <span class="legend-key"><i class="legend-swatch is-full"></i> todos</span>
        <span v-if="effectiveAdvisors.length > 1" class="legend-key"><i class="legend-swatch is-mid"></i> la mayoría</span>
        <span v-if="effectiveAdvisors.length > 2" class="legend-key"><i class="legend-swatch is-low"></i> alguno</span>
        <span class="legend-key"><i class="legend-swatch is-none"></i> nadie</span>
      </span>
    </section>

    <p v-if="errorMessage" class="info-box calendar-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="notice" class="info-box calendar-notice">{{ notice }}</p>

    <!-- ------------------------------- Mes ------------------------------- -->
    <div v-if="view === 'mes'" class="calendar-layout">
      <section class="calendar-grid-card">
        <div class="calendar-weekdays">
          <span v-for="dia in DAYS" :key="dia.value">{{ dia.short }}</span>
        </div>
        <div class="calendar-grid">
          <div
            v-for="celda in cells"
            :key="celda.iso"
            class="calendar-cell"
            :class="{
              'is-outside': !celda.inMonth,
              'is-today': celda.iso === today,
              'is-selected': celda.iso === selectedDay
            }"
            role="button"
            tabindex="0"
            @click="selectDay(celda.iso)"
            @dblclick="openDay(celda.iso)"
            @keydown.enter="openDay(celda.iso)"
          >
            <div class="calendar-cell-top">
              <span class="calendar-cell-day">{{ celda.day }}</span>
              <button
                class="calendar-cell-add"
                title="Agendar este día"
                @click.stop="openCreate(celda.iso)"
              >+</button>
            </div>

            <div
              v-if="showAvailability"
              class="calendar-cell-heat"
              :style="{ backgroundImage: heatGradient(celda.weekday) }"
              :title="heatTitle(celda.weekday)"
            ></div>

            <span
              v-for="meeting in (byDay[celda.iso] || []).slice(0, 3)"
              :key="meeting.id"
              class="calendar-chip"
              :title="chipTitle(meeting)"
              @click.stop="openDay(celda.iso)"
            >
              <i class="calendar-chip-dot" :style="{ background: avatarColor(meeting.advisor_name) }"></i>
              <b>{{ hourOf(meeting.start_time) }}</b> {{ clientOf(meeting) }}
            </span>
            <button
              v-if="(byDay[celda.iso] || []).length > 3"
              class="calendar-more"
              @click.stop="openDay(celda.iso)"
            >+{{ (byDay[celda.iso] || []).length - 3 }} más</button>
          </div>
        </div>
      </section>

      <aside class="calendar-day-card">
        <header class="calendar-day-head">
          <div>
            <h4 class="calendar-day-title">{{ longDay(selectedDay) }}</h4>
            <span class="calendar-day-count">{{ dayCountLabel }}</span>
          </div>
          <button class="btn-action-secondary calendar-day-add" @click="openDay(selectedDay)">Ver el día →</button>
        </header>

        <div v-if="showAvailability" class="calendar-day-ranges">
          <span class="calendar-day-ranges-label">Coinciden:</span>
          <template v-if="commonRanges[focusWeekday]?.length">
            <span v-for="rango in commonRanges[focusWeekday]" :key="rango.start" class="calendar-range-pill">
              {{ formatRange(rango) }}
            </span>
          </template>
          <span v-else class="calendar-day-ranges-empty">nadie en común este día</span>
        </div>

        <p v-if="(byDay[selectedDay] || []).length === 0" class="calendar-day-empty">
          No hay reuniones este día.
          <button class="calendar-inline-link" @click="openCreate(selectedDay)">Agendar una</button>
        </p>

        <ul v-else class="calendar-day-list">
          <li v-for="meeting in byDay[selectedDay]" :key="meeting.id" class="calendar-meeting">
            <div class="calendar-meeting-time">
              {{ hourOf(meeting.start_time) }}<small>{{ hourOf(meeting.end_time) }}</small>
            </div>
            <div class="calendar-meeting-body">
              <span class="calendar-meeting-client">{{ clientOf(meeting) }}</span>
              <span v-if="meeting.topic" class="calendar-meeting-topic">{{ meeting.topic }}</span>
              <span class="calendar-meeting-meta">
                <i class="calendar-chip-dot" :style="{ background: avatarColor(meeting.advisor_name) }"></i>
                {{ meeting.advisor_name || 'Sin asesor' }} ·
                {{ meeting.source === 'manual' ? 'cargada a mano' : 'agendada por el bot' }}
              </span>
              <span v-if="meeting.lead_phone" class="calendar-meeting-meta">📱 {{ meeting.lead_phone }}</span>
              <a
                v-if="meeting.meet_link"
                :href="meeting.meet_link"
                target="_blank"
                rel="noopener"
                class="calendar-meeting-link"
              >🎥 Entrar a la reunión</a>
              <span v-else class="calendar-meeting-meta">Sin enlace de Meet</span>
            </div>
            <button
              type="button"
              class="calendar-meeting-remove"
              title="Quitar del panel (no cancela el evento en Google Calendar)"
              @click="remove(meeting)"
            >🗑️</button>
          </li>
        </ul>
      </aside>
    </div>

    <!-- ------------------------------- Día ------------------------------- -->
    <section v-else class="calendar-day-view">
      <header class="dayview-head">
        <div>
          <h4 class="dayview-title">{{ longDay(selectedDay) }}</h4>
          <span class="calendar-day-count">{{ dayCountLabel }}</span>
        </div>
        <div v-if="showAvailability" class="calendar-day-ranges">
          <span class="calendar-day-ranges-label">Coinciden:</span>
          <template v-if="commonRanges[focusWeekday]?.length">
            <span v-for="rango in commonRanges[focusWeekday]" :key="rango.start" class="calendar-range-pill">
              {{ formatRange(rango) }}
            </span>
          </template>
          <span v-else class="calendar-day-ranges-empty">nadie en común este día</span>
        </div>
      </header>

      <p class="dayview-hint">Haz clic en una franja para agendar a esa hora.</p>

      <div class="dayview-board custom-scrollbar">
        <div class="dayview-rail">
          <span v-for="slot in TIME_SLOTS" :key="slot" class="dayview-rail-slot">
            <template v-if="slot.endsWith(':00')">{{ slot }}</template>
          </span>
        </div>

        <div class="dayview-track">
          <button
            v-for="slot in TIME_SLOTS"
            :key="slot"
            type="button"
            class="dayview-slot"
            :class="[`heat-${showAvailability ? heatLevel(focusWeekday, slot) : 'off'}`, { 'is-hour': slot.endsWith(':00') }]"
            :title="slotTitle(slot)"
            @click="openCreate(selectedDay, slot)"
          ></button>

          <div v-if="selectedDay === today && nowOffset !== null" class="dayview-now" :style="{ top: `${nowOffset}px` }">
            <span class="dayview-now-label">ahora</span>
          </div>

          <article
            v-for="bloque in positionedMeetings"
            :key="bloque.meeting.id"
            class="dayview-meeting"
            :style="bloque.style"
          >
            <span class="dayview-meeting-bar" :style="{ background: avatarColor(bloque.meeting.advisor_name) }"></span>
            <div class="dayview-meeting-body">
              <strong class="dayview-meeting-client">{{ clientOf(bloque.meeting) }}</strong>
              <span class="dayview-meeting-meta">
                {{ hourOf(bloque.meeting.start_time) }}–{{ hourOf(bloque.meeting.end_time) }} ·
                {{ bloque.meeting.advisor_name || 'sin asesor' }}
              </span>
              <span v-if="bloque.meeting.topic" class="dayview-meeting-topic">{{ bloque.meeting.topic }}</span>
              <div class="dayview-meeting-actions">
                <a
                  v-if="bloque.meeting.meet_link"
                  :href="bloque.meeting.meet_link"
                  target="_blank"
                  rel="noopener"
                  class="dayview-meeting-link"
                >🎥 Entrar</a>
                <button type="button" class="dayview-meeting-remove" title="Quitar del panel" @click="remove(bloque.meeting)">🗑️</button>
              </div>
            </div>
          </article>
        </div>
      </div>

      <p v-if="outOfRangeMeetings.length" class="dayview-outside">
        Fuera del horario que se dibuja (07:00–21:00):
        <span v-for="meeting in outOfRangeMeetings" :key="meeting.id" class="calendar-range-pill">
          {{ hourOf(meeting.start_time) }} {{ clientOf(meeting) }}
        </span>
      </p>
    </section>

    <MeetingModal v-model="showModal" :date="modalDate" :time="modalTime" @created="onCreated" />
    <AvailabilityPeekModal
      v-model="showPeek"
      :advisors="advisors"
      :advisor-user-id="selectedAdvisors[0] || authState.user?.id"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { authState } from '../auth.js';
import { avatarColor } from '../avatars.js';
import {
  DAYS,
  DAY_END_HOUR,
  DAY_START_HOUR,
  SLOT_MINUTES,
  TIME_SLOTS,
  countAvailability,
  formatDuration,
  formatRange,
  mergeRanges,
  minutesOf,
  weekdayOf
} from '../availabilityGrid.js';
import AdvisorPicker from '../components/AdvisorPicker.vue';
import AvailabilityPeekModal from '../components/AvailabilityPeekModal.vue';
import MeetingModal from '../components/MeetingModal.vue';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const VIEWS = [{ value: 'mes', label: 'Mes' }, { value: 'dia', label: 'Día' }];

/** Alto de un bloque de media hora en la vista de día (hay que repetirlo en el CSS). */
const SLOT_PX = 26;

const meetings = ref([]);
const advisors = ref([]);
const selectedAdvisors = ref([]);
const availabilitySlots = ref([]);
const showAvailability = ref(true);
const view = ref('mes');
const isLoading = ref(false);
const errorMessage = ref('');
const notice = ref('');
const showModal = ref(false);
const showPeek = ref(false);
const modalDate = ref('');
const modalTime = ref('');

function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const today = isoOf(new Date());
const cursor = ref(new Date());
const selectedDay = ref(today);

/**
 * La grilla del mes, empezando en lunes y completada con los días de los meses
 * vecinos: siempre 6 filas de 7, para que el calendario no cambie de alto al
 * pasar de mes.
 */
const cells = computed(() => {
  const año = cursor.value.getFullYear();
  const mes = cursor.value.getMonth();
  const primero = new Date(año, mes, 1);
  const desplazamiento = weekdayOf(primero);
  const inicio = new Date(año, mes, 1 - desplazamiento);

  return Array.from({ length: 42 }, (_, i) => {
    const dia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    return { iso: isoOf(dia), day: dia.getDate(), inMonth: dia.getMonth() === mes, weekday: weekdayOf(dia) };
  });
});

const periodLabel = computed(() => (
  view.value === 'mes'
    ? `${MESES[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`
    : longDay(selectedDay.value)
));

/* ----------------------------- Las reuniones ----------------------------- */

/**
 * Se traen las del mes entero sin filtrar por asesor y el recorte se hace acá:
 * marcar o desmarcar a alguien en el selector tiene que repintar al instante,
 * y un viaje al servidor por cada casilla hace sentir lenta una pantalla que
 * ya tiene los datos.
 */
const visibleMeetings = computed(() => {
  if (selectedAdvisors.value.length === 0) return meetings.value;
  return meetings.value.filter((m) => selectedAdvisors.value.includes(m.advisor_user_id));
});

const byDay = computed(() => {
  const mapa = {};
  for (const meeting of visibleMeetings.value) {
    const iso = isoOf(new Date(meeting.start_time));
    (mapa[iso] ||= []).push(meeting);
  }
  for (const lista of Object.values(mapa)) {
    lista.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }
  return mapa;
});

const dayCountLabel = computed(() => {
  const total = (byDay.value[selectedDay.value] || []).length;
  if (total === 0) return 'Sin reuniones';
  return total === 1 ? '1 reunión' : `${total} reuniones`;
});

/* --------------------------- La disponibilidad --------------------------- */

/** A quiénes se está cruzando: los elegidos, o todo el equipo si no hay nadie. */
const effectiveAdvisors = computed(() => (
  selectedAdvisors.value.length > 0
    ? advisors.value.filter((a) => selectedAdvisors.value.includes(a.id))
    : advisors.value
));

const scopeLabel = computed(() => {
  const total = effectiveAdvisors.value.length;
  if (total === 0) return 'Sin asesores para cruzar';
  if (total === 1) return `Horario de ${effectiveAdvisors.value[0].name}`;
  return selectedAdvisors.value.length > 0
    ? `Cruce de ${total} asesores`
    : `Cruce de todo el equipo (${total})`;
});

const availabilityCount = computed(() => countAvailability(availabilitySlots.value));

/** El día de la semana que se está mirando: el del día seleccionado. */
const focusWeekday = computed(() => weekdayOf(dateOf(selectedDay.value)));

/**
 * Qué tan lleno está un bloque: `full` cuando pueden TODOS los elegidos (el
 * cruce de verdad), y tonos más suaves cuando pueden algunos. Con tres
 * asesores el cruce completo suele ser chico, y pintar solo eso haría
 * desaparecer la franja en la que faltaba uno — que es la que se negocia.
 */
function heatLevel(weekday, slot) {
  const total = effectiveAdvisors.value.length;
  if (total === 0) return 'none';
  const cuenta = availabilityCount.value[`${weekday}-${slot}`] || 0;
  if (cuenta === 0) return 'none';
  if (cuenta >= total) return 'full';
  return cuenta / total >= 0.5 ? 'mid' : 'low';
}

const HEAT_COLORS = {
  none: 'transparent',
  low: 'rgba(158, 186, 75, 0.16)',
  mid: 'rgba(158, 186, 75, 0.36)',
  full: 'rgba(158, 186, 75, 0.72)'
};

/**
 * La franja de disponibilidad de la celda del mes, dibujada como UN gradiente
 * con cortes duros en vez de 28 divs por día: el mes tiene 42 celdas y eso
 * serían más de mil nodos solo para pintar un hilo de 5 px.
 */
function heatGradient(weekday) {
  if (effectiveAdvisors.value.length === 0) return '';
  const paso = 100 / TIME_SLOTS.length;
  const tramos = TIME_SLOTS.map((slot, i) => {
    const color = HEAT_COLORS[heatLevel(weekday, slot)];
    return `${color} ${i * paso}%, ${color} ${(i + 1) * paso}%`;
  });
  return `linear-gradient(90deg, ${tramos.join(', ')})`;
}

/** Los bloques en los que pueden TODOS, unidos en rangos, por día. */
const commonRanges = computed(() => {
  const total = effectiveAdvisors.value.length;
  const resultado = {};
  if (total === 0) return resultado;

  for (const dia of DAYS) {
    const libres = TIME_SLOTS
      .filter((slot) => (availabilityCount.value[`${dia.value}-${slot}`] || 0) >= total)
      .map(minutesOf);
    resultado[dia.value] = mergeRanges(libres);
  }
  return resultado;
});

const commonMinutes = computed(() => {
  const resultado = {};
  for (const [dia, rangos] of Object.entries(commonRanges.value)) {
    resultado[dia] = rangos.reduce((suma, rango) => suma + (rango.end - rango.start), 0);
  }
  return resultado;
});

function heatTitle(weekday) {
  const minutos = commonMinutes.value[weekday] || 0;
  const dia = DAYS[weekday].label.toLowerCase();
  return minutos > 0
    ? `${formatDuration(minutos)} en común los ${dia}`
    : `Sin bloques en común los ${dia}`;
}

function slotTitle(slot) {
  if (!showAvailability.value || effectiveAdvisors.value.length === 0) return `Agendar a las ${slot}`;
  const cuenta = availabilityCount.value[`${focusWeekday.value}-${slot}`] || 0;
  const total = effectiveAdvisors.value.length;
  if (total === 1) return cuenta > 0 ? `Disponible a las ${slot}` : `No disponible a las ${slot}`;
  return `${cuenta} de ${total} disponibles a las ${slot} · clic para agendar`;
}

/* ---------------------------- La vista de día ---------------------------- */

const DAY_START_MIN = DAY_START_HOUR * 60;
const DAY_END_MIN = DAY_END_HOUR * 60;

const dayMeetings = computed(() => byDay.value[selectedDay.value] || []);

function minutesOfDate(value) {
  const fecha = new Date(value);
  return fecha.getHours() * 60 + fecha.getMinutes();
}

/**
 * Las que caen fuera de la franja dibujada (07:00–21:00). No se tiran: se
 * listan al pie. Una reunión a las 06:30 que no aparece en ningún lado es
 * peor que una que aparece aparte.
 */
const outOfRangeMeetings = computed(() => dayMeetings.value.filter((m) => {
  const inicio = minutesOfDate(m.start_time);
  return inicio < DAY_START_MIN || inicio >= DAY_END_MIN;
}));

/**
 * Las reuniones del día ubicadas sobre la línea de tiempo. Las que se pisan se
 * reparten en carriles: dos reuniones a la misma hora, una encima de la otra,
 * esconden justamente el choque que hay que ver.
 */
const positionedMeetings = computed(() => {
  const fuera = new Set(outOfRangeMeetings.value);
  const dentro = dayMeetings.value
    .filter((m) => !fuera.has(m))
    .map((m) => {
      const inicio = minutesOfDate(m.start_time);
      const fin = Math.min(Math.max(minutesOfDate(m.end_time), inicio + SLOT_MINUTES), DAY_END_MIN);
      return { meeting: m, inicio, fin, carril: 0, grupo: 0 };
    })
    .sort((a, b) => a.inicio - b.inicio);

  // Grupos de reuniones encadenadas por superposición; dentro de cada grupo,
  // cada una entra en el primer carril que ya terminó.
  const grupos = [];
  let carriles = [];
  let actual = [];
  let finGrupo = -1;

  for (const item of dentro) {
    if (actual.length > 0 && item.inicio >= finGrupo) {
      grupos.push(actual);
      actual = [];
      carriles = [];
    }
    let carril = carriles.findIndex((fin) => fin <= item.inicio);
    if (carril === -1) carril = carriles.length;
    carriles[carril] = item.fin;
    item.carril = carril;
    item.grupo = grupos.length;
    actual.push(item);
    finGrupo = Math.max(finGrupo, item.fin);
  }
  if (actual.length > 0) grupos.push(actual);

  const px = (minutos) => ((minutos - DAY_START_MIN) / SLOT_MINUTES) * SLOT_PX;

  return dentro.map((item) => {
    const ancho = Math.max(...grupos[item.grupo].map((otro) => otro.carril + 1));
    return {
      meeting: item.meeting,
      style: {
        top: `${px(item.inicio)}px`,
        height: `${Math.max(px(item.fin) - px(item.inicio) - 2, 22)}px`,
        left: `calc(${(item.carril / ancho) * 100}% + 2px)`,
        width: `calc(${100 / ancho}% - 6px)`
      }
    };
  });
});

/** La línea de "ahora", solo si cae dentro de la franja dibujada. */
const nowOffset = ref(null);

function refreshNow() {
  const ahora = new Date();
  const minutos = ahora.getHours() * 60 + ahora.getMinutes();
  nowOffset.value = minutos >= DAY_START_MIN && minutos <= DAY_END_MIN
    ? ((minutos - DAY_START_MIN) / SLOT_MINUTES) * SLOT_PX
    : null;
}

/* -------------------------------- Formato -------------------------------- */

function hourOf(value) {
  const fecha = new Date(value);
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

function clientOf(meeting) {
  return meeting.lead_full_name || meeting.lead_topic || meeting.topic || 'Reunión';
}

function chipTitle(meeting) {
  return `${hourOf(meeting.start_time)} · ${clientOf(meeting)} · ${meeting.advisor_name || 'sin asesor'}`;
}

function longDay(iso) {
  const fecha = dateOf(iso);
  return `${DAYS[weekdayOf(fecha)].label} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}

/* ------------------------------ Navegación ------------------------------- */

function step(delta) {
  if (view.value === 'mes') {
    cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1);
    load();
    return;
  }
  const siguiente = dateOf(selectedDay.value);
  siguiente.setDate(siguiente.getDate() + delta);
  selectDay(isoOf(siguiente));
}

/**
 * Elegir un día puede sacarnos del mes cargado (el 31 → el 1). El cursor se
 * mueve con él y se vuelve a pedir el rango: si no, la vista de día quedaría
 * vacía aunque haya reuniones.
 */
function selectDay(iso) {
  selectedDay.value = iso;
  const fecha = dateOf(iso);
  if (fecha.getMonth() !== cursor.value.getMonth() || fecha.getFullYear() !== cursor.value.getFullYear()) {
    cursor.value = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    load();
  }
}

function openDay(iso) {
  selectDay(iso);
  view.value = 'dia';
}

function goToday() {
  cursor.value = new Date();
  selectDay(today);
  refreshNow();
}

/* ------------------------------- Los datos ------------------------------- */

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const desde = cells.value[0].iso;
    const hasta = cells.value[cells.value.length - 1].iso;
    const response = await apiFetch(`/api/meetings?from=${desde}&to=${hasta}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el calendario.');
    meetings.value = data.meetings || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

async function loadAdvisors() {
  try {
    const response = await apiFetch('/api/meetings/advisors');
    const data = await response.json();
    if (response.ok) advisors.value = data.advisors || [];
  } catch {
    // El selector de asesor es una comodidad: si falla, el calendario sigue.
  }
}

async function loadAvailability() {
  const ids = effectiveAdvisors.value.map((a) => a.id);
  if (ids.length === 0) {
    availabilitySlots.value = [];
    return;
  }
  try {
    const response = await apiFetch(`/api/availability/team?userIds=${ids.join(',')}`);
    const data = await response.json();
    if (response.ok) availabilitySlots.value = data.slots || [];
  } catch {
    // Sin el horario el calendario sigue sirviendo: solo no se pinta el cruce.
  }
}

function openCreate(dateIso, time) {
  modalDate.value = dateIso || today;
  modalTime.value = time || '';
  showModal.value = true;
}

function onCreated(data) {
  notice.value = data.calendarError
    ? `Reunión guardada, pero no se pudo crear el evento en Google Calendar (${data.calendarError}). No hay enlace de Meet.`
    : '✅ Reunión agendada y enviada al calendario del asesor.';
  setTimeout(() => { notice.value = ''; }, 8000);
  load();
}

async function remove(meeting) {
  try {
    const response = await apiFetch(`/api/meetings/${meeting.id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo quitar la reunión.');
    notice.value = data.hadCalendarEvent
      ? 'Reunión quitada del panel. El evento sigue en Google Calendar: cancélalo desde ahí si corresponde.'
      : 'Reunión quitada del panel.';
    setTimeout(() => { notice.value = ''; }, 8000);
    load();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

// El cruce se recalcula cuando cambia a quién se está mirando (y cuando llega
// el equipo, que es lo que define el "todos" por defecto).
watch([advisors, selectedAdvisors], loadAvailability, { deep: true });

let nowTimer = null;

onMounted(() => {
  load();
  loadAdvisors();
  refreshNow();
  nowTimer = setInterval(refreshNow, 60000);
});

onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer);
});
</script>

<style scoped>
.calendar-page { padding: var(--page-py) var(--page-px) var(--page-pb); }

.calendar-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.6rem;
}

.calendar-titles { min-width: 0; }

.calendar-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  justify-content: flex-end;
}

.btn-action-secondary.is-pressed {
  border-color: var(--primary);
  color: var(--primary);
}

.calendar-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.calendar-nav { display: flex; align-items: center; gap: 0.3rem; }
.calendar-nav-btn { padding: 0.25rem 0.6rem; }

.calendar-period {
  margin: 0;
  font-size: 1rem;
  text-transform: capitalize;
  min-width: 210px;
  text-align: center;
}

.calendar-loading { font-size: 0.76rem; color: var(--text-muted); }

.calendar-views {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--surface-1);
}

.calendar-view-btn {
  border: none;
  background: none;
  color: var(--text-sub);
  font-size: 0.76rem;
  padding: 0.22rem 0.8rem;
  border-radius: 999px;
  cursor: pointer;
}

.calendar-view-btn.is-active { background: var(--primary); color: #fff; font-weight: 600; }

/* --------------------------------- Leyenda -------------------------------- */

.calendar-legend {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  font-size: 0.74rem;
  color: var(--text-sub);
}

.legend-keys { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.legend-key { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--text-muted); }

.legend-swatch {
  width: 14px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid var(--border-color);
  display: inline-block;
}

.legend-swatch.is-full { background: rgba(158, 186, 75, 0.72); }
.legend-swatch.is-mid { background: rgba(158, 186, 75, 0.36); }
.legend-swatch.is-low { background: rgba(158, 186, 75, 0.16); }
.legend-swatch.is-none { background: transparent; }

.calendar-alert { border-color: rgba(200, 85, 50, 0.4); background: rgba(200, 85, 50, 0.08); }
.calendar-notice { border-color: rgba(111, 129, 37, 0.4); background: rgba(111, 129, 37, 0.08); font-size: 0.84rem; }

/* ----------------------------------- Mes ---------------------------------- */

.calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 0.75rem;
  align-items: start;
}

.calendar-grid-card,
.calendar-day-card,
.calendar-day-view {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.6rem;
}

.calendar-weekdays,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
}

.calendar-weekdays span {
  text-align: center;
  font-size: 0.7rem;
  color: var(--text-muted);
  padding-bottom: 0.25rem;
}

.calendar-cell {
  min-height: 96px;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.3rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
}

.calendar-cell:hover { border-color: var(--border-strong); }
.calendar-cell.is-outside { background: var(--surface-1); opacity: 0.55; }
.calendar-cell.is-today { border-color: var(--primary); }
.calendar-cell.is-selected { box-shadow: 0 0 0 2px var(--primary) inset; }

.calendar-cell-top { display: flex; align-items: center; justify-content: space-between; }
.calendar-cell-day { font-size: 0.74rem; font-weight: 600; color: var(--text-main); }

.calendar-cell-add {
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  padding: 0 0.15rem;
}

.calendar-cell:hover .calendar-cell-add { opacity: 1; }
.calendar-cell-add:hover { color: var(--primary); }

.calendar-cell-heat {
  height: 5px;
  border-radius: 3px;
  background-color: var(--surface-2);
  margin-bottom: 0.15rem;
  flex-shrink: 0;
}

.calendar-chip {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  font-size: 0.66rem;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calendar-chip b { font-weight: 700; }

.calendar-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}

.calendar-more {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
  font-size: 0.64rem;
  color: var(--text-muted);
  cursor: pointer;
}

.calendar-more:hover { color: var(--primary); }

/* ------------------------------ Panel del día ----------------------------- */

.calendar-day-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.calendar-day-title { margin: 0; font-size: 0.9rem; text-transform: capitalize; }
.calendar-day-count { font-size: 0.72rem; color: var(--text-muted); }
.calendar-day-add { padding: 0.25rem 0.55rem; font-size: 0.74rem; white-space: nowrap; }

.calendar-day-ranges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.calendar-day-ranges-empty { font-style: italic; }

.calendar-range-pill {
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  background: rgba(158, 186, 75, 0.2);
  color: var(--text-sub);
  white-space: nowrap;
}

.calendar-day-empty { font-size: 0.8rem; color: var(--text-muted); margin: 0.5rem 0; }

.calendar-inline-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--primary);
  cursor: pointer;
  font-size: 0.8rem;
  text-decoration: underline;
}

.calendar-day-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.45rem; }

.calendar-meeting {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.calendar-meeting-time {
  font-size: 0.74rem;
  font-weight: 700;
  white-space: nowrap;
  display: flex;
  flex-direction: column;
}

.calendar-meeting-time small { font-weight: 400; color: var(--text-muted); }
.calendar-meeting-body { display: flex; flex-direction: column; gap: 0.08rem; min-width: 0; flex: 1; }
.calendar-meeting-client { font-size: 0.84rem; font-weight: 600; color: var(--text-main); }
.calendar-meeting-topic { font-size: 0.74rem; color: var(--text-sub); }
.calendar-meeting-meta { font-size: 0.7rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.25rem; }
.calendar-meeting-link { font-size: 0.74rem; color: var(--primary); text-decoration: none; }
.calendar-meeting-link:hover { text-decoration: underline; }

.calendar-meeting-remove {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.8rem;
  align-self: flex-start;
  opacity: 0.6;
}

.calendar-meeting-remove:hover { opacity: 1; }

/* ------------------------------ Vista de día ------------------------------ */

.dayview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.3rem;
}

.dayview-title { margin: 0; font-size: 1rem; text-transform: capitalize; }
.dayview-hint { margin: 0 0 0.4rem; font-size: 0.72rem; color: var(--text-muted); }

.dayview-board {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  max-height: 62vh;
  overflow-y: auto;
}

.dayview-rail { display: flex; flex-direction: column; }

.dayview-rail-slot {
  height: 26px;
  font-size: 0.68rem;
  color: var(--text-muted);
  text-align: right;
  padding-right: 0.4rem;
  transform: translateY(-0.4em);
}

.dayview-track { position: relative; display: flex; flex-direction: column; }

.dayview-slot {
  height: 26px;
  border: none;
  border-top: 1px dashed var(--border-color);
  background: transparent;
  cursor: pointer;
  padding: 0;
}

.dayview-slot.is-hour { border-top-style: solid; }
.dayview-slot:hover { outline: 1px solid var(--primary); outline-offset: -1px; }

.dayview-slot.heat-low { background: rgba(158, 186, 75, 0.16); }
.dayview-slot.heat-mid { background: rgba(158, 186, 75, 0.36); }
.dayview-slot.heat-full { background: rgba(158, 186, 75, 0.72); }

.dayview-now {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 2px solid #C85532;
  pointer-events: none;
  z-index: 3;
}

.dayview-now-label {
  position: absolute;
  top: -8px;
  left: 0;
  font-size: 0.58rem;
  background: #C85532;
  color: #fff;
  padding: 0 0.25rem;
  border-radius: 3px;
}

.dayview-meeting {
  position: absolute;
  display: flex;
  gap: 0.35rem;
  overflow: hidden;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  z-index: 2;
}

.dayview-meeting-bar { width: 3px; border-radius: 2px; flex-shrink: 0; }
.dayview-meeting-body { display: flex; flex-direction: column; min-width: 0; gap: 0.05rem; }
.dayview-meeting-client { font-size: 0.76rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dayview-meeting-meta { font-size: 0.66rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dayview-meeting-topic { font-size: 0.66rem; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dayview-meeting-actions { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.1rem; }
.dayview-meeting-link { font-size: 0.66rem; color: var(--primary); text-decoration: none; }
.dayview-meeting-remove { border: none; background: none; cursor: pointer; font-size: 0.68rem; opacity: 0.6; padding: 0; }
.dayview-meeting-remove:hover { opacity: 1; }

.dayview-outside {
  margin: 0.5rem 0 0;
  font-size: 0.72rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
}

@media (max-width: 1000px) {
  .calendar-layout { grid-template-columns: 1fr; }
  .calendar-cell { min-height: 76px; }
  .calendar-header { flex-direction: column; align-items: stretch; }
  .calendar-header-actions { justify-content: flex-start; }
  .calendar-period { min-width: 150px; font-size: 0.9rem; }
}

@media (max-width: 680px) {
  /*
   * En el celular el mes es para ubicarse, no para leer: la tarjeta de una
   * reunión no entra en una columna de 50 px. Queda el número del día, la
   * franja de disponibilidad y una raya por reunión —con el color de su
   * asesor—, y el detalle se mira en la vista de día, que sí está pensada para
   * una sola columna.
   */
  .calendar-cell { min-height: 58px; }
  .calendar-chip { font-size: 0; padding: 0; height: 6px; background: none; gap: 0; }
  .calendar-chip b { font-size: 0; }
  .calendar-chip-dot { width: 100%; height: 5px; border-radius: 3px; }
  .calendar-more { font-size: 0.6rem; }
  .calendar-cell-add { display: none; }
  .dayview-board { max-height: none; }
}
</style>
