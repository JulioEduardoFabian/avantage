<template>
  <main class="container-fluid kanban-page-wrapper">
    <!-- Header y Acciones Principales -->
    <header class="kanban-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">🎯</span> Setter Funnel — Triaje & Conversaciones
        </h2>
        <p class="section-subheading">
          Gestiona el flujo de prospección y agendamiento. En la primera etapa visualiza a todos los leads con <strong>conversación abierta</strong> desde <strong>WhatsApp, Facebook o Instagram</strong>, califícalos y transfiérelos a citas o cierre.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-primary" @click="openCreateLeadModal">
          <span class="btn-icon">👤</span> Nuevo Lead
        </button>
        <button class="btn-action-secondary" @click="openCreateColumnModal()">
          <span class="btn-icon">➕</span> Nueva Etapa
        </button>
        <button class="btn-action-secondary" @click="fetchAll" :disabled="isLoading" title="Actualizar datos">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando...' : 'Actualizar' }}
        </button>
        <button class="btn-action-ghost" @click="confirmResetColumns" title="Restablecer etapas predeterminadas de Setter">
          ⚙️ Restablecer
        </button>
      </div>
    </header>

    <!-- Banner de Métricas del Setter Funnel -->
    <section class="funnel-stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper blue">💬</div>
        <div class="stat-info">
          <span class="stat-label">Total Conversaciones</span>
          <span class="stat-value">{{ totalConversationsCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper green">💚</div>
        <div class="stat-info">
          <span class="stat-label">Leads WhatsApp</span>
          <span class="stat-value">{{ whatsappCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper purple">📸 / 📘</div>
        <div class="stat-info">
          <span class="stat-label">Meta (IG / FB)</span>
          <span class="stat-value">{{ igFbCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper amber">📅</div>
        <div class="stat-info">
          <span class="stat-label">Citas Agendadas</span>
          <span class="stat-value">{{ scheduledAppointmentsCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper cyan">🎯</div>
        <div class="stat-info">
          <span class="stat-label">Tasa Calificación</span>
          <span class="stat-value">{{ qualificationRate }}%</span>
        </div>
      </div>
    </section>

    <!-- Barra de Filtros, Canales, Búsqueda y Paginación -->
    <div class="kanban-toolbar">
      <div class="search-filter-box">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Buscar por cliente, #ID, teléfono, tema, universidad..."
        />
        <button v-if="searchQuery" class="clear-search-btn" @click="searchQuery = ''" title="Limpiar búsqueda">✕</button>
      </div>

      <!-- Filtro por Canal de Origen (WhatsApp, Facebook, Instagram) -->
      <div class="channel-filter-group">
        <button
          class="channel-pill"
          :class="{ active: selectedChannelFilter === 'all' }"
          @click="selectedChannelFilter = 'all'"
        >
          🌐 Todos ({{ totalLeadsCount }})
        </button>
        <button
          class="channel-pill whatsapp-pill"
          :class="{ active: selectedChannelFilter === 'whatsapp' }"
          @click="selectedChannelFilter = 'whatsapp'"
        >
          💚 WhatsApp ({{ whatsappCount }})
        </button>
        <button
          class="channel-pill fb-pill"
          :class="{ active: selectedChannelFilter === 'facebook' }"
          @click="selectedChannelFilter = 'facebook'"
        >
          📘 Facebook ({{ fbCount }})
        </button>
        <button
          class="channel-pill ig-pill"
          :class="{ active: selectedChannelFilter === 'instagram' }"
          @click="selectedChannelFilter = 'instagram'"
        >
          📸 Instagram ({{ igCount }})
        </button>
      </div>

      <!-- Filtros por Viabilidad -->
      <div class="filter-pills">
        <button
          v-for="pill in VIABILITY_FILTERS"
          :key="pill.id"
          class="filter-pill"
          :class="{ active: selectedViabilityFilter === pill.id }"
          @click="selectedViabilityFilter = pill.id"
        >
          {{ pill.label }}
        </button>
      </div>

      <!-- Control de Tarjetas por Columna -->
      <div class="items-per-page-box">
        <span class="toolbar-label">Por pág:</span>
        <select v-model="itemsPerPage" class="items-select" title="Límite de tarjetas por columna">
          <option :value="10">10 leads</option>
          <option :value="20">20 leads</option>
          <option :value="30">30 leads</option>
          <option value="all">Ver todos</option>
        </select>
      </div>

      <!-- Flechas de desplazamiento horizontal del tablero -->
      <div class="board-nav-arrows">
        <button
          class="board-nav-btn"
          @click="scrollBoard('left')"
          title="Desplazar tablero a la izquierda"
        >
          ◀
        </button>
        <span class="board-nav-hint">{{ columns.length }} etapas</span>
        <button
          class="board-nav-btn"
          @click="scrollBoard('right')"
          title="Desplazar tablero a la derecha"
        >
          ▶
        </button>
      </div>
    </div>

    <!-- Mensajes de Error y Alertas -->
    <div v-if="loadError" class="info-box alert-box">
      <h4>⚠️ No se pudo cargar el Setter Funnel</h4>
      <p>{{ loadError }}</p>
    </div>

    <!-- Toast de Proyecto Creado Automáticamente al Ganar -->
    <transition name="toast-slide">
      <div v-if="projectToast" class="project-created-banner">
        <div class="banner-content">
          <span class="banner-icon">🎉</span>
          <div>
            <strong>¡Lead Convertido & Proyecto Creado!</strong>
            <p class="banner-subtext">"{{ projectToast.topic }}" se ha registrado en Gestión de Proyectos.</p>
          </div>
        </div>
        <div class="banner-actions">
          <router-link to="/admin/projects" class="banner-btn primary">Ver en Proyectos</router-link>
          <button class="banner-btn secondary" @click="projectToast = null">✕</button>
        </div>
      </div>
    </transition>

    <!-- Toast del Pase Manual al Funnel de Closer -->
    <transition name="toast-slide">
      <div v-if="handoffToast" class="project-created-banner handoff-banner">
        <div class="banner-content">
          <span class="banner-icon">🤝</span>
          <div>
            <strong>Lead pasado al Funnel de Closer</strong>
            <p class="banner-subtext">"{{ handoffToast.name }}" ya no está en el Setter Funnel: lo trabaja el closer.</p>
          </div>
        </div>
        <div class="banner-actions">
          <router-link to="/admin/leads" class="banner-btn primary">Ver en Funnel de Ventas</router-link>
          <button class="banner-btn secondary" @click="handoffToast = null">✕</button>
        </div>
      </div>
    </transition>

    <!-- Tablero Kanban Dinámico con Scroll Suave -->
    <div class="kanban-viewport custom-scrollbar" ref="kanbanBoardRef">
      <div class="kanban-columns-container">
        <template v-for="(col, colIndex) in columns" :key="col.key">
        <!-- Insertador rápido de etapa (antes de esta columna) -->
        <button
          class="col-inserter"
          type="button"
          :title="colIndex === 0 ? 'Insertar etapa al inicio' : 'Insertar etapa aquí'"
          @click="openCreateColumnModal(colIndex)"
        >
          <span class="col-inserter-line"></span>
          <span class="col-inserter-plus">+</span>
        </button>

        <!-- Columna de Kanban -->
        <div
          class="kanban-column"
          :class="{
            'is-first-setter-col': colIndex === 0,
            'is-final-column': col.final,
            'is-drag-over': hoveredColumn === col.key
          }"
          :style="{ '--col-accent': col.color || '#56624A' }"
          @dragover.prevent="hoveredColumn = col.key"
          @dragleave="onColumnDragLeave(col.key)"
          @drop="onDrop(col.key)"
        >
          <!-- Barra superior de acento de color -->
          <div class="column-top-accent"></div>

          <!-- Cabecera de Columna: título a todo el ancho, controles debajo -->
          <div class="kanban-column-header">
            <div class="col-title-row">
              <span class="col-icon">{{ col.icon || '📌' }}</span>
              <span class="col-label" :title="col.label">{{ col.label }}</span>
              <span
                class="col-count-badge"
                :style="{ background: (col.color || '#56624A') + '22', color: col.color || '#56624A', borderColor: (col.color || '#56624A') + '55' }"
              >
                {{ (filteredLeadsByColumn[col.key] || []).length }}
              </span>
            </div>

            <span v-if="colIndex === 0" class="col-setter-badge">💬 Chats WhatsApp / FB / IG</span>

            <!-- Controles de la columna (fila propia, debajo del nombre) -->
            <div class="col-actions-group">
              <button
                class="col-arrow-btn"
                :disabled="colIndex === 0"
                @click.stop="moveColumnLeft(colIndex)"
                title="Mover columna a la izquierda"
              >
                ◀
              </button>
              <button
                class="col-arrow-btn"
                :disabled="colIndex === columns.length - 1"
                @click.stop="moveColumnRight(colIndex)"
                title="Mover columna a la derecha"
              >
                ▶
              </button>
              <button
                class="col-menu-btn"
                @click.stop="openCreateColumnModal(colIndex + 1)"
                title="Insertar una etapa después de esta"
              >
                ➕
              </button>
              <button
                class="col-menu-btn"
                @click.stop="openEditColumnModal(col, colIndex)"
                title="Editar nombre, icono o color"
              >
                ✏️
              </button>
              <button
                v-if="columns.length > 1"
                class="col-menu-btn delete-btn"
                @click.stop="openDeleteColumnModal(col, colIndex)"
                title="Eliminar columna"
              >
                🗑️
              </button>
            </div>
          </div>

          <!-- Cuerpo de la Columna (Lista de Leads Paginada) -->
          <div class="kanban-column-body custom-scrollbar">
            <!-- Tarjetas de Leads Paginadas -->
            <div
              v-for="lead in paginatedLeadsByColumn[col.key]"
              :key="lead.id"
              class="kanban-lead-card"
              :class="{
                'is-being-dragged': draggedLead?.id === lead.id,
                'channel-whatsapp-border': getLeadChannelInfo(lead).type === 'whatsapp',
                'channel-fb-border': getLeadChannelInfo(lead).type === 'facebook',
                'channel-ig-border': getLeadChannelInfo(lead).type === 'instagram'
              }"
              draggable="true"
              @dragstart="onDragStart(lead)"
              @dragend="onDragEnd"
              @click="selectedLead = lead"
            >
              <!-- La tarjeta dice lo mínimo para reconocer al lead y llamarlo
                   —la misma que el funnel de ventas—; todo lo demás (canal,
                   viabilidad, tema, accesos rápidos y las notas del setter)
                   está en la ficha que se abre al hacer clic. Así entran diez
                   de un vistazo en la columna, que es como se trabaja el
                   tablero. El borde de color se conserva porque no ocupa
                   espacio y es como el setter distingue el canal de origen. -->
              <h4 class="card-lead-name" :title="getLeadFullName(lead)">
                {{ getLeadFullName(lead) }}
              </h4>
              <span class="card-lead-phone">📱 {{ lead.phone || 'Sin celular' }}</span>

              <!-- Responsable comercial: el círculo va en la franja reservada
                   a la derecha, sin sumar una línea, para no romper el alto
                   fijo con el que entran diez tarjetas por columna. -->
              <LeadAssignee class="card-assignee" :lead="lead" @assigned="onLeadAssigned" />
            </div>

            <!-- Silueta de Destino al Arrastrar -->
            <div
              v-if="draggedLead && hoveredColumn === col.key && draggedLead.status !== col.key"
              class="kanban-drop-silhouette"
            >
              <div class="silhouette-header-line">
                <span class="silhouette-id">#{{ draggedLead.id }}</span>
                <span class="silhouette-badge">✨ Soltar aquí</span>
                <span :class="['viability-pill', getLevelClass(draggedLead.viability_level)]">
                  {{ draggedLead.overall_viability_score ?? '—' }}%
                </span>
              </div>
              <h4 class="silhouette-topic">{{ getLeadFullName(draggedLead) }}</h4>
              <div class="silhouette-footer-line">
                <span>📥 Se moverá a <strong>{{ col.label }}</strong></span>
              </div>
            </div>

            <!-- Estado Vacío en la Columna -->
            <div v-if="(filteredLeadsByColumn[col.key] || []).length === 0 && (!draggedLead || hoveredColumn !== col.key)" class="column-empty-state">
              <span class="empty-icon">{{ searchQuery ? '🔍' : (colIndex === 0 ? '💬' : '📥') }}</span>
              <p class="empty-text">
                {{ searchQuery ? 'Sin coincidencias' : (colIndex === 0 ? 'No hay nuevos chats' : 'Arrastra leads aquí') }}
              </p>
              <button v-if="searchQuery" class="clear-search-link" @click="searchQuery = ''">
                Limpiar búsqueda
              </button>
            </div>
          </div>

          <!-- Barra de Paginación por Columna -->
          <div v-if="getColumnTotalPages(col.key) > 1" class="column-pagination-bar">
            <button
              class="col-page-btn nav-extreme-btn"
              :disabled="getColumnPage(col.key) <= 1"
              @click.stop="setColumnPage(col.key, 1)"
              title="Ir al inicio (Pág. 1)"
            >
              ⏮
            </button>
            <button
              class="col-page-btn"
              :disabled="getColumnPage(col.key) <= 1"
              @click.stop="prevColumnPage(col.key)"
              title="Página anterior"
            >
              ◀
            </button>
            <div class="page-pills">
              <template v-for="(p, idx) in getVisibleColumnPages(col.key)" :key="idx">
                <button
                  v-if="p !== '...'"
                  class="page-pill"
                  :class="{ active: p === getColumnPage(col.key) }"
                  @click.stop="setColumnPage(col.key, p)"
                  :title="'Ir a página ' + p"
                >
                  {{ p }}
                </button>
                <button
                  v-else
                  class="page-pill ellipsis-pill"
                  @click.stop="jumpColumnPages(col.key, idx === 1 ? -5 : 5)"
                  :title="idx === 1 ? 'Retroceder 5 páginas' : 'Avanzar 5 páginas'"
                >
                  …
                </button>
              </template>
            </div>
            <button
              class="col-page-btn"
              :disabled="getColumnPage(col.key) >= getColumnTotalPages(col.key)"
              @click.stop="nextColumnPage(col.key)"
              title="Página siguiente"
            >
              ▶
            </button>
            <button
              class="col-page-btn nav-extreme-btn"
              :disabled="getColumnPage(col.key) >= getColumnTotalPages(col.key)"
              @click.stop="setColumnPage(col.key, getColumnTotalPages(col.key))"
              title="Ir a la última página"
            >
              ⏭
            </button>
          </div>

          <!-- Pie de Columna -->
          <div class="column-footer">
            <div class="footer-left-info">
              <span class="footer-count">{{ getColumnRangeText(col.key) }}</span>
              <button
                v-if="getColumnPage(col.key) > 1"
                class="footer-start-btn"
                @click.stop="setColumnPage(col.key, 1)"
                title="Volver a la página 1"
              >
                ⏮ Inicio
              </button>
            </div>
            <span v-if="col.final" class="final-tag">🏆 Cierre Exitoso</span>
          </div>
        </div>
        </template>

        <!-- Insertador final + tarjeta fantasma para añadir al final -->
        <button
          class="col-inserter"
          type="button"
          title="Insertar etapa al final"
          @click="openCreateColumnModal(columns.length)"
        >
          <span class="col-inserter-line"></span>
          <span class="col-inserter-plus">+</span>
        </button>

        <div class="add-column-ghost-card" @click="openCreateColumnModal(columns.length)">
          <div class="ghost-content">
            <span class="ghost-plus">➕</span>
            <span class="ghost-text">Crear Nueva Etapa</span>
            <span class="ghost-hint">O usa el “+” entre columnas para insertarla en su sitio</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 1: Crear Nueva Columna / Etapa                              -->
    <!-- ================================================================= -->
    <div v-if="showCreateColModal" class="modal-overlay" @click.self="showCreateColModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">✨ Nueva Etapa del Setter Funnel</h3>
          <button class="modal-close-btn" @click="showCreateColModal = false">✕</button>
        </div>
        <form @submit.prevent="saveNewColumn" class="modal-body">
          <p v-if="insertAtIndex !== null" class="insert-position-hint">
            📍 Se insertará en la posición <strong>{{ insertAtIndex + 1 }}</strong>
            <template v-if="columns[insertAtIndex]"> (antes de “{{ columns[insertAtIndex].label }}”)</template>
            <template v-else> (al final)</template>
          </p>
          <div class="form-group">
            <label class="form-label">Nombre de la etapa *</label>
            <input
              v-model="newColumnForm.label"
              type="text"
              class="form-input custom-input"
              placeholder="Ej: Diagnóstico Inicial, Confirmar Cita, Seguimiento..."
              required
              autofocus
            />
          </div>

          <div class="form-group">
            <label class="form-label">Icono Representativo</label>
            <div class="emoji-picker-grid">
              <button
                v-for="emoji in PRESET_EMOJIS"
                :key="emoji"
                type="button"
                class="emoji-option-btn"
                :class="{ active: newColumnForm.icon === emoji }"
                @click="newColumnForm.icon = emoji"
              >
                {{ emoji }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Color de la Etapa</label>
            <div class="color-picker-grid">
              <button
                v-for="c in PRESET_COLORS"
                :key="c.hex"
                type="button"
                class="color-option-btn"
                :class="{ active: newColumnForm.color === c.hex }"
                :style="{ backgroundColor: c.hex }"
                :title="c.name"
                @click="newColumnForm.color = c.hex"
              >
                <span v-if="newColumnForm.color === c.hex" class="check-icon">✓</span>
              </button>
            </div>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="newColumnForm.final" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa de Cierre Ganado</strong> (crea proyecto automático)</span>
            </label>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-action-ghost" @click="showCreateColModal = false">Cancelar</button>
            <button type="submit" class="btn-action-primary">Crear Etapa</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 1B: Nuevo Lead Manual                                       -->
    <!-- ================================================================= -->
    <div v-if="showCreateLeadModal" class="modal-overlay" @click.self="showCreateLeadModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">👤 Nuevo Lead Manual</h3>
          <button class="modal-close-btn" @click="showCreateLeadModal = false">✕</button>
        </div>
        <form @submit.prevent="saveNewLead" class="modal-body">
          <p v-if="leadFormError" class="info-box alert-box lead-form-error">{{ leadFormError }}</p>

          <div class="lead-form-grid">
            <div class="form-group">
              <label class="form-label">Nombre completo *</label>
              <input v-model="leadForm.fullName" type="text" class="form-input custom-input" placeholder="Ej: Edward Ramírez" required autofocus />
            </div>
            <div class="form-group">
              <label class="form-label">Celular *</label>
              <input v-model="leadForm.phone" type="text" class="form-input custom-input" placeholder="51987654321" required />
            </div>
            <div class="form-group">
              <label class="form-label">Correo</label>
              <input v-model="leadForm.email" type="email" class="form-input custom-input" placeholder="correo@ejemplo.com" />
            </div>
            <div class="form-group">
              <label class="form-label">DNI</label>
              <input v-model="leadForm.dni" type="text" class="form-input custom-input" placeholder="12345678" />
            </div>
            <div class="form-group">
              <label class="form-label">Universidad</label>
              <input v-model="leadForm.university" type="text" class="form-input custom-input" placeholder="Universidad Continental" />
            </div>
            <div class="form-group">
              <label class="form-label">Carrera</label>
              <input v-model="leadForm.career" type="text" class="form-input custom-input" placeholder="Ingeniería Civil" />
            </div>
            <div class="form-group">
              <label class="form-label">Canal de origen</label>
              <input v-model="leadForm.source" type="text" class="form-input custom-input" list="lead-source-options" placeholder="WhatsApp, Instagram, Referido..." />
              <datalist id="lead-source-options">
                <option value="WhatsApp Directo" />
                <option value="Instagram Ads" />
                <option value="Facebook Ads" />
                <option value="Referido" />
                <option value="Manual" />
              </datalist>
            </div>
            <div class="form-group">
              <label class="form-label">Setter / Asesor</label>
              <input v-model="leadForm.assignedTo" type="text" class="form-input custom-input" placeholder="Kevin" />
            </div>
            <div class="form-group lead-form-full">
              <label class="form-label">Tema / Consulta</label>
              <input v-model="leadForm.topic" type="text" class="form-input custom-input" placeholder="Ej: Tesis de ingeniería civil sobre concreto reciclado" />
            </div>
            <div class="form-group lead-form-full">
              <label class="form-label">Etapa inicial en el Setter Funnel</label>
              <select v-model="leadForm.status" class="form-select custom-select">
                <option v-for="c in columns" :key="c.key" :value="c.key">{{ c.icon }} {{ c.label }}</option>
              </select>
            </div>
            <div class="form-group lead-form-full">
              <label class="form-label">Notas del Setter</label>
              <textarea v-model="leadForm.additionalNotes" class="form-input custom-input lead-notes-textarea" rows="2" placeholder="Contexto, cómo llegó, siguiente paso..."></textarea>
            </div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-action-ghost" @click="showCreateLeadModal = false">Cancelar</button>
            <button type="submit" class="btn-action-primary" :disabled="isSavingLead">
              {{ isSavingLead ? 'Guardando...' : 'Registrar Lead' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 2: Editar Etapa Existente                                  -->
    <!-- ================================================================= -->
    <div v-if="showEditColModal" class="modal-overlay" @click.self="showEditColModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">✏️ Editar Etapa</h3>
          <button class="modal-close-btn" @click="showEditColModal = false">✕</button>
        </div>
        <form @submit.prevent="saveEditedColumn" class="modal-body">
          <div class="form-group">
            <label class="form-label">Nombre de la etapa *</label>
            <input
              v-model="editColumnForm.label"
              type="text"
              class="form-input custom-input"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">Icono</label>
            <div class="emoji-picker-grid">
              <button
                v-for="emoji in PRESET_EMOJIS"
                :key="emoji"
                type="button"
                class="emoji-option-btn"
                :class="{ active: editColumnForm.icon === emoji }"
                @click="editColumnForm.icon = emoji"
              >
                {{ emoji }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Color</label>
            <div class="color-picker-grid">
              <button
                v-for="c in PRESET_COLORS"
                :key="c.hex"
                type="button"
                class="color-option-btn"
                :class="{ active: editColumnForm.color === c.hex }"
                :style="{ backgroundColor: c.hex }"
                :title="c.name"
                @click="editColumnForm.color = c.hex"
              >
                <span v-if="editColumnForm.color === c.hex" class="check-icon">✓</span>
              </button>
            </div>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editColumnForm.final" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa de Cierre Ganado</strong></span>
            </label>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-action-ghost" @click="showEditColModal = false">Cancelar</button>
            <button type="submit" class="btn-action-primary">Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 3: Eliminar Columna y Reasignar Leads                       -->
    <!-- ================================================================= -->
    <div v-if="showDeleteColModal" class="modal-overlay" @click.self="showDeleteColModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">🗑️ Eliminar Etapa</h3>
          <button class="modal-close-btn" @click="showDeleteColModal = false">✕</button>
        </div>
        <div class="modal-body">
          <p class="modal-desc">
            ¿Estás seguro de eliminar la etapa <strong>"{{ deletingColumn?.label }}"</strong>?
          </p>
          <div class="form-group" v-if="availableTargetColumns.length > 0">
            <label class="form-label">Reasignar sus leads a:</label>
            <select v-model="targetReassignColKey" class="form-select custom-select">
              <option v-for="c in availableTargetColumns" :key="c.key" :value="c.key">
                {{ c.icon }} {{ c.label }}
              </option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn-action-ghost" @click="showDeleteColModal = false">Cancelar</button>
            <button class="btn-action-danger" @click="confirmDeleteColumn">Eliminar</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 4: Ficha Completa del Lead / Setter Drawer                  -->
    <!-- ================================================================= -->
    <div v-if="selectedLead" class="modal-overlay" @click.self="selectedLead = null">
      <div class="modal-content lead-modal-card" :class="{ 'has-chat': showBotChat }">
        <div class="modal-header">
          <div class="lead-modal-title-group">
            <span class="lead-modal-id">#{{ selectedLead.id }}</span>
            <div>
              <h3 class="lead-modal-name">{{ getLeadFullName(selectedLead) }}</h3>
              <p class="lead-modal-subtext">
                Canal: <strong :class="getLeadChannelInfo(selectedLead).cssClass">{{ getLeadChannelInfo(selectedLead).icon }} {{ selectedLead.source || getLeadChannelInfo(selectedLead).label }}</strong>
                · Registrado: {{ formatDate(selectedLead.created_at) }}
              </p>
            </div>
          </div>
          <button class="modal-close-btn" @click="selectedLead = null">✕</button>
        </div>

        <div class="modal-body custom-scrollbar" :class="{ 'modal-body-split': showBotChat }">
         <div class="lead-modal-primary">
          <!-- Banner de Contacto Rápido -->
          <div class="setter-quick-bar">
            <div class="quick-contact-pills">
              <button
                v-if="selectedLead.phone"
                type="button"
                class="setter-btn whatsapp-solid"
                :class="{ 'is-active': showBotChat }"
                @click="toggleBotChat"
              >
                💬 {{ showBotChat ? 'Ocultar conversación' : 'Ver conversación con el bot' }} ({{ selectedLead.phone }})
              </button>
              <a
                v-if="selectedLead.email"
                :href="'mailto:' + selectedLead.email"
                class="setter-btn email-solid"
              >
                ✉️ Enviar Correo ({{ selectedLead.email }})
              </a>
            </div>

            <!-- Selector Rápido de Estado en el Setter Funnel -->
            <div class="stage-selector-box">
              <label class="form-label">Mover etapa en Setter Funnel:</label>
              <select
                :value="selectedLead.status"
                @change="updateLeadStatusFromSelect(selectedLead.id, $event.target.value)"
                class="form-select custom-select stage-select"
              >
                <option v-for="c in columns" :key="c.key" :value="c.key">
                  {{ c.icon }} {{ c.label }} {{ c.final ? ' (🏆 Cierre)' : '' }}
                </option>
              </select>

              <!-- Pase manual al closer: para la reunión que agenda el propio
                   setter (por teléfono, por WhatsApp a mano…) y que el bot no
                   registró. Deja el lead en el mismo estado que el pase
                   automático, así que el closer lo ve igual. -->
              <button
                v-if="!leadHasGraduated(selectedLead, salesFunnelStatuses)"
                type="button"
                class="handoff-closer-btn"
                :disabled="handingOff"
                title="La reunión ya está agendada: pasa el lead al Funnel de Ventas para que lo trabaje el closer"
                @click="handOffToCloser(selectedLead)"
              >
                {{ handingOff ? 'Pasando…' : '🤝 Pasar al funnel de Closer (cita agendada a mano)' }}
              </button>
              <p v-else class="handoff-done-hint">
                ✅ Este lead ya está en el Funnel de Ventas
                (<strong>{{ salesStageLabel(selectedLead.status) }}</strong>).
              </p>
            </div>
          </div>

          <!-- Grid de Datos del Lead -->
          <div class="lead-details-grid">
            <div class="detail-item">
              <span class="detail-label">🙋 Responsable comercial:</span>
              <LeadAssignee :lead="selectedLead" show-name @assigned="onLeadAssigned" />
            </div>
            <div class="detail-item">
              <span class="detail-label">🎓 Grado Académico:</span>
              <span class="detail-value">{{ selectedLead.academic_level || 'No especificado' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">📚 Carrera / Especialidad:</span>
              <span class="detail-value">{{ selectedLead.field_of_study || 'No especificado' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">🏛️ Universidad:</span>
              <span class="detail-value">{{ selectedLead.university || 'No especificada' }}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">📍 Ubicación:</span>
              <span class="detail-value">{{ [selectedLead.department, selectedLead.province].filter(Boolean).join(', ') || 'No registrada' }}</span>
            </div>
            <div class="detail-item full-width">
              <span class="detail-label">📄 Tema / Consulta Principal:</span>
              <span class="detail-value highlight-topic">{{ selectedLead.topic || 'Sin tema detallado' }}</span>
            </div>
            <div class="detail-item full-width" v-if="selectedLead.additional_notes">
              <span class="detail-label">📝 Notas / Diagnóstico del Setter:</span>
              <p class="detail-notes-box">{{ selectedLead.additional_notes }}</p>
            </div>
          </div>

          <!-- Reporte de Viabilidad SUNEDU / CONCYTEC -->
          <div class="viability-section-card" v-if="selectedLead.overall_viability_score != null">
            <h4 class="section-subtitle">📊 Puntuación de Viabilidad Comercial</h4>
            <div class="viability-gauge-row">
              <div class="viability-badge-big" :class="getLevelClass(selectedLead.viability_level)">
                <span class="viability-score-num">{{ selectedLead.overall_viability_score }}%</span>
                <span class="viability-level-text">Viabilidad {{ selectedLead.viability_level || 'Calculada' }}</span>
              </div>
              <p class="viability-hint">
                Calculado mediante el motor de IA de viabilidad metodológica y temática de tesis.
              </p>
            </div>
          </div>

          <!-- Bitácora del seguimiento: en qué se quedó este lead -->
          <LeadNotes :lead-id="selectedLead.id" />
         </div>

          <!-- Panel lateral: conversación con el bot de WhatsApp (Avan) -->
          <aside v-if="showBotChat" class="bot-chat-panel">
            <header class="bot-chat-head">
              <span>💬 Conversación con Avan</span>
              <button type="button" class="bot-chat-refresh" :disabled="botChatLoading" @click="loadBotChat()">
                {{ botChatLoading ? '…' : '⟳' }}
              </button>
            </header>
            <div ref="botChatScrollEl" class="bot-chat-scroll custom-scrollbar">
              <p v-if="botChatError" class="bot-chat-empty">⚠️ {{ botChatError }}</p>
              <p v-else-if="botChatLoading && !botChatMessages.length" class="bot-chat-empty">Cargando conversación…</p>
              <p v-else-if="!botChatMessages.length" class="bot-chat-empty">Sin mensajes registrados con este contacto.</p>
              <div
                v-for="msg in botChatMessages"
                :key="msg.id"
                class="bot-bubble"
                :class="msg.direction === 'outbound' ? 'outbound' : 'inbound'"
              >
                <img
                  v-if="msg.message_type === 'image' && botChatMediaUrls[msg.id]"
                  :src="botChatMediaUrls[msg.id]"
                  alt="Imagen enviada por WhatsApp"
                  class="bot-bubble-image"
                />
                <a
                  v-else-if="msg.media_filename && botChatMediaUrls[msg.id]"
                  :href="botChatMediaUrls[msg.id]"
                  target="_blank"
                  rel="noopener"
                  class="bot-bubble-attachment-link"
                >📎 Ver adjunto</a>
                <span v-if="msg.message_type === 'audio' && msg.body && msg.body !== '[Audio]'" class="bot-bubble-audio-tag" title="Transcrito automáticamente de una nota de voz">🎤 Audio transcrito</span>
                <p v-if="msg.body && !(msg.media_filename && MEDIA_BODY_PLACEHOLDER_RE.test(msg.body))" class="bot-bubble-text">{{ msg.body }}</p>
                <span class="bot-bubble-time">
                  {{ msg.direction === 'outbound' ? 'Avan' : 'Contacto' }} · {{ formatClock(msg.received_at) }}
                </span>
              </div>
            </div>
          </aside>
        </div>

        <div class="modal-footer">
          <button class="btn-action-ghost" @click="selectedLead = null">Cerrar</button>
          <router-link to="/admin/leads" class="btn-action-secondary">
            Ver en Funnel General 📇
          </router-link>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { apiFetch } from '../apiClient.js';
import { loadApiImage } from '../apiImage.js';
import LeadNotes from '../components/LeadNotes.vue';
import LeadAssignee from '../components/LeadAssignee.vue';
import { buildSalesFunnelStatuses, leadHasGraduated } from '../salesFunnelStage.js';

/** Deja de mostrar solo "[Imagen]"/"[Video]": para esos placeholders se intenta cargar el adjunto real. */
const MEDIA_BODY_PLACEHOLDER_RE = /^\[(Imagen|Video|Audio|Documento|Sticker)\]$/;

// Etapas predeterminadas especializadas para Setter Funnel
const DEFAULT_SETTER_COLUMNS = [
  {
    key: 'conversacion_abierta',
    label: 'Conversación Abierta',
    icon: '💬',
    color: '#2C8C99',
    final: false,
    position: 0
  },
  {
    key: 'calificando',
    label: 'En Calificación',
    icon: '🎯',
    color: '#6F8125',
    final: false,
    position: 1
  },
  {
    key: 'congelado',
    label: 'Congelado',
    icon: '🧊',
    color: '#8D9199',
    final: false,
    position: 2
  },
  {
    key: 'cita_agendada',
    label: 'Cita Agendada',
    icon: '📅',
    color: '#C9922E',
    final: false,
    position: 3
  },
  {
    key: 'transferido_closer',
    label: 'Transferido a Closer',
    icon: '🤝',
    color: '#56624A',
    final: false,
    position: 4
  },
  {
    key: 'ganado',
    label: 'Ganado / Cerrado',
    icon: '🏆',
    color: '#2F7D5A',
    final: true,
    position: 5
  },
  {
    key: 'descartado',
    label: 'No Califica / Sin Resp.',
    icon: '🚫',
    color: '#B23A45',
    final: false,
    position: 6
  }
];

const PRESET_EMOJIS = ['💬', '🎯', '📅', '🤝', '🏆', '🚫', '💚', '📘', '📸', '📞', '🆕', '📋', '⏳', '⭐', '⚡', '💰'];

const PRESET_COLORS = [
  { name: 'Cian', hex: '#2C8C99' },
  { name: 'Violeta', hex: '#4C3F91' },
  { name: 'Ámbar', hex: '#C9922E' },
  { name: 'Azul', hex: '#56624A' },
  { name: 'Esmeralda', hex: '#2F7D5A' },
  { name: 'Rosa', hex: '#B23A45' },
  { name: 'Índigo', hex: '#5560B0' },
  { name: 'Naranja', hex: '#BF5A2A' }
];

const VIABILITY_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'alta', label: '🌟 Alta' },
  { id: 'media', label: '⚖️ Media' },
  { id: 'baja', label: '🔻 Baja' }
];

// Estado de Columnas
const columns = ref([]);
const kanbanBoardRef = ref(null);

// Estado de Leads
const leads = ref([]);
const selectedLead = ref(null);

// Conversación con el bot de WhatsApp (Avan) dentro de la ficha del lead
const showBotChat = ref(false);
const botChatMessages = ref([]);
const botChatMediaUrls = reactive({});
const botChatLoading = ref(false);
const botChatError = ref('');
const botChatScrollEl = ref(null);
let botChatTimer = null;
const isLoading = ref(false);
const loadError = ref('');
const draggedLead = ref(null);
const hoveredColumn = ref(null);
const projectToast = ref(null);

// Filtros y Búsqueda
const searchQuery = ref('');
const selectedChannelFilter = ref('all');
const selectedViabilityFilter = ref('all');

// Paginación por Columna
const columnPages = reactive({});
const itemsPerPage = ref(10);

function getColumnPage(colKey) {
  return columnPages[colKey] || 1;
}

function getColumnTotalPages(colKey) {
  const list = filteredLeadsByColumn.value[colKey] || [];
  if (itemsPerPage.value === 'all') return 1;
  return Math.ceil(list.length / Number(itemsPerPage.value)) || 1;
}

function setColumnPage(colKey, page) {
  const total = getColumnTotalPages(colKey);
  columnPages[colKey] = Math.max(1, Math.min(page, total));
}

function prevColumnPage(colKey) {
  setColumnPage(colKey, getColumnPage(colKey) - 1);
}

function nextColumnPage(colKey) {
  setColumnPage(colKey, getColumnPage(colKey) + 1);
}

function jumpColumnPages(colKey, delta) {
  const current = getColumnPage(colKey);
  const total = getColumnTotalPages(colKey);
  setColumnPage(colKey, Math.max(1, Math.min(total, current + delta)));
}

function getVisibleColumnPages(colKey) {
  const total = getColumnTotalPages(colKey);
  const current = getColumnPage(colKey);
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, '...', total];
  } else if (current >= total - 2) {
    return [1, '...', total - 3, total - 2, total - 1, total];
  } else {
    return [1, '...', current - 1, current, current + 1, '...', total];
  }
}

function getColumnRangeText(colKey) {
  const total = (filteredLeadsByColumn.value[colKey] || []).length;
  if (total === 0) return '0 leads';
  if (itemsPerPage.value === 'all') return `${total} lead(s)`;
  const page = getColumnPage(colKey);
  const totalPages = getColumnTotalPages(colKey);
  const start = (page - 1) * Number(itemsPerPage.value) + 1;
  const end = Math.min(page * Number(itemsPerPage.value), total);
  return `Pág. ${page}/${totalPages} (${start}-${end} de ${total})`;
}

// Modales
const showCreateColModal = ref(false);
const insertAtIndex = ref(null); // null = añadir al final; nº = insertar en esa posición
const newColumnForm = reactive({
  label: '',
  icon: '🎯',
  color: '#2C8C99',
  final: false
});

// Modal Nuevo Lead manual
const showCreateLeadModal = ref(false);
const isSavingLead = ref(false);
const leadFormError = ref('');
const leadForm = reactive({
  fullName: '',
  phone: '',
  email: '',
  dni: '',
  university: '',
  career: '',
  topic: '',
  source: 'Manual',
  assignedTo: 'Kevin',
  status: 'conversacion_abierta',
  additionalNotes: ''
});

const showEditColModal = ref(false);
const editingColumn = ref(null);
const editColumnForm = reactive({
  label: '',
  icon: '',
  color: '',
  final: false
});

const showDeleteColModal = ref(false);
const deletingColumn = ref(null);
const targetReassignColKey = ref('conversacion_abierta');

// Helper para detectar el canal del lead
function getLeadChannelInfo(lead) {
  const source = (lead.source || '').toLowerCase();
  const notes = (lead.additional_notes || '').toLowerCase();
  const topic = (lead.topic || '').toLowerCase();

  if (source.includes('whatsapp') || topic.includes('whatsapp') || notes.includes('whatsapp')) {
    return {
      type: 'whatsapp',
      label: lead.source || 'WhatsApp',
      icon: '💚',
      cssClass: 'channel-whatsapp'
    };
  }
  if (source.includes('instagram') || source.includes('ig') || topic.includes('instagram') || notes.includes('instagram')) {
    return {
      type: 'instagram',
      label: lead.source || 'Instagram',
      icon: '📸',
      cssClass: 'channel-instagram'
    };
  }
  if (source.includes('facebook') || source.includes('fb') || topic.includes('facebook') || notes.includes('facebook')) {
    return {
      type: 'facebook',
      label: lead.source || 'Facebook',
      icon: '📘',
      cssClass: 'channel-facebook'
    };
  }
  if (source.includes('meta') || notes.includes('meta')) {
    return {
      type: 'facebook',
      label: lead.source || 'Meta Ads',
      icon: '🌐',
      cssClass: 'channel-facebook'
    };
  }
  return {
    type: 'chat',
    label: lead.source || 'Directo',
    icon: '💬',
    cssClass: 'channel-direct'
  };
}

// Comprobación si un lead proviene de WhatsApp, Facebook o Instagram
function isConversationLead(lead) {
  const ch = getLeadChannelInfo(lead).type;
  return ch === 'whatsapp' || ch === 'facebook' || ch === 'instagram' || ch === 'chat';
}

// Estadísticas de Resumen
const totalLeadsCount = computed(() => leads.value.length);

const totalConversationsCount = computed(() => {
  return leads.value.filter(isConversationLead).length;
});

const whatsappCount = computed(() => {
  return leads.value.filter(l => getLeadChannelInfo(l).type === 'whatsapp').length;
});

const fbCount = computed(() => {
  return leads.value.filter(l => getLeadChannelInfo(l).type === 'facebook').length;
});

const igCount = computed(() => {
  return leads.value.filter(l => getLeadChannelInfo(l).type === 'instagram').length;
});

const igFbCount = computed(() => fbCount.value + igCount.value);

const scheduledAppointmentsCount = computed(() => {
  return leads.value.filter(l => l.status === 'cita_agendada').length;
});

const qualificationRate = computed(() => {
  if (leads.value.length === 0) return 0;
  const qualified = leads.value.filter(l =>
    l.status !== 'conversacion_abierta' &&
    l.status !== 'nuevo' &&
    l.status !== 'descartado' &&
    l.status !== 'perdido'
  ).length;
  return Math.round((qualified / leads.value.length) * 100);
});

// Agrupación y Mapeo de Leads en Columnas del Setter Funnel
/**
 * Estados que ya pertenecen al Funnel de Ventas: el lead "graduó" del Setter
 * Funnel y lo trabaja el closer. Se arma con las columnas REALES del tablero de
 * Ventas (`GET /api/funnel-columns`) y no con una lista fija: las columnas las
 * crea el equipo y sus claves se generan solas (`col_mtc2nwec_fij`), así que un
 * lead en "Seguimiento" o "Cotizado" no coincidía con nada y este tablero lo
 * devolvía a su primera columna, como si fuera un contacto sin calificar. Hasta
 * que la petición responda queda el respaldo de estados fijos.
 * `transferido_closer` NO entra nunca — es un lead que Avan pasó a una persona
 * SIN llegar a agendar, así que sigue siendo del setter (ver
 * `SETTER_ONLY_STATUSES` en `src/salesFunnelStage.js`).
 */
const salesColumns = ref([]);
const salesFunnelStatuses = computed(() => buildSalesFunnelStatuses(salesColumns.value));

/**
 * Etiqueta legible de una etapa del Funnel de Ventas, para no mostrar la clave
 * cruda (`col_mtc2nwec_fij`) en la ficha. Primero la columna real del tablero de
 * Ventas —es la que el equipo ve y renombra—, y si no está cargada, el nombre
 * fijo de los desenlaces conocidos.
 */
const SALES_FUNNEL_STATUS_LABELS = {
  cita_agendada: '📅 Cita agendada',
  en_negociacion: '🤝 En negociación',
  ganado: '🏆 Ganado',
  perdido: '❌ Perdido'
};

function salesStageLabel(status) {
  const column = salesColumns.value.find((c) => c.key === status);
  if (column) return `${column.icon || ''} ${column.label}`.trim();
  return SALES_FUNNEL_STATUS_LABELS[status] || status;
}

/**
 * Estado con el que un lead entra al funnel del closer. Es el mismo que pone
 * el bot cuando logra agendar: en LeadsView sólo `cita_agendada` gradúa al
 * Funnel de Ventas (`GRADUATED_STATUS_TO_SALES_COLUMN`), de modo que el pase
 * manual y el automático dejan el lead exactamente en el mismo sitio.
 */
const CLOSER_HANDOFF_STATUS = 'cita_agendada';

const filteredLeadsByColumn = computed(() => {
  const grouped = {};
  for (const col of columns.value) {
    grouped[col.key] = [];
  }

  const query = searchQuery.value.trim().toLowerCase();
  const channelFilter = selectedChannelFilter.value;
  const firstColKey = columns.value[0]?.key || 'conversacion_abierta';

  for (const lead of leads.value) {
    const channelInfo = getLeadChannelInfo(lead);

    // Filtro por Canal de Origen
    if (channelFilter !== 'all' && channelInfo.type !== channelFilter) {
      continue;
    }

    // Filtro por texto de búsqueda
    if (query) {
      const cleanId = query.replace(/^#/, '');
      const matchId = String(lead.id || '').includes(cleanId);
      const matchName = (lead.full_name || '').toLowerCase().includes(query);
      const matchTopic = (lead.topic || '').toLowerCase().includes(query);
      const matchEmail = (lead.email || '').toLowerCase().includes(query);
      const matchPhone = (lead.phone || '').toLowerCase().includes(query);
      const matchField = (lead.field_of_study || '').toLowerCase().includes(query);
      const matchUniversity = (lead.university || '').toLowerCase().includes(query);
      const matchChannel = (lead.source || '').toLowerCase().includes(query);
      const matchAssigned = (lead.assigned_to || '').toLowerCase().includes(query);

      if (!matchId && !matchName && !matchTopic && !matchEmail && !matchPhone && !matchField && !matchUniversity && !matchChannel && !matchAssigned) {
        continue;
      }
    }

    // Filtro por nivel de viabilidad
    if (selectedViabilityFilter.value !== 'all') {
      const lvl = (lead.viability_level || '').toLowerCase();
      if (selectedViabilityFilter.value === 'alta' && !lvl.includes('alta')) continue;
      if (selectedViabilityFilter.value === 'media' && !lvl.includes('media')) continue;
      if (selectedViabilityFilter.value === 'baja' && !lvl.includes('baja')) continue;
    }

    // Determinación de la Columna
    // Si el estado es 'conversacion_abierta' o 'nuevo' o similar etapa inicial, se ubica en la primera columna
    const status = lead.status || 'nuevo';

    // Ya graduó al Funnel de Ventas: este tablero no lo muestra, ni siquiera
    // como "Conversación Abierta". Se comprueba ANTES de cualquier otro encaje
    // porque los encajes de abajo son los que lo traían de vuelta: un lead en
    // "Seguimiento" (columna creada por el equipo) no coincidía con nada y caía
    // en la primera columna, y uno "En Negociación" aparecía como transferido al
    // closer. Para el setter eso se ve como un lead que volvió solo al funnel.
    //
    // Se pregunta por el LEAD y no por su estado: el sello `sales_funnel_at`
    // responde aunque la columna del lead ya no exista o aunque la petición de
    // columnas de Ventas haya fallado y `salesFunnelStatuses` esté vacío.
    if (leadHasGraduated(lead, salesFunnelStatuses.value)) continue;

    if (grouped[status]) {
      grouped[status].push(lead);
    } else if (status === 'nuevo' || status === 'inbox' || status === 'abierto') {
      // Leads nuevos de WhatsApp/Facebook/Instagram caen en la 1ra columna (Conversación Abierta)
      if (grouped[firstColKey]) {
        grouped[firstColKey].push(lead);
      }
    } else if (status === 'contactado' && grouped['calificando']) {
      // Único encaje de un estado ajeno que sobrevive: solo se aplica si el
      // tablero de Ventas NO tiene una columna "contactado" (si la tiene, el
      // lead ya salió por el `continue` de arriba). Los encajes de
      // `en_negociacion` → "Transferido al closer" y `perdido` → "Descartado"
      // se quitaron: ambos son desenlaces del Funnel de Ventas, y mostrarlos acá
      // era exactamente lo que hacía ver leads comerciales como leads del setter.
      grouped['calificando'].push(lead);
    } else {
      // Si no coincide, ubicar en la primera columna
      if (grouped[firstColKey]) {
        grouped[firstColKey].push(lead);
      }
    }
  }

  return grouped;
});

// Leads paginados por columna
const paginatedLeadsByColumn = computed(() => {
  const result = {};
  for (const col of columns.value) {
    const list = filteredLeadsByColumn.value[col.key] || [];
    if (itemsPerPage.value === 'all') {
      result[col.key] = list;
    } else {
      const page = getColumnPage(col.key);
      const limit = Number(itemsPerPage.value);
      const start = (page - 1) * limit;
      const end = start + limit;
      result[col.key] = list.slice(start, end);
    }
  }
  return result;
});

// Reajuste de páginas al cambiar filtros
watch([filteredLeadsByColumn, itemsPerPage], () => {
  for (const col of columns.value) {
    const totalPages = getColumnTotalPages(col.key);
    const currentPage = getColumnPage(col.key);
    if (currentPage > totalPages) {
      columnPages[col.key] = Math.max(1, totalPages);
    }
  }
}, { deep: true });

const availableTargetColumns = computed(() => {
  if (!deletingColumn.value) return columns.value;
  return columns.value.filter(c => c.key !== deletingColumn.value.key);
});

// Mover columnas
function moveColumnLeft(index) {
  if (index <= 0) return;
  const newCols = [...columns.value];
  const [removed] = newCols.splice(index, 1);
  newCols.splice(index - 1, 0, removed);
  columns.value = newCols;
  persistSetterColumns();
}

function moveColumnRight(index) {
  if (index >= columns.value.length - 1) return;
  const newCols = [...columns.value];
  const [removed] = newCols.splice(index, 1);
  newCols.splice(index + 1, 0, removed);
  columns.value = newCols;
  persistSetterColumns();
}

function scrollBoard(direction) {
  if (!kanbanBoardRef.value) return;
  const scrollAmount = 350;
  kanbanBoardRef.value.scrollBy({
    left: direction === 'left' ? -scrollAmount : scrollAmount,
    behavior: 'smooth'
  });
}

// Drag and Drop
/**
 * El lead que vuelve del botón de asignar trae ya el responsable resuelto por
 * el servidor. Se actualiza el objeto en su lugar —sin recargar el tablero—
 * para no perder la paginación ni el scroll de las columnas; la ficha abierta
 * suele ser el MISMO objeto, pero no siempre, así que se refresca aparte.
 */
function onLeadAssigned(updated) {
  const lead = leads.value.find((l) => l.id === updated.id);
  if (lead) Object.assign(lead, updated);
  if (selectedLead.value?.id === updated.id) Object.assign(selectedLead.value, updated);
}

function onDragStart(lead) {
  draggedLead.value = lead;
}

function onDragEnd() {
  draggedLead.value = null;
  hoveredColumn.value = null;
}

function onColumnDragLeave(colKey) {
  if (hoveredColumn.value === colKey) {
    hoveredColumn.value = null;
  }
}

async function onDrop(targetColKey) {
  if (!draggedLead.value) return;
  const leadToMove = draggedLead.value;
  const oldStatus = leadToMove.status;
  draggedLead.value = null;
  hoveredColumn.value = null;

  if (oldStatus === targetColKey) return;

  // Actualización optimista en UI
  leadToMove.status = targetColKey;

  try {
    const res = await apiFetch(`/api/leads/${leadToMove.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetColKey })
    });
    if (!res.ok) {
      throw new Error('Error al actualizar estado');
    }
    const data = await res.json();
    if (data.project) {
      projectToast.value = {
        id: data.project.id,
        topic: data.project.topic || leadToMove.topic
      };
    }
  } catch (err) {
    console.error('Error al mover lead:', err);
    leadToMove.status = oldStatus;
    alert('No se pudo guardar el cambio de etapa.');
  }
}

async function updateLeadStatusFromSelect(leadId, newStatus) {
  const lead = leads.value.find(l => l.id === leadId);
  if (!lead) return;
  const oldStatus = lead.status;
  lead.status = newStatus;

  try {
    const res = await apiFetch(`/api/leads/${leadId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Error al actualizar');
    const data = await res.json();
    if (data.project) {
      projectToast.value = {
        id: data.project.id,
        topic: data.project.topic || lead.topic
      };
    }
  } catch (err) {
    console.error('Error al actualizar status:', err);
    lead.status = oldStatus;
    alert('No se pudo actualizar el estado del lead.');
  }
}

const handingOff = ref(false);
const handoffToast = ref(null);

/**
 * Pase manual al funnel del closer, para cuando la reunión la agenda el propio
 * setter y no el bot. Hace lo mismo que `handleSchedulingTimeReply` del bot:
 * deja el lead en `cita_agendada`, que es el único estado que gradúa al Funnel
 * de Ventas.
 *
 * NO crea una reunión en `scheduled_meetings` a propósito: esa tabla alimenta
 * los recordatorios que el bot manda por WhatsApp, y una cita coordinada a
 * mano ya la está siguiendo la persona que la agendó — inventar ahí una fila
 * haría que el bot le escribiera al contacto por su cuenta.
 */
async function handOffToCloser(lead) {
  if (!lead || handingOff.value) return;
  const name = getLeadFullName(lead);
  const ok = window.confirm(
    `¿Pasar a "${name}" al Funnel de Ventas?

`
    + 'Úsalo cuando ya coordinaste la reunión por tu cuenta. El lead sale del Setter Funnel '
    + 'y el closer lo ve en la columna "Nuevo".'
  );
  if (!ok) return;

  handingOff.value = true;
  const previousStatus = lead.status;
  try {
    const res = await apiFetch(`/api/leads/${lead.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: CLOSER_HANDOFF_STATUS })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo pasar el lead al closer.');
    }
    lead.status = CLOSER_HANDOFF_STATUS;

    // Queda constancia de quién lo pasó y por qué: sin esto, en el Funnel de
    // Ventas el lead aparece con cita sin que nadie sepa de dónde salió. Si
    // falla, el pase ya se hizo — no tiene sentido revertirlo por la nota.
    try {
      await apiFetch(`/api/leads/${lead.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'Pasado manualmente al Funnel de Closer desde el Setter Funnel: la reunión se coordinó fuera del bot.'
        })
      });
    } catch (noteError) {
      console.warn('No se pudo registrar la nota del pase al closer:', noteError);
    }

    selectedLead.value = null;
    handoffToast.value = { name };
  } catch (err) {
    lead.status = previousStatus;
    alert(err.message);
  } finally {
    handingOff.value = false;
  }
}

// Modal Gestión de Columnas
function openCreateColumnModal(index = null) {
  insertAtIndex.value = (typeof index === 'number' && index >= 0 && index <= columns.value.length) ? index : null;
  newColumnForm.label = '';
  newColumnForm.icon = '🎯';
  newColumnForm.color = '#2C8C99';
  newColumnForm.final = false;
  showCreateColModal.value = true;
}

function saveNewColumn() {
  if (!newColumnForm.label.trim()) return;
  const key = 'setter_col_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
  const newCol = {
    key,
    label: newColumnForm.label.trim(),
    icon: newColumnForm.icon || '📌',
    color: newColumnForm.color || '#2C8C99',
    final: Boolean(newColumnForm.final),
    position: 0
  };
  const at = insertAtIndex.value;
  if (at !== null) {
    columns.value.splice(at, 0, newCol);
  } else {
    columns.value.push(newCol);
  }
  columns.value.forEach((c, i) => { c.position = i; });
  persistSetterColumns();
  showCreateColModal.value = false;
  insertAtIndex.value = null;
}

// Modal Nuevo Lead manual
function openCreateLeadModal() {
  leadFormError.value = '';
  leadForm.fullName = '';
  leadForm.phone = '';
  leadForm.email = '';
  leadForm.dni = '';
  leadForm.university = '';
  leadForm.career = '';
  leadForm.topic = '';
  leadForm.source = 'Manual';
  leadForm.assignedTo = 'Kevin';
  leadForm.status = columns.value[0]?.key || 'conversacion_abierta';
  leadForm.additionalNotes = '';
  showCreateLeadModal.value = true;
}

async function saveNewLead() {
  leadFormError.value = '';
  if (!leadForm.fullName.trim() || !leadForm.phone.trim()) {
    leadFormError.value = 'El nombre completo y el celular son obligatorios.';
    return;
  }
  isSavingLead.value = true;
  try {
    const payload = {
      fullName: leadForm.fullName.trim(),
      phone: leadForm.phone.trim(),
      email: leadForm.email.trim(),
      dni: leadForm.dni.trim(),
      university: leadForm.university.trim(),
      fieldOfStudy: leadForm.career.trim(),
      topic: leadForm.topic.trim() || `Asesoría para ${leadForm.fullName.trim()}`,
      source: leadForm.source.trim() || 'Manual',
      assignedTo: leadForm.assignedTo.trim() || 'Kevin',
      status: leadForm.status,
      additionalNotes: leadForm.additionalNotes.trim() || null
    };
    const res = await apiFetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar el lead.');
    showCreateLeadModal.value = false;
    await fetchAll();
  } catch (err) {
    leadFormError.value = err.message || 'Error al registrar el lead.';
  } finally {
    isSavingLead.value = false;
  }
}

function openEditColumnModal(col) {
  editingColumn.value = col;
  editColumnForm.label = col.label;
  editColumnForm.icon = col.icon || '📌';
  editColumnForm.color = col.color || '#2C8C99';
  editColumnForm.final = Boolean(col.final);
  showEditColModal.value = true;
}

function saveEditedColumn() {
  if (!editingColumn.value || !editColumnForm.label.trim()) return;
  const col = columns.value.find(c => c.key === editingColumn.value.key);
  if (col) {
    col.label = editColumnForm.label.trim();
    col.icon = editColumnForm.icon;
    col.color = editColumnForm.color;
    col.final = Boolean(editColumnForm.final);
  }
  persistSetterColumns();
  showEditColModal.value = false;
}

function openDeleteColumnModal(col) {
  deletingColumn.value = col;
  const remaining = columns.value.filter(c => c.key !== col.key);
  targetReassignColKey.value = remaining[0]?.key || 'conversacion_abierta';
  showDeleteColModal.value = true;
}

async function confirmDeleteColumn() {
  if (!deletingColumn.value) return;
  const colKey = deletingColumn.value.key;
  const targetKey = targetReassignColKey.value;

  // Reasignar leads que estaban en la columna eliminada
  for (const lead of leads.value) {
    if (lead.status === colKey) {
      lead.status = targetKey;
      apiFetch(`/api/leads/${lead.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: targetKey })
      }).catch(console.error);
    }
  }

  columns.value = columns.value.filter(c => c.key !== colKey);
  persistSetterColumns();
  showDeleteColModal.value = false;
  deletingColumn.value = null;
}

function confirmResetColumns() {
  if (!confirm('¿Restablecer las etapas de Setter Funnel a su configuración original?')) return;
  columns.value = JSON.parse(JSON.stringify(DEFAULT_SETTER_COLUMNS));
  persistSetterColumns();
}

function persistSetterColumns() {
  try {
    localStorage.setItem('setter_funnel_columns_v2', JSON.stringify(columns.value));
  } catch (e) {
    console.warn('No se pudo guardar columnas en localStorage:', e);
  }
}

function loadSetterColumns() {
  try {
    const saved = localStorage.getItem('setter_funnel_columns_v2');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        columns.value = parsed;
        return;
      }
    }
  } catch (e) {
    console.warn('Error al cargar columnas guardadas:', e);
  }
  columns.value = JSON.parse(JSON.stringify(DEFAULT_SETTER_COLUMNS));
}

/**
 * Columnas del tablero de Ventas. Este tablero no las dibuja: las necesita solo
 * para saber qué estados significan "ya es un lead comercial" y dejarlos fuera.
 * Si la petición falla no se interrumpe la carga de leads — queda el respaldo de
 * estados fijos de `buildSalesFunnelStatuses()`.
 */
async function fetchSalesColumns() {
  try {
    const res = await apiFetch('/api/funnel-columns');
    if (!res.ok) throw new Error('Error al obtener las columnas del Funnel de Ventas');
    const data = await res.json();
    salesColumns.value = Array.isArray(data.columns) ? data.columns : [];
  } catch (err) {
    console.warn('No se pudieron cargar las columnas del Funnel de Ventas:', err);
  }
}

// Fetch Leads & Data
async function fetchAll() {
  isLoading.value = true;
  loadError.value = '';
  try {
    const res = await apiFetch('/api/leads');
    if (!res.ok) throw new Error('Error al obtener leads del servidor');
    const data = await res.json();
    leads.value = Array.isArray(data.leads) ? data.leads : (Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('Error al cargar leads:', err);
    loadError.value = err.message || 'Error de conexión con el servidor.';
  } finally {
    isLoading.value = false;
  }
}

// Helpers de formateo
function getLeadFullName(lead) {
  if (lead.full_name && lead.full_name.trim()) return lead.full_name.trim();
  if (lead.name && lead.name.trim()) return lead.name.trim();
  if (lead.phone) return `Contacto (${lead.phone})`;
  return `Lead #${lead.id}`;
}

function getLevelClass(level) {
  const lvl = (level || '').toLowerCase();
  if (lvl.includes('alta')) return 'viability-high';
  if (lvl.includes('media')) return 'viability-medium';
  if (lvl.includes('baja')) return 'viability-low';
  return 'viability-unknown';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatClock(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Trae el hilo completo (contacto + Avan) del lead seleccionado desde la
 * tabla `whatsapp_messages`. El `phone` del lead ES el wa_id del contacto.
 */
function releaseBotChatMedia(keepIds) {
  for (const key of Object.keys(botChatMediaUrls)) {
    if (keepIds.has(Number(key))) continue;
    URL.revokeObjectURL(botChatMediaUrls[key]);
    delete botChatMediaUrls[key];
  }
}

async function hydrateBotChatMedia(messages) {
  const withMedia = messages.filter((m) => m.media_filename);
  releaseBotChatMedia(new Set(withMedia.map((m) => m.id)));
  for (const msg of withMedia) {
    if (botChatMediaUrls[msg.id]) continue;
    const url = await loadApiImage(`/api/whatsapp/messages/${msg.id}/media`);
    if (url) botChatMediaUrls[msg.id] = url;
  }
}

async function loadBotChat() {
  const waId = selectedLead.value?.phone;
  if (!waId) return;
  botChatLoading.value = true;
  botChatError.value = '';
  try {
    const response = await apiFetch(`/api/whatsapp/conversations/${encodeURIComponent(waId)}/messages`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo obtener la conversación.');
    botChatMessages.value = data.messages || [];
    await hydrateBotChatMedia(botChatMessages.value);
    await nextTick();
    if (botChatScrollEl.value) botChatScrollEl.value.scrollTop = botChatScrollEl.value.scrollHeight;
  } catch (err) {
    botChatError.value = err.message;
  } finally {
    botChatLoading.value = false;
  }
}

function stopBotChatPolling() {
  if (botChatTimer) {
    clearInterval(botChatTimer);
    botChatTimer = null;
  }
}

function toggleBotChat() {
  showBotChat.value = !showBotChat.value;
  if (showBotChat.value) {
    loadBotChat();
    stopBotChatPolling();
    botChatTimer = setInterval(loadBotChat, 12000);
  } else {
    stopBotChatPolling();
  }
}

// Al cambiar de lead (o cerrar la ficha) se colapsa y limpia el panel.
watch(selectedLead, () => {
  showBotChat.value = false;
  botChatMessages.value = [];
  botChatError.value = '';
  releaseBotChatMedia(new Set());
  stopBotChatPolling();
});

onBeforeUnmount(() => {
  stopBotChatPolling();
  releaseBotChatMedia(new Set());
});

onMounted(() => {
  loadSetterColumns();
  fetchSalesColumns();
  fetchAll();
});
</script>

<style scoped>
/* Contenedor Principal de la Página */
.kanban-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  max-width: 100%;
  box-sizing: border-box;
}

/* Header */
.kanban-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.header-titles {
  max-width: 760px;
}

.section-heading {
  font-size: 1.3rem;
  font-weight: 800;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
  letter-spacing: -0.02em;
}

.heading-icon {
  font-size: 1.45rem;
}

.section-subheading {
  font-size: 0.83rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Botones */
.btn-action-primary {
  background: linear-gradient(135deg, #2C8C99 0%, #56624A 100%);
  color: #FFFFFF;
  border: none;
  padding: 0.65rem 1.25rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.25s ease;
  box-shadow: 0 4px 14px rgba(158, 186, 75, 0.35);
}

.btn-action-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(158, 186, 75, 0.45);
}

.btn-action-secondary {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 0.65rem 1.15rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.btn-action-secondary:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--surface-4);
}

.btn-action-ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  padding: 0.65rem 1rem;
  border-radius: 12px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-ghost:hover {
  color: var(--text-main);
  background: var(--surface-2);
}

.btn-action-danger {
  background: var(--accent-rose);
  color: #fff;
  border: none;
  padding: 0.65rem 1.25rem;
  border-radius: 12px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.spin-animation {
  animation: spin 1s linear infinite;
  display: inline-block;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Banner de Métricas */
.funnel-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 0.8rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  backdrop-filter: blur(12px);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--surface-4);
}

.stat-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  flex-shrink: 0;
}

.stat-icon-wrapper.blue { background: rgba(111, 129, 37, 0.15); color: #56624A; }
.stat-icon-wrapper.green { background: rgba(46, 125, 70, 0.15); color: #2F7D5A; }
.stat-icon-wrapper.purple { background: rgba(111, 129, 37, 0.15); color: #6F8125; }
.stat-icon-wrapper.amber { background: rgba(201, 146, 46, 0.15); color: #C9922E; }
.stat-icon-wrapper.cyan { background: rgba(158, 186, 75, 0.15); color: #2C8C99; }

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat-value {
  font-size: 1.35rem;
  font-weight: 800;
  color: var(--text-main);
  line-height: 1.2;
}

/* Toolbar */
.kanban-toolbar {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.9rem;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  backdrop-filter: blur(12px);
}

.search-filter-box {
  display: flex;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.45rem 0.85rem;
  flex: 1;
  min-width: 240px;
  gap: 0.5rem;
}

.search-input {
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 0.88rem;
  width: 100%;
  outline: none;
}

.clear-search-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
}

/* Filtros por Canales */
.channel-filter-group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.channel-pill {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  padding: 0.45rem 0.85rem;
  border-radius: 20px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.channel-pill:hover {
  background: var(--surface-3);
  color: var(--text-main);
}

.channel-pill.active {
  background: rgba(158, 186, 75, 0.2);
  border-color: #2C8C99;
  color: #5AAEB8;
}

.channel-pill.whatsapp-pill.active {
  background: rgba(46, 125, 70, 0.22);
  border-color: #2F7D5A;
  color: var(--accent-emerald);
}

.channel-pill.fb-pill.active {
  background: rgba(111, 129, 37, 0.22);
  border-color: #56624A;
  color: var(--accent-cyan);
}

.channel-pill.ig-pill.active {
  background: rgba(138, 63, 40, 0.22);
  border-color: #8A3F28;
  color: var(--accent-pink);
}

/* Filtros por Viabilidad */
.filter-pills {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.filter-pill {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  padding: 0.4rem 0.75rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-pill.active {
  background: var(--surface-4);
  border-color: var(--surface-5);
  color: var(--text-main);
}

.items-per-page-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.items-select {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: 8px;
  padding: 0.35rem 0.6rem;
  font-size: 0.82rem;
  outline: none;
}

.board-nav-arrows {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.board-nav-btn {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
}

.board-nav-btn:hover {
  background: var(--surface-4);
}

.board-nav-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* Toast de Proyecto Creado */
.project-created-banner {
  background: linear-gradient(135deg, rgba(46, 125, 70, 0.2) 0%, rgba(158, 186, 75, 0.2) 100%);
  border: 1px solid #2F7D5A;
  border-radius: 14px;
  padding: 0.9rem 1.25rem;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  box-shadow: 0 10px 30px -10px rgba(46, 125, 70, 0.4);
}

.handoff-banner {
  background: linear-gradient(135deg, rgba(86, 98, 74, 0.22) 0%, rgba(44, 140, 153, 0.18) 100%);
  border-color: #56624A;
  box-shadow: 0 10px 30px -10px rgba(86, 98, 74, 0.4);
}

.handoff-closer-btn {
  flex: 1 0 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 9px;
  border: 1px solid #56624A;
  background: rgba(86, 98, 74, 0.14);
  color: var(--text-main);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.handoff-closer-btn:hover:not(:disabled) {
  background: rgba(86, 98, 74, 0.28);
}

.handoff-closer-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.handoff-done-hint {
  flex: 1 0 100%;
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.banner-icon {
  font-size: 1.6rem;
}

.banner-subtext {
  font-size: 0.85rem;
  color: var(--text-sub);
  margin: 0;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.banner-btn.primary {
  background: #2F7D5A;
  color: #fff;
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  text-decoration: none;
}

.banner-btn.secondary {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
}

/* Tablero Kanban */
.kanban-viewport {
  width: 100%;
  overflow-x: auto;
  padding-bottom: 1.5rem;
}

.kanban-columns-container {
  display: flex;
  gap: 0.35rem;
  align-items: flex-start;
  min-width: min-content;
}

/* Columna Kanban */
.kanban-column {
  width: 320px;
  min-width: 320px;
  max-width: 320px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 30px -15px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(14px);
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.kanban-column.is-first-setter-col {
  border-color: rgba(158, 186, 75, 0.4);
  background: linear-gradient(180deg, rgba(158, 186, 75, 0.06) 0%, var(--bg-card) 20%);
}

.kanban-column.is-drag-over {
  border-color: var(--col-accent);
  transform: scale(1.01);
  box-shadow: 0 0 25px rgba(158, 186, 75, 0.35);
}

.column-top-accent {
  height: 4px;
  width: 100%;
  background: var(--col-accent);
}

.kanban-column-header {
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.col-title-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.col-icon {
  font-size: 1.2rem;
  line-height: 1.3;
  flex-shrink: 0;
}

.col-label {
  flex: 1;
  min-width: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.3;
  /* Título casi completo: hasta 2 líneas antes de recortar */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.col-setter-badge {
  font-size: 0.68rem;
  color: #5AAEB8;
  font-weight: 600;
}

.col-count-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.15rem 0.55rem;
  border-radius: 12px;
  border: 1px solid;
  flex-shrink: 0;
  height: fit-content;
}

.col-actions-group {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  flex-wrap: wrap;
}

/* Insertador rápido de etapa entre columnas */
.col-inserter {
  align-self: stretch;
  min-height: 120px;
  width: 26px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.col-inserter-line {
  width: 2px;
  flex: 1;
  background: transparent;
  border-radius: 2px;
  transition: background 0.15s ease;
}

.col-inserter-plus {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface-3);
  color: var(--text-muted);
  border: 1px dashed var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1;
  margin: 0.35rem 0;
  transition: all 0.15s ease;
}

.col-inserter:hover .col-inserter-line {
  background: #2C8C99;
}

.col-inserter:hover .col-inserter-plus {
  background: #2C8C99;
  color: #fff;
  border-color: #2C8C99;
  transform: scale(1.15);
}

.insert-position-hint {
  font-size: 0.8rem;
  color: var(--text-sub);
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  margin: 0 0 0.25rem;
}

/* Formulario Nuevo Lead */
.lead-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem 1rem;
}

.lead-form-grid .form-group {
  margin-bottom: 0;
}

.lead-form-full {
  grid-column: 1 / -1;
}

.lead-notes-textarea {
  resize: vertical;
  min-height: 52px;
  font-family: inherit;
}

.lead-form-error {
  margin-bottom: 0.5rem;
}

@media (max-width: 560px) {
  .lead-form-grid {
    grid-template-columns: 1fr;
  }
}

.col-arrow-btn, .col-menu-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  transition: all 0.15s ease;
}

.col-arrow-btn:hover:not(:disabled), .col-menu-btn:hover {
  color: var(--text-main);
  background: var(--surface-3);
}

.col-arrow-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.col-menu-btn.delete-btn:hover {
  color: var(--accent-rose);
  background: rgba(200, 85, 50, 0.15);
}

/* Cuerpo de la Columna y Tarjetas */
.kanban-column-body {
  --lead-card-h: 52px;
  --lead-card-gap: 0.5rem;
  --column-visible-cards: 10;
  flex: 1;
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: var(--lead-card-gap);
  overflow-y: auto;
  min-height: calc(2 * var(--lead-card-h));
  /* Diez tarjetas + sus separaciones + el padding de arriba y abajo: lo que
     pase de ahí se ve al hacer scroll (o cambiando "Ver por pág"). */
  max-height: calc(
    var(--column-visible-cards) * var(--lead-card-h) +
    (var(--column-visible-cards) - 1) * var(--lead-card-gap) +
    1.2rem
  );
}

/* Altura fija (--lead-card-h): con todas las tarjetas iguales, el cuerpo de
   la columna se dimensiona para mostrar exactamente diez sin scroll. */
.kanban-lead-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  /* El margen derecho es la franja del círculo del responsable: reservada acá
     para que un nombre largo se recorte antes de pasarle por debajo. */
  padding: 0.5rem 2.4rem 0.5rem 0.7rem;
  cursor: grab;
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.2s ease;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.1rem;
  height: var(--lead-card-h);
  flex-shrink: 0;
  overflow: hidden;
}

.kanban-lead-card:hover {
  transform: translateY(-2px);
  border-color: var(--surface-5);
  box-shadow: var(--shadow-md);
}

.kanban-lead-card:active {
  cursor: grabbing;
}

.kanban-lead-card.channel-whatsapp-border {
  border-left: 3px solid #2F7D5A;
}

.kanban-lead-card.channel-fb-border {
  border-left: 3px solid #56624A;
}

.kanban-lead-card.channel-ig-border {
  border-left: 3px solid #8A3F28;
}

.kanban-lead-card.is-being-dragged {
  opacity: 0.4;
  transform: scale(0.96);
}

/* Responsable comercial: fuera del flujo, así la tarjeta conserva su alto. */
.card-assignee {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
}

.viability-pill {
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.15rem 0.45rem;
  border-radius: 8px;
}

.viability-high { background: rgba(46, 125, 70, 0.18); color: var(--accent-emerald); }
.viability-medium { background: rgba(201, 146, 46, 0.18); color: var(--accent-amber); }
.viability-low { background: rgba(200, 85, 50, 0.18); color: var(--accent-rose); }
.viability-unknown { background: var(--surface-2); color: var(--text-muted); }

/* Contenido de la tarjeta: lo mismo que el funnel de ventas. Un nombre largo
   se recorta en vez de crecer — si la tarjeta cambia de alto, dejan de entrar
   diez; el nombre completo va en el `title`. */
.card-lead-name {
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.3;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-lead-phone {
  font-family: var(--font-mono);
  font-size: 0.73rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Silueta Drop Preview */
.kanban-drop-silhouette {
  border: 2px dashed #2C8C99;
  background: rgba(158, 186, 75, 0.08);
  border-radius: 14px;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.silhouette-header-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.silhouette-badge {
  font-size: 0.75rem;
  color: #5AAEB8;
  font-weight: 700;
}

.silhouette-topic {
  font-size: 0.85rem;
  color: var(--text-main);
}

.silhouette-footer-line {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Estado Vacío de Columna */
.column-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 1rem;
  text-align: center;
  color: var(--text-muted);
}

.column-empty-state .empty-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  opacity: 0.6;
}

.column-empty-state .empty-text {
  font-size: 0.85rem;
  margin: 0;
}

.clear-search-link {
  background: transparent;
  border: none;
  color: #2C8C99;
  font-size: 0.8rem;
  margin-top: 0.5rem;
  cursor: pointer;
  text-decoration: underline;
}

/* Paginación de Columna */
.column-pagination-bar {
  padding: 0.5rem 0.85rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  background: var(--surface-1);
}

.col-page-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 0.72rem;
  cursor: pointer;
}

.col-page-btn:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--text-main);
}

.col-page-btn:disabled {
  opacity: 0.25;
}

.page-pills {
  display: flex;
  gap: 0.2rem;
}

.page-pill {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  min-width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.page-pill.active {
  background: #2C8C99;
  color: #fff;
}

.column-footer {
  padding: 0.6rem 1rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--surface-1);
}

.footer-left-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.footer-start-btn {
  background: transparent;
  border: none;
  color: #2C8C99;
  cursor: pointer;
  font-size: 0.72rem;
}

.final-tag {
  background: rgba(46, 125, 70, 0.15);
  color: var(--accent-emerald);
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  font-weight: 600;
}

/* Tarjeta Fantasma Añadir Etapa */
.add-column-ghost-card {
  width: 280px;
  min-width: 280px;
  border: 2px dashed var(--surface-4);
  border-radius: 18px;
  padding: 2rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--surface-1);
}

.add-column-ghost-card:hover {
  border-color: #2C8C99;
  background: rgba(158, 186, 75, 0.05);
}

.ghost-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
}

.ghost-plus {
  font-size: 1.8rem;
}

.ghost-text {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-main);
}

.ghost-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* Modales */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1.5rem;
}

:root[data-theme="dark"] .modal-overlay {
  background: rgba(0, 0, 0, 0.75);
}

.modal-content {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8);
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.column-modal-card {
  max-width: 480px;
}

.lead-modal-card {
  max-width: 700px;
}

.modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-title {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 8px;
}

.modal-close-btn:hover {
  background: var(--surface-3);
  color: var(--text-main);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-sub);
}

.custom-input, .custom-select {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: 10px;
  padding: 0.65rem 0.9rem;
  font-size: 0.9rem;
  outline: none;
}

.custom-input:focus, .custom-select:focus {
  border-color: #2C8C99;
}

.emoji-picker-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.4rem;
}

.emoji-option-btn {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.4rem;
  font-size: 1.2rem;
  cursor: pointer;
}

.emoji-option-btn.active {
  background: rgba(158, 186, 75, 0.2);
  border-color: #2C8C99;
}

.color-picker-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.4rem;
}

.color-option-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: bold;
}

.color-option-btn.active {
  border-color: var(--bg-card-solid);
  box-shadow: 0 0 0 2px var(--primary);
  transform: scale(1.08);
}

.checkbox-group {
  margin-top: 0.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.88rem;
  color: var(--text-main);
  cursor: pointer;
}

/* Modal Lead Detail */
.lead-modal-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.lead-modal-id {
  font-size: 1.1rem;
  font-weight: 800;
  color: #2C8C99;
  background: rgba(158, 186, 75, 0.15);
  padding: 0.2rem 0.6rem;
  border-radius: 8px;
}

.lead-modal-name {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--text-main);
  margin: 0;
}

.lead-modal-subtext {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
}

.setter-quick-bar {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.quick-contact-pills {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.setter-btn {
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  transition: all 0.2s ease;
}

.setter-btn.whatsapp-solid {
  background: #2F7D5A;
  color: #fff;
}

.setter-btn.whatsapp-solid:hover {
  background: #1F5A3F;
}

.setter-btn.email-solid {
  background: #56624A;
  color: #fff;
}

.setter-btn.email-solid:hover {
  background: #1F4E77;
}

/* El botón de WhatsApp ahora es un <button>: quita estilos nativos. */
button.setter-btn {
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.setter-btn.whatsapp-solid.is-active {
  background: #1F5A3F;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
}

/* ---- Ficha con panel de conversación al lado ---- */
.lead-modal-card.has-chat {
  max-width: 1080px;
}

.modal-body-split {
  flex-direction: row !important;
  align-items: stretch;
  gap: 1.25rem;
}

.lead-modal-primary {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}

.modal-body-split .lead-modal-primary {
  flex: 1 1 0;
}

.bot-chat-panel {
  flex: 0 0 360px;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  overflow: hidden;
}

.bot-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main);
  background: var(--surface-2, var(--surface-1));
  border-bottom: 1px solid var(--border-color);
}

.bot-chat-refresh {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  border-radius: 8px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}

.bot-chat-refresh:hover:not(:disabled) {
  color: var(--text-main);
}

.bot-chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 62vh;
  background:
    radial-gradient(circle at 20% 10%, rgba(47, 125, 90, 0.06), transparent 60%);
}

.bot-chat-empty {
  color: var(--text-muted);
  font-size: 0.82rem;
  text-align: center;
  margin: auto;
}

.bot-bubble {
  max-width: 85%;
  padding: 0.5rem 0.7rem;
  border-radius: 12px;
  font-size: 0.83rem;
  line-height: 1.4;
  word-break: break-word;
}

.bot-bubble.inbound {
  align-self: flex-start;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-bottom-left-radius: 4px;
}

.bot-bubble.outbound {
  align-self: flex-end;
  background: #2F7D5A;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.bot-bubble-text {
  margin: 0;
  white-space: pre-wrap;
}

.bot-bubble-image {
  display: block;
  max-width: 100%;
  max-height: 18rem;
  border-radius: 0.5rem;
  margin-bottom: 0.25rem;
}

.bot-bubble-attachment-link {
  display: inline-block;
  color: inherit;
  text-decoration: underline;
  margin-bottom: 0.25rem;
}

.bot-bubble-audio-tag {
  display: block;
  font-size: 0.65rem;
  opacity: 0.65;
  margin-bottom: 0.15rem;
}

.bot-bubble-time {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.66rem;
  opacity: 0.7;
}

@media (max-width: 900px) {
  .modal-body-split {
    flex-direction: column !important;
  }
  .bot-chat-panel {
    flex-basis: auto;
  }
  .bot-chat-scroll {
    max-height: 40vh;
  }
}

.stage-selector-box {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.stage-select {
  flex: 1;
  min-width: 220px;
}

.lead-details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.85rem;
}

.detail-item {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-item.full-width {
  grid-column: span 2;
}

/* El botón de asignar en la ficha no se estira a lo ancho de la celda: el
   área de clic es el círculo con el nombre. */
.detail-item > .lead-assignee {
  align-self: flex-start;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
}

.detail-value {
  font-size: 0.9rem;
  color: var(--text-main);
  font-weight: 500;
}

.highlight-topic {
  color: #5AAEB8;
  font-weight: 600;
}

.detail-notes-box {
  background: var(--surface-1);
  padding: 0.6rem;
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--text-sub);
  margin: 0;
  line-height: 1.4;
}

.viability-section-card {
  background: rgba(111, 129, 37, 0.06);
  border: 1px solid rgba(111, 129, 37, 0.25);
  border-radius: 12px;
  padding: 1rem;
}

.section-subtitle {
  font-size: 0.95rem;
  font-weight: 700;
  color: #56624A;
  margin: 0 0 0.6rem;
}

.viability-gauge-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.viability-badge-big {
  padding: 0.5rem 1rem;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.viability-score-num {
  font-size: 1.6rem;
  font-weight: 800;
}

.viability-level-text {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.viability-hint {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin: 0;
}

.modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

/* Scrollbar personalizado */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--surface-4);
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--surface-5);
}

@media (max-width: 768px) {
  .kanban-page-wrapper {
    padding: 1rem;
  }
  .lead-details-grid {
    grid-template-columns: 1fr;
  }
  .detail-item.full-width {
    grid-column: span 1;
  }
}
</style>
