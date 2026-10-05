<template>
  <main class="container-fluid pf-page">
    <header class="page-header">
      <div class="page-header-titles">
        <span class="page-eyebrow">Configuración</span>
        <h2 class="section-heading"><span class="heading-icon">🔐</span> Perfiles</h2>
        <p class="section-subheading pf-subheading">
          El acceso a cada módulo del panel depende del rol. Cada rol desbloquea un conjunto de herramientas
          para las personas que lo tienen.
        </p>
      </div>
      <div class="page-header-actions">
        <button type="button" class="btn-primary pf-add-btn" @click="openUserModal">+ Nuevo usuario</button>
      </div>
    </header>

    <p v-if="loadError" class="info-box pf-alert">⚠️ {{ loadError }}</p>

    <!-- ===================== Roles y accesos ===================== -->
    <section class="pf-section">
      <div class="pf-section-head">
        <div>
          <h3 class="pf-section-title">Roles y accesos</h3>
          <p class="pf-section-note">{{ roles.length }} roles · {{ permissions.length }} herramientas en el sistema</p>
        </div>
        <div class="pf-section-actions">
          <button type="button" class="btn-secondary pf-mini-btn" @click="showToolsModal = true">🧩 Herramientas</button>
          <button type="button" class="btn-secondary pf-mini-btn" @click="openRoleModal">+ Nuevo rol</button>
        </div>
      </div>

      <div class="pf-role-grid">
        <article
          v-for="role in roles"
          :key="role.id"
          class="pf-role-card"
          :style="{ '--role-accent': hueOf(role.name) }"
        >
          <div class="pf-role-card-head">
            <span class="pf-role-dot"></span>
            <h4 class="pf-role-name" :title="role.name">{{ role.name }}</h4>
            <span class="pf-tool-chip">{{ role.permissions.length }} 🧩</span>
          </div>
          <p class="pf-role-desc">{{ role.description || 'Sin descripción' }}</p>

          <div class="pf-role-members">
            <div
              v-for="user in usersByRole(role.id).slice(0, 4)"
              :key="user.id"
              class="pf-member"
            >
              <span class="pf-avatar pf-avatar-sm" :style="{ background: hueOf(user.name) }">{{ initials(user.name) }}</span>
              <span class="pf-member-texts">
                <span class="pf-member-name">{{ user.name }}</span>
                <span class="pf-member-email data-mono">{{ user.email }}</span>
              </span>
            </div>
            <p v-if="usersByRole(role.id).length > 4" class="pf-member-more">
              +{{ usersByRole(role.id).length - 4 }} más
            </p>
            <p v-if="usersByRole(role.id).length === 0" class="pf-member-empty">Sin usuarios asignados</p>
          </div>

          <div class="pf-role-foot">
            <div class="pf-access-meter" :title="`${role.permissions.length} de ${permissions.length} módulos`">
              <div class="pf-access-bar">
                <div class="pf-access-fill" :style="{ width: pct(role.permissions.length) }"></div>
              </div>
              <span class="pf-access-label">{{ role.permissions.length }}/{{ permissions.length }} módulos</span>
            </div>
            <button type="button" class="pf-manage-btn" @click="openManageRole(role)">Gestionar</button>
          </div>
        </article>
      </div>
    </section>

    <!-- ===================== Cuentas ===================== -->
    <section class="pf-section">
      <div class="pf-section-head">
        <h3 class="pf-section-title">Cuentas <span class="pf-count-badge">{{ users.length }}</span></h3>
        <div class="pf-section-actions">
          <div class="pf-search">
            <span class="pf-search-icon">🔍</span>
            <input v-model="search" type="text" class="pf-search-input" placeholder="Buscar por nombre o correo" />
            <button v-if="search" type="button" class="pf-search-clear" @click="search = ''">✕</button>
          </div>
          <select v-model="sortBy" class="form-select pf-sort">
            <option value="name">Ordenar: nombre</option>
            <option value="recent">Ordenar: más reciente</option>
            <option value="role">Ordenar: rol</option>
          </select>
        </div>
      </div>

      <div class="tabs pf-tabs">
        <button
          type="button"
          class="tab-item"
          :class="{ 'is-active': roleFilter === 'all' }"
          @click="roleFilter = 'all'"
        >Todos ({{ users.length }})</button>
        <button
          v-for="role in roles"
          :key="role.id"
          type="button"
          class="tab-item"
          :class="{ 'is-active': roleFilter === role.id }"
          @click="roleFilter = role.id"
        >{{ role.name }} ({{ usersByRole(role.id).length }})</button>
      </div>

      <div v-if="visibleUsers.length === 0" class="empty-state pf-empty">
        <p class="empty-state-title">{{ search ? 'Sin coincidencias' : 'Aún no hay cuentas' }}</p>
        <p class="empty-state-text">
          {{ search ? 'Prueba con otro nombre o correo.' : 'Crea la primera cuenta con "+ Nuevo usuario".' }}
        </p>
      </div>

      <div v-else class="data-table-wrapper pf-table-wrapper">
        <table class="data-table pf-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Acceso</th>
              <th>Registrado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in visibleUsers" :key="user.id">
              <td>
                <div class="pf-cell-user">
                  <span class="pf-avatar" :style="{ background: hueOf(user.name) }">{{ initials(user.name) }}</span>
                  <span class="pf-cell-user-name">{{ user.name }}</span>
                </div>
              </td>
              <td class="data-mono pf-cell-email">{{ user.email }}</td>
              <td>
                <span class="pf-role-pill" :style="{ '--role-accent': hueOf(user.role_name) }">{{ user.role_name }}</span>
              </td>
              <td>
                <div class="pf-access-meter pf-access-meter-sm">
                  <div class="pf-access-bar">
                    <div class="pf-access-fill" :style="{ width: pct(accessCount(user)) }"></div>
                  </div>
                  <span class="pf-access-label">{{ accessCount(user) }}/{{ permissions.length }}</span>
                  <span
                    v-if="user.has_overrides"
                    class="pf-tool-chip"
                    title="Esta persona tiene permisos puestos o quitados aparte de su rol"
                  >🧩</span>
                </div>
              </td>
              <td class="data-mono pf-cell-date">{{ formatDate(user.created_at) }}</td>
              <td class="pf-cell-menu">
                <button
                  type="button"
                  class="pf-menu-trigger"
                  :aria-expanded="openMenuId === user.id"
                  @click.stop="toggleMenu(user.id)"
                >⋮</button>
                <div v-if="openMenuId === user.id" class="pf-menu" @click.stop>
                  <button type="button" class="pf-menu-item" @click="openUserPermissions(user)">
                    🧩 Permisos de esta persona
                  </button>
                  <span class="pf-menu-label">Cambiar rol</span>
                  <button
                    v-for="role in roles"
                    :key="role.id"
                    type="button"
                    class="pf-menu-item"
                    :class="{ 'is-current': role.id === user.role_id }"
                    @click="changeUserRole(user, role.id)"
                  >
                    <span class="pf-menu-dot" :style="{ background: hueOf(role.name) }"></span>
                    {{ role.name }}
                    <span v-if="role.id === user.role_id" class="pf-menu-check">✓</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ===================== Clientes del portal ===================== -->
    <section class="pf-section">
      <div class="pf-section-head">
        <div>
          <h3 class="pf-section-title">Clientes del portal <span class="pf-count-badge">{{ clientAccounts.length }}</span></h3>
          <p class="pf-section-note">Quién puede loguearse en /portal a ver su proyecto y subir comprobantes.</p>
        </div>
        <div class="pf-section-actions">
          <div class="pf-search">
            <span class="pf-search-icon">🔍</span>
            <input v-model="clientSearch" type="text" class="pf-search-input" placeholder="Buscar por nombre o correo" />
            <button v-if="clientSearch" type="button" class="pf-search-clear" @click="clientSearch = ''">✕</button>
          </div>
          <button type="button" class="btn-secondary pf-mini-btn" @click="openInviteClientModal">+ Invitar cliente</button>
        </div>
      </div>

      <p v-if="clientAccountsError" class="info-box pf-alert">⚠️ {{ clientAccountsError }}</p>

      <div v-else-if="visibleClientAccounts.length === 0" class="empty-state pf-empty">
        <p class="empty-state-title">{{ clientSearch ? 'Sin coincidencias' : 'Todavía no hay clientes invitados' }}</p>
        <p class="empty-state-text">
          {{ clientSearch ? 'Prueba con otro nombre o correo.' : 'Se invitan solos al crear su proyecto, o invita uno a mano con "+ Invitar cliente".' }}
        </p>
      </div>

      <div v-else class="data-table-wrapper pf-table-wrapper">
        <table class="data-table pf-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Proyectos</th>
              <th>Estado</th>
              <th>Última conexión</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in visibleClientAccounts" :key="account.id">
              <td>
                <div class="pf-cell-user">
                  <span class="pf-avatar" :style="{ background: hueOf(account.name || account.email) }">{{ initials(account.name || account.email) }}</span>
                  <span class="pf-cell-user-texts">
                    <span class="pf-cell-user-name">{{ account.name || 'Sin nombre' }}</span>
                    <span class="data-mono pf-cell-email">{{ account.email }}</span>
                  </span>
                </div>
              </td>
              <td>
                <span class="pf-tool-chip">{{ account.project_count }} 📁</span>
              </td>
              <td>
                <span class="pf-client-status" :class="clientStatusClass(account)">{{ clientStatusLabel(account) }}</span>
              </td>
              <td class="data-mono pf-cell-date">{{ account.last_login_at ? formatDate(account.last_login_at) : 'Nunca' }}</td>
              <td class="pf-cell-menu">
                <button
                  type="button"
                  class="pf-menu-trigger"
                  :aria-expanded="openClientMenuId === account.id"
                  @click.stop="toggleClientMenu(account.id)"
                >⋮</button>
                <div v-if="openClientMenuId === account.id" class="pf-menu" @click.stop>
                  <button
                    v-if="account.invite_pending"
                    type="button"
                    class="pf-menu-item"
                    :disabled="clientActionBusyId === account.id"
                    @click="resendInvite(account)"
                  >📧 Reenviar invitación</button>
                  <button
                    v-else
                    type="button"
                    class="pf-menu-item"
                    :disabled="clientActionBusyId === account.id"
                    @click="sendResetLink(account)"
                  >🔒 Mandar link de restablecer</button>
                  <button
                    type="button"
                    class="pf-menu-item pf-menu-item-danger"
                    :disabled="clientActionBusyId === account.id"
                    @click="removeClientAccount(account)"
                  >🗑️ Quitar acceso al portal</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="clientActionMessage" class="pf-client-action-msg" :class="{ 'is-error': clientActionIsError }">{{ clientActionMessage }}</p>
    </section>

    <!-- ===================== Modal: Invitar cliente ===================== -->
    <div v-if="showInviteClientModal" class="modal-overlay" @click.self="showInviteClientModal = false">
      <div class="modal-content pf-modal pf-modal-narrow">
        <div class="modal-header">
          <h3 class="pf-modal-title">+ Invitar cliente</h3>
          <button type="button" class="btn-secondary pf-close-btn" @click="showInviteClientModal = false">✕ Cerrar</button>
        </div>
        <form class="modal-body" @submit.prevent="createClientInvite">
          <p class="pf-modal-note">
            Le mandamos un correo con el link para que active su portal y ponga su propia contraseña.
            No hace falta si el correo ya tiene un proyecto — ahí se invita solo.
          </p>
          <div class="form-group">
            <label class="form-label">Correo del cliente</label>
            <input v-model="newClientInvite.email" type="email" class="form-input" required autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">Nombre (opcional)</label>
            <input v-model="newClientInvite.name" type="text" class="form-input" />
          </div>
          <p v-if="inviteClientError" class="pf-form-error">{{ inviteClientError }}</p>
          <div class="pf-modal-actions">
            <button type="button" class="btn-secondary" @click="showInviteClientModal = false">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="isSavingClientInvite">
              {{ isSavingClientInvite ? 'Invitando…' : 'Invitar' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ===================== Modal: Gestionar rol ===================== -->
    <div v-if="managingRole" class="modal-overlay" @click.self="managingRole = null">
      <div class="modal-content pf-modal">
        <div class="modal-header">
          <div class="pf-modal-title-group">
            <span class="pf-role-dot" :style="{ '--role-accent': hueOf(managingRole.name) }"></span>
            <div>
              <h3 class="pf-modal-title">{{ managingRole.name }}</h3>
              <p class="pf-modal-sub">{{ managingRole.description || 'Sin descripción' }}</p>
            </div>
          </div>
          <button type="button" class="btn-secondary pf-close-btn" @click="managingRole = null">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <p class="pf-modal-note">
            Marca las herramientas que este rol desbloquea. Los cambios se guardan al instante.
            <span v-if="roleSaved" class="pf-saved">✓ Guardado</span>
          </p>
          <div class="pf-tool-list">
            <label v-for="p in permissions" :key="p.id" class="pf-tool-row">
              <input
                type="checkbox"
                :checked="roleHasPermission(managingRole, p.id)"
                @change="togglePermission(managingRole, p, $event.target.checked)"
              />
              <span class="pf-tool-row-texts">
                <span class="pf-tool-row-label">{{ p.label }}</span>
                <span class="pf-tool-row-key data-mono">{{ p.key }}</span>
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ Modal: Permisos de UNA persona (excepciones) ============ -->
    <!--
      El rol sigue mandando: acá solo se anota en qué se aparta esta persona.
      Por eso cada fila tiene tres estados y no una casilla — "hereda" no es lo
      mismo que "se lo quité": si mañana cambia el rol, lo heredado cambia con
      él y la excepción no.
    -->
    <div v-if="permUser" class="modal-overlay" @click.self="closeUserPermissions">
      <div class="modal-content pf-modal">
        <div class="modal-header">
          <div class="pf-modal-title-group">
            <span class="pf-avatar" :style="{ background: hueOf(permUser.name) }">{{ initials(permUser.name) }}</span>
            <div>
              <h3 class="pf-modal-title">{{ permUser.name }}</h3>
              <p class="pf-modal-sub">Rol: {{ permUser.role }} · las excepciones pesan más que el rol</p>
            </div>
          </div>
          <button type="button" class="btn-secondary pf-close-btn" @click="closeUserPermissions">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <p class="pf-modal-note">
            "Hereda" deja la herramienta como la defina su rol. Los cambios se guardan al instante y
            la persona los ve al recargar su panel.
            <span v-if="permSaved" class="pf-saved">✓ Guardado</span>
          </p>
          <p v-if="permError" class="pf-form-error">{{ permError }}</p>
          <p v-if="permLoading" class="pf-modal-note">Cargando…</p>

          <div v-else class="pf-tool-list">
            <div v-for="p in permRows" :key="p.id" class="pf-tool-row pf-tool-row-static">
              <span class="pf-tool-row-texts">
                <span class="pf-tool-row-label">{{ p.label }}</span>
                <span class="pf-tool-row-key data-mono">{{ p.key }}</span>
              </span>
              <span class="pf-perm-choice">
                <button
                  type="button"
                  class="pf-perm-btn"
                  :class="{ 'is-on': p.override === null }"
                  @click="setUserPermission(p, null)"
                >Hereda{{ p.from_role ? ' (sí)' : ' (no)' }}</button>
                <button
                  type="button"
                  class="pf-perm-btn is-yes"
                  :class="{ 'is-on': p.override === true }"
                  @click="setUserPermission(p, true)"
                >Sí</button>
                <button
                  type="button"
                  class="pf-perm-btn is-no"
                  :class="{ 'is-on': p.override === false }"
                  @click="setUserPermission(p, false)"
                >No</button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== Modal: Herramientas del sistema ===================== -->
    <div v-if="showToolsModal" class="modal-overlay" @click.self="showToolsModal = false">
      <div class="modal-content pf-modal">
        <div class="modal-header">
          <h3 class="pf-modal-title">🧩 Herramientas del sistema</h3>
          <button type="button" class="btn-secondary pf-close-btn" @click="showToolsModal = false">✕ Cerrar</button>
        </div>
        <div class="modal-body">
          <p class="pf-modal-note">
            Cada herramienta es un módulo o función interna (ya existente o por construir) que luego se asigna por rol.
          </p>
          <div class="pf-tool-list">
            <div v-for="p in permissions" :key="p.id" class="pf-tool-row pf-tool-row-static">
              <span class="pf-tool-row-texts">
                <span class="pf-tool-row-label">{{ p.label }}</span>
                <span class="pf-tool-row-key data-mono">{{ p.key }}</span>
              </span>
              <span class="pf-tool-row-count">{{ rolesUsing(p.id) }} rol(es)</span>
            </div>
          </div>
          <form class="pf-inline-form" @submit.prevent="createPermission">
            <div class="form-group">
              <label class="form-label">Clave</label>
              <input v-model="newPermission.key" type="text" class="form-input" placeholder="reports.view" required />
            </div>
            <div class="form-group pf-inline-form-wide">
              <label class="form-label">Nombre</label>
              <input v-model="newPermission.label" type="text" class="form-input" placeholder="Reportes avanzados" required />
            </div>
            <button type="submit" class="btn-primary pf-inline-submit">Registrar</button>
          </form>
          <p v-if="toolError" class="pf-form-error">{{ toolError }}</p>
        </div>
      </div>
    </div>

    <!-- ===================== Modal: Nuevo rol ===================== -->
    <div v-if="showRoleModal" class="modal-overlay" @click.self="showRoleModal = false">
      <div class="modal-content pf-modal pf-modal-narrow">
        <div class="modal-header">
          <h3 class="pf-modal-title">+ Nuevo rol</h3>
          <button type="button" class="btn-secondary pf-close-btn" @click="showRoleModal = false">✕ Cerrar</button>
        </div>
        <form class="modal-body" @submit.prevent="createRole">
          <div class="form-group">
            <label class="form-label">Nombre del rol</label>
            <input v-model="newRole.name" type="text" class="form-input" placeholder="Ej: Soporte" required autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">Descripción (opcional)</label>
            <input v-model="newRole.description" type="text" class="form-input" placeholder="Ej: Atiende consultas de clientes" />
          </div>
          <p v-if="roleError" class="pf-form-error">{{ roleError }}</p>
          <div class="pf-modal-actions">
            <button type="button" class="btn-secondary" @click="showRoleModal = false">Cancelar</button>
            <button type="submit" class="btn-primary">Crear rol</button>
          </div>
        </form>
      </div>
    </div>

    <!-- ===================== Modal: Nuevo usuario ===================== -->
    <div v-if="showUserModal" class="modal-overlay" @click.self="showUserModal = false">
      <div class="modal-content pf-modal pf-modal-narrow">
        <div class="modal-header">
          <h3 class="pf-modal-title">+ Nuevo usuario</h3>
          <button type="button" class="btn-secondary pf-close-btn" @click="showUserModal = false">✕ Cerrar</button>
        </div>
        <form class="modal-body" @submit.prevent="createUser">
          <div class="form-group">
            <label class="form-label">Nombre</label>
            <input v-model="newUser.name" type="text" class="form-input" required autofocus />
          </div>
          <div class="form-group">
            <label class="form-label">Correo</label>
            <input v-model="newUser.email" type="email" class="form-input" required />
          </div>
          <div class="form-group">
            <label class="form-label">Contraseña</label>
            <input v-model="newUser.password" type="password" class="form-input" minlength="6" required />
          </div>
          <div class="form-group">
            <label class="form-label">Rol</label>
            <select v-model="newUser.roleId" class="form-select" required>
              <option value="" disabled>Selecciona un rol</option>
              <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
            </select>
          </div>
          <p v-if="userError" class="pf-form-error">{{ userError }}</p>
          <div class="pf-modal-actions">
            <button type="button" class="btn-secondary" @click="showUserModal = false">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="isSavingUser">
              {{ isSavingUser ? 'Creando…' : 'Crear usuario' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { apiFetch } from '../apiClient.js';

const AVATAR_HUES = ['#6F8125', '#2E7D46', '#DE754B', '#C85532', '#8A3F28', '#56624A', '#4B5A1C'];

const roles = ref([]);
const permissions = ref([]);
const users = ref([]);
const loadError = ref('');

const search = ref('');
const sortBy = ref('name');
const roleFilter = ref('all');
const openMenuId = ref(null);

const managingRole = ref(null);
const roleSaved = ref(false);
const showToolsModal = ref(false);
const showRoleModal = ref(false);
const showUserModal = ref(false);

const toolError = ref('');
const roleError = ref('');
const userError = ref('');
const isSavingUser = ref(false);

const newPermission = reactive({ key: '', label: '' });
const newRole = reactive({ name: '', description: '' });
const newUser = reactive({ name: '', email: '', password: '', roleId: '' });

/* ---------- clientes del portal ---------- */
const clientAccounts = ref([]);
const clientAccountsError = ref('');
const clientSearch = ref('');
const openClientMenuId = ref(null);
const showInviteClientModal = ref(false);
const newClientInvite = reactive({ email: '', name: '' });
const inviteClientError = ref('');
const isSavingClientInvite = ref(false);
const clientActionBusyId = ref(null);
const clientActionMessage = ref('');
const clientActionIsError = ref(false);

/* ---------- helpers ---------- */
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function hueOf(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function pct(count) {
  const total = permissions.value.length || 1;
  return `${Math.round((count / total) * 100)}%`;
}

function usersByRole(roleId) {
  return users.value.filter((u) => u.role_id === roleId);
}

function roleById(id) {
  return roles.value.find((r) => r.id === id);
}

/**
 * Las herramientas que esta persona tiene de verdad: el backend ya suma el rol
 * y sus excepciones (`permission_count`). El número del rol queda de respaldo
 * para una sesión que todavía no refrescó la lista.
 */
function accessCount(user) {
  return user.permission_count ?? roleById(user.role_id)?.permissions.length ?? 0;
}

function rolesUsing(permissionId) {
  return roles.value.filter((r) => r.permissions.some((p) => p.id === permissionId)).length;
}

function roleHasPermission(role, permissionId) {
  return role.permissions.some((p) => p.id === permissionId);
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---------- derived ---------- */
const visibleUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  let list = users.value.filter((u) => {
    if (roleFilter.value !== 'all' && u.role_id !== roleFilter.value) return false;
    if (!q) return true;
    return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
  });
  list = [...list];
  if (sortBy.value === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  else if (sortBy.value === 'recent') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sortBy.value === 'role') list.sort((a, b) => (a.role_name || '').localeCompare(b.role_name || ''));
  return list;
});

/* ---------- fetch ---------- */
async function fetchRoles() {
  const res = await apiFetch('/api/roles');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudieron obtener los roles.');
  roles.value = data.roles || [];
}
async function fetchPermissions() {
  const res = await apiFetch('/api/permissions');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudieron obtener las herramientas.');
  permissions.value = data.permissions || [];
}
async function fetchUsers() {
  const res = await apiFetch('/api/users');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudieron obtener las cuentas.');
  users.value = data.users || [];
}
async function fetchAll() {
  loadError.value = '';
  try {
    await Promise.all([fetchRoles(), fetchPermissions(), fetchUsers()]);
  } catch (err) {
    loadError.value = err.message;
  }
}

/* ---------- clientes del portal ---------- */
async function fetchClientAccounts() {
  clientAccountsError.value = '';
  try {
    const res = await apiFetch('/api/client-accounts');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron obtener los clientes del portal.');
    clientAccounts.value = data.accounts || [];
  } catch (err) {
    clientAccountsError.value = err.message;
  }
}

const visibleClientAccounts = computed(() => {
  const q = clientSearch.value.trim().toLowerCase();
  if (!q) return clientAccounts.value;
  return clientAccounts.value.filter((a) =>
    (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q)
  );
});

function clientStatusLabel(account) {
  if (account.is_activated) return 'Activada';
  if (account.invite_expired) return 'Invitación expirada';
  return 'Invitación pendiente';
}

function clientStatusClass(account) {
  if (account.is_activated) return 'is-active';
  if (account.invite_expired) return 'is-expired';
  return 'is-pending';
}

function toggleClientMenu(id) {
  openClientMenuId.value = openClientMenuId.value === id ? null : id;
}

function flashClientAction(message, isError = false) {
  clientActionMessage.value = message;
  clientActionIsError.value = isError;
  setTimeout(() => { clientActionMessage.value = ''; }, 4000);
}

function openInviteClientModal() {
  inviteClientError.value = '';
  newClientInvite.email = '';
  newClientInvite.name = '';
  showInviteClientModal.value = true;
}

async function createClientInvite() {
  inviteClientError.value = '';
  isSavingClientInvite.value = true;
  try {
    const res = await apiFetch('/api/client-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newClientInvite.email.trim(), name: newClientInvite.name.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo invitar al cliente.');
    await fetchClientAccounts();
    showInviteClientModal.value = false;
    flashClientAction(data.emailSent ? 'Invitación enviada.' : 'Cuenta creada, pero el correo no pudo salir — revisa la configuración de SMTP.', !data.emailSent);
  } catch (err) {
    inviteClientError.value = err.message;
  } finally {
    isSavingClientInvite.value = false;
  }
}

async function resendInvite(account) {
  closeClientMenu();
  clientActionBusyId.value = account.id;
  try {
    const res = await apiFetch(`/api/client-accounts/${account.id}/reenviar-invitacion`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo reenviar la invitación.');
    await fetchClientAccounts();
    flashClientAction(data.emailSent ? `Invitación reenviada a ${account.email}.` : `No se pudo mandar el correo a ${account.email} — revisa la configuración de SMTP.`, !data.emailSent);
  } catch (err) {
    flashClientAction(err.message, true);
  } finally {
    clientActionBusyId.value = null;
  }
}

async function sendResetLink(account) {
  closeClientMenu();
  clientActionBusyId.value = account.id;
  try {
    const res = await apiFetch(`/api/client-accounts/${account.id}/restablecer-password`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo mandar el link de restablecer.');
    flashClientAction(data.emailSent ? `Link de restablecer mandado a ${account.email}.` : `No se pudo mandar el correo a ${account.email} — revisa la configuración de SMTP.`, !data.emailSent);
  } catch (err) {
    flashClientAction(err.message, true);
  } finally {
    clientActionBusyId.value = null;
  }
}

async function removeClientAccount(account) {
  closeClientMenu();
  if (!confirm(`¿Quitar el acceso al portal de ${account.email}? Va a necesitar una invitación nueva para volver a entrar.`)) return;

  clientActionBusyId.value = account.id;
  try {
    const res = await apiFetch(`/api/client-accounts/${account.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo quitar el acceso.');
    clientAccounts.value = clientAccounts.value.filter((a) => a.id !== account.id);
    flashClientAction(`Acceso de ${account.email} eliminado.`);
  } catch (err) {
    flashClientAction(err.message, true);
  } finally {
    clientActionBusyId.value = null;
  }
}

/* ---------- role permissions ---------- */
function openManageRole(role) {
  managingRole.value = role;
  roleSaved.value = false;
}

async function togglePermission(role, permission, checked) {
  const currentIds = role.permissions.map((p) => p.id);
  const nextIds = checked ? [...currentIds, permission.id] : currentIds.filter((id) => id !== permission.id);
  try {
    const res = await apiFetch(`/api/roles/${role.id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionIds: nextIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar el acceso.');
    role.permissions = data.role.permissions;
    roleSaved.value = true;
    setTimeout(() => { roleSaved.value = false; }, 1800);
  } catch (err) {
    alert('No se pudo actualizar el acceso: ' + err.message);
  }
}

/* ---------- permisos de una persona (excepciones sobre el rol) ---------- */
const permUser = ref(null);
const permRows = ref([]);
const permLoading = ref(false);
const permSaved = ref(false);
const permError = ref('');

async function openUserPermissions(user) {
  openMenuId.value = null;
  permUser.value = { id: user.id, name: user.name, role: user.role_name };
  permRows.value = [];
  permError.value = '';
  permLoading.value = true;
  try {
    const res = await apiFetch(`/api/users/${user.id}/permissions`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los permisos.');
    permRows.value = data.permissions || [];
    permUser.value = { ...permUser.value, role: data.user.role };
  } catch (err) {
    permError.value = err.message;
  } finally {
    permLoading.value = false;
  }
}

function closeUserPermissions() {
  permUser.value = null;
  permRows.value = [];
}

/**
 * `null` devuelve el permiso a lo que diga el rol; `true`/`false` lo dan o lo
 * quitan solo a esta persona. Se manda una clave por vez —no el mapa entero—
 * para que dos pestañas abiertas no se pisen las excepciones de la otra.
 */
async function setUserPermission(permission, value) {
  if (!permUser.value) return;
  const previo = permission.override;
  permission.override = value;
  permission.effective = value === null ? permission.from_role : value;
  permError.value = '';
  try {
    const res = await apiFetch(`/api/users/${permUser.value.id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: { [permission.key]: value } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el permiso.');
    permRows.value = data.permissions || permRows.value;
    permSaved.value = true;
    setTimeout(() => { permSaved.value = false; }, 1800);
    // La columna "Acceso" de la tabla cuenta permisos efectivos: si no se
    // relee, queda diciendo el número de antes.
    fetchUsers();
  } catch (err) {
    permission.override = previo;
    permission.effective = previo === null ? permission.from_role : previo;
    permError.value = err.message;
  }
}

/* ---------- create ---------- */
function openRoleModal() {
  roleError.value = '';
  newRole.name = '';
  newRole.description = '';
  showRoleModal.value = true;
}

async function createRole() {
  roleError.value = '';
  try {
    const res = await apiFetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRole.name.trim(), description: newRole.description.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear el rol.');
    await fetchRoles();
    showRoleModal.value = false;
  } catch (err) {
    roleError.value = err.message;
  }
}

async function createPermission() {
  toolError.value = '';
  try {
    const res = await apiFetch('/api/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: newPermission.key.trim(), label: newPermission.label.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo registrar la herramienta.');
    permissions.value.push(data.permission);
    newPermission.key = '';
    newPermission.label = '';
  } catch (err) {
    toolError.value = err.message;
  }
}

function openUserModal() {
  userError.value = '';
  newUser.name = '';
  newUser.email = '';
  newUser.password = '';
  newUser.roleId = roles.value[0]?.id || '';
  showUserModal.value = true;
}

async function createUser() {
  userError.value = '';
  isSavingUser.value = true;
  try {
    const res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newUser })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo crear el usuario.');
    await fetchUsers();
    showUserModal.value = false;
  } catch (err) {
    userError.value = err.message;
  } finally {
    isSavingUser.value = false;
  }
}

/* ---------- row menu ---------- */
function toggleMenu(id) {
  openMenuId.value = openMenuId.value === id ? null : id;
}
function closeMenu() {
  openMenuId.value = null;
  openClientMenuId.value = null;
}

function closeClientMenu() {
  openClientMenuId.value = null;
}

async function changeUserRole(user, roleId) {
  closeMenu();
  if (user.role_id === roleId) return;
  const prevRoleId = user.role_id;
  const prevRoleName = user.role_name;
  user.role_id = roleId;
  user.role_name = roleById(roleId)?.name || user.role_name;
  try {
    const res = await apiFetch(`/api/users/${user.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cambiar el rol.');
  } catch (err) {
    user.role_id = prevRoleId;
    user.role_name = prevRoleName;
    alert('No se pudo cambiar el rol: ' + err.message);
  }
}

onMounted(() => {
  fetchAll();
  fetchClientAccounts();
  document.addEventListener('click', closeMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu);
});
</script>

<style scoped>
.pf-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  width: 100%;
  box-sizing: border-box;
}

.pf-subheading {
  max-width: 640px;
  margin-bottom: 0;
}

.pf-add-btn {
  width: auto;
  padding: 0.6rem 1.15rem;
}

.pf-alert {
  border-color: rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
}

/* ---------- section shell ---------- */
.pf-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pf-section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.pf-section-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pf-section-note {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0.2rem 0 0;
}

.pf-count-badge {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-sub);
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
}

.pf-section-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.pf-mini-btn {
  width: auto;
  padding: 0.45rem 0.85rem;
  font-size: 0.82rem;
}

/* ---------- role cards ---------- */
.pf-role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.pf-role-card {
  --role-accent: var(--primary);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--role-accent);
  border-radius: var(--radius-lg);
  padding: 1.15rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  box-shadow: var(--shadow-sm);
}

.pf-role-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pf-role-dot {
  --role-accent: var(--primary);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--role-accent);
  flex-shrink: 0;
}

.pf-role-name {
  font-family: var(--font-heading);
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-tool-chip {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-sub);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  flex-shrink: 0;
}

.pf-role-desc {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.45;
  min-height: 2.3em;
}

.pf-role-members {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  min-height: 3rem;
}

.pf-member {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
}

.pf-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  font-family: var(--font-heading);
}

.pf-avatar-sm {
  width: 26px;
  height: 26px;
  font-size: 0.66rem;
}

.pf-member-texts {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.pf-member-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-member-email {
  font-size: 0.7rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-member-more,
.pf-member-empty {
  font-size: 0.74rem;
  color: var(--text-muted);
  margin: 0;
}

.pf-member-more {
  padding-left: 0.2rem;
}

.pf-role-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.pf-access-meter {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  min-width: 0;
}

.pf-access-bar {
  height: 5px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}

.pf-access-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--role-accent, var(--primary));
  transition: width 0.35s ease;
}

.pf-access-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.pf-manage-btn {
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: var(--radius-md);
  padding: 0.4rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}

.pf-manage-btn:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
}

/* ---------- accounts toolbar ---------- */
.pf-search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.35rem 0.6rem;
  min-width: 230px;
}

.pf-search-icon {
  font-size: 0.8rem;
  opacity: 0.6;
}

.pf-search-input {
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-main);
  font-size: 0.85rem;
  width: 100%;
}

.pf-search-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
}

.pf-sort {
  width: auto;
  padding: 0.4rem 0.6rem;
  font-size: 0.82rem;
}

.pf-tabs {
  margin-bottom: 0;
  overflow-x: auto;
  flex-wrap: nowrap;
}

.pf-empty {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
}

/* ---------- accounts table ---------- */
.pf-table-wrapper {
  overflow-x: auto;
}

.pf-cell-user {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.pf-cell-user-name {
  font-weight: 600;
  color: var(--text-main);
}

.pf-cell-email {
  font-size: 0.8rem;
  color: var(--text-sub);
}

.pf-cell-date {
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.pf-cell-user-texts {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.pf-client-status {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 0.2rem 0.65rem;
  white-space: nowrap;
}

.pf-client-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.pf-client-status.is-active {
  color: var(--accent-emerald);
  background: rgba(46, 125, 70, 0.12);
}
.pf-client-status.is-active::before {
  background: var(--accent-emerald);
}

.pf-client-status.is-pending {
  color: var(--accent-amber);
  background: rgba(222, 117, 75, 0.12);
}
.pf-client-status.is-pending::before {
  background: var(--accent-amber);
}

.pf-client-status.is-expired {
  color: var(--accent-rose);
  background: rgba(200, 85, 50, 0.12);
}
.pf-client-status.is-expired::before {
  background: var(--accent-rose);
}

.pf-menu-item-danger {
  color: var(--accent-rose);
  border-top: 1px solid var(--border-color);
  margin-top: 0.2rem;
  padding-top: 0.55rem;
}

.pf-menu-item-danger:hover {
  background: rgba(200, 85, 50, 0.1);
  color: var(--accent-rose);
}

.pf-menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pf-client-action-msg {
  font-size: 0.82rem;
  color: var(--accent-emerald);
  margin: 0;
}

.pf-client-action-msg.is-error {
  color: var(--accent-rose);
}

.pf-role-pill {
  --role-accent: var(--primary);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-sub);
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.15rem 0.6rem;
}

.pf-role-pill::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--role-accent);
}

.pf-access-meter-sm {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  max-width: 150px;
}

.pf-access-meter-sm .pf-access-bar {
  flex: 1;
}

.pf-cell-menu {
  position: relative;
  text-align: right;
  width: 40px;
}

.pf-menu-trigger {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius-sm);
}

.pf-menu-trigger:hover {
  background: var(--surface-2);
  color: var(--text-main);
}

.pf-menu {
  position: absolute;
  right: 0.5rem;
  top: 100%;
  margin-top: 0.25rem;
  z-index: 20;
  min-width: 200px;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 0.4rem;
  text-align: left;
}

.pf-menu-label {
  display: block;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 0.3rem 0.5rem 0.35rem;
}

.pf-menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: none;
  border: none;
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  color: var(--text-sub);
  cursor: pointer;
}

