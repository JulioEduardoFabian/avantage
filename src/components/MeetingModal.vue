<template>
  <!--
    Agendar una reunión a mano.

    Vive en un componente porque se abre desde tres sitios: el Calendario, la
    ficha del lead en el Funnel de Ventas y la del Setter Funnel. Es la misma
    reunión y el mismo endpoint; copiado en cada pantalla, el tercero se queda
    con el formulario viejo.

    La reunión es SIEMPRE de un asesor (el closer): el evento se crea en su
    Google Calendar y, si no lo tiene conectado, en el de quien agenda con él
    invitado por correo. Eso se dice en el formulario y no después, porque
    cambia lo que la persona espera que pase.

    El desplegable trae a TODA el área comercial (`/api/meetings/advisors`), no
    solo a uno mismo: quien coordina la reunión no siempre es quien la atiende,
    y la setter que agenda para el closer es el caso más común de todos.

    La hora no se escribe: se elige entre las que de verdad se pueden. Un campo
    libre aceptaba las 03:00, una hora fuera del horario del asesor o uno de
    esta misma mañana ya pasada, y el error se descubría recién cuando el
    cliente no aparecía. Las horas salen del horario del asesor cruzado con sus
    reuniones de ese día y con el reloj.
  -->
  <div v-if="modelValue" class="modal-overlay" @click.self="close">
    <div class="modal-content meeting-modal">
      <div class="modal-header">
        <h3 class="modal-title">📅 Agendar reunión</h3>
        <button class="modal-close-btn" @click="close">✕</button>
      </div>

      <div class="modal-body">
        <p v-if="lead" class="meeting-lead">
          Con <strong>{{ lead.full_name || lead.topic || `Lead #${lead.id}` }}</strong>
          <span v-if="lead.phone"> · {{ lead.phone }}</span>
        </p>

        <div class="meeting-grid">
          <div class="form-group meeting-wide">
            <label class="form-label">Asesor (dueño de la reunión)</label>
            <select v-model="form.advisorUserId" class="form-select">
              <option v-for="advisor in advisors" :key="advisor.id" :value="advisor.id">
                {{ advisor.name }}{{ advisor.google_connected ? '' : ' — sin Google conectado' }}
              </option>
            </select>
            <small v-if="selectedAdvisor && !selectedAdvisor.google_connected" class="meeting-hint">
              No tiene su Google conectado: el evento se crea en tu calendario y se lo invita a
              <strong>{{ selectedAdvisor.email }}</strong>.
            </small>
          </div>

          <div class="form-group">
            <label class="form-label">Día</label>
            <input v-model="form.date" type="date" class="form-input" :min="today()" required />
          </div>

          <div class="form-group">
            <label class="form-label">Duración</label>
            <select v-model.number="form.duration" class="form-select">
              <option :value="30">30 minutos</option>
              <option :value="45">45 minutos</option>
              <option :value="60">1 hora</option>
              <option :value="90">1 hora y media</option>
            </select>
          </div>

          <!-- --------------------------- La hora --------------------------- -->
          <div class="form-group meeting-wide">
            <div class="slots-head">
              <label class="form-label">Hora de inicio</label>
              <button type="button" class="slots-toggle" @click="freeTime = !freeTime">
                {{ freeTime ? 'Elegir de la lista' : 'Escribir otra hora' }}
              </button>
            </div>

            <template v-if="freeTime">
              <input v-model="form.time" type="time" class="form-input" step="900" required />
              <small v-if="manualWarning" class="meeting-hint meeting-hint-warn">⚠️ {{ manualWarning }}</small>
              <small v-else class="meeting-hint">Hora libre: se agenda igual aunque no esté en el horario del asesor.</small>
            </template>

            <template v-else>
              <p v-if="isLoadingSlots" class="slots-state">Buscando horas libres…</p>

              <p v-else-if="slotOptions.length === 0" class="slots-state">
                <template v-if="!hasAvailability">
                  {{ advisorFirstName }} todavía no cargó su horario en <strong>Disponibilidad</strong>.
                </template>
                <template v-else-if="isToday">
                  No quedan horas libres hoy para {{ advisorFirstName }}.
                </template>
                <template v-else>
                  {{ advisorFirstName }} no atiende los {{ weekdayLabel }}.
                </template>
                Puedes <button type="button" class="slots-inline" @click="freeTime = true">escribir otra hora</button>.
              </p>

              <template v-else>
                <div class="slots-grid">
                  <button
                    v-for="slot in slotOptions"
                    :key="slot.time"
                    type="button"
                    class="slot"
                    :class="[`is-${slot.state}`, { 'is-chosen': slot.time === form.time }]"
                    :disabled="slot.state !== 'libre'"
                    :title="slot.reason"
                    @click="form.time = slot.time"
                  >{{ slot.time }}</button>
                </div>
                <small v-if="freeCount === 0" class="meeting-hint meeting-hint-warn">
                  No queda ninguna hora libre {{ isToday ? 'hoy' : `ese ${weekdayLabel}` }}.
                  Puedes <button type="button" class="slots-inline" @click="freeTime = true">escribir otra hora</button>.
                </small>
                <small v-else class="meeting-hint">
                  {{ freeCount }} {{ freeCount === 1 ? 'hora libre' : 'horas libres' }} en el horario de
                  {{ advisorFirstName }} para {{ isToday ? 'hoy' : `el ${weekdayLabel}` }}, ya descontando
                  sus reuniones{{ isToday ? ' y lo que va del día' : '' }}.
                </small>
              </template>
            </template>
          </div>

          <div class="form-group meeting-wide">
            <label class="form-label">Tema</label>
            <input
              v-model="form.topic"
              type="text"
              class="form-input"
              placeholder="Ej: Revisión del proyecto de tesis"
            />
          </div>

          <div class="form-group meeting-wide">
            <label class="form-label">Correo del invitado (opcional)</label>
            <input
              v-model="form.attendeeEmail"
              type="email"
              class="form-input"
              placeholder="cliente@correo.com"
            />
            <small class="meeting-hint">Si lo dejas, Google le manda la invitación con el enlace de Meet.</small>
          </div>
        </div>

        <p v-if="errorMessage" class="info-box meeting-alert">⚠️ {{ errorMessage }}</p>

        <div class="meeting-actions">
          <button type="button" class="btn-action-ghost" @click="close">Cancelar</button>
          <button type="button" class="btn-action-primary" :disabled="isSaving || !form.time" @click="submit">
            {{ isSaving ? 'Agendando…' : 'Agendar reunión' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { authState } from '../auth.js';
import { DAYS, SLOT_MINUTES, TIME_SLOTS, hhmm, minutesOf, weekdayOf } from '../availabilityGrid.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** Si viene, la reunión queda atada a ese lead y precarga su correo. */
  lead: { type: Object, default: null },
  /** Día preseleccionado ("AAAA-MM-DD"), que es como lo abre el calendario. */
  date: { type: String, default: '' },
  /**
   * Hora preseleccionada ("HH:MM"). La manda la vista de día del Calendario
   * cuando se hace clic sobre una franja: ya se eligió la hora mirando el
   * cruce de horarios, y volver a escribirla es pedir dos veces lo mismo.
   */
  time: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue', 'created']);

const advisors = ref([]);
const availability = ref([]);
const busyMeetings = ref([]);
const isLoadingSlots = ref(false);
const isSaving = ref(false);
const errorMessage = ref('');
/** Escape: escribir la hora a mano cuando hay que salirse del horario. */
const freeTime = ref(false);

const form = reactive({
  advisorUserId: null,
  date: '',
  time: '',
  duration: 30,
  topic: '',
  attendeeEmail: ''
});

const selectedAdvisor = computed(() => advisors.value.find((a) => a.id === form.advisorUserId) || null);
const advisorFirstName = computed(() => String(selectedAdvisor.value?.name || 'El asesor').split(' ')[0]);

function today() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

function dateOf(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const isToday = computed(() => form.date === today());
const isPastDate = computed(() => Boolean(form.date) && form.date < today());
const weekday = computed(() => (form.date ? weekdayOf(dateOf(form.date)) : null));
const weekdayLabel = computed(() => (weekday.value === null ? '' : DAYS[weekday.value].label.toLowerCase()));
const hasAvailability = computed(() => availability.value.length > 0);

/** Los minutos del día que ya pasaron, solo si el día elegido es hoy. */
const nowMinutes = computed(() => {
  if (!isToday.value) return -1;
  const ahora = new Date();
  return ahora.getHours() * 60 + ahora.getMinutes();
});

/** Los bloques de media hora que el asesor marcó libres para ese día. */
const freeBlocks = computed(() => {
  const dia = weekday.value;
  if (dia === null) return new Set();
  return new Set(
    availability.value
      .filter((slot) => slot.day_of_week === dia)
      .map((slot) => minutesOf(slot.start_time))
  );
});

/** Sus reuniones de ese día, como tramos de minutos. */
const busyRanges = computed(() => busyMeetings.value.map((meeting) => {
  const inicio = new Date(meeting.start_time);
  const fin = new Date(meeting.end_time);
  return {
    start: inicio.getHours() * 60 + inicio.getMinutes(),
    end: fin.getHours() * 60 + fin.getMinutes()
  };
}));

/**
 * Las horas en las que de verdad se puede empezar la reunión.
 *
 * Una hora entra si **toda** la duración elegida cae dentro del horario del
 * asesor: una reunión de una hora que arranca a las 12:30 cuando él atiende
 * hasta las 13:00 no es media hora libre, es media hora de ausencia. Por eso
 * la lista se rearma al cambiar la duración y no solo al cambiar el día.
 *
 * Las ocupadas y las que ya pasaron **se muestran deshabilitadas** en vez de
 * desaparecer: una lista que salta de las 09:00 a las 11:00 no dice si el
 * asesor no atiende o si ya tiene algo, y esa diferencia es la que decide si
 * conviene insistir con esa franja.
 */
const slotOptions = computed(() => {
  if (weekday.value === null || !hasAvailability.value) return [];
  const duracion = form.duration || SLOT_MINUTES;

  return TIME_SLOTS.map((hora) => {
    const inicio = minutesOf(hora);
    const fin = inicio + duracion;

    // Todo el tramo tiene que estar marcado como disponible.
    let dentro = true;
    for (let minuto = inicio; minuto < fin; minuto += SLOT_MINUTES) {
      if (!freeBlocks.value.has(minuto)) { dentro = false; break; }
    }
    if (!dentro) return null;

    if (isPastDate.value) return { time: hora, state: 'pasado', reason: 'Ese día ya pasó' };
    if (nowMinutes.value >= 0 && inicio <= nowMinutes.value) {
      return { time: hora, state: 'pasado', reason: 'Ya pasó' };
    }

    const choque = busyRanges.value.find((rango) => inicio < rango.end && fin > rango.start);
    if (choque) {
      return { time: hora, state: 'ocupado', reason: `Ocupado: ${hhmm(choque.start)}–${hhmm(choque.end)}` };
    }

    return { time: hora, state: 'libre', reason: `Libre a las ${hora}` };
  }).filter(Boolean);
});

const freeCount = computed(() => slotOptions.value.filter((slot) => slot.state === 'libre').length);

/** Por qué la hora escrita a mano es dudosa. No bloquea: avisa. */
const manualWarning = computed(() => {
  if (!freeTime.value || !form.time) return '';
  const inicio = minutesOf(form.time);
  const fin = inicio + (form.duration || SLOT_MINUTES);

  if (isPastDate.value) return 'Ese día ya pasó.';
  if (nowMinutes.value >= 0 && inicio <= nowMinutes.value) return 'Esa hora ya pasó.';

  const choque = busyRanges.value.find((rango) => inicio < rango.end && fin > rango.start);
  if (choque) return `${advisorFirstName.value} ya tiene una reunión de ${hhmm(choque.start)} a ${hhmm(choque.end)}.`;

  if (hasAvailability.value) {
    for (let minuto = inicio; minuto < fin; minuto += SLOT_MINUTES) {
      if (!freeBlocks.value.has(minuto)) return `Está fuera del horario de ${advisorFirstName.value}.`;
    }
  }
  return '';
});

/* -------------------------------- Los datos ------------------------------- */

async function loadAdvisors() {
  try {
    const response = await apiFetch('/api/meetings/advisors');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los asesores.');
    advisors.value = data.advisors || [];
    if (!advisors.value.some((a) => a.id === form.advisorUserId)) {
      // Por defecto, uno mismo: lo normal es agendarse la reunión propia.
      const propio = advisors.value.find((a) => a.id === authState.user?.id);
      form.advisorUserId = propio?.id || advisors.value[0]?.id || null;
    }
  } catch (error) {
    errorMessage.value = error.message;
  }
}

/**
 * El horario del asesor y sus reuniones de ese día, que son las dos mitades de
 * "qué horas quedan". Se piden juntas porque una sin la otra ofrecería una
 * hora que ya está tomada.
 */
async function loadSlots() {
  if (!form.advisorUserId || !form.date) return;
  isLoadingSlots.value = true;
  try {
    const [horario, reuniones] = await Promise.all([
      apiFetch(`/api/availability/${form.advisorUserId}`).then((r) => r.json()).catch(() => ({})),
      apiFetch(`/api/meetings?from=${form.date}&to=${form.date}&advisorUserId=${form.advisorUserId}`)
        .then((r) => r.json())
        .catch(() => ({}))
    ]);
    availability.value = horario.slots || [];
    busyMeetings.value = (reuniones.meetings || []).filter((m) => m.advisor_user_id === form.advisorUserId);
  } finally {
    isLoadingSlots.value = false;
    ensureValidTime();
  }
}

/**
 * Deja elegida una hora que se pueda: la que vino pedida si sigue siendo
 * válida, si no la primera libre. Sin esto el formulario queda con una hora
 * que la propia lista muestra deshabilitada.
 */
function ensureValidTime() {
  if (freeTime.value) return;
  const libres = slotOptions.value.filter((slot) => slot.state === 'libre');
  if (libres.some((slot) => slot.time === form.time)) return;

  // Si la hora vino pedida (un clic sobre la franja del calendario) y no está
  // entre las libres, se pasa a hora libre con el aviso del motivo en vez de
  // reemplazarla: el que la eligió sabe por qué, y cambiársela sin decir nada
  // agenda a una hora que nadie pidió.
  if (form.time && form.time === props.time) {
    freeTime.value = true;
    return;
  }
  form.time = libres[0]?.time || '';
}

watch(() => props.modelValue, (abierto) => {
  if (!abierto) return;
  errorMessage.value = '';
  freeTime.value = false;
  availability.value = [];
  busyMeetings.value = [];
  form.date = props.date || today();
  form.time = props.time || '';
  form.topic = props.lead ? `Reunión con ${props.lead.full_name || props.lead.topic || 'el cliente'}` : '';
  form.attendeeEmail = props.lead?.email || '';
  loadAdvisors().then(loadSlots);
});

// Cambiar de asesor o de día cambia las dos listas; cambiar la duración solo
// recalcula (la hora elegida puede dejar de entrar en el horario).
watch([() => form.advisorUserId, () => form.date], () => {
  if (props.modelValue) loadSlots();
});
watch(() => form.duration, ensureValidTime);

function close() {
  emit('update:modelValue', false);
}

async function submit() {
  errorMessage.value = '';
  if (!form.date || !form.time) {
    errorMessage.value = 'Falta el día o la hora.';
    return;
  }

  /*
   * La hora se manda con el huso de Perú escrito a mano (-05:00) en vez de
   * dejar que el navegador la convierta: el equipo trabaja en Lima y una laptop
   * configurada en otra zona agendaría la reunión a una hora distinta de la que
   * la persona escribió.
   */
  const inicio = new Date(`${form.date}T${form.time}:00-05:00`);
  const fin = new Date(inicio.getTime() + form.duration * 60000);

  isSaving.value = true;
  try {
    const response = await apiFetch('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        leadId: props.lead?.id || null,
        advisorUserId: form.advisorUserId,
        topic: form.topic || null,
        startTime: inicio.toISOString(),
        endTime: fin.toISOString(),
        attendeeEmail: form.attendeeEmail || null,
        waId: props.lead?.phone ? String(props.lead.phone).replace(/\D/g, '') : null
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo agendar la reunión.');
    emit('created', data);
    close();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.meeting-modal { max-width: 560px; }

.meeting-lead {
  margin: 0 0 0.75rem;
  font-size: 0.88rem;
  color: var(--text-sub);
}

.meeting-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
}

.meeting-wide { grid-column: 1 / -1; }

.meeting-hint {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.meeting-hint-warn { color: #C85532; }

/* --------------------------------- Horas --------------------------------- */

.slots-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.slots-toggle,
.slots-inline {
  border: none;
  background: none;
  padding: 0;
  color: var(--primary);
  font-size: 0.72rem;
  cursor: pointer;
  text-decoration: underline;
}

.slots-state {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.slots-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
  gap: 0.25rem;
  max-height: 148px;
  overflow-y: auto;
  padding: 0.1rem;
}

.slot {
  padding: 0.3rem 0.1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card-solid);
  color: var(--text-sub);
  font-size: 0.76rem;
  cursor: pointer;
}

.slot.is-libre:hover { border-color: var(--primary); color: var(--primary); }

.slot.is-chosen {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

/*
 * Ocupada y pasada se ven distinto entre sí: tachada es "hay algo ahí" y
 * apagada es "ya fue". Pintadas iguales, la pregunta "¿puedo pedirle que la
 * mueva?" no se puede contestar mirando.
 */
.slot.is-ocupado {
  background: var(--surface-2);
  color: var(--text-muted);
  text-decoration: line-through;
  cursor: not-allowed;
}

.slot.is-pasado {
  background: transparent;
  color: var(--text-muted);
  opacity: 0.4;
  cursor: not-allowed;
}

.meeting-alert {
  margin-top: 0.75rem;
  border-color: rgba(200, 85, 50, 0.4);
  background: rgba(200, 85, 50, 0.08);
}

.meeting-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

@media (max-width: 560px) {
  .meeting-grid { grid-template-columns: 1fr; }
  .slots-grid { max-height: 190px; }
}
</style>
