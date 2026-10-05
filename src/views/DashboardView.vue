<template>
  <div class="dashboard-container">
    <!-- Welcome Banner Card -->
    <div class="welcome-banner">
      <div class="welcome-content">
        <h1 class="welcome-title">
          {{ welcomeName }}, te damos la bienvenida 🥳
        </h1>
        <p class="welcome-text">
          Tienes <strong>{{ pendingCommunicationsCount }}</strong> comunicaciones pendientes para hoy, te recomendamos revisarlas.
        </p>
        <router-link v-if="pendingCommunicationsCount > 0" to="/admin/leads" class="welcome-cta">
          Ver comunicaciones pendientes →
        </router-link>
      </div>

      <div class="welcome-illustration-wrapper">
        <img src="/images/welcome_dashboard.jpg" alt="Avantage Workspace" class="welcome-img" />
      </div>
    </div>

    <!-- Communications Section -->
    <div class="section-card">
      <div class="section-header">
        <h2 class="section-title">Comunicaciones Pendientes</h2>
        <span class="count-pill">{{ pendingCommunicationsCount }}</span>
      </div>

      <div class="section-body">
        <div v-if="pendingCommunicationsCount === 0" class="empty-state">
          <div class="empty-state-visual">
            <img src="/images/empty_inbox.jpg" alt="Bandeja al día" class="empty-state-photo" />
          </div>
          <p class="empty-title">¡Todo al día! No hay comunicaciones pendientes por atender</p>
          <p class="empty-subtitle">Tu bandeja de entrada está despejada. Nuevos prospectos de tesis, mensajes y solicitudes aparecerán aquí.</p>
        </div>
        <div v-else class="communications-list">
          <div v-for="comm in pendingCommunications" :key="comm.id" class="comm-item">
            <div class="comm-avatar">💬</div>
            <div class="comm-info">
              <div class="comm-name">{{ comm.topic }}</div>
              <div class="comm-meta">{{ comm.lead_name }} — {{ comm.email }}</div>
            </div>
            <router-link to="/admin/leads" class="btn-sm-action">Atender</router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Access Modules & Tools Grid -->
    <div class="modules-grid-header">
      <h3 class="grid-title">Módulos Habilitados</h3>
    </div>

    <div class="modules-grid">
      <router-link
        v-for="tool in availableTools"
        :key="tool.key"
        :to="tool.to"
        class="module-card"
      >
        <div class="module-icon-bg" :class="tool.tintClass">{{ tool.icon }}</div>
        <div class="module-content">
          <h4 class="module-label">{{ tool.label }}</h4>
          <p class="module-desc">{{ tool.description }}</p>
        </div>
        <div class="module-arrow">→</div>
      </router-link>

      <div v-if="availableTools.length === 0" class="empty-tools-card">
        Tu rol no tiene herramientas asignadas todavía. Solicita acceso a un administrador.
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { authState, hasPermission } from '../auth.js';

const pendingCommunications = ref([]);

const welcomeName = computed(() => {
  if (authState.user?.name) {
    return authState.user.name.split(' ')[0];
  }
  return 'Avantage';
});

const pendingCommunicationsCount = computed(() => pendingCommunications.value.length);

const TOOLS = [
  { key: 'leads.view', label: 'Funnel de Leads', description: 'Gestión comercial de candidatos y clientes en tablero Kanban', icon: '📇', to: '/admin/leads', tintClass: 'tint-amber' },
  { key: 'setter.view', label: 'Setter Funnel', description: 'Triaje de leads y conversaciones de WhatsApp, Facebook e Instagram', icon: '🎯', to: '/admin/setter-funnel', tintClass: 'tint-pink' },
  { key: 'instagram.view', label: 'Instagram', description: 'Comentarios, DMs, menciones e interacciones de Instagram Business', icon: '📸', to: '/admin/instagram', tintClass: 'tint-purple' },
  { key: 'projects.view', label: 'Proyectos & Avances', description: 'Gestión de proyectos, entregables, cronogramas y tareas', icon: '🚀', to: '/admin/projects', tintClass: 'tint-rose' },
  { key: 'finance.view', label: 'Finanzas', description: 'Registro y visualización de ingresos y egresos del negocio', icon: '💰', to: '/admin/finance', tintClass: 'tint-amber' },
  { key: 'roles.manage', label: 'Roles y Permisos', description: 'Administración de usuarios, roles de acceso y herramientas', icon: '🔐', to: '/admin/roles', tintClass: 'tint-blue' }
];

const availableTools = computed(() => TOOLS.filter(tool => hasPermission(tool.key)));

