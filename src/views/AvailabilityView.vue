<template>
  <main class="container-fluid availability-page-wrapper">
    <header class="availability-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">🗓️</span> Mi Disponibilidad
        </h2>
        <p class="section-subheading">
          Marca los bloques de media hora en los que puedes reunirte. Haz clic y arrastra para pintar varios
          a la vez, o usa los atajos rápidos.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-secondary" @click="clearAll" :disabled="isSaving">
          🧹 Limpiar todo
        </button>
        <button class="btn-action-primary" @click="save" :disabled="isSaving || !isDirty">
          {{ isSaving ? 'Guardando...' : (isDirty ? '💾 Guardar cambios' : '✅ Guardado') }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="info-box alert-box">⚠️ {{ errorMessage }}</p>
    <p v-if="savedMessage" class="info-box success-box">✅ {{ savedMessage }}</p>

    <!-- Conexión con Google Calendar -->
    <section class="google-card" :class="{ connected: googleStatus.connected }">
      <div class="google-card-main">
        <span class="google-icon">📅</span>
        <div class="google-info">
          <strong class="google-title">Google Calendar</strong>
          <span v-if="!googleStatus.configured" class="google-sub">
            El servidor todavía no tiene configuradas las credenciales de Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
          </span>
          <span v-else-if="googleStatus.connected" class="google-sub">
            Conectado como <strong>{{ googleStatus.email }}</strong>. Las reuniones que se agenden contigo se crearán ahí, con link de Google Meet.
          </span>
          <span v-else-if="googleStatus.needsReconnect" class="google-sub google-sub-warn">
            ⚠️ Tu conexión con Google Calendar caducó (Google revocó el acceso). Vuelve a conectarla para que Avan pueda agendar llamadas en tu calendario.
          </span>
          <span v-else class="google-sub">
            Conecta tu cuenta de Google para que las reuniones agendadas contigo generen automáticamente un link de Google Meet en tu propio calendario.
          </span>
        </div>
      </div>

      <div class="google-actions">
        <template v-if="googleStatus.connected">
          <button class="btn-action-secondary" @click="testGoogleConnection" :disabled="isTestingGoogle">
            {{ isTestingGoogle ? 'Probando...' : '🧪 Probar conexión' }}
          </button>
          <button class="btn-action-ghost" @click="disconnectGoogle" :disabled="isTestingGoogle">
            Desconectar
          </button>
        </template>
        <button v-else class="btn-action-primary" @click="connectGoogle" :disabled="!googleStatus.configured || isConnectingGoogle">
          {{ isConnectingGoogle ? 'Redirigiendo...' : '🔗 Conectar Google Calendar' }}
        </button>
      </div>
    </section>

    <p v-if="googleTestResult" class="info-box success-box">
      ✅ Evento de prueba creado. Link de Meet:
      <a :href="googleTestResult.meetLink" target="_blank" rel="noopener">{{ googleTestResult.meetLink }}</a>
    </p>

    <!-- Próximas reuniones agendadas por Avan -->
    <section class="meetings-card">
      <div class="meetings-header">
        <h4>📞 Próximas reuniones agendadas</h4>
        <button class="btn-action-secondary meetings-refresh" @click="fetchUpcomingMeetings" :disabled="isLoadingMeetings">
          {{ isLoadingMeetings ? 'Cargando...' : '🔄 Actualizar' }}
        </button>
      </div>

      <div v-if="upcomingMeetings.length === 0 && !isLoadingMeetings" class="meetings-empty-box">
        <div class="empty-state-visual">
          <img src="/images/calendar_schedule_art.jpg" alt="Agenda despejada" class="empty-state-photo" />
        </div>
        <h5 class="meetings-empty-title">Tu agenda de llamadas está despejada</h5>
        <p class="meetings-empty-desc">
          Cuando Avan agende una videollamada con un prospecto calificado desde WhatsApp, o la agendes tú, se sincronizará automáticamente aquí con su enlace de Google Meet.
        </p>
      </div>

      <ul v-else class="meetings-list">
        <li v-for="meeting in upcomingMeetings" :key="meeting.id" class="meeting-row">
          <div class="meeting-when">
            <span class="meeting-date">{{ formatMeetingDate(meeting.start_time) }}</span>
            <span class="meeting-time">{{ formatMeetingTime(meeting.start_time) }}</span>
          </div>
          <div class="meeting-info">
            <!--
              `contact_label` lo resuelve el servidor (`meetingContactName()`):
              el nombre que se escribió al agendar, el del lead si lo tiene, y
              de último el teléfono. El marcador "Contacto de WhatsApp" que
              salía acá no identificaba a nadie — un número sí.
            -->
            <strong class="meeting-name">{{ meeting.contact_label || 'Sin nombre' }}</strong>
            <span class="meeting-topic">{{ meeting.lead_topic || meeting.topic || 'Sin tema registrado' }}</span>
            <span class="meeting-contact">📱 {{ meeting.wa_id || meeting.lead_phone || 'Sin teléfono' }}<template v-if="meeting.lead_email"> · ✉️ {{ meeting.lead_email }}</template></span>
          </div>
          <a v-if="meeting.meet_link" :href="meeting.meet_link" target="_blank" rel="noopener" class="btn-action-primary meeting-join-btn">
            🎥 Unirse
          </a>
          <span v-else-if="meeting.modality === 'llamada'" class="meeting-phone-tag">📞 Por llamada</span>
        </li>
      </ul>
    </section>

    <!-- Atajos rápidos -->
    <section class="presets-row">
      <span class="presets-label">Atajos:</span>
      <button class="preset-pill" @click="applyPreset('weekdaysMorning')">☀️ Lun-Vie 9am-1pm</button>
      <button class="preset-pill" @click="applyPreset('weekdaysAfternoon')">🌤️ Lun-Vie 3pm-7pm</button>
      <button class="preset-pill" @click="applyPreset('weekdaysFull')">🗂️ Lun-Vie 9am-7pm</button>
      <button class="preset-pill" @click="applyPreset('weekend')">🌴 Fines de semana 10am-2pm</button>
    </section>

    <!-- Grilla -->
    <section class="grid-wrapper custom-scrollbar" @mouseleave="stopPaint">
      <div class="grid" :style="gridStyle">
        <div class="grid-corner">Hora</div>
        <div v-for="day in DAYS" :key="day.value" class="grid-day-header">{{ day.short }}</div>

        <template v-for="slot in TIME_SLOTS" :key="slot">
          <div class="grid-time-label">{{ slot }}</div>
          <div
            v-for="day in DAYS"
            :key="`${day.value}-${slot}`"
            class="grid-cell"
            :class="{ selected: isSelected(day.value, slot) }"
            @mousedown.prevent="startPaint(day.value, slot)"
            @mouseenter="enterCell(day.value, slot)"
            @touchstart.prevent="toggleCell(day.value, slot)"
          ></div>
        </template>
      </div>
    </section>

    <!-- Resumen legible -->
    <section class="summary-card">
      <h4>📋 Resumen de tu semana</h4>
      <p v-if="!hasAnySelection" class="summary-empty">Aún no has marcado ningún horario disponible.</p>
      <ul v-else class="summary-list">
        <li v-for="day in DAYS" :key="day.value" v-show="summaryByDay[day.value]">
          <strong>{{ day.label }}:</strong> {{ summaryByDay[day.value] }}
        </li>
      </ul>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';

const DAYS = [
  { value: 0, label: 'Lunes', short: 'Lun' },
  { value: 1, label: 'Martes', short: 'Mar' },
  { value: 2, label: 'Miércoles', short: 'Mié' },
  { value: 3, label: 'Jueves', short: 'Jue' },
  { value: 4, label: 'Viernes', short: 'Vie' },
  { value: 5, label: 'Sábado', short: 'Sáb' },
  { value: 6, label: 'Domingo', short: 'Dom' }
];

function buildTimeSlots(startHour, endHour) {
  const slots = [];
  for (let h = startHour; h < endHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

const TIME_SLOTS = buildTimeSlots(7, 21); // 07:00 a 20:30 (cobertura hasta las 21:00)

function key(day, slot) {
  return `${day}-${slot}`;
}

function minutesOf(slot) {
  const [h, m] = slot.split(':').map(Number);
  return h * 60 + m;
}

function addMinutesToSlot(slot, minutes) {
  const total = minutesOf(slot) + minutes;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const selected = reactive(new Set());
const savedSnapshot = ref('');
const isPainting = ref(false);
const paintValue = ref(true);
const isSaving = ref(false);
const errorMessage = ref('');
const savedMessage = ref('');

const googleStatus = ref({ configured: false, connected: false, email: null, needsReconnect: false });
const isConnectingGoogle = ref(false);
const isTestingGoogle = ref(false);
const googleTestResult = ref(null);

const upcomingMeetings = ref([]);
const isLoadingMeetings = ref(false);

const MEETING_DATE_FORMATTER = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', weekday: 'short', day: 'numeric', month: 'short' });
const MEETING_TIME_FORMATTER = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: 'numeric', minute: '2-digit', hour12: true });

function formatMeetingDate(isoStr) {
  const label = MEETING_DATE_FORMATTER.format(new Date(isoStr)).replace(/\./g, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatMeetingTime(isoStr) {
  return MEETING_TIME_FORMATTER.format(new Date(isoStr)).replace(/\./g, '');
}

async function fetchUpcomingMeetings() {
  isLoadingMeetings.value = true;
  try {
    const response = await apiFetch('/api/meetings/upcoming');
    const data = await response.json();
    if (response.ok) upcomingMeetings.value = data.meetings || [];
  } catch (error) {
    console.warn('No se pudo obtener las próximas reuniones:', error);
  } finally {
    isLoadingMeetings.value = false;
  }
}

const gridStyle = computed(() => ({
  gridTemplateColumns: `70px repeat(${DAYS.length}, 1fr)`
}));

function isSelected(day, slot) {
  return selected.has(key(day, slot));
}

function setCell(day, slot, value) {
  const k = key(day, slot);
  if (value) selected.add(k);
  else selected.delete(k);
}

function toggleCell(day, slot) {
  setCell(day, slot, !isSelected(day, slot));
}

function startPaint(day, slot) {
  isPainting.value = true;
  paintValue.value = !isSelected(day, slot);
  setCell(day, slot, paintValue.value);
}

function enterCell(day, slot) {
  if (isPainting.value) setCell(day, slot, paintValue.value);
}

function stopPaint() {
  isPainting.value = false;
}

function clearAll() {
  selected.clear();
}

const PRESETS = {
  weekdaysMorning: { days: [0, 1, 2, 3, 4], from: '09:00', to: '13:00' },
  weekdaysAfternoon: { days: [0, 1, 2, 3, 4], from: '15:00', to: '19:00' },
  weekdaysFull: { days: [0, 1, 2, 3, 4], from: '09:00', to: '19:00' },
  weekend: { days: [5, 6], from: '10:00', to: '14:00' }
};

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  const fromMin = minutesOf(preset.from);
  const toMin = minutesOf(preset.to);
  for (const day of preset.days) {
    for (const slot of TIME_SLOTS) {
      if (minutesOf(slot) >= fromMin && minutesOf(slot) < toMin) {
        setCell(day, slot, true);
      }
    }
  }
}

const hasAnySelection = computed(() => selected.size > 0);

const summaryByDay = computed(() => {
  const result = {};
  for (const day of DAYS) {
    const daySlots = TIME_SLOTS.filter((slot) => isSelected(day.value, slot));
    if (daySlots.length === 0) continue;

    const ranges = [];
    let rangeStart = daySlots[0];
    let prev = daySlots[0];
    for (let i = 1; i < daySlots.length; i++) {
      const current = daySlots[i];
      if (minutesOf(current) - minutesOf(prev) > 30) {
        ranges.push(`${rangeStart}–${addMinutesToSlot(prev, 30)}`);
        rangeStart = current;
      }
      prev = current;
    }
    ranges.push(`${rangeStart}–${addMinutesToSlot(prev, 30)}`);
    result[day.value] = ranges.join(', ');
  }
  return result;
});

function currentSnapshot() {
  return [...selected].sort().join(',');
}

const isDirty = computed(() => currentSnapshot() !== savedSnapshot.value);

async function fetchAvailability() {
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/availability/me');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener tu disponibilidad.');
    selected.clear();
    for (const slot of data.slots || []) {
      selected.add(key(slot.day_of_week, slot.start_time.slice(0, 5)));
    }
    savedSnapshot.value = currentSnapshot();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function save() {
  isSaving.value = true;
  errorMessage.value = '';
  savedMessage.value = '';
  try {
    const slots = [...selected].map((k) => {
      const [day, ...rest] = k.split('-');
      return { dayOfWeek: Number(day), startTime: rest.join('-') };
    });
    const response = await apiFetch('/api/availability/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar tu disponibilidad.');
    savedSnapshot.value = currentSnapshot();
    savedMessage.value = 'Tu disponibilidad se guardó correctamente.';
    setTimeout(() => { savedMessage.value = ''; }, 3000);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

function handleGlobalMouseUp() {
  stopPaint();
}

async function fetchGoogleStatus() {
  try {
    const response = await apiFetch('/api/google/status');
    const data = await response.json();
    if (response.ok) googleStatus.value = data;
  } catch (error) {
    console.warn('No se pudo obtener el estado de Google Calendar:', error);
  }
}

async function connectGoogle() {
  isConnectingGoogle.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/google/auth-url');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo iniciar la conexión con Google.');
    window.location.href = data.url;
  } catch (error) {
    errorMessage.value = error.message;
    isConnectingGoogle.value = false;
  }
}

async function disconnectGoogle() {
  if (!confirm('¿Desconectar tu Google Calendar? Las reuniones agendadas contigo dejarán de crear eventos en tu calendario hasta que vuelvas a conectarlo.')) return;
  try {
    const response = await apiFetch('/api/google/disconnect', { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo desconectar Google Calendar.');
    googleTestResult.value = null;
    await fetchGoogleStatus();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function testGoogleConnection() {
  isTestingGoogle.value = true;
  errorMessage.value = '';
  googleTestResult.value = null;
  try {
    const response = await apiFetch('/api/google/test-event', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo crear el evento de prueba.');
    googleTestResult.value = data.event;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isTestingGoogle.value = false;
  }
}

function consumeGoogleRedirectResult() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('google');
  if (!result) return;

  if (result === 'connected') savedMessage.value = 'Tu Google Calendar quedó conectado correctamente.';
  else if (result === 'denied') errorMessage.value = 'Cancelaste el permiso en Google, no se conectó tu calendario.';
  else if (result === 'error') errorMessage.value = 'Ocurrió un error al conectar con Google. Intenta de nuevo.';

  params.delete('google');
  const newUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
  window.history.replaceState({}, '', newUrl);
}

onMounted(() => {
  consumeGoogleRedirectResult();
  fetchAvailability();
  fetchGoogleStatus();
  fetchUpcomingMeetings();
  window.addEventListener('mouseup', handleGlobalMouseUp);
});

onUnmounted(() => {
  window.removeEventListener('mouseup', handleGlobalMouseUp);
});
</script>

<style scoped>
.availability-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  user-select: none;
}

.availability-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.header-titles {
  max-width: 640px;
}

.section-subheading {
  color: var(--text-sub);
  font-size: 0.83rem;
  line-height: 1.5;
}

.header-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.btn-action-primary {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: #ffffff;
  border: 1px solid var(--surface-4);
  border-radius: 10px;
  padding: 0.6rem 1.15rem;
  font-size: 0.86rem;
  font-weight: 600;
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-action-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-action-secondary {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.6rem 1.1rem;
  font-size: 0.86rem;
  font-weight: 600;
  font-family: var(--font-heading);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-secondary:hover:not(:disabled) {
  background: var(--surface-3);
}

.btn-action-secondary:disabled,
.btn-action-primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn-action-ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-sub);
  padding: 0.6rem 1rem;
  border-radius: 10px;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-ghost:hover:not(:disabled) {
  color: var(--text-main);
  background: var(--surface-2);
}

.btn-action-ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.alert-box {
  border-color: rgba(239, 68, 68, 0.4);
  color: #E0717C;
}

.success-box {
  border-color: rgba(34, 197, 94, 0.4);
  color: #5FBE79;
}

.google-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.google-card.connected {
  border-color: rgba(46, 125, 70, 0.35);
  background: rgba(46, 125, 70, 0.06);
}

.google-card-main {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

.google-icon {
  font-size: 1.6rem;
  flex-shrink: 0;
}

.google-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.google-title {
  font-size: 0.92rem;
  color: var(--text-main);
}

.google-sub {
  font-size: 0.82rem;
  color: var(--text-sub);
  line-height: 1.4;
}

.google-sub-warn {
  color: var(--accent-rose);
  font-weight: 600;
}

.google-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.meetings-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1.1rem 1.25rem;
}

.meetings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.meetings-header h4 {
  font-size: 0.9rem;
  color: var(--accent-cyan);
}

.meetings-refresh {
  padding: 0.35rem 0.8rem;
  font-size: 0.78rem;
}

.meetings-empty-box {
  padding: 1.75rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.empty-state-visual {
  width: 150px;
  height: 110px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 1rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.empty-state-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.meetings-empty-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1rem;
  color: var(--text-main);
  margin-bottom: 0.35rem;
}

.meetings-empty-desc {
  font-size: 0.82rem;
  color: var(--text-muted);
  max-width: 440px;
  line-height: 1.45;
  margin: 0;
}

.meeting-phone-tag {
  align-self: center;
  white-space: nowrap;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.meetings-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.meeting-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  flex-wrap: wrap;
}

.meeting-when {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 74px;
  padding: 0.3rem 0.6rem;
  background: rgba(111, 129, 37, 0.1);
  border-radius: 8px;
  flex-shrink: 0;
}

.meeting-date {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--on-tint-strong);
  text-transform: uppercase;
}

.meeting-time {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-main);
}

.meeting-info {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.meeting-name {
  font-size: 0.9rem;
  color: var(--text-main);
}

.meeting-topic {
  font-size: 0.8rem;
  color: var(--text-sub);
}

.meeting-contact {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.meeting-join-btn {
  width: auto;
  padding: 0.5rem 1rem;
  font-size: 0.82rem;
  text-decoration: none;
  flex-shrink: 0;
}

.presets-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.presets-label {
  font-size: 0.8rem;
  color: var(--text-sub);
  font-weight: 600;
}

.preset-pill {
  background: rgba(76, 134, 255, 0.12);
  border: 1px solid rgba(76, 134, 255, 0.3);
  color: var(--accent-cyan);
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-pill:hover {
  background: rgba(76, 134, 255, 0.22);
}

.grid-wrapper {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem;
  overflow: auto;
  max-height: 560px;
}

.grid {
  display: grid;
  gap: 3px;
  min-width: 520px;
}

.grid-corner {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  background: var(--bg-card);
}

.grid-day-header {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-card);
  text-align: center;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-main);
  padding: 0.4rem 0;
  font-family: var(--font-heading);
}

.grid-time-label {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-card);
  font-size: 0.7rem;
  color: var(--text-sub);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 0.5rem;
  white-space: nowrap;
}

.grid-cell {
  height: 22px;
  border-radius: 4px;
  background: var(--surface-2);
  border: 1px solid var(--surface-2);
  cursor: pointer;
  transition: background 0.1s ease;
}

.grid-cell:hover {
  background: rgba(76, 134, 255, 0.25);
}

.grid-cell.selected {
  background: var(--primary);
  border-color: var(--primary-hover);
}

.summary-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1.1rem 1.25rem;
}

.summary-card h4 {
  font-size: 0.9rem;
  color: var(--accent-cyan);
  margin-bottom: 0.6rem;
}

.summary-empty {
  font-size: 0.85rem;
  color: var(--text-sub);
}

.summary-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--text-sub);
}

.summary-list strong {
  color: var(--text-main);
}

@media (max-width: 768px) {
  .availability-page-wrapper {
    padding: 1rem;
  }
}
</style>
