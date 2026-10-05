<template>
  <section class="ledger-tab">
    <p class="ledger-hint">
      Dos comisiones del <strong>2%</strong>: la de la <strong>setter</strong>, por cada venta que
      el closer cerró con un lead que ella le pasó (sobre el precio total, al ganarse el lead), y la
      de <strong>cobranza</strong>, por cada cuota cobrada desde el módulo de Cobranzas (sobre lo
      que entró). Es lo que se <strong>debe</strong>: el pago en sí se anota después en
      <strong>Salarios</strong>, así que estas filas no entran en el resumen financiero ni en el
      libro diario.
    </p>

    <div class="ledger-controls">
      <label class="ledger-search">
        <span class="ledger-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="ledger-search-input"
          placeholder="Buscar por persona, cliente o tema"
          aria-label="Buscar comisiones"
        />
      </label>
      <select v-model="estadoFilter" class="ledger-filter" aria-label="Filtrar por estado">
        <option value="">Todo estado</option>
        <option value="pendiente">Por pagar</option>
        <option value="pagado">Pagada</option>
      </select>
      <button type="button" class="btn-secondary ledger-add-btn" @click="load" :disabled="isLoading">
        {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>

    <div class="commission-totals">
      <div class="commission-total-card">
        <span class="commission-total-label">Por pagar</span>
        <span class="commission-total-value">S/ {{ formatAmount(summary.pendiente.total) }}</span>
        <span class="commission-total-note">{{ summary.pendiente.n }} comisión(es)</span>
      </div>
      <div class="commission-total-card is-paid">
        <span class="commission-total-label">Ya pagado</span>
        <span class="commission-total-value">S/ {{ formatAmount(summary.pagado.total) }}</span>
        <span class="commission-total-note">{{ summary.pagado.n }} comisión(es)</span>
      </div>
    </div>

    <div v-if="!isLoading && visible.length === 0" class="empty-state">
      <p class="empty-state-title">Todavía no hay comisiones</p>
      <p class="empty-state-text">
        La de la setter nace sola al ganarse un lead que pasó por el Setter Funnel y tiene precio
        total registrado; la de cobranza, al marcar una cuota como cobrada en Cobranzas.
      </p>
    </div>

    <div v-else class="data-table-wrapper ledger-table-wrapper">
      <table class="data-table ledger-table">
        <thead>
          <tr>
            <th>Para</th>
            <th>Venta</th>
            <th class="ledger-num">Base</th>
            <th class="ledger-num">%</th>
            <th class="ledger-num">Comisión</th>
            <th>Estado</th>
            <th>Registrada</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id">
            <td>
              <span class="ledger-eyebrow">{{ ROLE_LABEL[row.role] || row.role }}</span>
              <span class="ledger-stack-main">{{ row.beneficiario }}</span>
            </td>
            <td>
              <span class="ledger-stack-main">{{ row.cliente || 'Sin nombre' }}</span>
              <span class="ledger-eyebrow">
                <template v-if="row.income_code">Cobro de {{ row.income_code }} · {{ row.income_cuota || 'cuota' }}</template>
                <template v-else>Venta completa · Lead #{{ row.lead_id }}</template>
              </span>
            </td>
            <td class="ledger-num"><span class="ledger-amount">{{ formatAmount(row.base_amount) }}</span></td>
            <td class="ledger-num">{{ Number(row.percent) }}%</td>
            <td class="ledger-num"><strong class="ledger-amount">{{ formatAmount(row.monto) }}</strong></td>
            <td>
              <button
                type="button"
                class="pill"
                :class="row.estado === 'pendiente' ? 'pill-warning' : 'pill-success'"
                :disabled="savingId === row.id"
                :title="row.estado === 'pendiente' ? 'Marcar como pagada' : 'Volver a por pagar'"
                @click="toggleEstado(row)"
              >
                {{ row.estado === 'pendiente' ? 'Por pagar' : `Pagada ${formatDate(row.paid_at)}` }}
              </button>
            </td>
            <td class="ledger-date">{{ formatDate(row.created_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { formatAmount, formatDate } from './format.js';
import './ledger.css';

/* De dónde sale cada comisión: la de la setter es por venta, la de cobranza
   por cuota cobrada. */
const ROLE_LABEL = { setter: 'Setter', cobranza: 'Cobranza' };

const rows = ref([]);
const summary = reactive({ pendiente: { total: 0, n: 0 }, pagado: { total: 0, n: 0 } });
const isLoading = ref(false);
const errorMessage = ref('');
const savingId = ref(null);
const search = ref('');
const estadoFilter = ref('');

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (estadoFilter.value && row.estado !== estadoFilter.value) return false;
    if (!q) return true;
    return [row.beneficiario, row.cliente, row.tema, row.detalle]
      .some((campo) => String(campo || '').toLowerCase().includes(q));
  });
});

async function load() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/commissions');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las comisiones.');
    rows.value = data.commissions || [];
    Object.assign(summary, data.summary || {});
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Marcar pagada no mueve plata: deja constancia de que ya se le abonó (el
 * egreso se registra en Salarios). Por eso se puede deshacer.
 */
async function toggleEstado(row) {
  savingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/commissions/${row.id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: row.estado === 'pendiente' ? 'pagado' : 'pendiente' })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado.');
    Object.assign(row, data.commission);
    await load();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.commission-totals {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.9rem;
  flex-wrap: wrap;
}

.commission-total-card {
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-amber);
  border-radius: var(--radius-md);
  background: var(--bg-card-solid);
}

.commission-total-card.is-paid { border-left-color: var(--accent-emerald); }

.commission-total-label { font-size: 0.72rem; color: var(--text-muted); }
.commission-total-value { font-size: 1.1rem; font-weight: 700; color: var(--text-main); }
.commission-total-note { font-size: 0.7rem; color: var(--text-muted); }
</style>
