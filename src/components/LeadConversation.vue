<template>
  <aside class="lead-chat">
    <header class="lead-chat-head">
      <div class="lead-chat-who">
        <span class="lead-chat-title">💬 Conversación por WhatsApp</span>
        <span class="lead-chat-phone">{{ lead.phone || 'Sin teléfono' }}</span>
      </div>
      <button
        type="button"
        class="lead-chat-icon-btn"
        :disabled="loading"
        title="Actualizar la conversación"
        @click="load()"
      >
        <span :class="{ 'is-spinning': loading }">⟳</span>
      </button>
    </header>

    <!-- Quién está atendiendo. Es lo primero que hay que saber antes de
         escribir: si Avan sigue activo, los dos van a contestar a la vez. -->
    <div v-if="waId" class="lead-chat-bot-bar" :class="botPaused ? 'is-human' : 'is-bot'">
      <span class="lead-chat-bot-text">
        {{ botPaused ? '🙋 Lo atiendes tú — Avan está en pausa en este chat' : '🤖 Avan está atendiendo este chat' }}
      </span>
      <button
        type="button"
        class="lead-chat-bot-toggle"
        :disabled="togglingBot"
        :title="botPaused ? 'Devolverle la conversación a Avan' : 'Pausar Avan para atender tú'"
        @click="toggleBot"
      >
        {{ togglingBot ? '…' : (botPaused ? 'Reactivar Avan' : 'Pausar Avan') }}
      </button>
    </div>

    <div ref="scrollEl" class="lead-chat-scroll custom-scrollbar" @scroll="onScroll">
      <p v-if="error" class="lead-chat-note is-error">⚠️ {{ error }}</p>
      <p v-else-if="loading && !messages.length" class="lead-chat-note">Cargando conversación…</p>
      <p v-else-if="!messages.length" class="lead-chat-note">
        Todavía no hay mensajes con este contacto.
      </p>

      <template v-for="group in grouped" :key="group.day">
        <div class="lead-chat-day"><span>{{ group.label }}</span></div>
        <div
          v-for="msg in group.messages"
          :key="msg.id"
          class="lead-chat-bubble"
          :class="[msg.direction === 'outbound' ? 'is-out' : 'is-in', { 'from-bot': msg.direction === 'outbound' && !msg.sent_by }]"
        >
          <img
            v-if="msg.message_type === 'image' && mediaUrls[msg.id]"
            :src="mediaUrls[msg.id]"
            alt="Imagen enviada por WhatsApp"
            class="lead-chat-image"
          />
          <a
            v-else-if="msg.media_filename && mediaUrls[msg.id]"
            :href="mediaUrls[msg.id]"
            target="_blank"
            rel="noopener"
            class="lead-chat-attachment"
          >📎 Ver adjunto</a>
          <span
            v-if="msg.message_type === 'audio' && msg.body && msg.body !== '[Audio]'"
            class="lead-chat-tag"
            title="Transcrito automáticamente de una nota de voz"
          >🎤 Audio transcrito</span>
          <p
            v-if="msg.body && !(msg.media_filename && MEDIA_PLACEHOLDER_RE.test(msg.body))"
            class="lead-chat-text"
          >{{ msg.body }}</p>
          <span class="lead-chat-meta">
            {{ authorOf(msg) }} · {{ formatClock(msg.received_at) }}
            <span
              v-if="msg.direction === 'outbound' && msg.status === 'failed'"
              class="lead-chat-failed"
              title="WhatsApp no pudo entregar este mensaje"
            >· no entregado</span>
          </span>
        </div>
      </template>
    </div>

    <!-- Saltar al final: sin esto, leer el historial de un hilo largo obliga a
         arrastrar de vuelta hasta abajo para poder escribir con contexto. -->
    <button
      v-if="!stuckToBottom && messages.length"
      type="button"
      class="lead-chat-jump"
      @click="scrollToBottom(true)"
    >↓ Últimos mensajes</button>

    <form class="lead-chat-composer" @submit.prevent="send">
      <p v-if="!waId" class="lead-chat-blocked">
        Este contacto todavía no escribió por WhatsApp, así que no hay conversación abierta a la que responder.
      </p>
      <p v-else-if="!windowOpen" class="lead-chat-blocked">
        ⏳ Pasaron más de 24 h desde su último mensaje. WhatsApp ya no permite
        escribirle texto libre hasta que vuelva a escribir él.
      </p>
      <template v-else>
        <textarea
          v-model="draft"
          class="lead-chat-input"
          :maxlength="MAX_LENGTH"
          rows="2"
          placeholder="Escribe tu respuesta…  (Enter envía · Shift + Enter salta de línea)"
          :disabled="sending"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <div class="lead-chat-composer-foot">
          <span class="lead-chat-counter" :class="{ 'is-near': draft.length > MAX_LENGTH - 120 }">
            {{ draft.length }}/{{ MAX_LENGTH }}
          </span>
          <button type="submit" class="lead-chat-send" :disabled="sending || !draft.trim()">
            {{ sending ? 'Enviando…' : 'Enviar ➤' }}
          </button>
        </div>
      </template>
      <p v-if="sendError" class="lead-chat-note is-error">⚠️ {{ sendError }}</p>
    </form>
  </aside>
