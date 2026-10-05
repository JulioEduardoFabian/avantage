<template>
  <!--
    Quién del área comercial tiene este lead a su cargo, y el botón para
    cambiarlo.

    Está pensado para la TARJETA de los dos tableros (Setter Funnel y Kanban de
    Ventas), que es donde se reparte el trabajo. La tarjeta tiene alto fijo
    —`--lead-card-h`, calibrado para que entren diez por columna sin scroll—
    así que el círculo va en una franja reservada a la derecha y no suma una
    línea: si creciera, dejarían de entrar diez y se rompe la forma de trabajar
    el tablero.

    El menú se teletransporta al `body` en vez de colgar de la tarjeta porque
    la tarjeta recorta su contenido (`overflow: hidden`) y la columna tiene
    scroll propio: ahí dentro el desplegable quedaría cortado a los 20 px.

    Vive en un componente porque los dos tableros y las dos fichas de detalle
    lo usan igual; copiado cuatro veces, el cuarto se queda atrás.
  -->
  <button
    type="button"
    class="lead-assignee-btn"
    :class="{ 'is-empty': !assigneeName, 'with-name': showName }"
    :disabled="saving"
    :title="buttonTitle"
    @click.stop="toggle"
  >
    <span
      class="lead-assignee-dot"
      :style="assigneeName ? { background: avatarColor(assigneeName) } : null"
      aria-hidden="true"
    >{{ assigneeName ? initials(assigneeName) : '?' }}</span>
    <span v-if="showName" class="lead-assignee-name">{{ assigneeName || 'Sin asignar' }}</span>
  </button>

  <Teleport to="body">
    <div v-if="isOpen" class="lead-assignee-backdrop" @click="close" @contextmenu.prevent="close">
      <div class="lead-assignee-pop" :style="popStyle" @click.stop>
        <header class="pop-header">
          <span class="pop-title">Asignar a</span>
          <span class="pop-hint">Área comercial</span>
        </header>

        <p v-if="error" class="pop-error">⚠️ {{ error }}</p>

        <p v-if="loading" class="pop-status">Cargando el equipo…</p>
        <p v-else-if="team.length === 0" class="pop-status">
          Nadie más tiene acceso al funnel todavía. Se habilita desde Roles y Permisos.
        </p>

        <ul v-else class="pop-list">
          <li v-for="user in team" :key="user.id">
            <button
              type="button"
              class="pop-option"
              :class="{ 'is-current': user.id === lead.assigned_user_id }"
              @click="choose(user.id)"
            >
              <span class="lead-assignee-dot" :style="{ background: avatarColor(user.name) }" aria-hidden="true">
                {{ initials(user.name) }}
              </span>
              <span class="pop-option-text">
                <strong>{{ user.name }}</strong>
                <small>{{ user.role_name }}</small>
              </span>
              <span v-if="user.id === lead.assigned_user_id" class="pop-check" aria-hidden="true">✓</span>
            </button>
          </li>
        </ul>

        <button
          v-if="lead.assigned_user_id || lead.assigned_to"
          type="button"
          class="pop-clear"
          @click="choose(null)"
        >
          Dejar sin asignar
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { avatarColor, initials } from '../avatars.js';
import { commercialTeam as team, loadCommercialTeam } from '../data/commercialTeam.js';

const props = defineProps({
  lead: { type: Object, required: true },
  /** En la ficha de detalle se muestra el nombre al lado; en la tarjeta, solo el círculo. */
  showName: { type: Boolean, default: false }
});
const emit = defineEmits(['assigned']);

/* El área comercial (`team`) es un `ref` compartido por todas las tarjetas y
   se pide una sola vez — ver src/data/commercialTeam.js. */

const isOpen = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const popStyle = ref({});

/**
 * El nombre que se muestra: el del usuario enlazado si lo hay, y si no el
 * texto libre de `assigned_to` (los leads viejos y los asesores sin cuenta en
 * el panel siguen anotados ahí).
 */
const assigneeName = computed(() => props.lead.assigned_user_name || props.lead.assigned_to || '');

const buttonTitle = computed(() => (assigneeName.value
  ? `Asignado a ${assigneeName.value} — clic para cambiar`
  : 'Sin asignar — clic para asignar a alguien del área comercial'));

