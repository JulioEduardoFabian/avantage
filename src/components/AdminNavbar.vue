<template>
  <header class="admin-navbar">
    <div class="navbar-inner">
      <!-- Left side: Collapse / Sidebar Toggle -->
      <div class="navbar-left">
        <button 
          class="icon-btn toggle-btn" 
          @click="$emit('toggle-sidebar')"
          title="Alternar Menú Sidebar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>

        <!-- Current Breadcrumb or Page Context -->
        <span class="page-title">{{ currentPageTitle }}</span>
      </div>

      <!-- Right side: Quick Icons & User Menu -->
      <div class="navbar-right">
        <!-- Theme Toggle Icon -->
        <button class="icon-btn" @click="toggleTheme" :title="isLightMode ? 'Modo Oscuro' : 'Modo Claro'">
          <svg v-if="!isLightMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>

        <!-- Acceso rápido a Conversaciones / WhatsApp -->
        <div class="badge-icon-wrapper">
          <button class="icon-btn" title="Ir a Conversaciones de WhatsApp" @click="router.push('/admin/whatsapp')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>

        <!-- Notification Bell with Red Badge -->
        <div class="badge-icon-wrapper" ref="notifMenuRef">
          <button class="icon-btn" title="Notificaciones" @click="toggleNotifDropdown">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>
          <span v-if="unreadCount > 0" class="notification-badge red-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>

          <div v-if="isNotifDropdownOpen" class="user-dropdown glass-dropdown notif-dropdown">
            <div class="notif-dropdown-header">
              <span class="notif-dropdown-title">Notificaciones</span>
              <button v-if="unreadCount > 0" type="button" class="notif-mark-all" @click="markAllNotificationsRead">
                Marcar todas leídas
              </button>
            </div>
            <div v-if="notifications.length === 0" class="notif-empty">
              Sin notificaciones todavía.
            </div>
            <!--
              Cada aviso es un <div> con DOS botones adentro y no un botón que
              envuelve todo, que es como estaba: un botón dentro de otro es HTML
              inválido, y el clic en "Ver todo" habría disparado además la
              navegación del aviso — o sea que desplegar el texto te sacaba de
              la campana, que es lo contrario de lo que se pide.
            -->
            <div v-else class="notif-list custom-scrollbar">
              <div
                v-for="notif in notifications"
                :key="notif.id"
                class="notif-item"
                :class="{ 'is-unread': !notif.is_read }"
              >
                <button type="button" class="notif-item-main" @click="openNotification(notif)">
                  <span class="notif-item-icon">{{ notif.type === 'meeting_booked' ? '📅' : '⚠️' }}</span>
                  <span class="notif-item-body">
                    <strong class="notif-item-title">{{ notif.title }}</strong>
                    <!--
                      Desplegado se respetan los saltos de línea del cuerpo
                      (`pre-line`): estos avisos vienen escritos en párrafos —el
                      mensaje del contacto va en su propio renglón— y aplastados
                      en un bloque corrido se vuelven ilegibles justo cuando uno
                      los abrió para leerlos enteros.
                    -->
                    <span
                      v-if="notif.body"
                      class="notif-item-text"
                      :class="{ 'is-expanded': expandedNotifs.has(notif.id) }"
                    >{{ notif.body }}</span>
                  </span>
                </button>
                <button
                  v-if="isLongNotif(notif)"
                  type="button"
                  class="notif-expand"
                  @click.stop="toggleNotifText(notif.id)"
                >
                  {{ expandedNotifs.has(notif.id) ? 'Ver menos' : 'Ver todo' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- User Avatar + Name -->
        <div class="user-menu-container" ref="userMenuRef">
          <button type="button" class="avatar-wrapper" @click="isUserMenuOpen = !isUserMenuOpen">
            <span class="avatar-circle-wrap">
              <span class="avatar-circle">
                <img v-if="authState.user?.avatar_url" :src="authState.user.avatar_url" alt="Avatar" />
                <span v-else class="avatar-initials">{{ userInitials }}</span>
              </span>
              <span class="online-indicator"></span>
            </span>
            <span class="avatar-name">{{ (authState.user?.name || 'Administrador').split(' ')[0] }}</span>
            <svg class="avatar-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          <!-- Dropdown User Menu -->
          <div v-if="isUserMenuOpen" class="user-dropdown glass-dropdown">
            <div class="dropdown-header">
              <div class="user-name">{{ authState.user?.name || 'Administrador' }}</div>
              <div class="user-email">{{ authState.user?.email || 'admin@avantage.pe' }}</div>
              <div class="user-role-badge">{{ authState.user?.role || 'Admin' }}</div>
            </div>

            <div class="dropdown-divider"></div>

            <!-- "Mi perfil" va primero y sin `v-if`: es la única entrada del
                 menú que no depende de ningún permiso, porque todo el mundo
                 tiene cuenta. -->
            <router-link to="/admin/perfil" class="dropdown-item" @click="isUserMenuOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              Mi perfil
            </router-link>

            <div class="dropdown-divider"></div>

            <router-link to="/evaluador-tesis" class="dropdown-item" @click="isUserMenuOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              Evaluador Público
            </router-link>

            <router-link to="/dashboard" class="dropdown-item" @click="isUserMenuOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
              </svg>
              Inicio Dashboard
            </router-link>

            <div class="dropdown-divider"></div>

            <button type="button" class="dropdown-item logout-item" @click="handleLogout">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authState, clearSession } from '../auth.js';
import { getTheme, toggleTheme as toggleStoredTheme } from '../theme.js';
import { apiFetch } from '../apiClient.js';

const emit = defineEmits(['toggle-sidebar']);
const route = useRoute();
const router = useRouter();

const isLightMode = ref(getTheme() === 'light');
const isUserMenuOpen = ref(false);
const userMenuRef = ref(null);

const notifications = ref([]);
const unreadCount = ref(0);
const isNotifDropdownOpen = ref(false);
const notifMenuRef = ref(null);
let notifPollTimer = null;

async function fetchUnreadCount() {
  try {
    const response = await apiFetch('/api/notifications/unread-count');
    const data = await response.json();
    if (response.ok) unreadCount.value = data.count || 0;
  } catch (error) {
    console.warn('No se pudo obtener el conteo de notificaciones:', error);
  }
}

async function fetchNotifications() {
  try {
    const response = await apiFetch('/api/notifications');
    const data = await response.json();
    if (response.ok) notifications.value = data.notifications || [];
  } catch (error) {
    console.warn('No se pudo obtener las notificaciones:', error);
  }
}

async function toggleNotifDropdown() {
  isNotifDropdownOpen.value = !isNotifDropdownOpen.value;
  if (isNotifDropdownOpen.value) await fetchNotifications();
  else expandedNotifs.value = new Set();
}

/*
 * Qué avisos están desplegados. Es un Set de ids y vive en la pantalla, no en
 * la base: desplegar un texto para leerlo es un gesto del momento, no una
 * preferencia que valga la pena recordar entre sesiones.
 *
 * Se vacía al cerrar el menú, para que la próxima vez la lista vuelva a verse
 * completa de un vistazo en vez de con tres avisos abiertos de la vez pasada.
 */
const expandedNotifs = ref(new Set());

/*
 * Cuándo ofrecer "Ver todo". El cuerpo se recorta a dos líneas por CSS
 * (`-webkit-line-clamp`), y en el ancho de este menú con esta tipografía esas
 * dos líneas son unos 100 caracteres.
 *
 * Es una estimación y no una medición del DOM a propósito: medir
 * `scrollHeight` contra `clientHeight` obliga a un reflow por aviso cada vez
 * que se abre la campana, y el costo de equivocarse acá es mínimo — en el peor
 * caso aparece un "Ver todo" que despliega una línea de más. Lo que no puede
 * pasar es lo contrario: que un texto recortado no ofrezca cómo abrirlo, y por
 * eso el umbral se queda corto en vez de pasarse.
 */
const NOTIF_CLAMP_CHARS = 100;

function isLongNotif(notif) {
  const body = notif.body || '';
  // Un cuerpo con saltos de línea ya ocupa más de dos líneas aunque sea corto.
  return body.length > NOTIF_CLAMP_CHARS || body.includes('\n');
}

function toggleNotifText(id) {
  // Se reemplaza el Set en vez de mutarlo: Vue no reacciona a `.add()` sobre
  // un Set dentro de un ref.
  const next = new Set(expandedNotifs.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedNotifs.value = next;
}

async function openNotification(notif) {
  isNotifDropdownOpen.value = false;
  expandedNotifs.value = new Set();
  if (!notif.is_read) {
    try {
      await apiFetch(`/api/notifications/${notif.id}/read`, { method: 'POST' });
      notif.is_read = true;
      await fetchUnreadCount();
    } catch (error) {
      console.warn('No se pudo marcar la notificación como leída:', error);
    }
  }
  if (notif.link) router.push(notif.link);
}

async function markAllNotificationsRead() {
  try {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    notifications.value = notifications.value.map((n) => ({ ...n, is_read: true }));
    unreadCount.value = 0;
  } catch (error) {
    console.warn('No se pudieron marcar las notificaciones como leídas:', error);
  }
}

const currentPageTitle = computed(() => {
  if (route.path === '/dashboard') return 'Inicio';
  if (route.path === '/admin/database') return 'Base de Datos de Leads';
  if (route.path === '/admin/leads') return 'Funnel de Ventas';
  if (route.path === '/admin/setter-funnel') return 'Setter Funnel';
  if (route.path === '/admin/reporte-leads') return 'Reporte de Leads';
  if (route.path === '/admin/reporte-setters') return 'Reporte de Setters';
  if (route.path === '/admin/reporte-general') return 'Reporte General';
  if (route.path === '/admin/avisos') return 'Avisos al Equipo';
  if (route.path === '/admin/campaigns') return 'Campañas Publicitarias';
  if (route.path === '/admin/finance') return 'Finanzas y Tesorería';
  if (route.path === '/admin/cobranzas') return 'Cartera de Cobranzas';
  if (route.path === '/admin/calendario') return 'Calendario Comercial';
  if (route.path === '/admin/entregables') return 'Entregables';
  if (route.path === '/admin/contracts') return 'Contratos';
  if (route.path === '/admin/documents') return 'Documentos Emitidos';
  if (route.path === '/admin/whatsapp') return 'WhatsApp Business';
  if (route.path === '/admin/instagram') return 'Interacciones de Instagram';
  if (route.path === '/admin/social') return 'Interacciones de Facebook';
  if (route.path === '/admin/availability') return 'Mi Disponibilidad';
  if (route.path === '/admin/bot-script') return 'Personalidad de Avan';
  if (route.path === '/admin/reparto') return 'Reparto de Leads';
  if (route.path === '/admin/carreras') return 'Catálogo de Carreras';
  if (route.path === '/admin/webhooks') return 'Monitor de Webhooks';
  if (route.path.startsWith('/admin/projects')) return 'Gestión de Proyectos';
  if (route.path === '/admin/roles') return 'Perfiles y Permisos';
  if (route.path === '/admin/perfil') return 'Mi Perfil';
  return 'Panel Administrativo';
});

const userInitials = computed(() => {
  const name = authState.user?.name || 'Admin';
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
});

function toggleTheme() {
  isLightMode.value = toggleStoredTheme() === 'light';
}

function handleLogout() {
  isUserMenuOpen.value = false;
  clearSession();
  router.push('/login');
}

function handleClickOutside(event) {
  if (userMenuRef.value && !userMenuRef.value.contains(event.target)) {
    isUserMenuOpen.value = false;
  }
  if (notifMenuRef.value && !notifMenuRef.value.contains(event.target)) {
    isNotifDropdownOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  fetchUnreadCount();
  // Sondeo simple del conteo de no leídas — suficiente para una campana de
  // panel admin, sin necesidad de websockets.
  notifPollTimer = setInterval(fetchUnreadCount, 60000);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  if (notifPollTimer) clearInterval(notifPollTimer);
});
</script>

<style scoped>
/* La barra se pega al contenido: con el aire reducido del panel, 1.5rem
   dejaba un hueco tan grande como la propia barra. */
.admin-navbar {
  margin-bottom: 0.75rem;
}

.navbar-inner {
  background-color: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  height: 52px;
  padding: 0 0.9rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-sm);
}

.navbar-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.icon-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  color: var(--text-main);
  background-color: var(--surface-2);
}