</template>

<script setup>
/**
 * La conversación de WhatsApp de un lead, dentro de su ficha — para leerla y
 * para RESPONDER.
 *
 * Es un componente y no el bloque que estaba copiado en los dos tableros
 * (Setter Funnel y Funnel de Ventas) porque ahora tiene estado de verdad: el
 * cuadro de respuesta, la ventana de 24 h, el autor de cada mensaje y la pausa
 * de Avan. Copiado dos veces, el día que se toque uno el otro se queda
 * contestando distinto.
 *
 * Pide `/api/leads/:id/whatsapp` y no la bandeja (`/api/whatsapp/...`) a
 * propósito: aquella exige `whatsapp.view`, que es TODAS las conversaciones de
 * todo el mundo, y el setter no la tiene — hasta ahora el panel le respondía
 * 403 y la conversación se veía vacía sin decir por qué.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { loadApiImage } from '../apiImage.js';

const props = defineProps({
  lead: { type: Object, required: true }
});

const MAX_LENGTH = 1000;
const MEDIA_PLACEHOLDER_RE = /^\[(Imagen|Video|Audio|Documento|Sticker)\]$/;
const POLL_MS = 12000;

const messages = ref([]);
const mediaUrls = reactive({});
const waId = ref(null);
const windowOpen = ref(false);
const botPaused = ref(false);
const loading = ref(false);
const error = ref('');
const draft = ref('');
const sending = ref(false);
const sendError = ref('');
const togglingBot = ref(false);
const scrollEl = ref(null);
const stuckToBottom = ref(true);
let timer = null;

/**
 * Los mensajes partidos por día, con el separador que faltaba.
 *
 * Un hilo que solo lleva la hora es ilegible en cuanto pasa de un día: "10:50"
 * arriba y "11:18" abajo pueden ser de hace un minuto o de hace tres semanas, y
 * de eso depende si lo que corresponde es contestar o volver a presentarse.
 */
