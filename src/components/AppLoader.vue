<template>
  <!-- 1. MODO SPLASH: Pantalla completa al iniciar la aplicación -->
  <transition name="loader-fade">
    <div v-if="mode === 'splash' && show" class="app-splash-overlay" role="status" aria-live="polite">
      <div class="splash-card">
        <div class="splash-logo-ring">
          <div class="splash-orbit"></div>
          <div class="splash-logo">AG</div>
        </div>
        <h2 class="splash-brand">Avantage Group</h2>
        <p class="splash-tagline">Investigación · Software · Marketing</p>
        <div class="splash-progress-track">
          <div class="splash-progress-bar"></div>
        </div>
        <p class="splash-status">{{ title || 'Preparando tu espacio de trabajo…' }}</p>
      </div>
    </div>
  </transition>

  <!-- 2. MODO TOPBAR: Barra superior de carga entre rutas -->
  <transition name="topbar-fade">
    <div v-if="mode === 'topbar' && show" class="route-progress-bar" aria-hidden="true">
      <div class="route-progress-fill"></div>
    </div>
  </transition>

  <!-- 3. MODO MODULE: Pantalla / esqueleto de carga amigable dentro de cada módulo -->
  <div v-if="mode === 'module' && show" class="module-loader-container" role="status" aria-live="polite">
    <div class="module-loader-header">
      <div class="module-spinner-wrap">
        <div class="module-spinner-ring"></div>
        <span class="module-spinner-icon">{{ icon }}</span>
      </div>
      <div class="module-loader-texts">
        <h4 class="module-loader-title">{{ title }}</h4>
        <p v-if="subtitle" class="module-loader-sub">{{ subtitle }}</p>
      </div>
    </div>

    <!-- Variante Kanban: columnas con tarjetas esqueleto -->
    <div v-if="variant === 'kanban'" class="skeleton-kanban">
      <div v-for="col in 4" :key="col" class="skeleton-kanban-col">
        <div class="skeleton-col-head">
          <span class="sk-box sk-circle"></span>
          <span class="sk-box sk-line sk-w-60"></span>
          <span class="sk-box sk-pill"></span>
        </div>
        <div v-for="card in 3" :key="card" class="skeleton-kanban-card">
          <div class="sk-box sk-line sk-w-80"></div>
          <div class="sk-row">
            <span class="sk-box sk-line sk-w-40"></span>
            <span class="sk-box sk-line sk-w-30"></span>
          </div>
        </div>
      </div>
    </div>

    <!-- Variante Dashboard / Reportes: KPIs + Gráfico -->
    <div v-else-if="variant === 'dashboard'" class="skeleton-dashboard">
      <div class="skeleton-kpi-grid">
        <div v-for="i in 4" :key="i" class="skeleton-kpi-card">
          <span class="sk-box sk-line sk-w-50"></span>
          <span class="sk-box sk-title sk-w-70"></span>
          <span class="sk-box sk-line sk-w-40"></span>
        </div>
      </div>
      <div class="skeleton-charts-grid">
        <div class="skeleton-chart-panel">
          <span class="sk-box sk-line sk-w-40"></span>
          <div class="skeleton-bars">
            <span v-for="b in 6" :key="b" class="sk-bar" :style="{ height: (30 + ((b * 17) % 55)) + '%' }"></span>
          </div>
        </div>
        <div class="skeleton-chart-panel">
          <span class="sk-box sk-line sk-w-50"></span>
          <div class="skeleton-list-rows">
            <div v-for="r in 4" :key="r" class="sk-list-row">
              <span class="sk-box sk-circle"></span>
              <span class="sk-box sk-line sk-w-70"></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Variante Chat: lista de contactos + panel de conversación -->
    <div v-else-if="variant === 'chat'" class="skeleton-chat">
      <div class="skeleton-chat-sidebar">
        <div v-for="i in 5" :key="i" class="sk-chat-contact">
          <span class="sk-box sk-avatar"></span>
          <div class="sk-chat-lines">
            <span class="sk-box sk-line sk-w-70"></span>
            <span class="sk-box sk-line sk-w-50"></span>
          </div>
        </div>
      </div>
      <div class="skeleton-chat-main">
        <div class="sk-chat-bubble sk-in"></div>
        <div class="sk-chat-bubble sk-out"></div>
        <div class="sk-chat-bubble sk-in sk-w-60"></div>
      </div>
    </div>

    <!-- Variante Cards: grilla de tarjetas -->
    <div v-else-if="variant === 'cards'" class="skeleton-cards-grid">
      <div v-for="i in 6" :key="i" class="skeleton-card-item">
        <div class="sk-row">
          <span class="sk-box sk-avatar"></span>
          <div class="sk-chat-lines">
            <span class="sk-box sk-line sk-w-70"></span>
            <span class="sk-box sk-line sk-w-40"></span>
          </div>
        </div>
        <span class="sk-box sk-line sk-w-90"></span>
        <span class="sk-box sk-line sk-w-60"></span>
      </div>
    </div>

    <!-- Variante Table (por defecto): filas de tabla -->
    <div v-else class="skeleton-table">
      <div class="skeleton-table-head">
        <span v-for="c in 5" :key="c" class="sk-box sk-line sk-w-20"></span>
      </div>
      <div v-for="r in rows" :key="r" class="skeleton-table-row">
        <span class="sk-box sk-line sk-w-30"></span>
        <span class="sk-box sk-line sk-w-20"></span>
        <span class="sk-box sk-line sk-w-15"></span>
        <span class="sk-box sk-pill"></span>
        <span class="sk-box sk-line sk-w-15"></span>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  mode: {
    type: String,
    default: 'module' // 'splash' | 'topbar' | 'module'
  },
  show: {
    type: Boolean,
    default: true
  },
  variant: {
    type: String,
    default: 'table' // 'table' | 'kanban' | 'dashboard' | 'chat' | 'cards'
  },
  title: {
    type: String,
    default: 'Cargando información…'
  },
  subtitle: {
    type: String,
    default: 'Sincronizando datos en tiempo real con el servidor.'
  },
  icon: {
    type: String,
    default: '✨'
  },
  rows: {
    type: Number,
    default: 5
  }
});
</script>

