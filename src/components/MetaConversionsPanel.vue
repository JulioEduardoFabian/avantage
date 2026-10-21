<template>
  <section class="capi-panel">
    <header class="capi-header">
      <div>
        <h3 class="capi-title">📤 Conversiones hacia Meta</h3>
        <p class="capi-intro">
          La vuelta del circuito: cuando un lead llega a una etapa clave, se le devuelve a Meta el
          evento para que pueda optimizar por <strong>calidad de lead</strong> y no solo por
          formularios llenados. Solo se reportan los leads que Meta reconoce como suyos: los de
          formulario instantáneo (por su <code>lead_id</code>) y los de anuncios Click-to-WhatsApp
          (por su <code>ctwa_clid</code>). <strong>No viaja ningún importe.</strong>
        </p>
      </div>
      <button class="btn-action-secondary" :disabled="isLoading" @click="load">
        <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
        {{ isLoading ? 'Cargando…' : 'Actualizar' }}
      </button>
    </header>

    <p v-if="errorMessage" class="info-box capi-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="okMessage" class="info-box capi-ok">✅ {{ okMessage }}</p>

    <!-- Estado de la configuración: sin dataset ni token no sale ningún evento,
         y es lo primero que hay que poder ver. -->
    <div class="capi-config" :class="config.enabled ? 'is-on' : 'is-off'">
      <div class="capi-config-state">
        <span class="capi-dot" :class="config.enabled ? 'is-on' : 'is-off'"></span>
        <strong>{{ config.enabled ? 'Integración activa' : 'Integración apagada' }}</strong>
      </div>
      <ul class="capi-config-list">
        <li>
          Leads de formulario (conjunto de datos de CRM):
          <code v-if="config.datasetId">{{ config.datasetId }}</code>
          <em v-else>falta <code>META_CAPI_DATASET_ID</code> — no se reportan</em>
        </li>
        <!-- Son dos conjuntos distintos a propósito: el `ctwa_clid` solo se
             atribuye al anuncio contra el conjunto ligado a la cuenta de
             WhatsApp Business. Mandarlo al de CRM no da error, simplemente no
             atribuye nada. -->
        <li>
          Leads de Click-to-WhatsApp (conjunto de la cuenta de WhatsApp):
          <code v-if="config.messagingDatasetId">{{ config.messagingDatasetId }}</code>
          <em v-else>falta <code>META_CAPI_MESSAGING_DATASET_ID</code> — no se reportan</em>
        </li>
        <li>
          Token de acceso:
          <span v-if="config.hasToken">configurado</span>
          <em v-else>falta <code>META_CAPI_ACCESS_TOKEN</code> (o <code>META_ADS_ACCESS_TOKEN</code>)</em>
        </li>
        <li v-if="config.testEventCode" class="capi-test-warning">
          Modo prueba activo (<code>{{ config.testEventCode }}</code>): los eventos se ven en
          "Probar eventos" de Events Manager y <strong>no cuentan</strong> en las métricas. Quita
          <code>META_CAPI_TEST_EVENT_CODE</code> cuando termines de verificar.
        </li>
        <li v-else>Origen declarado: <code>{{ config.leadEventSource }}</code></li>
      </ul>
    </div>

    <div class="capi-stats">
      <div class="capi-stat is-sent">
        <span class="capi-stat-label">Enviados</span>
        <span class="capi-stat-value">{{ summary.enviado }}</span>
      </div>
      <div class="capi-stat is-error">
        <span class="capi-stat-label">Con error</span>
        <span class="capi-stat-value">{{ summary.error }}</span>
      </div>
      <div class="capi-stat is-skipped">
        <span class="capi-stat-label">Omitidos</span>
        <span class="capi-stat-value">{{ summary.omitido }}</span>
      </div>
      <p class="capi-stats-note">Últimos 7 días, que es la ventana que Meta acepta hacia atrás.</p>
    </div>

    <!-- Mapeo: qué etapa se reporta y con qué nombre. Es una tabla y no una
         lista fija porque las columnas del funnel las crea el equipo. -->
    <div class="capi-block">
      <div class="capi-block-head">
        <h4 class="capi-subtitle">Qué etapas se reportan</h4>
        <p class="capi-hint">
          El nombre del evento es el que verás en Events Manager; ahí eliges cuál de ellos es tu
          "lead de calidad". Dos etapas pueden compartir el nombre (la columna que marcaste como
          final y el estado <code>ganado</code> son la misma venta) y entonces se reporta una sola
          vez por lead. Dejar el nombre vacío saca la etapa del reporte.
        </p>
      </div>

      <div class="data-table-wrapper">
        <table class="data-table capi-table">
          <thead>
            <tr>
              <th>Etapa del funnel</th>
              <th>Nombre del evento en Meta</th>
              <th class="capi-switch-col">Reportar</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.statusKey">
              <td data-label="Etapa">
                <span class="capi-stage">{{ row.label }}</span>
                <span class="capi-stage-key"><code>{{ row.statusKey }}</code> · {{ boardName(row.board) }}</span>
              </td>
              <td data-label="Evento">
                <input
                  v-model="row.eventName"
                  type="text"
                  class="form-input capi-input"
                  maxlength="60"
                  placeholder="Sin reportar"
                />
              </td>
              <td class="capi-switch-col" data-label="Reportar">
                <label class="capi-switch">
                  <input v-model="row.enabled" type="checkbox" :disabled="!row.eventName.trim()" />
                  <span>{{ row.enabled && row.eventName.trim() ? 'Sí' : 'No' }}</span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="capi-actions">
        <button class="btn-action-primary" :disabled="isSaving" @click="save">
          {{ isSaving ? 'Guardando…' : 'Guardar mapeo' }}
        </button>
        <button
          class="btn-action-secondary"
          :disabled="isTesting || !config.enabled"
          title="Manda un evento de prueba usando un lead real con atribución de Meta"
          @click="sendTest"
        >
          {{ isTesting ? 'Enviando…' : 'Enviar evento de prueba' }}
        </button>
        <button
          class="btn-action-ghost"
          :disabled="isBackfilling || !config.enabled"
          title="Reenvía los movimientos de los últimos 7 días que debían reportarse y no llegaron"
          @click="backfill"
        >
          {{ isBackfilling ? 'Reenviando…' : 'Reenviar últimos 7 días' }}
        </button>
      </div>
    </div>

    <!-- Bitácora de envíos: el error de Meta se muestra tal cual, que es lo
         único accionable cuando un evento no llega. -->
    <div class="capi-block">
      <h4 class="capi-subtitle">Últimos envíos</h4>
      <p v-if="events.length === 0" class="capi-hint">
        Todavía no se envió ningún evento. Aparecen acá en cuanto un lead con atribución de Meta
        llegue a una etapa reportada.
      </p>
      <ul v-else class="capi-log">
        <li v-for="event in events" :key="event.id" class="capi-log-item" :class="'is-' + event.state">
          <div class="capi-log-main">
            <span class="pill" :class="statePill(event.state)">{{ stateLabel(event.state) }}</span>
            <strong>{{ event.event_name }}</strong>
            <span class="capi-log-lead">
              {{ event.lead_name || 'Lead sin nombre' }}
              <template v-if="event.lead_id">(#{{ event.lead_id }})</template>
            </span>
            <span v-if="event.identifier_kind" class="capi-log-kind">{{ kindLabel(event.identifier_kind) }}</span>
          </div>
          <div class="capi-log-meta">{{ formatLeadDate(event.created_at) }}</div>
          <p v-if="event.reason" class="capi-log-reason">{{ event.reason }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { formatLeadDate } from '../leadCardDate.js';

/*
 * Configuración y bitácora de las conversiones que se le envían a Meta.
 *
 * El mapeo etapa → evento se edita acá porque las columnas del funnel las crea
 * el equipo: una lista fija en el código no podría nombrar su columna
 * "Cotizado", y renombrarla en el Kanban no puede romper el reporte. Las
 * credenciales NO se editan acá (son del `.env`): de ellas solo se muestra si
 * están puestas, porque un secreto no viaja a la pantalla ni para taparlo.
 */

const config = reactive({
  enabled: false,
  datasetId: null,
  messagingDatasetId: null,
  hasToken: false,
  testEventCode: null,
  leadEventSource: '',
  version: ''
});
const summary = reactive({ enviado: 0, error: 0, omitido: 0 });
const stages = ref([]);
const mapping = ref([]);
const events = ref([]);
const isLoading = ref(false);
const isSaving = ref(false);
const isTesting = ref(false);
const isBackfilling = ref(false);
const errorMessage = ref('');
const okMessage = ref('');

/**
 * Una fila por etapa que un lead puede llegar a tener (las columnas de los dos
 * tableros más los desenlaces fijos), con lo que esté mapeado. Se muestran
 * TODAS y no solo las mapeadas: lo que no está en la lista no se puede
 * empezar a reportar.
 *
 * Si quedó mapeada una etapa cuya columna el equipo borró, igual aparece —
 * tiene eventos enviados a su nombre y esconderla haría imposible apagarla.
 */
const rows = ref([]);

function buildRows() {
  const byKey = new Map(mapping.value.map((row) => [row.status_key, row]));
  const vistas = new Set();
  const lista = [];

  for (const stage of stages.value) {
    const mapped = byKey.get(stage.key);
    vistas.add(stage.key);
    lista.push({
      statusKey: stage.key,
      label: stage.label,
      board: stage.board,
      eventName: mapped?.event_name || '',
      enabled: Boolean(mapped?.enabled)
    });
  }

  for (const row of mapping.value) {
    if (vistas.has(row.status_key)) continue;
    lista.push({
      statusKey: row.status_key,
      label: row.status_key,
      // Marcada como huérfana y no como "desenlace fijo": es una etapa cuya
      // columna el equipo borró, y decirlo es lo que explica por qué sigue
      // apareciendo acá.
      board: 'huerfana',
      eventName: row.event_name || '',
      enabled: Boolean(row.enabled)
    });
  }

  // Primero lo que se reporta: es lo que alguien viene a revisar.
  rows.value = lista.sort((a, b) => Number(Boolean(b.eventName)) - Number(Boolean(a.eventName)));
}

const stateLabels = { enviado: 'Enviado', error: 'Error', omitido: 'Omitido' };
const statePills = { enviado: 'pill-success', error: 'pill-danger', omitido: 'pill-muted' };

function stateLabel(state) {
  return stateLabels[state] || state;
}

function statePill(state) {
  return statePills[state] || 'pill-muted';
}

function kindLabel(kind) {
  return kind === 'ctwa_clid' ? 'Click-to-WhatsApp' : 'Formulario de Meta';
}

function boardName(board) {
  if (board === 'ventas') return 'Funnel de Ventas';
  if (board === 'setter') return 'Setter Funnel';
  if (board === 'huerfana') return 'etapa que ya no existe en el tablero';
  return 'desenlace fijo';
}

/**
 * El error del servidor con su detalle pegado. El `details` es casi siempre lo
 * accionable ("falta correr las migraciones", el mensaje de Meta tal cual) y
 * quedaba descartado: la pantalla mostraba solo el titular, que manda a buscar
 * el problema donde no está.
 */
function errorText(data, fallback) {
  const base = data?.error || fallback;
  return data?.details ? `${base} ${data.details}` : base;
}

function flash(message) {
  okMessage.value = message;
  setTimeout(() => { okMessage.value = ''; }, 8000);
}

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/meta-capi');
    const data = await response.json();
    if (!response.ok) throw new Error(errorText(data, 'No se pudo leer la configuración de conversiones.'));
    Object.assign(config, data.config || {});
    Object.assign(summary, { enviado: 0, error: 0, omitido: 0 }, data.summary || {});
    stages.value = data.stages || [];
    mapping.value = data.mapping || [];
    events.value = data.events || [];
    buildRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

async function save() {
  isSaving.value = true;
  errorMessage.value = '';
  try {
    const payload = rows.value.map((row) => ({
      statusKey: row.statusKey,
      eventName: row.eventName.trim(),
      // Una etapa sin nombre de evento no se reporta aunque el interruptor
      // quedara encendido: no hay evento que mandar.
      enabled: Boolean(row.enabled && row.eventName.trim())
    }));
    const response = await apiFetch('/api/meta-capi/mapping', {
      method: 'PUT',
      body: JSON.stringify({ mapping: payload })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(errorText(data, 'No se pudo guardar el mapeo.'));
    mapping.value = data.mapping || [];
    buildRows();
    flash('Mapeo guardado. Los próximos cambios de etapa se reportan así.');
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

async function sendTest() {
  isTesting.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/meta-capi/test', { method: 'POST' });
    const data = await response.json();
    // Se prueba cada conjunto de datos configurado por separado: las dos
    // mitades fallan por motivos distintos, así que el resultado se cuenta una
    // por una y no como un sí/no.
    const detalle = (data.results || [])
      .map((r) => `${r.label}: ${r.ok ? `aceptado (lead #${r.leadId})` : `✗ ${r.error}`}`)
      .join(' · ');
    if (!data.ok) throw new Error(detalle || errorText(data, 'Meta rechazó el evento de prueba.'));
    flash(
      `Meta aceptó la prueba — ${detalle}` +
      (data.testEventCode ? '. Míralo en Events Manager > Probar eventos.' : '.')
    );
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isTesting.value = false;
  }
}

async function backfill() {
  isBackfilling.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/meta-capi/backfill', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(errorText(data, 'No se pudo reenviar.'));
    if (data.reason === 'sin_configurar') throw new Error('Falta el dataset o el token.');
    if (data.reason === 'sin_etapas') throw new Error('No hay ninguna etapa marcada para reportar.');
    flash(
      data.sent || data.failed
        ? `Reenvío terminado: ${data.sent} enviado(s), ${data.failed} con error, ${data.skipped} omitido(s).`
        : 'No había nada pendiente de los últimos 7 días.'
    );
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isBackfilling.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.capi-panel {
  margin-bottom: 1.1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.capi-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.capi-title { margin: 0 0 0.25rem; font-size: 1rem; color: var(--text-main); }
.capi-intro { margin: 0 0 0.6rem; font-size: 0.8rem; color: var(--text-muted); max-width: 70ch; }
.capi-subtitle { margin: 0 0 0.2rem; font-size: 0.88rem; color: var(--text-main); }
.capi-hint { margin: 0 0 0.5rem; font-size: 0.76rem; color: var(--text-muted); max-width: 80ch; }

.capi-alert { border-color: rgba(200, 85, 50, 0.4); background: rgba(200, 85, 50, 0.08); }
.capi-ok { border-color: rgba(46, 125, 70, 0.4); background: rgba(46, 125, 70, 0.08); }

.capi-config {
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--text-muted);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  margin-bottom: 0.7rem;
}

.capi-config.is-on { border-left-color: var(--accent-emerald); }
.capi-config.is-off { border-left-color: var(--accent-amber); }

.capi-config-state { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; }

.capi-dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--text-muted); }
.capi-dot.is-on { background: var(--accent-emerald); }
.capi-dot.is-off { background: var(--accent-amber); }

.capi-config-list {
  margin: 0.35rem 0 0;
  padding-left: 1.1rem;
  font-size: 0.76rem;
  color: var(--text-muted);
}

.capi-config-list em { color: var(--accent-amber); font-style: normal; }
.capi-test-warning { color: var(--accent-amber); }

.capi-stats { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.8rem; }

.capi-stat {
  display: flex;
  flex-direction: column;
  min-width: 96px;
  padding: 0.4rem 0.7rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--border-color);
  border-radius: var(--radius-md);
}

.capi-stat.is-sent { border-left-color: var(--accent-emerald); }
.capi-stat.is-error { border-left-color: var(--accent-rose); }
.capi-stat.is-skipped { border-left-color: var(--text-muted); }

.capi-stat-label { font-size: 0.68rem; color: var(--text-muted); }
.capi-stat-value { font-size: 1.05rem; font-weight: 700; color: var(--text-main); }
.capi-stats-note { margin: 0; font-size: 0.72rem; color: var(--text-muted); }

.capi-block { margin-top: 0.9rem; }
.capi-block-head { margin-bottom: 0.3rem; }

.capi-table td { vertical-align: middle; }
.capi-stage { display: block; font-size: 0.84rem; color: var(--text-main); }
.capi-stage-key { display: block; font-size: 0.7rem; color: var(--text-muted); }
.capi-input { width: 100%; max-width: 260px; font-size: 0.82rem; }
.capi-switch-col { white-space: nowrap; }
.capi-switch { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; cursor: pointer; }

.capi-actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; flex-wrap: wrap; }

.capi-log { list-style: none; margin: 0; padding: 0; }

.capi-log-item {
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 0.35rem;
  background: var(--surface-1);
}

.capi-log-item.is-enviado { border-left-color: var(--accent-emerald); }
.capi-log-item.is-error { border-left-color: var(--accent-rose); }
.capi-log-item.is-omitido { border-left-color: var(--text-muted); }

.capi-log-main { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: 0.82rem; }
.capi-log-lead { color: var(--text-muted); }
.capi-log-kind { font-size: 0.7rem; color: var(--text-muted); }
.capi-log-meta { font-size: 0.72rem; color: var(--text-muted); }
.capi-log-reason { margin: 0.15rem 0 0; font-size: 0.74rem; color: var(--accent-rose); }

.pill-danger { background: rgba(200, 85, 50, 0.18); color: var(--accent-rose); }
.pill-muted { background: var(--surface-2); color: var(--text-muted); }

@media (max-width: 760px) {
  .capi-header { flex-direction: column; }
  .capi-input { max-width: none; }

  .capi-table,
  .capi-table tbody,
  .capi-table tr,
  .capi-table td {
    display: block;
    width: 100%;
  }

  .capi-table thead { display: none; }

  .capi-table tr {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.6rem;
    margin-bottom: 0.5rem;
  }

  .capi-table td { border: none; padding: 0.2rem 0; }

  .capi-table td[data-label="Evento"]::before,
  .capi-table td[data-label="Reportar"]::before {
    content: attr(data-label);
    display: block;
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .capi-actions button { flex: 1 1 100%; }
}
</style>
