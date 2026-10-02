<template>
  <main class="container-fluid project-detail-page">
    <router-link to="/admin/projects" style="color: var(--accent-cyan); font-size: 0.85rem; text-decoration: none; display: inline-block; margin-bottom: 1rem;">
      ← Volver a Proyectos
    </router-link>

    <div v-if="loadError" class="info-box" style="border-color: rgba(200, 85, 50, 0.4); margin-bottom: 1.5rem;">
      <h4 style="color: var(--accent-rose);">⚠️ No se pudo cargar el proyecto</h4>
      <p>{{ loadError }}</p>
    </div>

    <div v-if="project">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
        <div>
          <h2 class="section-heading"><span>🚀</span> {{ project.topic }}</h2>
          <p class="section-subheading" style="margin-bottom: 0;">
            ✉️ {{ project.client_email }} | 📱 {{ project.client_phone }} | {{ project.academic_level }} — {{ project.field_of_study }}
          </p>
        </div>
        <span :class="['status-pill', statusClass(project.status)]" style="font-size: 0.85rem; padding: 0.35rem 0.9rem;">
          <span v-if="isLocked">🔒 </span>{{ project.status }}
        </span>
      </div>

      <!-- Mientras Finanzas no verifique el primer pago, el proyecto se consulta
           pero no se gestiona: el backend rechaza igual cualquier cambio. -->
      <div v-if="isLocked" class="locked-banner">
        <div class="locked-banner-text">
          <h4>⚠️ Esperando la verificación del primer pago</h4>
          <p>
            El primer pago ({{ project.initial_payment?.code }}) está en estado
            <strong>{{ project.initial_payment?.estado }}</strong>. Hasta que Finanzas lo
            verifique, este proyecto es de solo lectura: no se pueden crear tareas, asignar
            equipo ni publicar avances.
          </p>
        </div>
        <label v-if="project.initial_payment?.estado === 'pendiente'" class="locked-upload-btn">
          <input type="file" accept="image/*,application/pdf" multiple hidden :disabled="isUploadingVoucher" @change="uploadVoucher" />
          {{ isUploadingVoucher ? 'Subiendo...' : '📎 Subir voucher' }}
        </label>
      </div>

      <!-- Equipo y Plazo -->
      <div class="glass-panel" style="padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 0.95rem; color: var(--accent-cyan); margin-bottom: 1rem;">👥 Equipo y Plazo</h3>

        <div class="team-grid">
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">📅 Fecha límite</label>
            <div style="display: flex; gap: 0.5rem;">
              <input v-model="deadlineInput" type="date" class="form-input" style="border-radius: 10px;" :disabled="isLocked" />
              <button class="btn-secondary" style="white-space: nowrap;" :disabled="isLocked" @click="saveDeadline">Guardar</button>
            </div>
            <p v-if="isOverdue" style="color: var(--accent-rose); font-size: 0.78rem; margin-top: 0.4rem;">⚠️ Plazo vencido</p>
          </div>

          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">🧭 Líder del Proyecto</label>
            <select :value="project.leader_id || ''" class="form-select" :disabled="isLocked" @change="saveLeader($event.target.value)">
              <option value="">Sin asignar</option>
              <option v-for="member in teamDirectory" :key="member.id" :value="member.id">{{ member.name }}</option>
            </select>
          </div>
        </div>

        <div class="form-group" style="margin-top: 1.1rem; margin-bottom: 0;">
          <label class="form-label">🤝 Colaboradores</label>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
            <span v-for="collaborator in project.collaborators" :key="collaborator.id" class="collaborator-chip">
              {{ collaborator.name }}
              <button v-if="!isLocked" type="button" title="Quitar colaborador" @click="removeCollaborator(collaborator.id)">✕</button>
            </span>
            <span v-if="!project.collaborators || project.collaborators.length === 0" style="color: var(--text-muted); font-size: 0.82rem;">
              Sin colaboradores asignados.
            </span>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <select v-model="collaboratorToAdd" class="form-select" :disabled="isLocked">
              <option value="" disabled>Selecciona un colaborador para agregar</option>
              <option v-for="member in availableCollaborators" :key="member.id" :value="member.id">{{ member.name }}</option>
            </select>
            <button class="btn-secondary" style="white-space: nowrap;" :disabled="!collaboratorToAdd || isLocked" @click="addCollaborator">Agregar</button>
          </div>
        </div>
      </div>

      <!-- Progreso del Proyecto -->
      <div class="glass-panel" style="padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <h3 style="font-size: 0.95rem; color: var(--accent-cyan);">📈 Avance del Proyecto</h3>
          <strong style="color: var(--text-main);">{{ progressPercentage }}% ({{ completedCount }}/{{ tasks.length }} tareas)</strong>
        </div>
        <div class="metric-bar-bg">
          <div class="metric-bar-fill" :style="{ width: progressPercentage + '%', background: progressColor(progressPercentage) }"></div>
        </div>
      </div>

      <!-- Tabs: Tareas / Línea de Tiempo -->
      <div class="tab-bar">
        <button type="button" class="tab-button" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">
          🗂️ Tablero de Tareas
        </button>
        <button type="button" class="tab-button" :class="{ active: activeTab === 'timeline' }" @click="activeTab = 'timeline'">
          📅 Línea de Tiempo
        </button>
      </div>

      <div v-if="activeTab === 'tasks'">
        <!-- Plan de entregas del proyecto. Es el mismo que trabaja el módulo de
             Entregables (de ahí salen el estado y el cruce con el cobro), pero
             visto desde adentro: acá cada entregable es el PAQUETE DE TRABAJO
             que hay que terminar, con sus tareas y su avance. Al elegir uno, el
             tablero de abajo se queda solo con sus tareas. -->
        <div class="glass-panel deliverables-panel">
          <div class="deliverables-head">
            <h3 class="deliverables-title">📦 Entregables del proyecto</h3>
            <div class="deliverables-head-actions">
              <button
                v-if="contractPlanAvailable > 0"
                type="button"
                class="btn-secondary deliverable-btn"
                :disabled="isLocked || isImportingPlan"
                title="Copia las entregas comprometidas en el contrato vigente"
                @click="importContractPlan"
              >
                {{ isImportingPlan ? 'Importando…' : `📄 Traer ${contractPlanAvailable} del contrato` }}
              </button>
              <button
                type="button"
                class="btn-secondary deliverable-btn"
                :disabled="isLocked"
                @click="showDeliverableForm = !showDeliverableForm"
              >
                {{ showDeliverableForm ? '✕ Cancelar' : '➕ Agregar entregable' }}
              </button>
            </div>
          </div>

          <form v-if="showDeliverableForm" class="deliverable-form" @submit.prevent="addDeliverable">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">¿Qué se entrega?</label>
              <input v-model="deliverableForm.title" type="text" class="form-input" placeholder="Ej: Capítulo I y II" required />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label">Fecha pactada</label>
              <input v-model="deliverableForm.dueDate" type="date" class="form-input" />
            </div>
            <button type="submit" class="btn-primary deliverable-submit" :disabled="!deliverableForm.title.trim() || deliverableSaving">
              {{ deliverableSaving ? 'Guardando…' : 'Agregar' }}
            </button>
            <!-- Acá se planifica QUÉ se entrega y para cuándo. Contra qué cuota
                 se entrega es del módulo de Entregables: Proyectos no muestra
                 ni registra nada del cobro (el backend tampoco lo manda). -->
            <p class="deliverable-hint">
              El cobro no se toca desde acá: si esta entrega depende de una cuota, se ata en
              el módulo de Entregables.
            </p>
            <p v-if="deliverableError" class="deliverable-error">⚠️ {{ deliverableError }}</p>
          </form>

          <p v-if="deliverables.length === 0" class="deliverables-empty">
            Este proyecto todavía no tiene entregables.
            <template v-if="contractPlanAvailable > 0">
              Puedes traer los del contrato con el botón de arriba.
            </template>
            <template v-else>Agrega el primero para empezar a colgarle tareas.</template>
          </p>

          <div v-else class="deliverable-cards">
            <!-- Cada tarjeta filtra el tablero: es la forma de pasar del "qué
                 hay que entregar" al "qué falta hacer para entregarlo". -->
            <article
              v-for="item in deliverables"
              :key="item.id"
              class="deliverable-card"
              :class="{ 'is-active': String(deliverableFilter) === String(item.id) }"
            >
              <button
                type="button"
                class="deliverable-card-main"
                :title="`Ver solo las tareas de ${item.title}`"
                @click="deliverableFilter = String(deliverableFilter) === String(item.id) ? 'all' : item.id"
              >
                <span class="deliverable-card-title">{{ item.title }}</span>
                <!-- Solo el trabajo: qué se entrega, para cuándo y si ya salió.
                     La cuota atada y el estado que sale de cruzarla con el pago
                     ("sin cobrar", "por entregar") son del módulo de
                     Entregables — el backend ni siquiera los manda acá. -->
                <span class="deliverable-card-meta">
                  <span v-if="item.due_date">📅 {{ formatDate(item.due_date) }}</span>
                  <span v-if="item.is_overdue" class="deliverable-tag is-bad">fuera de fecha</span>
                  <span v-if="item.status === 'entregado'" class="deliverable-tag is-ok">entregado</span>
                </span>
                <span class="deliverable-card-tasks">
                  <template v-if="item.task_total > 0">
                    🗂️ {{ item.task_done }}/{{ item.task_total }} tareas ({{ item.task_progress }}%)
                  </template>
                  <template v-else>Sin tareas todavía</template>
                </span>
                <span v-if="item.task_total > 0" class="deliverable-bar">
                  <span class="deliverable-bar-fill" :style="{ width: item.task_progress + '%' }"></span>
                </span>
              </button>
              <button
                type="button"
                class="deliverable-remove"
                title="Quitar del plan (las tareas no se borran)"
                :disabled="isLocked"
                @click="removeDeliverable(item)"
              >✕</button>
            </article>
          </div>

          <!-- Filtro del tablero. "Sueltas" existe para que las tareas internas
               (coordinar con el asesor, revisar formato) no desaparezcan por no
               pertenecer a ninguna entrega. -->
          <div v-if="deliverables.length > 0" class="deliverable-filters">
            <button type="button" class="deliverable-filter" :class="{ 'is-on': deliverableFilter === 'all' }" @click="deliverableFilter = 'all'">
              Ver todas ({{ tasks.length }})
            </button>
            <button type="button" class="deliverable-filter" :class="{ 'is-on': deliverableFilter === 'none' }" @click="deliverableFilter = 'none'">
              Sueltas ({{ looseTaskCount }})
            </button>
          </div>
        </div>

        <!-- Agregar tarea (todo) -->
        <div class="glass-panel" style="padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.95rem; color: var(--accent-cyan);">📝 Agregar Tarea</h3>
            <button type="button" class="btn-secondary" style="padding: 0.35rem 0.8rem; font-size: 0.8rem;" @click="openTemplates">
              📋 Plantillas
            </button>
          </div>
          <form class="add-task-form" @submit.prevent="addTask">
            <input
              v-model="newTaskTitle"
              type="text"
              class="form-input"
              placeholder="Ej: Redactar marco teórico, capítulo 2..."
              style="border-radius: 10px;"
              :disabled="isLocked"
            />
            <select v-if="deliverables.length > 0" v-model="newTaskDeliverableId" class="form-select add-task-deliverable" :disabled="isLocked">
              <option value="">Sin entregable</option>
              <option v-for="item in deliverables" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select>
            <button type="submit" class="btn-primary" style="width: auto; padding: 0 1.5rem; border-radius: 10px;" :disabled="!newTaskTitle.trim() || isLocked">
              Agregar
            </button>
          </form>
        </div>

        <!-- Un proyecto sin tareas arranca con la plantilla que le toca (la de
             su universidad, si hay): se ven las tareas antes de importarlas. -->
        <div v-if="suggestedTemplate" class="template-suggestion">
          <div class="template-suggestion-main">
            <h4>
              📋 {{ suggestedTemplate.name }}
              <span v-if="suggestedTemplate.university" class="template-chip">{{ suggestedTemplate.university }}</span>
            </h4>
            <p class="template-suggestion-hint">
              Este proyecto todavía no tiene tareas. La plantilla
              {{ suggestedTemplate.university ? `de ${suggestedTemplate.university}` : 'general' }}
              trae {{ suggestedTemplate.items.length }}:
            </p>
            <ul class="template-preview">
              <li v-for="item in suggestedTemplate.items.slice(0, 6)" :key="item.id">{{ item.title }}</li>
              <li v-if="suggestedTemplate.items.length > 6" class="is-more">
                + {{ suggestedTemplate.items.length - 6 }} más…
              </li>
            </ul>
          </div>
          <div class="template-suggestion-actions">
            <button class="btn-primary" style="width: auto; padding: 0.5rem 1.1rem;" :disabled="isLocked || isImporting" @click="importTemplate(suggestedTemplate)">
              {{ isImporting ? 'Importando...' : 'Usar estas tareas' }}
            </button>
            <button class="btn-secondary" style="padding: 0.5rem 1.1rem;" @click="openTemplates">Ver otras</button>
          </div>
        </div>

        <!-- Kanban de Tareas -->
        <div class="task-board">
          <div
            v-for="col in TASK_COLUMNS"
            :key="col.key"
            class="task-column"
            :class="{ 'is-drag-over': hoveredColumn === col.key }"
            @dragover.prevent="hoveredColumn = col.key"
            @dragleave="onColumnDragLeave(col.key)"
            @drop="onDrop(col.key)"
          >
            <div class="task-column-header">
              <span>{{ col.icon }} {{ col.label }}</span>
              <span class="kanban-count">{{ (tasksByColumn[col.key] || []).length }}</span>
            </div>

            <div class="task-column-body">
              <div
                v-for="task in tasksByColumn[col.key]"
                :key="task.id"
                class="task-card"
                :draggable="!isLocked"
                @dragstart="onDragStart(task)"
                @dragend="hoveredColumn = null"
              >
                <label class="task-checkbox-row">
                  <input
                    type="checkbox"
                    :checked="task.status === 'completado'"
                    :disabled="isLocked"
                    @change="toggleComplete(task, $event.target.checked)"
                  />
                  <span :style="{ textDecoration: task.status === 'completado' ? 'line-through' : 'none', opacity: task.status === 'completado' ? 0.6 : 1 }">
                    {{ task.title }}
                  </span>
                </label>
                <button v-if="!isLocked" class="task-delete-btn" title="Eliminar tarea" @click="removeTask(task)">✕</button>

                <!-- De qué entregable es esta tarea. Se ve siempre (si no, al
                     mirar el tablero completo no habría forma de saber para qué
                     entrega es cada cosa) y se puede cambiar sin reescribirla. -->
                <select
                  v-if="deliverables.length > 0"
                  class="task-deliverable-select"
                  :class="{ 'is-loose': !task.deliverable_id }"
                  :value="task.deliverable_id || ''"
                  :disabled="isLocked"
                  :title="task.deliverable_id ? deliverableById.get(task.deliverable_id)?.title : 'Esta tarea no cuelga de ningún entregable'"
                  @click.stop
                  @change="moveTaskToDeliverable(task, $event.target.value)"
                >
                  <option value="">📄 Sin entregable</option>
                  <option v-for="item in deliverables" :key="item.id" :value="item.id">📦 {{ item.title }}</option>
                </select>
              </div>

              <div v-if="(tasksByColumn[col.key] || []).length === 0" class="kanban-empty">
                Sin tareas
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Línea de Tiempo del Proyecto -->
      <div v-else>
        <div class="glass-panel" style="padding: 1.25rem 1.5rem; margin-bottom: 1.5rem;">
          <form @submit.prevent="publishUpdate">
            <div class="form-group">
              <label class="form-label">Nueva actualización</label>
              <textarea
                v-model="newUpdateContent"
                class="form-textarea"
                style="min-height: 80px;"
                placeholder="Describe el hito o avance (ej: Se sustentó el capítulo 1 ante el asesor)..."
                :disabled="isLocked"
              ></textarea>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
              <input type="file" class="update-file-input" :disabled="isLocked" @change="onFileSelected" />
              <button type="submit" class="btn-primary" style="width: auto; padding: 0 1.5rem; border-radius: 10px;" :disabled="!newUpdateContent.trim() || isPublishing || isLocked">
                {{ isPublishing ? 'Publicando...' : 'Publicar Actualización' }}
              </button>
            </div>

            <!-- El entregable se sube igual, pero el cliente no lo descarga
                 hasta que Finanzas verifique la cuota que se elija acá. -->
            <div v-if="newUpdateFile" class="update-gate">
              <label class="form-label">Se libera al cliente con…</label>
              <select v-model="newUpdateIncomeId" class="form-select" :disabled="isLocked">
                <option value="">Sin condición — descargable apenas se publique</option>
                <option v-for="p in payments" :key="p.id" :value="p.id" :disabled="p.estado === 'verificado'">
                  Cuota {{ p.cuota }} · vence {{ formatDate(p.due_date) }}
                  {{ p.estado === 'verificado' ? '(ya verificada)' : '' }}
                </option>
              </select>
              <p class="update-gate-hint">
                El cliente ve el avance en su portal con el adjunto bloqueado; sube su comprobante
                y, cuando Finanzas lo verifica, la descarga se habilita sola.
              </p>
            </div>
          </form>
        </div>

        <div v-if="updates.length > 0" class="timeline-list">
          <div v-for="update in updates" :key="update.id" class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-content">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; flex-wrap: wrap;">
                <strong style="color: var(--text-main); font-size: 0.85rem;">{{ update.author_name || 'Usuario' }}</strong>
                <span class="timeline-meta">
                  <span style="color: var(--text-muted); font-size: 0.75rem;">{{ formatDateTime(update.created_at) }}</span>
                  <button
                    v-if="!isLocked"
                    type="button"
                    class="timeline-delete-btn"
                    title="Eliminar este hito de la línea de tiempo"
                    :disabled="deletingUpdateId === update.id"
                    @click="removeUpdate(update)"
                  >{{ deletingUpdateId === update.id ? '…' : '✕' }}</button>
                </span>
              </div>
              <p style="color: var(--text-sub); font-size: 0.88rem; margin-top: 0.4rem; white-space: pre-line;">{{ update.content }}</p>
              <button
                v-if="update.attachment_filename"
                type="button"
                class="btn-secondary"
                style="margin-top: 0.6rem; font-size: 0.78rem; padding: 0.35rem 0.75rem;"
                @click="downloadAttachment(update)"
              >
                📎 {{ update.attachment_original_name }} ({{ formatFileSize(update.attachment_size) }})
              </button>
              <p v-if="update.income_id" class="update-gate-state" :class="{ 'is-open': !update.is_locked }">
                {{ update.is_locked ? '🔒 Bloqueado para el cliente' : '🔓 Liberado al cliente' }}
                — cuota {{ update.unlock_cuota }},
                {{ update.is_locked ? `en estado "${update.unlock_estado}"` : 'verificada por Finanzas' }}.
              </p>
            </div>
          </div>
        </div>
        <div v-else class="glass-panel" style="padding: 2rem; text-align: center; color: var(--text-muted);">
          Aún no hay actualizaciones. Publica el primer hito del proyecto arriba.
        </div>
      </div>
    </div>
    <!-- Modal: plantillas de tareas -->
    <div v-if="showTemplates" class="modal-overlay" @click.self="showTemplates = false">
      <div class="modal-content" style="max-width: 640px;">
        <div class="modal-header">
          <h3 style="font-family: var(--font-heading); font-size: 1.05rem; color: var(--text-main); margin: 0;">
            📋 Plantillas de tareas
          </h3>
          <button class="btn-secondary" style="padding: 0.3rem 0.75rem;" @click="showTemplates = false">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <div class="template-filters">
            <input v-model="templateSearch" type="text" class="form-input" placeholder="🔎 Buscar por nombre..." />
            <select v-model="templateUniversity" class="form-select">
              <option value="">Todas las universidades</option>
              <option v-for="uni in templateUniversities" :key="uni" :value="uni">{{ uni }}</option>
            </select>
          </div>

          <p v-if="templateError" style="color: var(--accent-rose); font-size: 0.82rem;">{{ templateError }}</p>

          <div v-if="filteredTemplates.length > 0" class="template-list">
            <div v-for="template in filteredTemplates" :key="template.id" class="template-card">
              <div class="template-card-main">
                <h4>
                  {{ template.name }}
                  <span v-if="template.university" class="template-chip">{{ template.university }}</span>
                </h4>
                <p class="template-card-meta">
                  {{ template.items.length }} tarea(s) · usada {{ template.times_used }} vez(ces)
                  <template v-if="template.created_by_name">· {{ template.created_by_name }}</template>
                </p>
                <ul class="template-preview">
                  <li v-for="item in template.items.slice(0, 4)" :key="item.id">{{ item.title }}</li>
                  <li v-if="template.items.length > 4" class="is-more">+ {{ template.items.length - 4 }} más…</li>
                </ul>
              </div>
              <div class="template-card-actions">
                <button class="btn-primary" style="width: auto; padding: 0.4rem 0.9rem; font-size: 0.8rem;" :disabled="isLocked || isImporting" @click="importTemplate(template)">
                  Importar
                </button>
                <button class="template-delete-btn" title="Eliminar plantilla" @click="deleteTemplate(template)">🗑️</button>
              </div>
            </div>
          </div>
          <p v-else class="template-empty">
            {{ templates.length === 0
              ? 'Todavía no hay plantillas guardadas. Arma las tareas de un proyecto y guárdalas acá abajo.'
              : 'Ninguna plantilla coincide con la búsqueda.' }}
          </p>

          <!-- Guardar las tareas de este proyecto como plantilla nueva -->
          <div class="template-save">
            <h4>💾 Guardar las tareas de este proyecto</h4>
            <p class="template-save-hint">
              Se guardan las {{ tasks.length }} tarea(s) actuales con su orden. La universidad es opcional:
              sin ella queda como plantilla general.
            </p>
            <div class="template-save-fields">
              <input v-model="newTemplate.name" type="text" class="form-input" placeholder="Nombre (ej: Tesis pregrado — UNCP)" />
              <input v-model="newTemplate.university" type="text" class="form-input" list="template-universities" placeholder="Universidad (opcional)" />
              <datalist id="template-universities">
                <option v-for="uni in templateUniversities" :key="uni" :value="uni"></option>
              </datalist>
            </div>
            <button
              class="btn-secondary"
              style="margin-top: 0.6rem;"
              :disabled="tasks.length === 0 || !newTemplate.name.trim() || isSavingTemplate"
              @click="saveCurrentAsTemplate"
            >
              {{ isSavingTemplate ? 'Guardando...' : `Guardar ${tasks.length} tarea(s) como plantilla` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';

const props = defineProps({ id: { type: String, required: true } });

const TASK_COLUMNS = [
  { key: 'pendiente', label: 'Pendiente', icon: '📋' },
  { key: 'en_progreso', label: 'En Progreso', icon: '⚙️' },
  { key: 'completado', label: 'Completado', icon: '✅' }
];

const activeTab = ref('tasks');
const project = ref(null);
const tasks = ref([]);
const updates = ref([]);
const teamDirectory = ref([]);
const loadError = ref('');
const newTaskTitle = ref('');
const draggedTask = ref(null);
const hoveredColumn = ref(null);
const deadlineInput = ref('');
const collaboratorToAdd = ref('');
const newUpdateContent = ref('');
const newUpdateFile = ref(null);
const newUpdateIncomeId = ref('');
const payments = ref([]);
const isPublishing = ref(false);
const deletingUpdateId = ref(null);
const isUploadingVoucher = ref(false);

// Plantillas de tareas: conjuntos guardados que se importan al proyecto.
const templates = ref([]);
const templateUniversities = ref([]);
const showTemplates = ref(false);
const templateSearch = ref('');
const templateUniversity = ref('');
const templateError = ref('');
const isImporting = ref(false);
const isSavingTemplate = ref(false);
const newTemplate = reactive({ name: '', university: '' });

/**
 * El proyecto está a la espera de que Finanzas verifique su primer pago. Lo
 * decide el backend (`is_locked`), que además rechaza cualquier cambio: aquí
 * solo se refleja en la UI para no ofrecer botones que van a fallar.
 */
const isLocked = computed(() => Boolean(project.value?.is_locked));

/** Atajo para que el responsable del proyecto adjunte el voucher del primer pago. */
async function uploadVoucher(event) {
  const files = Array.from(event.target.files || []).slice(0, 10);
  event.target.value = '';
  const incomeId = project.value?.initial_payment?.id;
  if (files.length === 0 || !incomeId) return;

  isUploadingVoucher.value = true;
  try {
    const fd = new FormData();
    for (const file of files) fd.append('receipts', file);
    const response = await apiFetch(`/api/finance/income/${incomeId}/receipts`, { method: 'POST', body: fd });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo subir el voucher.');
    await fetchProject();
  } catch (err) {
    alert('No se pudo subir el voucher: ' + err.message);
  } finally {
    isUploadingVoucher.value = false;
  }
}

// ------------------------------------------------- Entregables del proyecto

/**
 * El plan de entregas visto desde el proyecto: qué hay que entregarle al
 * cliente, con qué fecha y contra qué cuota. Sale del contrato (importado) o se
 * agrega a mano, y es el mismo plan que trabaja el módulo de Entregables.
 *
 * Acá vive para que el tablero deje de ser treinta tareas sueltas: cada
 * entregable es un paquete de trabajo con SUS tareas, y al elegir uno el
 * tablero se queda solo con ellas.
 */
const deliverables = ref([]);
const contractPlanAvailable = ref(0);
const deliverableFilter = ref('all');
const newTaskDeliverableId = ref('');
const isImportingPlan = ref(false);
const showDeliverableForm = ref(false);
// Sin `incomeId`: desde el proyecto se planifica el trabajo, no el cobro.
const deliverableForm = reactive({ title: '', dueDate: '' });
const deliverableSaving = ref(false);
const deliverableError = ref('');

const deliverableById = computed(() => new Map(deliverables.value.map((d) => [d.id, d])));

/**
 * Las tareas que el tablero muestra. `all` es todo; `none` son las tareas
 * internas que no cuelgan de ninguna entrega (coordinar con el asesor, revisar
 * formato) y que por eso no desaparecen del tablero.
 */
const visibleTasks = computed(() => {
  if (deliverableFilter.value === 'all') return tasks.value;
  if (deliverableFilter.value === 'none') return tasks.value.filter((t) => !t.deliverable_id);
  return tasks.value.filter((t) => Number(t.deliverable_id) === Number(deliverableFilter.value));
});

const looseTaskCount = computed(() => tasks.value.filter((t) => !t.deliverable_id).length);

const tasksByColumn = computed(() => {
  const grouped = {};
  for (const col of TASK_COLUMNS) grouped[col.key] = [];
  for (const task of visibleTasks.value) {
    (grouped[task.status] || grouped.pendiente).push(task);
  }
  return grouped;
});

const completedCount = computed(() => tasks.value.filter(t => t.status === 'completado').length);
const progressPercentage = computed(() => tasks.value.length === 0 ? 0 : Math.round((completedCount.value / tasks.value.length) * 100));

const availableCollaborators = computed(() => {
  const collaboratorIds = new Set((project.value?.collaborators || []).map(c => c.id));
  return teamDirectory.value.filter(member => !collaboratorIds.has(member.id));
});

const isOverdue = computed(() => {
  if (!project.value?.deadline) return false;
  if (['Entregado', 'Cancelado'].includes(project.value.status)) return false;
  return new Date(project.value.deadline) < new Date(new Date().toDateString());
});

async function fetchProject() {
  const response = await apiFetch(`/api/projects/${props.id}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener el proyecto.');
  project.value = data.project;
  deadlineInput.value = toDateInputValue(data.project.deadline);
}

async function fetchTasks() {
  const response = await apiFetch(`/api/projects/${props.id}/tasks`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener las tareas.');
  tasks.value = data.tasks || [];
}

async function fetchDeliverables() {
  const response = await apiFetch(`/api/projects/${props.id}/deliverables`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener los entregables.');
  deliverables.value = data.deliverables || [];
  contractPlanAvailable.value = data.contract_plan_available || 0;

  // Si el entregable que se estaba mirando ya no está, el tablero vuelve a
  // mostrarlo todo en vez de quedarse vacío sin decir por qué.
  if (deliverableFilter.value !== 'all' && deliverableFilter.value !== 'none'
    && !deliverables.value.some((d) => Number(d.id) === Number(deliverableFilter.value))) {
    deliverableFilter.value = 'all';
  }
}

async function addDeliverable() {
  const title = deliverableForm.title.trim();
  if (!title) return;
  deliverableSaving.value = true;
  deliverableError.value = '';
  try {
    const response = await apiFetch(`/api/projects/${props.id}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate: deliverableForm.dueDate || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo agregar el entregable.');
    Object.assign(deliverableForm, { title: '', dueDate: '' });
    showDeliverableForm.value = false;
    await fetchDeliverables();
  } catch (err) {
    deliverableError.value = err.message;
  } finally {
    deliverableSaving.value = false;
  }
}

/**
 * Quita un entregable del plan. Las tareas que colgaban de él NO se borran:
 * quedan sueltas en el tablero, porque sacar algo del plan no puede borrar el
 * trabajo que ya se hizo. El aviso lo dice para que nadie lo descubra después.
 */
async function removeDeliverable(deliverable) {
  const withTasks = deliverable.task_total > 0
    ? `\n\nSus ${deliverable.task_total} tarea(s) NO se borran: quedan sueltas en el tablero.`
    : '';
  if (!window.confirm(`¿Quitar "${deliverable.title}" del plan de entregas?${withTasks}`)) return;

  try {
    const response = await apiFetch(`/api/projects/${props.id}/deliverables/${deliverable.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo quitar el entregable.');
    await Promise.all([fetchDeliverables(), fetchTasks()]);
  } catch (err) {
    alert('No se pudo quitar el entregable: ' + err.message);
  }
}

async function importContractPlan() {
  isImportingPlan.value = true;
  try {
    const response = await apiFetch(`/api/projects/${props.id}/deliverables/import`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo importar el cronograma del contrato.');
    await fetchDeliverables();
  } catch (err) {
    alert('No se pudo importar: ' + err.message);
  } finally {
    isImportingPlan.value = false;
  }
}

/** Mueve una tarea a otro entregable del proyecto, o la deja suelta. */
async function moveTaskToDeliverable(task, deliverableId) {
  const previous = task.deliverable_id;
  task.deliverable_id = deliverableId ? Number(deliverableId) : null;
  try {
    const response = await apiFetch(`/api/tasks/${task.id}/deliverable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliverableId: deliverableId || null })
    });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo mover la tarea.');
    await fetchDeliverables();
  } catch (err) {
    task.deliverable_id = previous;
    alert('No se pudo mover la tarea: ' + err.message);
  }
}