function onKeydown(event) {
  if (event.key === 'Escape') close();
}

function close() {
  isOpen.value = false;
  error.value = '';
  window.removeEventListener('keydown', onKeydown);
}

onUnmounted(() => window.removeEventListener('keydown', onKeydown));

async function toggle(event) {
  if (isOpen.value) {
    close();
    return;
  }

  /*
   * El menú está en el `body`, así que se posiciona a mano desde el botón. Se
   * abre hacia abajo salvo que no quepa —una tarjeta del final de la columna—
   * y entonces se ancla hacia arriba. El `max-height` cierra el caso de un
   * equipo largo: la lista hace scroll adentro en vez de salirse de la
   * pantalla.
   */
  const rect = event.currentTarget.getBoundingClientRect();
  const WIDTH = 248;
  const MARGIN = 8;
  const left = Math.min(Math.max(MARGIN, rect.right - WIDTH), window.innerWidth - WIDTH - MARGIN);
  const below = window.innerHeight - rect.bottom;

  popStyle.value = below > 240 || below > rect.top
    ? { left: `${left}px`, top: `${rect.bottom + 6}px`, maxHeight: `${below - MARGIN - 6}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - rect.top + 6}px`, maxHeight: `${rect.top - MARGIN - 6}px` };

  isOpen.value = true;
  window.addEventListener('keydown', onKeydown);

  if (team.value.length === 0) {
    loading.value = true;
    try {
      await loadCommercialTeam();
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }
}

async function choose(userId) {
  if (userId === (props.lead.assigned_user_id ?? null)) {
    close();
    return;
  }

  saving.value = true;
  error.value = '';
  try {
    const response = await apiFetch(`/api/leads/${props.lead.id}/assignee`, {
      method: 'PATCH',
      body: JSON.stringify({ userId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo asignar el lead.');
    emit('assigned', data.lead);
    close();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* ----------------------------------------------- El círculo en la tarjeta */
.lead-assignee-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  line-height: 1;
}

.lead-assignee-btn:disabled { cursor: progress; opacity: 0.6; }

.lead-assignee-dot {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.66rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
  box-shadow: 0 0 0 2px var(--bg-card-solid);
  transition: transform 0.15s ease;
}

.lead-assignee-btn:hover .lead-assignee-dot { transform: scale(1.1); }

/* Sin asignar: hueco punteado, para que se lea como "falta alguien acá" y no
   como una persona más del equipo. */
.lead-assignee-btn.is-empty .lead-assignee-dot {
  background: transparent;
  color: var(--text-muted);
  border: 1px dashed var(--border-strong);
  box-shadow: none;
}

.lead-assignee-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
}

.lead-assignee-btn.is-empty .lead-assignee-name { color: var(--text-muted); font-weight: 500; }

/* ------------------------------------------------------- El menú flotante */
/* Por encima de los modales (z-index 1000): la ficha del Setter Funnel es un
   modal y desde ahí también se asigna. */
.lead-assignee-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
}

.lead-assignee-pop {
  position: fixed;
  width: 248px;
  display: flex;
  flex-direction: column;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.pop-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--border-color);
}

.pop-title { font-size: 0.78rem; font-weight: 700; color: var(--text-main); }
.pop-hint { font-size: 0.68rem; color: var(--text-muted); }

.pop-error,
.pop-status {
  margin: 0;
  padding: 0.5rem 0.65rem;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.pop-error { color: var(--accent-rose); }

.pop-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  overflow-y: auto;
}

.pop-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.45rem;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  text-align: left;
}

.pop-option:hover { background: var(--surface-2); }
.pop-option.is-current { background: var(--surface-1); }

.pop-option-text { display: flex; flex-direction: column; min-width: 0; }
.pop-option-text strong {
  font-size: 0.8rem;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pop-option-text small { font-size: 0.68rem; color: var(--text-muted); }

.pop-check { margin-left: auto; color: var(--accent-emerald); font-weight: 700; }

.pop-clear {
  border: none;
  border-top: 1px solid var(--border-color);
  background: none;
  padding: 0.5rem 0.65rem;
  font-size: 0.76rem;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
}

.pop-clear:hover { background: var(--surface-2); color: var(--accent-rose); }
</style>
