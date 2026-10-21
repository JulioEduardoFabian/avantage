<template>
  <main class="container-fluid webhook-page-wrapper">
    <header class="webhook-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">🔌</span> Integración con Meta
        </h2>
        <p class="section-subheading">
          Los dos sentidos de la conexión con Meta en una sola pantalla: lo que
          <strong>recibimos</strong> (los leads de sus formularios, por el webhook de
          <code>/api/webhooks/meta</code>) y lo que le <strong>devolvemos</strong> (en qué etapa
          terminó cada lead, por la Conversions API), que es lo que le permite optimizar por
          calidad de lead.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-secondary" @click="fetchEvents" :disabled="isLoading" title="Actualizar ahora">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando...' : 'Actualizar' }}
        </button>
        <button
          class="btn-action-secondary"
          @click="autoRefresh = !autoRefresh"
          :class="{ 'is-active-toggle': autoRefresh }"
          title="Refrescar automáticamente cada 4 segundos"
        >
          <span class="btn-icon">{{ autoRefresh ? '⏸️' : '▶️' }}</span>
          {{ autoRefresh ? 'Auto: ON' : 'Auto: OFF' }}
        </button>
        <button class="btn-action-ghost" @click="handleClear" :disabled="isClearing || events.length === 0">
          🗑️ Limpiar historial
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="info-box alert-box">⚠️ {{ errorMessage }}</p>

    <!-- Lo que le devolvemos a Meta. Va primero porque es lo que se configura y
         se revisa; el log de webhooks de abajo es una herramienta de diagnóstico
         que se mira cuando algo no llega. -->
    <MetaConversionsPanel />

    <h3 class="webhook-section-title">📥 Webhooks que recibimos</h3>

    <section class="info-box">
      <h4>📋 Cómo probarlo</h4>
      <ul>
        <li>En Meta: Productos → Webhooks → selecciona <strong>Page</strong> → junto a cualquier campo (p. ej. <code>leadgen</code> o <code>about</code>) haz clic en <strong>Test</strong> → <strong>Enviar a mi servidor</strong>.</li>
        <li>El evento debería aparecer abajo en pocos segundos (con "Auto: ON" activado).</li>
        <li>Solo los eventos con campo <code>leadgen</code> generan un prospecto real en la Base de Datos; los demás campos solo sirven para confirmar la conexión.</li>
      </ul>
    </section>

    <section v-if="!isLoading && events.length === 0" class="empty-state">
      <span class="empty-icon">📭</span>
      <p>Aún no se ha recibido ningún webhook.</p>
      <p class="empty-hint">Envía una prueba desde el panel de Meta y espera unos segundos.</p>
    </section>

    <section v-else class="events-list">
      <article v-for="event in events" :key="event.id" class="event-card">
        <header class="event-card-header">
          <div class="event-meta">
            <span class="event-time">{{ formatTime(event.receivedAt) }}</span>
            <span v-for="field in fieldsOf(event)" :key="field" class="field-badge">{{ field }}</span>
          </div>
          <span
            class="signature-badge"
            :class="signatureBadgeClass(event)"
          >{{ signatureBadgeText(event) }}</span>
        </header>
        <pre class="event-payload">{{ formatBody(event.body) }}</pre>
      </article>
    </section>
  </main>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import MetaConversionsPanel from '../components/MetaConversionsPanel.vue';

const events = ref([]);
const isLoading = ref(false);
const isClearing = ref(false);
const errorMessage = ref('');
const autoRefresh = ref(true);
let pollHandle = null;

async function fetchEvents() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/webhooks/meta/events');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener los eventos del webhook.');
    events.value = data.events || [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

async function handleClear() {
  isClearing.value = true;
  try {
    const response = await apiFetch('/api/webhooks/meta/events', { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo limpiar el historial.');
    events.value = [];
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isClearing.value = false;
  }
}

function fieldsOf(event) {
  const fields = new Set();
  for (const entry of event.body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field) fields.add(change.field);
    }
  }
  return [...fields];
}

function signatureBadgeClass(event) {
  if (!event.hasSecret) return 'badge-neutral';
  return event.signatureValid ? 'badge-ok' : 'badge-error';
}

function signatureBadgeText(event) {
  if (!event.hasSecret) return 'Sin verificar (META_APP_SECRET vacío)';
  return event.signatureValid ? '✅ Firma válida' : '❌ Firma inválida';
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function formatBody(body) {
  return JSON.stringify(body, null, 2);
}

onMounted(() => {
  fetchEvents();
  pollHandle = setInterval(() => {
    if (autoRefresh.value) fetchEvents();
  }, 4000);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});
</script>

<style scoped>
.webhook-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.webhook-header {
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

.section-subheading code {
  background: var(--surface-2);
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-size: 0.85em;
}

.header-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.btn-action-secondary,
.btn-action-ghost {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.6rem 1.1rem;
  font-size: 0.86rem;
  font-weight: 600;
  font-family: var(--font-heading);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  transition: all 0.2s ease;
}

.btn-action-secondary:hover:not(:disabled),
.btn-action-ghost:hover:not(:disabled) {
  background: var(--surface-3);
}

.btn-action-secondary:disabled,
.btn-action-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-action-secondary.is-active-toggle {
  border-color: var(--primary);
  color: var(--accent-cyan);
}

.spin-animation {
  display: inline-block;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.alert-box {
  border-color: rgba(239, 68, 68, 0.4);
  color: #E0717C;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-sub);
}

.empty-icon {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.75rem;
}

.empty-hint {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-top: 0.25rem;
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.event-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem 1.1rem;
}

.event-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.event-time {
  font-size: 0.82rem;
  color: var(--text-sub);
  font-family: var(--font-heading);
}

.field-badge {
  background: rgba(76, 134, 255, 0.15);
  color: var(--accent-cyan);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.signature-badge {
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.badge-neutral {
  background: var(--surface-2);
  color: var(--text-sub);
}

.badge-ok {
  background: rgba(34, 197, 94, 0.15);
  color: #5FBE79;
}

.badge-error {
  background: rgba(239, 68, 68, 0.15);
  color: #E0717C;
}

.event-payload {
  background: rgba(0, 0, 0, 0.35);
  border-radius: 10px;
  padding: 0.85rem 1rem;
  font-size: 0.78rem;
  color: var(--text-sub);
  overflow-x: auto;
  white-space: pre;
  font-family: var(--font-mono);
  margin: 0;
}

@media (max-width: 768px) {
  .webhook-page-wrapper {
    padding: 1rem;
  }
}

.webhook-section-title {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  color: var(--text-main);
}
</style>
