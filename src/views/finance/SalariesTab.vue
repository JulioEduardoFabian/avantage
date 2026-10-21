<template>
  <section class="ledger-tab">
    <p class="ledger-hint">
      El <strong>salario por proyecto</strong> es cuánto se le paga a quien consiguió el lead: se
      registra al cerrar la venta o con el botón de abajo, se le asigna solo al responsable del
      proyecto, y debajo de cada uno se van anotando sus <strong>pagos</strong> con su fecha, su
      monto y su estado (el porcentaje sale del monto). El acuerdo es el compromiso y no descuenta
      del balance; lo que descuenta son los pagos ya hechos. También se pueden registrar pagos
      sueltos al personal, como siempre.
    </p>

    <div class="ledger-controls">
      <label class="ledger-search">
        <span class="ledger-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="ledger-search-input"
          placeholder="Buscar por persona, cargo, periodo o detalle"
          aria-label="Buscar salarios"
        />
      </label>
      <select v-model="estadoFilter" class="ledger-filter" aria-label="Filtrar por estado">
        <option value="">Todo estado</option>
        <option value="pagado">Pagado</option>
        <option value="pendiente">Pendiente</option>
      </select>
      <select v-model="bancoFilter" class="ledger-filter" aria-label="Filtrar por banco">
        <option value="">Todo banco</option>
        <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
      </select>
      <button type="button" class="btn-action-secondary ledger-add-btn" @click="agreementOpen ? (agreementOpen = false) : openAgreementForm()">
        {{ agreementOpen ? '✕ Cerrar' : '🏷️ Salario por proyecto' }}
      </button>
      <button type="button" class="btn-primary ledger-add-btn" @click="isFormOpen ? closeForm() : openCreate()">
        {{ isFormOpen ? (editingRow ? '✕ Cancelar edición' : '✕ Cerrar') : '+ Pago suelto' }}
      </button>
    </div>

    <p v-if="errorMessage" class="info-box ledger-alert">⚠️ {{ errorMessage }}</p>
    <p v-if="successMessage" class="info-box ledger-success">✅ {{ successMessage }}</p>

    <section v-if="isFormOpen" class="glass-panel ledger-form-panel">
      <h3 v-if="editingRow" class="ledger-form-title">
        Editando el salario de <strong>{{ editingRow.persona }}</strong>
      </h3>
      <form class="ledger-form" @submit.prevent="submit">
        <div class="ledger-form-grid">
          <div class="form-group">
            <label class="form-label">Persona</label>
            <input v-model="form.persona" type="text" class="form-input" placeholder="Nombre completo" required />
          </div>
          <div class="form-group">
            <label class="form-label">Cargo</label>
            <input v-model="form.cargo" type="text" class="form-input" placeholder="Ej: Asesor de tesis" />
          </div>
          <div class="form-group">
            <label class="form-label">Fecha de pago</label>
            <input v-model="form.fecha" type="date" class="form-input" required />
          </div>
          <div class="form-group">
            <label class="form-label">Periodo que cubre</label>
            <input v-model="form.periodo" type="text" class="form-input" list="salary-periodos" placeholder="Ej: Setiembre 2026" />
            <datalist id="salary-periodos">
              <option v-for="p in PERIODO_SUGERIDOS" :key="p" :value="p" />
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Monto (se registra como egreso, en negativo)</label>
            <input v-model="form.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select v-model="form.estado" class="form-select">
              <option value="pagado">Pagado</option>
              <option value="pendiente">Pendiente</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Moneda</label>
            <select v-model="form.moneda" class="form-select">
              <option value="soles">Soles</option>
              <option value="dolares">Dólares</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Método de pago</label>
            <input v-model="form.metodoPago" type="text" class="form-input" list="salary-metodos" placeholder="Ej: Transferencia" />
            <datalist id="salary-metodos">
              <option value="Efectivo" />
              <option value="Transferencia" />
              <option value="Yape" />
              <option value="Plin" />
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Banco</label>
            <select v-model="form.banco" class="form-select">
              <option value="">— Sin especificar —</option>
              <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
            </select>
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Detalle</label>
            <textarea v-model="form.detalle" class="form-textarea" rows="2" placeholder="Notas adicionales (opcional)"></textarea>
          </div>
          <div class="form-group ledger-form-wide">
            <label class="form-label">Comprobantes (imágenes o PDF, opcional)</label>
            <input
              ref="fileInput"
              type="file"
              accept="image/*,application/pdf"
              multiple
              class="form-input"
              @change="onFileChange"
            />
            <p class="ledger-receipt-hint">
              Puedes seleccionar varios archivos a la vez (hasta {{ MAX_RECEIPTS }}).
              <template v-if="editingRow">
                Se añaden a los {{ editingRow.receipts?.length || 0 }} que ya tiene; para
                quitar alguno usa la ✕ de su miniatura en la tabla.
              </template>
            </p>
          </div>
        </div>

        <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
          {{ isSaving ? 'Guardando...' : (editingRow ? 'Guardar cambios' : 'Guardar salario') }}
        </button>
      </form>
    </section>

    <div v-if="isLoading" class="empty-state"><p>Cargando salarios...</p></div>

    <div v-else-if="rows.length === 0" class="empty-state">
      <p class="empty-state-title">Sin salarios registrados</p>
      <p class="empty-state-text">Usa "🏷️ Salario por proyecto" o "+ Pago suelto" para empezar.</p>
    </div>

    <template v-else>
      <dl class="ledger-summary">
        <div class="ledger-summary-item">
          <dt>Pagos</dt>
          <dd>{{ range.total }}</dd>
        </div>
        <div class="ledger-summary-item" title="Personas distintas en lo que se está mirando">
          <dt>Personas</dt>
          <dd>{{ totals.personas }}</dd>
        </div>
        <div class="ledger-summary-item" title="Pagos que todavía no se hicieron">
          <dt>Pendientes</dt>
          <dd>{{ totals.pendientes }}</dd>
        </div>
        <div class="ledger-summary-item" title="Suma de los salarios en soles (egreso)">
          <dt>Total soles</dt>
          <dd class="is-out">S/ {{ formatAmount(totals.soles) }}</dd>
        </div>
        <div class="ledger-summary-item" title="Suma de los salarios en dólares (egreso)">
          <dt>Total dólares</dt>
          <dd class="is-out">US$ {{ formatAmount(totals.dolares) }}</dd>
        </div>
        <!-- Lo acordado por proyecto que todavía no se pagó. Va aparte y no
             sumado a los totales: no salió de ninguna cuenta, pero esconderlo
             deja la planilla pareciendo más liviana de lo que es. -->
        <div
          v-if="totals.comprometido > 0"
          class="ledger-summary-item"
          title="Salarios por proyecto acordados que todavía no se pagaron. No está incluido en los totales"
        >
          <dt>Comprometido</dt>
          <dd class="is-pending">S/ {{ formatAmount(totals.comprometido) }}</dd>
        </div>
      </dl>

      <!-- Alta de un salario por proyecto. A quién se le paga no se pregunta:
           lo resuelve el servidor con el responsable del proyecto. -->
      <section v-if="agreementOpen" class="glass-panel ledger-form-panel">
        <h3 class="ledger-form-title">Salario por proyecto</h3>
        <form class="ledger-form" @submit.prevent="submitAgreement">
          <div class="ledger-form-grid">
            <div class="form-group ledger-form-wide">
              <label class="form-label">Proyecto *</label>
              <select v-model="agreementForm.projectId" class="form-select" required>
                <option value="">— Elige el proyecto —</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">
                  {{ p.client_name }}{{ p.owner_name ? ` · ${p.owner_name}` : '' }}
                </option>
              </select>
              <p class="ledger-receipt-hint">
                El salario se le asigna al responsable del proyecto. Solo salen los proyectos que
                todavía no tienen su salario registrado.
              </p>
            </div>
            <div class="form-group">
              <label class="form-label">Monto acordado (S/) *</label>
              <input v-model="agreementForm.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
            </div>
            <div class="form-group ledger-form-wide">
              <label class="form-label">Detalle</label>
              <input v-model="agreementForm.detalle" type="text" class="form-input" placeholder="Opcional" />
            </div>
          </div>
          <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
            {{ isSaving ? 'Guardando...' : 'Registrar salario del proyecto' }}
          </button>
        </form>
      </section>

      <!-- Un pago de ese salario. El porcentaje se calcula mientras se
           escribe el monto, no se pide. -->
      <section v-if="paymentParent" ref="paymentPanel" class="glass-panel ledger-form-panel">
        <h3 class="ledger-form-title">
          {{ paymentEditing ? 'Editando un pago' : 'Pago' }} del salario de <strong>{{ paymentParent.persona }}</strong>
          <span class="ledger-muted"> · acordado S/ {{ formatAmount(paymentParent.monto) }}, falta S/ {{ formatAmount(paymentParent.pending_amount) }}</span>
        </h3>
        <form class="ledger-form" @submit.prevent="submitPayment">
          <div class="ledger-form-grid">
            <div class="form-group">
              <label class="form-label">Fecha *</label>
              <input v-model="paymentForm.fecha" type="date" class="form-input" required />
            </div>
            <div class="form-group">
              <label class="form-label">Monto (S/) *</label>
              <input v-model="paymentForm.monto" type="number" step="0.01" min="0.01" class="form-input" placeholder="0.00" required />
              <p v-if="paymentPercent" class="ledger-receipt-hint">Es el {{ paymentPercent }}% del salario acordado.</p>
            </div>
            <div class="form-group">
              <label class="form-label">Estado</label>
              <select v-model="paymentForm.estado" class="form-select">
                <option value="pagado">Pagado</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Método de pago</label>
              <input v-model="paymentForm.metodoPago" type="text" class="form-input" list="salary-payment-metodos" placeholder="Ej: Transferencia" />
              <datalist id="salary-payment-metodos">
                <option value="Efectivo" />
                <option value="Transferencia" />
                <option value="Yape" />
                <option value="Plin" />
              </datalist>
            </div>
            <!-- La cuenta de la que sale ESTE pago: un mismo salario se puede
                 cubrir en partes desde cuentas distintas. -->
            <div class="form-group">
              <label class="form-label">Banco del que sale</label>
              <select v-model="paymentForm.banco" class="form-select">
                <option value="">— Sin especificar —</option>
                <option v-for="b in BANCOS" :key="b" :value="b">{{ b }}</option>
              </select>
            </div>
            <div class="form-group ledger-form-wide">
              <label class="form-label">Detalle</label>
              <input v-model="paymentForm.detalle" type="text" class="form-input" placeholder="Opcional" />
            </div>
            <div class="form-group ledger-form-wide">
              <label class="form-label">Comprobantes (imágenes o PDF, opcional)</label>
              <input
                ref="paymentFileInput"
                type="file"
                accept="image/*,application/pdf"
                multiple
                class="form-input"
                @change="onPaymentFileChange"
              />
              <p class="ledger-receipt-hint">
                Puedes seleccionar varios archivos a la vez (hasta {{ MAX_RECEIPTS }}).
                <template v-if="paymentEditing">
                  Se añaden a los {{ paymentEditing.receipts?.length || 0 }} que ya tiene; para
                  quitar alguno usa la ✕ de su miniatura en la tabla.
                </template>
              </p>
            </div>
          </div>
          <div class="salary-form-actions">
            <button type="submit" class="btn-primary ledger-submit-btn" :disabled="isSaving">
              {{ isSaving ? 'Guardando...' : (paymentEditing ? 'Guardar cambios' : 'Registrar pago') }}
            </button>
            <button type="button" class="btn-action-ghost" @click="closePaymentForm">Cancelar</button>
          </div>
        </form>
      </section>

      <div v-if="paged.length === 0" class="empty-state">
        <p class="empty-state-title">Ningún salario coincide</p>
        <p class="empty-state-text">Ajusta la búsqueda o los filtros para volver a ver la planilla.</p>
        <button type="button" class="btn-secondary ledger-submit-btn" @click="clearFilters()">
          Quitar filtros
        </button>
      </div>

      <template v-else>
        <div class="data-table-wrapper ledger-table-wrapper">
          <table class="data-table ledger-table">
            <thead>
              <tr>
                <th>
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'persona' }" @click="toggleSort('persona')">
                    Persona <span class="ledger-sort-caret">{{ sortCaret('persona') }}</span>
                  </button>
                </th>
                <th>
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'fecha' }" @click="toggleSort('fecha')">
                    Fecha <span class="ledger-sort-caret">{{ sortCaret('fecha') }}</span>
                  </button>
                </th>
                <th>Proyecto / periodo</th>
                <th class="ledger-num">
                  <button type="button" class="ledger-sort" :class="{ 'is-active': sort.key === 'monto' }" @click="toggleSort('monto')">
                    Monto <span class="ledger-sort-caret">{{ sortCaret('monto') }}</span>
                  </button>
                </th>
                <th>Estado</th>
                <th>Método</th>
                <th>Banco</th>
                <th>Detalle</th>
                <th>Comprobantes</th>
                <th class="ledger-col-actions" aria-label="Acciones"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in paged" :key="row.id">
              <tr :class="{ 'is-agreement': row.kind === 'acuerdo' }">
                <td>
                  <!-- El acuerdo se pliega: sus pagos son filas hijas, y con
                       todas abiertas la planilla de un mes no entra en
                       pantalla. -->
                  <button
                    v-if="row.kind === 'acuerdo'"
                    type="button"
                    class="salary-toggle"
                    :title="expanded[row.id] ? 'Ocultar los pagos' : 'Ver los pagos'"
                    @click="toggleExpand(row.id)"
                  >{{ expanded[row.id] ? '⌄' : '›' }}</button>
                  <span v-if="row.cargo" class="ledger-eyebrow">{{ row.cargo }}</span>
                  <span v-else-if="row.kind === 'acuerdo'" class="ledger-eyebrow">Salario por proyecto</span>
                  <span class="ledger-stack-main">{{ row.persona }}</span>
                </td>
                <td class="ledger-date">{{ formatDate(row.fecha) }}</td>
                <td>
                  <!-- De un acuerdo, el proyecto; de un pago suelto, el
                       periodo que cubre. Es la misma columna porque contesta
                       lo mismo: por qué se le paga. -->
                  <span v-if="row.kind === 'acuerdo'" class="salary-project" :title="row.project_topic || ''">
                    {{ row.project_client || 'Proyecto sin cliente' }}
                  </span>
                  <span v-else-if="row.periodo">{{ row.periodo }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td class="ledger-num salary-amount-out">
                  <span class="ledger-amount-cur">{{ currencySymbol(row.moneda) }}</span>
                  <span class="ledger-amount">{{ formatAmount(row.monto) }}</span>
                  <!-- Cuánto de ese acuerdo ya se pagó: es la cifra por la que
                       se abre esta pestaña, y pedirla desplegando los pagos de
                       cada fila es hacer la cuenta a mano. -->
                  <span v-if="row.kind === 'acuerdo'" class="salary-progress">
                    pagado {{ formatAmount(row.paid_amount) }} · falta {{ formatAmount(row.pending_amount) }}
                  </span>
                </td>
                <td>
                  <!-- Un acuerdo no tiene estado propio: lo que está pagado o
                       pendiente son sus pagos. Mostrar una píldora pulsable
                       invitaría a marcarlo "pagado" sin que haya salido nada. -->
                  <span v-if="row.kind === 'acuerdo'" class="pill" :class="agreementPillClass(row)">
                    {{ agreementLabel(row) }}
                  </span>
                  <button
                    v-else
                    type="button"
                    class="pill pill-toggle"
                    :class="row.estado === 'pendiente' ? 'pill-warning' : 'pill-success'"
                    :disabled="statusSavingId === row.id"
                    :title="row.estado === 'pendiente' ? 'Marcar como pagado' : 'Marcar como pendiente'"
                    @click="toggleStatus(row)"
                  >
                    {{ row.estado === 'pendiente' ? 'Pendiente' : '✓ Pagado' }}
                  </button>
                </td>
                <td>
                  <span v-if="row.metodo_pago">{{ row.metodo_pago }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>
                  <span v-if="row.banco">{{ row.banco }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>
                  <span v-if="row.detalle" class="ledger-detalle" :title="row.detalle">{{ row.detalle }}</span>
                  <span v-else class="ledger-muted">—</span>
                </td>
                <td>
                  <div class="receipt-cell">
                    <span
                      v-for="rcpt in row.receipts"
                      :key="rcpt.id"
                      class="receipt-thumb"
                      :title="receiptTitle(rcpt)"
                    >
                      <a
                        v-if="receiptUrls[rcpt.id]"
                        :href="receiptUrls[rcpt.id]"
                        target="_blank"
                        rel="noopener"
                        class="receipt-thumb-link"
                      >
                        <span v-if="isPdfReceipt(rcpt.mime_type, rcpt.original_name)" class="receipt-thumb-pdf">PDF</span>
                        <img v-else :src="receiptUrls[rcpt.id]" alt="Comprobante" />
                      </a>
                      <span v-else-if="rcpt.missing" class="receipt-thumb-missing">!</span>
                      <span v-else class="receipt-thumb-loading">…</span>
                      <button
                        type="button"
                        class="receipt-remove"
                        title="Eliminar comprobante"
                        @click="removeReceipt(rcpt.id)"
                      >✕</button>
                    </span>
                    <label class="receipt-add" title="Agregar comprobantes (imágenes o PDF)">
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        hidden
                        @change="(e) => uploadReceipts(row.id, e)"
                      />
                      +
                    </label>
                  </div>
                </td>
                <td class="ledger-col-actions">
                  <div class="ledger-row-actions">
                    <button type="button" class="ledger-icon-btn" title="Editar salario" aria-label="Editar salario" @click="startEdit(row)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button type="button" class="ledger-icon-btn is-danger" title="Eliminar salario" aria-label="Eliminar salario" @click="removeRow(row)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>

              <!-- Los pagos del acuerdo: fecha, monto, % y estado. El % sale
                   del monto sobre el acuerdo y lo calcula el servidor, así que
                   corregir el acuerdo lo recalcula solo. -->
              <template v-if="row.kind === 'acuerdo' && expanded[row.id]">
                <tr v-for="child in row.children" :key="`child-${child.id}`" class="is-child">
                  <td class="salary-child-cell">
                    <span class="salary-child-mark" aria-hidden="true">↳</span>
                    <span class="ledger-muted">Pago</span>
                  </td>
                  <td class="ledger-date">{{ formatDate(child.fecha) }}</td>
                  <td>
                    <span v-if="child.percent != null" class="salary-percent">{{ child.percent }}%</span>
                    <span v-else class="ledger-muted">—</span>
                  </td>
                  <td class="ledger-num salary-amount-out">
                    <span class="ledger-amount-cur">{{ currencySymbol(child.moneda) }}</span>
                    <span class="ledger-amount">{{ formatAmount(child.monto) }}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      class="pill pill-toggle"
                      :class="child.estado === 'pendiente' ? 'pill-warning' : 'pill-success'"
                      :disabled="statusSavingId === child.id"
                      :title="child.estado === 'pendiente' ? 'Marcar como pagado' : 'Marcar como pendiente'"
                      @click="toggleStatus(child)"
                    >{{ child.estado === 'pendiente' ? 'Pendiente' : '✓ Pagado' }}</button>
                  </td>
                  <td><span v-if="child.metodo_pago">{{ child.metodo_pago }}</span><span v-else class="ledger-muted">—</span></td>
                  <td><span v-if="child.banco">{{ child.banco }}</span><span v-else class="ledger-muted">—</span></td>
                  <td>
                    <span v-if="child.detalle" class="ledger-detalle" :title="child.detalle">{{ child.detalle }}</span>
                    <span v-else class="ledger-muted">—</span>
                  </td>
                  <td>
                    <!-- El comprobante es de cada pago, no del acuerdo: es lo
                         que respalda que ESA parte salió. -->
                    <div class="receipt-cell">
                      <span
                        v-for="rcpt in child.receipts"
                        :key="rcpt.id"
                        class="receipt-thumb"
                        :title="receiptTitle(rcpt)"
                      >
                        <a
                          v-if="receiptUrls[rcpt.id]"
                          :href="receiptUrls[rcpt.id]"
                          target="_blank"
                          rel="noopener"
                          class="receipt-thumb-link"
                        >
                          <span v-if="isPdfReceipt(rcpt.mime_type, rcpt.original_name)" class="receipt-thumb-pdf">PDF</span>
                          <img v-else :src="receiptUrls[rcpt.id]" alt="Comprobante" />
                        </a>
                        <span v-else-if="rcpt.missing" class="receipt-thumb-missing">!</span>
                        <span v-else class="receipt-thumb-loading">…</span>
                        <button
                          type="button"
                          class="receipt-remove"
                          title="Eliminar comprobante"
                          @click="removeReceipt(rcpt.id)"
                        >✕</button>
                      </span>
                      <label class="receipt-add" title="Agregar comprobantes (imágenes o PDF)">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          hidden
                          @change="(e) => uploadReceipts(child.id, e)"
                        />
                        +
                      </label>
                    </div>
                  </td>
                  <td class="ledger-col-actions">
                    <div class="ledger-row-actions">
                      <button type="button" class="ledger-icon-btn" title="Editar pago" aria-label="Editar pago" @click="openPaymentForm(row, child)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <button type="button" class="ledger-icon-btn is-danger" title="Eliminar pago" aria-label="Eliminar pago" @click="removeRow(child)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>

                <tr class="is-child is-add">
                  <td class="salary-child-cell"><span class="salary-child-mark" aria-hidden="true">↳</span></td>
                  <td colspan="9">
                    <button type="button" class="salary-add-payment" @click="openPaymentForm(row)">
                      + Registrar un pago de este salario
                    </button>
                  </td>
                </tr>
              </template>
              </template>
            </tbody>
          </table>
        </div>

        <LedgerPagination
          v-model:page="page"
          v-model:page-size="pageSize"
          :total-pages="totalPages"
          :range="range"
          noun="pagos"
        />
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiFetch } from '../../apiClient.js';
import { currencySymbol, dayOnly, formatAmount, formatDate } from './format.js';
import { isPdfReceipt, loadReceiptUrl } from './receiptImage.js';
import { BANCOS } from './incomeOptions.js';
import { useLedgerTable } from './useLedgerTable.js';
import LedgerPagination from './LedgerPagination.vue';
import './ledger.css';

const props = defineProps({
  openFormTrigger: { type: Number, default: 0 }
});

const isFormOpen = ref(false);
const isSaving = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

// Debe coincidir con MAX_FINANCE_RECEIPTS del backend.
const MAX_RECEIPTS = 10;

const rows = ref([]);
const receiptUrls = reactive({});
/** Qué acuerdos tienen sus pagos a la vista. */
const expanded = reactive({});
/* El formulario de "salario por proyecto" y el de "pago de un salario". */
const agreementOpen = ref(false);
const projects = ref([]);
const agreementForm = reactive({ projectId: '', monto: '', detalle: '' });
const paymentParent = ref(null);
/** El pago que se está editando; null = se está registrando uno nuevo. */
const paymentEditing = ref(null);
const paymentPanel = ref(null);
const paymentFileInput = ref(null);
let pendingPaymentFiles = [];
const paymentForm = reactive({
  fecha: new Date().toISOString().slice(0, 10), monto: '', estado: 'pagado', metodoPago: '', banco: '', detalle: ''
});
const fileInput = ref(null);
const editingRow = ref(null);
const statusSavingId = ref(null);
let pendingFiles = [];

watch(() => props.openFormTrigger, (val) => {
  if (val > 0) openCreate();
});

const {
  search, estado: estadoFilter, banco: bancoFilter, sort, page, pageSize,
  filtered, paged, totalPages, range, toggleSort, sortCaret, clearFilters
} = useLedgerTable(rows, {
  searchText: (row) => [row.persona, row.cargo, row.periodo, row.detalle, row.metodo_pago, row.banco]
    .filter(Boolean).join(' '),
  sorters: {
    fecha: (row) => dayOnly(row.fecha),
    persona: (row) => row.persona || '',
    // El monto se guarda en negativo: se ordena por su magnitud para que
    // "mayor primero" siga siendo el salario más alto.
    monto: (row) => Math.abs(Number(row.monto) || 0)
  },
  defaultSort: { key: 'fecha', dir: 'desc' }
});

/**
 * Totales del subconjunto que se está mirando. Cada moneda se suma por
 * separado: juntarlas daría una cifra que no significa nada.
 *
 * Lo que suma es la plata que SALE: los pagos —sueltos y los de cada
 * acuerdo—, nunca el acuerdo en sí. Contarlo además de sus pagos mostraría el
 * doble de lo que se pagó, que es justo la cifra por la que se abre esta
 * pestaña. Lo acordado y todavía sin pagar va en su propio recuadro.
 */
const totals = computed(() => {
  let soles = 0;
  let dolares = 0;
  let pendientes = 0;
  let comprometido = 0;
  const personas = new Set();

  const sumarPago = (row) => {
    const monto = Number(row.monto) || 0;
    if (row.moneda === 'dolares') dolares += monto;
    else soles += monto;
    if (row.estado === 'pendiente') pendientes += 1;
  };

  for (const row of filtered.value) {
    if (row.persona) personas.add(row.persona.toLowerCase());
    if (row.kind === 'acuerdo') {
      comprometido += Number(row.pending_amount) || 0;
      for (const child of row.children || []) sumarPago(child);
    } else {
      sumarPago(row);
    }
  }
  return { soles, dolares, pendientes, personas: personas.size, comprometido };
});

function toggleExpand(id) {
  expanded[id] = !expanded[id];
  if (expanded[id]) hydrateReceipts();
}

/** El estado de un acuerdo se DERIVA de sus pagos, no se guarda. */
function agreementLabel(row) {
  const pagado = Number(row.paid_amount) || 0;
  const acordado = Math.abs(Number(row.monto) || 0);
  if (pagado <= 0) return 'Sin pagos';
  if (pagado >= acordado - 0.01) return '✓ Cubierto';
  return `${row.paid_percent}% pagado`;
}

function agreementPillClass(row) {
  const pagado = Number(row.paid_amount) || 0;
  const acordado = Math.abs(Number(row.monto) || 0);
  if (pagado <= 0) return 'pill-warning';
  return pagado >= acordado - 0.01 ? 'pill-success' : 'pill-info';
}

/** Los tres últimos meses como sugerencia de periodo, el actual primero. */
const PERIODO_SUGERIDOS = (() => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = d.toLocaleDateString('es-PE', { month: 'long' });
    out.push(`${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`);
  }
  return out;
})();