async function fetchUpdates() {
  const response = await apiFetch(`/api/projects/${props.id}/updates`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener la línea de tiempo.');
  updates.value = data.updates || [];
}

/** Cronograma del proyecto: alimenta el selector "se libera con la cuota…". */
async function fetchPayments() {
  const response = await apiFetch(`/api/projects/${props.id}/payments`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener el cronograma de pagos.');
  payments.value = data.payments || [];
}

/**
 * Borra un hito publicado. Se confirma porque el adjunto se va con él: el
 * archivo se elimina del disco y el cliente deja de verlo en su portal.
 */
async function removeUpdate(update) {
  const label = update.attachment_original_name
    ? `"${update.content.slice(0, 60)}" y su adjunto ${update.attachment_original_name}`
    : `"${update.content.slice(0, 60)}"`;
  if (!window.confirm(`¿Eliminar ${label}?

El cliente dejará de verlo en su portal y no se puede deshacer.`)) return;

  deletingUpdateId.value = update.id;
  try {
    const response = await apiFetch(`/api/project-updates/${update.id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la actualización.');
    updates.value = updates.value.filter((u) => u.id !== update.id);
  } catch (err) {
    alert('No se pudo eliminar la actualización: ' + err.message);
  } finally {
    deletingUpdateId.value = null;
  }
}

async function fetchTemplates() {
  const response = await apiFetch('/api/task-templates');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener las plantillas de tareas.');
  templates.value = data.templates || [];
  templateUniversities.value = data.universities || [];
}

async function fetchTeamDirectory() {
  const response = await apiFetch('/api/team-directory');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Error al obtener el directorio de equipo.');
  teamDirectory.value = data.users || [];
}

async function loadAll() {
  loadError.value = '';
  try {
    await Promise.all([fetchProject(), fetchTasks(), fetchDeliverables(), fetchUpdates(), fetchPayments(), fetchTeamDirectory(), fetchTemplates()]);
  } catch (err) {
    loadError.value = err.message;
  }
}

function toDateInputValue(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

async function saveDeadline() {
  try {
    const response = await apiFetch(`/api/projects/${props.id}/deadline`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline: deadlineInput.value || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al guardar el plazo.');
    project.value = { ...project.value, ...data.project };
  } catch (err) {
    alert('No se pudo guardar el plazo: ' + err.message);
  }
}

async function saveLeader(userId) {
  try {
    const response = await apiFetch(`/api/projects/${props.id}/leader`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al asignar el líder.');
    project.value = { ...project.value, ...data.project };
  } catch (err) {
    alert('No se pudo asignar el líder: ' + err.message);
  }
}

async function addCollaborator() {
  if (!collaboratorToAdd.value) return;
  try {
    const response = await apiFetch(`/api/projects/${props.id}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: collaboratorToAdd.value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al agregar el colaborador.');
    project.value = { ...project.value, ...data.project };
    collaboratorToAdd.value = '';
  } catch (err) {
    alert('No se pudo agregar el colaborador: ' + err.message);
  }
}

async function removeCollaborator(userId) {
  try {
    const response = await apiFetch(`/api/projects/${props.id}/collaborators/${userId}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al quitar el colaborador.');
    project.value = { ...project.value, ...data.project };
  } catch (err) {
    alert('No se pudo quitar el colaborador: ' + err.message);
  }
}

function onFileSelected(event) {
  newUpdateFile.value = event.target.files[0] || null;
}

async function publishUpdate() {
  const content = newUpdateContent.value.trim();
  if (!content) return;
  isPublishing.value = true;
  try {
    const formData = new FormData();
    formData.append('content', content);
    if (newUpdateFile.value) formData.append('attachment', newUpdateFile.value);
    if (newUpdateFile.value && newUpdateIncomeId.value) formData.append('incomeId', newUpdateIncomeId.value);

    const response = await apiFetch(`/api/projects/${props.id}/updates`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al publicar la actualización.');

    updates.value.unshift(data.update);
    newUpdateContent.value = '';
    newUpdateFile.value = null;
    newUpdateIncomeId.value = '';
    const fileInput = document.querySelector('.update-file-input');
    if (fileInput) fileInput.value = '';
  } catch (err) {
    alert('No se pudo publicar la actualización: ' + err.message);
  } finally {
    isPublishing.value = false;
  }
}

async function downloadAttachment(update) {
  try {
    const response = await apiFetch(`/api/project-updates/${update.id}/attachment`);
    if (!response.ok) throw new Error('Error al descargar el archivo.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = update.attachment_original_name || 'archivo';
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('No se pudo descargar el adjunto: ' + err.message);
  }
}

/** Fecha corta de una cuota ("12 oct 2026"); las del backend vienen como YYYY-MM-DD. */
function formatDate(value) {
  if (!value) return 'sin fecha';
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return 'sin fecha';
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function addTask() {
  const title = newTaskTitle.value.trim();
  if (!title) return;
  try {
    const response = await apiFetch(`/api/projects/${props.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, deliverableId: newTaskDeliverableId.value || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al crear la tarea.');
    tasks.value.push(data.task);
    newTaskTitle.value = '';
    // El entregable elegido se mantiene: al desglosar una entrega se cargan
    // varias tareas seguidas, y volver a elegirlo cada vez sobra.
    if (data.task.deliverable_id) await fetchDeliverables();
  } catch (err) {
    alert('No se pudo agregar la tarea: ' + err.message);
  }
}

async function removeTask(task) {
  const previousTasks = tasks.value;
  tasks.value = tasks.value.filter(t => t.id !== task.id);
  try {
    const response = await apiFetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Error al eliminar la tarea.');
  } catch (err) {
    tasks.value = previousTasks;
    alert('No se pudo eliminar la tarea: ' + err.message);
  }
}

async function toggleComplete(task, checked) {
  await moveTaskToStatus(task, checked ? 'completado' : 'pendiente');
}

function onDragStart(task) {
  draggedTask.value = task;
}

function onColumnDragLeave(colKey) {
  if (hoveredColumn.value === colKey) hoveredColumn.value = null;
}

function onDrop(columnKey) {
  hoveredColumn.value = null;
  const task = draggedTask.value;
  draggedTask.value = null;
  if (!task || task.status === columnKey) return;
  moveTaskToStatus(task, columnKey);
}

async function moveTaskToStatus(task, newStatus) {
  const previousStatus = task.status;
  task.status = newStatus;
  try {
    const response = await apiFetch(`/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al actualizar la tarea.');
    task.status = data.task.status;
  } catch (err) {
    task.status = previousStatus;
    alert('No se pudo actualizar la tarea: ' + err.message);
  }
}

function statusClass(status) {
  const map = {
    'Creado': 'status-creado',
    'Activo': 'status-activo',
    'Iniciado': 'status-iniciado',
    'En Desarrollo': 'status-en-desarrollo',
    'Entregado': 'status-entregado',
    'Cancelado': 'status-cancelado'
  };
  return map[status] || 'status-creado';
}

function progressColor(percentage) {
  if (percentage >= 100) return '#2F7D5A';
  if (percentage >= 50) return '#56624A';
  if (percentage > 0) return '#C9922E';
  return 'var(--surface-4)';
}

// ----------------------------------------------------- PLANTILLAS DE TAREAS

/** Búsqueda por nombre y universidad sobre las plantillas ya cargadas. */
const filteredTemplates = computed(() => {
  const term = templateSearch.value.trim().toLowerCase();
  const uni = templateUniversity.value;
  return templates.value.filter((template) => {
    if (uni && template.university !== uni) return false;
    return !term || template.name.toLowerCase().includes(term);
  });
});

/**
 * Plantilla que se ofrece por defecto en un proyecto sin tareas: la de su
 * universidad si existe, si no la general, y como último recurso la más usada.
 * El backend ya devuelve la lista ordenada por uso.
 */
const suggestedTemplate = computed(() => {
  if (tasks.value.length > 0 || templates.value.length === 0) return null;
  const university = String(project.value?.university || '').trim().toLowerCase();
  if (university) {
    const match = templates.value.find((t) => String(t.university || '').trim().toLowerCase() === university);
    if (match) return match;
  }
  return templates.value.find((t) => !t.university) || templates.value[0];
});

function openTemplates() {
  templateError.value = '';
  // Se entra filtrando por la universidad del proyecto: es lo que se busca
  // el 90% de las veces.
  const university = String(project.value?.university || '').trim();
  templateUniversity.value = templateUniversities.value.includes(university) ? university : '';
  newTemplate.university = university;
  showTemplates.value = true;
}

async function importTemplate(template) {
  isImporting.value = true;
  templateError.value = '';
  try {
    const response = await apiFetch(`/api/projects/${props.id}/tasks/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: template.id })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo importar la plantilla.');
    tasks.value = data.tasks || [];
    showTemplates.value = false;
    await fetchTemplates();
  } catch (err) {
    templateError.value = err.message;
    if (!showTemplates.value) alert(err.message);
  } finally {
    isImporting.value = false;
  }
}

async function saveCurrentAsTemplate() {
  isSavingTemplate.value = true;
  templateError.value = '';
  try {
    const response = await apiFetch('/api/task-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: props.id,
        name: newTemplate.name,
        university: newTemplate.university || null,
        academicLevel: project.value?.academic_level || null
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la plantilla.');
    newTemplate.name = '';
    await fetchTemplates();
  } catch (err) {
    templateError.value = err.message;
  } finally {
    isSavingTemplate.value = false;
  }
}

async function deleteTemplate(template) {
  if (!window.confirm(`¿Eliminar la plantilla "${template.name}"? Los proyectos que ya la usaron no se tocan.`)) return;
  templateError.value = '';
  try {
    const response = await apiFetch(`/api/task-templates/${template.id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo eliminar la plantilla.');
    await fetchTemplates();
  } catch (err) {
    templateError.value = err.message;
  }
}

onMounted(() => {
  loadAll();
});
</script>

<style scoped>
.project-detail-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  width: 100%;
  box-sizing: border-box;
}

/* ------------------------------------------------- Plantillas de tareas */
.template-suggestion {
  display: flex;
  gap: 1.25rem;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 1.1rem 1.4rem;
  margin-bottom: 1.5rem;
  border: 1px dashed var(--border-strong);
  border-radius: 14px;
  background: var(--surface-1);
}

.template-suggestion-main h4,
.template-card-main h4 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.92rem;
  color: var(--text-main);
  margin-bottom: 0.3rem;
}

.template-suggestion-hint,
.template-card-meta {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.template-chip {
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  background: var(--surface-3);
  border: 1px solid var(--border-color);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--text-sub);
}

.template-preview {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.template-preview li {
  font-size: 0.8rem;
  color: var(--text-sub);
  padding-left: 0.9rem;
  position: relative;
}

.template-preview li::before {
  content: '·';
  position: absolute;
  left: 0.2rem;
  color: var(--text-muted);
}

.template-preview li.is-more {
  color: var(--text-muted);
  font-style: italic;
}

.template-suggestion-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-self: center;
}

.template-filters {
  display: grid;
  grid-template-columns: 1fr minmax(0, 220px);
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 340px;
  overflow-y: auto;
}

.template-card {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--surface-1);
}

.template-card-actions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: stretch;
}

.template-delete-btn {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.3rem 0.5rem;
  cursor: pointer;
  font-size: 0.8rem;
}

.template-delete-btn:hover {
  border-color: var(--accent-rose);
}

.template-empty {
  font-size: 0.85rem;
  color: var(--text-muted);
  padding: 1rem 0;
}

.template-save {
  margin-top: 1.25rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--border-color);
}

.template-save h4 {
  font-size: 0.9rem;
  color: var(--text-main);
  margin-bottom: 0.3rem;
}

.template-save-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 0.6rem;
}

.template-save-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

@media (max-width: 640px) {
  .template-filters,
  .template-save-fields {
    grid-template-columns: 1fr;
  }
}

.status-pill {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 600;
}

.status-creado { background: rgba(191, 194, 199, 0.18); color: var(--text-muted); border: 1px solid rgba(191, 194, 199, 0.4); }
.status-activo { background: rgba(46, 125, 70, 0.15); color: #5FBE79; border: 1px solid rgba(46, 125, 70, 0.35); }

/* Aviso de proyecto en espera del visto bueno de Finanzas. */
.locked-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  border: 1px solid rgba(222, 117, 75, 0.45);
  border-left: 4px solid var(--accent-amber);
  border-radius: var(--radius-md);
  background: rgba(222, 117, 75, 0.07);
}

.locked-banner-text { flex: 1 1 340px; }

.locked-banner h4 {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
  color: var(--accent-amber);
}

.locked-banner p {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--text-sub);
}

.locked-upload-btn {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent-amber);
  color: var(--accent-amber);
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.locked-upload-btn:hover { background: var(--accent-amber); color: #fff; }
.status-iniciado { background: rgba(201, 146, 46, 0.15); color: var(--accent-amber); border: 1px solid rgba(201, 146, 46, 0.35); }
.status-en-desarrollo { background: rgba(111, 129, 37, 0.15); color: var(--on-tint-strong); border: 1px solid rgba(111, 129, 37, 0.35); }
.status-entregado { background: rgba(191, 194, 199, 0.15); color: var(--accent-silver); border: 1px solid rgba(191, 194, 199, 0.35); }
.status-cancelado { background: rgba(200, 85, 50, 0.15); color: var(--accent-rose); border: 1px solid rgba(200, 85, 50, 0.35); }

.tab-bar {
  display: flex;
  gap: 0.5rem;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 1.5rem;
}

.tab-button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-family: var(--font-heading);
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.7rem 0.25rem;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.tab-button:hover {
  color: var(--text-sub);
}

.tab-button.active {
  color: var(--text-main);
  border-bottom-color: var(--primary);
}

.task-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 1rem;
}

@media (max-width: 760px) {
  .task-board {
    grid-template-columns: 1fr;
  }
}

.task-column {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  min-height: 320px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.task-column.is-drag-over {
  border-color: var(--primary);
  background: rgba(85, 96, 176, 0.08);
}

.task-column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.9rem 1rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-color);
}

.kanban-count {
  background: var(--surface-2);
  border-radius: 9999px;
  padding: 0.1rem 0.55rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.task-column-body {
  flex: 1;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.task-card {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 0.6rem 0.75rem;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* El selector de entregable baja a su propia línea: la tarjeta sigue
     leyéndose como "tarea + borrar" y el entregable queda debajo, como el dato
     de contexto que es. */
  flex-wrap: wrap;
  gap: 0.5rem;
  transition: border-color 0.15s ease;
}

/* ---------------------------------------- Entregables dentro del proyecto */

.deliverables-panel { padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }

.deliverables-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.9rem;
  margin-bottom: 0.9rem;
}

.deliverables-title { font-size: 0.95rem; color: var(--accent-cyan); }
.deliverables-head-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.deliverable-btn { padding: 0.35rem 0.8rem; font-size: 0.8rem; white-space: nowrap; }

.deliverable-form {
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  align-items: end;
  gap: 0.6rem;
  padding: 0.9rem;
  margin-bottom: 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
}

.deliverable-submit { width: auto; padding: 0 1.2rem; border-radius: 10px; }
.deliverable-error { grid-column: 1 / -1; margin: 0; font-size: 0.8rem; color: var(--accent-rose); }
.deliverable-hint { grid-column: 1 / -1; margin: 0; font-size: 0.78rem; color: var(--text-muted); }

.deliverables-empty { font-size: 0.85rem; color: var(--text-muted); margin: 0; }

.deliverable-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.6rem;
}

.deliverable-card {
  display: flex;
  align-items: flex-start;
  gap: 0.3rem;
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface-1);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.deliverable-card:hover { background: var(--surface-2); }

/* El entregable que está filtrando el tablero se marca: si no, el tablero
   muestra "menos tareas" sin que se vea por qué. */
.deliverable-card.is-active {
  border-color: var(--primary);
  border-left-color: var(--primary);
  background: var(--surface-2);
}

.deliverable-card-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.7rem 0.3rem 0.7rem 0.8rem;
  background: none;
  border: none;
  text-align: left;
  font-family: var(--font-body);
  cursor: pointer;
}

.deliverable-card-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-main);
  overflow-wrap: anywhere;
}

.deliverable-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.74rem;
  color: var(--text-muted);
}

.deliverable-tag {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  white-space: nowrap;
}

.deliverable-tag.is-ok { color: var(--accent-emerald); border-color: rgba(46, 125, 70, 0.4); }
.deliverable-tag.is-bad { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.4); }

.deliverable-card-tasks { font-size: 0.76rem; color: var(--text-sub); }

.deliverable-bar {
  display: block;
  height: 4px;
  border-radius: 999px;
  background: var(--surface-4);
  overflow: hidden;
}

.deliverable-bar-fill { display: block; height: 100%; background: var(--primary); }

.deliverable-remove {
  flex: 0 0 auto;
  padding: 0.7rem 0.6rem;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.deliverable-remove:hover:not(:disabled) { color: var(--accent-rose); }
.deliverable-remove:disabled { opacity: 0.4; cursor: not-allowed; }

.deliverable-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.9rem; }

.deliverable-filter {
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-sub);
  font-family: var(--font-body);
  font-size: 0.78rem;
  cursor: pointer;
}

.deliverable-filter.is-on { border-color: var(--primary); color: var(--primary); background: rgba(111, 129, 37, 0.08); }

.add-task-form { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.add-task-form .form-input { flex: 1 1 240px; }
.add-task-deliverable { flex: 0 1 220px; border-radius: 10px; }

/* El entregable de la tarea, dentro de su tarjeta del tablero. */
.task-deliverable-select {
  flex: 1 1 100%;
  padding: 0.2rem 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-sub);
  font-family: var(--font-body);
  font-size: 0.72rem;
  cursor: pointer;
}

.task-deliverable-select.is-loose { color: var(--text-muted); border-style: dashed; }

@media (max-width: 820px) {
  .deliverable-form { grid-template-columns: 1fr; }
  .deliverable-submit { width: 100%; }
}

.task-card:hover {
  border-color: var(--surface-5);
}

.task-checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.83rem;
  color: var(--text-sub);
  cursor: pointer;
}

.task-checkbox-row input {
  accent-color: var(--primary);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

.task-delete-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.2rem 0.35rem;
  border-radius: 6px;
  flex-shrink: 0;
}

.task-delete-btn:hover {
  color: var(--accent-rose);
  background: rgba(200, 85, 50, 0.12);
}

.kanban-empty {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 1rem 0.5rem;
  border: 1px dashed var(--border-color);
  border-radius: 10px;
}

/* Equipo y Plazo */
.team-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
}

@media (max-width: 640px) {
  .team-grid {
    grid-template-columns: 1fr;
  }
}

.collaborator-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(111, 129, 37, 0.12);
  border: 1px solid rgba(111, 129, 37, 0.3);
  color: var(--text-sub);
  border-radius: 9999px;
  padding: 0.3rem 0.5rem 0.3rem 0.85rem;
  font-size: 0.8rem;
}

.collaborator-chip button {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.1rem 0.3rem;
  border-radius: 50%;
}

.collaborator-chip button:hover {
  color: var(--accent-rose);
  background: rgba(200, 85, 50, 0.15);
}

/* Línea de Tiempo */
.update-file-input {
  font-size: 0.8rem;
  color: var(--text-muted);
  max-width: 260px;
}

/* Condición de liberación del entregable: el adjunto se sube igual, pero el
   cliente no lo descarga hasta que Finanzas verifique la cuota elegida. */
.update-gate {
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border-color);
}

.update-gate-hint {
  margin: 0.4rem 0 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--text-muted);
}

.update-gate-state {
  margin: 0.55rem 0 0;
  font-size: 0.73rem;
  line-height: 1.45;
  color: var(--accent-amber, var(--text-muted));
}

.update-gate-state.is-open { color: var(--accent-emerald); }

.timeline-list {
  position: relative;
  padding-left: 1.75rem;
}

.timeline-list::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--border-color);
}

.timeline-item {
  position: relative;
  margin-bottom: 1.25rem;
}

.timeline-dot {
  position: absolute;
  left: -1.75rem;
  top: 0.3rem;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 0 4px rgba(111, 129, 37, 0.18);
}

.timeline-content {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 1rem 1.25rem;
}
</style>