<style scoped>
/* =========================================================================
   1. SPLASH SCREEN (PANTALLA DE CARGA INICIAL)
   ========================================================================= */
.app-splash-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-dark);
  background-image:
    radial-gradient(at 20% 20%, rgba(111, 129, 37, 0.14) 0px, transparent 55%),
    radial-gradient(at 80% 80%, rgba(200, 85, 50, 0.1) 0px, transparent 55%);
  backdrop-filter: blur(16px);
}

.splash-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2.5rem 3rem;
  border-radius: var(--radius-xl);
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-lg);
  max-width: 380px;
  width: 90%;
}

.splash-logo-ring {
  position: relative;
  width: 76px;
  height: 76px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.15rem;
}

.splash-orbit {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid var(--surface-3);
  border-top-color: var(--primary);
  border-right-color: var(--cta);
  animation: splash-spin 1.1s cubic-bezier(0.5, 0.15, 0.5, 0.85) infinite;
}

.splash-logo {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--accent-silver), var(--primary));
  color: #ffffff;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.35rem;
  letter-spacing: -0.03em;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 20px rgba(111, 129, 37, 0.35);
}

.splash-brand {
  font-family: var(--font-heading);
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-main);
  margin: 0;
}

.splash-tagline {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 0.25rem 0 1.25rem;
}

.splash-progress-track {
  width: 100%;
  height: 5px;
  background: var(--surface-3);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 0.85rem;
}

.splash-progress-bar {
  width: 45%;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--primary), var(--cta));
  animation: splash-indeterminate 1.4s ease-in-out infinite;
}

.splash-status {
  font-size: 0.8rem;
  color: var(--text-sub);
  margin: 0;
}

/* =========================================================================
   2. TOP ROUTE PROGRESS BAR
   ========================================================================= */
.route-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 9998;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
}

.route-progress-fill {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, var(--primary), var(--cta), var(--primary));
  background-size: 200% 100%;
  animation: route-bar-slide 1s linear infinite;
  box-shadow: 0 0 10px var(--primary);
}