const grouped = computed(() => {
  const groups = [];
  for (const msg of messages.value) {
    const day = dayKey(msg.received_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.messages.push(msg);
    else groups.push({ day, label: dayLabel(msg.received_at), messages: [msg] });
  }
  return groups;
});

function dayKey(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? 'sin-fecha' : d.toLocaleDateString('es-PE');
}

function dayLabel(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'Sin fecha';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatClock(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Quién mandó cada mensaje. Lo saliente ya no es todo de Avan: desde que se
 * responde desde la ficha, el hilo mezcla al bot, a quien mira y a sus
 * compañeros, y confundirlos es no saber si al lead ya le contestaron. Sin
 * autor guardado se dice "Avan", que es el otro caso real (los mensajes
 * anteriores a esta pantalla y los ecos de WhatsApp Business).
 */
function authorOf(msg) {
  if (msg.direction !== 'outbound') return 'Contacto';
  return msg.sent_by_name || 'Avan';
}

/*
 * El sondeo no puede arrastrar la vista: si alguien subió a releer el
 * historial, saltar al final cada 12 s hace imposible leerlo. Se mantiene
 * pegado abajo solo mientras ya estaba abajo.
 */
function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  stuckToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

async function scrollToBottom(force = false) {
  if (!force && !stuckToBottom.value) return;
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  stuckToBottom.value = true;
}

function releaseMedia(keepIds) {
  for (const key of Object.keys(mediaUrls)) {
    if (keepIds.has(Number(key))) continue;
    URL.revokeObjectURL(mediaUrls[key]);
    delete mediaUrls[key];
  }
}

async function hydrateMedia(list) {
  const withMedia = list.filter((m) => m.media_filename);
  releaseMedia(new Set(withMedia.map((m) => m.id)));
  for (const msg of withMedia) {
    if (mediaUrls[msg.id]) continue;
    const url = await loadApiImage(`/api/leads/${props.lead.id}/whatsapp/media/${msg.id}`);
    if (url) mediaUrls[msg.id] = url;
  }
}

async function load() {
  if (!props.lead?.id) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await apiFetch(`/api/leads/${props.lead.id}/whatsapp`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo obtener la conversación.');
    waId.value = data.waId;
    windowOpen.value = !!data.windowOpen;
    botPaused.value = !!data.botPaused;
    messages.value = data.messages || [];
    await hydrateMedia(messages.value);
    await scrollToBottom();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  sendError.value = '';
  try {
    const response = await apiFetch(`/api/leads/${props.lead.id}/whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo enviar el mensaje.');
    draft.value = '';
    // El mensaje recién mandado se agrega a mano en vez de esperar al sondeo:
    // doce segundos de silencio después de apretar Enviar se leen como que no
    // salió, y la respuesta ya trae la fila guardada.
    if (data.message) messages.value = [...messages.value, data.message];
    // Responder a mano pausa Avan en el servidor; la barra de arriba lo
    // refleja sin tener que recargar nada.
    botPaused.value = true;
    stuckToBottom.value = true;
    await scrollToBottom(true);
  } catch (err) {
    sendError.value = err.message;
  } finally {
    sending.value = false;
  }
}

async function toggleBot() {
  if (togglingBot.value) return;
  togglingBot.value = true;
  sendError.value = '';
  try {
    const response = await apiFetch(`/api/leads/${props.lead.id}/whatsapp/bot`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: botPaused.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado de Avan.');
    botPaused.value = !!data.botPaused;
  } catch (err) {
    sendError.value = err.message;
  } finally {
    togglingBot.value = false;
  }
}

function stopPolling() {
  if (timer) { clearInterval(timer); timer = null; }
}

watch(() => props.lead?.id, (id) => {
  stopPolling();
  messages.value = [];
  error.value = '';
  sendError.value = '';
  draft.value = '';
  waId.value = null;
  stuckToBottom.value = true;
  releaseMedia(new Set());
  if (!id) return;
  load();
  timer = setInterval(load, POLL_MS);
}, { immediate: true });

onBeforeUnmount(() => {
  stopPolling();
  releaseMedia(new Set());
});
</script>

<style scoped>
.lead-chat {
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* ---- Cabecera ---- */
.lead-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: var(--surface-2, var(--surface-1));
  border-bottom: 1px solid var(--border-color);
}

.lead-chat-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.lead-chat-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main);
}

.lead-chat-phone {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.lead-chat-icon-btn {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  border-radius: 8px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
}

.lead-chat-icon-btn:hover:not(:disabled) { color: var(--text-main); }
.lead-chat-icon-btn:disabled { opacity: 0.5; cursor: default; }

.is-spinning {
  display: inline-block;
  animation: lead-chat-spin 0.9s linear infinite;
}

@keyframes lead-chat-spin { to { transform: rotate(360deg); } }

/* ---- Quién atiende ---- */
.lead-chat-bot-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  font-size: 0.72rem;
  border-bottom: 1px solid var(--border-color);
}

.lead-chat-bot-bar.is-bot { background: rgba(47, 125, 90, 0.1); }
.lead-chat-bot-bar.is-human { background: rgba(201, 146, 46, 0.14); }

.lead-chat-bot-text {
  color: var(--text-main);
  min-width: 0;
}

.lead-chat-bot-toggle {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
}

.lead-chat-bot-toggle:hover:not(:disabled) { background: var(--surface-1); }
.lead-chat-bot-toggle:disabled { opacity: 0.6; cursor: default; }

/* ---- Hilo ---- */
.lead-chat-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 12rem;
  max-height: 46vh;
  background: radial-gradient(circle at 20% 10%, rgba(47, 125, 90, 0.06), transparent 60%);
}

.lead-chat-note {
  color: var(--text-muted);
  font-size: 0.82rem;
  text-align: center;
  margin: auto;
}

.lead-chat-note.is-error { color: #B23A45; }

.lead-chat-day {
  align-self: center;
  margin: 0.35rem 0 0.1rem;
}

.lead-chat-day span {
  display: inline-block;
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  font-size: 0.66rem;
  font-weight: 600;
  text-transform: capitalize;
}

.lead-chat-bubble {
  max-width: 85%;
  padding: 0.45rem 0.7rem;
  border-radius: 12px;
  font-size: 0.83rem;
  line-height: 1.4;
  word-break: break-word;
}

.lead-chat-bubble.is-in {
  align-self: flex-start;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-bottom-left-radius: 4px;
}

/*
 * Lo que escribió una persona va en verde lleno y lo del bot en un verde
 * apagado con un filete al costado: los dos salen "de nosotros", así que
 * siguen del mismo lado del hilo, pero de un vistazo se ve cuál de los dos
 * habló por última vez — que es lo que decide si hay que contestar.
 */
.lead-chat-bubble.is-out {
  align-self: flex-end;
  background: #2F7D5A;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.lead-chat-bubble.is-out.from-bot {
  background: #56624A;
  border-right: 3px solid #8FB996;
}

.lead-chat-text {
  margin: 0;
  white-space: pre-wrap;
}

.lead-chat-image {
  display: block;
  max-width: 100%;
  max-height: 18rem;
  border-radius: 0.5rem;
  margin-bottom: 0.25rem;
}

.lead-chat-attachment {
  display: inline-block;
  color: inherit;
  text-decoration: underline;
  margin-bottom: 0.25rem;
}

.lead-chat-tag {
  display: block;
  font-size: 0.65rem;
  opacity: 0.65;
  margin-bottom: 0.15rem;
}

.lead-chat-meta {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.66rem;
  opacity: 0.75;
}

.lead-chat-failed {
  color: #FFD5D5;
  font-weight: 700;
}

.lead-chat-bubble.is-in .lead-chat-failed { color: #B23A45; }

.lead-chat-jump {
  position: absolute;
  right: 1rem;
  bottom: 7.5rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: 999px;
  padding: 0.2rem 0.7rem;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}

/* ---- Responder ---- */
.lead-chat-composer {
  flex: 0 0 auto;
  border-top: 1px solid var(--border-color);
  padding: 0.6rem 0.75rem 0.7rem;
  background: var(--surface-2, var(--surface-1));
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.lead-chat-blocked {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.lead-chat-input {
  width: 100%;
  resize: vertical;
  min-height: 2.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-card-solid);
  color: var(--text-main);
  font-family: inherit;
  font-size: 0.83rem;
  line-height: 1.4;
}

.lead-chat-input:focus {
  outline: none;
  border-color: #2F7D5A;
}

.lead-chat-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.lead-chat-counter {
  font-size: 0.66rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.lead-chat-counter.is-near { color: #C9922E; font-weight: 700; }

.lead-chat-send {
  background: #2F7D5A;
  border: none;
  color: #fff;
  border-radius: 999px;
  padding: 0.35rem 1rem;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
}

.lead-chat-send:hover:not(:disabled) { background: #26694B; }
.lead-chat-send:disabled { opacity: 0.5; cursor: default; }

@media (max-width: 900px) {
  .lead-chat-scroll { max-height: 38vh; }
}
</style>