.icon-btn svg {
  width: 20px;
  height: 20px;
}

.page-title {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.01em;
}

.navbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.badge-icon-wrapper {
  position: relative;
}

.notification-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  border-radius: 9999px;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.red-badge {
  background-color: var(--accent-rose);
  color: #ffffff;
  border: 1px solid var(--bg-card-solid);
}

.user-menu-container {
  position: relative;
  margin-left: 0.25rem;
}

.avatar-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  border: none;
  padding: 0.2rem 0.3rem 0.2rem 0.2rem;
  border-radius: 9999px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.avatar-wrapper:hover {
  background: var(--surface-2);
}

.avatar-circle-wrap {
  position: relative;
  flex-shrink: 0;
}

.avatar-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
}

.avatar-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.avatar-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-cyan), var(--primary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-weight: 700;
  font-size: 0.85rem;
  border: 2px solid var(--border-color);
  overflow: hidden;
  transition: transform 0.2s ease;
}

.avatar-wrapper:hover .avatar-circle {
  transform: scale(1.05);
}

.avatar-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.online-indicator {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background-color: var(--accent-emerald);
  border: 2px solid var(--bg-card-solid);
  border-radius: 50%;
}

.user-dropdown {
  position: absolute;
  top: 48px;
  right: 0;
  width: 230px;
  background-color: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 0.75rem;
  z-index: 150;
}

