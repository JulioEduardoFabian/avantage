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
          <div class="form-group">
            <label class="form-label">Asesor (dueño de la reunión)</label>
            <select v-model="form.advisorUserId" class="form-select" :disabled="advisors.length <= 1">
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
            <input v-model="form.date" type="date" class="form-input" required />
          </div>

          <div class="form-group">
            <label class="form-label">Hora de inicio</label>
            <input v-model="form.time" type="time" class="form-input" step="900" required />
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
          <button type="button" class="btn-action-primary" :disabled="isSaving" @click="submit">
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

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** Si viene, la reunión queda atada a ese lead y precarga su correo. */
  lead: { type: Object, default: null },
  /** Día preseleccionado ("AAAA-MM-DD"), que es como lo abre el calendario. */
  date: { type: String, default: '' }
});
const emit = defineEmits(['update:modelValue', 'created']);

const advisors = ref([]);
const isSaving = ref(false);
const errorMessage = ref('');

const form = reactive({
  advisorUserId: null,
  date: '',
  time: '10:00',
  duration: 30,
  topic: '',
  attendeeEmail: ''
});

const selectedAdvisor = computed(() => advisors.value.find((a) => a.id === form.advisorUserId) || null);

function today() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

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

watch(() => props.modelValue, (abierto) => {
  if (!abierto) return;
  errorMessage.value = '';
  form.date = props.date || today();
  form.topic = props.lead ? `Reunión con ${props.lead.full_name || props.lead.topic || 'el cliente'}` : '';
  form.attendeeEmail = props.lead?.email || '';
  loadAdvisors();
});

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
}
</style>
