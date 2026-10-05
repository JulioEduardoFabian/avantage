<template>
  <main class="container-fluid projects-page">
    <header class="pv-header">
      <div class="pv-header-text">
        <h2 class="section-heading"><span>🚀</span> Proyectos</h2>
        <p class="section-subheading pv-subtitle">
          Se generan automáticamente cuando un lead llega al estado "Ganado" en el
          <router-link to="/admin/leads">Funnel de Ventas</router-link>.
        </p>
      </div>
      <div class="pv-header-actions">
        <button class="btn-primary pv-btn" @click="openCreateModal">+ Nuevo Proyecto</button>
        <button class="btn-secondary pv-btn" :disabled="isLoading" @click="fetchProjects">
          {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
        </button>
      </div>
    </header>

    <div v-if="loadError" class="info-box pv-alert">
      <h4>⚠️ No se pudo cargar los proyectos</h4>
      <p>{{ loadError }}</p>
    </div>

    <!-- Correo de avisos. Va plegado: se configura una vez y después estorba.
         El encabezado muestra la dirección guardada para comprobarla de un
         vistazo sin abrir nada. Mismo patrón que en Entregables. -->
    <section class="pv-config">
      <button
        type="button"
        class="pv-config-toggle"
        :class="{ 'is-open': showSettings }"
        :aria-expanded="showSettings"
        @click="showSettings = !showSettings"
      >
        <span>✉️ Aviso de proyecto nuevo</span>
        <span class="pv-config-current">{{ settings.noticeEmail || 'sin configurar' }}</span>
        <span class="pv-config-caret">{{ showSettings ? '▲' : '▼' }}</span>
      </button>

      <div v-if="showSettings" class="pv-config-body">
        <p class="pv-config-intro">
          Un proyecto nace casi siempre solo, cuando una venta se cierra en el Funnel de Ventas.
          Cada vez que eso pase llega un correo a esta dirección con el cliente, el tema y si el
          proyecto queda bloqueado esperando la verificación del primer pago.
          Es <strong>una sola</strong> dirección.
        </p>

        <div class="pv-config-field">
          <label class="form-label" for="pv-notice-email">¿A qué correo mandamos los avisos?</label>
          <input
            id="pv-notice-email"
            v-model="settingsForm.noticeEmail"
            type="email"
            class="form-input"
            placeholder="nombre@empresa.com"
            autocomplete="email"
          />
          <p class="form-hint">
            Si lo dejas vacío, los avisos van al correo interno configurado en el servidor.
          </p>
        </div>

        <div class="pv-config-actions">
          <button
            type="button"
            class="btn-primary pv-btn"
            :disabled="settingsSaving || !settingsDirty"
            @click="saveSettings"
          >{{ settingsSaving ? 'Guardando…' : 'Guardar correo' }}</button>

          <!-- Probar ANTES de guardar es a propósito: si la dirección estaba mal
               escrita, lo último que se quiere es haberla dejado guardada. -->
          <button
            type="button"
            class="btn-secondary pv-btn"
            :disabled="settingsTesting"
            @click="sendTestEmail"
          >{{ settingsTesting ? 'Enviando…' : '📨 Enviar correo de prueba' }}</button>
        </div>

        <p v-if="settingsMessage" class="pv-config-ok">✅ {{ settingsMessage }}</p>
        <p v-if="settingsError" class="pv-config-error">⚠️ {{ settingsError }}</p>
      </div>
    </section>

    <!-- Buscador y filtro por estado. Los contadores cuentan SIEMPRE todo, no lo
         filtrado: si contaran lo visible, filtrar por "Activo" dejaría todos los
         demás en cero y el resumen dejaría de servir como resumen. -->
    <section class="pv-toolbar">
      <label class="pv-search-wrap">
        <span class="pv-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="pv-search"
          placeholder="Buscar por tema, cliente, correo o carrera…"
        />
        <button v-if="search" type="button" class="pv-search-clear" title="Borrar la búsqueda" @click="search = ''">✕</button>
      </label>

      <div class="pv-status-filters">
        <button
          type="button"
          class="pv-status-chip"
          :class="{ 'is-on': statusFilter === 'all' }"
          @click="statusFilter = 'all'"
        >
          Todos <span class="pv-chip-count">{{ projects.length }}</span>
        </button>
        <button
          v-for="s in STATUSES"
          :key="s"
          type="button"
          class="pv-status-chip"
          :class="{ 'is-on': statusFilter === s, 'is-empty': !countByStatus[s] }"
          @click="statusFilter = statusFilter === s ? 'all' : s"
        >
          <span :class="['status-pill', statusClass(s)]">{{ s }}</span>
          <span class="pv-chip-count">{{ countByStatus[s] || 0 }}</span>
        </button>
      </div>
    </section>

    <div class="glass-panel pv-panel">
      <!-- La tabla se convierte en tarjetas apiladas por debajo de 1000 px (ver
           los estilos): cada celda lleva su rótulo en `data-label`, así que en
           el celular se lee "Cliente: …" en vez de una columna sin cabecera. -->
      <table v-if="visibleProjects.length > 0" class="projects-table">
        <thead>
          <tr>
            <th>Proyecto</th>
            <th>Cliente</th>
            <th>Nivel / Carrera</th>
            <th>Equipo</th>
            <th>Estado</th>
            <th>Avance</th>
            <th>Fecha límite</th>
            <th><span class="pv-sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in visibleProjects" :key="project.id" :class="{ 'is-locked': project.is_locked }">
            <td class="topic-cell" data-label="Proyecto">
              <router-link :to="`/admin/projects/${project.id}`" class="pv-topic-link">
                {{ project.topic }}
              </router-link>
              <div class="pv-created">Creado el {{ formatDate(project.created_at) }}</div>
              <!-- Bloqueado hasta que Finanzas verifique el primer pago -->
              <div v-if="project.is_locked" class="locked-note" :title="lockedTitle(project)">
                🔒 Esperando la verificación del primer pago
              </div>
            </td>

            <td data-label="Cliente">
              <div class="pv-client-name">{{ project.client_name || project.client_email || '—' }}</div>
              <div v-if="project.client_name && project.client_email" class="pv-sub">✉️ {{ project.client_email }}</div>
              <div v-if="project.client_phone" class="pv-sub">📱 {{ project.client_phone }}</div>
            </td>

            <td data-label="Nivel / Carrera">
              <div>{{ project.academic_level }}</div>
              <div class="pv-sub">{{ project.field_of_study }}</div>
            </td>

            <!-- Equipo: el líder primero y con anillo, los colaboradores
                 después. Sin esto había que entrar a cada proyecto para saber
                 de quién era. -->
            <td data-label="Equipo">
              <div v-if="teamOf(project).length > 0" class="pv-avatars">
                <span
                  v-for="member in teamOf(project).slice(0, 4)"
                  :key="member.id"
                  class="pv-avatar"
                  :class="{ 'is-leader': member.isLeader }"
                  :style="{ background: avatarColor(member.name) }"
                  :title="member.isLeader ? `${member.name} · líder del proyecto` : member.name"
                >
                  <!-- Hoy los usuarios no tienen foto; cuando la tengan, basta
                       con que venga `avatar_url` y esta imagen la usa. -->
                  <img v-if="member.avatar_url" :src="member.avatar_url" :alt="member.name" />
                  <template v-else>{{ initials(member.name) }}</template>
                  <span v-if="member.isLeader" class="pv-avatar-crown" aria-hidden="true">★</span>
                </span>
                <span
                  v-if="teamOf(project).length > 4"
                  class="pv-avatar is-more"
                  :title="teamOf(project).slice(4).map((m) => m.name).join(', ')"
                >+{{ teamOf(project).length - 4 }}</span>
              </div>
              <span v-else class="pv-unassigned" title="Este proyecto no tiene líder ni colaboradores">
                <span class="pv-avatar is-empty">?</span> Sin asignar
              </span>
            </td>

            <td data-label="Estado">
              <select
                v-if="!project.is_locked"
                :value="project.status"
                class="form-select status-select"
                @change="updateStatus(project, $event.target.value)"
              >
                <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
              </select>
              <span v-else class="status-pill status-creado" :title="lockedTitle(project)">
                🔒 {{ project.status }}
              </span>
            </td>

            <td class="pv-progress-cell" data-label="Avance">
              <div class="metric-bar-bg pv-bar">
                <div
                  class="metric-bar-fill"
                  :style="{ width: (project.progress_percentage || 0) + '%', background: progressColor(project.progress_percentage) }"
                ></div>
              </div>
              <span class="pv-sub">
                {{ project.progress_percentage || 0 }}% · {{ project.completed_tasks || 0 }}/{{ project.total_tasks || 0 }} tareas
              </span>
            </td>

            <td class="pv-deadline" :class="{ 'is-overdue': isOverdue(project) }" data-label="Fecha límite">
              <template v-if="project.deadline">
                {{ formatDate(project.deadline) }}
                <span v-if="isOverdue(project)" title="El plazo ya pasó">⚠️ vencido</span>
              </template>
              <span v-else class="pv-sub">Sin fecha</span>
            </td>

            <td class="pv-actions" data-label="">
              <button class="btn-secondary row-edit-btn" title="Editar o eliminar el proyecto" @click="openEditModal(project)">
                ✏️ <span class="pv-action-label">Editar</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else-if="isLoading" class="pv-loading">Cargando proyectos…</p>

      <!-- Dos vacíos distintos: "no hay nada" y "no hay nada que coincida".
           Mostrar el mismo mensaje en los dos casos hace creer que se borraron
           los proyectos. -->
      <div v-else-if="projects.length > 0" class="pv-no-results">
        <p>Ningún proyecto coincide con lo que estás buscando.</p>
        <button class="btn-secondary pv-btn" @click="clearFilters">✕ Quitar filtros</button>
      </div>

      <div v-else class="projects-empty-card">
        <div class="empty-state-visual">
          <img src="/images/empty_projects_state.jpg" alt="Proyectos y Avances" class="empty-state-photo" />
        </div>
        <h4 class="projects-empty-title">Aún no hay proyectos registrados</h4>
        <p class="projects-empty-desc">
          Los proyectos se generan automáticamente cuando un prospecto llega al estado "Ganado" en el funnel comercial, o puedes crearlo manualmente.
        </p>
        <button class="btn-primary pv-btn" @click="openCreateModal">+ Registrar Primer Proyecto</button>
      </div>
    </div>

    <!-- Modal: Crear Proyecto Libremente -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content" style="max-width: 520px;">
        <div class="modal-header">
          <h3 style="font-family: var(--font-heading); font-size: 1.05rem; color: var(--text-main); margin: 0;">
            🚀 Nuevo Proyecto
          </h3>
          <button class="btn-secondary" style="padding: 0.3rem 0.75rem;" @click="showCreateModal = false">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1.25rem;">
            Crea un proyecto directamente, sin que provenga de un lead ganado en el funnel de ventas.
          </p>
          <form @submit.prevent="createProject">
            <div class="form-group">
              <label class="form-label">Proyecto / Tema</label>
              <input v-model="newProject.topic" type="text" class="form-input" placeholder="Ej: Sistema de gestión documental para MYPEs" required />
            </div>
            <div class="form-group">
              <label class="form-label">Correo del cliente</label>
              <input v-model="newProject.clientEmail" type="email" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Celular del cliente</label>
              <input v-model="newProject.clientPhone" type="text" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Nivel académico</label>
              <select v-model="newProject.academicLevel" class="form-select" required>
                <option v-for="level in ACADEMIC_LEVELS" :key="level" :value="level">{{ level }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Carrera / Campo de estudio</label>
              <select v-model="newProject.fieldOfStudy" class="form-select" required>
                <optgroup v-for="group in careerGroupsWith(newProject.fieldOfStudy)" :key="group.label" :label="group.label">
                  <option v-for="career in group.careers" :key="career" :value="career">{{ career }}</option>
                </optgroup>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha límite (opcional)</label>
              <input v-model="newProject.deadline" type="date" class="form-input" />
            </div>

            <div v-if="createError" style="color: var(--accent-rose); font-size: 0.82rem; margin-bottom: 1rem;">{{ createError }}</div>

            <button type="submit" class="btn-primary" :disabled="isCreating">
              {{ isCreating ? 'Creando...' : 'Crear Proyecto' }}
            </button>
          </form>
        </div>
      </div>
    </div>

    <!-- Modal: Editar / Eliminar Proyecto -->
    <div v-if="editing" class="modal-overlay" @click.self="closeEditModal">
      <div class="modal-content" style="max-width: 520px;">
        <div class="modal-header">
          <h3 style="font-family: var(--font-heading); font-size: 1.05rem; color: var(--text-main); margin: 0;">
            ✏️ Editar Proyecto
          </h3>
          <button class="btn-secondary" style="padding: 0.3rem 0.75rem;" @click="closeEditModal">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="saveProject">
            <div class="form-group">
              <label class="form-label">Proyecto / Tema</label>
              <input v-model="editing.topic" type="text" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Correo del cliente</label>
              <input v-model="editing.clientEmail" type="email" class="form-input" required />
              <p class="form-hint">
                Es la identidad del cliente en el portal: si lo cambias, se le manda la invitación al correo nuevo.
              </p>
            </div>
            <div class="form-group">
              <label class="form-label">Celular del cliente</label>
              <input v-model="editing.clientPhone" type="text" class="form-input" />
            </div>
            <div class="form-group">
              <label class="form-label">Nivel académico</label>
              <select v-model="editing.academicLevel" class="form-select">
                <option v-for="level in ACADEMIC_LEVELS" :key="level" :value="level">{{ level }}</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Carrera / Campo de estudio</label>
              <select v-model="editing.fieldOfStudy" class="form-select">
                <optgroup v-for="group in careerGroupsWith(editing.fieldOfStudy)" :key="group.label" :label="group.label">
                  <option v-for="career in group.careers" :key="career" :value="career">{{ career }}</option>
                </optgroup>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Fecha límite (opcional)</label>
              <input v-model="editing.deadline" type="date" class="form-input" />
            </div>

            <div v-if="editError" style="color: var(--accent-rose); font-size: 0.82rem; margin-bottom: 1rem;">{{ editError }}</div>

            <div style="display: flex; gap: 0.6rem;">
              <button type="submit" class="btn-primary" :disabled="isSaving || isDeleting">
                {{ isSaving ? 'Guardando...' : 'Guardar cambios' }}
              </button>
              <button type="button" class="btn-danger" :disabled="isSaving || isDeleting" @click="deleteProject">
                {{ isDeleting ? 'Eliminando...' : '🗑️ Eliminar' }}
              </button>
            </div>
            <p class="form-hint" style="margin-top: 0.75rem;">
              Eliminar borra también sus tareas, su equipo y su línea de tiempo. Los ingresos del cliente
              siguen registrados en Finanzas.
            </p>
          </form>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';
import { careerGroupsWith, DEFAULT_CAREER } from '../data/careers.js';
import { avatarColor, initials } from '../avatars.js';

const STATUSES = ['Creado', 'Activo', 'Iniciado', 'En Desarrollo', 'Entregado', 'Cancelado'];

const ACADEMIC_LEVELS = ['Pregrado (Bachiller/Título)', 'Posgrado (Maestría)', 'Posgrado (Doctorado)'];


const projects = ref([]);
const isLoading = ref(false);
const loadError = ref('');
const search = ref('');
const statusFilter = ref('all');

/**
 * Lo que la tabla muestra. Los contadores de arriba siguen contando TODO a
 * propósito: si contaran lo filtrado, elegir "Activo" dejaría los demás en cero
 * y el resumen dejaría de ser un resumen.
 */
const visibleProjects = computed(() => {
  const query = search.value.trim().toLowerCase();
  return projects.value.filter((project) => {
    if (statusFilter.value !== 'all' && project.status !== statusFilter.value) return false;
    if (!query) return true;
    return [
      project.topic, project.client_name, project.client_email, project.client_phone,
      project.field_of_study, project.academic_level, project.leader_name
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
});

function clearFilters() {
  search.value = '';
  statusFilter.value = 'all';
}

// ---------------------------------------------------- CORREO DE LOS AVISOS

/**
 * A qué correo llega el aviso de proyecto nuevo. Se guarda en
 * `project_settings` (fila única) y es UNO solo: repartirlo entre todos los que
 * pueden abrir el módulo lo vuelve ruido que nadie mira.
 */
const showSettings = ref(false);
const settings = ref({ noticeEmail: '' });
const settingsForm = reactive({ noticeEmail: '' });
const settingsSaving = ref(false);
const settingsTesting = ref(false);
const settingsMessage = ref('');
const settingsError = ref('');

/** Sin cambios no hay nada que guardar: el botón se apaga en vez de mentir. */
const settingsDirty = computed(
  () => settingsForm.noticeEmail.trim() !== (settings.value.noticeEmail || '').trim()
);

async function fetchSettings() {
  try {
    const response = await apiFetch('/api/project-settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo leer la configuración.');
    settings.value = data.settings || { noticeEmail: '' };
    settingsForm.noticeEmail = settings.value.noticeEmail || '';
  } catch (error) {
    settingsError.value = error.message;
  }
}

async function saveSettings() {
  settingsSaving.value = true;
  settingsMessage.value = '';
  settingsError.value = '';
  try {
    const response = await apiFetch('/api/project-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noticeEmail: settingsForm.noticeEmail })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el correo.');
    settings.value = data.settings;
    settingsForm.noticeEmail = data.settings.noticeEmail || '';
    settingsMessage.value = data.settings.noticeEmail
      ? `Listo: los avisos van a ${data.settings.noticeEmail}.`
      : 'Listo: sin correo propio, los avisos van al correo interno del servidor.';
  } catch (error) {
    settingsError.value = error.message;
  } finally {
    settingsSaving.value = false;
  }
}

/**
 * Manda el correo de ejemplo a lo que haya ESCRITO en el campo, no a lo
 * guardado: así se comprueba una dirección nueva antes de dejarla fija.
 */
async function sendTestEmail() {
  settingsTesting.value = true;
  settingsMessage.value = '';
  settingsError.value = '';
  try {
    const response = await apiFetch('/api/project-settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: settingsForm.noticeEmail })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo enviar el correo de prueba.');
    settingsMessage.value = `Correo de prueba enviado a ${data.recipient}. `
      + 'Si no llega en unos minutos, revisa la carpeta de spam.';
  } catch (error) {
    settingsError.value = error.message;
  } finally {
    settingsTesting.value = false;
  }
}

// ------------------------------------------------------------------- EQUIPO

/**
 * Quién trabaja el proyecto, en el orden en que se mira: el líder primero.
 *
 * Si además está como colaborador no se repite — en la tabla saldrían dos
 * círculos iguales y parecería que son dos personas.
 */
function teamOf(project) {
  const members = [];
  if (project.leader_id) {
    members.push({
      id: project.leader_id,
      name: project.leader_name || 'Sin nombre',
      avatar_url: project.leader_avatar_url || null,
      isLeader: true
    });
  }
  for (const collaborator of project.collaborators || []) {
    if (Number(collaborator.id) === Number(project.leader_id)) continue;
    members.push({ ...collaborator, isLeader: false });
  }
  return members;
}

/* Las iniciales y el color del círculo salen de `src/avatars.js`: los mismos
   que usan las tarjetas de los dos tableros de leads, para que una persona se
   vea igual en todo el panel. */

const showCreateModal = ref(false);
// Proyecto que se está editando en el modal (null = modal cerrado).
const editing = ref(null);
const editError = ref('');
const isSaving = ref(false);
const isDeleting = ref(false);
const isCreating = ref(false);
const createError = ref('');
const newProject = reactive({
  topic: '',
  clientEmail: '',
  clientPhone: '',
  academicLevel: 'Pregrado (Bachiller/Título)',
  fieldOfStudy: DEFAULT_CAREER,
  deadline: ''
});

const countByStatus = computed(() => {
  const counts = {};
  for (const project of projects.value) {
    counts[project.status] = (counts[project.status] || 0) + 1;
  }
  return counts;
});

async function fetchProjects() {
  isLoading.value = true;
  loadError.value = '';
  try {
    const response = await apiFetch('/api/projects');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener los proyectos.');
    projects.value = data.projects || [];
  } catch (err) {
    loadError.value = err.message;
  } finally {
    isLoading.value = false;
  }
}

async function updateStatus(project, newStatus) {
  const previousStatus = project.status;
  project.status = newStatus;
  try {
    const response = await apiFetch(`/api/projects/${project.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al actualizar el proyecto.');
    project.status = data.project.status;
  } catch (err) {
    project.status = previousStatus;
    alert('No se pudo actualizar el proyecto: ' + err.message);
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

function lockedTitle(project) {
  return `El proyecto se puede consultar pero no gestionar hasta que Finanzas verifique ` +
    `el primer pago (${project.initial_payment?.code || 'ingreso'}).`;
}

function progressColor(percentage) {
  if (percentage >= 100) return '#2F7D5A';
  if (percentage >= 50) return '#56624A';
  if (percentage > 0) return '#C9922E';
  return 'var(--surface-4)';
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isOverdue(project) {
  if (!project.deadline || ['Entregado', 'Cancelado'].includes(project.status)) return false;
  return new Date(project.deadline) < new Date(new Date().toDateString());
}

function openCreateModal() {
  createError.value = '';
  newProject.topic = '';
  newProject.clientEmail = '';
  newProject.clientPhone = '';
  newProject.academicLevel = 'Pregrado (Bachiller/Título)';
  newProject.fieldOfStudy = DEFAULT_CAREER;
  newProject.deadline = '';
  showCreateModal.value = true;
}

async function createProject() {
  isCreating.value = true;
  createError.value = '';
  try {
    const response = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newProject, deadline: newProject.deadline || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al crear el proyecto.');
    projects.value.unshift(data.project);
    showCreateModal.value = false;
  } catch (err) {
    createError.value = err.message;
  } finally {
    isCreating.value = false;
  }
}

/** Abre el modal con una copia editable: cancelar no debe tocar la tabla. */
function openEditModal(project) {
  editError.value = '';
  editing.value = {
    id: project.id,
    topic: project.topic || '',
    clientEmail: project.client_email || '',
    clientPhone: project.client_phone || '',
    academicLevel: project.academic_level || ACADEMIC_LEVELS[0],
    fieldOfStudy: project.field_of_study || DEFAULT_CAREER,
    deadline: project.deadline ? String(project.deadline).slice(0, 10) : ''
  };
}

function closeEditModal() {
  editing.value = null;
}

async function saveProject() {
  isSaving.value = true;
  editError.value = '';
  try {
    const response = await apiFetch(`/api/projects/${editing.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editing.value, deadline: editing.value.deadline || null })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al guardar el proyecto.');

    const index = projects.value.findIndex((p) => p.id === data.project.id);
    if (index !== -1) projects.value[index] = { ...projects.value[index], ...data.project };
    closeEditModal();
  } catch (err) {
    editError.value = err.message;
  } finally {
    isSaving.value = false;
  }
}

async function deleteProject() {
  const confirmed = window.confirm(
    `¿Eliminar el proyecto "${editing.value.topic}"?

` +
    'Se borran sus tareas, su equipo y su línea de tiempo (incluidos los adjuntos). ' +
    'Los ingresos del cliente siguen en Finanzas. Esta acción no se puede deshacer.'
  );
  if (!confirmed) return;

  isDeleting.value = true;
  editError.value = '';
  try {
    const response = await apiFetch(`/api/projects/${editing.value.id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al eliminar el proyecto.');

    projects.value = projects.value.filter((p) => p.id !== editing.value.id);
    closeEditModal();
  } catch (err) {
    editError.value = err.message;
  } finally {
    isDeleting.value = false;
  }
}

onMounted(() => {
  fetchProjects();
  // La configuración se lee aunque el panel esté plegado: el encabezado muestra
  // la dirección guardada, y ahí es donde se comprueba de un vistazo.
  fetchSettings();
});
</script>

<style scoped>
.projects-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  width: 100%;
  box-sizing: border-box;
}

.pv-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* --- Correo de los avisos ------------------------------------------------ */

.pv-config {
  margin-bottom: 1.25rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: hidden;
}

.pv-config-toggle {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.6rem 1rem;
  border: none;
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.pv-config-toggle:hover { background: var(--bg-card-hover); }
.pv-config-toggle.is-open { border-bottom: 1px solid var(--border-color); }

/* La dirección guardada se lee sin abrir el panel: es la comprobación que se
   hace más seguido ("¿a dónde está yendo esto?"). */
.pv-config-current {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 500;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.pv-config-caret { flex: 0 0 auto; color: var(--text-muted); font-size: 0.75rem; }

.pv-config-body { padding: 1rem; }

.pv-config-intro {
  font-size: 0.82rem;
  line-height: 1.55;
  color: var(--text-sub);
  margin: 0 0 1rem;
  max-width: 70ch;
}

.pv-config-field { margin-bottom: 0.9rem; max-width: 420px; }
.pv-config-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; }

.pv-config-ok,
.pv-config-error {
  margin: 0.85rem 0 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  line-height: 1.5;
}

.pv-config-ok { color: var(--accent-emerald); background: rgba(46, 125, 70, 0.08); }
.pv-config-error { color: var(--accent-rose); background: rgba(200, 85, 50, 0.08); }

/* --- Encabezado y barra de herramientas --------------------------------- */

.pv-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.pv-header-text { flex: 1 1 320px; }
.pv-subtitle { margin-bottom: 0; }
.pv-subtitle a { color: var(--accent-cyan); }
.pv-header-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.pv-btn { width: auto; padding: 0 1.25rem; white-space: nowrap; }

.pv-alert { border-color: rgba(200, 85, 50, 0.4); margin-bottom: 1.25rem; }
.pv-alert h4 { color: var(--accent-rose); }

.pv-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-bottom: 1.25rem;
}

.pv-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 260px;
  min-width: 0;
}

.pv-search-icon { position: absolute; left: 0.75rem; font-size: 0.9rem; pointer-events: none; }

.pv-search {
  width: 100%;
  padding: 0.55rem 2.4rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.85rem;
}

.pv-search:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--border-glow); }

.pv-search-clear {
  position: absolute;
  right: 0.45rem;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-sub);
  font-size: 0.75rem;
  cursor: pointer;
}

.pv-status-filters { display: flex; flex-wrap: wrap; gap: 0.45rem; }

/* Los contadores de estado ahora filtran. Antes solo informaban y la tabla
   había que recorrerla a ojo para encontrar los de un estado. */
.pv-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.7rem;
  border-radius: 9999px;
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  font-family: var(--font-body);
  font-size: 0.8rem;
  color: var(--text-sub);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.pv-status-chip:hover { border-color: var(--border-strong); }
.pv-status-chip.is-on { border-color: var(--primary); background: rgba(111, 129, 37, 0.1); }
.pv-status-chip.is-empty { opacity: 0.55; }
.pv-chip-count { font-weight: 700; color: var(--text-main); }

.pv-panel { padding: 1.25rem; overflow-x: auto; }

/* --- Tabla --------------------------------------------------------------- */

.projects-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.projects-table th {
  text-align: left;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  /* La cabecera se queda a la vista al desplazar una lista larga: sin esto, a
     partir de la fila diez ya no se sabe qué columna es cuál. */
  position: sticky;
  top: 0;
  background: var(--bg-card);
  z-index: 1;
}

.projects-table td {
  padding: 0.8rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-sub);
  vertical-align: middle;
}

.projects-table tbody tr { transition: background 0.15s ease; }
.projects-table tbody tr:hover { background: var(--surface-1); }
.projects-table tbody tr:last-child td { border-bottom: none; }

/* Una franja al borde dice de un vistazo cuáles están esperando el pago. */
.projects-table tbody tr.is-locked td:first-child { box-shadow: inset 3px 0 0 var(--accent-amber); }

.topic-cell { max-width: 320px; }

.pv-topic-link {
  color: var(--text-main);
  text-decoration: none;
  font-weight: 600;
  line-height: 1.35;
}

.pv-topic-link:hover { color: var(--accent-cyan); text-decoration: underline; }

.pv-created { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem; }
.pv-client-name { color: var(--text-main); font-weight: 600; }
.pv-sub { color: var(--text-muted); font-size: 0.76rem; }

.pv-progress-cell { min-width: 150px; }
.pv-bar { margin-bottom: 0.3rem; }

.pv-deadline { white-space: nowrap; font-size: 0.8rem; color: var(--text-muted); }
.pv-deadline.is-overdue { color: var(--accent-rose); font-weight: 600; }

.pv-actions { text-align: right; }
.pv-action-label { display: none; }

.row-edit-btn {
  padding: 0.3rem 0.6rem;
  font-size: 0.85rem;
  line-height: 1;
}

/* --- Equipo: círculos ---------------------------------------------------- */

/* Los círculos se superponen un poco: así cuatro personas ocupan lo que
   ocuparían dos y la columna no empuja al resto de la tabla. */
.pv-avatars { display: flex; align-items: center; }
.pv-avatars > * + * { margin-left: -0.5rem; }

.pv-avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 2px solid var(--bg-card);
  background: var(--surface-4);
  color: #FFFFFF;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  overflow: visible;
  cursor: default;
}

.pv-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

/* El líder se distingue sin leer nada: anillo propio y una estrella. */
.pv-avatar.is-leader { box-shadow: 0 0 0 2px var(--primary); z-index: 2; }

.pv-avatar-crown {
  position: absolute;
  top: -6px;
  right: -4px;
  font-size: 0.6rem;
  color: var(--primary);
  text-shadow: 0 0 2px var(--bg-card), 0 0 2px var(--bg-card);
}

.pv-avatar.is-more {
  background: var(--surface-3);
  color: var(--text-sub);
  font-size: 0.7rem;
}

.pv-avatar.is-empty {
  background: transparent;
  border: 2px dashed var(--border-strong);
  color: var(--text-muted);
}

.pv-unassigned {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* --- Vacíos y carga ------------------------------------------------------ */

.pv-loading { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

.pv-no-results {
  padding: 2.5rem 1.25rem;
  text-align: center;
  color: var(--text-sub);
  font-size: 0.9rem;
}

.pv-no-results p { margin: 0 0 1rem; }

.btn-danger {
  background: rgba(200, 85, 50, 0.12);
  border: 1px solid rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
  border-radius: 10px;
  padding: 0.6rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-danger:hover:not(:disabled) { background: rgba(200, 85, 50, 0.2); }
.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

.form-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 0.35rem;
}

/* --- Pantallas chicas: la tabla pasa a tarjetas -------------------------- */

/*
 * Por debajo de 1000 px una tabla de ocho columnas solo se puede usar
 * arrastrándola de lado, y lo primero que se sale de la pantalla es el estado y
 * las acciones. Cada fila pasa a ser una tarjeta y cada celda lleva su rótulo
 * (el `data-label` del template), que es lo que la cabecera ya no puede decir.
 */
@media (max-width: 1000px) {
  .pv-panel { overflow-x: visible; padding: 0.75rem; }

  .projects-table,
  .projects-table tbody,
  .projects-table tr,
  .projects-table td { display: block; width: 100%; }

  .projects-table thead { display: none; }

  .projects-table tbody tr {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    padding: 0.85rem 1rem;
    margin-bottom: 0.75rem;
  }

  .projects-table tbody tr.is-locked { border-left: 4px solid var(--accent-amber); }
  .projects-table tbody tr.is-locked td:first-child { box-shadow: none; }

  .projects-table td {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.4rem 0;
    border-bottom: none;
    text-align: right;
  }

  .projects-table td::before {
    content: attr(data-label);
    flex: 0 0 auto;
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    font-weight: 600;
  }

  /* El tema del proyecto es el título de la tarjeta: ocupa la línea entera. */
  .projects-table td.topic-cell {
    display: block;
    text-align: left;
    padding-bottom: 0.6rem;
    margin-bottom: 0.4rem;
    border-bottom: 1px solid var(--border-color);
  }

  .projects-table td.topic-cell::before { content: none; }
  .topic-cell { max-width: none; }
  .pv-topic-link { font-size: 0.95rem; }

  .pv-avatars { justify-content: flex-end; }
  .pv-progress-cell .metric-bar-bg { min-width: 140px; }
  .pv-actions { justify-content: flex-end; padding-top: 0.6rem; }
  .pv-actions::before { content: none; }
  .pv-action-label { display: inline; }
  .row-edit-btn { padding: 0.45rem 0.9rem; }
  .status-select { max-width: 60%; }
}

@media (max-width: 560px) {
  .pv-config-toggle { flex-wrap: wrap; }
  .pv-config-current { flex: 1 1 100%; font-size: 0.8rem; }
  .pv-config-actions .pv-btn { width: 100%; }

  .pv-header-actions { width: 100%; }
  .pv-header-actions .pv-btn { flex: 1 1 auto; }
  .pv-search-wrap { flex: 1 1 100%; }
}

/* --- Estados, aviso de bloqueo y vacío (sin cambios) --------------------- */

.topic-cell { color: var(--text-main); font-weight: 500; }

.status-select {
  width: auto;
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
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
.status-iniciado { background: rgba(201, 146, 46, 0.15); color: var(--accent-amber); border: 1px solid rgba(201, 146, 46, 0.35); }
.status-en-desarrollo { background: rgba(111, 129, 37, 0.15); color: var(--on-tint-strong); border: 1px solid rgba(111, 129, 37, 0.35); }
.status-entregado { background: rgba(191, 194, 199, 0.15); color: var(--accent-silver); border: 1px solid rgba(191, 194, 199, 0.35); }
.status-cancelado { background: rgba(200, 85, 50, 0.15); color: var(--accent-rose); border: 1px solid rgba(200, 85, 50, 0.35); }

/* Aviso de proyecto a la espera del visto bueno de Finanzas. */
.locked-note {
  margin-top: 0.3rem;
  font-size: 0.7rem;
  line-height: 1.35;
  color: var(--accent-amber);
  cursor: help;
}

.projects-empty-card {
  padding: 2.5rem 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-state-visual {
  width: 170px;
  height: 125px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 1.25rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.empty-state-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.projects-empty-title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: 1.15rem;
  color: var(--text-main);
  margin-bottom: 0.4rem;
}

.projects-empty-desc {
  font-size: 0.88rem;
  color: var(--text-muted);
  max-width: 480px;
  line-height: 1.5;
  margin-bottom: 1.25rem;
}
</style>