.dropdown-header {
  padding-bottom: 0.5rem;
}

.user-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--text-main);
}

.user-email {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.35rem;
  word-break: break-all;
}

.user-role-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  background: rgba(111, 129, 37, 0.14);
  color: var(--on-tint-strong);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  border: 1px solid rgba(111, 129, 37, 0.35);
}

.dropdown-divider {
  height: 1px;
  background-color: var(--border-color);
  margin: 0.5rem 0;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  color: var(--text-sub);
  text-decoration: none;
  font-size: 0.825rem;
  transition: all 0.2s ease;
  background: transparent;
  border: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.dropdown-item:hover {
  background-color: var(--surface-2);
  color: var(--text-main);
}

.logout-item {
  color: var(--accent-rose);
}

.logout-item:hover {
  background-color: rgba(200, 85, 50, 0.14);
  color: var(--accent-rose);
}

.notif-dropdown {
  width: 320px;
  padding: 0;
  overflow: hidden;
}

.notif-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border-bottom: 1px solid var(--border-color);
}

.notif-dropdown-title {
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--text-main);
}

.notif-mark-all {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.notif-mark-all:hover {
  text-decoration: underline;
}

.notif-empty {
  padding: 1.5rem 1rem;
  text-align: center;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.notif-list {
  max-height: 360px;
  overflow-y: auto;
}

/* La fila. Ya no es el boton: adentro van el de abrir y el de desplegar. */
.notif-item {
  border-bottom: 1px solid var(--border-color);
  transition: background 0.15s ease;
}

/* Lo que abre el aviso: ocupa la fila entera menos el "Ver todo". */
.notif-item-main {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  width: 100%;
  padding: 0.7rem 0.9rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

/*
 * "Ver todo" va debajo y alineado con el texto, no al lado: puesto a la
 * derecha le robaba ancho al cuerpo, que es justo lo que se esta tratando de
 * mostrar. Y es discreto a proposito — lo que se mira en esta lista son los
 * avisos, no sus controles.
 */
.notif-expand {
  display: block;
  margin: -0.35rem 0 0.5rem 2.65rem;
  padding: 0.1rem 0.35rem;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--brand-olive, #6F8125);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.notif-expand:hover {
  background: var(--surface-2);
  text-decoration: underline;
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item:hover {
  background: var(--surface-2);
}

.notif-item-main:hover {
  background: transparent;
}

.notif-item.is-unread {
  background: rgba(111, 129, 37, 0.06);
}

.notif-item-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
  line-height: 1.4;
}

.notif-item-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.notif-item-title {
  font-size: 0.82rem;
  color: var(--text-main);
}

.notif-item-text {
  font-size: 0.76rem;
  color: var(--text-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/*
 * Desplegado: sin recorte y respetando los saltos de linea con los que estos
 * avisos vienen escritos (el mensaje del contacto va en su propio renglon).
 * Aplastados en un bloque corrido se vuelven ilegibles justo cuando alguien
 * los abrio para leerlos enteros.
 *
 * `-webkit-line-clamp: unset` y no quitar el `display: -webkit-box`: el box
 * sigue sirviendo y asi la regla desplegada es exactamente la inversa de la
 * recortada, sin tener que repetir las otras cuatro propiedades.
 */
.notif-item-text.is-expanded {
  -webkit-line-clamp: unset;
  overflow: visible;
  white-space: pre-line;
}
</style>
