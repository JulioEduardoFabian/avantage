<template>
  <div id="app">
    <!-- Pantalla de carga inicial y barra de progreso superior entre rutas -->
    <AppLoader mode="splash" :show="loadingState.isBooting" :title="loadingState.bootMessage" />
    <AppLoader mode="topbar" :show="loadingState.isNavigating" />

    <!-- Admin Layout with Sidebar & Navbar for Dashboard / Admin pages -->
    <AdminLayout v-if="isAdminRoute">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </AdminLayout>

    <!-- Portal de clientes: layout propio (header + bottom nav mobile) -->
    <ClientPortalLayout v-else-if="isPortalAppRoute">
      <router-view v-slot="{ Component }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </ClientPortalLayout>

    <!-- Login / pantallas de auth (internas y del portal): pantalla completa, sin header/footer público -->
    <router-view v-else-if="isBareRoute" />

    <!-- Public Layout for the rest of the public site -->
    <template v-else>
      <header class="site-header">
        <div class="container header-inner">
          <router-link to="/" class="logo-group">
            <div class="logo-icon">AG</div>
            <div class="logo-text">
              <h1>Avantage Group</h1>
              <p>Investigación · Software · Marketing</p>
            </div>
          </router-link>

          <div class="header-actions">
            <template v-if="authState.token">
              <router-link to="/dashboard" class="btn-primary header-cta">
                🧭 Dashboard Admin
              </router-link>
              <button type="button" class="btn-secondary header-cta" @click="handleLogout">
                Salir
              </button>
            </template>
            <router-link v-else to="/login" class="btn-secondary header-cta">
              🔐 Acceso Admin
            </router-link>

            <div class="status-badge">
              <div class="dot-pulse"></div>
              <span>Node.js Backend Activo</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Public Routed View -->
      <router-view />

      <!-- Public Footer -->
      <footer class="site-footer">
        <div class="container">
          <p><strong>AVANTAGE GROUP</strong> — Evaluador de Viabilidad de Tesis a Nivel de Pregrado y Posgrado en Perú.</p>
          <p class="site-footer-tagline">
            Research · Technology · Innovation · Growth
          </p>
        </div>
      </footer>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authState, clearSession } from './auth.js';
import { loadingState } from './loadingState.js';
import AdminLayout from './components/AdminLayout.vue';
import ClientPortalLayout from './components/ClientPortalLayout.vue';
import AppLoader from './components/AppLoader.vue';

const route = useRoute();
const router = useRouter();

const isAdminRoute = computed(() => {
  return route.path === '/dashboard' || route.path.startsWith('/admin');
});

const PORTAL_AUTH_PATHS = ['/portal/login', '/portal/activar', '/portal/olvide-password', '/portal/restablecer'];

const isPortalAppRoute = computed(() => {
  return route.path.startsWith('/portal') && !PORTAL_AUTH_PATHS.includes(route.path);
});

const isBareRoute = computed(() => route.path === '/login' || PORTAL_AUTH_PATHS.includes(route.path));

function handleLogout() {
  clearSession();
  router.push('/login');
}

// Los permisos (y el token) se refrescan en el guard del router: ver
// refreshSessionOnce() en apiClient.js.
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.header-cta {
  text-decoration: none;
  font-size: 0.85rem;
  padding: 0.55rem 1.1rem;
  width: auto;
}

.site-footer-tagline {
  margin-top: 0.3rem;
  opacity: 0.7;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.72rem;
  font-family: var(--font-mono);
}

:global(.page-fade-enter-active),
:global(.page-fade-leave-active) {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

:global(.page-fade-enter-from) {
  opacity: 0;
  transform: translateY(4px);
}

:global(.page-fade-leave-to) {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
