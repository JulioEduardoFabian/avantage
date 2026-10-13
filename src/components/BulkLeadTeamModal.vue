<template>
  <!--
    Asignación masiva de responsable, setter y closer.

    Recibe los leads que el tablero tiene a la vista —ya pasados por sus filtros
    (búsqueda, canal, fecha, responsable)—, así que la forma de armar un lote es
    filtrar primero el tablero y abrir esto después. Acá solo se marca y se
    elige a quién.

    Vive en un componente porque lo abren los dos tableros con el mismo
    endpoint (`POST /api/leads/bulk-team`).
  -->
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content bulk-modal">
      <div class="modal-header">
        <h3 class="modal-title">👥 Asignación masiva</h3>
        <button type="button" class="modal-close-btn" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body bulk-body">
        <p class="bulk-note">
          Se listan los leads que el tablero muestra ahora. Para acotar el lote, cierra esta ventana
          y usa los filtros del tablero.
        </p>

        <div class="bulk-fields">
          <label v-for="field in FIELDS" :key="field.key" class="bulk-field">
            <span class="form-label">{{ field.label }}</span>
            <select v-model="choice[field.key]" class="form-select">
              <option :value="KEEP">No cambiar</option>
              <option v-for="user in team" :key="user.id" :value="user.id">
                {{ user.name }} — {{ user.role_name }}
              </option>
              <option :value="CLEAR">{{ field.clearLabel }}</option>
            </select>
          </label>
        </div>
        <p v-if="teamError" class="bulk-error">⚠️ {{ teamError }}</p>

        <div class="bulk-toolbar">
          <input v-model="query" type="text" class="form-input bulk-search" placeholder="Buscar por nombre o celular…" />
          <button type="button" class="btn-action-secondary" @click="toggleAll">
            {{ allShownSelected ? 'Desmarcar los listados' : `Marcar los ${shown.length} listados` }}
          </button>
          <span class="bulk-count">{{ selected.size }} marcados</span>
        </div>

        <p v-if="leads.length === 0" class="bulk-empty">El tablero no tiene leads con los filtros actuales.</p>
        <p v-else-if="shown.length === 0" class="bulk-empty">Ningún lead coincide con la búsqueda.</p>

        <ul v-else class="bulk-list custom-scrollbar">
          <li v-for="lead in shown" :key="lead.id">
            <label class="bulk-row" :class="{ 'is-on': selected.has(lead.id) }">
              <input type="checkbox" :checked="selected.has(lead.id)" @change="toggle(lead.id)" />
              <span class="bulk-row-main">
                <strong>{{ lead.full_name || `Lead #${lead.id}` }}</strong>
                <small>{{ lead.phone || 'Sin celular' }} · {{ shortDate(lead.created_at) }}</small>
              </span>
              <span class="bulk-row-team">
                <small>Resp.: {{ lead.assigned_user_name || lead.assigned_to || '—' }}</small>
                <small>Setter: {{ lead.setter_name || '—' }} · Closer: {{ lead.closer_name || '—' }}</small>
              </span>
            </label>
          </li>
        </ul>

        <p v-if="error" class="bulk-error">⚠️ {{ error }}</p>

        <div class="bulk-actions">
          <button type="button" class="btn-action-ghost" @click="$emit('close')">Cancelar</button>
          <button type="button" class="btn-action-primary" :disabled="!canApply || saving" @click="apply">
            {{ saving ? 'Aplicando…' : `Aplicar a ${selected.size} lead${selected.size === 1 ? '' : 's'}` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { commercialTeam as team, loadCommercialTeam } from '../data/commercialTeam.js';

const props = defineProps({
  /** Los leads que el tablero muestra ahora (ya filtrados). */
  leads: { type: Array, required: true }
});
const emit = defineEmits(['close', 'updated']);

/*
 * Tres estados por campo y no dos: "no cambiar" no es lo mismo que "dejar
 * vacío". El servidor distingue igual — un campo que no viaja no se toca.
 */
const KEEP = '__keep__';
const CLEAR = '__clear__';
const FIELDS = [
  { key: 'assigneeUserId', label: '🙋 Responsable', clearLabel: 'Dejar sin asignar' },
  { key: 'setterUserId', label: '🎯 Setter', clearLabel: 'Dejar sin setter' },
  { key: 'closerUserId', label: '🤝 Closer', clearLabel: 'Dejar sin closer' }
];

const choice = reactive({ assigneeUserId: KEEP, setterUserId: KEEP, closerUserId: KEEP });
const selected = ref(new Set());
const query = ref('');
const saving = ref(false);
const error = ref('');
const teamError = ref('');

const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.leads;
  return props.leads.filter((lead) =>
    (lead.full_name || '').toLowerCase().includes(text) || (lead.phone || '').toLowerCase().includes(text)
  );
});

const allShownSelected = computed(
  () => shown.value.length > 0 && shown.value.every((lead) => selected.value.has(lead.id))
);

const canApply = computed(
  () => selected.value.size > 0 && FIELDS.some((field) => choice[field.key] !== KEEP)
);

function toggle(id) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

/** Marca o desmarca lo LISTADO: lo que la búsqueda dejó afuera no se toca. */
function toggleAll() {
  const next = new Set(selected.value);
  const remove = allShownSelected.value;
  for (const lead of shown.value) {
    if (remove) next.delete(lead.id);
    else next.add(lead.id);
  }
  selected.value = next;
}

function shortDate(dateStr) {
  const d = new Date(dateStr);
  if (!dateStr || isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: '2-digit' });
}

async function apply() {
  if (!canApply.value) return;
  saving.value = true;
  error.value = '';
  try {
    const body = { leadIds: [...selected.value] };
    for (const field of FIELDS) {
      if (choice[field.key] === KEEP) continue;
      body[field.key] = choice[field.key] === CLEAR ? null : choice[field.key];
    }
    const response = await apiFetch('/api/leads/bulk-team', { method: 'POST', body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo aplicar la asignación.');
    emit('updated', data);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadCommercialTeam().catch((err) => {
    teamError.value = err.message;
  });
});
</script>

<style scoped>
.bulk-modal {
  width: min(760px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.bulk-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-height: 0;
  overflow-y: auto;
}

.bulk-note,
.bulk-empty {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}

.bulk-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.6rem;
}

.bulk-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bulk-toolbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.bulk-search {
  flex: 1;
  min-width: 180px;
}

.bulk-count {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-main);
}

.bulk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  max-height: 42vh;
  min-height: 120px;
  overflow-y: auto;
}

.bulk-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
}

.bulk-list li:last-child .bulk-row { border-bottom: none; }
.bulk-row.is-on { background: var(--surface-2); }

.bulk-row-main,
.bulk-row-team {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bulk-row-main { flex: 1; }
.bulk-row-main strong {
  font-size: 0.85rem;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bulk-row small {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.bulk-row-team { text-align: right; }

.bulk-error {
  font-size: 0.82rem;
  color: var(--accent-rose);
  margin: 0;
}

.bulk-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

@media (max-width: 760px) {
  .bulk-row { flex-wrap: wrap; }
  .bulk-row-team { text-align: left; padding-left: 1.7rem; width: 100%; }
}
</style>
