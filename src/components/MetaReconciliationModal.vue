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

        <!--
          La suscripción al webhook va ARRIBA de los totales y no al pie: con
          el campo "leadgen" sin suscribir, "faltan 37 leads" no es un fallo
          del webhook sino que Meta nunca llamó, y es la única de las dos
          cifras que explica a la otra. La suscripción es de la app a la
          PÁGINA, así que cubre todos sus formularios —los que existen y los
          que se creen después— y por eso se dice una vez y no formulario por
          formulario.
        -->
        <div
          v-if="report && report.suscripcion"
          class="info-box meta-rec-subscription"
          :class="`is-${report.suscripcion.estado}`"
        >
          <p class="meta-rec-subscription-title">
            {{ SUBSCRIPTION_LABELS[report.suscripcion.estado] || 'Suscripción al webhook' }}
          </p>
          <p class="meta-rec-subscription-detail">{{ report.suscripcion.detalle }}</p>
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
            <!--
              "Están los mismos" no alcanza: un lead que entró sin su ad_id no
              aparece en el reporte de Campañas, así que esta cifra es la otra
              mitad de la comprobación. Se arregla con el botón de completar
              datos de abajo, no volviendo a importar.
            -->
            <div class="stat-card">
              <div class="stat-info">
                <span class="stat-label">Sin anuncio</span>
                <span class="stat-value" :style="{ color: report.totals.sin_anuncio ? 'var(--accent-amber)' : 'var(--accent-green)' }">
                  {{ report.totals.sin_anuncio }}
                </span>
              </div>
            </div>
          </div>
          <p
            v-if="report.totals.sin_anuncio"
            class="section-subheading"
            style="margin: 0.4rem 0 0 0;"
          >
            {{ report.totals.sin_anuncio }} lead(s) están en el CRM sin el anuncio que los trajo, así que no figuran en
            Campañas. Son fichas anteriores a la atribución: se completan con “Completar datos del formulario”.
          </p>

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
              <tr><th>Formulario</th><th>En Meta</th><th>En el CRM</th><th>Sin anuncio</th><th>Faltantes</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in report.forms" :key="row.form_id">
                <td>
                  {{ row.nombre || row.form_id }}
                  <span v-if="row.error" style="color: var(--accent-rose);" :title="row.error">⚠️</span>
                </td>
                <td>{{ row.en_meta }}</td>
                <td>{{ row.en_crm }}</td>
                <td :style="{ color: row.sin_anuncio ? 'var(--accent-amber)' : 'inherit' }">{{ row.sin_anuncio }}</td>
                <td :style="{ color: row.faltantes ? 'var(--accent-rose)' : 'inherit' }">{{ row.faltantes }}</td>
              </tr>
            </tbody>
          </table>

          <!--
            Un formulario activo que no entregó un solo lead se dice aparte: en
            una lista de treinta formularios (la mayoría viejos y vacíos) no se
            distingue del ruido, y es justo el que hay que ir a revisar.
          -->
          <div
            v-if="report.formularios_activos_sin_leads && report.formularios_activos_sin_leads.length"
            class="info-box meta-rec-subscription is-sin_leadgen"
            style="margin-top: 0.75rem;"
          >
            <p class="meta-rec-subscription-title">
              {{ report.formularios_activos_sin_leads.length }} formulario(s) activo(s) sin un solo lead en el CRM
            </p>
            <p class="meta-rec-subscription-detail">
              {{ report.formularios_activos_sin_leads.map((f) => `${f.nombre || f.form_id} (${f.en_meta} en Meta)`).join(' · ') }}
            </p>
          </div>

          <div v-if="report.applied" class="info-box" style="margin-top: 1rem; border-color: rgba(70, 180, 120, 0.4); background: rgba(70, 180, 120, 0.08);">
            <p style="color: var(--accent-green); font-size: 0.85rem; margin: 0;">
              Se recuperaron {{ report.totals.importados }} lead(s).
              <template v-if="report.totals.fallidos">{{ report.totals.fallidos }} fallaron.</template>
              Entran al Setter Funnel como "conversación abierta".
            </p>
          </div>

        </template>

        <!--
          Conciliar contesta "¿llegaron todos los leads?"; esto contesta
          "¿llegaron completos?". Son la misma falla vista de dos maneras y por
          eso comparten modal: el formulario que se contesta dentro de Messenger
          o de Instagram manda sus respuestas con preguntas propias, y hasta el
          26/10/2026 el importador solo guardaba el nombre — la tarjeta quedaba
          en "Sin celular". Lo nuevo ya entra completo; esto es para las fichas
          que se dieron de alta antes.
        -->
        <div class="meta-rec-backfill">
          <h4 class="form-label" style="margin: 0;">Fichas incompletas</h4>
          <p class="section-subheading" style="margin: 0.25rem 0 0.6rem 0;">
            Vuelve a pedirle a Meta las respuestas de los leads de formulario que ya están en el CRM y completa lo que
            les falte (celular, correo, universidad, carrera). Nunca pisa un dato corregido a mano.
          </p>
          <button type="button" class="btn-action-secondary" :disabled="backfilling" @click="runBackfill">
            {{ backfilling ? 'Completando…' : '🧩 Completar datos del formulario' }}
          </button>

          <p v-if="backfillError" class="info-box" style="margin-top: 0.6rem; color: var(--accent-rose); font-size: 0.82rem;">
            {{ backfillError }}
          </p>
          <div v-else-if="backfillResult" class="info-box" style="margin-top: 0.6rem;">
            <p style="font-size: 0.82rem; margin: 0;">
              Se revisaron {{ backfillResult.totalFound }} ficha(s) de formulario:
              <strong>{{ backfillResult.updated.length }}</strong> completada(s),
              {{ backfillResult.skipped }} ya estaban bien.
              <template v-if="backfillResult.failed.length">{{ backfillResult.failed.length }} fallaron.</template>
            </p>
            <!--
              Un celular rescatado que ya es de otra ficha no se escribe: serían
              dos leads con el mismo número. Se nombra para que el equipo decida
              cuál se queda, que es la misma salida del modal de duplicados.
            -->
            <p v-if="backfillResult.phoneConflicts && backfillResult.phoneConflicts.length"
               style="font-size: 0.8rem; margin: 0.4rem 0 0 0; color: var(--accent-amber);">
              ⚠️ {{ backfillResult.phoneConflicts.length }} celular(es) recuperado(s) ya pertenecen a otra ficha y no se
              escribieron: revísalos en Duplicados
              (ficha {{ backfillResult.phoneConflicts.map((c) => `#${c.id}→#${c.existingLeadId}`).join(', ') }}).
            </p>
          </div>
        </div>

        <template v-if="report">
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

