<template>
  <main class="container-fluid kanban-page-wrapper">
    <!-- Header y Acciones Principales -->
    <header class="kanban-header">
      <div class="header-titles">
        <h2 class="section-heading">
          <span class="heading-icon">📇</span> Funnel de Ventas — Kanban de Leads
        </h2>
        <p class="section-subheading">
          Gestiona el flujo comercial de candidatos. Arrastra leads entre columnas, filtra por búsqueda, navega las páginas por etapa o crea columnas personalizadas.
        </p>
      </div>

      <div class="header-actions">
        <button class="btn-action-primary" @click="openCreateColumnModal">
          <span class="btn-icon">➕</span> Nueva Columna
        </button>
        <button class="btn-action-secondary" @click="fetchAll" :disabled="isLoading" title="Actualizar datos">
          <span :class="['btn-icon', { 'spin-animation': isLoading }]">🔄</span>
          {{ isLoading ? 'Cargando...' : 'Actualizar' }}
        </button>
        <button class="btn-action-ghost" @click="openMetaReconciliation" title="Comparar los leads de los formularios de Meta contra los que llegaron al CRM">
          🧮 Conciliar Meta
        </button>
        <button class="btn-action-ghost" @click="confirmResetColumns" title="Restablecer columnas originales">
          ⚙️ Restablecer
        </button>
      </div>
    </header>

    <!-- Banner de Métricas del Funnel -->
    <section class="funnel-stats-grid">
      <div class="stat-card">
        <div class="stat-icon-wrapper blue">📊</div>
        <div class="stat-info">
          <span class="stat-label">Total Leads</span>
          <span class="stat-value">{{ leads.length }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper green">🌟</div>
        <div class="stat-info">
          <span class="stat-label">Alta Viabilidad</span>
          <span class="stat-value">{{ highViabilityCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper amber">🚀</div>
        <div class="stat-info">
          <span class="stat-label">Proyectos Ganados</span>
          <span class="stat-value">{{ wonProjectsCount }}</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon-wrapper purple">📈</div>
        <div class="stat-info">
          <span class="stat-label">Promedio Viabilidad</span>
          <span class="stat-value">{{ avgViabilityScore }}%</span>
        </div>
      </div>
    </section>

    <!-- Barra de Filtros, Búsqueda y Control de Paginación -->
    <div class="kanban-toolbar">
      <div class="search-filter-box">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Buscar por tema, cliente, #ID, email, teléfono..."
        />
        <button v-if="searchQuery" class="clear-search-btn" @click="searchQuery = ''" title="Limpiar búsqueda">✕</button>
      </div>

      <!-- Badge de Resultados de Búsqueda -->
      <div v-if="searchQuery" class="search-result-badge">
        🎯 <strong>{{ totalMatchingLeads }}</strong> {{ totalMatchingLeads === 1 ? 'coincidencia' : 'coincidencias' }}
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

      <!-- Control Global de Tarjetas por Columna -->
      <div class="items-per-page-box">
        <span class="toolbar-label">Ver por pág:</span>
        <select v-model="itemsPerPage" class="items-select" title="Límite de tarjetas por columna">
          <option :value="10">10 leads</option>
          <option :value="20">20 leads</option>
          <option :value="30">30 leads</option>
          <option value="all">Ver todos</option>
        </select>
      </div>

      <!-- Flechas de navegación horizontal del tablero -->
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
      <h4>⚠️ No se pudo cargar el funnel</h4>
      <p>{{ loadError }}</p>
    </div>

    <!-- Toast de Proyecto Creado -->
    <transition name="toast-slide">
      <div v-if="projectToast" class="project-created-banner">
        <div class="banner-content">
          <span class="banner-icon">🎉</span>
          <div>
            <strong>¡Proyecto creado automáticamente!</strong>
            <p class="banner-subtext">"{{ projectToast.topic }}" se ha registrado como nuevo proyecto.</p>
          </div>
        </div>
        <div class="banner-actions">
          <router-link to="/admin/projects" class="banner-btn primary">Ver en Proyectos</router-link>
          <button class="banner-btn secondary" @click="projectToast = null">✕</button>
        </div>
      </div>
    </transition>

    <!-- Tablero Kanban Dinámico con Scroll Suave -->
    <div class="kanban-viewport custom-scrollbar" ref="kanbanBoardRef">
      <div class="kanban-columns-container">
        <!-- Columna de Kanban -->
        <div
          v-for="(col, colIndex) in columns"
          :key="col.key"
          class="kanban-column"
          :class="{
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

          <!-- Cabecera de Columna con Controles de Flechas y Opciones -->
          <div class="kanban-column-header">
            <div class="col-title-group">
              <span class="col-icon">{{ col.icon || '📌' }}</span>
              <span class="col-label" :title="col.label">{{ col.label }}</span>
              <span class="col-count-badge" :style="{ background: (col.color || '#56624A') + '22', color: col.color || '#56624A', borderColor: (col.color || '#56624A') + '55' }">
                {{ (filteredLeadsByColumn[col.key] || []).length }}
              </span>
            </div>

            <!-- Controles de Flechas y Menú de Columna -->
            <div class="col-actions-group">
              <!-- Flecha Mover Izquierda -->
              <button
                class="col-arrow-btn"
                :disabled="colIndex === 0"
                @click.stop="moveColumnLeft(colIndex)"
                title="Mover columna a la izquierda"
              >
                ◀
              </button>

              <!-- Flecha Mover Derecha -->
              <button
                class="col-arrow-btn"
                :disabled="colIndex === columns.length - 1"
                @click.stop="moveColumnRight(colIndex)"
                title="Mover columna a la derecha"
              >
                ▶
              </button>

              <!-- Botón Editar Columna -->
              <button
                class="col-menu-btn"
                @click.stop="openEditColumnModal(col, colIndex)"
                title="Editar nombre, icono o color de esta columna"
              >
                ✏️
              </button>

              <!-- Botón Eliminar Columna (si hay más de 1 columna) -->
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
              :class="{ 'is-being-dragged': draggedLead?.id === lead.id }"
              draggable="true"
              @dragstart="onDragStart(lead)"
              @dragend="onDragEnd"
              @click="selectedLead = lead"
            >
              <!-- La tarjeta dice lo mínimo para reconocer al lead y llamarlo;
                   todo lo demás (viabilidad, tema, pago, accesos) está en el
                   panel de detalle. Así entran cinco de un vistazo en la
                   columna, que es como se trabaja el tablero. -->
              <h4 class="card-lead-name" :title="getLeadFullName(lead)">
                {{ getLeadFullName(lead) }}
              </h4>
              <span class="card-lead-phone">📱 {{ lead.phone || 'Sin celular' }}</span>
            </div>

            <!-- Silueta de Destino al Arrastrar (Drop Silhouette Preview) -->
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
                <span>📥 Se ubicará en <strong>{{ col.label }}</strong></span>
              </div>
            </div>

            <!-- Estado Vacío dentro de la Columna -->
            <div v-if="(filteredLeadsByColumn[col.key] || []).length === 0 && (!draggedLead || hoveredColumn !== col.key)" class="column-empty-state">
              <span class="empty-icon">{{ searchQuery ? '🔍' : '📥' }}</span>
              <p class="empty-text">
                {{ searchQuery ? 'Sin coincidencias' : 'Arrastra leads aquí' }}
              </p>
              <button v-if="searchQuery" class="clear-search-link" @click="searchQuery = ''">
                Limpiar búsqueda
              </button>
            </div>
          </div>

          <!-- Barra de Paginación por Columna Mejorada -->
          <div v-if="getColumnTotalPages(col.key) > 1" class="column-pagination-bar">
            <!-- Botón Ir al Inicio (Página 1) -->
            <button
              class="col-page-btn nav-extreme-btn"
              :disabled="getColumnPage(col.key) <= 1"
              @click.stop="setColumnPage(col.key, 1)"
              title="Ir al inicio (Pág. 1)"
            >
              ⏮
            </button>

            <!-- Botón Anterior -->
            <button
              class="col-page-btn"
              :disabled="getColumnPage(col.key) <= 1"
              @click.stop="prevColumnPage(col.key)"
              title="Página anterior"
            >
              ◀
            </button>

            <!-- Pastillas de Páginas Inteligentes -->
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

            <!-- Botón Siguiente -->
            <button
              class="col-page-btn"
              :disabled="getColumnPage(col.key) >= getColumnTotalPages(col.key)"
              @click.stop="nextColumnPage(col.key)"
              title="Página siguiente"
            >
              ▶
            </button>

            <!-- Botón Ir al Final (Última Página) -->
            <button
              class="col-page-btn nav-extreme-btn"
              :disabled="getColumnPage(col.key) >= getColumnTotalPages(col.key)"
              @click.stop="setColumnPage(col.key, getColumnTotalPages(col.key))"
              title="Ir a la última página"
            >
              ⏭
            </button>
          </div>

          <!-- Pie de Columna (Indicador de Rango y Acceso Rápido a Inicio) -->
          <div class="column-footer">
            <div class="footer-left-info">
              <span class="footer-count">{{ getColumnRangeText(col.key) }}</span>
              <button
                v-if="getColumnPage(col.key) > 1"
                class="footer-start-btn"
                @click.stop="setColumnPage(col.key, 1)"
                title="Volver a la página 1 de esta columna"
              >
                ⏮ Inicio
              </button>
            </div>
            <span v-if="col.final" class="final-tag">🏆 Etapa Ganadora</span>
            <span v-if="col.quoted" class="quoted-tag">💰 Etapa de Cotización</span>
          </div>
        </div>

        <!-- Tarjeta Fantasma para Añadir Nueva Columna Rápido -->
        <div class="add-column-ghost-card" @click="openCreateColumnModal">
          <div class="ghost-content">
            <span class="ghost-plus">➕</span>
            <span class="ghost-text">Crear Nueva Etapa</span>
            <span class="ghost-hint">Añade una columna personalizada al funnel</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 1: Crear Nueva Columna                                      -->
    <!-- ================================================================= -->
    <div v-if="showCreateColModal" class="modal-overlay" @click.self="showCreateColModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">✨ Nueva Etapa del Funnel</h3>
          <button class="modal-close-btn" @click="showCreateColModal = false">✕</button>
        </div>
        <form @submit.prevent="saveNewColumn" class="modal-body">
          <div class="form-group">
            <label class="form-label">Nombre de la columna *</label>
            <input
              v-model="newColumnForm.label"
              type="text"
              class="form-input custom-input"
              placeholder="Ej: En Revisión Técnica, Propuesta Enviada, Cierre..."
              required
              autofocus
            />
          </div>

          <div class="form-group">
            <label class="form-label">Icono / Emoji</label>
            <div class="emoji-picker-grid">
              <button
                v-for="emoji in PRESET_EMOJIS"
                :key="emoji"
                type="button"
                class="emoji-choice-btn"
                :class="{ selected: newColumnForm.icon === emoji }"
                @click="newColumnForm.icon = emoji"
              >
                {{ emoji }}
              </button>
            </div>
            <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted);">O escribe uno personalizado:</span>
              <input
                v-model="newColumnForm.icon"
                type="text"
                class="form-input custom-input"
                style="width: 70px; text-align: center; font-size: 1.1rem; padding: 0.3rem;"
                maxlength="4"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Color de acento</label>
            <div class="color-picker-grid">
              <button
                v-for="color in PRESET_COLORS"
                :key="color.hex"
                type="button"
                class="color-choice-btn"
                :class="{ selected: newColumnForm.color === color.hex }"
                :style="{ background: color.hex }"
                :title="color.name"
                @click="newColumnForm.color = color.hex"
              ></button>
            </div>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input v-model="newColumnForm.final" type="checkbox" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa Ganadora</strong> (al mover un lead aquí, crea automáticamente su proyecto)</span>
            </label>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input v-model="newColumnForm.quoted" type="checkbox" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa de Cotización</strong> (al generar una cotización, el lead se mueve aquí solo)</span>
            </label>
          </div>

          <div class="modal-footer-actions">
            <button type="button" class="btn-action-ghost" @click="showCreateColModal = false">Cancelar</button>
            <button type="submit" class="btn-action-primary" :disabled="!newColumnForm.label.trim()">
              ➕ Crear Columna
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 2: Editar Columna Existente                                 -->
    <!-- ================================================================= -->
    <div v-if="showEditColModal && editingColumn" class="modal-overlay" @click.self="showEditColModal = false">
      <div class="modal-content column-modal-card">
        <div class="modal-header">
          <h3 class="modal-title">✏️ Editar Etapa: {{ editingColumn.label }}</h3>
          <button class="modal-close-btn" @click="showEditColModal = false">✕</button>
        </div>
        <form @submit.prevent="saveEditedColumn" class="modal-body">
          <div class="form-group">
            <label class="form-label">Nombre de la columna *</label>
            <input
              v-model="editColumnForm.label"
              type="text"
              class="form-input custom-input"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label">Icono / Emoji</label>
            <div class="emoji-picker-grid">
              <button
                v-for="emoji in PRESET_EMOJIS"
                :key="emoji"
                type="button"
                class="emoji-choice-btn"
                :class="{ selected: editColumnForm.icon === emoji }"
                @click="editColumnForm.icon = emoji"
              >
                {{ emoji }}
              </button>
            </div>
            <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 0.8rem; color: var(--text-muted);">O escribe uno personalizado:</span>
              <input
                v-model="editColumnForm.icon"
                type="text"
                class="form-input custom-input"
                style="width: 70px; text-align: center; font-size: 1.1rem; padding: 0.3rem;"
                maxlength="4"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Color de acento</label>
            <div class="color-picker-grid">
              <button
                v-for="color in PRESET_COLORS"
                :key="color.hex"
                type="button"
                class="color-choice-btn"
                :class="{ selected: editColumnForm.color === color.hex }"
                :style="{ background: color.hex }"
                :title="color.name"
                @click="editColumnForm.color = color.hex"
              ></button>
            </div>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input v-model="editColumnForm.final" type="checkbox" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa Ganadora</strong> (genera proyecto automático)</span>
            </label>
          </div>

          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input v-model="editColumnForm.quoted" type="checkbox" class="custom-checkbox" />
              <span>Marcar como <strong>Etapa de Cotización</strong> (el lead llega aquí al cotizarlo)</span>
            </label>
          </div>

          <div class="modal-footer-actions">
            <button type="button" class="btn-action-ghost" @click="showEditColModal = false">Cancelar</button>
            <button type="submit" class="btn-action-primary" :disabled="!editColumnForm.label.trim()">
              💾 Guardar Cambios
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL: Conciliación con Meta Lead Ads                             -->
    <!-- ================================================================= -->
    <!--
      Compara, formulario por formulario, los leads que Meta registró contra
      los que llegaron acá. El desglose por plataforma es el que contesta de
      un vistazo si lo que se pierde viene de Facebook o de Instagram, que es
      la pregunta que hoy obliga a exportar el CSV del Administrador de
      anuncios y cruzarlo a mano.
    -->
    <div v-if="showMetaRecModal" class="modal-overlay" @click.self="showMetaRecModal = false">
      <div class="modal-content column-modal-card" style="max-width: 760px;">
        <div class="modal-header">
          <h3 class="modal-title">🧮 Conciliación con Meta Lead Ads</h3>
          <button class="modal-close-btn" @click="showMetaRecModal = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="meta-rec-range">
            <label class="form-label" style="font-size: 0.8rem;">Desde</label>
            <input v-model="metaRecForm.since" type="date" class="form-control" />
            <label class="form-label" style="font-size: 0.8rem;">Hasta</label>
            <input v-model="metaRecForm.until" type="date" class="form-control" />
            <button class="btn-action-secondary" @click="runMetaReconciliation(false)" :disabled="metaRecLoading">
              {{ metaRecLoading ? 'Consultando…' : 'Comparar' }}
            </button>
          </div>
          <p class="section-subheading" style="margin: 0.5rem 0 1rem 0;">
            Las fechas son las del envío del formulario en Meta, no las de alta en el CRM. Vacías, compara todo lo que Meta conserva (90 días).
          </p>

          <div v-if="metaRecError" class="info-box" style="border-color: rgba(220, 90, 90, 0.4); background: rgba(220, 90, 90, 0.08);">
            <p style="color: var(--accent-rose); font-size: 0.85rem; margin: 0;">{{ metaRecError }}</p>
          </div>

          <template v-if="metaRecReport">
            <div class="meta-rec-totals">
              <div class="stat-card">
                <div class="stat-info">
                  <span class="stat-label">En Meta</span>
                  <span class="stat-value">{{ metaRecReport.totals.en_meta }}</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-info">
                  <span class="stat-label">En el CRM</span>
                  <span class="stat-value">{{ metaRecReport.totals.en_crm }}</span>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-info">
                  <span class="stat-label">Faltantes</span>
                  <span class="stat-value" :style="{ color: metaRecReport.totals.faltantes ? 'var(--accent-rose)' : 'var(--accent-green)' }">
                    {{ metaRecReport.totals.faltantes }}
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
                <tr v-for="(row, platform) in metaRecReport.by_platform" :key="platform">
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
                <tr v-for="form in metaRecReport.forms" :key="form.form_id">
                  <td>
                    {{ form.nombre || form.form_id }}
                    <span v-if="form.error" style="color: var(--accent-rose);" :title="form.error">⚠️</span>
                  </td>
                  <td>{{ form.en_meta }}</td>
                  <td>{{ form.en_crm }}</td>
                  <td :style="{ color: form.faltantes ? 'var(--accent-rose)' : 'inherit' }">{{ form.faltantes }}</td>
                </tr>
              </tbody>
            </table>

            <div v-if="metaRecReport.applied" class="info-box" style="margin-top: 1rem; border-color: rgba(70, 180, 120, 0.4); background: rgba(70, 180, 120, 0.08);">
              <p style="color: var(--accent-green); font-size: 0.85rem; margin: 0;">
                Se recuperaron {{ metaRecReport.totals.importados }} lead(s).
                <template v-if="metaRecReport.totals.fallidos">{{ metaRecReport.totals.fallidos }} fallaron.</template>
                Entran al Setter Funnel como "conversación abierta".
              </p>
            </div>

            <div class="modal-footer-actions">
              <button type="button" class="btn-action-ghost" @click="showMetaRecModal = false">Cerrar</button>
              <button
                type="button"
                class="btn-action-primary"
                :disabled="metaRecLoading || !metaRecReport.totals.faltantes"
                @click="runMetaReconciliation(true)"
              >
                Recuperar {{ metaRecReport.totals.faltantes }} lead(s) faltante(s)
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 3: Eliminar Columna con Reasignación de Leads               -->
    <!-- ================================================================= -->
    <div v-if="showDeleteColModal && deletingColumn" class="modal-overlay" @click.self="showDeleteColModal = false">
      <div class="modal-content column-modal-card" style="max-width: 480px;">
        <div class="modal-header">
          <h3 class="modal-title" style="color: var(--accent-rose);">🗑️ Eliminar Columna</h3>
          <button class="modal-close-btn" @click="showDeleteColModal = false">✕</button>
        </div>
        <div class="modal-body">
          <p style="color: var(--text-main); font-size: 0.95rem; margin-bottom: 1rem;">
            ¿Estás seguro de eliminar la etapa <strong>"{{ deletingColumn.icon }} {{ deletingColumn.label }}"</strong>?
          </p>

          <div v-if="getLeadsCountInColumn(deletingColumn.key) > 0" class="info-box" style="border-color: rgba(201, 146, 46, 0.4); background: rgba(201, 146, 46, 0.08); margin-bottom: 1.25rem;">
            <p style="color: var(--accent-amber); font-size: 0.85rem; margin: 0 0 0.5rem 0;">
              ⚠️ Esta columna contiene <strong>{{ getLeadsCountInColumn(deletingColumn.key) }} lead(s)</strong>.
            </p>
            <label class="form-label" style="font-size: 0.8rem; margin-bottom: 0.3rem;">Reasignar estos leads a:</label>
            <select v-model="targetReassignColKey" class="form-select custom-select">
              <option
                v-for="col in availableTargetColumns"
                :key="col.key"
                :value="col.key"
              >
                {{ col.icon }} {{ col.label }}
              </option>
            </select>
          </div>

          <div class="modal-footer-actions">
            <button type="button" class="btn-action-ghost" @click="showDeleteColModal = false">Cancelar</button>
            <button type="button" class="btn-action-danger" @click="confirmDeleteColumn">
              Eliminar Columna
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================================================================= -->
    <!-- MODAL 4: Detalle del Lead y Acciones                              -->
    <!-- ================================================================= -->
    <div v-if="selectedLead" class="modal-overlay" @click.self="selectedLead = null">
      <div class="modal-content lead-detail-card" :class="{ 'has-chat': showBotChat }">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <span class="lead-id-tag">Lead #{{ selectedLead.id }}</span>
            <span :class="['viability-pill', getLevelClass(selectedLead.viability_level)]">
              {{ selectedLead.overall_viability_score ?? '—' }}% Viabilidad
            </span>
          </div>
          <button class="modal-close-btn" @click="selectedLead = null">✕</button>
        </div>

        <div class="modal-body" :class="{ 'modal-body-split': showBotChat }">
         <div class="lead-modal-primary">
          <div class="modal-lead-title-area">
            <h3 class="modal-lead-name">
              👤 {{ getLeadFullName(selectedLead) }}
              <!-- Los datos del lead son los que salen impresos en la
                   cotización y en el contrato: se corrigen acá mismo, antes
                   de emitirla, y no en otra pantalla. -->
              <button v-if="!leadEdit" type="button" class="lead-edit-btn" title="Editar los datos del lead" @click="startLeadEdit">
                ✏️ Editar datos
              </button>
            </h3>
            <p v-if="selectedLead.topic && selectedLead.topic.trim().toLowerCase() !== (selectedLead.full_name || '').trim().toLowerCase()" class="modal-lead-topic-sub">
              📄 {{ selectedLead.topic }}
            </p>
          </div>

          <!-- Edición de los datos del lead -->
          <form v-if="leadEdit" class="lead-edit-form" @submit.prevent="saveLeadEdit">
            <div class="lead-edit-grid">
              <label class="lead-edit-field">
                <span>Nombre completo</span>
                <input v-model="leadEdit.fullName" type="text" class="form-input custom-input" />
              </label>
              <label class="lead-edit-field">
                <span>DNI</span>
                <input v-model="leadEdit.dni" type="text" class="form-input custom-input" />
              </label>
              <label class="lead-edit-field">
                <span>Correo</span>
                <input v-model="leadEdit.email" type="email" class="form-input custom-input" />
              </label>
              <label class="lead-edit-field">
                <span>Celular</span>
                <input v-model="leadEdit.phone" type="text" class="form-input custom-input" />
              </label>
              <label class="lead-edit-field">
                <span>Universidad</span>
                <input v-model="leadEdit.university" type="text" class="form-input custom-input" placeholder="Ej: Universidad Continental" />
              </label>
              <label class="lead-edit-field">
                <span>Nivel académico</span>
                <select v-model="leadEdit.academicLevel" class="form-select custom-select">
                  <option v-for="level in ACADEMIC_LEVELS" :key="level" :value="level">{{ level }}</option>
                </select>
              </label>
              <label class="lead-edit-field lead-edit-field--wide">
                <span>Carrera / especialidad</span>
                <select v-model="leadEdit.fieldOfStudy" class="form-select custom-select">
                  <optgroup v-for="group in careerGroupsWith(leadEdit.fieldOfStudy)" :key="group.label" :label="group.label">
                    <option v-for="career in group.careers" :key="career" :value="career">{{ career }}</option>
                  </optgroup>
                </select>
              </label>
              <label class="lead-edit-field lead-edit-field--wide">
                <span>Tema de tesis</span>
                <input v-model="leadEdit.topic" type="text" class="form-input custom-input" />
              </label>
            </div>
            <p v-if="leadEditError" class="lead-edit-error">{{ leadEditError }}</p>
            <div class="lead-edit-actions">
              <button type="button" class="btn-action-ghost" @click="leadEdit = null">Cancelar</button>
              <button type="submit" class="btn-action-primary" :disabled="leadEditSaving">
                {{ leadEditSaving ? 'Guardando…' : 'Guardar datos' }}
              </button>
            </div>
          </form>

          <div v-else class="lead-info-grid">
            <div class="info-card-panel">
              <h5 class="panel-subtitle">👤 Contacto</h5>
              <div v-if="selectedLead.full_name" class="info-item">
                <span class="info-label">Nombre Completo:</span>
                <span class="info-value selectable" style="font-weight: 600;">{{ selectedLead.full_name }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span class="info-value selectable">{{ selectedLead.email || '—' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Celular:</span>
                <span class="info-value selectable">{{ selectedLead.phone || '—' }}</span>
              </div>
              <div v-if="selectedLead.dni" class="info-item">
                <span class="info-label">DNI:</span>
                <span class="info-value selectable">{{ selectedLead.dni }}</span>
              </div>
              <div v-if="selectedLead.assigned_to" class="info-item">
                <span class="info-label">Asignado a:</span>
                <span class="info-value selectable">{{ selectedLead.assigned_to }}</span>
              </div>
            </div>

            <div class="info-card-panel">
              <h5 class="panel-subtitle">🎓 Datos Académicos</h5>
              <div class="info-item">
                <span class="info-label">Nivel:</span>
                <span class="info-value">{{ selectedLead.academic_level }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Carrera:</span>
                <span class="info-value">{{ selectedLead.field_of_study || '—' }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Universidad:</span>
                <span class="info-value">{{ selectedLead.university || '—' }}</span>
              </div>
            </div>
          </div>

          <div v-if="selectedLead.additional_notes" class="lead-notes-box">
            <h5 class="panel-subtitle">📝 Notas Adicionales</h5>
            <p>{{ selectedLead.additional_notes }}</p>
          </div>

          <div v-if="selectedLead.project_id" class="lead-project-badge-box">
            <span style="font-size: 1.2rem;">🚀</span>
            <div>
              <strong>Proyecto Activo #{{ selectedLead.project_id }}</strong>
              <p style="margin: 0; font-size: 0.8rem; color: var(--text-muted);">
                Estado del proyecto: {{ selectedLead.project_status }}
              </p>
            </div>
            <router-link :to="`/admin/projects/${selectedLead.project_id}`" class="btn-action-secondary" style="font-size: 0.78rem; padding: 0.35rem 0.8rem; margin-left: auto; text-decoration: none;">
              Abrir Proyecto
            </router-link>
          </div>

          <!-- Selector de Estado del Funnel -->
          <div class="form-group" style="margin-top: 1.25rem;">
            <label class="form-label">Mover etapa en el Funnel</label>
            <select
              :value="selectedLead.status"
              class="form-select custom-select"
              @change="moveLeadToStatusOrWin(selectedLead, $event.target.value)"
            >
              <option v-for="col in columns" :key="col.key" :value="col.key">
                {{ col.icon }} {{ col.label }}
              </option>
            </select>
          </div>

          <!-- Historial de etapas: de dónde salió y quién lo movió. Está
               junto al selector porque es la pregunta que se hace justo ahí
               ("yo lo dejé en otra columna"). -->
          <div class="stage-history-section">
            <button
              type="button"
              class="stage-history-toggle"
              :class="{ 'is-open': showStageHistory }"
              @click="toggleStageHistory"
            >
              🕒 {{ showStageHistory ? 'Ocultar historial de etapas' : 'Ver historial de etapas' }}
            </button>

            <div v-if="showStageHistory" class="stage-history-body">
              <p v-if="stageHistoryLoading" class="stage-history-empty">Cargando…</p>
              <p v-else-if="stageHistoryError" class="stage-history-empty is-error">{{ stageHistoryError }}</p>
              <p v-else-if="stageHistory.length === 0" class="stage-history-empty">
                Sin movimientos registrados desde que existe la bitácora.
              </p>
              <ul v-else class="stage-history-list">
                <li
                  v-for="entry in stageHistory"
                  :key="entry.id"
                  class="stage-history-item"
                  :class="{ 'is-blocked': entry.blocked }"
                >
                  <div class="stage-history-move">
                    <span class="stage-from">{{ stageLabel(entry.fromStatus) }}</span>
                    <span class="stage-arrow">→</span>
                    <span class="stage-to">{{ stageLabel(entry.toStatus) }}</span>
                    <span v-if="entry.blocked" class="stage-blocked-tag">bloqueado</span>
                  </div>
                  <div class="stage-history-meta">
                    {{ stageActorLabel(entry) }} · {{ formatStageDate(entry.createdAt) }}
                  </div>
                  <p v-if="entry.reason" class="stage-history-reason">{{ entry.reason }}</p>
                </li>
              </ul>
            </div>
          </div>

          <!-- Primer pago: el vendedor ve en qué va y sube el voucher sin
               entrar a Finanzas. Vivía en la tarjeta del tablero, que ahora
               solo lleva nombre y celular. -->
          <div v-if="selectedLead.initial_payment_id" class="detail-payment-row">
            <span :class="['payment-chip', paymentChipClass(selectedLead.initial_payment_estado)]">
              1er pago · {{ paymentChipLabel(selectedLead.initial_payment_estado) }}
            </span>
            <label
              v-if="selectedLead.initial_payment_estado === 'pendiente'"
              class="payment-upload-btn"
              :title="voucherUploading === selectedLead.id ? 'Subiendo...' : 'Subir el voucher del primer pago'"
            >
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                :disabled="voucherUploading === selectedLead.id"
                @change="(e) => uploadVoucher(selectedLead, e)"
              />
              {{ voucherUploading === selectedLead.id ? '…' : '📎 Subir voucher' }}
            </label>
          </div>

          <!-- Bitácora del seguimiento: en qué se quedó este lead -->
          <LeadNotes :lead-id="selectedLead.id" class="lead-notes-panel" />

          <!-- Conversación con el bot de WhatsApp (Avan) -->
          <div v-if="selectedLead.phone" class="bot-chat-section">
            <button
              type="button"
              class="bot-chat-toggle"
              :class="{ 'is-open': showBotChat }"
              @click="toggleBotChat"
            >
              💬 {{ showBotChat ? 'Ocultar conversación con el bot' : 'Ver conversación con el bot' }}
              <span class="bot-chat-toggle-phone">{{ selectedLead.phone }}</span>
            </button>
          </div>

          <!-- Botones de Contacto y Cotización -->
          <div class="lead-action-buttons">
            <a
              :href="'mailto:' + selectedLead.email"
              class="btn-action-secondary"
              style="text-decoration: none;"
            >
              ✉️ Enviar Correo
            </a>
            <a
              :href="'https://wa.me/' + normalizePhone(selectedLead.phone)"
              target="_blank"
              rel="noopener"
              class="btn-action-secondary"
              style="text-decoration: none;"
            >
              💬 WhatsApp
            </a>
            <button
              v-if="!showQuoteForm"
              type="button"
              class="btn-action-primary"
              @click="showQuoteForm = true"
            >
              💰 Generar Cotización
            </button>
            <router-link
              v-if="hasPermission('contracts.manage')"
              :to="{ path: '/admin/contracts', query: { leadId: selectedLead.id } }"
              class="btn-action-secondary"
              style="text-decoration: none;"
            >
              📄 Generar contrato
            </router-link>
          </div>

          <!-- Formulario de Cotización Integrado -->
          <transition name="fade">
            <form v-if="showQuoteForm" class="quote-form-section" @submit.prevent="submitQuote">
              <h4 class="quote-heading">💰 Nueva Cotización Comercial</h4>

              <!-- Tipo de trabajo: elige qué se cotiza y con eso cambian los
                   entregables y los textos base del documento. -->
              <div class="form-group">
                <label class="form-label">¿Qué se está cotizando?</label>
                <div class="quote-type-switch" role="radiogroup" aria-label="Tipo de trabajo a cotizar">
                  <button
                    v-for="pkg in QUOTE_PACKAGES"
                    :key="pkg.key"
                    type="button"
                    role="radio"
                    :aria-checked="quotePackage === pkg.key"
                    class="quote-type-option"
                    :class="{ 'is-active': quotePackage === pkg.key }"
                    @click="selectQuotePackage(pkg.key)"
                  >
                    <span class="quote-type-icon">{{ pkg.icon }}</span>
                    <span class="quote-type-text">
                      <strong>{{ pkg.label }}</strong>
                      <em>{{ pkg.hint }}</em>
                    </span>
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Servicio *</label>
                <input v-model="quoteConcept" type="text" class="form-input custom-input" required />
              </div>
              <div class="form-group">
                <label class="form-label">Bajada del servicio</label>
                <input v-model="quoteServiceSubtitle" type="text" class="form-input custom-input" />
              </div>

              <!-- Entregables: se marcan o desmarcan y así salen impresos. -->
              <div class="form-group">
                <div class="quote-check-head">
                  <span class="form-label quote-check-title">
                    Entregables incluidos
                    <span class="quote-check-count">{{ quoteDeliverables.length }} de {{ activeDeliverables.length }}</span>
                  </span>
                  <label class="quote-check-all" :class="{ 'is-on': allDeliverablesChecked }">
                    <input
                      type="checkbox"
                      class="quote-check-input"
                      :checked="allDeliverablesChecked"
                      :indeterminate.prop="someDeliverablesChecked"
                      @change="toggleAllDeliverables($event.target.checked)"
                    />
                    <span class="quote-check-box" aria-hidden="true"></span>
                    <span>{{ allDeliverablesChecked ? 'Quitar todos' : 'Marcar todos' }}</span>
                  </label>
                </div>
                <ul class="quote-check-list">
                  <li v-for="item in activeDeliverables" :key="item.key">
                    <label class="quote-check" :class="{ 'is-checked': quoteDeliverables.includes(item.key) }">
                      <input type="checkbox" class="quote-check-input" :value="item.key" v-model="quoteDeliverables" />
                      <span class="quote-check-box" aria-hidden="true"></span>
                      <span class="quote-check-text">
                        <strong>{{ item.label }}</strong>
                        <em>{{ item.description }}</em>
                      </span>
                    </label>
                  </li>
                </ul>
                <textarea
                  v-model="quoteScope"
                  class="form-textarea custom-input"
                  rows="2"
                  placeholder="Otros entregables, uno por línea (Ej: Artículo científico: Redacción para revista indexada.)"
                ></textarea>
              </div>

              <div class="quote-field-row">
                <div class="form-group">
                  <label class="form-label">Precio regular</label>
                  <input v-model="quoteRegularAmount" type="number" min="0" step="0.01" class="form-input custom-input" placeholder="Ej: 7000" />
                </div>
                <div class="form-group">
                  <label class="form-label">Precio final acordado *</label>
                  <input v-model="quoteAmount" type="number" min="1" step="0.01" class="form-input custom-input" placeholder="Ej: 6000" required />
                </div>
                <div class="form-group" style="width: 110px;">
                  <label class="form-label">Moneda</label>
                  <select v-model="quoteCurrency" class="form-select custom-select">
                    <option value="PEN">S/ (PEN)</option>
                    <option value="USD">US$ (USD)</option>
                  </select>
                </div>
              </div>
              <p v-if="quoteDiscount > 0" class="quote-discount-hint">
                Descuento exclusivo que verá el cliente: <strong>{{ formatCurrency(quoteDiscount, quoteCurrency) }}</strong>.
              </p>

              <div class="quote-field-row">
                <div class="form-group">
                  <label class="form-label">Código</label>
                  <input v-model="quoteCode" type="text" class="form-input custom-input" placeholder="Ej: 51-SET-VL" />
                </div>
                <div class="form-group">
                  <label class="form-label">Tiempo estimado</label>
                  <input v-model="quoteEstimatedTime" type="text" class="form-input custom-input" placeholder="Ej: 1 mes" />
                </div>
              </div>
              <div class="quote-field-row">
                <div class="form-group">
                  <label class="form-label">Estado de la cotización</label>
                  <input v-model="quoteStatusLabel" type="text" class="form-input custom-input" placeholder="Ej: Aprobada para gestión" />
                </div>
                <div class="form-group">
                  <label class="form-label">Vigencia de la oferta</label>
                  <input v-model="quoteValidUntil" type="date" class="form-input custom-input" />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Garantía y asesoría continua</label>
                <textarea v-model="quoteWarranty" class="form-textarea custom-input" rows="2"></textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Condiciones comerciales (una por línea)</label>
                <textarea v-model="quoteTerms" class="form-textarea custom-input" rows="3"></textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Observaciones (opcional)</label>
                <textarea
                  v-model="quoteNotes"
                  class="form-textarea custom-input"
                  rows="2"
                  placeholder="Condiciones particulares, acuerdos puntuales, etc."
                ></textarea>
              </div>
              <div style="display: flex; gap: 0.6rem; justify-content: flex-end;">
                <button type="button" class="btn-action-ghost" @click="showQuoteForm = false">Cancelar</button>
                <button type="submit" class="btn-action-primary" :disabled="quoteSubmitting">
                  {{ quoteSubmitting ? 'Generando...' : 'Generar y Enviar' }}
                </button>
              </div>
            </form>
          </transition>

          <div v-if="quoteSuccess" class="info-box" style="margin-top: 1rem; border-color: rgba(46, 125, 70, 0.4); background: rgba(46, 125, 70, 0.08);">
            <p style="color: var(--accent-emerald); margin: 0 0 0.6rem; font-size: 0.88rem;">
              ✅ Cotización de <strong>{{ formatCurrency(quoteSuccess.amount, quoteSuccess.currency) }}</strong> enviada con éxito a <strong>{{ selectedLead.email }}</strong>.
            </p>
            <p v-if="quoteMove" class="quote-move-line">
              El lead pasó a <strong>{{ quoteMove.label }}</strong>.
              <button type="button" class="quote-undo-btn" :disabled="quoteMoveUndoing" @click="undoQuoteMove">
                {{ quoteMoveUndoing ? 'Deshaciendo…' : 'Deshacer' }}
              </button>
            </p>
            <p v-else-if="!quotedColumn" class="quote-move-line quote-move-hint">
              Ninguna columna es la etapa de cotización, así que el lead no se movió. Marca una con
              <strong>💰 Etapa de Cotización</strong> al editarla, o nómbrala "Con cotización" y se usará sola.
            </p>

            <button
              type="button"
              class="btn-action-secondary"
              style="font-size: 0.8rem;"
              :disabled="quoteDocLoading"
              @click="openQuoteDocument(quoteSuccess.id)"
            >
              {{ quoteDocLoading ? 'Abriendo…' : '📄 Ver / Descargar cotización (PDF)' }}
            </button>
          </div>

          <!-- Historial: hasta ahora una cotización generada solo existía en la
               pestaña que se abría con el documento. -->
          <div v-if="quoteHistory.length" class="quote-history">
            <h4 class="quote-history-title">Cotizaciones emitidas ({{ quoteHistory.length }})</h4>
            <ul class="quote-history-list">
              <li v-for="q in quoteHistory" :key="q.id" class="quote-history-item">
                <div class="quote-history-main">
                  <span class="quote-history-number">{{ formatQuoteNumber(q) }}</span>
                  <span class="quote-history-amount">{{ formatCurrency(q.amount, q.currency) }}</span>
                </div>
                <div class="quote-history-meta">
                  <span>{{ formatDateShort(q.created_at) }}</span>
                  <span v-if="q.concept_title">· {{ q.concept_title }}</span>
                  <span v-if="isQuoteExpired(q)" class="quote-history-expired">· vencida</span>
                  <span v-else-if="q.valid_until">· vence {{ formatDateShort(q.valid_until) }}</span>
                </div>
                <button
                  type="button"
                  class="quote-history-open"
                  :disabled="quoteDocLoading"
                  @click="openQuoteDocument(q.id)"
                >📄 Abrir</button>
              </li>
            </ul>
          </div>
          <p v-else-if="quoteHistoryLoading" class="quote-history-empty">Cargando cotizaciones…</p>
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
                <p class="bot-bubble-text">{{ msg.body }}</p>
                <span class="bot-bubble-time">
                  {{ msg.direction === 'outbound' ? 'Avan' : 'Contacto' }} · {{ formatClock(msg.received_at) }}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>

    <!-- Cierre de venta: monto del primer pago al pasar el lead a la etapa ganadora -->
    <WinDealModal
      v-if="winModalLead"
      :lead="winModalLead"
      @close="winModalLead = null"
      @won="onDealWon"
    />
  </main>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { apiFetch } from '../apiClient.js';
import { QUOTE_PACKAGES, DEFAULT_QUOTE_PACKAGE, findQuotePackage, deliverableLine } from '../data/quoteDeliverables.js';
import { careerGroupsWith, DEFAULT_CAREER } from '../data/careers.js';
import { hasPermission } from '../auth.js';
import WinDealModal from '../components/WinDealModal.vue';
import LeadNotes from '../components/LeadNotes.vue';
import { SETTER_ONLY_STATUSES } from '../salesFunnelStage.js';

// Columnas predeterminadas del sistema (usadas solo para "Restablecer columnas")
const DEFAULT_COLUMNS = [
  { key: 'nuevo', label: 'Nuevo', icon: '🆕', color: '#56624A', final: false },
  { key: 'contactado', label: 'Contactado', icon: '📞', color: '#6F8125', final: false },
  { key: 'en_negociacion', label: 'En Negociación', icon: '🤝', color: '#C9922E', final: false },
  { key: 'ganado', label: 'Ganado', icon: '🏆', color: '#2F7D5A', final: true },
  { key: 'perdido', label: 'Perdido', icon: '❌', color: '#B23A45', final: false }
];

// Presets para selector de colores y emojis
const PRESET_EMOJIS = ['🆕', '📞', '🤝', '🏆', '❌', '🎯', '🚀', '💬', '📋', '⏳', '💡', '💰', '📊', '🔍', '⭐', '⚡'];

const PRESET_COLORS = [
  { name: 'Azul', hex: '#56624A' },
  { name: 'Violeta', hex: '#4C3F91' },
  { name: 'Ámbar', hex: '#C9922E' },
  { name: 'Esmeralda', hex: '#2F7D5A' },
  { name: 'Rosa', hex: '#B23A45' },
  { name: 'Cian', hex: '#2C8C99' },
  { name: 'Índigo', hex: '#5560B0' },
  { name: 'Naranja', hex: '#BF5A2A' }
];

const VIABILITY_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'alta', label: '🌟 Alta' },
  { id: 'media', label: '⚖️ Media' },
  { id: 'baja', label: '🔻 Baja' }
];

// Estado de Columnas Dinámicas (persistidas en base de datos)
const columns = ref([]);
const kanbanBoardRef = ref(null);

// Estado de Leads
const leads = ref([]);
const selectedLead = ref(null);
const isLoading = ref(false);
const loadError = ref('');
const draggedLead = ref(null);
const hoveredColumn = ref(null);
const projectToast = ref(null);
const winModalLead = ref(null);
const voucherUploading = ref(null);

// Filtros y Búsqueda
const searchQuery = ref('');
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

// Modales de Gestión de Columnas
const showCreateColModal = ref(false);
const newColumnForm = reactive({
  label: '',
  icon: '🎯',
  color: '#56624A',
  final: false,
  quoted: false
});

const showEditColModal = ref(false);
const editingColumn = ref(null);
const editColumnForm = reactive({
  label: '',
  icon: '',
  color: '',
  final: false,
  quoted: false
});

const showDeleteColModal = ref(false);

/* ------------------- Conciliación con Meta Lead Ads -------------------- */
/*
 * Dos pasos a propósito: "Comparar" solo lee y "Recuperar" escribe. Traer
 * leads perdidos agrega gente al funnel que el equipo va a trabajar, así que
 * no puede ser un efecto de abrir una pantalla.
 */
const showMetaRecModal = ref(false);
const metaRecLoading = ref(false);
const metaRecError = ref('');
const metaRecReport = ref(null);
const metaRecForm = reactive({ since: '', until: '' });

const PLATFORM_LABELS = { fb: 'Facebook', ig: 'Instagram', desconocida: 'Sin dato' };
function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || platform;
}

function openMetaReconciliation() {
  metaRecError.value = '';
  showMetaRecModal.value = true;
  if (!metaRecReport.value) runMetaReconciliation(false);
}

async function runMetaReconciliation(apply) {
  if (apply && !window.confirm('Se van a importar los leads faltantes al Setter Funnel. ¿Continuar?')) return;

  metaRecLoading.value = true;
  metaRecError.value = '';
  try {
    const query = new URLSearchParams();
    if (metaRecForm.since) query.set('since', metaRecForm.since);
    if (metaRecForm.until) query.set('until', metaRecForm.until);

    const response = apply
      ? await apiFetch('/api/leads/meta-reconciliation', {
          method: 'POST',
          body: JSON.stringify({ since: metaRecForm.since || null, until: metaRecForm.until || null })
        })
      : await apiFetch(`/api/leads/meta-reconciliation?${query.toString()}`);

    const data = await response.json();
    if (!response.ok) throw new Error(data.details || data.error || 'Error al consultar a Meta.');

    metaRecReport.value = data;
    if (apply && data.totals.importados) await fetchAll();
  } catch (error) {
    metaRecError.value = error.message;
  } finally {
    metaRecLoading.value = false;
  }
}
const deletingColumn = ref(null);
const targetReassignColKey = ref('nuevo');

// Edición de los datos del lead abierto (null = ficha en modo lectura).
const leadEdit = ref(null);
const leadEditSaving = ref(false);
const leadEditError = ref('');

const ACADEMIC_LEVELS = ['Pregrado (Bachiller/Título)', 'Posgrado (Maestría)', 'Posgrado (Doctorado)'];

// Cotización
const showQuoteForm = ref(false);
// Paquete que se está cotizando (tesis / artículo científico): define la lista
// de entregables y los textos con los que abre el formulario.
const quotePackage = ref(DEFAULT_QUOTE_PACKAGE);
const INITIAL_QUOTE_DEFAULTS = findQuotePackage(DEFAULT_QUOTE_PACKAGE).defaults;
const quoteConcept = ref(INITIAL_QUOTE_DEFAULTS.conceptTitle);
const quoteServiceSubtitle = ref(INITIAL_QUOTE_DEFAULTS.serviceSubtitle);
const quoteAmount = ref('');
const quoteRegularAmount = ref('');
const quoteCurrency = ref('PEN');
// Entregables marcados (claves del catálogo): arrancan todos incluidos, que es
// el paquete que se vende; quitar uno es la excepción.
const quoteDeliverables = ref(findQuotePackage(DEFAULT_QUOTE_PACKAGE).deliverables.map((item) => item.key));
const quoteScope = ref('');
const quoteCode = ref('');
const quoteEstimatedTime = ref(INITIAL_QUOTE_DEFAULTS.estimatedTime);
const quoteStatusLabel = ref(INITIAL_QUOTE_DEFAULTS.statusLabel);
const quoteValidUntil = ref('');
const quoteWarranty = ref(INITIAL_QUOTE_DEFAULTS.warrantyText);
const quoteTerms = ref(INITIAL_QUOTE_DEFAULTS.commercialTerms);
const quoteNotes = ref('');
const quoteSubmitting = ref(false);
const quoteSuccess = ref(null);
const quoteDocLoading = ref(false);
// Historial de cotizaciones del lead abierto. El registro siempre existió en
// la base; lo que faltaba era traerlo al panel.
const quoteHistory = ref([]);
const quoteHistoryLoading = ref(false);
// Movimiento de etapa que disparó la última cotización, con la etapa previa
// para poder deshacerlo. Se ofrece deshacer mientras el aviso siga visible en
// vez de por unos segundos: cotizar al lead equivocado se nota al rato, no al
// instante, y un temporizador solo obliga a rehacerlo a mano.
const quoteMove = ref(null);
const quoteMoveUndoing = ref(false);

/**
 * Historial de etapas del lead seleccionado (`lead_stage_changes`): quién lo
 * movió, desde qué etapa y hacia cuál, incluidos los intentos que el backend
 * rechazó. Es la respuesta a "¿por qué este lead salió de donde lo dejé?", que
 * hasta ahora había que deducir. Se pide al abrirlo, no al abrir la ficha: no
 * todo el mundo lo necesita cada vez.
 */
const showStageHistory = ref(false);
const stageHistory = ref([]);
const stageHistoryLoading = ref(false);
const stageHistoryError = ref('');

// Conversación con el bot de WhatsApp (Avan) para el lead seleccionado.
const showBotChat = ref(false);
const botChatMessages = ref([]);
const botChatLoading = ref(false);
const botChatError = ref('');
const botChatScrollEl = ref(null);
let botChatTimer = null;

watch(selectedLead, () => {
  leadEdit.value = null;
  leadEditError.value = '';
  showQuoteForm.value = false;
  resetQuoteForm();
  quoteSuccess.value = null;
  quoteMove.value = null;
  quoteHistory.value = [];
  if (selectedLead.value) loadQuoteHistory();

  showStageHistory.value = false;
  stageHistory.value = [];
  stageHistoryError.value = '';

  showBotChat.value = false;
  botChatMessages.value = [];
  botChatError.value = '';
  stopBotChatPolling();
});

async function toggleStageHistory() {
  showStageHistory.value = !showStageHistory.value;
  if (!showStageHistory.value || stageHistory.value.length > 0) return;

  stageHistoryLoading.value = true;
  stageHistoryError.value = '';
  try {
    const response = await apiFetch(`/api/leads/${selectedLead.value.id}/stage-history`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo obtener el historial de etapas.');
    stageHistory.value = data.history || [];
  } catch (err) {
    stageHistoryError.value = err.message;
  } finally {
    stageHistoryLoading.value = false;
  }
}

/**
 * Nombre legible de una etapa. Primero la columna real del tablero —es la que
 * el equipo ve y renombra—; si la etapa ya no existe (columna borrada), se
 * muestra la clave cruda, que es un dato útil en sí mismo cuando se está
 * investigando por qué un lead se movió.
 */
function stageLabel(key) {
  if (!key) return '—';
  const column = columns.value.find((c) => c.key === key);
  if (column) return `${column.icon || ''} ${column.label}`.trim();
  return FIXED_STAGE_LABELS[key] || key;
}

const FIXED_STAGE_LABELS = {
  nuevo: 'Nuevo',
  cita_agendada: '📅 Cita agendada',
  en_negociacion: '🤝 En negociación',
  ganado: '🏆 Ganado',
  perdido: '❌ Perdido',
  conversacion_abierta: '💬 Conversación abierta (Setter)',
  calificando: '🎯 En calificación (Setter)',
  congelado: '🧊 Congelado (Setter)',
  transferido_closer: '🤝 Transferido a un asesor (Setter)',
  descartado: '🚫 Descartado (Setter)'
};

function stageActorLabel(entry) {
  if (entry.actorType === 'bot') return '🤖 Bot de WhatsApp';
  if (entry.actorType === 'user') return `👤 ${entry.actorName || 'Usuario eliminado'}`;
  return '⚙️ Sistema';
}

function formatStageDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Trae el hilo completo (contacto + Avan) del lead seleccionado desde la
 * tabla `whatsapp_messages`. El `phone` del lead ES el wa_id del contacto.
 */
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

function formatClock(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}

onBeforeUnmount(stopBotChatPolling);

// Leads que Avan todavía está calificando por WhatsApp (Setter Funnel) no
// cuentan como leads comerciales todavía: no aparecen en ninguna columna ni
// estadística del Funnel de Ventas hasta que se agenda una llamada.
// "transferido_closer" NO gradúa: es un lead que Avan pasó a un asesor humano
// SIN llegar a agendar (queja, pedido de hablar con alguien, sin horarios
// libres en el Calendar, etc. — ver handOffToAdvisor en whatsappBotService.js).
// Que un asesor lo esté atendiendo no significa que tenga una reunión, así
// que se queda visible solo en su propia columna del Setter Funnel — antes
// entraba también acá y se contaba como "Con Reunión" sin tener cita real.
// La lista vive en `src/salesFunnelStage.js`, compartida con el Setter Funnel y
// espejo de la del backend: tenerla escrita dos veces fue lo que dejó que
// `descartado` quedara fuera acá y que los leads descartados por el setter
// aparecieran en la primera columna de este tablero.
// Un lead con cita ya agendada "gradúa" del Setter Funnel al Funnel de
// Ventas, entrando a esta columna (recién ahí es un lead comercial).
const GRADUATED_STATUS_TO_SALES_COLUMN = { cita_agendada: 'nuevo' };

/**
 * Los leads que este tablero muestra: todo lo que no sea una etapa exclusiva
 * del Setter Funnel y, además, TODO lead con el sello `sales_funnel_at`.
 *
 * El sello manda sobre el estado a propósito: un lead que ya graduó y que
 * quedó con un estado del setter (por los movimientos automáticos que había
 * antes del tope del backend) tiene que seguir viéndose acá — desaparecer del
 * tablero del closer es justamente lo que el equipo venía reportando. Al no
 * coincidir con ninguna columna, cae en la primera, donde se puede volver a
 * arrastrar a su etapa.
 */
const visibleLeads = computed(() => leads.value.filter(
  (l) => l.sales_funnel_at || !SETTER_ONLY_STATUSES.includes(l.status)
));

// Estadísticas de Resumen
const highViabilityCount = computed(() => {
  return visibleLeads.value.filter(l => (l.viability_level || '').toLowerCase().includes('alta')).length;
});

const wonProjectsCount = computed(() => {
  return visibleLeads.value.filter(l => l.project_id || l.status === 'ganado').length;
});

const avgViabilityScore = computed(() => {
  const scored = visibleLeads.value.filter(l => typeof l.overall_viability_score === 'number');
  if (scored.length === 0) return 0;
  const sum = scored.reduce((acc, curr) => acc + curr.overall_viability_score, 0);
  return Math.round(sum / scored.length);
});

// Leads filtrados agrupados por columna
const filteredLeadsByColumn = computed(() => {
  const grouped = {};
  for (const col of columns.value) {
    grouped[col.key] = [];
  }

  const query = searchQuery.value.trim().toLowerCase();

  for (const lead of visibleLeads.value) {
    // Filtro por texto multicampo (incluyendo nombre completo, tema, email, celular, etc.)
    if (query) {
      const cleanId = query.replace(/^#/, '');
      const matchId = String(lead.id || '').includes(cleanId);
      const matchName = (lead.full_name || '').toLowerCase().includes(query);
      const matchTopic = (lead.topic || '').toLowerCase().includes(query);
      const matchEmail = (lead.email || '').toLowerCase().includes(query);
      const matchPhone = (lead.phone || '').toLowerCase().includes(query);
      const matchField = (lead.field_of_study || '').toLowerCase().includes(query);
      const matchAcademic = (lead.academic_level || '').toLowerCase().includes(query);
      const matchNotes = (lead.additional_notes || '').toLowerCase().includes(query);
      const matchAssigned = (lead.assigned_to || '').toLowerCase().includes(query);
      if (!matchId && !matchName && !matchTopic && !matchEmail && !matchPhone && !matchField && !matchAcademic && !matchNotes && !matchAssigned) continue;
    }

    // Filtro por nivel de viabilidad
    if (selectedViabilityFilter.value !== 'all') {
      const lvl = (lead.viability_level || '').toLowerCase();
      if (selectedViabilityFilter.value === 'alta' && !lvl.includes('alta')) continue;
      if (selectedViabilityFilter.value === 'media' && !lvl.includes('media')) continue;
      if (selectedViabilityFilter.value === 'baja' && !lvl.includes('baja')) continue;
    }

    // Ubicar en columna correspondiente — un lead "graduado" del Setter
    // Funnel (cita_agendada) entra por la columna que le corresponda como
    // lead comercial nuevo, no por su status literal.
    const effectiveStatus = GRADUATED_STATUS_TO_SALES_COLUMN[lead.status] || lead.status;
    if (grouped[effectiveStatus]) {
      grouped[effectiveStatus].push(lead);
    } else {
      // Si el estado no coincide con ninguna columna activa, asignar a la primera columna
      const firstKey = columns.value[0]?.key || 'nuevo';
      if (!grouped[firstKey]) grouped[firstKey] = [];
      grouped[firstKey].push(lead);
    }
  }

  return grouped;
});

// Total de coincidencias de búsqueda
const totalMatchingLeads = computed(() => {
  let count = 0;
  for (const key in filteredLeadsByColumn.value) {
    count += filteredLeadsByColumn.value[key].length;
  }
  return count;
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

// Reajustar páginas al cambiar filtros o límite por columna
watch([filteredLeadsByColumn, itemsPerPage], () => {
  for (const col of columns.value) {
    const totalPages = getColumnTotalPages(col.key);
    const currentPage = getColumnPage(col.key);
    if (currentPage > totalPages) {
      columnPages[col.key] = Math.max(1, totalPages);
    }
  }
}, { deep: true });

// Columnas disponibles para reasignar (excluyendo la que se va a borrar)
const availableTargetColumns = computed(() => {
  if (!deletingColumn.value) return columns.value;
  return columns.value.filter(c => c.key !== deletingColumn.value.key);
});

// Mover columnas con flechas (Izquierda / Derecha)
function moveColumnLeft(index) {
  if (index <= 0) return;
  const temp = columns.value[index];
  columns.value[index] = columns.value[index - 1];
  columns.value[index - 1] = temp;
  columns.value = [...columns.value];
  persistColumnOrder();
}

function moveColumnRight(index) {
  if (index >= columns.value.length - 1) return;
  const temp = columns.value[index];
  columns.value[index] = columns.value[index + 1];
  columns.value[index + 1] = temp;
  columns.value = [...columns.value];
  persistColumnOrder();
}

// Persiste en base de datos el nuevo orden de columnas
async function persistColumnOrder() {
  try {
    const response = await apiFetch('/api/funnel-columns/reorder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: columns.value.map(c => c.key) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al reordenar las columnas.');
  } catch (err) {
    console.error('No se pudo guardar el nuevo orden de columnas:', err);
  }
}

// Desplazar el tablero horizontalmente
function scrollBoard(direction) {
  if (!kanbanBoardRef.value) return;
  const scrollAmount = 340;
  kanbanBoardRef.value.scrollBy({
    left: direction === 'left' ? -scrollAmount : scrollAmount,
    behavior: 'smooth'
  });
}

// Gestión de Creación de Columnas
function openCreateColumnModal() {
  newColumnForm.label = '';
  newColumnForm.icon = '🎯';
  newColumnForm.color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)].hex;
  newColumnForm.final = false;
  newColumnForm.quoted = false;
  showCreateColModal.value = true;
}

async function saveNewColumn() {
  const trimmed = newColumnForm.label.trim();
  if (!trimmed) return;

  try {
    const response = await apiFetch('/api/funnel-columns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: trimmed,
        icon: newColumnForm.icon || '📌',
        color: newColumnForm.color || '#56624A',
        final: Boolean(newColumnForm.final),
        quoted: Boolean(newColumnForm.quoted)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al crear la columna.');

    columns.value.push(data.column);
    showCreateColModal.value = false;

    // Auto-scroll al final del tablero
    setTimeout(() => {
      if (kanbanBoardRef.value) {
        kanbanBoardRef.value.scrollTo({
          left: kanbanBoardRef.value.scrollWidth,
          behavior: 'smooth'
        });
      }
    }, 100);
  } catch (err) {
    alert('No se pudo crear la columna: ' + err.message);
  }
}

// Gestión de Edición de Columnas
function openEditColumnModal(col, index) {
  editingColumn.value = col;
  editColumnForm.label = col.label;
  editColumnForm.icon = col.icon || '📌';
  editColumnForm.color = col.color || '#56624A';
  editColumnForm.final = Boolean(col.final);
  editColumnForm.quoted = Boolean(col.quoted);
  showEditColModal.value = true;
}

async function saveEditedColumn() {
  if (!editingColumn.value || !editColumnForm.label.trim()) return;

  try {
    const response = await apiFetch(`/api/funnel-columns/${editingColumn.value.key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: editColumnForm.label.trim(),
        icon: editColumnForm.icon || '📌',
        color: editColumnForm.color || '#56624A',
        final: Boolean(editColumnForm.final),
        quoted: Boolean(editColumnForm.quoted)
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al actualizar la columna.');

    const index = columns.value.findIndex(c => c.key === data.column.key);
    if (index !== -1) columns.value[index] = data.column;
    columns.value = [...columns.value];
    showEditColModal.value = false;
    editingColumn.value = null;
  } catch (err) {
    alert('No se pudo actualizar la columna: ' + err.message);
  }
}

// Gestión de Eliminación de Columnas
function openDeleteColumnModal(col, index) {
  deletingColumn.value = col;
  const remaining = columns.value.filter(c => c.key !== col.key);
  targetReassignColKey.value = remaining[0]?.key || 'nuevo';
  showDeleteColModal.value = true;
}

function getLeadsCountInColumn(colKey) {
  return leads.value.filter(l => l.status === colKey).length;
}

async function confirmDeleteColumn() {
  if (!deletingColumn.value) return;
  const colKey = deletingColumn.value.key;
  const targetKey = targetReassignColKey.value;

  try {
    // Reasignar leads que estén en esta columna
    const leadsToMove = leads.value.filter(l => l.status === colKey);
    for (const lead of leadsToMove) {
      await moveLeadToStatus(lead, targetKey);
    }

    const response = await apiFetch(`/api/funnel-columns/${colKey}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al eliminar la columna.');

    columns.value = columns.value.filter(c => c.key !== colKey);
    showDeleteColModal.value = false;
    deletingColumn.value = null;
  } catch (err) {
    alert('No se pudo eliminar la columna: ' + err.message);
  }
}

async function confirmResetColumns() {
  if (!confirm('¿Restablecer las columnas del funnel a su configuración original? Las columnas personalizadas se eliminarán y sus leads pasarán a "Nuevo".')) {
    return;
  }

  isLoading.value = true;
  try {
    const defaultKeys = DEFAULT_COLUMNS.map(c => c.key);

    // Reasignar a "nuevo" los leads que están en columnas que van a desaparecer
    const leadsToReassign = leads.value.filter(l => !defaultKeys.includes(l.status));
    for (const lead of leadsToReassign) {
      await moveLeadToStatus(lead, 'nuevo');
    }

    // Eliminar todas las columnas actuales
    for (const col of columns.value) {
      await apiFetch(`/api/funnel-columns/${col.key}`, { method: 'DELETE' });
    }

    // Recrear las columnas por defecto en orden
    for (const col of DEFAULT_COLUMNS) {
      await apiFetch('/api/funnel-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(col)
      });
    }

    await fetchColumns();
  } catch (err) {
    alert('No se pudieron restablecer las columnas: ' + err.message);
  } finally {
    isLoading.value = false;
  }
}

// Drag & Drop
function onDragStart(lead) {
  draggedLead.value = lead;
}

function onDragEnd() {
  hoveredColumn.value = null;
  draggedLead.value = null;
}

function onColumnDragLeave(colKey) {
  if (hoveredColumn.value === colKey) hoveredColumn.value = null;
}

function onDrop(columnKey) {
  hoveredColumn.value = null;
  const lead = draggedLead.value;
  draggedLead.value = null;
  if (!lead || lead.status === columnKey) return;
  moveLeadToStatusOrWin(lead, columnKey);
}

// Servicios API
async function fetchColumns() {
  const response = await apiFetch('/api/funnel-columns');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener las columnas del funnel.');
  columns.value = data.columns || [];
}

async function fetchLeads() {
  const response = await apiFetch('/api/leads');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener los leads.');
  leads.value = data.leads || [];
}

async function fetchAll() {
  isLoading.value = true;
  loadError.value = '';
  try {
    await Promise.all([fetchColumns(), fetchLeads()]);
  } catch (err) {
    loadError.value = err.message;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Mover un lead a la etapa ganadora no es un cambio de estado más: abre el
 * modal de cierre para registrar el primer pago, y solo si el vendedor lo
 * completa se mueve el lead, se crea el proyecto y nace el ingreso. Los leads
 * que ya tienen su pago registrado (o vuelven a "Ganado") pasan derecho.
 */
function moveLeadToStatusOrWin(lead, newStatus) {
  const finalKey = columns.value.find((c) => c.final)?.key;
  if (newStatus === finalKey && !lead.initial_payment_id) {
    winModalLead.value = lead;
    return;
  }
  moveLeadToStatus(lead, newStatus);
}

function onDealWon(data) {
  const lead = winModalLead.value;
  winModalLead.value = null;
  if (!lead) return;

  lead.status = data.lead.status;
  lead.project_id = data.project?.id ?? lead.project_id;
  lead.project_status = data.project?.status ?? lead.project_status;
  lead.initial_payment_id = data.income.id;
  lead.initial_payment_code = data.income.code;
  lead.initial_payment_monto = data.income.monto;
  lead.initial_payment_estado = data.income.estado;

  if (data.project) {
    projectToast.value = data.project;
    setTimeout(() => {
      if (projectToast.value?.id === data.project.id) projectToast.value = null;
    }, 7000);
  }
}

/** Subida del voucher desde el detalle del lead: deja el ingreso en "pagado". */
async function uploadVoucher(lead, event) {
  const files = Array.from(event.target.files || []).slice(0, 10);
  event.target.value = '';
  if (files.length === 0 || !lead.initial_payment_id) return;

  voucherUploading.value = lead.id;
  try {
    const fd = new FormData();
    for (const file of files) fd.append('receipts', file);
    const response = await apiFetch(`/api/finance/income/${lead.initial_payment_id}/receipts`, {
      method: 'POST',
      body: fd
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo subir el voucher.');
    lead.initial_payment_estado = 'pagado';
  } catch (err) {
    alert('No se pudo subir el voucher: ' + err.message);
  } finally {
    voucherUploading.value = null;
  }
}

function paymentChipLabel(estado) {
  if (estado === 'verificado') return '✅ Pago verificado';
  if (estado === 'pagado') return '🧾 Por verificar';
  return '⏳ Pago pendiente';
}

function paymentChipClass(estado) {
  if (estado === 'verificado') return 'is-verified';
  if (estado === 'pagado') return 'is-paid';
  return 'is-pending';
}


async function moveLeadToStatus(lead, newStatus) {
  const previousStatus = lead.status;
  lead.status = newStatus;
  try {
    const response = await apiFetch(`/api/leads/${lead.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al actualizar el estado.');

    lead.status = data.lead.status;
    if (data.project) {
      lead.project_id = data.project.id;
      lead.project_status = data.project.status;
      projectToast.value = data.project;
      setTimeout(() => {
        if (projectToast.value?.id === data.project.id) projectToast.value = null;
      }, 7000);
    }
  } catch (err) {
    lead.status = previousStatus;
    alert('No se pudo mover el lead: ' + err.message);
  }
}

/** Columna marcada como etapa de cotización, si el equipo definió alguna. */
/**
 * Columna a la que va un lead recién cotizado: la marcada como etapa de
 * cotización o, si nadie la marcó, la que se llama así. Es el mismo criterio
 * que aplica el backend (`funnelColumnService.getQuotedColumn`), replicado acá
 * solo para saber si hace falta avisar que el lead no se va a mover.
 */
const quotedColumn = computed(() => {
  const flagged = columns.value.find((c) => c.quoted);
  if (flagged) return flagged;
  const named = (label) => {
    const clean = String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return /cotiza/.test(clean) && !/\bsin\s+cotiza/.test(clean);
  };
  return columns.value.find((c) => named(c.label)) || null;
});

/** Mismo formato que imprime el documento (ver quotationDocument.js). */
function formatQuoteNumber(quote) {
  const year = new Date(quote.created_at || Date.now()).getFullYear();
  return `CTZ-${year}-${String(quote.id).padStart(4, '0')}`;
}

function isQuoteExpired(quote) {
  if (!quote.valid_until) return false;
  return new Date(quote.valid_until) < new Date(new Date().toDateString());
}

/** Trae las cotizaciones ya emitidas para el lead abierto. */
async function loadQuoteHistory() {
  const lead = selectedLead.value;
  if (!lead) return;
  quoteHistoryLoading.value = true;
  try {
    const response = await apiFetch(`/api/leads/${lead.id}/quotes`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener las cotizaciones.');
    // El lead pudo cambiar mientras la petición viajaba.
    if (selectedLead.value?.id === lead.id) quoteHistory.value = data.quotes || [];
  } catch {
    // El historial es informativo: si falla, no se bloquea el resto del modal.
    if (selectedLead.value?.id === lead.id) quoteHistory.value = [];
  } finally {
    quoteHistoryLoading.value = false;
  }
}

/** Devuelve el lead a la etapa en la que estaba antes de cotizarlo. */
async function undoQuoteMove() {
  const move = quoteMove.value;
  const lead = selectedLead.value;
  if (!move || !lead) return;
  quoteMoveUndoing.value = true;
  try {
    const response = await apiFetch(`/api/leads/${lead.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: move.previousStatus })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al mover el lead.');
    lead.status = data.lead.status;
    const inBoard = leads.value.find((l) => l.id === lead.id);
    if (inBoard) inBoard.status = data.lead.status;
    quoteMove.value = null;
  } catch (err) {
    alert('No se pudo deshacer el movimiento: ' + err.message);
  } finally {
    quoteMoveUndoing.value = false;
  }
}

/** Copia editable de los datos del lead: cancelar no debe tocar el tablero. */
function startLeadEdit() {
  const lead = selectedLead.value;
  leadEditError.value = '';
  leadEdit.value = {
    fullName: lead.full_name || '',
    dni: lead.dni || '',
    email: lead.email || '',
    phone: lead.phone || '',
    university: lead.university || '',
    academicLevel: lead.academic_level || ACADEMIC_LEVELS[0],
    fieldOfStudy: lead.field_of_study || DEFAULT_CAREER,
    topic: lead.topic || ''
  };
}

async function saveLeadEdit() {
  leadEditSaving.value = true;
  leadEditError.value = '';
  try {
    const response = await apiFetch(`/api/leads/${selectedLead.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(leadEdit.value)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar los datos.');

    // El lead abierto y el del tablero son objetos distintos: se actualizan
    // los dos para que la tarjeta muestre el nombre nuevo sin recargar.
    Object.assign(selectedLead.value, data.lead);
    const inBoard = leads.value.find((l) => l.id === data.lead.id);
    if (inBoard) Object.assign(inBoard, data.lead);
    leadEdit.value = null;
  } catch (err) {
    leadEditError.value = err.message;
  } finally {
    leadEditSaving.value = false;
  }
}

/** Vigencia por defecto: 10 días calendario, como venía haciendo el backend. */
function defaultValidUntil() {
  return new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resetQuoteForm() {
  quotePackage.value = DEFAULT_QUOTE_PACKAGE;
  const defaults = findQuotePackage(DEFAULT_QUOTE_PACKAGE).defaults;
  quoteConcept.value = defaults.conceptTitle;
  quoteServiceSubtitle.value = defaults.serviceSubtitle;
  quoteAmount.value = '';
  quoteRegularAmount.value = '';
  quoteCurrency.value = 'PEN';
  quoteDeliverables.value = activeDeliverables.value.map((item) => item.key);
  quoteScope.value = '';
  quoteCode.value = '';
  quoteEstimatedTime.value = defaults.estimatedTime;
  quoteStatusLabel.value = defaults.statusLabel;
  quoteValidUntil.value = defaultValidUntil();
  quoteWarranty.value = defaults.warrantyText;
  quoteTerms.value = defaults.commercialTerms;
  quoteNotes.value = '';
}

/** Entregables del paquete que se está cotizando. */
const activeDeliverables = computed(() => findQuotePackage(quotePackage.value).deliverables);

const allDeliverablesChecked = computed(
  () => activeDeliverables.value.length > 0 && quoteDeliverables.value.length === activeDeliverables.value.length
);

/** Algunos sí y otros no: el check maestro se dibuja en estado intermedio. */
const someDeliverablesChecked = computed(
  () => quoteDeliverables.value.length > 0 && !allDeliverablesChecked.value
);

function toggleAllDeliverables(selectAll) {
  quoteDeliverables.value = selectAll ? activeDeliverables.value.map((item) => item.key) : [];
}

/**
 * Cambia el tipo de trabajo cotizado. Los textos por defecto siguen al paquete
 * nuevo, pero solo si nadie los editó a mano (si el asesor escribió su propio
 * título, se respeta). Las marcas de los entregables compartidos se conservan,
 * y el entregable propio del paquete nuevo entra marcado.
 */
function selectQuotePackage(key) {
  if (key === quotePackage.value) return;
  const prev = findQuotePackage(quotePackage.value);
  const next = findQuotePackage(key);

  const fields = [
    [quoteConcept, 'conceptTitle'],
    [quoteServiceSubtitle, 'serviceSubtitle'],
    [quoteEstimatedTime, 'estimatedTime'],
    [quoteStatusLabel, 'statusLabel'],
    [quoteWarranty, 'warrantyText'],
    [quoteTerms, 'commercialTerms']
  ];
  for (const [field, name] of fields) {
    if (field.value === prev.defaults[name]) field.value = next.defaults[name];
  }

  const sharedKeys = new Set(prev.deliverables.map((item) => item.key));
  quoteDeliverables.value = next.deliverables
    .filter((item) => !sharedKeys.has(item.key) || quoteDeliverables.value.includes(item.key))
    .map((item) => item.key);

  quotePackage.value = key;
}

/** El descuento no se escribe: es la diferencia entre el regular y el final. */
const quoteDiscount = computed(() => {
  const regular = Number(quoteRegularAmount.value) || 0;
  const final = Number(quoteAmount.value) || 0;
  return regular > final ? regular - final : 0;
});

/**
 * Alcance que viaja al documento: los entregables marcados en el orden del
 * catálogo, más las líneas sueltas que se hayan escrito.
 */
const quoteScopeItems = computed(() => {
  const checked = activeDeliverables.value
    .filter((item) => quoteDeliverables.value.includes(item.key))
    .map(deliverableLine);
  const extras = quoteScope.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...checked, ...extras].join('\n');
});

async function submitQuote() {
  if (!selectedLead.value || !quoteAmount.value) return;
  quoteSubmitting.value = true;
  try {
    const response = await apiFetch(`/api/leads/${selectedLead.value.id}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(quoteAmount.value),
        regularAmount: Number(quoteRegularAmount.value) || null,
        currency: quoteCurrency.value,
        conceptTitle: quoteConcept.value,
        serviceSubtitle: quoteServiceSubtitle.value,
        scopeItems: quoteScopeItems.value,
        code: quoteCode.value,
        estimatedTime: quoteEstimatedTime.value,
        statusLabel: quoteStatusLabel.value,
        validUntil: quoteValidUntil.value || null,
        warrantyText: quoteWarranty.value,
        commercialTerms: quoteTerms.value,
        notes: quoteNotes.value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al generar la cotización.');
    quoteSuccess.value = data.quote;
    showQuoteForm.value = false;

    // El backend mueve el lead a la etapa de cotización (si el equipo marcó
    // alguna) y devuelve de dónde venía, para poder deshacerlo desde el aviso.
    if (data.movedTo && data.previousStatus) {
      selectedLead.value.status = data.movedTo.key;
      const inBoard = leads.value.find((l) => l.id === selectedLead.value.id);
      if (inBoard) inBoard.status = data.movedTo.key;
      quoteMove.value = { ...data.movedTo, previousStatus: data.previousStatus };
    } else {
      quoteMove.value = null;
    }

    loadQuoteHistory();
    // Abre automáticamente el documento imprimible con la marca de Avantage.
    openQuoteDocument(data.quote.id);
  } catch (err) {
    alert('No se pudo generar la cotización: ' + err.message);
  } finally {
    quoteSubmitting.value = false;
  }
}

/**
 * Descarga el HTML del documento de cotización (con el token de sesión) y lo
 * abre en una pestaña nueva, lista para "Guardar como PDF" / imprimir.
 */
async function openQuoteDocument(quoteId) {
  if (!quoteId) return;
  quoteDocLoading.value = true;
  try {
    const response = await apiFetch(`/api/quotes/${quoteId}/document`);
    if (!response.ok) throw new Error('No se pudo obtener el documento.');
    const html = await response.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // El navegador bloqueó la ventana emergente: descarga el archivo.
      const link = document.createElement('a');
      link.href = url;
      link.download = `cotizacion-${quoteId}.html`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    alert('No se pudo abrir la cotización: ' + err.message);
  } finally {
    quoteDocLoading.value = false;
  }
}

// Formateadores y Utilitarios
function formatCurrency(amount, currency) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: currency || 'PEN' }).format(amount);
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '');
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}


function getLeadFullName(lead) {
  if (!lead) return '—';
  if (lead.full_name && lead.full_name.trim()) return lead.full_name.trim();
  if (lead.fullName && lead.fullName.trim()) return lead.fullName.trim();
  if (lead.topic && lead.topic.trim()) return lead.topic.trim();
  return `Prospecto #${lead.id || '—'}`;
}

function getLevelClass(level) {
  const l = (level || '').toLowerCase();
  if (l.includes('media-alta')) return 'level-media-alta';
  if (l.includes('alta')) return 'level-alta';
  if (l.includes('media')) return 'level-media';
  return 'level-baja';
}

onMounted(() => {
  fetchAll();
});
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

/* ── Edición de los datos del lead (dentro del modal de detalle) ── */
.lead-edit-btn {
  margin-left: 0.6rem;
  padding: 0.25rem 0.6rem;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  color: var(--text-sub);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  vertical-align: middle;
}

.lead-edit-btn:hover { border-color: var(--primary); color: var(--primary); }

.lead-edit-form {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--surface-1);
  padding: 0.9rem 1rem;
}

.lead-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}

.lead-edit-field { display: flex; flex-direction: column; gap: 0.25rem; }
.lead-edit-field--wide { grid-column: 1 / -1; }

.lead-edit-field > span {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
}

.lead-edit-error {
  margin-top: 0.6rem;
  font-size: 0.78rem;
  color: var(--accent-rose);
}

.lead-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.8rem;
}

/* ── Tipo de trabajo cotizado (tesis / artículo científico) ── */
.quote-type-switch {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.5rem;
}

.quote-type-option {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.7rem;
  text-align: left;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.quote-type-option:hover { border-color: var(--primary); }

.quote-type-option.is-active {
  border-color: var(--primary);
  background: rgba(111, 129, 37, 0.1);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.quote-type-icon { font-size: 1.15rem; line-height: 1; flex-shrink: 0; }
.quote-type-text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.quote-type-text strong { font-size: 0.8rem; font-weight: 700; color: var(--text-main); }
.quote-type-text em { font-size: 0.7rem; font-style: normal; color: var(--text-muted); line-height: 1.35; }
.quote-type-option.is-active .quote-type-text strong { color: var(--primary); }

/* ── Entregables de la cotización (checks) ── */
.quote-check-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.quote-check-title { margin: 0; }

.quote-check-count {
  margin-left: 0.4rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: rgba(111, 129, 37, 0.14);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--primary);
}

/* El check maestro: marca o desmarca la lista completa de un golpe. */
.quote-check-all {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.quote-check-all:hover { border-color: var(--primary); color: var(--primary); }
.quote-check-all.is-on { border-color: var(--primary); color: var(--primary); }

.quote-check-list {
  list-style: none;
  display: grid;
  gap: 0.25rem;
  max-height: 230px;
  overflow-y: auto;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-card);
}

.quote-check {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.4rem 0.45rem;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.quote-check:hover { background: var(--surface-2); }

.quote-check.is-checked {
  border-color: rgba(111, 129, 37, 0.35);
  background: rgba(111, 129, 37, 0.07);
}

/* Checkbox nativo oculto pero operable con teclado; lo visible es .quote-check-box. */
.quote-check-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  margin: 0;
}

.quote-check-box {
  position: relative;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 0.1rem;
  border: 1.5px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-card);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.quote-check-box::after {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) scale(0);
  transition: transform 0.12s ease;
}

.quote-check-input:checked + .quote-check-box,
.quote-check-input:indeterminate + .quote-check-box {
  background: var(--primary);
  border-color: var(--primary);
}

.quote-check-input:checked + .quote-check-box::after { transform: rotate(45deg) scale(1); }

/* Estado intermedio del maestro: una barra, no un tilde. */
.quote-check-input:indeterminate + .quote-check-box::after {
  left: 3px;
  top: 6px;
  width: 8px;
  height: 0;
  border-width: 0 0 2px 0;
  transform: none;
}

.quote-check-input:focus-visible + .quote-check-box {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.quote-check-all .quote-check-box { width: 14px; height: 14px; margin-top: 0; }
.quote-check-all .quote-check-box::after { left: 3.8px; top: 0.5px; width: 3.5px; height: 7px; }

.quote-check-text { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
.quote-check-text strong { font-size: 0.78rem; color: var(--text-main); font-weight: 600; }
.quote-check-text em { font-size: 0.72rem; color: var(--text-muted); font-style: normal; line-height: 1.4; }
.quote-check.is-checked .quote-check-text strong { color: var(--primary); }

.quote-field-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.quote-field-row > .form-group { flex: 1; min-width: 140px; }

.quote-discount-hint {
  margin: -0.4rem 0 0.9rem;
  font-size: 0.76rem;
  color: var(--accent-emerald);
}


.kanban-page-wrapper {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

/* Header */
.kanban-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1.25rem;
}

.heading-icon {
  display: inline-block;
  transform: translateY(-2px);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Botones con estilo moderno */
.btn-action-primary {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: #ffffff;
  border: 1px solid var(--surface-4);
  border-radius: 10px;
  padding: 0.6rem 1.15rem;
  font-size: 0.86rem;
  font-weight: 600;
  font-family: var(--font-heading);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 14px rgba(111, 129, 37, 0.35);
  transition: all 0.2s ease;
}

.btn-action-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(111, 129, 37, 0.5);
  filter: brightness(1.1);
}

.btn-action-secondary {
  background: var(--surface-2);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.6rem 1.05rem;
  font-size: 0.86rem;
  font-weight: 500;
  font-family: var(--font-body);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  transition: all 0.2s ease;
}

.btn-action-secondary:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--surface-5);
}

.btn-action-ghost {
  background: transparent;
  color: var(--text-muted);
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  padding: 0.55rem 0.9rem;
  font-size: 0.82rem;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-ghost:hover {
  color: var(--text-main);
  border-color: var(--surface-5);
  background: var(--surface-1);
}

.btn-action-danger {
  background: linear-gradient(135deg, #B23A45, #8C2530);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0.6rem 1.15rem;
  font-weight: 600;
  font-family: var(--font-heading);
  font-size: 0.86rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action-danger:hover {
  filter: brightness(1.1);
}

.spin-animation {
  display: inline-block;
  animation: spin 1s linear infinite;
}

/* Grid de Métricas */
.funnel-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0.8rem 1rem;
  display: flex;
  align-items: center;
  gap: 1rem;
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
}

.stat-icon-wrapper.blue { background: rgba(111, 129, 37, 0.15); border: 1px solid rgba(111, 129, 37, 0.3); }
.stat-icon-wrapper.green { background: rgba(46, 125, 70, 0.15); border: 1px solid rgba(46, 125, 70, 0.3); }
.stat-icon-wrapper.amber { background: rgba(201, 146, 46, 0.15); border: 1px solid rgba(201, 146, 46, 0.3); }
.stat-icon-wrapper.purple { background: rgba(111, 129, 37, 0.15); border: 1px solid rgba(111, 129, 37, 0.3); }

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: var(--font-body);
}

.stat-value {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text-main);
  font-family: var(--font-heading);
}

/* Toolbar de Filtros, Búsqueda y Paginación */
.kanban-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  background: var(--bg-card-solid);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 0.7rem 0.9rem;
}

.search-filter-box {
  position: relative;
  flex: 1;
  min-width: 260px;
  max-width: 420px;
}

.search-icon {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.85rem;
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 0.5rem 2rem 0.5rem 2.25rem;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.84rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(111, 129, 37, 0.25);
}

.clear-search-btn {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.2rem;
}

.clear-search-btn:hover {
  color: var(--text-main);
}

.search-result-badge {
  font-size: 0.78rem;
  font-family: var(--font-body);
  background: rgba(111, 129, 37, 0.15);
  border: 1px solid rgba(111, 129, 37, 0.35);
  color: var(--accent-cyan);
  padding: 0.3rem 0.75rem;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.filter-pills {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.filter-pill {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  color: var(--text-muted);
  font-family: var(--font-body);
  padding: 0.3rem 0.75rem;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-pill:hover {
  background: var(--surface-3);
  color: var(--text-main);
}

.filter-pill.active {
  background: rgba(111, 129, 37, 0.2);
  border-color: var(--primary);
  color: #ffffff;
  font-weight: 600;
}

/* Control Selector de Items por Página */
.items-per-page-box {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  font-family: var(--font-body);
}

.toolbar-label {
  font-weight: 500;
}

.items-select {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-main);
  font-family: var(--font-body);
  padding: 0.28rem 0.55rem;
  font-size: 0.78rem;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.items-select:focus {
  border-color: var(--primary);
}

.board-nav-arrows {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.board-nav-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.2s ease;
}

.board-nav-btn:hover {
  background: var(--primary);
  border-color: var(--primary);
  transform: scale(1.05);
}

.board-nav-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-body);
}

/* Tablero Kanban Viewport & Columnas */
.kanban-viewport {
  overflow-x: auto;
  padding-bottom: 1.25rem;
  margin-top: 0.5rem;
}

.kanban-columns-container {
  display: flex;
  gap: 1.15rem;
  align-items: flex-start;
  min-width: min-content;
}

/* Columna Individual */
.kanban-column {
  flex: 0 0 320px;
  width: 320px;
  max-width: 340px;
  background: var(--bg-card);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.kanban-column:hover {
  border-color: var(--surface-4);
}

.kanban-column.is-final-column {
  border-color: rgba(46, 125, 70, 0.35);
}

.kanban-column.is-drag-over {
  border-color: var(--col-accent);
  background: rgba(111, 129, 37, 0.08);
  box-shadow: 0 0 20px var(--col-accent) 44;
  transform: translateY(-2px);
}

/* Barra superior de acento */
.column-top-accent {
  height: 4px;
  width: 100%;
  background: var(--col-accent);
  box-shadow: 0 0 10px var(--col-accent);
}

/* Cabecera de la Columna */
.kanban-column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.85rem 0.95rem;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card-solid);
  gap: 0.5rem;
}

.col-title-group {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex: 1;
  min-width: 0;
}

.col-icon {
  font-size: 1rem;
}

.col-label {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-main);
  font-family: var(--font-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-count-badge {
  font-size: 0.72rem;
  font-weight: 700;
  font-family: var(--font-heading);
  border-radius: 9999px;
  padding: 0.15rem 0.5rem;
  border: 1px solid;
}

.col-actions-group {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.col-arrow-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.col-arrow-btn:hover:not(:disabled) {
  background: var(--col-accent);
  color: #ffffff;
  border-color: var(--col-accent);
}

.col-arrow-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.col-menu-btn {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.col-menu-btn:hover {
  background: var(--surface-3);
  color: var(--text-main);
}

.col-menu-btn.delete-btn:hover {
  background: rgba(200, 85, 50, 0.2);
  color: var(--accent-rose);
}

/* Cuerpo de la Columna */
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
  /* Cinco tarjetas + sus separaciones + el padding de arriba y abajo: lo que
     pase de ahí se ve al hacer scroll (o cambiando "Ver por pág"). */
  max-height: calc(
    var(--column-visible-cards) * var(--lead-card-h) +
    (var(--column-visible-cards) - 1) * var(--lead-card-gap) +
    1.2rem
  );
}

/* Tarjeta de Lead */
/* Altura fija (--lead-card-h): con todas las tarjetas iguales, el cuerpo de
   la columna se dimensiona para mostrar exactamente cinco sin scroll. */
.kanban-lead-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  cursor: grab;
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.1rem;
  height: var(--lead-card-h);
  flex-shrink: 0;
  overflow: hidden;
}

.kanban-lead-card:hover {
  border-color: var(--surface-5);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.kanban-lead-card:active {
  cursor: grabbing;
}

.kanban-lead-card.is-being-dragged {
  opacity: 0.4;
  border-style: dashed;
  transform: scale(0.98);
}

/* Silueta de Destino al Arrastrar (Drop Silhouette Preview Card) */
.kanban-drop-silhouette {
  background: rgba(111, 129, 37, 0.08);
  border: 2px dashed var(--col-accent);
  border-radius: 12px;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  animation: pulseSilhouette 1.8s ease-in-out infinite;
  box-shadow: 0 0 16px var(--col-accent) 33;
}

@keyframes pulseSilhouette {
  0% {
    box-shadow: 0 0 8px var(--col-accent) 22;
    background: rgba(111, 129, 37, 0.06);
  }
  50% {
    box-shadow: 0 0 20px var(--col-accent) 55;
    background: rgba(111, 129, 37, 0.14);
  }
  100% {
    box-shadow: 0 0 8px var(--col-accent) 22;
    background: rgba(111, 129, 37, 0.06);
  }
}

.silhouette-header-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.silhouette-id {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-muted);
  font-family: var(--font-body);
}

.silhouette-badge {
  font-size: 0.7rem;
  font-weight: 700;
  font-family: var(--font-heading);
  color: var(--col-accent);
  background: var(--surface-3);
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  border: 1px solid var(--col-accent);
}

.silhouette-topic {
  font-size: 0.83rem;
  font-weight: 600;
  color: var(--text-main);
  font-family: var(--font-heading);
  margin: 0;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.silhouette-footer-line {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: var(--font-body);
  border-top: 1px dashed var(--surface-3);
  padding-top: 0.35rem;
  margin-top: 0.2rem;
}


.lead-id-tag {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-muted);
  font-family: var(--font-body);
  background: var(--surface-2);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.viability-pill {
  font-size: 0.7rem;
  font-weight: 700;
  font-family: var(--font-heading);
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  border: 1px solid;
}

.level-alta {
  background: rgba(46, 125, 70, 0.15);
  border-color: rgba(46, 125, 70, 0.4);
  color: var(--accent-emerald);
}

.level-media-alta {
  background: rgba(76, 134, 255, 0.15);
  border-color: rgba(76, 134, 255, 0.4);
  color: var(--accent-cyan);
}

.level-media {
  background: rgba(201, 146, 46, 0.15);
  border-color: rgba(201, 146, 46, 0.4);
  color: var(--accent-amber);
}

.level-baja {
  background: rgba(154, 157, 163, 0.15);
  border-color: rgba(154, 157, 163, 0.4);
  color: var(--text-muted);
}




.card-lead-name {
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text-main);
  font-family: var(--font-heading);
  line-height: 1.3;
  margin: 0;
  /* Un nombre largo se recorta en vez de crecer: si la tarjeta cambia de
     alto, dejan de entrar cinco. El nombre completo va en el `title`. */
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









/* Estado del primer pago en la tarjeta del lead ganado. El proyecto no se
   puede gestionar hasta que finanzas verifica ese pago, así que el vendedor
   necesita verlo (y poder subir el voucher) sin salir del funnel. */
/* Fila del primer pago dentro del panel de detalle del lead. */
.detail-payment-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

.payment-chip {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 0.18rem 0.42rem;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.payment-chip.is-pending {
  color: var(--accent-amber);
  background: rgba(222, 117, 75, 0.1);
  border-color: rgba(222, 117, 75, 0.35);
}

.payment-chip.is-paid {
  color: var(--primary);
  background: rgba(200, 85, 50, 0.08);
  border-color: rgba(200, 85, 50, 0.3);
}

.payment-chip.is-verified {
  color: var(--accent-emerald);
  background: rgba(46, 125, 70, 0.1);
  border-color: rgba(46, 125, 70, 0.35);
}

.payment-upload-btn {
  font-size: 0.62rem;
  font-weight: 600;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  border: 1px dashed var(--border-color);
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.payment-upload-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}







/* Estado Vacío de Columna */
.column-empty-state {
  text-align: center;
  padding: 2.2rem 1rem;
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.empty-icon {
  font-size: 1.5rem;
  opacity: 0.6;
}

.empty-text {
  font-size: 0.76rem;
  font-family: var(--font-body);
  margin: 0;
}

.clear-search-link {
  background: transparent;
  border: none;
  color: var(--primary);
  font-size: 0.75rem;
  font-family: var(--font-body);
  cursor: pointer;
  text-decoration: underline;
  margin-top: 0.2rem;
}

/* Barra de Paginación por Columna Mejorada */
.column-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.45rem 0.5rem;
  background: var(--surface-1);
  border-top: 1px solid var(--border-color);
  flex-wrap: nowrap;
}

.col-page-btn {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  font-size: 0.62rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.col-page-btn.nav-extreme-btn {
  font-size: 0.58rem;
  background: var(--surface-1);
}

.col-page-btn:hover:not(:disabled) {
  background: var(--col-accent, var(--primary));
  border-color: var(--col-accent, var(--primary));
  color: #fff;
}

.col-page-btn:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.page-pills {
  display: flex;
  align-items: center;
  gap: 0.18rem;
}

.page-pill {
  min-width: 22px;
  height: 22px;
  padding: 0 0.25rem;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 600;
  font-family: var(--font-heading);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-pill:hover {
  background: var(--surface-3);
  color: var(--text-main);
}

.page-pill.active {
  background: var(--col-accent, var(--primary));
  color: #ffffff;
  border-color: var(--col-accent, var(--primary));
  box-shadow: 0 0 8px var(--col-accent, var(--primary));
}

.page-pill.ellipsis-pill {
  min-width: 16px;
  font-size: 0.68rem;
  color: var(--text-muted);
  cursor: pointer;
  letter-spacing: -1px;
}

.page-pill.ellipsis-pill:hover {
  color: var(--primary);
  background: rgba(111, 129, 37, 0.15);
}

/* Pie de Columna */
.column-footer {
  padding: 0.45rem 0.75rem;
  border-top: 1px solid var(--border-color);
  font-size: 0.72rem;
  font-family: var(--font-body);
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface-1);
}

.footer-left-info {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.footer-count {
  font-weight: 500;
}

.footer-start-btn {
  background: var(--surface-2);
  border: 1px solid var(--surface-4);
  color: var(--text-main);
  font-size: 0.65rem;
  font-weight: 600;
  font-family: var(--font-body);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.footer-start-btn:hover {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.quoted-tag {
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--accent-amber, #b8860b);
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.quote-move-line {
  margin: 0 0 0.6rem;
  font-size: 0.83rem;
  color: var(--text-main);
}

.quote-move-hint { color: var(--text-muted); }

.quote-undo-btn {
  background: none;
  border: none;
  padding: 0;
  margin-left: 0.4rem;
  font: inherit;
  font-weight: 700;
  color: var(--accent-cyan, #2a7fb8);
  text-decoration: underline;
  cursor: pointer;
}

.quote-undo-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.quote-history { margin-top: 1rem; }

.quote-history-title {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin: 0 0 0.5rem;
}

.quote-history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }

.quote-history-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.2rem 0.8rem;
  align-items: center;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  background: var(--surface-2);
}

.quote-history-main { display: flex; align-items: baseline; gap: 0.6rem; }
.quote-history-number { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.4px; }
.quote-history-amount { font-size: 0.85rem; font-weight: 700; color: var(--accent-emerald, #2e7d46); }
.quote-history-meta { grid-column: 1; font-size: 0.72rem; color: var(--text-muted); display: flex; gap: 0.3rem; flex-wrap: wrap; }
.quote-history-expired { color: var(--accent-danger, #b23a2c); font-weight: 600; }

.quote-history-open {
  grid-column: 2;
  grid-row: 1 / span 2;
  background: var(--surface-3);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.4rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.quote-history-open:disabled { opacity: 0.5; cursor: not-allowed; }

.quote-history-empty { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.8rem; }

.final-tag {
  color: var(--accent-emerald);
  font-weight: 600;
  font-family: var(--font-heading);
}

/* Tarjeta Fantasma: Añadir Nueva Columna */
.add-column-ghost-card {
  flex: 0 0 260px;
  width: 260px;
  min-height: 200px;
  border: 2px dashed var(--surface-4);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: var(--surface-1);
  transition: all 0.25s ease;
}

.add-column-ghost-card:hover {
  border-color: var(--primary);
  background: rgba(111, 129, 37, 0.06);
  transform: translateY(-2px);
}

.ghost-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.4rem;
  padding: 1.5rem;
}

.ghost-plus {
  font-size: 1.8rem;
}

.ghost-text {
  font-size: 0.92rem;
  font-weight: 600;
  font-family: var(--font-heading);
  color: var(--text-main);
}

.ghost-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-body);
}

/* Modales */
.column-modal-card {
  max-width: 520px;
}

.lead-detail-card {
  max-width: 580px;
  transition: max-width 0.2s ease;
}

.lead-detail-card.has-chat {
  max-width: 960px;
}

.modal-body-split {
  display: flex;
  align-items: stretch;
  gap: 1.25rem;
}

.lead-modal-primary {
  flex: 1 1 0;
  min-width: 0;
}

@media (max-width: 900px) {
  .modal-body-split {
    flex-direction: column;
  }
}

.modal-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  color: var(--text-main);
  margin: 0;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  border-radius: 6px;
}

.modal-close-btn:hover {
  color: var(--text-main);
  background: var(--surface-3);
}

.custom-input, .custom-select {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-main);
  font-family: var(--font-body);
}

.custom-input:focus, .custom-select:focus {
  border-color: var(--primary);
}

.emoji-picker-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.emoji-choice-btn {
  height: 36px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.emoji-choice-btn:hover {
  background: var(--surface-3);
  transform: scale(1.1);
}

.emoji-choice-btn.selected {
  background: rgba(111, 129, 37, 0.25);
  border-color: var(--primary);
  box-shadow: 0 0 8px rgba(111, 129, 37, 0.5);
}

.color-picker-grid {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.4rem;
}

.color-choice-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.color-choice-btn:hover {
  transform: scale(1.15);
}

.color-choice-btn.selected {
  border-color: #ffffff;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.6);
  transform: scale(1.1);
}

.checkbox-group {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--surface-1);
  border-radius: 10px;
  border: 1px solid var(--border-color);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.84rem;
  color: var(--text-sub);
  font-family: var(--font-body);
  cursor: pointer;
}

.custom-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
}

.modal-footer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

/* Detalle del Lead en Modal */
.modal-lead-title-area {
  margin-bottom: 1.25rem;
}

.modal-lead-name {
  font-size: 1.15rem;
  font-weight: 700;
  font-family: var(--font-heading);
  color: var(--text-main);
  line-height: 1.35;
  margin: 0 0 0.3rem 0;
}

.modal-lead-topic-sub {
  font-size: 0.84rem;
  font-family: var(--font-body);
  color: var(--text-muted);
  margin: 0;
  line-height: 1.4;
}

.lead-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 1rem;
}

.info-card-panel {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 0.85rem;
}

.panel-subtitle {
  font-size: 0.8rem;
  font-weight: 600;
  font-family: var(--font-heading);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 0.5rem 0;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  margin-bottom: 0.4rem;
  font-size: 0.82rem;
  font-family: var(--font-body);
}

.info-label {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.info-value {
  color: var(--text-main);
}

.info-value.selectable {
  user-select: all;
}

.lead-notes-panel { margin-top: 1.25rem; }

.lead-notes-box {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 0.85rem;
  margin-bottom: 1rem;
  font-size: 0.84rem;
  font-family: var(--font-body);
  color: var(--text-sub);
}

.lead-project-badge-box {
  background: rgba(46, 125, 70, 0.1);
  border: 1px solid rgba(46, 125, 70, 0.35);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  font-family: var(--font-body);
}

.lead-action-buttons {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}

/* Conversación con el bot de WhatsApp (Avan) */
.bot-chat-section {
  margin-top: 1.25rem;
}

/* Historial de etapas: misma caja plegable que la conversación con el bot,
   para que las dos lecturas de la ficha se vean como lo mismo. */
.stage-history-section {
  margin-top: 0.9rem;
}

.stage-history-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.9rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.stage-history-toggle:hover {
  border-color: var(--primary);
}

.stage-history-toggle.is-open {
  border-color: var(--primary);
  background: rgba(111, 129, 37, 0.08);
}

.stage-history-body {
  margin-top: 0.5rem;
  max-height: 260px;
  overflow-y: auto;
}

.stage-history-empty {
  margin: 0;
  padding: 0.6rem 0.2rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.stage-history-empty.is-error {
  color: #B3261E;
}

.stage-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.stage-history-item {
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary);
  border-radius: 8px;
  background: var(--surface-1);
}

/* Un intento rechazado no es un movimiento: se marca distinto para que al
   revisar el historial se vea de un vistazo que ahí el tope sí actuó. */
.stage-history-item.is-blocked {
  border-left-color: #B3261E;
  background: rgba(179, 38, 30, 0.05);
}

.stage-history-move {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-main);
}

.stage-arrow {
  color: var(--text-muted);
}

.stage-blocked-tag {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: rgba(179, 38, 30, 0.12);
  color: #B3261E;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.stage-history-meta {
  margin-top: 0.15rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.stage-history-reason {
  margin: 0.25rem 0 0;
  font-size: 0.74rem;
  color: var(--text-muted);
}

.bot-chat-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.9rem;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.bot-chat-toggle:hover {
  border-color: var(--primary);
}

.bot-chat-toggle.is-open {
  border-color: var(--primary);
  background: rgba(111, 129, 37, 0.08);
}

.bot-chat-toggle-phone {
  margin-left: auto;
  font-weight: 500;
  color: var(--text-muted);
}

.bot-chat-panel {
  flex: 0 0 320px;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

@media (max-width: 900px) {
  .bot-chat-panel {
    flex-basis: auto;
  }
}

.bot-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 0.9rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-main);
  background: var(--surface-2);
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
  max-height: 45vh;
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

.bot-bubble-time {
  display: block;
  margin-top: 0.2rem;
  font-size: 0.66rem;
  opacity: 0.7;
}

.quote-form-section {
  margin-top: 1.25rem;
  padding: 1rem;
  border-radius: 12px;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
}

.quote-heading {
  font-size: 0.95rem;
  font-family: var(--font-heading);
  color: var(--text-main);
  margin: 0 0 0.85rem 0;
}

/* Banner de Proyecto Creado Toast */
.project-created-banner {
  background: rgba(46, 125, 70, 0.15);
  border: 1px solid rgba(46, 125, 70, 0.45);
  border-radius: 12px;
  padding: 0.85rem 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-family: var(--font-body);
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.banner-icon {
  font-size: 1.4rem;
}

.banner-subtext {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-sub);
}

.banner-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.banner-btn.primary {
  background: var(--accent-emerald);
  color: #0b2e21;
  text-decoration: none;
  font-weight: 700;
  font-family: var(--font-heading);
  font-size: 0.78rem;
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
}

.banner-btn.secondary {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.85rem;
}

/* Transiciones */
.toast-slide-enter-active, .toast-slide-leave-active {
  transition: all 0.3s ease;
}
.toast-slide-enter-from, .toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .kanban-page-wrapper {
    padding: 1rem;
  }
  .lead-info-grid {
    grid-template-columns: 1fr;
  }
  .kanban-column {
    flex: 0 0 290px;
    width: 290px;
  }
}
</style>
