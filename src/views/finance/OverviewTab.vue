<template>
  <section class="overview-dashboard">
    <!-- Top Controls Toolbar -->
    <div class="ov-top-bar">
      <div class="ov-title-group">
        <h2 class="ov-title">Visión General de Tesorería</h2>
        <p class="ov-subtitle">
          Consolidado en tiempo real, en soles: ingresos verificados menos asientos del libro diario,
          salarios y comisiones ya pagados, y el ITF que cobró el banco. Los saldos son de todas las cuentas; el rango de meses
          solo recorta la gráfica de evolución.
        </p>
      </div>

      <div class="ov-actions">
        <!-- Period range selector -->
        <div class="ov-segmented-control" role="group" aria-label="Rango de tiempo">
          <button
            v-for="opt in RANGE_OPTIONS"
            :key="opt"
            type="button"
            class="ov-segment-btn"
            :class="{ 'is-active': months === opt }"
            @click="setRange(opt)"
          >
            {{ opt }} meses
          </button>
        </div>

        <button
          type="button"
          class="ov-refresh-btn"
          title="Actualizar datos"
          :disabled="isLoading"
          @click="fetchOverview"
        >
          <span :class="{ 'is-spinning': isLoading }">↻</span>
        </button>
      </div>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>

    <!-- 4 KPI Cards (Money T Style) -->
    <section class="kpi-grid">
      <!-- KPI 1: Ingresos -->
      <div class="kpi-card kpi-card-income">
        <div class="kpi-card-top">
          <span class="kpi-card-label">Ingresos Totales</span>
          <span class="kpi-pill kpi-pill-emerald">
            <span class="kpi-pill-arrow">↑</span> Verificado
          </span>
        </div>
        <div class="kpi-card-value">
          <span class="kpi-cur">S/</span> {{ fmt(data.totals.ingresos) }}
        </div>
        <div class="kpi-card-footer">
          <span class="kpi-hint">Todo lo cobrado y verificado en cuentas</span>
        </div>
      </div>

      <!-- KPI 2: Egresos -->
      <div class="kpi-card kpi-card-expense">
        <div class="kpi-card-top">
          <span class="kpi-card-label">Egresos Totales</span>
          <span class="kpi-pill kpi-pill-amber">
            <span class="kpi-pill-arrow">↓</span> Salidas
          </span>
        </div>
        <div class="kpi-card-value">
          <span class="kpi-cur">S/</span> {{ fmt(data.totals.egresos) }}
        </div>
        <!--
          Desglosado y no solo sumado: este total mezcla el libro diario,
          Salarios, Comisiones y el ITF que cobra el banco, así que sin el
          desglose "¿por qué subió?" solo se contesta revisando todo a mano.
        -->
        <div class="kpi-card-footer">
          <span class="kpi-breakdown">
            <span>Libro <b>S/ {{ fmtShort(data.totals.egresosPorOrigen.libro) }}</b></span>
            <span>Salarios <b>S/ {{ fmtShort(data.totals.egresosPorOrigen.salarios) }}</b></span>
            <span>Comisiones <b>S/ {{ fmtShort(data.totals.egresosPorOrigen.comisiones) }}</b></span>
            <span>ITF <b>S/ {{ fmtShort(data.totals.egresosPorOrigen.itf) }}</b></span>
          </span>
        </div>
      </div>

      <!-- KPI 3: Balance Operativo -->
      <div class="kpi-card kpi-card-balance">
        <div class="kpi-card-top">
          <span class="kpi-card-label">Balance Neto en Caja</span>
          <span
            class="kpi-pill"
            :class="data.totals.balance >= 0 ? 'kpi-pill-cyan' : 'kpi-pill-rose'"
          >
            {{ data.totals.balance >= 0 ? '↑ Superávit' : '↓ Déficit' }}
          </span>
        </div>
        <div
          class="kpi-card-value"
          :class="data.totals.balance >= 0 ? 'text-positive' : 'text-negative'"
        >
          <span class="kpi-cur">S/</span> {{ fmt(data.totals.balance) }}
        </div>
        <div class="kpi-card-footer">
          <span class="kpi-hint">Saldo acumulado de todas las cuentas</span>
        </div>
      </div>

      <!-- KPI 4: Movimientos / Cierres -->
      <div class="kpi-card kpi-card-transactions">
        <div class="kpi-card-top">
          <span class="kpi-card-label">Total Transacciones</span>
          <span class="kpi-pill kpi-pill-purple">
            Histórico
          </span>
        </div>
        <div class="kpi-card-value">
          {{ data.totals.totalTransactions || 0 }}
          <span class="kpi-unit">movs</span>
        </div>
        <div class="kpi-card-footer">
          <span class="kpi-hint">Cobros, asientos, salarios y comisiones</span>
        </div>
      </div>
    </section>

    <!--
      Lo devengado y sin pagar. Va en una banda aparte y NO descontado del
      balance, porque esta pantalla cuenta dinero confirmado y un salario
      pendiente sigue en la cuenta. Pero tiene que estar a la vista: un balance
      en verde con media planilla sin pagar es el número que hace tomar la
      decisión equivocada. Solo aparece si hay algo pendiente.
    -->
    <section v-if="data.totals.pendientes.total > 0" class="ov-pending-band">
      <span class="ov-pending-label">⏳ Por pagar</span>
      <span v-if="data.totals.pendientes.salarios" class="ov-pending-item">
        Salarios <b>S/ {{ fmt(data.totals.pendientes.salarios) }}</b>
      </span>
      <span v-if="data.totals.pendientes.comisiones" class="ov-pending-item">
        Comisiones <b>S/ {{ fmt(data.totals.pendientes.comisiones) }}</b>
      </span>
      <span class="ov-pending-total">
        Total <b>S/ {{ fmt(data.totals.pendientes.total) }}</b>
      </span>
      <span class="ov-pending-note">No está descontado del balance: todavía no salió de ninguna cuenta.</span>
    </section>

    <!-- Loading / Empty states -->
    <div v-if="isLoading && !data.months.length" class="empty-state">
      <p>Cargando información financiera...</p>
    </div>
    <div v-else-if="isEmpty" class="empty-state">
      <p class="empty-state-title">Sin movimientos registrados en este período</p>
      <p class="empty-state-text">
        Registra ingresos o asientos del libro diario para visualizar las gráficas y el estado de cuentas.
      </p>
      <button
        type="button"
        class="btn-primary"
        style="margin-top: 1rem;"
        @click="$emit('navigate-tab', 'income')"
      >
        + Registrar primer ingreso
      </button>
    </div>

    <!-- Main Dashboard Body (Grid 2x2) -->
    <div v-else class="ov-main-grid">
      <!-- Section 1: Flujo de Caja ("Your Assets" Style Chart) -->
      <section class="glass-panel ov-section ov-chart-section">
        <div class="ov-section-header">
          <div>
            <h3 class="ov-section-title">Flujo de Fondos (Ingresos vs Egresos)</h3>
            <p class="ov-section-sub">Evolución de los últimos {{ months }} meses</p>
          </div>

          <div class="ov-chart-controls">
            <!-- Legend -->
            <div class="chart-legend-pills">
              <span class="legend-pill is-income">
                <span class="legend-dot dot-income"></span> Ingresos
              </span>
              <span class="legend-pill is-expense">
                <span class="legend-dot dot-expense"></span> Egresos
              </span>
            </div>

            <!-- View mode: Curvas vs Barras -->
            <div class="ov-view-toggle">
              <button
                type="button"
                class="view-toggle-btn"
                :class="{ 'is-active': chartMode === 'spline' }"
                title="Vista de curvas suaves"
                @click="chartMode = 'spline'"
              >
                〰️ Curvas
              </button>
              <button
                type="button"
                class="view-toggle-btn"
                :class="{ 'is-active': chartMode === 'bars' }"
                title="Vista de barras"
                @click="chartMode = 'bars'"
              >
                📊 Barras
              </button>
            </div>
          </div>
        </div>

        <!-- Interactive SVG Chart Area -->
        <div
          class="chart-container"
          ref="chartContainerRef"
          @mousemove="onChartMouseMove"
          @mouseleave="onChartMouseLeave"
        >
          <!--
            Área + línea, en píxeles reales: el viewBox sigue al ancho medido
            del contenedor, así un trazo de 2 px mide 2 px y un punto es
            redondo. Con el viewBox fijo de antes, estirado al ancho de la
            tarjeta, los círculos salían ovalados y los números del eje
            estrechos.
          -->
          <svg
            v-if="chartMode === 'spline'"
            :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
            class="interactive-svg-chart"
            role="img"
            :aria-label="`Ingresos y egresos de los últimos ${months} meses`"
          >
            <defs>
              <linearGradient id="incomeAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" :stop-color="SERIES.income" stop-opacity="0.14" />
                <stop offset="100%" :stop-color="SERIES.income" stop-opacity="0" />
              </linearGradient>
              <linearGradient id="expenseAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" :stop-color="SERIES.expense" stop-opacity="0.14" />
                <stop offset="100%" :stop-color="SERIES.expense" stop-opacity="0" />
              </linearGradient>
            </defs>

            <!-- Rejilla: línea fina y CONTINUA. Punteada se lee como un umbral
                 o una proyección, y acá es solo una guía. -->
            <g class="grid-lines">
              <line
                v-for="tick in yTicks"
                :key="`grid-${tick.value}`"
                :x1="plot.left"
                :y1="tick.y"
                :x2="plot.right + 8"
                :y2="tick.y"
                stroke="var(--border-color)"
                stroke-width="1"
                :opacity="tick.value === 0 ? 0.9 : 0.45"
              />
            </g>

            <g class="y-labels">
              <text
                v-for="tick in yTicks"
                :key="`tick-${tick.value}`"
                :x="plot.left - 10"
                :y="tick.y + 3.5"
                text-anchor="end"
                class="chart-axis-text"
              >{{ tick.value === 0 ? 'S/ 0' : `S/ ${fmtShort(tick.value)}` }}</text>
            </g>

            <!-- Meses, dentro del mismo SVG: así quedan exactamente bajo su
                 punto en vez de repartidos por una fila de divs aparte. -->
            <g class="x-labels">
              <text
                v-for="(pt, idx) in incomePoints"
                :key="`x-${idx}`"
                :x="pt.x"
                :y="plot.bottom + 22"
                text-anchor="middle"
                class="chart-axis-text"
                :class="{ 'is-hovered': hoverIdx === idx }"
              >{{ monthLabel(data.months[idx]) }}</text>
            </g>

            <path :d="incomeAreaPath" fill="url(#incomeAreaGrad)" />
            <path :d="expenseAreaPath" fill="url(#expenseAreaGrad)" />

            <path
              :d="incomeLinePath"
              fill="none"
              :stroke="SERIES.income"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              :d="expenseLinePath"
              fill="none"
              :stroke="SERIES.expense"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <!-- Puntos con anillo del color de la tarjeta: es lo que los deja
                 legibles donde una línea cruza a la otra. -->
            <circle
              v-for="(pt, idx) in incomePoints"
              :key="`inc-pt-${idx}`"
              :cx="pt.x"
              :cy="pt.y"
              r="4"
              :fill="SERIES.income"
              stroke="var(--bg-card-solid)"
              stroke-width="2"
            />
            <circle
              v-for="(pt, idx) in expensePoints"
              :key="`exp-pt-${idx}`"
              :cx="pt.x"
              :cy="pt.y"
              r="4"
              :fill="SERIES.expense"
              stroke="var(--bg-card-solid)"
              stroke-width="2"
            />

            <!-- El último valor de cada línea, escrito. Es la única cifra que
                 se lee sin pasar el mouse. -->
            <text
              v-for="label in endLabels"
              :key="`end-${label.key}`"
              :x="label.x"
              :y="label.y"
              class="chart-end-label"
            >{{ fmtShort(label.value) }}</text>

            <!-- Cruceta del hover -->
            <g v-if="hoverIdx !== null && incomePoints[hoverIdx]">
              <line
                :x1="incomePoints[hoverIdx].x"
                :y1="plot.top"
                :x2="incomePoints[hoverIdx].x"
                :y2="plot.bottom"
                stroke="var(--text-muted)"
                stroke-width="1"
                opacity="0.55"
              />
              <circle
                :cx="incomePoints[hoverIdx].x"
                :cy="incomePoints[hoverIdx].y"
                r="6"
                :fill="SERIES.income"
                stroke="var(--bg-card-solid)"
                stroke-width="2.5"
              />
              <circle
                :cx="expensePoints[hoverIdx].x"
                :cy="expensePoints[hoverIdx].y"
                r="6"
                :fill="SERIES.expense"
                stroke="var(--bg-card-solid)"
                stroke-width="2.5"
              />
            </g>
          </svg>

          <!-- Grouped Bars View (Alternative) -->
          <div v-else class="bars-chart-view">
            <div
              v-for="(month, idx) in data.months"
              :key="'bar-' + month"
              class="bar-group"
              :class="{ 'is-hovered': hoverIdx === idx }"
              @mouseenter="hoverIdx = idx"
            >
              <div class="bars-pair">
                <div
                  class="bar-single bar-income"
                  :style="{ height: getBarHeight(monthlyTotals[idx]?.income) }"
                  :title="`Ingresos: S/ ${fmt(monthlyTotals[idx]?.income)}`"
                ></div>
                <div
                  class="bar-single bar-expense"
                  :style="{ height: getBarHeight(monthlyTotals[idx]?.expense) }"
                  :title="`Egresos: S/ ${fmt(monthlyTotals[idx]?.expense)}`"
                ></div>
              </div>
              <span class="bar-month-label">{{ monthLabel(month) }}</span>
            </div>
          </div>

          <!-- Floating Tooltip Box (Money T style) -->
          <transition name="tooltip-pop">
            <div
              v-if="hoverIdx !== null && monthlyTotals[hoverIdx]"
              class="chart-tooltip-floating"
              :style="tooltipStyle"
            >
              <div class="tooltip-header">
                <strong>{{ monthFullLabel(data.months[hoverIdx]) }}</strong>
              </div>
              <div class="tooltip-row text-emerald">
                <span class="tooltip-indicator bg-emerald"></span>
                <span>Ingreso:</span>
                <strong>S/ {{ fmt(monthlyTotals[hoverIdx].income) }}</strong>
              </div>
              <div class="tooltip-row text-amber">
                <span class="tooltip-indicator bg-amber"></span>
                <span>Egreso:</span>
                <strong>S/ {{ fmt(monthlyTotals[hoverIdx].expense) }}</strong>
              </div>
              <div class="tooltip-row tooltip-balance" :class="monthlyTotals[hoverIdx].balance >= 0 ? 'text-positive' : 'text-negative'">
                <span>Neto:</span>
                <strong>S/ {{ fmt(monthlyTotals[hoverIdx].balance) }}</strong>
              </div>
            </div>
          </transition>
        </div>
      </section>

      <!-- Section 2: Billetera de Cuentas ("My Cards" Style) -->
      <section class="glass-panel ov-section ov-cards-section">
        <div class="ov-section-header">
          <div>
            <h3 class="ov-section-title">Cuentas Bancarias & Caja</h3>
            <p class="ov-section-sub">Saldo acumulado por entidad, sin recorte de fechas</p>
          </div>
          <span class="wallet-badge">{{ BANCOS.length }} Cuentas activas</span>
        </div>

        <div class="bank-cards-stack">
          <!-- Una tarjeta por cuenta bancaria (BCP, BCP Finanzas, Interbank) -->
          <div
            v-for="card in ACCOUNT_CARDS"
            :key="card.banco"
            class="bank-virtual-card"
            :class="[card.className, { 'is-selected': selectedBank === card.banco }]"
            @click="toggleBankFilter(card.banco)"
          >
            <div class="card-bg-glow"></div>
            <div class="card-top">
              <div class="card-brand">
                <span class="card-bank-name">{{ card.banco }}</span>
                <span class="card-type-tag">{{ card.tipo }}</span>
              </div>
              <div class="card-contactless">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 9c2.5-2.5 6.5-2.5 9 0" />
                  <path d="M2 6c4.5-4.5 11.5-4.5 16 0" />
                  <path d="M8 12c1.2-1.2 3.2-1.2 4.4 0" />
                </svg>
              </div>
            </div>

            <div class="card-chip">
              <div class="chip-line"></div>
              <div class="chip-line"></div>
            </div>

            <div class="card-balance-block">
              <span class="card-balance-label">Saldo Disponible</span>
              <div class="card-balance-amount">
                S/ {{ fmt(getBankStats(card.banco).balance) }}
              </div>
            </div>

            <div class="card-footer">
              <div class="card-holder-info">
                <span class="card-holder-label">Titular</span>
                <span class="card-holder-name">Avantage Group SAC</span>
              </div>
              <div class="card-stats-mini">
                <span class="mini-in" title="Total ingresos">▲ S/ {{ fmtShort(getBankStats(card.banco).ingresos) }}</span>
                <span class="mini-out" title="Total egresos">▼ S/ {{ fmtShort(getBankStats(card.banco).egresos) }}</span>
              </div>
            </div>
          </div>

          <!-- Efectivo / Caja Chica Card -->
          <div
            class="bank-virtual-card card-cash"
            :class="{ 'is-selected': selectedBank === 'Efectivo' }"
            @click="toggleBankFilter('Efectivo')"
          >
            <div class="card-bg-glow"></div>
            <div class="card-top">
              <div class="card-brand">
                <span class="card-bank-name">Efectivo</span>
                <span class="card-type-tag">Caja Chica / Bóveda</span>
              </div>
              <span class="card-cash-badge">💵 Físico</span>
            </div>

            <div class="card-chip card-chip-cash">
              <div class="chip-line"></div>
            </div>

            <div class="card-balance-block">
              <span class="card-balance-label">Saldo Disponible</span>
              <div class="card-balance-amount">
                S/ {{ fmt(getBankStats('Efectivo').balance) }}
              </div>
            </div>

            <div class="card-footer">
              <div class="card-holder-info">
                <span class="card-holder-label">Custodio</span>
                <span class="card-holder-name">Administración</span>
              </div>
              <div class="card-stats-mini">
                <span class="mini-in">▲ S/ {{ fmtShort(getBankStats('Efectivo').ingresos) }}</span>
                <span class="mini-out">▼ S/ {{ fmtShort(getBankStats('Efectivo').egresos) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Section 3: Últimos Movimientos ("Latest Transaction" Style) -->
      <section class="glass-panel ov-section ov-transactions-section">
        <div class="ov-section-header">
          <div>
            <h3 class="ov-section-title">Últimos Movimientos Confirmados</h3>
            <p class="ov-section-sub">Ingresos por cuota y asientos de diario recientes</p>
          </div>
          <button
            type="button"
            class="see-all-link-btn"
            @click="$emit('navigate-tab', 'journal')"
          >
            Ver libro diario →
          </button>
        </div>

        <div v-if="!filteredRecentTransactions.length" class="empty-state-mini">
          <p>No hay transacciones registradas recientemente.</p>
        </div>

        <div v-else class="transactions-table-wrap">
          <table class="recent-trans-table">
            <thead>
              <tr>
                <th>Concepto / Cliente</th>
                <th>Fecha</th>
                <th>Entidad</th>
                <th class="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="tx in filteredRecentTransactions"
                :key="tx.id"
                class="recent-tx-row"
              >
                <td class="tx-concept-cell">
                  <div class="tx-avatar" :class="tx.type === 'in' ? 'tx-avatar-in' : 'tx-avatar-out'">
                    {{ tx.type === 'in' ? '↓' : '↑' }}
                  </div>
                  <div class="tx-info">
                    <span class="tx-title" :title="tx.title">{{ tx.title }}</span>
                    <!-- Un salario y una comisión no tienen código: sin esto la
                         fila terminaba en un " · " suelto. -->
                    <span class="tx-sub">{{ tx.subtitle }}<template v-if="tx.code"> · {{ tx.code }}</template></span>
                  </div>
                </td>
                <td class="tx-date-cell">
                  {{ formatTxDate(tx.fecha) }}
                </td>
                <td class="tx-bank-cell">
                  <!-- Una comisión no sale de una cuenta del panel: se dice,
                       en vez de dejar la celda con una píldora vacía. -->
                  <span
                    class="bank-badge-pill"
                    :class="`badge-bank-${bankSlug(tx.banco)}`"
                  >
                    {{ tx.banco || 'Sin cuenta' }}
                  </span>
                </td>
                <td
                  class="tx-amount-cell text-right"
                  :class="tx.type === 'in' ? 'amount-positive' : 'amount-negative'"
                >
                  {{ tx.type === 'in' ? '+ S/ ' : '- S/ ' }}{{ fmt(tx.amount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Section 4: Distribución ("Transaction View" Semi-Donut / Gauge Style) -->
      <section class="glass-panel ov-section ov-gauge-section">
        <div class="ov-section-header">
          <div>
            <h3 class="ov-section-title">Distribución de Fondos</h3>
            <p class="ov-section-sub">Repartición del balance por entidad</p>
          </div>
          <span class="total-gauge-val">S/ {{ fmt(data.totals.balance) }}</span>
        </div>

        <!-- Semi-donut Gauge SVG -->
        <div class="gauge-wrapper">
          <svg viewBox="0 0 240 130" class="gauge-svg">
            <defs>
              <linearGradient
                v-for="grad in GAUGE_GRADIENTS"
                :id="grad.id"
                :key="grad.id"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" :stop-color="grad.from" />
                <stop offset="100%" :stop-color="grad.to" />
              </linearGradient>
            </defs>

            <!-- Background Track -->
            <path
              d="M 25 115 A 95 95 0 0 1 215 115"
              fill="none"
              stroke="var(--surface-3)"
              stroke-width="22"
              stroke-linecap="round"
            />

            <!-- Dynamic Arc Segments -->
            <path
              v-for="arc in gaugeArcs"
              :key="arc.key"
              d="M 25 115 A 95 95 0 0 1 215 115"
              fill="none"
              :stroke="arc.gradient"
              stroke-width="22"
              stroke-linecap="round"
              :stroke-dasharray="`${arc.dashLength} 300`"
              :stroke-dashoffset="arc.dashOffset"
              pathLength="100"
              class="gauge-arc-path"
            />
          </svg>

          <div class="gauge-center-content">
            <span class="gauge-center-label">Balance Neto</span>
            <span class="gauge-center-amount">S/ {{ fmtShort(data.totals.balance) }}</span>
            <span class="gauge-center-badge" :class="data.totals.balance >= 0 ? 'is-good' : 'is-warning'">
              {{ marginPct }}% margen
            </span>
          </div>
        </div>

        <!-- Legend / Breakdown -->
        <div class="gauge-legend-list">
          <div
            v-for="b in data.totals.byBank"
            :key="b.banco"
            class="gauge-legend-row"
            :class="{ 'is-selected': selectedBank === b.banco }"
            @click="toggleBankFilter(b.banco)"
          >
            <div class="gauge-row-left">
              <span class="gauge-color-dot" :style="{ background: BANK_COLORS[b.banco] }"></span>
              <span class="gauge-bank-label">{{ b.banco }}</span>
            </div>
            <div class="gauge-row-values">
              <span class="gauge-bank-pct">{{ getBankPct(b) }}%</span>
              <span class="gauge-bank-amt">S/ {{ fmt(b.ingresos - b.egresos) }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { apiFetch } from "../../apiClient.js";
import { BANCOS, bankSlug } from "./incomeOptions.js";
import { monotonePath, niceAxisMax } from "./chartGeometry.js";

const emit = defineEmits(["navigate-tab"]);

const RANGE_OPTIONS = [3, 6, 12];

/*
 * Los dos colores del gráfico. El modo oscuro tiene su PROPIO paso y no el
 * mismo color "a ver cómo queda": validados con el script de la guía de
 * visualización contra cada fondo (banda de luminosidad, piso de croma,
 * separación para daltonismo y contraste). Los tonos claros quedan por debajo
 * de 3:1 contra el fondo blanco, y eso obliga a que los valores se puedan leer
 * sin depender del color — de ahí las etiquetas al final de cada línea.
 */
const SERIES_LIGHT = { income: "#10B981", expense: "#F59E0B" };
const SERIES_DARK = { income: "#0E9F6E", expense: "#DB6B20" };
const prefersDark = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;
const isDark = ref(false);

function leerTema() {
  if (typeof document === 'undefined') return;
  const elegido = document.documentElement.getAttribute('data-theme');
  isDark.value = elegido ? elegido === 'dark' : Boolean(prefersDark?.matches);
}

const SERIES = computed(() => (isDark.value ? SERIES_DARK : SERIES_LIGHT));
const BANK_COLORS = {
  BCP: "#2563EB",
  "BCP Finanzas": "#6366F1",
  Interbank: "#10B981",
  Efectivo: "#F59E0B"
};

/** Degradado del arco de cada banco en el semidonut (oscuro → claro). */
const GAUGE_GRADIENTS = BANCOS.map((banco) => ({
  banco,
  id: `gauge-${bankSlug(banco)}`,
  ...({
    BCP: { from: "#1E40AF", to: "#3B82F6" },
    "BCP Finanzas": { from: "#4338CA", to: "#6366F1" },
    Interbank: { from: "#059669", to: "#10B981" },
    Efectivo: { from: "#D97706", to: "#F59E0B" }
  }[banco] || { from: "#64748B", to: "#94A3B8" })
}));

/**
 * Las cuentas bancarias de la billetera. El efectivo tiene su propia tarjeta
 * (es caja física, no una cuenta), así que no entra en esta lista.
 */
const ACCOUNT_CARDS = BANCOS
  .filter((banco) => banco !== "Efectivo")
  .map((banco) => ({
    banco,
    className: `card-${bankSlug(banco)}`,
    tipo: {
      Interbank: "Cta. Empresa Soles",
      "BCP Finanzas": "Cta. Finanzas Soles"
    }[banco] || "Cta. Corriente Soles"
  }));

const months = ref(6);
const chartMode = ref("spline"); // 'spline' | 'bars'
const selectedBank = ref(""); // "" (todos los bancos) o uno de BANCOS
const isLoading = ref(false);
const errorMessage = ref("");

const hoverIdx = ref(null);
const chartContainerRef = ref(null);

const data = ref({
  months: [],
  banks: [...BANCOS],
  ingresos: [],
  egresos: [],
  totals: {
    ingresos: 0,
    egresos: 0,
    balance: 0,
    // Mismos nombres y misma forma que devuelve `getOverview()`: la plantilla
    // los lee antes de la primera respuesta, y un `undefined` acá se ve como
    // una tarjeta vacía en la primera pintada.
    egresosPorOrigen: { libro: 0, salarios: 0, comisiones: 0, itf: 0 },
    pendientes: { salarios: 0, comisiones: 0, total: 0 },
    totalTransactions: 0,
    byBank: BANCOS.map((banco) => ({ banco, ingresos: 0, egresos: 0 }))
  },
  recentTransactions: []
});

const isEmpty = computed(
  () => data.value.totals.ingresos === 0 && data.value.totals.egresos === 0
);

// Monthly consolidated totals for chart
const monthlyTotals = computed(() => {
  return data.value.months.map((_, i) => {
    const inc = data.value.ingresos.reduce((sum, s) => sum + (s.values[i] || 0), 0);
    const exp = data.value.egresos.reduce((sum, s) => sum + (s.values[i] || 0), 0);
    return {
      income: Math.round(inc * 100) / 100,
      expense: Math.round(exp * 100) / 100,
      balance: Math.round((inc - exp) * 100) / 100
    };
  });
});

/*
 * El alto del gráfico en unidades del SVG. El ancho se mide del contenedor
 * (`chartWidth`) para que una unidad del viewBox sea UN píxel: antes el SVG
 * tenía un viewBox fijo de 700 estirado con `preserveAspectRatio="none"`, así
 * que los trazos, los puntos y hasta los números del eje salían deformados a
 * lo ancho — los círculos eran óvalos y la tipografía del eje, estrecha.
 */
const CHART_H = 260;
// El hueco de cada lado está medido contra la etiqueta más larga que puede
// salir ("S/ 1,250k" ≈ 57 px a 10.5 px de ancho fijo): con menos, el número
// del eje se sale por la izquierda y el del final de la línea por la derecha.
const PAD = { top: 18, right: 72, bottom: 34, left: 70 };

const chartWidth = ref(700);
const chartHeight = ref(CHART_H);
let chartObserver = null;

const plot = computed(() => ({
  left: PAD.left,
  right: Math.max(PAD.left + 40, chartWidth.value - PAD.right),
  top: PAD.top,
  bottom: Math.max(PAD.top + 40, chartHeight.value - PAD.bottom)
}));

const chartMax = computed(() => {
  let max = 0;
  monthlyTotals.value.forEach((m) => {
    max = Math.max(max, m.income, m.expense);
  });
  return niceAxisMax(max || 1000);
});

/** Las cuatro marcas del eje, de arriba hacia abajo. */
const yTicks = computed(() => [1, 0.75, 0.5, 0.25, 0].map((f) => {
  const value = chartMax.value * f;
  const { top, bottom } = plot.value;
  return { value, y: bottom - f * (bottom - top) };
}));

/** Los puntos de una serie, ya en píxeles del SVG. */
function seriesPoints(valueOf) {
  const n = monthlyTotals.value.length;
  if (!n) return [];
  const { left, right, top, bottom } = plot.value;
  const stepX = n > 1 ? (right - left) / (n - 1) : 0;
  const rangeY = bottom - top;

  return monthlyTotals.value.map((m, i) => {
    const value = valueOf(m) || 0;
    const y = bottom - (value / chartMax.value) * rangeY;
    return { x: left + i * stepX, y: Math.max(top, Math.min(bottom, y)), value };
  });
}

const incomePoints = computed(() => seriesPoints((m) => m.income));
const expensePoints = computed(() => seriesPoints((m) => m.expense));

const incomeLinePath = computed(() => monotonePath(incomePoints.value));
const expenseLinePath = computed(() => monotonePath(expensePoints.value));

/** El área bajo la curva: la misma línea, cerrada contra la base del eje. */
function areaPath(points, line) {
  if (!points.length) return "";
  const base = plot.value.bottom.toFixed(1);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(1)} ${base} L ${first.x.toFixed(1)} ${base} Z`;
}

const incomeAreaPath = computed(() => areaPath(incomePoints.value, incomeLinePath.value));
const expenseAreaPath = computed(() => areaPath(expensePoints.value, expenseLinePath.value));

/**
 * El valor del último mes, escrito al final de cada línea.
 *
 * Es la única cifra que el gráfico dice sin que haya que pasar el mouse —y la
 * que hace falta para que las dos series se distingan sin depender del color,
 * que es lo que pide el contraste de estos dos tonos sobre el fondo claro—.
 * Si los dos finales quedan pegados, se separan lo justo para que no se pisen:
 * una etiqueta encima de la otra no se lee.
 */
const endLabels = computed(() => {
  const ingreso = incomePoints.value[incomePoints.value.length - 1];
  const egreso = expensePoints.value[expensePoints.value.length - 1];
  if (!ingreso || !egreso) return [];

  let yIngreso = ingreso.y;
  let yEgreso = egreso.y;
  if (Math.abs(yIngreso - yEgreso) < 15) {
    const medio = (yIngreso + yEgreso) / 2;
    yIngreso = medio - 8;
    yEgreso = medio + 8;
  }
  return [
    { key: 'in', x: ingreso.x + 9, y: yIngreso + 3, value: ingreso.value },
    { key: 'out', x: egreso.x + 9, y: yEgreso + 3, value: egreso.value }
  ];
});

// Tooltip position style
const tooltipStyle = computed(() => {
  if (hoverIdx.value === null || !incomePoints.value[hoverIdx.value]) {
    return { display: "none" };
  }
  // El ancho del SVG es el del contenedor, así que el porcentaje sale del
  // ancho medido y no de un 700 fijo que ya no existe.
  const pt = incomePoints.value[hoverIdx.value];
  const pctX = (pt.x / Math.max(chartWidth.value, 1)) * 100;
  return {
    left: `${pctX}%`,
    top: "8%",
    transform: pctX > 70 ? "translateX(-95%)" : pctX < 30 ? "translateX(5%)" : "translateX(-50%)"
  };
});

function onChartMouseMove(e) {
  if (!chartContainerRef.value || !incomePoints.value.length) return;
  const rect = chartContainerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, mouseX / rect.width));
  const svgX = ratio * chartWidth.value;

  // Find nearest point
  let closest = 0;
  let minDiff = Infinity;
  incomePoints.value.forEach((pt, i) => {
    const diff = Math.abs(pt.x - svgX);
    if (diff < minDiff) {
      minDiff = diff;
      closest = i;
    }
  });
  hoverIdx.value = closest;
}

/**
 * Mide el contenedor para que el viewBox sea del tamaño real. Sin esto hay que
 * elegir entre un SVG deformado (viewBox fijo estirado) o uno que no ocupa el
 * ancho de la tarjeta.
 */
function medirGrafico() {
  const el = chartContainerRef.value;
  if (!el) return;
  chartWidth.value = Math.max(el.clientWidth || 0, 320);
  chartHeight.value = Math.max(el.clientHeight || 0, 220);
}

function onChartMouseLeave() {
  hoverIdx.value = null;
}

function getBarHeight(val) {
  const pct = ((val || 0) / chartMax.value) * 100;
  return `${Math.max(pct > 0 ? 3 : 0, Math.min(100, pct))}%`;
}

// Bank helper stats
function getBankStats(bankName) {
  const row = data.value.totals.byBank.find((b) => b.banco === bankName);
  if (!row) return { ingresos: 0, egresos: 0, balance: 0 };
  return {
    ingresos: row.ingresos || 0,
    egresos: row.egresos || 0,
    balance: Math.round((row.ingresos - row.egresos) * 100) / 100
  };
}

function toggleBankFilter(bankName) {
  selectedBank.value = selectedBank.value === bankName ? "" : bankName;
}

const filteredRecentTransactions = computed(() => {
  const list = data.value.recentTransactions || [];
  if (!selectedBank.value) return list;
  return list.filter((tx) => tx.banco === selectedBank.value);
});

// Semi-donut gauge calculations
const marginPct = computed(() => {
  if (!data.value.totals.ingresos) return 0;
  const pct = (data.value.totals.balance / data.value.totals.ingresos) * 100;
  return Math.round(pct);
});

function getBankPct(bankRow) {
  const total = data.value.totals.byBank.reduce((sum, b) => {
    const bal = Math.max(0, b.ingresos - b.egresos);
    return sum + bal;
  }, 0);
  if (total <= 0) return 0;
  const bal = Math.max(0, bankRow.ingresos - bankRow.egresos);
  return Math.round((bal / total) * 100);
}

const gaugeArcs = computed(() => {
  // Un arco por banco con saldo, en el orden de BANCOS. El último se queda con
  // el resto del porcentaje para que los redondeos no dejen un hueco al final.
  const conSaldo = BANCOS
    .map((banco) => ({ banco, pct: getBankPct(getBankStats(banco)) }))
    .filter((b) => b.pct > 0);
  if (conSaldo.length > 0) {
    const previos = conSaldo.slice(0, -1).reduce((sum, b) => sum + b.pct, 0);
    conSaldo[conSaldo.length - 1].pct = Math.max(0, 100 - previos);
  }

  // El dashoffset arranca en 0 (extremo izquierdo) y cada arco empuja al
  // siguiente tanto como ocupa.
  let offset = 0;
  return conSaldo.map((b) => {
    const arc = {
      key: bankSlug(b.banco),
      dashLength: b.pct,
      dashOffset: -offset,
      gradient: `url(#gauge-${bankSlug(b.banco)})`
    };
    offset += b.pct;
    return arc;
  });
});

// Formatters
function fmt(value) {
  return Number(value || 0).toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function fmtShort(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000) {
    return `${(n / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })}k`;
  }
  return n.toLocaleString("es-PE", { maximumFractionDigits: 0 });
}

function monthLabel(monthKey) {
  if (!monthKey) return "";
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1))
    .toLocaleDateString("es-PE", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}

function monthFullLabel(monthKey) {
  if (!monthKey) return "";
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-PE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatTxDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "short"
  });
}