const backfilling = ref(false);
const backfillError = ref('');
const backfillResult = ref(null);

/*
 * Cada estado se arregla distinto, y por eso el rótulo dice qué pasa y no solo
 * si está bien o mal: "sin_leadgen" es agregar un campo a una suscripción que
 * ya existe, "sin_apps" es que la app nunca se suscribió a esta Página, y
 * "desconocido" es que al token le falta permiso para comprobarlo — que no es
 * lo mismo que estar desconectado.
 */
const SUBSCRIPTION_LABELS = {
  conectado: '✅ Meta está avisando de cada lead nuevo',
  sin_leadgen: '🚨 La Página no está suscrita al campo "leadgen"',
  sin_apps: '🚨 Ninguna app nuestra está suscrita a esta Página',
  desconocido: '⚠️ No se pudo comprobar la suscripción al webhook'
};

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

/*
 * Completar no importa a nadie nuevo: solo rellena huecos de fichas que ya
 * están, así que no necesita el paso de confirmación de "Recuperar". Igual se
 * refresca el tablero al terminar, porque cambia lo que dicen las tarjetas.
 */
async function runBackfill() {
  backfilling.value = true;
  backfillError.value = '';
  try {
    const response = await apiFetch('/api/leads/backfill-meta-fields', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.details || data.error || 'Error al completar los datos.');
    backfillResult.value = data;
    if (data.updated?.length) emit('imported', data);
  } catch (err) {
    backfillError.value = err.message;
  } finally {
    backfilling.value = false;
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

.meta-rec-backfill {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
}

/* El diagnóstico de la suscripción: el color lo pone el estado, porque es lo
   primero que hay que ver al abrir el modal. Los tres tonos salen de los
   tokens de acento del panel para que funcionen en los dos temas. */
.meta-rec-subscription {
  margin-bottom: 0.75rem;
}
.meta-rec-subscription-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
}
.meta-rec-subscription-detail {
  margin: 0.3rem 0 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.meta-rec-subscription.is-conectado {
  border-color: rgba(70, 180, 120, 0.4);
  background: rgba(70, 180, 120, 0.08);
}
.meta-rec-subscription.is-conectado .meta-rec-subscription-title { color: var(--accent-green); }
.meta-rec-subscription.is-sin_leadgen,
.meta-rec-subscription.is-sin_apps {
  border-color: rgba(220, 90, 90, 0.4);
  background: rgba(220, 90, 90, 0.08);
}
.meta-rec-subscription.is-sin_leadgen .meta-rec-subscription-title,
.meta-rec-subscription.is-sin_apps .meta-rec-subscription-title { color: var(--accent-rose); }
.meta-rec-subscription.is-desconocido {
  border-color: rgba(201, 146, 46, 0.4);
  background: rgba(201, 146, 46, 0.08);
}
.meta-rec-subscription.is-desconocido .meta-rec-subscription-title { color: var(--accent-amber); }

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
