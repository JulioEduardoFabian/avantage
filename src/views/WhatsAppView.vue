<template>
  <main class="container-fluid whatsapp-page-wrapper">
    <header class="whatsapp-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">💚</span> WhatsApp
        </h2>
        <p class="section-subheading">
          Conversaciones con tus clientes vía WhatsApp Business Platform,
          recibidas en <code>/api/webhooks/whatsapp</code>.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-secondary" @click="fetchAll()" :disabled="isLoading" title="Actualizar ahora">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando...' : 'Actualizar' }}
        </button>
        <button
          class="btn-action-secondary"
          @click="autoRefresh = !autoRefresh"
          :class="{ 'is-active-toggle': autoRefresh }"
        >
          <span class="btn-icon">{{ autoRefresh ? '⏸️' : '▶️' }}</span>
          {{ autoRefresh ? 'Auto: ON' : 'Auto: OFF' }}
        </button>
        <button class="btn-action-secondary" @click="openActivity" title="Ver la bitácora del bot">
          <span class="btn-icon">📊</span>
          Actividad del bot
          <span v-if="botActivity.length" class="btn-count">{{ botActivity.length }}</span>
        </button>
        <button class="btn-action-secondary" @click="openDeletionsLog" title="Ver qué conversaciones se eliminaron y quién lo hizo">
          <span class="btn-icon">🗑️</span>
          Eliminadas
          <span v-if="deletionsLog.length" class="btn-count">{{ deletionsLog.length }}</span>
        </button>
        <div class="download-group">
          <input
            type="date"
            class="date-input"
            v-model="exportDate"
            :max="limaToday"
            title="Elige el día de las conversaciones a descargar"
          />
          <button
            class="btn-action-secondary"
            @click="downloadConversations"
            :disabled="isDownloading || !exportDate"
            :title="`Descargar todas las conversaciones del ${exportDateLabel} en un archivo .txt`"
          >
            <span class="btn-icon">⬇️</span>
            {{ isDownloading ? 'Generando...' : `Descargar conversaciones ${isExportToday ? 'de hoy' : 'del ' + exportDateLabel}` }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="errorMessage" class="info-box alert-box">⚠️ {{ errorMessage }}</p>
    <p v-if="resetMessage" class="info-box success-box">✅ {{ resetMessage }}</p>

    <!-- Stats -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper green">💬</div>
        <div class="stat-info">
          <span class="stat-label">Mensajes totales</span>
          <span class="stat-value">{{ stats.total || 0 }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper blue">👤</div>
        <div class="stat-info">
          <span class="stat-label">Contactos distintos</span>
          <span class="stat-value">{{ stats.contacts || 0 }}</span>
        </div>
      </div>
    </section>

    <!-- Simulador de prueba del bot + LLM -->
    <h3 class="subsection-title">🧪 Simulador de prueba (bot + LLM de Ollama Cloud)</h3>
    <section class="info-box">
      <p>
        Simula mensajes entrantes de un contacto sin depender del webhook real de Meta ni del envío
        por WhatsApp. Útil para ver que el agrupado de 5 segundos y la llamada al LLM funcionan.
        Usa un <strong>wa_id de prueba</strong> (no un número real) para no mezclarlo con leads reales.
      </p>
    </section>
    <section class="simulator-panel">
      <form class="simulator-form" @submit.prevent="sendSimulatedMessage">
        <div class="simulator-field">
          <label class="field-label">wa_id de prueba</label>
          <input v-model="simWaId" type="text" class="form-input-sm" placeholder="test-12345" />
        </div>
        <div class="simulator-field simulator-field-grow">
          <label class="field-label">Mensaje a simular</label>
          <input
            v-model="simText"
            type="text"
            class="form-input-sm"
            placeholder="Ej: hola, quiero saber sobre mi tesis"
            @keydown.enter.prevent="sendSimulatedMessage"
          />
        </div>
        <button type="submit" class="btn-send" :disabled="isSimulating || !simText.trim() || !simWaId.trim()">
          {{ isSimulating ? 'Enviando...' : '📤 Simular mensaje' }}
        </button>
        <button type="button" class="btn-action-secondary" @click="resetSimWaId">🆕 Nuevo wa_id de prueba</button>
      </form>

      <div class="simulator-history" v-if="simMessagesSent.length">
        <span class="preview-label">Mensajes simulados enviados a <code>{{ simWaId }}</code>:</span>
        <div class="sim-message-chips">
          <span v-for="(m, i) in simMessagesSent" :key="i" class="sim-message-chip">{{ m }}</span>
        </div>
      </div>
    </section>

    <!-- Actividad del bot: vive en un modal en vez de ocupar media página. La
         bitácora se consulta cuando algo no cuadra, no todo el tiempo, y
         teniéndola aquí abajo el chat quedaba fuera de pantalla. -->
    <Teleport to="body">
      <div v-if="isActivityOpen" class="activity-backdrop" @click.self="closeActivity">
        <section class="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-modal-title">
          <header class="activity-modal-header">
            <div class="activity-modal-titles">
              <h3 id="activity-modal-title" class="activity-modal-title">Actividad del bot</h3>
              <p class="activity-modal-sub">Lo que Avan recibe, le pregunta al LLM y responde, turno por turno.</p>
            </div>
            <label v-if="selectedWaId" class="activity-filter">
              <input type="checkbox" v-model="activityOnlySelected" />
              Solo {{ selectedContactName }}
            </label>
            <button type="button" class="btn-thread-action" @click="clearActivity">Limpiar bitácora</button>
            <button type="button" class="btn-modal-close" @click="closeActivity" aria-label="Cerrar">✕</button>
          </header>

          <div class="activity-modal-body">
            <p v-if="filteredActivity.length === 0" class="activity-empty">
              Sin actividad registrada. Escríbele al número de WhatsApp conectado o usa el simulador para ver aquí cada turno.
            </p>
            <article v-for="entry in filteredActivity" :key="entry.id" class="activity-card" :class="activityClass(entry.type)">
        <header class="activity-card-header">
          <span class="activity-type">{{ activityIcon(entry.type) }} {{ activityLabel(entry.type) }}</span>
          <span class="activity-wa">{{ entry.waId }}</span>
          <span class="activity-time">{{ formatTime(entry.at) }}</span>
        </header>

        <p v-if="entry.type === 'buffer'" class="activity-text">
          "{{ entry.text }}" <span class="activity-hint">(burbuja #{{ entry.bufferSize }}, esperando {{ entry.waitMs / 1000 }}s de silencio)</span>
        </p>
        <p v-else-if="entry.type === 'llm_request'" class="activity-text">
          <span class="activity-hint">Prompt enviado a {{ entry.model }} ({{ entry.host }}):</span><br />
          "{{ entry.prompt }}"
        </p>
        <p v-else-if="entry.type === 'llm_response'" class="activity-text">
          "{{ entry.text }}"
          <span class="activity-hint">
            (fuente: {{ entry.source === 'llm' ? 'Ollama Cloud LLM' : 'respaldo fijo' }}, {{ entry.latencyMs }}ms)
          </span>
        </p>
        <p v-else-if="entry.type === 'send_success'" class="activity-text">"{{ entry.text }}"</p>
        <p v-else-if="entry.type === 'send_failed'" class="activity-text">
          "{{ entry.text }}"<br />
          <span class="activity-error">❌ {{ entry.error }}</span>
        </p>
        <p v-else-if="entry.type === 'conversation_turn_failed'" class="activity-text">
          <span class="activity-error">❌ {{ entry.error }}</span>
        </p>
        <p v-else-if="entry.type === 'scheduling_offer_skipped'" class="activity-text">
          <span class="activity-error">🚫 {{ entry.reason }}</span>
        </p>
        <p v-else-if="entry.type === 'skipped'" class="activity-text">
          "{{ entry.text }}"<br />
          <span class="activity-error">🚫 {{ entry.reason }}</span>
        </p>
        <p v-else-if="entry.type === 'scheduling_aside'" class="activity-text">
          "{{ entry.text }}"<br />
          <span class="activity-hint">
            Paso: {{ entry.status }} · ¿trae el dato del paso?: {{ entry.answersStep ? 'sí' : 'no' }} ·
            ¿pregunta aparte?: {{ entry.isAside ? 'sí' : 'no' }}
          </span>
          <template v-if="entry.answer"><br />💬 "{{ entry.answer }}"</template>
        </p>
        <p v-else-if="entry.type === 'scheduling_aside_failed'" class="activity-text">
          "{{ entry.text }}"<br />
          <span class="activity-error">⚠️ {{ entry.error }} — el paso siguió su curso normal.</span>
        </p>
        <p v-else-if="entry.type === 'scheduling_fast_track'" class="activity-text activity-hint">
          "{{ entry.text }}"<br />
          Pidió agendar, así que se pasa directo a proponer la reunión sin seguir preguntando datos.
          <template v-if="entry.when"><br />🕐 Momento que indicó: "{{ entry.when }}"</template>
        </p>
        <p v-else-if="entry.type === 'exact_time_booked'" class="activity-text activity-hint">
          Pidió "{{ entry.when }}" y ese bloque estaba libre, así que se agendó <strong>{{ entry.slot }}</strong>
          sin ofrecerle una lista para volver a elegir.
        </p>
        <p v-else-if="entry.type === 'buffer_extended'" class="activity-text activity-hint">
          "{{ entry.text }}" es solo un saludo, así que se esperan {{ Math.round(entry.waitMs / 1000) }} s más
          por el mensaje real en vez de gastar un turno respondiéndolo.
        </p>
        <p v-else-if="entry.type === 'redundant_question_fixed'" class="activity-text activity-hint">
          El LLM preguntó por la {{ entry.asked === 'field' ? 'carrera' : 'universidad' }}, que el contacto ya había dado:
          "{{ entry.original }}"<br />
          <template v-if="entry.replacement">Se envió en su lugar: "{{ entry.replacement }}"</template>
          <template v-else>Ya estaban los tres datos, así que se pasó a proponer la reunión.</template>
        </p>
        <p v-else-if="entry.type === 'preferred_when_captured'" class="activity-text activity-hint">
          Dijo "{{ entry.when }}" en el paso <strong>{{ entry.status }}</strong>. Se guarda para no volver a
          preguntarle el día cuando toque elegir horario.
        </p>
        <p v-else-if="entry.type === 'preferred_when_failed'" class="activity-text">
          <span class="activity-error">⚠️ No se pudo interpretar "{{ entry.when }}": {{ entry.error }}. Se le preguntó el día igual.</span>
        </p>
        <p v-else-if="entry.type === 'turn_superseded'" class="activity-text activity-hint">
          El contacto siguió escribiendo mientras se preparaba esta respuesta, así que no se envió:
          "{{ entry.reply }}". Responde el turno siguiente, ya con todo lo que escribió.
        </p>
        <p v-else-if="entry.type === 'reset'" class="activity-text activity-hint">
          El estado del bot para este contacto se borró; su próximo mensaje se procesará como si fuera nuevo.
        </p>
        <p v-else-if="entry.type === 'university_resolved'" class="activity-text activity-hint">
          Universidad "{{ entry.raw }}" →
          <template v-if="entry.confident"><strong>{{ entry.resolved }}</strong> (nombre oficial resuelto por el LLM)</template>
          <template v-else>se guardó tal cual: la sigla es ambigua o no se reconoció, mejor no "corregirla"</template>
        </p>
        <p v-else-if="entry.type === 'university_resolve_failed'" class="activity-text">
          <span class="activity-error">⚠️ No se pudo normalizar la universidad "{{ entry.raw }}": {{ entry.error }}. Se guardó tal cual.</span>
        </p>
        <p v-else-if="entry.type === 'price_insist_shortcut'" class="activity-text activity-hint">
          El contacto preguntó por el precio {{ entry.priceAsks }} veces. En vez de repetir la explicación,
          <template v-if="entry.hasProblem">se pasa directo a proponerle la reunión con el asesor.</template>
          <template v-else>se le transfiere a un asesor (todavía no había dado su tema).</template>
        </p>
        <p v-else-if="entry.type === 'redundant_message_suppressed'" class="activity-text activity-hint">
          El LLM iba a reenviar casi el mismo mensaje anterior: "{{ entry.original }}"<br />
          <template v-if="entry.replacement">Se envió en su lugar: "{{ entry.replacement }}"</template>
          <template v-else>No se reenvió.</template>
        </p>
        <p v-else-if="entry.type === 'critical_signal'" class="activity-text">
          <span class="activity-error">🚨 {{ criticalSignalLabel(entry.signal) }}</span><br />
          Escribió: "{{ entry.text }}"<br />
          <span class="activity-hint">No pasó por el LLM: se le respondió reconociendo el problema y se transfirió a un asesor.</span>
        </p>
        <p v-else-if="entry.type === 'critical_signal_repeated'" class="activity-text activity-hint">
          Volvió a escribir "{{ entry.text }}" después de que ya se le transfirió por lo mismo.
          El bot no responde: ya está esperando a una persona.
        </p>
            </article>
          </div>
        </section>
      </div>
    </Teleport>

    <!-- Confirmación de eliminar conversación: la acción es irreversible, así
         que se pide un paso extra en vez de borrar directo al primer clic. -->
    <Teleport to="body">
      <div v-if="isDeleteConfirmOpen" class="activity-backdrop" @click.self="closeDeleteConfirm">
        <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <h3 id="delete-confirm-title" class="confirm-modal-title">🗑️ ¿Eliminar esta conversación?</h3>
          <p class="confirm-modal-text">
            Se borrarán todos los mensajes con <strong>{{ selectedContactName }}</strong> ({{ selectedWaId }}) y no se
            pueden recuperar. Quedará registrado que tú la eliminaste, visible en "Eliminadas".
          </p>
          <div class="confirm-modal-actions">
            <button type="button" class="btn-action-secondary" @click="closeDeleteConfirm" :disabled="isDeletingConversation">Cancelar</button>
            <button type="button" class="btn-thread-danger btn-confirm-delete" @click="deleteConversation" :disabled="isDeletingConversation">
              {{ isDeletingConversation ? 'Eliminando...' : 'Sí, eliminar' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>

    <!-- Registro de conversaciones eliminadas: quién las borró y cuándo. -->
    <Teleport to="body">
      <div v-if="isDeletionsLogOpen" class="activity-backdrop" @click.self="closeDeletionsLog">
        <section class="activity-modal" role="dialog" aria-modal="true" aria-labelledby="deletions-modal-title">
          <header class="activity-modal-header">
            <div class="activity-modal-titles">
              <h3 id="deletions-modal-title" class="activity-modal-title">Conversaciones eliminadas</h3>
              <p class="activity-modal-sub">Qué contacto se borró, cuántos mensajes tenía y qué usuario lo hizo.</p>
            </div>
            <button type="button" class="btn-modal-close" @click="closeDeletionsLog" aria-label="Cerrar">✕</button>
          </header>
          <div class="activity-modal-body">
            <p v-if="deletionsLog.length === 0" class="activity-empty">
              Todavía no se ha eliminado ninguna conversación.
            </p>
            <article v-for="entry in deletionsLog" :key="entry.id" class="activity-card activity-error-card">
              <header class="activity-card-header">
                <span class="activity-type">🗑️ {{ entry.contact_name || entry.wa_id }}</span>
                <span class="activity-wa">{{ entry.wa_id }}</span>
                <span class="activity-time">{{ formatTime(entry.deleted_at) }}</span>
              </header>
              <p class="activity-text">
                Eliminada por <strong>{{ entry.deleted_by_name || 'usuario desconocido' }}</strong>
                <span class="activity-hint">({{ entry.message_count }} {{ entry.message_count === 1 ? 'mensaje' : 'mensajes' }})</span>
              </p>
            </article>
          </div>
        </section>
      </div>
    </Teleport>

    <!-- Bandeja de conversaciones -->
    <h3 class="subsection-title">Conversaciones</h3>
    <section v-if="!isLoading && conversations.length === 0 && !contactSearch" class="empty-state">
      <div class="empty-state-visual">
        <img src="/images/empty_chat_state.jpg" alt="WhatsApp Inbox" class="empty-state-photo" />
      </div>
      <h4 class="empty-title">Aún no se han recibido conversaciones</h4>
      <p class="empty-subtitle">Envía un mensaje de prueba al número de WhatsApp Business conectado o usa el simulador de mensajes para interactuar con Avan.</p>
    </section>

    <section v-else class="whatsapp-inbox">
      <aside class="contacts-panel">
        <div class="contacts-panel-head">
          <p class="contacts-count">
            <template v-if="contactSearch">
              {{ conversationsTotal }} {{ conversationsTotal === 1 ? 'resultado' : 'resultados' }}
            </template>
            <template v-else-if="conversations.length < conversationsTotal">
              {{ conversations.length }} de {{ conversationsTotal }} conversaciones
            </template>
            <template v-else>
              {{ conversationsTotal }} {{ conversationsTotal === 1 ? 'conversación' : 'conversaciones' }}
            </template>
          </p>
          <div class="contact-search">
            <span class="contact-search-icon" aria-hidden="true">🔍</span>
            <input
              v-model="contactSearch"
              type="text"
              class="contact-search-input"
              placeholder="Buscar por nombre o número..."
            />
          </div>
        </div>

        <div ref="contactsListEl" class="contacts-list" @scroll.passive="onContactsScroll">
          <p v-if="conversations.length === 0 && !isLoadingConversations" class="contacts-empty">
            Sin resultados para "{{ contactSearch }}".
          </p>

          <button
            v-for="c in conversations"
            :key="c.wa_id"
            class="contact-item"
            :class="{ 'is-active': c.wa_id === selectedWaId, 'is-urgent': c.handed_off_at }"
            @click="selectConversation(c.wa_id)"
          >
            <span class="contact-avatar" :style="{ background: avatarColor(c.wa_id) }" aria-hidden="true">
              {{ initialsOf(displayName(c)) }}
            </span>
            <span class="contact-info">
              <span class="contact-name">
                <span v-if="c.handed_off_at" class="urgent-flag" title="Avan lo transfirió a un asesor">🆘</span>
                {{ displayName(c) }}
                <!-- El alias del perfil de WhatsApp, cuando no es el nombre
                     real: es como aparece en el celular de quien atiende. -->
                <span v-if="aliasOf(c)" class="contact-alias" :title="'En WhatsApp aparece como ' + aliasOf(c)">
                  {{ aliasOf(c) }}
                </span>
              </span>
              <span class="contact-preview">{{ c.direction === 'outbound' ? 'Tú: ' : '' }}{{ truncate(c.body, 42) }}</span>
            </span>
            <span class="contact-side">
              <span class="contact-time">{{ formatShortTime(c.received_at) }}</span>
              <span class="badge-row">
                <span v-if="c.is_form_lead" class="form-lead-badge" title="Llegó desde el formulario de un anuncio">
                  <Form :size="11" :stroke-width="2.25" />
                </span>
                <span class="channel-badge" :class="channelBadgeClass(c.origin_channel)" :title="c.origin_channel">
                  {{ channelIcon(c.origin_channel) }}
                </span>
              </span>
            </span>
          </button>

          <p v-if="isLoadingConversations" class="contacts-more">Cargando más…</p>
          <button
            v-else-if="conversationsHasMore"
            type="button"
            class="contacts-more contacts-more-btn"
            @click="fetchConversations({ append: true })"
          >Cargar más conversaciones</button>
          <p v-else-if="conversations.length > 0" class="contacts-more">No hay más conversaciones.</p>
        </div>
      </aside>

      <div class="thread-panel">
        <template v-if="selectedWaId">
          <header class="thread-header">
            <span class="thread-avatar" :style="{ background: avatarColor(selectedWaId) }" aria-hidden="true">
              {{ initialsOf(selectedContactName) }}
            </span>
            <div class="thread-identity">
              <strong class="thread-name">{{ selectedContactName }}</strong>
              <span class="thread-sub">
                <span class="thread-phone">{{ selectedWaId }}</span>
                <span
                  v-if="selectedConversation && aliasOf(selectedConversation)"
                  class="contact-alias"
                  title="Nombre de su perfil de WhatsApp"
                >{{ aliasOf(selectedConversation) }}</span>
                <span v-if="threadOriginChannel" class="channel-badge" :class="channelBadgeClass(threadOriginChannel)">
                  {{ channelIcon(threadOriginChannel) }} {{ threadOriginChannel }}
                </span>
              </span>
            </div>
            <span v-if="botSession" class="bot-status" :class="{ 'is-paused': !botSession.bot_enabled }" :title="botStatusHint">
              {{ botStatusIcon }} {{ botStatusLabel }}
            </span>
            <div class="thread-actions">
              <div class="thread-actions-group">
                <button type="button" class="btn-thread-action" @click="toggleBot">
                  {{ botSession?.bot_enabled ? '⏸️ Pausar bot' : '▶️ Activar bot' }}
                </button>
                <button type="button" class="btn-thread-action" @click="resetBotSession" title="Borra el estado del bot para este contacto: su próximo mensaje se procesará como si fuera nuevo.">
                  ↺ Reiniciar
                </button>
                <button
                  v-if="botSession?.status === 'scheduling_email'"
                  type="button"
                  class="btn-thread-action"
                  :disabled="forcingBook"
                  title="El contacto ya eligió horario pero no dio un correo válido (p. ej. mandó un audio que el bot no puede escuchar). Agenda igual, sin invitación por correo — el link de Meet le llega por WhatsApp."
                  @click="forceBookPendingSlot"
                >{{ forcingBook ? 'Agendando…' : '📅 Agendar sin correo' }}</button>
              </div>
              <button type="button" class="btn-thread-action btn-thread-danger" @click="openDeleteConfirm" title="Elimina esta conversación por completo. Queda registrado quién la eliminó.">
                🗑️ Eliminar
              </button>
            </div>
          </header>

          <div class="thread-body">
            <div class="thread-messages" ref="threadScrollEl" @scroll.passive="onThreadScroll">
              <div v-if="threadReferral" class="ad-referral-wrap">
                <span class="ad-referral-opened">Conversación abierta · {{ formatTime(threadReferralAt) }}</span>
                <div class="ad-referral-card">
                  <img v-if="threadReferral.image_url" :src="threadReferral.image_url" alt="" class="ad-referral-image" />
                  <div class="ad-referral-body">
                    <div class="ad-referral-header">
                      <strong class="ad-referral-title">
                        {{ channelIcon(threadOriginChannel) }}
                        {{ threadReferral.source_type === 'post' ? 'Publicación de Meta' : threadOriginChannel }}
                      </strong>
                      <a
                        v-if="threadReferral.source_url"
                        :href="threadReferral.source_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ad-referral-link"
                      >Ver anuncio ↗</a>
                    </div>
                    <p v-if="threadReferral.headline" class="ad-referral-headline">{{ threadReferral.headline }}</p>
                  </div>
                </div>
              </div>

              <template v-for="group in threadGroups" :key="group.key">
                <p class="day-divider"><span class="day-chip">{{ group.label }}</span></p>
                <div v-for="run in group.runs" :key="run.key" class="msg-run" :class="run.direction">
                  <article
                    v-for="(msg, i) in run.messages"
                    :key="msg.id"
                    class="bubble"
                    :class="[run.direction, { 'is-last': i === run.messages.length - 1, 'is-failed': msg.status === 'failed' }]"
                  >
                    <img
                      v-if="msg.message_type === 'image' && mediaUrls[msg.id]"
                      :src="mediaUrls[msg.id]"
                      alt="Imagen enviada por WhatsApp"
                      class="bubble-image"
                    />
                    <a
                      v-else-if="msg.media_filename && mediaUrls[msg.id]"
                      :href="mediaUrls[msg.id]"
                      target="_blank"
                      rel="noopener"
                      class="bubble-attachment-link"
                    >📎 Ver adjunto</a>
                    <span v-if="msg.message_type === 'audio' && msg.body && msg.body !== '[Audio]'" class="bubble-audio-tag" title="Transcrito automáticamente de una nota de voz">🎤 Audio transcrito</span>
                    <p v-if="msg.body && !(msg.media_filename && MEDIA_BODY_PLACEHOLDER_RE.test(msg.body))" class="bubble-text">{{ msg.body }}</p>
                    <span class="bubble-meta">
                      <span class="bubble-time">{{ formatClock(msg.received_at) }}</span>
                      <span
                        v-if="msg.direction === 'outbound'"
                        class="bubble-tick"
                        :class="tickClass(msg.status)"
                        :title="msg.status_error || statusLabel(msg.status)"
                      >{{ statusTick(msg.status) }}</span>
                    </span>
                    <p v-if="msg.status === 'failed' && msg.status_error" class="bubble-error">⚠️ {{ msg.status_error }}</p>
                  </article>
                </div>
              </template>
            </div>

            <button
              v-if="!isPinnedToBottom"
              type="button"
              class="jump-latest"
              @click="scrollThreadToBottom({ smooth: true })"
            >
              {{ unseenCount ? `${unseenCount} ${unseenCount === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}` : 'Ir al final' }}
              <span aria-hidden="true">↓</span>
            </button>
          </div>

          <form class="reply-box" @submit.prevent="sendReply">
            <textarea
              v-model="replyText"
              class="reply-input"
              placeholder="Escribe una respuesta..."
              rows="1"
              @keydown.enter.exact.prevent="sendReply"
            ></textarea>
            <button type="submit" class="btn-send" :disabled="isSending || !replyText.trim()" title="Enviar (Enter)">
              <span v-if="isSending">Enviando…</span>
              <span v-else>Enviar <span aria-hidden="true">➤</span></span>
            </button>
          </form>
        </template>

        <div v-else class="thread-placeholder">
          <div class="thread-placeholder-card">
            <img src="/images/empty_chat_state.jpg" alt="" class="thread-placeholder-img" />
            <h4 class="thread-placeholder-title">Elige una conversación</h4>
            <p class="thread-placeholder-desc">Los mensajes aparecen aquí en vivo. Puedes responder tú o dejar que Avan siga atendiendo.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Prueba de conexión cruda -->
    <h3 class="subsection-title">🔌 Prueba de conexión (eventos crudos)</h3>
    <section v-if="!isLoading && rawEvents.length === 0" class="empty-state small">
      <p>Sin eventos de prueba todavía. Usa el botón "Test" en Meta → WhatsApp → Webhooks.</p>
    </section>
    <section v-else class="events-list">
      <article v-for="event in rawEvents" :key="event.id" class="event-card">
        <header class="event-card-header">
          <span class="event-time">{{ formatTime(event.receivedAt) }}</span>
          <span class="signature-badge" :class="signatureBadgeClass(event)">{{ signatureBadgeText(event) }}</span>
        </header>
        <pre class="event-payload">{{ formatBody(event.body) }}</pre>
      </article>
    </section>
  </main>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, computed, ref, reactive, watch } from 'vue';
import { apiFetch } from '../apiClient.js';
import { loadApiImage } from '../apiImage.js';
import { Form } from 'lucide-vue-next';

const conversations = ref([]);
const contactSearch = ref('');
/** Cuántas hay en total según el servidor (no cuántas se alcanzaron a cargar). */
const conversationsTotal = ref(0);
/** `{ lastAt, waId }` de la última cargada: por ahí sigue la próxima página. */
const conversationsCursor = ref(null);
const conversationsHasMore = ref(false);
const isLoadingConversations = ref(false);
const contactsListEl = ref(null);
const stats = ref({ total: 0, contacts: 0 });
const rawEvents = ref([]);
const isLoading = ref(false);
const errorMessage = ref('');
const resetMessage = ref('');
const autoRefresh = ref(true);

const selectedWaId = ref(null);
const thread = ref([]);
const mediaUrls = reactive({});
const replyText = ref('');
const isSending = ref(false);
const forcingBook = ref(false);
const threadScrollEl = ref(null);
const botSession = ref(null);

const isPinnedToBottom = ref(true);
const unseenCount = ref(0);
const isActivityOpen = ref(false);
const activityOnlySelected = ref(true);

const isDeleteConfirmOpen = ref(false);
const isDeletingConversation = ref(false);
const isDeletionsLogOpen = ref(false);
const deletionsLog = ref([]);

const botActivity = ref([]);
const simWaId = ref(`test-${Math.floor(100000 + Math.random() * 900000)}`);
const simText = ref('');
const isSimulating = ref(false);
const simMessagesSent = ref([]);
const isDownloading = ref(false);

/**
 * Fecha (calendario de Lima) cuyas conversaciones se van a exportar. Se puede
 * cambiar con el selector del header; arranca en "hoy" porque es el caso
 * habitual. Perú es UTC-5 todo el año, así que "hoy" se calcula en esa zona y
 * no en la del navegador, para que coincida con lo que agrupa el backend.
 */
const limaToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const exportDate = ref(limaToday);
const isExportToday = computed(() => exportDate.value === limaToday);
const exportDateLabel = computed(() => {
  if (!exportDate.value) return '';
  const [y, m, d] = exportDate.value.split('-');
  return `${d}/${m}/${y}`;
});

let pollHandle = null;

const ACTIVITY_META = {
  buffer: { icon: '📥', label: 'Mensaje agrupado', className: 'activity-buffer' },
  llm_request: { icon: '🧠', label: 'Petición al LLM', className: 'activity-llm' },
  llm_response: { icon: '💬', label: 'Respuesta del LLM', className: 'activity-llm' },
  send_success: { icon: '✅', label: 'Enviado por WhatsApp', className: 'activity-ok' },
  send_failed: { icon: '❌', label: 'Falló el envío por WhatsApp', className: 'activity-error-card' },
  conversation_turn_failed: { icon: '⚠️', label: 'Error en el turno de conversación', className: 'activity-error-card' },
  scheduling_offer_skipped: { icon: '📅', label: 'No se ofreció agendar', className: 'activity-error-card' },
  skipped: { icon: '🚫', label: 'El bot ignoró el mensaje', className: 'activity-error-card' },
  reset: { icon: '🔄', label: 'Conversación reiniciada', className: 'activity-ok' },
  scheduling_aside: { icon: '🙋', label: 'Pregunta durante el agendamiento', className: 'activity-llm' },
  scheduling_aside_failed: { icon: '⚠️', label: 'No se pudo revisar si había una pregunta', className: 'activity-error-card' },
  turn_superseded: { icon: '⏭️', label: 'Turno descartado (siguió escribiendo)', className: 'activity-buffer' },
  scheduling_fast_track: { icon: '⚡', label: 'Pidió agendar: se salta a la reunión', className: 'activity-ok' },
  preferred_when_failed: { icon: '⚠️', label: 'No se pudo interpretar el día/hora que pidió', className: 'activity-error-card' },
  preferred_when_captured: { icon: '🕐', label: 'Anotado el día/hora que pidió', className: 'activity-ok' },
  redundant_question_fixed: { icon: '🛡️', label: 'Se corrigió una pregunta repetida', className: 'activity-ok' },
  redundant_message_suppressed: { icon: '🛡️', label: 'Se evitó reenviar el mismo mensaje', className: 'activity-ok' },
  university_resolved: { icon: '🎓', label: 'Universidad normalizada por el LLM', className: 'activity-ok' },
  university_resolve_failed: { icon: '⚠️', label: 'No se pudo normalizar la universidad', className: 'activity-error-card' },
  price_insist_shortcut: { icon: '💸', label: 'Insistió con el precio: se ofrece el asesor', className: 'activity-ok' },
  buffer_extended: { icon: '⏳', label: 'Solo un saludo: se espera un poco más', className: 'activity-buffer' },
  exact_time_booked: { icon: '⚡', label: 'La hora que pidió estaba libre: se agendó directo', className: 'activity-ok' },
  critical_signal: { icon: '🚨', label: 'Mensaje delicado: se transfirió a un asesor', className: 'activity-error-card' },
  critical_signal_repeated: { icon: '🔕', label: 'Insistió tras la transferencia: el bot no responde', className: 'activity-hint' }
};

// Cómo se le explica al equipo cada señal crítica detectada (ver
// backend/services/leadSignals.js). El texto se escribe desde el punto de
// vista de quien va a retomar la conversación.
const CRITICAL_SIGNAL_LABELS = {
  noShow: 'Dice que se quedó esperando y el asesor no entró a la reunión.',
  complaint: 'Puso una queja sobre el servicio.',
  humanRequest: 'Pidió explícitamente hablar con una persona.',
  frustration: 'Se quejó de que el bot no lo entiende o le repite las preguntas.'
};

function criticalSignalLabel(signal) {
  return CRITICAL_SIGNAL_LABELS[signal] || 'Mensaje que necesita atención de una persona.';
}

function activityIcon(type) {
  return ACTIVITY_META[type]?.icon || '•';
}

function activityLabel(type) {
  return ACTIVITY_META[type]?.label || type;
}

function activityClass(type) {
  return ACTIVITY_META[type]?.className || '';
}

/**
 * Con qué nombre se muestra un contacto. Manda el que dio en el formulario
 * (`lead_name`) sobre el alias de su perfil de WhatsApp: alguien registrado
 * como "Franthz Gamarra" aparecía en la bandeja como "kevin" y no había forma
 * de encontrarlo buscándolo por su nombre.
 */
function displayName(conversation) {
  return conversation.lead_name || conversation.contact_name || conversation.wa_id;
}

/** El alias de WhatsApp, solo cuando aporta algo distinto al nombre mostrado. */
function aliasOf(conversation) {
  const alias = (conversation.contact_name || '').trim();
  if (!alias || !conversation.lead_name) return '';
  return alias.toLowerCase() === conversation.lead_name.trim().toLowerCase() ? '' : alias;
}

const selectedConversation = computed(
  () => conversations.value.find((c) => c.wa_id === selectedWaId.value) || null
);

const selectedContactName = computed(() => {
  const conv = selectedConversation.value;
  return conv ? displayName(conv) : selectedWaId.value;
});

/*
 * La búsqueda la resuelve el SERVIDOR (ver `/api/whatsapp/conversations`).
 * Filtrarla acá, sobre lo que ya estaba cargado, significaba "busca entre las
 * primeras 30": justo el contacto viejo que no se encuentra a mano es el que
 * se busca escribiendo. Se espera a que la persona deje de teclear para no
 * disparar una consulta por letra.
 */
let searchTimer = null;
watch(contactSearch, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchConversations({ reset: true }), 300);
});

/**
 * Color de avatar determinista por contacto (mismo wa_id → mismo color
 * siempre), tomado solo de los acentos ya definidos en la identidad de marca
 * — así la bandeja gana variedad visual sin salirse de la paleta "vivero".
 */
const AVATAR_COLORS = ['var(--primary)', 'var(--cta)', 'var(--accent-emerald)', 'var(--accent-pink)', 'var(--accent-cyan)', 'var(--accent-amber)'];
function avatarColor(id) {
  const str = String(id || '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const threadOriginChannel = computed(() => {
  const conv = conversations.value.find((c) => c.wa_id === selectedWaId.value);
  return conv?.origin_channel || null;
});

const threadReferralMessage = computed(() => thread.value.find((m) => m.direction === 'inbound' && m.referral) || null);

const threadReferral = computed(() => {
  const first = threadReferralMessage.value;
  if (!first) return null;
  try {
    return typeof first.referral === 'string' ? JSON.parse(first.referral) : first.referral;
  } catch {
    return null;
  }
});

const threadReferralAt = computed(() => threadReferralMessage.value?.received_at || null);

const SCHEDULING_STATUSES = new Set(['scheduling_date', 'scheduling_time']);

const botStatusIcon = computed(() => {
  if (!botSession.value) return '';
  if (botSession.value.status === 'completed') return '✅';
  if (botSession.value.status === 'frozen') return '🧊';
  if (SCHEDULING_STATUSES.has(botSession.value.status)) return '📅';
  if (botSession.value.status === 'warmup') return '🙋';
  return botSession.value.bot_enabled ? '🤖' : '⏸️';
});

const botStatusLabel = computed(() => {
  if (!botSession.value) return '';
  if (botSession.value.status === 'completed') return 'Avan completado';
  if (botSession.value.status === 'frozen') return 'Congelado por inactividad';
  if (!botSession.value.bot_enabled) return 'Bot pausado';
  if (botSession.value.status === 'scheduling_date') return 'Avan: preguntando qué día prefiere';
  if (botSession.value.status === 'scheduling_time') return 'Avan: eligiendo horario de llamada';
  if (botSession.value.status === 'warmup') return 'Avan: esperando el sí a la reunión';
  return 'Avan: conversando';
});

const botStatusHint = computed(() => {
  if (!botSession.value) return '';
  if (botSession.value.status === 'completed') return 'El contacto ya completó la conversación con Avan y se registró como lead.';
  if (botSession.value.status === 'frozen') return 'El contacto no respondió al recordatorio. Si vuelve a escribir, Avan retoma la conversación donde quedó.';
  if (SCHEDULING_STATUSES.has(botSession.value.status)) return 'Avan ya evaluó el tema y está coordinando el horario de la llamada con el contacto.';
  if (botSession.value.status === 'warmup') return 'Avan le propuso la reunión y espera su respuesta. Los horarios se le ofrecen recién cuando conteste.';
  return 'Avan está conversando automáticamente con este contacto.';
});

/**
 * Asigna solo si el contenido cambió de verdad. Sin esto, cada sondeo
 * reemplazaba los arrays enteros y Vue volvía a renderizar la bandeja y el
 * hilo aunque no hubiera nada nuevo (parpadeo y saltos de scroll).
 */
function assignIfChanged(target, next) {
  const serialized = JSON.stringify(next);
  if (JSON.stringify(target.value) !== serialized) target.value = next;
}

/** Cuántas conversaciones trae cada página de la bandeja. */
const CONVERSATIONS_PAGE_SIZE = 30;

/**
 * Una página de la bandeja.
 *
 *  - `reset`: empieza de cero (al entrar y al cambiar la búsqueda).
 *  - `append`: la siguiente página, que es lo que pide el scroll.
 *  - sin nada: el sondeo automático. Trae la primera página y la **mezcla**
 *    con lo que ya estaba cargado en vez de reemplazarlo: si no, cada cinco
 *    segundos el operador perdería todo lo que bajó.
 */
async function fetchConversations({ append = false, reset = false } = {}) {
  if (append && (!conversationsHasMore.value || isLoadingConversations.value)) return;
  if (append || reset) isLoadingConversations.value = true;

  try {
    const params = new URLSearchParams({ limit: String(CONVERSATIONS_PAGE_SIZE) });
    const termino = contactSearch.value.trim();
    if (termino) params.set('search', termino);
    if (append && conversationsCursor.value) {
      params.set('beforeAt', conversationsCursor.value.lastAt);
      params.set('beforeWaId', conversationsCursor.value.waId);
    }

    const response = await apiFetch(`/api/whatsapp/conversations?${params}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener las conversaciones.');

    const pagina = data.conversations || [];
    if (append) {
      const vistos = new Set(conversations.value.map((c) => c.wa_id));
      conversations.value = [...conversations.value, ...pagina.filter((c) => !vistos.has(c.wa_id))];
      conversationsHasMore.value = Boolean(data.hasMore);
    } else if (reset) {
      conversations.value = pagina;
      conversationsHasMore.value = Boolean(data.hasMore);
    } else {
      /*
       * Sondeo: la primera página manda sobre lo que ya había (una
       * conversación con un mensaje nuevo sube al tope), y el resto de lo
       * cargado queda debajo. No hace falta reordenar: la página 1 son las más
       * recientes del servidor, así que nada de lo de abajo puede ser más
       * nuevo que ellas.
       */
      const enPagina = new Set(pagina.map((c) => c.wa_id));
      const resto = conversations.value.filter((c) => !enPagina.has(c.wa_id));
      assignIfChanged(conversations, [...pagina, ...resto]);
    }

    if (data.total !== null && data.total !== undefined) conversationsTotal.value = data.total;

    /*
     * El cursor se recalcula SIEMPRE desde la última conversación cargada, no
     * desde el que devuelve la respuesta: el sondeo pide la primera página y
     * su cursor apunta a la conversación número 30, que es justo la que ya
     * tenemos. Con ese cursor, seguir bajando volvería a traer lo mismo.
     */
    const ultima = conversations.value[conversations.value.length - 1];
    conversationsCursor.value = ultima
      ? { lastAt: new Date(ultima.received_at).toISOString(), waId: ultima.wa_id }
      : null;

    // Si la primera página no llena el panel no hay scroll que disparar, y la
    // lista se quedaría corta con más conversaciones esperando.
    if (append || reset) await nextTick();
    fillContactsList();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoadingConversations.value = false;
  }
}

/** A qué distancia del fondo se pide la página siguiente. */
const CONTACTS_SCROLL_THRESHOLD_PX = 180;

function onContactsScroll() {
  const el = contactsListEl.value;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight <= CONTACTS_SCROLL_THRESHOLD_PX) {
    fetchConversations({ append: true });
  }
}

/** Sigue pidiendo mientras la lista no tenga nada que desplazar. */
function fillContactsList() {
  const el = contactsListEl.value;
  if (!el || !conversationsHasMore.value || isLoadingConversations.value) return;
  if (el.scrollHeight <= el.clientHeight) fetchConversations({ append: true });
}

async function fetchStats() {
  try {
    const response = await apiFetch('/api/whatsapp/messages?limit=1');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener las estadísticas.');
    assignIfChanged(stats, data.stats || { total: 0, contacts: 0 });
  } catch (error) {
    errorMessage.value = error.message;
  }
}

/**
 * A cuántos píxeles del fondo se sigue considerando que el operador está
 * "mirando lo último". Con margen: si se movió un poco pero sigue abajo,
 * bajarlo solo no le quita nada de vista.
 */
const SCROLL_PIN_TOLERANCE_PX = 80;

function onThreadScroll() {
  const el = threadScrollEl.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  isPinnedToBottom.value = distanceFromBottom <= SCROLL_PIN_TOLERANCE_PX;
  if (isPinnedToBottom.value) unseenCount.value = 0;
}

async function scrollThreadToBottom({ smooth = false } = {}) {
  await nextTick();
  const el = threadScrollEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  isPinnedToBottom.value = true;
  unseenCount.value = 0;
}

/** Deja de mostrar solo "[Imagen]"/"[Video]": para esos placeholders se intenta cargar el adjunto real. */
const MEDIA_BODY_PLACEHOLDER_RE = /^\[(Imagen|Video|Audio|Documento|Sticker)\]$/;

function releaseThreadMedia(keepIds) {
  for (const key of Object.keys(mediaUrls)) {
    if (keepIds.has(Number(key))) continue;
    URL.revokeObjectURL(mediaUrls[key]);
    delete mediaUrls[key];
  }
}

async function hydrateThreadMedia(messages) {
  const withMedia = messages.filter((m) => m.media_filename);
  releaseThreadMedia(new Set(withMedia.map((m) => m.id)));
  for (const msg of withMedia) {
    if (mediaUrls[msg.id]) continue;
    const url = await loadApiImage(`/api/whatsapp/messages/${msg.id}/media`);
    if (url) mediaUrls[msg.id] = url;
  }
}

async function fetchThread(waId, { scrollToBottom = false } = {}) {
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(waId)}/messages`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener el hilo.');

    // El sondeo trae mensajes nuevos cada pocos segundos. Si el operador está
    // mirando el final, la vista lo sigue sola; si subió a leer algo, no se le
    // arrastra la pantalla: se le avisa con el botón "mensajes nuevos".
    const previousCount = thread.value.length;
    assignIfChanged(thread, data.messages || []);
    const added = thread.value.length - previousCount;
    await hydrateThreadMedia(thread.value);

    if (scrollToBottom || isPinnedToBottom.value) await scrollThreadToBottom();
    else if (added > 0) unseenCount.value += added;
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function fetchBotSession(waId) {
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(waId)}/bot`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener el estado del bot.');
    assignIfChanged(botSession, data.session);
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function toggleBot() {
  if (!selectedWaId.value) return;
  const nextEnabled = !(botSession.value?.bot_enabled ?? false);
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(selectedWaId.value)}/bot`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: nextEnabled })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado del bot.');
    botSession.value = data.session;
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function resetBotSession() {
  if (!selectedWaId.value) return;
  errorMessage.value = '';
  resetMessage.value = '';
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(selectedWaId.value)}/bot/reset`, {
      method: 'POST'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo reiniciar la conversación.');
    await Promise.all([fetchBotSession(selectedWaId.value), fetchBotActivity()]);
    resetMessage.value = `Conversación con ${selectedWaId.value} reiniciada: su próximo mensaje se procesará como si fuera nuevo.`;
    setTimeout(() => { resetMessage.value = ''; }, 4000);
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function forceBookPendingSlot() {
  if (!selectedWaId.value) return;
  if (!confirm('¿Agendar la reunión con el horario que ya eligió, sin invitación por correo? El link de Meet igual se le manda por WhatsApp.')) return;
  forcingBook.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(selectedWaId.value)}/bot/force-book`, {
      method: 'POST'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo agendar la reunión.');
    await Promise.all([fetchBotSession(selectedWaId.value), fetchThread(selectedWaId.value), fetchBotActivity()]);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    forcingBook.value = false;
  }
}

function selectConversation(waId) {
  if (!waId) return;
  selectedWaId.value = waId;
  // Al abrir un hilo siempre se entra por lo último, como cualquier chat.
  isPinnedToBottom.value = true;
  unseenCount.value = 0;
  thread.value = [];
  fetchThread(waId, { scrollToBottom: true });
  fetchBotSession(waId);
}

/**
 * La bitácora completa mezcla todos los contactos. Cuando hay uno abierto, lo
 * normal es querer ver solo sus turnos, así que ese es el estado por defecto.
 */
const filteredActivity = computed(() => {
  if (!activityOnlySelected.value || !selectedWaId.value) return botActivity.value;
  return botActivity.value.filter((entry) => entry.waId === selectedWaId.value);
});

function openActivity() {
  isActivityOpen.value = true;
  fetchBotActivity();
}

function closeActivity() {
  isActivityOpen.value = false;
}

function onActivityKeydown(event) {
  if (event.key !== 'Escape') return;
  if (isActivityOpen.value) closeActivity();
  else if (isDeletionsLogOpen.value) closeDeletionsLog();
  else if (isDeleteConfirmOpen.value && !isDeletingConversation.value) closeDeleteConfirm();
}

async function sendReply() {
  const body = replyText.value.trim();
  if (!body || !selectedWaId.value) return;

  isSending.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(selectedWaId.value)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.details || data.error || 'No se pudo enviar el mensaje.');
    replyText.value = '';
    await Promise.all([
      fetchThread(selectedWaId.value, { scrollToBottom: true }),
      fetchConversations(),
      fetchBotSession(selectedWaId.value)
    ]);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSending.value = false;
  }
}