function emptyForm() {
  return {
    persona: '',
    cargo: '',
    fecha: new Date().toISOString().slice(0, 10),
    periodo: '',
    monto: '',
    moneda: 'soles',
    estado: 'pagado',
    metodoPago: '',
    banco: '',
    detalle: ''
  };
}

const form = reactive(emptyForm());

function onFileChange(event) {
  pendingFiles = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
}

function resetForm() {
  Object.assign(form, emptyForm());
  pendingFiles = [];
  if (fileInput.value) fileInput.value.value = '';
}

/** Texto del tooltip de una miniatura, avisando si el archivo ya no está. */
function receiptTitle(rcpt) {
  const name = rcpt.original_name || 'Comprobante';
  return rcpt.missing ? `${name} — el archivo ya no está en el servidor` : name;
}

function openCreate() {
  editingRow.value = null;
  resetForm();
  isFormOpen.value = true;
}

function closeForm() {
  isFormOpen.value = false;
  editingRow.value = null;
  resetForm();
}

/** Abre el formulario con los datos del pago para editarlo en su sitio. */
function startEdit(row) {
  editingRow.value = row;
  resetForm();
  Object.assign(form, {
    persona: row.persona || '',
    cargo: row.cargo || '',
    fecha: dayOnly(row.fecha),
    periodo: row.periodo || '',
    // Se edita en positivo; el servidor le vuelve a poner el signo de egreso.
    monto: row.monto != null ? Math.abs(Number(row.monto)) : '',
    moneda: row.moneda || 'soles',
    estado: row.estado || 'pagado',
    metodoPago: row.metodo_pago || '',
    banco: row.banco || '',
    detalle: row.detalle || ''
  });
  isFormOpen.value = true;
}

