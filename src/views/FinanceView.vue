<template>
  <main class="container-fluid finance-page">
    <header class="finance-header">
      <div class="finance-header-titles">
        <div class="finance-badge-eyebrow">
          <span class="finance-badge-dot"></span>
          <span>Gestión Contable & Tesorería</span>
        </div>
        <h1 class="finance-title">
          <span class="finance-title-icon">📊</span>
          <span>Finanzas & Flujo de Caja</span>
        </h1>
        <p class="finance-subtitle">
          Control integral de ingresos verificados, movimientos operativos diarios y previsión de gastos fijos.
        </p>
      </div>

      <div class="finance-header-actions">
        <button
          type="button"
          class="finance-btn-secondary"
          @click="navigateAndOpen('journal')"
          title="Registrar nuevo movimiento operativo en el libro diario"
        >
          <span class="btn-icon">✍️</span>
          <span>+ Asiento diario</span>
        </button>
        <button
          type="button"
          class="finance-btn-primary"
          @click="navigateAndOpen('income')"
          title="Registrar cobro o cuota de cliente"
        >
          <span class="btn-icon">💰</span>
          <span>+ Registrar ingreso</span>
        </button>
      </div>
    </header>

    <!-- Modern Segmented Tab Navigation -->
    <nav class="finance-nav-bar" aria-label="Secciones de finanzas">
      <div class="finance-segmented-nav">
        <button
          v-for="tab in TABS"
          :key="tab.key"
          type="button"
          class="finance-nav-item"
          :class="{ 'is-active': activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="nav-item-icon">{{ tab.icon }}</span>
          <span class="nav-item-label">{{ tab.label }}</span>
        </button>
      </div>
    </nav>

    <!-- Active Tab Component -->
    <transition name="tab-fade" mode="out-in">
      <keep-alive>
        <component
          :is="activeComponent"
          :key="activeTab"
          :open-form-trigger="tabTrigger[activeTab]"
          @navigate-tab="handleNavigateTab"
        />
      </keep-alive>
    </transition>
  </main>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import OverviewTab from './finance/OverviewTab.vue';
import IncomeTab from './finance/IncomeTab.vue';
import JournalTab from './finance/JournalTab.vue';
import FixedExpensesTab from './finance/FixedExpensesTab.vue';
import SalariesTab from './finance/SalariesTab.vue';
import CommissionsTab from './finance/CommissionsTab.vue';

const TABS = [
  { key: 'overview', label: 'Resumen Financiero', icon: '📊', component: OverviewTab },
  { key: 'income', label: 'Ingresos y Cierres', icon: '📥', component: IncomeTab },
  { key: 'journal', label: 'Libro Diario', icon: '📖', component: JournalTab },
  { key: 'fixed', label: 'Gastos Fijos', icon: '🏢', component: FixedExpensesTab },
  { key: 'salaries', label: 'Salarios', icon: '🧾', component: SalariesTab },
  // Al lado de Salarios a propósito: la comisión se devenga acá y se paga allá.
  { key: 'commissions', label: 'Comisiones', icon: '💰', component: CommissionsTab }
];

const activeTab = ref('overview');
const tabTrigger = reactive({
  income: 0,
  journal: 0,
  fixed: 0,
  salaries: 0
});

const activeComponent = computed(() => TABS.find((t) => t.key === activeTab.value)?.component);

function handleNavigateTab(tabKey) {
  if (TABS.some((t) => t.key === tabKey)) {
    activeTab.value = tabKey;
  }
}

function navigateAndOpen(tabKey) {
  activeTab.value = tabKey;
  tabTrigger[tabKey] = (tabTrigger[tabKey] || 0) + 1;
}
</script>

<style scoped>
.finance-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: 100%;
  box-sizing: border-box;
}

/* Header */
.finance-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-bottom: 0.25rem;
}

.finance-header-titles {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.finance-badge-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--primary);
  background: rgba(111, 129, 37, 0.08);
  border: 1px solid rgba(111, 129, 37, 0.18);
  padding: 0.2rem 0.6rem;
  border-radius: 9999px;
  width: fit-content;
}

.finance-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 6px var(--primary);
}

.finance-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.65rem;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.finance-title-icon {
  font-size: 1.45rem;
}

.finance-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  max-width: 600px;
  line-height: 1.5;
}

.finance-header-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.finance-btn-primary,
.finance-btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.finance-btn-primary {
  background: var(--primary);
  color: #ffffff;
  border: 1px solid var(--primary);
  box-shadow: 0 2px 8px rgba(111, 129, 37, 0.25);
}

.finance-btn-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(111, 129, 37, 0.35);
}

.finance-btn-secondary {
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}

.finance-btn-secondary:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-strong);
  color: var(--primary);
  transform: translateY(-1px);
}

/* Modern Segmented Navigation Bar */
.finance-nav-bar {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.75rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.finance-nav-bar::-webkit-scrollbar {
  display: none;
}

.finance-segmented-nav {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--surface-2);
  padding: 0.28rem;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
}

.finance-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-body);
  font-size: 0.83rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
}

.finance-nav-item:hover {
  color: var(--text-main);
  background: rgba(16, 20, 20, 0.04);
}

.finance-nav-item.is-active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  font-weight: 600;
  border-color: var(--border-color);
  box-shadow: 0 2px 8px rgba(16, 20, 20, 0.08);
}

.nav-item-icon {
  font-size: 0.95rem;
}

/* Tab transition */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .finance-page {
    padding: 0.75rem;
    gap: 1rem;
  }

  .finance-header {
    flex-direction: column;
    align-items: stretch;
  }

  .finance-header-actions {
    width: 100%;
    justify-content: stretch;
  }

  .finance-btn-primary,
  .finance-btn-secondary {
    flex: 1;
    justify-content: center;
  }

  .finance-segmented-nav {
    width: 100%;
    overflow-x: auto;
  }
}
</style>