function openDeleteConfirm() {
  if (!selectedWaId.value) return;
  isDeleteConfirmOpen.value = true;
}

function closeDeleteConfirm() {
  isDeleteConfirmOpen.value = false;
}

async function deleteConversation() {
  if (!selectedWaId.value || isDeletingConversation.value) return;
  isDeletingConversation.value = true;
  errorMessage.value = '';
  const waId = selectedWaId.value;
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(waId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la conversación.');

    conversations.value = conversations.value.filter((c) => c.wa_id !== waId);
    conversationsTotal.value = Math.max(0, conversationsTotal.value - 1);
    selectedWaId.value = null;
    thread.value = [];
    botSession.value = null;
    isDeleteConfirmOpen.value = false;
    resetMessage.value = `Conversación con ${waId} eliminada.`;
    setTimeout(() => { resetMessage.value = ''; }, 4000);
    await fetchDeletionsLog();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isDeletingConversation.value = false;
  }
}

async function fetchDeletionsLog() {
  try {
    const response = await apiFetch('/api/whatsapp/conversations/deletions');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener las conversaciones eliminadas.');
    assignIfChanged(deletionsLog, data.deletions || []);
  } catch (error) {
    errorMessage.value = error.message;
  }
}

function openDeletionsLog() {
  isDeletionsLogOpen.value = true;
  fetchDeletionsLog();
}