function releaseUrls() {
  for (const key of Object.keys(receiptUrls)) {
    URL.revokeObjectURL(receiptUrls[key]);
    delete receiptUrls[key];
  }
}

function forgetReceiptUrl(id) {
  if (receiptUrls[id]) {
    URL.revokeObjectURL(receiptUrls[id]);
    delete receiptUrls[id];
  }
}

/**
 * Solo se descargan las miniaturas de la página visible: las filas y, de los
 * acuerdos desplegados, sus pagos (los plegados no se ven, no se piden).
 */
async function hydrateReceipts() {
  const visibles = paged.value.flatMap((row) => (
    row.kind === 'acuerdo' && expanded[row.id] ? [row, ...(row.children || [])] : [row]
  ));
  await Promise.all(visibles.map(async (row) => {
    await Promise.all((row.receipts || []).map(async (rcpt) => {
      // `missing` lo marca el backend: el archivo ya no está en disco, así que
      // no tiene sentido pedirlo (la fila muestra el aviso en su lugar).
      if (rcpt.missing || receiptUrls[rcpt.id]) return;
      try {
        receiptUrls[rcpt.id] = await loadReceiptUrl(`/api/finance/salary-receipts/${rcpt.id}`);
      } catch {
        rcpt.missing = true;
      }
    }));
  }));
}

