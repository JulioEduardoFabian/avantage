<template>
  <aside class="admin-sidebar" :class="{ 'is-collapsed': isCollapsed, 'is-mobile-open': isMobileOpen }">
    <!-- Brand / Header -->
    <div class="sidebar-brand">
      <router-link to="/dashboard" class="brand-link" @click="closeMobile">
        <div class="brand-logo">AG</div>
        <div class="brand-text" v-if="!isCollapsed">
          <span class="brand-name">Avantage</span>
        </div>
      </router-link>

      <button class="mobile-close-btn" @click="$emit('toggle-mobile')">
        ✕
      </button>
    </div>

    <!-- Scrollable Navigation Items -->
    <div class="sidebar-scroll">
      <div class="nav-section">
        <router-link
          to="/dashboard"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/dashboard' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--primary);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Inicio</span>
        </router-link>
      </div>

      <div class="nav-section">
        <div class="section-title" v-if="!isCollapsed">Menú</div>

        <router-link
          v-if="hasPermission('leads.view')"
          to="/admin/leads"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/leads' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-amber);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Funnel</span>
        </router-link>

        <router-link
          v-if="hasPermission('setter.view')"
          to="/admin/setter-funnel"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/setter-funnel' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-pink);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Setter Funnel</span>
        </router-link>

        <router-link
          v-if="hasPermission('campaigns.view')"
          to="/admin/campaigns"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/campaigns' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-amber);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1z"/>
            <path d="M17 8a5 5 0 0 1 0 8"/>
            <path d="M20 5a9 9 0 0 1 0 14"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Campañas</span>
        </router-link>

        <router-link
          v-if="hasPermission('webhooks.view')"
          to="/admin/webhooks"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/webhooks' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-cyan);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
            <line x1="12" y1="2" x2="12" y2="12"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Webhooks</span>
        </router-link>

        <router-link
          v-if="hasPermission('social.view')"
          to="/admin/social"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/social' }"
          @click="closeMobile"
        >
          <BrandIcon name="facebook" :size="22" class="nav-icon-brand" />
          <span class="nav-label" v-if="!isCollapsed">Interacciones</span>
        </router-link>

        <router-link
          v-if="hasPermission('instagram.view')"
          to="/admin/instagram"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/instagram' }"
          @click="closeMobile"
        >
          <BrandIcon name="instagram" :size="22" class="nav-icon-brand" />
          <span class="nav-label" v-if="!isCollapsed">Instagram</span>
        </router-link>

        <router-link
          v-if="hasPermission('whatsapp.view')"
          to="/admin/whatsapp"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/whatsapp' }"
          @click="closeMobile"
        >
          <BrandIcon name="whatsapp" :size="22" class="nav-icon-brand" />
          <span class="nav-label" v-if="!isCollapsed">WhatsApp</span>
        </router-link>

        <router-link
          v-if="hasPermission('bot.manage')"
          to="/admin/bot-script"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/bot-script' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-pink);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <path d="M8 9h8M8 13h5"/>
            <circle cx="17" cy="16" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Personalidad del Bot</span>
        </router-link>

        <router-link
          v-if="hasPermission('availability.view')"
          to="/admin/availability"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/availability' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-emerald);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Disponibilidad</span>
        </router-link>

        <router-link
          v-if="hasPermission('projects.view')"
          to="/admin/projects"
          class="nav-item"
          :class="{ 'is-active': $route.path.startsWith('/admin/projects') }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-rose);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.71 1.26-1.5 1.5-2.5h-2c-.5 0-.85-.15-1.15-.45l-1.35-1.35z"/>
            <path d="M12 15l-3-3 7.5-7.5c1.5-1.5 3.5-1.5 5 0s1.5 3.5 0 5L14 17l-2-2z"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Proyectos</span>
        </router-link>

        <router-link
          v-if="hasPermission('deliverables.view')"
          to="/admin/entregables"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/entregables' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-amber);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/>
            <rect x="2" y="3" width="20" height="5" rx="1"/>
            <path d="M10 12h4"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Entregables</span>
        </router-link>

        <router-link
          v-if="hasPermission('finance.view')"
          to="/admin/finance"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/finance' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-emerald);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Finanzas</span>
        </router-link>

        <router-link
          v-if="hasPermission('documents.view')"
          to="/admin/documents"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/documents' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-amber);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1"/>
            <path d="M8 11h8M8 15h5"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Documentos</span>
        </router-link>

        <router-link
          v-if="hasPermission('contracts.manage')"
          to="/admin/contracts"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/contracts' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-cyan);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <path d="M14 2v6h6"/>
            <path d="M8 13h8M8 17h5"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Contratos</span>
        </router-link>

        <router-link
          v-if="hasPermission('roles.manage')"
          to="/admin/roles"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/roles' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-silver);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Perfiles</span>
        </router-link>

        <router-link
          v-if="hasPermission('careers.manage')"
          to="/admin/carreras"
          class="nav-item"
          :class="{ 'is-active': $route.path === '/admin/carreras' }"
          @click="closeMobile"
        >
          <svg class="nav-icon" style="color: var(--accent-cyan);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 10L12 5 2 10l10 5 10-5z"/>
            <path d="M6 12v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5"/>
          </svg>
          <span class="nav-label" v-if="!isCollapsed">Carreras</span>
        </router-link>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { hasPermission } from '../auth.js';
import BrandIcon from './BrandIcon.vue';

const props = defineProps({
  isCollapsed: { type: Boolean, default: false },
  isMobileOpen: { type: Boolean, default: false }
});

const emit = defineEmits(['toggle-mobile']);

function closeMobile() {
  if (props.isMobileOpen) {
    emit('toggle-mobile');
  }
}
</script>

<style scoped>
.admin-sidebar {
  width: 240px;
  background-color: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  height: 100vh;
  position: sticky;
  top: 0;
  z-index: 120;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease;
  user-select: none;
}

.admin-sidebar.is-collapsed {
  width: 72px;
}

.sidebar-brand {
  height: 68px;
  padding: 0 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  color: var(--text-main);
}

.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 0.95rem;
  color: var(--bg-card-solid);
  flex-shrink: 0;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.brand-name {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: -0.01em;
  color: var(--text-main);
}

.mobile-close-btn {
  display: none;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 0.75rem;
  scrollbar-width: thin;
  scrollbar-color: var(--scrollbar-thumb) transparent;
}

.nav-section {
  margin-bottom: 1.25rem;
}

.section-title {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  text-transform: uppercase;
  margin: 0.75rem 0 0.5rem 0.6rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.65rem 0.75rem;
  color: var(--text-sub);
  text-decoration: none;
  border-radius: var(--radius-md);
  font-size: 0.88rem;
  font-weight: 500;
  transition: all 0.2s ease;
  margin-bottom: 0.2rem;
}

.nav-item:hover {
  color: var(--text-main);
  background-color: var(--surface-2);
}

.nav-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  stroke-width: 2;
}

.nav-icon-brand {
  flex-shrink: 0;
  border-radius: 7px;
}

/* Soft, neutral active state — the icon keeps its own bright color for
   orientation, the pill itself stays low-key so it doesn't compete for
   attention (per the "minimal, not overloaded" brief). */
.nav-item.is-active {
  background: var(--surface-3);
  color: var(--text-main);
  font-weight: 700;
}

@media (max-width: 768px) {
  .admin-sidebar {
    position: fixed;
    left: -260px;
    top: 0;
    bottom: 0;
    box-shadow: var(--shadow-lg);
  }

  .admin-sidebar.is-mobile-open {
    left: 0;
  }

  .mobile-close-btn {
    display: block;
  }
}
</style>