.pf-menu-item:hover {
  background: var(--surface-2);
  color: var(--text-main);
}

.pf-menu-item.is-current {
  color: var(--text-main);
  font-weight: 600;
}

.pf-menu-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pf-menu-check {
  margin-left: auto;
  color: var(--primary);
}

/* ---------- modals ---------- */
.pf-modal {
  max-width: 560px;
}

.pf-modal-narrow {
  max-width: 420px;
}

.pf-modal-title-group {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.pf-modal-title {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.pf-modal-sub {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin: 0.1rem 0 0;
}

.pf-close-btn {
  padding: 0.35rem 0.8rem;
  flex-shrink: 0;
}

.pf-modal-note {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.pf-saved {
  color: var(--accent-emerald);
  font-weight: 600;
  margin-left: 0.4rem;
}

.pf-tool-list {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 46vh;
  overflow-y: auto;
}

.pf-tool-row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.pf-tool-row:hover {
  background: var(--surface-1);
}

.pf-tool-row-static {
  cursor: default;
  justify-content: space-between;
}

.pf-tool-row input {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.pf-tool-row-texts {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.pf-tool-row-label {
  font-size: 0.86rem;
  color: var(--text-main);
}

.pf-tool-row-key {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.pf-tool-row-count {
  font-size: 0.74rem;
  color: var(--text-muted);
  white-space: nowrap;
}

/* Tres estados por herramienta: hereda del rol, se la doy, se la quito. */
.pf-perm-choice {
  display: inline-flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.pf-perm-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-card-solid);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: 0.22rem 0.5rem;
  font-size: 0.72rem;
  cursor: pointer;
  white-space: nowrap;
}

.pf-perm-btn:hover { border-color: var(--border-strong); }
.pf-perm-btn.is-on { color: #fff; border-color: transparent; background: var(--text-sub); }
.pf-perm-btn.is-yes.is-on { background: var(--accent-emerald); }
.pf-perm-btn.is-no.is-on { background: var(--accent-rose); }

.pf-inline-form {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto;
  gap: 0.6rem;
  align-items: end;
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--border-color);
}

.pf-inline-form .form-group {
  margin-bottom: 0;
}

.pf-inline-submit {
  width: auto;
  padding: 0 1.1rem;
  height: 40px;
}

.pf-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.5rem;
}

.pf-modal-actions .btn-primary,
.pf-modal-actions .btn-secondary {
  width: auto;
  padding: 0.55rem 1.2rem;
}

.pf-form-error {
  color: var(--accent-rose);
  font-size: 0.82rem;
  margin: 0.25rem 0 0;
}

@media (max-width: 768px) {
  .pf-page {
    padding: 1rem;
  }
  .pf-inline-form {
    grid-template-columns: 1fr;
  }
  .pf-inline-submit {
    width: 100%;
  }
}
</style>