async function fetchDashboardStats() {
  try {
    if (authState.token) {
      const res = await fetch('/api/leads', {
        headers: { 'Authorization': `Bearer ${authState.token}` }
      });
      if (res.ok) {
        const leads = await res.json();
        // Pending leads in initial status (nuevo or contactado)
        pendingCommunications.value = leads.filter(l => l.status === 'nuevo');
      }
    }
  } catch (err) {
    console.warn('Dashboard stats fetch:', err);
  }
}

onMounted(() => {
  fetchDashboardStats();
});
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Welcome Banner matching exact image layout */
.welcome-banner {
  background-color: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  padding: 2.25rem 2.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.welcome-content {
  max-width: 60%;
  z-index: 2;
}

.welcome-title {
  font-family: var(--font-heading);
  font-size: 1.9rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-main);
  margin-bottom: 0.6rem;
  line-height: 1.2;
}

.welcome-text {
  font-size: 0.925rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.welcome-text strong {
  color: var(--text-main);
  font-weight: 700;
}

.welcome-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 1.1rem;
  background: var(--primary);
  color: #ffffff;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.6rem 1.2rem;
  border-radius: 9999px;
  text-decoration: none;
  box-shadow: 0 8px 20px -6px rgba(111, 129, 37, 0.5);
  transition: all 0.2s ease;
}

.welcome-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px -6px rgba(111, 129, 37, 0.6);
}

.welcome-illustration-wrapper {
  width: 240px;
  height: 155px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border-color);
  background: var(--surface-1);
}

.welcome-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.3s ease;
}

.welcome-banner:hover .welcome-img {
  transform: scale(1.03);
}

/* Section Cards matching reference image */
.section-card {
  background-color: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-sm);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.section-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-main);
}

.count-pill {
  background: rgba(111, 129, 37, 0.12);
  color: var(--on-tint-strong);
  border: 1px solid rgba(111, 129, 37, 0.3);
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
}

.section-body {
  min-height: 100px;
}

.empty-state {
  padding: 2rem 1.5rem;
  text-align: center;
  background-color: var(--surface-1);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.empty-state-visual {
  width: 140px;
  height: 140px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: 1rem;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.empty-state-photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.empty-title {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-main);
  margin-bottom: 0.35rem;
}

.empty-subtitle {
  font-size: 0.85rem;
  color: var(--text-muted);
  max-width: 480px;
  line-height: 1.45;
}

.communications-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.comm-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: var(--surface-1);
  border: 1px solid var(--border-color);
  padding: 0.85rem 1.1rem;
  border-radius: 10px;
}

.comm-avatar {
  font-size: 1.5rem;
}

.comm-info {
  flex: 1;
}

.comm-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-main);
}

.comm-meta {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.btn-sm-action {
  background: var(--primary);
  color: #ffffff;
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 600;
}

/* Modules Grid */
.modules-grid-header {
  margin-top: 0.5rem;
}

.grid-title {
  font-family: var(--font-heading);
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.modules-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.25rem;
}

.module-card {
  background-color: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 1rem;
  transition: all 0.25s ease;
  position: relative;
}

.module-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  background-color: var(--bg-card-hover);
}

.module-icon-bg {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  flex-shrink: 0;
  border: 1px solid transparent;
}

.module-icon-bg.tint-amber { background: rgba(222, 117, 75, 0.12); border-color: rgba(222, 117, 75, 0.25); }
.module-icon-bg.tint-pink { background: rgba(138, 63, 40, 0.12); border-color: rgba(138, 63, 40, 0.25); }
.module-icon-bg.tint-purple { background: rgba(111, 129, 37, 0.12); border-color: rgba(111, 129, 37, 0.25); }
.module-icon-bg.tint-rose { background: rgba(200, 85, 50, 0.12); border-color: rgba(200, 85, 50, 0.25); }
.module-icon-bg.tint-blue { background: rgba(107, 122, 94, 0.12); border-color: rgba(107, 122, 94, 0.25); }

.module-content {
  flex: 1;
}

.module-label {
  font-family: var(--font-heading);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: 0.25rem;
}

.module-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.35;
}

.module-arrow {
  color: var(--text-muted);
  font-size: 1.2rem;
  transition: transform 0.2s ease, color 0.2s ease;
}

.module-card:hover .module-arrow {
  color: var(--primary);
  transform: translateX(4px);
}

.empty-tools-card {
  grid-column: 1 / -1;
  background-color: var(--bg-card-solid);
  border: 1px dashed var(--border-strong);
  padding: 2rem;
  border-radius: 14px;
  text-align: center;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .welcome-banner {
    flex-direction: column;
    gap: 1.5rem;
    text-align: center;
  }

  .welcome-content {
    max-width: 100%;
  }

  .welcome-illustration-wrapper {
    width: 180px;
    height: 120px;
  }
}
</style>
