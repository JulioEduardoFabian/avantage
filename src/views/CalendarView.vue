<template>
  <main class="container-fluid calendar-page">
    <header class="calendar-header">
      <div>
        <h2 class="section-heading"><span class="heading-icon">📅</span> Calendario</h2>
        <p class="section-subheading">
          Las reuniones del asesor: las que agendó el bot por WhatsApp y las cargadas a mano.
          <template v-if="scope === 'mine'">Ves tu propia agenda.</template>
        </p>
      </div>
      <div class="calendar-header-actions">
        <select
          v-if="scope === 'all'"
          v-model="advisorFilter"
          class="form-select calendar-advisor"
          @change="load"
        >
          <option :value="''">Todo el equipo</option>
          <option v-for="advisor in advisors" :key="advisor.id" :value="advisor.id">{{ advisor.name }}</option>
        </select>
        <button class="btn-action-primary" @click="openCreate(selectedDay)">+ Nueva reunión</button>
      </div>
    </header>

    <div class="calendar-nav">
      <button class="btn-action-ghost calendar-nav-btn" @click="moveMonth(-1)">◀</button>
      <h3 class="calendar-month">{{ monthLabel }}</h3>
      <button class="btn-action-ghost calendar-nav-btn" @click="moveMonth(1)">▶</button>
      <button class="btn-action-ghost calendar-nav-btn" @click="goToday">Hoy</button>
      <span v-if="isLoading" class="calendar-loading">Cargando…</span>
    </div>

    <p v-if="errorMessage" class="info-box calendar-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="notice" class="info-box calendar-notice">{{ notice }}</p>

    <div class="calendar-layout">
      <section class="calendar-grid-card">
        <div class="calendar-weekdays">
          <span v-for="dia in WEEKDAYS" :key="dia">{{ dia }}</span>
        </div>
        <div class="calendar-grid">
          <button
            v-for="celda in cells"
            :key="celda.iso"
            type="button"
            class="calendar-cell"
            :class="{
              'is-outside': !celda.inMonth,
              'is-today': celda.iso === today,
              'is-selected': celda.iso === selectedDay
            }"
            @click="selectedDay = celda.iso"
          >
            <span class="calendar-cell-day">{{ celda.day }}</span>
            <span
              v-for="meeting in (byDay[celda.iso] || []).slice(0, 3)"
              :key="meeting.id"
              class="calendar-chip"
              :class="meeting.source === 'manual' ? 'is-manual' : 'is-bot'"
              :title="chipTitle(meeting)"
            >
              {{ hourOf(meeting.start_time) }} {{ clientOf(meeting) }}
            </span>
            <span v-if="(byDay[celda.iso] || []).length > 3" class="calendar-more">
              +{{ (byDay[celda.iso] || []).length - 3 }} más
            </span>
          </button>
        </div>
      </section>

      <aside class="calendar-day-card">
        <header class="calendar-day-head">
          <h4 class="calendar-day-title">{{ longDay(selectedDay) }}</h4>
          <button class="btn-action-secondary calendar-day-add" @click="openCreate(selectedDay)">+ Agendar</button>
        </header>

        <p v-if="(byDay[selectedDay] || []).length === 0" class="calendar-day-empty">
          No hay reuniones este día.
        </p>

        <ul v-else class="calendar-day-list">
          <li v-for="meeting in byDay[selectedDay]" :key="meeting.id" class="calendar-meeting">
            <div class="calendar-meeting-time">
              {{ hourOf(meeting.start_time) }}–{{ hourOf(meeting.end_time) }}
            </div>
            <div class="calendar-meeting-body">
              <span class="calendar-meeting-client">{{ clientOf(meeting) }}</span>
              <span v-if="meeting.topic" class="calendar-meeting-topic">{{ meeting.topic }}</span>
              <span class="calendar-meeting-meta">
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

    <MeetingModal v-model="showModal" :date="modalDate" @created="onCreated" />
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import MeetingModal from '../components/MeetingModal.vue';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const meetings = ref([]);
const advisors = ref([]);
const advisorFilter = ref('');
const scope = ref('mine');
const isLoading = ref(false);
const errorMessage = ref('');
const notice = ref('');
const showModal = ref(false);
const modalDate = ref('');

function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = isoOf(new Date());
const cursor = ref(new Date());
const selectedDay = ref(today);

const monthLabel = computed(() => `${MESES[cursor.value.getMonth()]} ${cursor.value.getFullYear()}`);

/**
 * La grilla del mes, empezando en lunes y completada con los días de los meses
 * vecinos: siempre 6 filas de 7, para que el calendario no cambie de alto al
 * pasar de mes.
 */