async function fetchOverview() {
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const response = await apiFetch(`/api/finance/overview?months=${months.value}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "No se pudo obtener el resumen.");
    data.value = payload;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

function setRange(value) {
  if (months.value === value) return;
  months.value = value;
  fetchOverview();
}

let themeObserver = null;

onMounted(async () => {
  leerTema();
  // El tema se cambia desde la barra del panel (atributo en <html>) o desde el
  // sistema operativo: los dos caminos tienen que repintar las series, porque
  // cada modo usa su propio paso de color.
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(leerTema);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  prefersDark?.addEventListener?.('change', leerTema);

  await fetchOverview();
  await nextTick();
  medirGrafico();
  // El gráfico se redibuja con el contenedor: la tarjeta cambia de ancho al
  // plegar el menú lateral o al girar el celular, y un viewBox viejo deja las
  // líneas desalineadas de sus meses.
  if (typeof ResizeObserver !== 'undefined' && chartContainerRef.value) {
    chartObserver = new ResizeObserver(medirGrafico);
    chartObserver.observe(chartContainerRef.value);
  }
});

onBeforeUnmount(() => {
  chartObserver?.disconnect();
  chartObserver = null;
  themeObserver?.disconnect();
  themeObserver = null;
  prefersDark?.removeEventListener?.('change', leerTema);
});
</script>

<style scoped>
.overview-dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

/* Top Toolbar */
.ov-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.ov-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: -0.01em;
}

.ov-subtitle {
  margin: 0.15rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.ov-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ov-segmented-control {
  display: flex;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  padding: 0.2rem;
  border-radius: var(--radius-md);
}

.ov-segment-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-body);
  font-size: 0.76rem;
  font-weight: 500;
  padding: 0.35rem 0.75rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ov-segment-btn:hover {
  color: var(--text-main);
}

.ov-segment-btn.is-active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(16, 20, 20, 0.08);
}

.ov-refresh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ov-refresh-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.is-spinning {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 4 KPI Cards (Money T Style) */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.kpi-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  padding: 1.25rem 1.35rem;
  box-shadow: 0 4px 18px -4px rgba(16, 20, 20, 0.06);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  position: relative;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -4px rgba(16, 20, 20, 0.1);
}

/* Colored Top Border Indicators (Money T signature) */
.kpi-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.kpi-card-income::before { background: linear-gradient(90deg, #6366F1, #8B5CF6); }
.kpi-card-expense::before { background: linear-gradient(90deg, #F97316, #F59E0B); }
.kpi-card-balance::before { background: linear-gradient(90deg, #06B6D4, #10B981); }
.kpi-card-transactions::before { background: linear-gradient(90deg, #10B981, #34D399); }

.kpi-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.kpi-card-label {
  font-family: var(--font-body);
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-muted);
}

.kpi-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  line-height: 1.2;
}

.kpi-pill-emerald {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}

.kpi-pill-amber {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}

.kpi-pill-cyan {
  background: rgba(6, 182, 212, 0.12);
  color: #06B6D4;
}

.kpi-pill-rose {
  background: rgba(239, 68, 68, 0.12);
  color: #EF4444;
}

.kpi-pill-purple {
  background: rgba(139, 92, 246, 0.12);
  color: #8B5CF6;
}

.kpi-card-value {
  font-family: var(--font-heading);
  font-size: 1.65rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-main);
  margin-top: 0.2rem;
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}

.kpi-cur {
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text-muted);
}

.kpi-unit {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 0.2rem;
}

.kpi-card-footer {
  margin-top: auto;
  padding-top: 0.35rem;
}

.kpi-hint {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* Desglose del total de egresos, dentro de su tarjeta. */
.kpi-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.6rem;
  font-size: 0.68rem;
  color: var(--text-muted);
}

.kpi-breakdown b { color: var(--text-sub); font-weight: 600; }

/*
 * Banda de lo pendiente. Ámbar como los egresos, pero en una banda y no en una
 * tarjeta: no es parte del balance y no tiene que competir con las cuatro
 * cifras que sí lo son.
 */
.ov-pending-band {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.9rem;
  margin-top: 1rem;
  padding: 0.55rem 0.8rem;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(245, 158, 11, 0.08);
  font-size: 0.78rem;
  color: var(--text-sub);
}

.ov-pending-label { font-weight: 700; color: #B45309; }
.ov-pending-item b, .ov-pending-total b { font-weight: 700; color: var(--text-main); }
.ov-pending-total { padding-left: 0.2rem; border-left: 1px solid rgba(245, 158, 11, 0.35); }
.ov-pending-note { font-size: 0.72rem; color: var(--text-muted); margin-left: auto; }

:root[data-theme="dark"] .ov-pending-label { color: #FBBF24; }

.text-positive { color: #10B981; }
.text-negative { color: #EF4444; }

/* Main Dashboard Grid (2x2) */
.ov-main-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 1.25rem;
}

.ov-section {
  padding: 1.35rem 1.45rem;
  border-radius: var(--radius-xl);
  display: flex;
  flex-direction: column;
}

.ov-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.15rem;
  flex-wrap: wrap;
}

.ov-section-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 0.96rem;
  font-weight: 700;
  color: var(--text-main);
}

.ov-section-sub {
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  color: var(--text-muted);
}

/* Chart Section */
.ov-chart-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.chart-legend-pills {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.legend-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.74rem;
  color: var(--text-sub);
  font-weight: 500;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-income { background: #10B981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); }
.dot-expense { background: #F59E0B; box-shadow: 0 0 6px rgba(245, 158, 11, 0.4); }

.ov-view-toggle {
  display: flex;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  padding: 0.15rem;
  border-radius: var(--radius-sm);
}

.view-toggle-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
}

.view-toggle-btn.is-active {
  background: var(--bg-card-solid);
  color: var(--text-main);
  font-weight: 600;
}

/* El gráfico CRECE con la tarjeta. Antes tenía 250 px fijos dentro de un panel
   que la columna de cuentas estira al doble, así que debajo de la curva
   quedaba medio metro de vacío. */
.chart-container {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 280px;
  margin-top: 0.5rem;
  user-select: none;
}

.interactive-svg-chart {
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
}

/* El texto del gráfico usa tokens de texto, nunca el color de la serie: los
   dos tonos son ilegibles como texto sobre el fondo claro. La identidad la
   pone el punto de color que tienen al lado. */
.chart-axis-text {
  font-family: var(--font-mono);
  font-size: 10.5px;
  fill: var(--text-muted);
}

.chart-axis-text.is-hovered {
  fill: var(--text-main);
  font-weight: 700;
}

.chart-end-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  fill: var(--text-sub);
}

/* Floating Chart Tooltip */
.chart-tooltip-floating {
  position: absolute;
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.65rem 0.85rem;
  box-shadow: 0 10px 25px -5px rgba(16, 20, 20, 0.2);
  pointer-events: none;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 155px;
  backdrop-filter: blur(8px);
}

.tooltip-header {
  font-size: 0.75rem;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.25rem;
  margin-bottom: 0.1rem;
  text-transform: capitalize;
}

.tooltip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.73rem;
}

.tooltip-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.bg-emerald { background: #10B981; }
.bg-amber { background: #F59E0B; }
.text-emerald { color: #10B981; }
.text-amber { color: #F59E0B; }

.tooltip-balance {
  border-top: 1px dashed var(--border-color);
  padding-top: 0.25rem;
  margin-top: 0.1rem;
  font-weight: 600;
}

/* Bars View */
/* Crece con la tarjeta, igual que la vista de curvas: las dos tienen que
   ocupar el mismo alto o cambiar de pestaña da un salto. */
.bars-chart-view {
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  height: 100%;
  padding: 0.5rem 1rem 0;
  border-bottom: 1px solid var(--border-color);
}

.bar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  height: 100%;
  flex: 1;
}

.bars-pair {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  height: 100%;
}

.bar-single {
  width: 12px;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s ease, transform 0.15s ease;
}

.bar-income { background: #10B981; }
.bar-expense { background: #F59E0B; }

.bar-group:hover .bar-single {
  filter: brightness(1.15);
  transform: scaleY(1.02);
}

.bar-month-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: capitalize;
}

/* Section 2: Virtual Bank Cards (Money T Style) */
.wallet-badge {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
  background: rgba(111, 129, 37, 0.1);
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
}

.bank-cards-stack {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.bank-virtual-card {
  border-radius: var(--radius-lg);
  padding: 1.1rem 1.25rem;
  color: #ffffff;
  position: relative;
  overflow: hidden;
  box-shadow: 0 8px 20px -6px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.bank-virtual-card:hover {
  transform: translateY(-2px) scale(1.01);
  box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.35);
}

.bank-virtual-card.is-selected {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.card-bg-glow {
  position: absolute;
  top: -30%;
  right: -20%;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.18) 0%, transparent 70%);
  pointer-events: none;
}

/* Card Themes */
.card-bcp {
  background: linear-gradient(135deg, #0A2540 0%, #173B6C 50%, #002A54 100%);
}

.card-bcp-finanzas {
  background: linear-gradient(135deg, #1E1B4B 0%, #3730A3 50%, #312E81 100%);
}

.card-interbank {
  background: linear-gradient(135deg, #064E3B 0%, #047857 50%, #065F46 100%);
}

.card-cash {
  background: linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-brand {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
}

.card-bank-name {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.15rem;
  letter-spacing: -0.02em;
}

.card-type-tag {
  font-size: 0.68rem;
  opacity: 0.8;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.card-contactless {
  opacity: 0.85;
}

.card-cash-badge {
  font-size: 0.72rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.15);
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
}

/* Microchip */
.card-chip {
  width: 32px;
  height: 24px;
  border-radius: 4px;
  background: linear-gradient(135deg, #FFE259 0%, #FFA751 100%);
  position: relative;
  overflow: hidden;
  box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  padding: 3px 0;
}

.card-chip-cash {
  background: linear-gradient(135deg, #E2E8F0 0%, #94A3B8 100%);
}

.chip-line {
  height: 1px;
  background: rgba(0, 0, 0, 0.25);
  width: 100%;
}

.card-balance-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.card-balance-label {
  font-size: 0.68rem;
  opacity: 0.75;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-balance-amount {
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.card-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 0.5rem;
  margin-top: 0.15rem;
}

.card-holder-info {
  display: flex;
  flex-direction: column;
}

.card-holder-label {
  font-size: 0.6rem;
  opacity: 0.65;
  text-transform: uppercase;
}

.card-holder-name {
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.card-stats-mini {
  display: flex;
  gap: 0.65rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.mini-in { color: #6EE7B7; }
.mini-out { color: #FCA5A5; }

/* Section 3: Recent Transactions (Money T Style) */
.see-all-link-btn {
  background: none;
  border: none;
  color: var(--primary);
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.see-all-link-btn:hover {
  text-decoration: underline;
}

.transactions-table-wrap {
  overflow-x: auto;
}

.recent-trans-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.recent-trans-table th {
  padding: 0.55rem 0.75rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.recent-trans-table td {
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  vertical-align: middle;
}

.recent-tx-row:hover td {
  background: var(--surface-1);
}

.tx-concept-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  max-width: 280px;
}

.tx-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 700;
  flex-shrink: 0;
}

.tx-avatar-in {
  background: rgba(16, 185, 129, 0.14);
  color: #10B981;
}

.tx-avatar-out {
  background: rgba(239, 68, 68, 0.14);
  color: #EF4444;
}

.tx-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tx-title {
  font-weight: 600;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-sub {
  font-size: 0.7rem;
  color: var(--text-muted);
}

.tx-date-cell {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-sub);
  white-space: nowrap;
}

.bank-badge-pill {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  letter-spacing: 0.03em;
}

.badge-bank-bcp {
  background: rgba(37, 99, 235, 0.12);
  color: #2563EB;
}

.badge-bank-bcp-finanzas {
  background: rgba(99, 102, 241, 0.12);
  color: #6366F1;
}

.badge-bank-interbank {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}

.badge-bank-efectivo {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}

.tx-amount-cell {
  font-family: var(--font-mono);
  font-size: 0.88rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.amount-positive { color: #10B981; }
.amount-negative { color: #EF4444; }
.text-right { text-align: right; }

/* Section 4: Gauge / Semi-Donut (Money T Style) */
.total-gauge-val {
  font-family: var(--font-heading);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-main);
}

.gauge-wrapper {
  position: relative;
  width: 100%;
  max-width: 240px;
  margin: 0.75rem auto 1rem;
}

.gauge-svg {
  width: 100%;
  display: block;
}

.gauge-arc-path {
  transition: stroke-dasharray 0.6s ease, stroke-dashoffset 0.6s ease;
}

.gauge-center-content {
  position: absolute;
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.gauge-center-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.gauge-center-amount {
  font-family: var(--font-heading);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.2;
}

.gauge-center-badge {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.1rem 0.45rem;
  border-radius: 9999px;
  margin-top: 0.2rem;
}

.gauge-center-badge.is-good {
  background: rgba(16, 185, 129, 0.14);
  color: #10B981;
}

.gauge-center-badge.is-warning {
  background: rgba(245, 158, 11, 0.14);
  color: #F59E0B;
}

.gauge-legend-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--border-color);
  padding-top: 0.85rem;
  margin-top: auto;
}

.gauge-legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s ease;
}

.gauge-legend-row:hover,
.gauge-legend-row.is-selected {
  background: var(--surface-2);
}

.gauge-row-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.gauge-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.gauge-bank-label {
  font-size: 0.78rem;
  color: var(--text-main);
  font-weight: 500;
}

.gauge-row-values {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.gauge-bank-pct {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--text-muted);
}

.gauge-bank-amt {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-main);
}

.empty-state-mini {
  padding: 2rem 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8rem;
}

/* Responsive Breakpoints */
@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .ov-main-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .ov-top-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .ov-actions {
    justify-content: space-between;
  }

  .chart-container {
    height: 220px;
  }
}
</style>
