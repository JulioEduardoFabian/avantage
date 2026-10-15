<template>
  <!--
    Las personas cargadas más de una vez: mismo celular (últimos 9 dígitos) o
    mismo DNI, con la regla del tope del alta manual (`groupDuplicateLeads()`
    en el servidor). Cada grupo es UNA persona y cada fila una de sus fichas,
    con la etapa en la que está y de quién es: lo que hace falta para decidir
    cuál se sigue trabajando.
  -->
  <div v-if="modelValue" class="modal-overlay" @click.self="close">
    <div class="modal-content column-modal-card" style="max-width: 760px;">
      <div class="modal-header">
        <h3 class="modal-title">👯 Leads duplicados</h3>
        <button class="modal-close-btn" @click="close">✕</button>
      </div>
      <div class="modal-body">
        <p class="section-subheading" style="margin: 0 0 0.75rem 0;">
          Fichas que comparten celular o DNI: son la misma persona cargada más de una vez.
        </p>

        <div v-if="loading" class="dupg-empty">Buscando duplicados…</div>

        <div v-else-if="error" class="info-box" style="border-color: rgba(220, 90, 90, 0.4); background: rgba(220, 90, 90, 0.08);">
          <p style="color: var(--accent-rose); font-size: 0.85rem; margin: 0;">{{ error }}</p>
        </div>

        <div v-else-if="groups.length === 0" class="dupg-empty">✅ No hay leads duplicados.</div>

        <template v-else>
          <input
            v-model="search"
            type="search"
            class="form-control dupg-search"
            placeholder="Buscar por nombre, celular o DNI…"
          />
          <p class="dupg-count">
            {{ filteredGroups.length }} persona(s) duplicada(s) · {{ totalLeads }} fichas
          </p>

          <section v-for="group in filteredGroups" :key="group.leads[0].id" class="dupg-group">
            <header class="dupg-group-head">
              <strong>{{ groupName(group) }}</strong>
              <span class="dupg-why">{{ group.leads.length }} fichas · {{ reasonsLabel(group.reasons) }}</span>
            </header>
            <ul class="dupg-list">
              <li v-for="lead in group.leads" :key="lead.id" class="dupg-item">
                <div class="dupg-item-main">
                  <span class="dupg-name">{{ lead.full_name || `Lead #${lead.id}` }}</span>
                  <span class="dupg-stage">{{ stageLabel(lead.status) }}</span>
                  <span v-if="lead.has_project" class="dupg-badge">🏆 con proyecto</span>
                </div>
                <div class="dupg-meta">
                  <span>📱 {{ lead.phone || 'sin celular' }}</span>
                  <span v-if="lead.dni">· DNI {{ lead.dni }}</span>
                  <span v-if="lead.source">· {{ lead.source }}</span>
                  <span v-if="lead.created_at">· {{ formatDate(lead.created_at) }}</span>
                </div>
                <div class="dupg-owner">
                  <span>{{ lead.assigned_user_name ? `A cargo de ${lead.assigned_user_name}` : 'Sin responsable asignado' }}</span>
                  <button v-if="openableIds.includes(lead.id)" type="button" class="dupg-link" @click="openLead(lead)">
                    Ver ficha →
                  </button>
                  <span v-else-if="!lead.visible" class="dupg-hidden">No está en tu cartera</span>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <div class="modal-footer-actions">
          <button type="button" class="btn-action-ghost" @click="close">Cerrar</button>
          <button type="button" class="btn-action-secondary" :disabled="loading" @click="load">🔄 Actualizar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { reasonsLabel } from '../leadDuplicateCheck.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /* Los ids que la pantalla puede abrir con lo que ya tiene cargado. */
  openableIds: { type: Array, default: () => [] },
  /* Cómo nombra la pantalla cada etapa (las columnas las configura el equipo). */
  stageLabel: { type: Function, default: (status) => status || 'Sin etapa' }
});
const emit = defineEmits(['update:modelValue', 'open']);

const loading = ref(false);
const error = ref('');
const groups = ref([]);
const search = ref('');

const filteredGroups = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return groups.value;
  const digits = term.replace(/\D/g, '');
  return groups.value.filter((group) =>
    group.leads.some((lead) =>
      (lead.full_name || '').toLowerCase().includes(term)
      || (digits.length >= 3 && String(lead.phone || '').replace(/\D/g, '').includes(digits))
      || String(lead.dni || '').toLowerCase().includes(term)
    )
  );
});

const totalLeads = computed(() => filteredGroups.value.reduce((sum, group) => sum + group.leads.length, 0));

function groupName(group) {
  return group.leads.find((lead) => lead.full_name)?.full_name || `Lead #${group.leads[0].id}`;
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await apiFetch('/api/leads/duplicates');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron listar los duplicados.');
    groups.value = data.groups || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}

function openLead(lead) {
  emit('open', lead);
  close();
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load();
  },
  { immediate: true }
);
</script>

<style scoped>
.dupg-empty {
  padding: 1.5rem 0;
  text-align: center;
  color: var(--text-sub);
  font-size: 0.9rem;
}

.dupg-search { margin-bottom: 0.5rem; }

.dupg-count {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0 0 0.6rem;
}

.dupg-group {
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--accent-amber);
  border-radius: var(--radius-md);
  padding: 0.6rem 0.7rem;
  margin-bottom: 0.65rem;
}

.dupg-group-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.45rem;
}

.dupg-group-head strong { font-size: 0.9rem; color: var(--text-main); }
.dupg-why { font-size: 0.76rem; color: var(--accent-amber); }

.dupg-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.dupg-item {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.45rem 0.55rem;
}

.dupg-item-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.dupg-name { font-weight: 600; font-size: 0.85rem; color: var(--text-main); }

.dupg-stage,
.dupg-badge {
  font-size: 0.72rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-sub);
}

.dupg-badge { border-color: var(--accent-emerald); color: var(--accent-emerald); }

.dupg-meta,
.dupg-owner {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: var(--text-sub);
  margin-top: 0.2rem;
}

.dupg-owner { justify-content: space-between; }

.dupg-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--primary);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.dupg-hidden { font-style: italic; color: var(--text-muted); }
</style>