/* =========================================================================
   3. MODULE SKELETON LOADER
   ========================================================================= */
.module-loader-container {
  display: flex;
  flex-direction: column;
  gap: 1.15rem;
  padding: 1.35rem;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  margin: 0.25rem 0;
}

.module-loader-header {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.module-spinner-wrap {
  position: relative;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.module-spinner-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid var(--surface-3);
  border-top-color: var(--primary);
  animation: splash-spin 0.9s linear infinite;
}

.module-spinner-icon {
  font-size: 1.05rem;
}

.module-loader-texts {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.module-loader-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-main);
}

.module-loader-sub {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

/* Shimmer base */
.sk-box {
  display: inline-block;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--surface-2) 25%,
    var(--surface-4) 50%,
    var(--surface-2) 75%
  );
  background-size: 200% 100%;
  animation: sk-shimmer 1.5s infinite;
}

.sk-line { height: 11px; }
.sk-title { height: 22px; border-radius: 8px; }
.sk-circle { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; }
.sk-avatar { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; }
.sk-pill { width: 52px; height: 20px; border-radius: 999px; }

.sk-w-15 { width: 15%; }
.sk-w-20 { width: 20%; }
.sk-w-30 { width: 30%; }
.sk-w-40 { width: 40%; }
.sk-w-50 { width: 50%; }
.sk-w-60 { width: 60%; }
.sk-w-70 { width: 70%; }
.sk-w-80 { width: 80%; }
.sk-w-90 { width: 90%; }

.sk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

/* Kanban Skeleton */
.skeleton-kanban {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.85rem;
}

.skeleton-kanban-col {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.skeleton-col-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid var(--border-color);
}

.skeleton-kanban-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* Dashboard Skeleton */
.skeleton-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.skeleton-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.skeleton-kpi-card {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.skeleton-charts-grid {
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 0.85rem;
}

.skeleton-chart-panel {
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-height: 170px;
}

.skeleton-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  flex: 1;
  gap: 0.6rem;
  padding-top: 0.5rem;
}

.sk-bar {
  flex: 1;
  max-width: 32px;
  border-radius: 6px 6px 0 0;
  background: linear-gradient(180deg, var(--surface-4), var(--surface-2));
  animation: sk-pulse 1.4s ease-in-out infinite;
}

.skeleton-list-rows {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin-top: 0.25rem;
}

.sk-list-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

/* Table Skeleton */
.skeleton-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.skeleton-table-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-color);
}

.skeleton-table-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.skeleton-table-row:last-child {
  border-bottom: none;
}

/* Chat Skeleton */
.skeleton-chat {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 0.85rem;
  min-height: 240px;
}

.skeleton-chat-sidebar {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sk-chat-contact {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.sk-chat-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.skeleton-chat-main {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
  background: var(--surface-1);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  justify-content: center;
}

.sk-chat-bubble {
  height: 38px;
  border-radius: 12px;
  width: 48%;
  background: var(--surface-3);
  animation: sk-pulse 1.4s ease-in-out infinite;
}

.sk-chat-bubble.sk-out {
  align-self: flex-end;
  background: rgba(111, 129, 37, 0.16);
}

/* Cards Skeleton */
.skeleton-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.85rem;
}

.skeleton-card-item {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
  background: var(--surface-1);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

/* Animations */
@keyframes splash-spin {
  to { transform: rotate(360deg); }
}

@keyframes splash-indeterminate {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(60%); }
  100% { transform: translateX(220%); }
}

@keyframes route-bar-slide {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@keyframes sk-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.loader-fade-enter-active,
.loader-fade-leave-active {
  transition: opacity 0.28s ease;
}
.loader-fade-enter-from,
.loader-fade-leave-to {
  opacity: 0;
}

.topbar-fade-enter-active,
.topbar-fade-leave-active {
  transition: opacity 0.18s ease;
}
.topbar-fade-enter-from,
.topbar-fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .skeleton-charts-grid,
  .skeleton-chat {
    grid-template-columns: 1fr;
  }
}
</style>