const cells = computed(() => {
  const año = cursor.value.getFullYear();
  const mes = cursor.value.getMonth();
  const primero = new Date(año, mes, 1);
  // getDay() cuenta desde el domingo; la semana laboral de acá arranca el lunes.
  const desplazamiento = (primero.getDay() + 6) % 7;
  const inicio = new Date(año, mes, 1 - desplazamiento);

  return Array.from({ length: 42 }, (_, i) => {
    const dia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
    return { iso: isoOf(dia), day: dia.getDate(), inMonth: dia.getMonth() === mes };
  });
});

/**
 * Las reuniones agrupadas por día local. El servidor las manda en UTC, así que
 * el día se calcula desde el Date ya convertido por el navegador: una reunión
 * de las 19:00 en Lima no puede caer en el día siguiente de la grilla.
 */
const byDay = computed(() => {
  const mapa = {};
  for (const meeting of meetings.value) {
    const iso = isoOf(new Date(meeting.start_time));
    (mapa[iso] ||= []).push(meeting);
  }
  return mapa;
});

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
  const [y, m, d] = iso.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  return `${WEEKDAYS[(fecha.getDay() + 6) % 7]} ${d} de ${MESES[m - 1]}`;
}

function moveMonth(delta) {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + delta, 1);
  load();
}

function goToday() {
  cursor.value = new Date();
  selectedDay.value = today;
  load();
}

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    // Se pide el mes entero más los días vecinos que la grilla muestra.
    const desde = cells.value[0].iso;
    const hasta = cells.value[cells.value.length - 1].iso;
    const params = new URLSearchParams({ from: desde, to: hasta });
    if (advisorFilter.value) params.set('advisorUserId', advisorFilter.value);

    const response = await apiFetch(`/api/meetings?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el calendario.');
    meetings.value = data.meetings || [];
    scope.value = data.scope || 'mine';
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

function openCreate(dateIso) {
  modalDate.value = dateIso || today;
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

onMounted(() => {
  load();
  loadAdvisors();
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

.calendar-header-actions { display: flex; gap: 0.5rem; align-items: center; }
.calendar-advisor { max-width: 210px; }

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.calendar-nav-btn { padding: 0.25rem 0.6rem; }
.calendar-month { margin: 0; font-size: 1rem; text-transform: capitalize; min-width: 180px; text-align: center; }
.calendar-loading { font-size: 0.76rem; color: var(--text-muted); }

.calendar-alert { border-color: rgba(200, 85, 50, 0.4); background: rgba(200, 85, 50, 0.08); }
.calendar-notice { border-color: rgba(111, 129, 37, 0.4); background: rgba(111, 129, 37, 0.08); font-size: 0.84rem; }

.calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 0.75rem;
  align-items: start;
}

.calendar-grid-card,
.calendar-day-card {
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
  min-height: 92px;
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
.calendar-cell.is-outside { background: var(--surface-1); opacity: 0.6; }
.calendar-cell.is-today { border-color: var(--primary); }
.calendar-cell.is-selected { box-shadow: 0 0 0 2px var(--primary) inset; }

.calendar-cell-day { font-size: 0.74rem; font-weight: 600; color: var(--text-main); }

.calendar-chip {
  font-size: 0.66rem;
  padding: 0.1rem 0.25rem;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.calendar-chip.is-bot { background: rgba(58, 107, 138, 0.16); color: var(--text-sub); }
.calendar-chip.is-manual { background: rgba(111, 129, 37, 0.18); color: var(--text-sub); }
.calendar-more { font-size: 0.64rem; color: var(--text-muted); }

.calendar-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.calendar-day-title { margin: 0; font-size: 0.9rem; text-transform: capitalize; }
.calendar-day-add { padding: 0.25rem 0.55rem; font-size: 0.76rem; }
.calendar-day-empty { font-size: 0.8rem; color: var(--text-muted); margin: 0.5rem 0; }

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

.calendar-meeting-time { font-size: 0.74rem; font-weight: 700; white-space: nowrap; }
.calendar-meeting-body { display: flex; flex-direction: column; gap: 0.08rem; min-width: 0; flex: 1; }
.calendar-meeting-client { font-size: 0.84rem; font-weight: 600; color: var(--text-main); }
.calendar-meeting-topic { font-size: 0.74rem; color: var(--text-sub); }
.calendar-meeting-meta { font-size: 0.7rem; color: var(--text-muted); }
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

@media (max-width: 1000px) {
  .calendar-layout { grid-template-columns: 1fr; }
  .calendar-cell { min-height: 72px; }
}
</style>