watch(paged, hydrateReceipts);

function flashSuccess(message) {
  successMessage.value = message;
  setTimeout(() => { successMessage.value = ''; }, 3000);
}

async function fetchRows() {
  isLoading.value = true;
  try {
    const response = await apiFetch('/api/finance/salaries');
    const data = await response.json();
    // Un fallo del servidor no puede parecer "sin salarios registrados".
    if (!response.ok) throw new Error(data.error || 'No se pudieron obtener los salarios.');
    rows.value = data.salaries || [];
    await hydrateReceipts();
  } catch (error) {
    errorMessage.value = error.message || 'No se pudieron obtener los salarios.';
  } finally {
    isLoading.value = false;
  }
}

async function submit() {
  isSaving.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const editing = editingRow.value;
    // Multipart y no JSON: el mismo envío lleva los comprobantes adjuntos.
    const fd = new FormData();
    for (const [key, value] of Object.entries(form)) fd.append(key, value ?? '');
    for (const file of pendingFiles) fd.append('receipts', file);

    const response = await apiFetch(
      editing ? `/api/finance/salaries/${editing.id}` : '/api/finance/salaries',
      { method: editing ? 'PUT' : 'POST', body: fd }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el salario.');

    flashSuccess(editing
      ? `Salario de ${data.salary?.persona || 'la persona'} actualizado.`
      : `Salario de ${data.salary?.persona || 'la persona'} registrado.`);
    closeForm();
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

/* ------------------- Salario por proyecto y sus pagos ------------------- */

async function openAgreementForm() {
  agreementOpen.value = true;
  Object.assign(agreementForm, { projectId: '', monto: '', detalle: '' });
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/finance/salaries/projects');
    const data = await response.json();
    if (response.ok) projects.value = data.projects || [];
  } catch {
    // Sin la lista el formulario no sirve, pero el resto de la pestaña sí.
  }
}

/**
 * Registra el salario de un proyecto. A quién se le paga NO viaja: lo resuelve
 * el servidor con el responsable del proyecto, que es el único que sabe quién
 * es hoy — mandarlo desde acá sería copiar un nombre que puede estar viejo.
 */
async function submitAgreement() {
  if (!agreementForm.projectId || !(Number(agreementForm.monto) > 0)) return;
  isSaving.value = true;
  errorMessage.value = '';
  try {
    const response = await apiFetch('/api/finance/salaries/agreement', {
      method: 'POST',
      body: JSON.stringify({
        projectId: Number(agreementForm.projectId),
        monto: Number(agreementForm.monto),
        detalle: agreementForm.detalle
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo registrar el salario del proyecto.');
    flashSuccess(`Salario de ${data.salary?.persona || 'la persona'} registrado.`);
    agreementOpen.value = false;
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

/**
 * Abre el formulario de pago de un acuerdo: vacío para registrar uno nuevo, o
 * con los datos de `child` para editarlo. Es el mismo formulario a propósito:
 * dos formularios para el mismo pago terminan pidiendo campos distintos.
 */
async function openPaymentForm(row, child = null) {
  paymentParent.value = row;
  paymentEditing.value = child;
  pendingPaymentFiles = [];
  if (paymentFileInput.value) paymentFileInput.value.value = '';
  if (child) {
    Object.assign(paymentForm, {
      fecha: dayOnly(child.fecha),
      // Se edita en positivo; el servidor le vuelve a poner el signo de egreso.
      monto: String(Math.abs(Number(child.monto) || 0)),
      estado: child.estado || 'pagado',
      metodoPago: child.metodo_pago || '',
      banco: child.banco || '',
      detalle: child.detalle || ''
    });
  } else {
    Object.assign(paymentForm, {
      fecha: new Date().toISOString().slice(0, 10),
      // Se propone lo que falta: el caso corriente es cubrir el saldo, y si es
      // un pago parcial se corrige escribiendo el monto.
      monto: row.pending_amount > 0 ? String(row.pending_amount) : '',
      estado: 'pagado',
      // La cuenta y el método del acuerdo, si los tiene, como punto de partida.
      metodoPago: row.metodo_pago || '',
      banco: row.banco || '',
      detalle: ''
    });
  }
  errorMessage.value = '';
  // El formulario se abre arriba de la tabla: con la fila del pago más abajo,
  // sin desplazarse parece que el lápiz no hizo nada.
  await nextTick();
  paymentPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closePaymentForm() {
  paymentParent.value = null;
  paymentEditing.value = null;
  pendingPaymentFiles = [];
}

function onPaymentFileChange(event) {
  pendingPaymentFiles = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
}

/** El % que representa lo que se está escribiendo, mientras se escribe. */
const paymentPercent = computed(() => {
  const base = Math.abs(Number(paymentParent.value?.monto) || 0);
  const monto = Number(paymentForm.monto) || 0;
  if (!base || monto <= 0) return null;
  return Math.round((monto / base) * 1000) / 10;
});

async function submitPayment() {
  if (!paymentParent.value || !(Number(paymentForm.monto) > 0)) return;
  isSaving.value = true;
  errorMessage.value = '';
  try {
    const editing = paymentEditing.value;
    const fd = new FormData();
    fd.append('fecha', paymentForm.fecha);
    fd.append('monto', String(Number(paymentForm.monto)));
    fd.append('estado', paymentForm.estado);
    fd.append('metodoPago', paymentForm.metodoPago);
    fd.append('banco', paymentForm.banco);
    fd.append('detalle', paymentForm.detalle);
    // El mismo envío lleva los comprobantes: alta y edición los guardan en
    // uploads/finance-receipts/, como los de los pagos sueltos.
    for (const file of pendingPaymentFiles) fd.append('receipts', file);
    if (editing) {
      // La edición reescribe la fila entera: lo que este formulario no
      // muestra viaja tal como está para no borrarlo.
      fd.append('moneda', editing.moneda || paymentParent.value.moneda || 'soles');
      fd.append('cargo', editing.cargo || '');
      fd.append('periodo', editing.periodo || '');
    }
    const response = await apiFetch(
      editing ? `/api/finance/salaries/${editing.id}` : `/api/finance/salaries/${paymentParent.value.id}/payments`,
      { method: editing ? 'PUT' : 'POST', body: fd }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || (editing ? 'No se pudo guardar el pago.' : 'No se pudo registrar el pago.'));
    // Se deja abierto el acuerdo al que se le acaba de pagar: lo primero que
    // se mira después de registrar es cómo quedó la cuenta.
    expanded[paymentParent.value.id] = true;
    flashSuccess(editing ? 'Pago actualizado.' : 'Pago registrado.');
    closePaymentForm();
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

async function toggleStatus(row) {
  const nextEstado = row.estado === 'pendiente' ? 'pagado' : 'pendiente';
  statusSavingId.value = row.id;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/salaries/${row.id}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nextEstado })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el estado del salario.');
    row.estado = data.salary?.estado ?? nextEstado;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    statusSavingId.value = null;
  }
}

async function uploadReceipts(salaryId, event) {
  const files = Array.from(event.target.files || []).slice(0, MAX_RECEIPTS);
  event.target.value = '';
  if (files.length === 0) return;
  errorMessage.value = '';
  try {
    const fd = new FormData();
    for (const file of files) fd.append('receipts', file);
    const response = await apiFetch(`/api/finance/salaries/${salaryId}/receipts`, {
      method: 'POST',
      body: fd
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo subir el comprobante.');
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function removeReceipt(receiptId) {
  if (!confirm('¿Eliminar este comprobante?')) return;
  try {
    const response = await apiFetch(`/api/finance/salary-receipts/${receiptId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el comprobante.');
    forgetReceiptUrl(receiptId);
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

async function removeRow(row) {
  if (!confirm(`¿Eliminar el salario de ${row.persona} del ${formatDate(row.fecha)}? Esta acción no se puede deshacer.`)) return;
  errorMessage.value = '';
  try {
    const response = await apiFetch(`/api/finance/salaries/${row.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('No se pudo eliminar el salario.');
    // Borrar un acuerdo se lleva sus pagos, y con ellos sus comprobantes.
    for (const item of [row, ...(row.children || [])]) {
      for (const rcpt of item.receipts || []) forgetReceiptUrl(rcpt.id);
    }
    if (editingRow.value?.id === row.id) closeForm();
    if (paymentEditing.value?.id === row.id || paymentParent.value?.id === row.id) closePaymentForm();
    flashSuccess('Salario eliminado.');
    await fetchRows();
  } catch (error) {
    errorMessage.value = error.message;
  }
}

onMounted(fetchRows);
onBeforeUnmount(releaseUrls);
</script>

<style scoped>
.salary-amount-out { color: #EF4444; }

/* ------------------- Salario por proyecto y sus pagos ------------------- */

/* El acuerdo es la cabecera de su grupo: una barra a la izquierda lo dice sin
   texto, y los pagos de abajo se ven como lo que son, filas colgando de él. */
.is-agreement > td:first-child {
  box-shadow: inset 3px 0 0 var(--primary);
}

.salary-toggle {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0 0.3rem 0 0;
  font-size: 0.9rem;
  line-height: 1;
  color: var(--text-sub);
}

.salary-project {
  display: inline-block;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* Cuánto va pagado del acuerdo, bajo su monto. Más chico y en gris: el dato
   principal sigue siendo el monto acordado. */
.salary-progress {
  display: block;
  margin-top: 0.12rem;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
}

.is-child > td {
  background: var(--surface-1);
}

.salary-child-cell {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding-left: 1.1rem !important;
}

.salary-child-mark {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.salary-percent {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--text-sub);
}

.salary-add-payment {
  border: 1px dashed var(--border-color);
  border-radius: 999px;
  background: none;
  padding: 0.15rem 0.7rem;
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--primary);
  cursor: pointer;
}

.salary-add-payment:hover {
  border-style: solid;
  border-color: var(--primary);
}

.is-add > td { padding-top: 0.25rem; padding-bottom: 0.45rem; }

.salary-form-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
</style>
