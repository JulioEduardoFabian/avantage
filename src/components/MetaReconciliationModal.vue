<template>
  <!--
    Conciliación con Meta Lead Ads: compara, formulario por formulario, los
    leads que Meta registró contra los que llegaron al CRM.

    Vive en un componente y no dentro de una vista porque lo usan los dos
    tableros: el Setter Funnel, que es donde caen los leads de formulario
    ("conversación abierta"), y el Kanban de Ventas. Copiado en cada uno, el
    segundo se queda atrás en cuanto el reporte cambia.

    El desglose por plataforma es el que contesta de un vistazo si lo que se
    pierde viene de Facebook o de Instagram — la pregunta que si no obliga a
    exportar el CSV del Administrador de anuncios y cruzarlo a mano.
  -->
  <div v-if="modelValue" class="modal-overlay" @click.self="close">
    <div class="modal-content column-modal-card" style="max-width: 760px;">
      <div class="modal-header">
        <h3 class="modal-title">🧮 Conciliación con Meta Lead Ads</h3>
        <button class="modal-close-btn" @click="close">✕</button>
      </div>
      <div class="modal-body">
        <div class="meta-rec-range">
          <label class="form-label" style="font-size: 0.8rem;">Desde</label>
          <input v-model="form.since" type="date" class="form-control" />
          <label class="form-label" style="font-size: 0.8rem;">Hasta</label>
          <input v-model="form.until" type="date" class="form-control" />
          <button class="btn-action-secondary" @click="run(false)" :disabled="loading">
            {{ loading ? 'Consultando…' : 'Comparar' }}
          </button>
        </div>
        <p class="section-subheading" style="margin: 0.5rem 0 1rem 0;">
          Las fechas son las del envío del formulario en Meta, no las de alta en el CRM. Vacías, compara todo lo que Meta conserva (90 días).
        </p>

        <div v-if="error" class="info-box" style="border-color: rgba(220, 90, 90, 0.4); background: rgba(220, 90, 90, 0.08);">
          <p style="color: var(--accent-rose); font-size: 0.85rem; margin: 0;">{{ error }}</p>
        </div>

        <div v-if="report && report.aviso" class="info-box" style="border-color: rgba(201, 146, 46, 0.4); background: rgba(201, 146, 46, 0.08); margin-bottom: 0.75rem;">
          <p style="color: var(--accent-amber); font-size: 0.82rem; margin: 0;">⚠️ {{ report.aviso }}</p>
        </div>

        <template v-if="report">
          <div class="meta-rec-totals">
            <div class="stat-card">
              <div class="stat-info">
                <span class="stat-label">En Meta</span>
                <span class="stat-value">{{ report.totals.en_meta }}</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-info">
                <span class="stat-label">En el CRM</span>
                <span class="stat-value">{{ report.totals.en_crm }}</span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-info">
                <span class="stat-label">Faltantes</span>
                <span class="stat-value" :style="{ color: report.totals.faltantes ? 'var(--accent-rose)' : 'var(--accent-green)' }">
                  {{ report.totals.faltantes }}
                </span>
              </div>
            </div>
          </div>

          <h4 class="form-label" style="margin-top: 1rem;">Por plataforma</h4>
          <table class="meta-rec-table">
            <thead>
              <tr><th>Plataforma</th><th>En Meta</th><th>En el CRM</th><th>Faltantes</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, platform) in report.by_platform" :key="platform">
                <td>{{ platformLabel(platform) }}</td>
                <td>{{ row.en_meta }}</td>
                <td>{{ row.en_crm }}</td>
                <td :style="{ color: row.faltantes ? 'var(--accent-rose)' : 'inherit' }">{{ row.faltantes }}</td>
              </tr>
            </tbody>
          </table>

          <h4 class="form-label" style="margin-top: 1rem;">Por formulario</h4>
          <table class="meta-rec-table">
            <thead>
              <tr><th>Formulario</th><th>En Meta</th><th>En el CRM</th><th>Faltantes</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in report.forms" :key="row.form_id">
                <td>
                  {{ row.nombre || row.form_id }}
                  <span v-if="row.error" style="color: var(--accent-rose);" :title="row.error">⚠️</span>
                </td>
                <td>{{ row.en_meta }}</td>
                <td>{{ row.en_crm }}</td>
                <td :style="{ color: row.faltantes ? 'var(--accent-rose)' : 'inherit' }">{{ row.faltantes }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="report.applied" class="info-box" style="margin-top: 1rem; border-color: rgba(70, 180, 120, 0.4); background: rgba(70, 180, 120, 0.08);">
            <p style="color: var(--accent-green); font-size: 0.85rem; margin: 0;">
              Se recuperaron {{ report.totals.importados }} lead(s).
              <template v-if="report.totals.fallidos">{{ report.totals.fallidos }} fallaron.</template>
              Entran al Setter Funnel como "conversación abierta".
            </p>
          </div>

          <div class="modal-footer-actions">
            <button type="button" class="btn-action-ghost" @click="close">Cerrar</button>
            <button
              type="button"
              class="btn-action-primary"
              :disabled="loading || !report.totals.faltantes"
              @click="run(true)"
            >
              Recuperar {{ report.totals.faltantes }} lead(s) faltante(s)
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { apiFetch } from '../apiClient.js';

const props = defineProps({ modelValue: { type: Boolean, default: false } });
const emit = defineEmits(['update:modelValue', 'imported']);

const loading = ref(false);
const error = ref('');
const report = ref(null);
const form = reactive({ since: '', until: '' });

const PLATFORM_LABELS = { fb: 'Facebook', ig: 'Instagram', desconocida: 'Sin dato' };
function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform;
}

function close() {
  emit('update:modelValue', false);
}

// Al abrirse compara solo, que es la acción que no escribe nada.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    error.value = '';
    if (!report.value) run(false);
  }
);

/*
 * Dos pasos a propósito: "Comparar" solo lee y "Recuperar" escribe. Traer
 * leads perdidos agrega gente al funnel que el equipo va a trabajar, así que
 * no puede ser un efecto de abrir una pantalla.
 */
async function run(apply) {
  if (apply && !window.confirm('Se van a importar los leads faltantes al Setter Funnel. ¿Continuar?')) return;

  loading.value = true;
  error.value = '';
  try {
    const query = new URLSearchParams();
    if (form.since) query.set('since', form.since);
    if (form.until) query.set('until', form.until);

    const response = apply
      ? await apiFetch('/api/leads/meta-reconciliation', {
          method: 'POST',
          body: JSON.stringify({ since: form.since || null, until: form.until || null })
        })
      : await apiFetch(`/api/leads/meta-reconciliation?${query.toString()}`);

    const data = await response.json();
    if (!response.ok) throw new Error(data.details || data.error || 'Error al consultar a Meta.');

    report.value = data;
    if (apply && data.totals.importados) emit('imported', data);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.meta-rec-range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.meta-rec-range .form-control { width: auto; }
.meta-rec-range .form-label { margin: 0; }

.meta-rec-totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.6rem;
}

/* La tabla se desplaza dentro de su caja: un formulario con nombre largo no
   puede hacer que el modal entero se mueva en horizontal. */
.meta-rec-table {
  display: block;
  overflow-x: auto;
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.meta-rec-table th,
.meta-rec-table td {
  padding: 0.35rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  white-space: nowrap;
}
.meta-rec-table th { color: var(--text-muted); font-weight: 600; }
</style>