function closeDeletionsLog() {
  isDeletionsLogOpen.value = false;
}

async function fetchRawEvents() {
  try {
    const response = await apiFetch('/api/webhooks/whatsapp/events');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener los eventos.');
    assignIfChanged(rawEvents, data.events || []);
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function fetchBotActivity() {
  try {
    const response = await apiFetch('/api/whatsapp/bot-activity');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener la actividad del bot.');
    assignIfChanged(botActivity, data.activity || []);
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function clearActivity() {
  try {
    const response = await apiFetch('/api/whatsapp/bot-activity', { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo limpiar la bitácora.');
    botActivity.value = [];
  } catch (error) {
    errorMessage.value = error.message;
  }
}

/**
 * Descarga en un .txt todas las conversaciones (entrantes + salientes) del día
 * elegido en el selector (por defecto, hoy). Se pide con apiFetch para adjuntar
 * el token y luego se fuerza la descarga desde el blob, ya que el endpoint
 * responde con Content-Disposition.
 */
async function downloadConversations() {
  const date = exportDate.value;
  if (!date) {
    errorMessage.value = 'Elige una fecha para descargar las conversaciones.';
    return;
  }
  isDownloading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/export?date=${encodeURIComponent(date)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudieron descargar las conversaciones.');
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `conversaciones-whatsapp-${date}.txt`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isDownloading.value = false;
  }
}

function resetSimWaId() {
  simWaId.value = `test-${Math.floor(100000 + Math.random() * 900000)}`;
  simMessagesSent.value = [];
}

async function sendSimulatedMessage() {
  const waId = simWaId.value.trim();
  const text = simText.value.trim();
  if (!waId || !text) return;

  isSimulating.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/whatsapp/bot-test/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waId, text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo simular el mensaje.');
    simMessagesSent.value.push(text);
    simText.value = '';
    await fetchBotActivity();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSimulating.value = false;
  }
}

/**
 * Refresco del panel.
 *
 * `silent` es para los sondeos automáticos: no enciende el estado de carga,
 * que era lo que hacía parpadear el botón y los estados vacíos cada pocos
 * segundos. `full` trae además lo que no cambia casi nunca (configuración) o
 * es de diagnóstico (bitácora del bot, eventos crudos del webhook): eso solo
 * se pide al entrar, al pulsar "Actualizar" y cada POLL_FULL_EVERY sondeos,
 * en vez de en cada uno.
 */
async function fetchAll({ silent = false, full = true } = {}) {
  if (!silent) isLoading.value = true;
  errorMessage.value = '';

  // Al entrar y al pulsar "Actualizar" se arranca de cero; el sondeo solo
  // mezcla la primera página para no tirar lo que el operador ya bajó.
  const tasks = [fetchConversations({ reset: !silent })];
  if (selectedWaId.value) tasks.push(fetchThread(selectedWaId.value), fetchBotSession(selectedWaId.value));
  if (full) tasks.push(fetchStats(), fetchRawEvents(), fetchBotActivity());

  await Promise.all(tasks);
  if (!silent) isLoading.value = false;
}

function channelIcon(channel) {
  const icons = { 'Facebook Ads': '📘', 'Instagram Ads': '📸', 'Anuncio de Meta': '🎯', 'Publicación de Meta': '📝' };
  return icons[channel] || '💬';
}

function channelBadgeClass(channel) {
  if (channel === 'Facebook Ads') return 'channel-fb';
  if (channel === 'Instagram Ads') return 'channel-ig';
  if (channel === 'WhatsApp Directo' || !channel) return 'channel-direct';
  return 'channel-ad';
}

function statusTick(status) {
  if (status === 'read') return '✓✓';
  if (status === 'delivered') return '✓✓';
  if (status === 'sent') return '✓';
  if (status === 'failed') return '⚠️';
  return '';
}

/** Color del acuse: solo "leído" se destaca; lo demás queda en tinta suave. */
function tickClass(status) {
  if (status === 'read') return 'is-read';
  if (status === 'failed') return 'is-failed';
  return '';
}

function statusLabel(status) {
  const labels = { read: 'Leído', delivered: 'Entregado', sent: 'Enviado', failed: 'No se pudo entregar' };
  return labels[status] || 'Enviando';
}

/** Iniciales para el avatar del contacto (dos como máximo). */
function initialsOf(name) {
  const clean = String(name || '').trim();
  if (!clean) return '·';
  if (/^\+?\d+$/.test(clean)) return clean.slice(-2);
  return clean.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

const CLOCK_FORMATTER = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit', hour12: true });

/** Solo la hora, para la firma de cada burbuja: "6:30 p.m.". */
function formatClock(isoString) {
  if (!isoString) return '';
  return CLOCK_FORMATTER.format(new Date(isoString)).replace(/\./g, '').replace(/\s([ap])\s?m\b/i, ' $1.m.');
}

const DAY_FORMATTER = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });

/** "Hoy" / "Ayer" / "sábado, 5 de septiembre" para el separador de día. */
function dayLabelOf(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return DAY_FORMATTER.format(date);
}

/**
 * El hilo plano se agrupa en días y, dentro de cada día, en tandas seguidas
 * del mismo lado. Los días son información real (el contacto necesita ver
 * dónde termina una jornada); las tandas solo controlan el espaciado y qué
 * burbuja lleva la esquina marcada, para que una respuesta de cinco líneas no
 * se lea como cinco conversaciones distintas.
 */
const threadGroups = computed(() => {
  const groups = [];
  let day = null;
  let run = null;

  for (const msg of thread.value) {
    const at = new Date(msg.received_at);
    const dayKey = at.toDateString();

    if (!day || day.key !== dayKey) {
      day = { key: dayKey, label: dayLabelOf(at), runs: [] };
      groups.push(day);
      run = null;
    }

    const direction = msg.direction === 'outbound' ? 'outbound' : 'inbound';
    if (!run || run.direction !== direction) {
      run = { key: `${dayKey}-${msg.id}`, direction, messages: [] };
      day.runs.push(run);
    }
    run.messages.push(msg);
  }

  return groups;
});

function signatureBadgeClass(event) {
  if (!event.hasSecret) return 'badge-neutral';
  return event.signatureValid ? 'badge-ok' : 'badge-error';
}

function signatureBadgeText(event) {
  if (!event.hasSecret) return 'Sin verificar (META_APP_SECRET vacío)';
  return event.signatureValid ? '✅ Firma válida' : '❌ Firma inválida';
}

function formatTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function formatShortTime(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function truncate(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function formatBody(body) {
  return JSON.stringify(body, null, 2);
}

// Cada cuántos sondeos se refresca también lo pesado/estático (estadísticas,
// bitácora del bot, eventos del webhook y configuración).
const POLL_INTERVAL_MS = 5000;
const POLL_FULL_EVERY = 6;
let pollTick = 0;

onMounted(() => {
  // `?waId=...` abre directo esa conversación: es el enlace que llevan las
  // alertas internas por correo ("Abrir la conversación"), para que quien
  // recibe el aviso no tenga que buscar el número a mano en la lista.
  const requestedWaId = new URLSearchParams(window.location.search).get('waId');
  if (requestedWaId) selectConversation(requestedWaId);

  fetchAll();
  window.addEventListener('keydown', onActivityKeydown);
  pollHandle = setInterval(() => {
    if (!autoRefresh.value) return;
    pollTick += 1;
    // La bitácora se refresca en cada sondeo mientras el modal está abierto:
    // es justo cuando se está mirando lo que hace el bot en vivo.
    fetchAll({ silent: true, full: isActivityOpen.value || pollTick % POLL_FULL_EVERY === 0 });
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
  window.removeEventListener('keydown', onActivityKeydown);
  releaseThreadMedia(new Set());
});
</script>

<style scoped>
.whatsapp-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.whatsapp-header {
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

.section-subheading code, .info-box code {
  background: var(--surface-2);
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
  font-size: 0.85em;
  word-break: break-all;
}

.header-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.btn-action-secondary {
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

.download-group {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.date-input {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  font-size: 0.86rem;
  font-weight: 600;
  font-family: var(--font-heading);
  cursor: pointer;
}

.date-input:focus {
  outline: none;
  border-color: var(--primary);
}

.btn-action-secondary:hover:not(:disabled) {
  background: var(--surface-3);
}

.btn-action-secondary:disabled {
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
  border-color: rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
}

.success-box {
  border-color: rgba(46, 125, 70, 0.4);
  color: var(--accent-emerald);
}

.subsection-title {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  color: var(--text-main);
  margin-top: 0.5rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 0.8rem 1rem;
  display: flex;
  align-items: center;
  box-shadow: var(--shadow-sm);
  gap: 0.85rem;
}

.stat-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1.15rem;
  flex-shrink: 0;
}

.stat-icon-wrapper.blue { background: rgba(76, 134, 255, 0.15); }
.stat-icon-wrapper.green { background: rgba(34, 197, 94, 0.15); }

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-sub);
}

.stat-value {
  font-size: 1.35rem;
  font-weight: 800;
  font-family: var(--font-heading);
  letter-spacing: -0.01em;
  color: var(--text-main);
}

.empty-state {
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--text-sub);
}

.empty-state.small {
  padding: 1.25rem 1rem;
  font-size: 0.85rem;
}

.empty-icon {
  font-size: 2.2rem;
  display: block;
  margin-bottom: 0.6rem;
}

.empty-hint {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-top: 0.25rem;
}

/* Inbox */
/* La bandeja ocupa casi todo el alto útil: es la herramienta principal de la
   página, no una tarjeta más. El tope evita que en monitores muy altos el hilo
   quede con metros de aire entre la cabecera y el compositor. */
.whatsapp-inbox {
  display: flex;
  gap: 1.1rem;
  height: clamp(560px, 76vh, 860px);
}

/* La bandeja de contactos es una sola tarjeta elevada (cabecera fija +
   lista con su propio scroll), no filas sueltas flotando sobre el fondo de
   la página — el mismo lenguaje visual que .thread-panel, para que ambas
   mitades se lean como un único panel de aplicación. */
.contacts-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.contacts-panel-head {
  flex-shrink: 0;
  padding: 0.9rem 0.95rem 0.7rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.contacts-count {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.contact-search {
  position: relative;
  display: flex;
  align-items: center;
}

.contact-search-icon {
  position: absolute;
  left: 0.7rem;
  font-size: 0.72rem;
  opacity: 0.55;
  pointer-events: none;
}

.contact-search-input {
  width: 100%;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  padding: 0.45rem 0.8rem 0.45rem 1.95rem;
  font-size: 0.8rem;
  font-family: var(--font-body);
  color: var(--text-main);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.contact-search-input::placeholder {
  color: var(--text-muted);
}

.contact-search-input:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--bg-card-solid);
}

.contacts-list {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.contacts-more {
  width: 100%;
  padding: 0.7rem 1rem;
  text-align: center;
  font-size: 0.76rem;
  color: var(--text-muted);
  border: none;
  background: none;
  margin: 0;
}

.contacts-more-btn {
  cursor: pointer;
  color: var(--primary);
  text-decoration: underline;
}

.contacts-empty {
  padding: 2rem 1rem;
  text-align: center;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.contact-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-color);
  padding: 0.75rem 0.95rem;
  cursor: pointer;
  text-align: left;
  color: var(--text-main);
  transition: background 0.15s ease;
}

.contact-item:last-child {
  border-bottom: none;
}

.contact-item:hover {
  background: var(--surface-1);
}

.contact-item:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

/* El contacto abierto se marca con una barra de tinta a la izquierda en vez de
   teñir toda la fila: se distingue de un vistazo sin competir con el hilo. */
.contact-item.is-active {
  background: var(--surface-2);
  box-shadow: inset 3px 0 0 var(--primary);
}

/* Conversación que Avan transfirió a un asesor: se resalta para que no se
   pierda entre el resto mientras nadie la atiende. Se apaga sola apenas
   alguien del equipo responde desde el panel (ver clearHandoffMark). */
.contact-item.is-urgent {
  background: rgba(200, 85, 50, 0.07);
  border-bottom-color: rgba(200, 85, 50, 0.18);
}

.contact-item.is-urgent.is-active {
  background: rgba(200, 85, 50, 0.12);
  box-shadow: inset 3px 0 0 var(--accent-rose);
}

.urgent-flag {
  margin-right: 0.3rem;
}

.contact-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #ffffff;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.contact-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.contact-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Alias del perfil de WhatsApp junto al nombre real: sirve para reconocerlo
   (así lo ve quien atiende en su celular) sin robarle protagonismo al nombre
   con el que el lead está registrado. */
.contact-alias {
  font-weight: 400;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.contact-alias::before { content: '· '; }

.contact-preview {
  font-size: 0.75rem;
  color: var(--text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  flex-shrink: 0;
}

.contact-time {
  font-size: 0.68rem;
  color: var(--text-sub);
  opacity: 0.7;
  flex-shrink: 0;
  white-space: nowrap;
}

.badge-row {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.form-lead-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 999px;
  background: rgba(111, 129, 37, 0.18);
  color: #6F8125;
  flex-shrink: 0;
}

.channel-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}

.channel-fb {
  background: rgba(24, 119, 242, 0.15);
  color: #6FA3D8;
}

.channel-ig {
  background: rgba(225, 48, 108, 0.15);
  color: #f0578a;
}

.channel-direct {
  background: var(--surface-2);
  color: var(--text-sub);
}

.channel-ad {
  background: rgba(201, 146, 46, 0.15);
  color: #E0A362;
}

/* Tarjeta del anuncio/publicación de origen (estilo "Click to WhatsApp Ad"
   de Meta, como la muestran las bandejas tipo Chatwoot): flota alineada a la
   derecha arriba del hilo, con la imagen del anuncio si vino en el referral. */
.ad-referral-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
  margin: 0 0 1.1rem;
}

.ad-referral-opened {
  font-family: var(--font-mono);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ad-referral-card {
  width: min(320px, 100%);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.ad-referral-image {
  width: 100%;
  height: 140px;
  object-fit: cover;
  display: block;
  background: var(--surface-2);
}

.ad-referral-body {
  padding: 0.65rem 0.8rem 0.75rem;
}

.ad-referral-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.ad-referral-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-main);
}

.ad-referral-link {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
  text-decoration: none;
  white-space: nowrap;
}

.ad-referral-link:hover {
  text-decoration: underline;
}

.ad-referral-headline {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--text-sub);
  line-height: 1.4;
}

.thread-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.thread-header {
  padding: 0.85rem 1.15rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
  background: var(--bg-card);
}

.thread-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: #ffffff;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
}

.thread-identity {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.thread-name {
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.2;
}

.thread-sub {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.thread-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Agrupa los controles del bot en una sola píldora (mismo lenguaje que un
   toolbar de inbox profesional) y deja "Eliminar" suelto y con más peso
   visual, separado — es la única acción destructiva del encabezado. */
.thread-actions-group {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.2rem;
}

.thread-actions-group .btn-thread-action {
  border: none;
  border-radius: 999px;
}

.thread-actions-group .btn-thread-action:hover {
  background: var(--surface-3);
  border-color: transparent;
}

.bot-status {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
  background: rgba(111, 129, 37, 0.12);
  border: 1px solid rgba(111, 129, 37, 0.25);
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  white-space: nowrap;
}

.bot-status.is-paused {
  color: var(--text-sub);
  background: var(--surface-2);
  border-color: var(--border-color);
}

.btn-thread-action {
  background: transparent;
  color: var(--text-sub);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.75rem;
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.btn-thread-action:hover {
  background: var(--surface-2);
  border-color: var(--border-strong);
  color: var(--text-main);
}

.btn-thread-action:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* Los datos duros del expediente (teléfono, horas, fechas) van en mono: es la
   convención que ya usa el resto del panel para distinguir dato de prosa. */
.thread-phone {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* El área de mensajes es el único lugar de la página con fondo distinto al
   de la tarjeta: así las burbujas se leen como objetos sobre una superficie y
   no como párrafos sueltos dentro de un panel blanco. */
.thread-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.thread-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.1rem 1.25rem 1.4rem;
  background: var(--bg-page-alt);
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.day-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.1rem 0 0.85rem;
}

.day-divider::before,
.day-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-color);
}

.day-divider:first-child {
  margin-top: 0;
}

.day-chip {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Una "tanda" es lo que escribió el mismo lado seguido. Se separan poco entre
   sí y mucho de la tanda contraria: eso es lo que hace que una respuesta de
   cuatro burbujas se lea como un solo turno. */
.msg-run {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.85rem;
}

.msg-run.inbound {
  align-items: flex-start;
}

.msg-run.outbound {
  align-items: flex-end;
}

.bubble {
  max-width: min(62ch, 78%);
  padding: 0.55rem 0.75rem 0.4rem;
  border-radius: var(--radius-md);
  font-size: 0.855rem;
  line-height: 1.5;
  animation: bubble-in 0.16s ease-out;
}

.bubble.inbound {
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border-color);
}

.bubble.outbound {
  background: var(--primary);
  color: #ffffff;
}

/* Solo la última burbuja de la tanda lleva la esquina marcada, como la cola de
   un bocadillo: señala dónde termina el turno. */
.bubble.inbound.is-last {
  border-bottom-left-radius: 3px;
}

.bubble.outbound.is-last {
  border-bottom-right-radius: 3px;
}

.bubble.is-failed {
  border: 1px solid var(--accent-rose);
}

.bubble-text {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.bubble-image {
  display: block;
  max-width: 100%;
  max-height: 22rem;
  border-radius: 0.6rem;
  margin-bottom: 0.3rem;
}

.bubble-attachment-link {
  display: inline-block;
  color: inherit;
  text-decoration: underline;
  margin-bottom: 0.3rem;
}

.bubble-audio-tag {
  display: block;
  font-size: 0.68rem;
  opacity: 0.65;
  margin-bottom: 0.15rem;
}

.bubble-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  margin-top: 0.2rem;
  opacity: 0.6;
}

.bubble.outbound .bubble-meta {
  opacity: 0.75;
}

.bubble-tick.is-read {
  color: #9CD1F0;
  opacity: 1;
}

.bubble-tick.is-failed {
  color: var(--accent-rose);
  opacity: 1;
}

.bubble-error {
  font-size: 0.72rem;
  color: var(--accent-rose);
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.5rem;
  margin-top: 0.35rem;
  overflow-wrap: anywhere;
}

/* Aviso de mensajes nuevos cuando el operador subió a leer historial: se le
   avisa en vez de arrastrarle la pantalla mientras lee. */
.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 0.9rem;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--cta);
  color: #ffffff;
  border: none;
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
  font-family: var(--font-body);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  animation: jump-in 0.18s ease-out;
}

.jump-latest:hover {
  background: var(--cta-hover);
}

.reply-box {
  display: flex;
  align-items: flex-end;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
}

.reply-input {
  flex: 1;
  resize: none;
  min-height: 44px;
  max-height: 140px;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 22px;
  padding: 0.7rem 1.1rem;
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.855rem;
  line-height: 1.5;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.reply-input:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--bg-card);
}

.btn-send {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--primary);
  color: #ffffff;
  border: none;
  border-radius: 22px;
  padding: 0 1.3rem;
  min-height: 44px;
  font-weight: 600;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}

.btn-send:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.btn-send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@keyframes bubble-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

@keyframes jump-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .bubble,
  .jump-latest {
    animation: none;
  }
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.thread-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  background: var(--surface-1);
}

.thread-placeholder-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 380px;
}

.thread-placeholder-img {
  width: 170px;
  height: 125px;
  border-radius: var(--radius-lg);
  object-fit: cover;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  margin-bottom: 1.25rem;
}

.thread-placeholder-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--text-main);
  margin-bottom: 0.4rem;
}

