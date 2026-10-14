<template>
  <!--
    Asignación masiva de responsable, setter y closer.

    Recibe los leads que el tablero tiene a la vista —ya pasados por sus
    filtros— agrupados por columna, y acá se terminan de acotar por etapa del
    funnel, por fecha de registro y por texto antes de marcar. La etapa es la
    COLUMNA en la que el tablero puso al lead, no `lead.status`: varios status
    caen en la primera columna y el lote tiene que coincidir con lo que se ve.

    Los grupos pueden venir de MÁS DE UN tablero (cada uno con su `board`): el
    Funnel de Ventas manda también los leads que todavía están en el Setter
    Funnel, porque repartir es un solo trabajo y hacerlo dos veces, una por
    pantalla, es como se termina con la mitad del equipo sin leads. Cuando hay
    un solo tablero el selector no aparece.

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
          {{ boards.length > 1
            ? 'Se listan los leads de los dos tableros con los filtros que tienen ahora. Acota el lote por tablero, etapa y fecha de registro antes de marcar.'
            : 'Se listan los leads que el tablero muestra ahora. Acota el lote por etapa y por fecha de registro antes de marcar.' }}
        </p>

        <div class="bulk-filters">
          <label v-if="boards.length > 1" class="bulk-field">
            <span class="form-label">Tablero</span>
            <select v-model="board" class="form-select">
              <option value="all">Los dos ({{ leads.length }})</option>
              <option v-for="b in boards" :key="b.key" :value="b.key">
                {{ b.label }} ({{ b.count }})
              </option>
            </select>
          </label>
          <label class="bulk-field">
            <span class="form-label">Etapa del funnel</span>
            <select v-model="stage" class="form-select">
              <option value="all">Todas ({{ boardLeads.length }})</option>
              <option v-for="group in boardGroups" :key="group.key" :value="group.key">
                {{ group.label }} ({{ group.leads.length }})
              </option>
            </select>
          </label>
          <label class="bulk-field">
            <span class="form-label">Registrado desde</span>
            <input v-model="dateFrom" type="date" class="form-input" :max="dateTo || undefined" />
          </label>
          <label class="bulk-field">
            <span class="form-label">Registrado hasta</span>
            <input v-model="dateTo" type="date" class="form-input" :min="dateFrom || undefined" />
          </label>
        </div>

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
        <!-- Lo marcado no se pierde al cambiar de filtro: si quedó algo fuera
             de la lista, se avisa, porque también se va a aplicar. -->
        <p v-if="hiddenSelected > 0" class="bulk-note">
          {{ hiddenSelected }} de los marcados no están en la lista con estos filtros, pero siguen
          marcados. <button type="button" class="bulk-link" @click="keepOnlyShown">Quitarlos</button>
        </p>

        <p v-if="leads.length === 0" class="bulk-empty">No hay leads con los filtros actuales.</p>
        <p v-else-if="shown.length === 0" class="bulk-empty">Ningún lead coincide con estos filtros.</p>

        <ul v-else class="bulk-list custom-scrollbar">
          <li v-for="lead in shown" :key="lead.id">
            <label class="bulk-row" :class="{ 'is-on': selected.has(lead.id) }">
              <input type="checkbox" :checked="selected.has(lead.id)" @change="toggle(lead.id)" />
              <span class="bulk-row-main">
                <strong>{{ lead.full_name || `Lead #${lead.id}` }}</strong>
                <small>{{ lead.phone || 'Sin celular' }} · {{ shortDate(lead.created_at) }} · {{ stageLabelOf.get(lead.id) }}</small>
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
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { commercialTeam as team, loadCommercialTeam } from '../data/commercialTeam.js';

const props = defineProps({
  /**
   * Las columnas con los leads que se muestran ahora (ya filtrados):
   * `[{ key, label, leads, board? }]`. `board` (`{ key, label }`) es opcional y
   * solo hace falta cuando los grupos vienen de más de un tablero.
   */
  groups: { type: Array, required: true }
});

const leads = computed(() => props.groups.flatMap((group) => group.leads));

/** Tablero elegido ('all' = los dos). */
const board = ref('all');

/**
 * Los tableros que mandaron grupos, en el orden en que llegaron. Un grupo sin
 * `board` cuenta como un único tablero sin nombre, que es el caso del Setter
 * Funnel abriendo su propio modal: ahí no hay nada que elegir y el selector ni
 * se dibuja.
 */
const boards = computed(() => {
  const found = new Map();
  for (const group of props.groups) {
    if (!group.board) continue;
    const prev = found.get(group.board.key);
    if (prev) prev.count += group.leads.length;
    else found.set(group.board.key, { key: group.board.key, label: group.board.label, count: group.leads.length });
  }
  return [...found.values()];
});

/** Los grupos del tablero elegido (todos, si no se eligió uno). */
const boardGroups = computed(() => (
  board.value === 'all'
    ? props.groups
    : props.groups.filter((group) => group.board?.key === board.value)
));

const boardLeads = computed(() => boardGroups.value.flatMap((group) => group.leads));

/**
 * id del lead → etiqueta de su columna, para mostrarla en cada fila. Con dos
 * tableros a la vista lleva delante el nombre del tablero: "Cita Agendada"
 * existe en los dos, y sin eso no se sabe de cuál es la fila que se marca.
 */
const stageLabelOf = computed(() => {
  const labels = new Map();
  const prefix = boards.value.length > 1;
  for (const group of props.groups) {
    const label = prefix && group.board ? `${group.board.label} · ${group.label}` : group.label;
    for (const lead of group.leads) labels.set(lead.id, label);
  }
  return labels;
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
const stage = ref('all');
const dateFrom = ref(''); // YYYY-MM-DD, día de Lima
const dateTo = ref('');
const saving = ref(false);
const error = ref('');
const teamError = ref('');

/** El día de calendario de Lima en que se registró el lead, como lo escribe el `<input type="date">`. */
function limaDay(dateStr) {
  const d = new Date(dateStr);
  if (!dateStr || isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}

const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  const pool = stage.value === 'all'
    ? boardLeads.value
    : (boardGroups.value.find((group) => group.key === stage.value)?.leads || []);

  return pool.filter((lead) => {
    if (dateFrom.value || dateTo.value) {
      const day = limaDay(lead.created_at);
      if (!day) return false;
      if (dateFrom.value && day < dateFrom.value) return false;
      if (dateTo.value && day > dateTo.value) return false;
    }
    if (!text) return true;
    return (lead.full_name || '').toLowerCase().includes(text) || (lead.phone || '').toLowerCase().includes(text);
  });
});

/* Al cambiar de tablero se vuelve a "Todas": la etapa que estaba elegida puede
   no existir en el otro, y una lista vacía sin motivo se lee como que no hay
   leads. Lo MARCADO no se toca —se sigue aplicando, y el aviso de abajo lo
   dice—, porque marcar en los dos tableros es justamente para lo que sirve. */
watch(board, () => { stage.value = 'all'; });

const hiddenSelected = computed(() => {
  const visible = new Set(shown.value.map((lead) => lead.id));
  return [...selected.value].filter((id) => !visible.has(id)).length;
});

function keepOnlyShown() {
  const visible = new Set(shown.value.map((lead) => lead.id));
  selected.value = new Set([...selected.value].filter((id) => visible.has(id)));
}

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

.bulk-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-main);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.bulk-filters,
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