.thread-placeholder-desc {
  font-size: 0.85rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.event-time {
  font-size: 0.82rem;
  color: var(--text-sub);
  font-family: var(--font-heading);
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

/* Simulator */
.simulator-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.simulator-form {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
  flex-wrap: wrap;
}

.simulator-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 160px;
}

.simulator-field-grow {
  flex: 1;
}

.form-input-sm {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.85rem;
}

.form-input-sm:focus {
  outline: none;
  border-color: var(--primary);
}

.simulator-history {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sim-message-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.sim-message-chip {
  background: rgba(76, 134, 255, 0.12);
  border: 1px solid rgba(76, 134, 255, 0.3);
  color: var(--accent-cyan);
  border-radius: 999px;
  padding: 0.25rem 0.7rem;
  font-size: 0.75rem;
}

/* Activity feed (dentro del modal) */
.activity-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
  flex-shrink: 0;
}

.activity-card.activity-buffer {
  border-left-color: var(--accent-amber);
}

.activity-card.activity-llm {
  border-left-color: #6F8125;
}

.activity-card.activity-ok {
  border-left-color: var(--accent-emerald);
}

.activity-card.activity-error-card {
  border-left-color: var(--accent-rose);
}

.activity-card-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  font-size: 0.78rem;
  margin-bottom: 0.4rem;
}

.activity-type {
  font-weight: 700;
  color: var(--text-main);
}

.activity-wa {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
}

.activity-time {
  margin-left: auto;
  color: var(--text-sub);
  font-size: 0.72rem;
}

.activity-text {
  font-size: 0.82rem;
  color: var(--text-sub);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.activity-hint {
  font-size: 0.72rem;
  opacity: 0.75;
}

.activity-error {
  color: #E0717C;
}

/* ---- Modal de actividad del bot ---- */

.btn-count {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  background: var(--surface-3);
  color: var(--text-sub);
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  margin-left: 0.35rem;
}

.activity-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(16, 20, 20, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

.activity-modal {
  width: min(880px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.activity-modal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border-color);
}

.activity-modal-titles {
  flex: 1;
  min-width: 0;
}

.activity-modal-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.activity-modal-sub {
  font-size: 0.76rem;
  color: var(--text-muted);
  margin: 0.15rem 0 0;
}

.activity-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-sub);
  cursor: pointer;
  white-space: nowrap;
}

.btn-modal-close {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-sub);
  width: 32px;
  height: 32px;
  font-size: 0.85rem;
  cursor: pointer;
}

.btn-modal-close:hover {
  background: var(--surface-2);
  color: var(--text-main);
}

.activity-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.1rem 1.25rem;
  background: var(--bg-page-alt);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.activity-empty {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 2.5rem 1rem;
}

@media (max-width: 900px) {
  .whatsapp-inbox {
    flex-direction: column;
    height: auto;
  }

  .contacts-panel {
    width: 100%;
    max-height: 240px;
  }

  .thread-panel {
    height: 70vh;
    min-height: 460px;
  }

  .bubble {
    max-width: 88%;
  }
}

@media (max-width: 768px) {
  .whatsapp-page-wrapper {
    padding: 1rem;
  }
}

.btn-thread-danger {
  background: transparent;
  color: var(--accent-rose);
  border: 1px solid rgba(200, 85, 50, 0.4);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.7rem;
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.btn-thread-danger:hover:not(:disabled) {
  background: rgba(200, 85, 50, 0.12);
  border-color: var(--accent-rose);
}

.btn-thread-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.confirm-modal {
  width: min(420px, 100%);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 1.3rem 1.4rem;
}

.confirm-modal-title {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  margin: 0 0 0.6rem;
}

.confirm-modal-text {
  font-size: 0.85rem;
  color: var(--text-sub);
  line-height: 1.5;
  margin: 0 0 1.1rem;
}

.confirm-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}

.btn-confirm-delete {
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  font-family: var(--font-heading);
}
</style>
