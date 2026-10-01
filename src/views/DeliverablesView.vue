<template>
  <main class="container-fluid deliverables-page">
    <!-- Esta pantalla la usa a diario una persona que no trabaja con software:
         por eso tiene su propia escala (texto y botones más grandes que el
         resto del panel), cada estado se explica con una frase que dice qué
         hacer, y no hay acciones escondidas detrás de un icono suelto. Todo se
         lee en una sola columna, así que funciona igual en el celular que en el
         escritorio: no hay tablas que se desborden de lado. -->
    <header class="dv-header">
      <div class="dv-header-text">
        <h2 class="dv-title"><span aria-hidden="true">📦</span> Entregables</h2>
        <p class="dv-subtitle">
          Qué le falta entregar a cada cliente y qué ya se entregó.
          La entrega se hace por fuera (correo, WhatsApp, en persona) y acá se deja registrada.
        </p>
      </div>
      <button type="button" class="dv-btn dv-btn-ghost" :disabled="isLoading" @click="fetchOverview">
        {{ isLoading ? 'Cargando…' : '🔄 Actualizar' }}
      </button>
    </header>

    <div v-if="loadError" class="dv-alert" role="alert">
      <strong>⚠️ Algo salió mal</strong>
      <p>{{ loadError }}</p>
      <button type="button" class="dv-btn dv-btn-ghost" @click="fetchOverview">Reintentar</button>
    </div>

    <!-- Resumen del día. Cuenta SIEMPRE todo el tablero, no lo filtrado, y al
         tocar un recuadro la lista de abajo se queda solo con esos. -->
    <section class="dv-summary" aria-label="Resumen de entregables">
      <p class="dv-summary-hint">Toca un recuadro para ver solo esos entregables.</p>
      <div class="dv-kpi-grid">
        <button
          v-for="tile in kpiTiles"
          :key="tile.key"
          type="button"
          class="dv-kpi"
          :class="[`is-${tile.tone}`, { 'is-active': stateFilter === tile.key }]"
          :aria-pressed="stateFilter === tile.key"
          @click="toggleStateFilter(tile.key)"
        >
          <span class="dv-kpi-value">{{ tile.value }}</span>
          <span class="dv-kpi-label">{{ tile.icon }} {{ tile.label }}</span>
          <span class="dv-kpi-hint">{{ tile.hint }}</span>
          <span v-if="stateFilter === tile.key" class="dv-kpi-active">✓ Viendo solo estos · toca para quitar</span>
        </button>
      </div>
    </section>

    <section class="dv-filters" aria-label="Buscar y filtrar">
      <label class="dv-search-wrap">
        <span class="dv-sr-only">Buscar</span>
        <span class="dv-search-icon" aria-hidden="true">🔎</span>
        <input
          v-model="search"
          type="search"
          class="dv-search"
          placeholder="Buscar por cliente, proyecto o entregable…"
        />
        <button
          v-if="search"
          type="button"
          class="dv-search-clear"
          title="Borrar la búsqueda"
          @click="search = ''"
        >✕</button>
      </label>

      <button
        type="button"
        class="dv-toggle"
        :class="{ 'is-on': onlyNeedsAttention }"
        :aria-pressed="onlyNeedsAttention"
        @click="onlyNeedsAttention = !onlyNeedsAttention"
      >
        {{ onlyNeedsAttention ? '☑' : '☐' }} Solo lo urgente
      </button>

      <p class="dv-filter-count">
        Viendo <strong>{{ visibleProjects.length }}</strong> de {{ overview.projects.length }} proyectos
      </p>

      <button v-if="hasFilters" type="button" class="dv-btn dv-btn-ghost dv-clear" @click="clearFilters">
        ✕ Quitar filtros
      </button>
    </section>

    <p v-if="isLoading && overview.projects.length === 0" class="dv-empty">Cargando entregables…</p>

    <div v-else-if="visibleProjects.length === 0" class="dv-empty">
      <template v-if="overview.projects.length === 0">
        <p>Todavía no hay proyectos.</p>
        <p class="dv-empty-sub">
          Un proyecto nace cuando una venta se cierra en el
          <router-link to="/admin/leads">Funnel de Ventas</router-link>.
        </p>
      </template>
      <template v-else>
        <p>Ningún entregable coincide con lo que estás buscando.</p>
        <button type="button" class="dv-btn dv-btn-ghost" @click="clearFilters">✕ Quitar filtros</button>
      </template>
    </div>

    <section v-for="project in visibleProjects" :key="project.project_id" class="dv-project">
      <header class="dv-project-head">
        <div class="dv-project-id">
          <h3 class="dv-project-client">
            {{ project.client_name || project.client_email || 'Cliente sin nombre' }}
          </h3>
          <router-link :to="`/admin/projects/${project.project_id}`" class="dv-project-topic">
            {{ project.topic }}
          </router-link>
          <p v-if="project.university || project.field_of_study" class="dv-project-extra">
            {{ [project.university, project.field_of_study].filter(Boolean).join(' · ') }}
          </p>
        </div>
        <div class="dv-project-meta">
          <span
            v-for="chip in projectStateChips(project)"
            :key="chip.key"
            class="dv-chip"
            :class="`is-${chip.tone}`"
          >{{ chip.icon }} {{ chip.value }} {{ chip.label }}</span>
          <span class="dv-chip">Tareas {{ project.completed_tasks }}/{{ project.total_tasks }}</span>
        </div>
      </header>

      <p v-if="project.is_locked" class="dv-note is-warn">
        🔒 Este proyecto está esperando que Finanzas confirme el primer pago
        <template v-if="project.initial_payment_code">({{ project.initial_payment_code }})</template>.
      </p>

      <div v-if="sortedRows(project).length > 0" class="dv-list">
        <article
          v-for="row in sortedRows(project)"
          :key="row.id"
          class="dv-item"
          :class="[`is-${rowTone(row)}`, { 'is-open': openMoreId === row.id }]"
        >
          <div class="dv-item-head">
            <h4 class="dv-item-title">{{ row.title }}</h4>
            <div class="dv-item-tags">
              <!-- "Fuera de fecha" va como marca aparte y no reemplazando al
                   estado: son dos cosas distintas (en qué va la entrega, y si
                   llegó tarde) y juntarlas escondía una de las dos. -->
              <span v-if="row.is_overdue" class="dv-state is-bad">⚠️ Fuera de fecha</span>
              <span class="dv-state" :class="`is-${stateTone(row.state)}`">
                {{ stateIcon(row.state) }} {{ stateLabel(row.state) }}
              </span>
            </div>
          </div>

          <p class="dv-item-todo" :class="`is-${rowTone(row)}`">{{ todoSentence(row) }}</p>

          <p v-if="row.description" class="dv-item-desc">{{ row.description }}</p>

          <dl class="dv-facts">
            <div class="dv-fact" :class="{ 'is-bad': row.is_overdue }">
              <dt>📅 Fecha pactada</dt>
              <dd>{{ dueText(row) }}</dd>
            </div>
            <div v-if="row.income_id" class="dv-fact" :class="{ 'is-bad': row.payment_overdue }">
              <dt>💰 Pago</dt>
              <dd>
                {{ paymentLabel(row) }} · cuota {{ row.income_cuota }} ({{ row.income_code }})
                <template v-if="row.payment_overdue"> · la cuota ya venció</template>
              </dd>
            </div>
            <div v-else class="dv-fact">
              <dt>💰 Pago</dt>
              <dd>Este entregable no depende de ninguna cuota.</dd>
            </div>
            <div v-if="row.status === 'entregado'" class="dv-fact">
              <dt>📤 Se entregó</dt>
              <dd>
                el {{ formatDate(row.delivered_at) }} · {{ channelLabel(row.delivery_channel) }}
                <template v-if="row.delivered_by_name"> · lo registró {{ row.delivered_by_name }}</template>
              </dd>
            </div>
            <div v-if="row.notes" class="dv-fact">
              <dt>📝 Nota</dt>
              <dd>{{ row.notes }}</dd>
            </div>
          </dl>

          <button
            v-if="row.has_attachment"
            type="button"
            class="dv-file-btn"
            @click="downloadAttachment(row)"
          >📎 Descargar {{ row.attachment_original_name }}</button>

          <!-- Cuota sin pagar: no hay botón que apretar. El aviso ocupa su
               lugar y dice de quién depende, para que no parezca una falla ni
               haya que preguntar. La regla también está en el backend
               (`blocksDelivery`): acá solo se pinta lo que él decidió. -->
          <p v-if="row.delivery_blocked" class="dv-locked">
            🔒 <strong>Todavía no se puede entregar.</strong>
            {{ row.delivery_blocked_reason }}
            Cuando Finanzas registre el pago, el botón aparece solo.
          </p>

          <div class="dv-item-actions">
            <button
              v-if="row.status !== 'entregado' && !row.delivery_blocked"
              type="button"
              class="dv-btn dv-btn-primary"
              @click="openDeliverModal(project, row)"
            >✓ Marcar como entregado</button>

            <button
              type="button"
              class="dv-btn dv-btn-ghost dv-more"
              :aria-expanded="openMoreId === row.id"
              @click="toggleMore(row.id)"
            >{{ openMoreId === row.id ? '✕ Cerrar opciones' : '⋯ Más opciones' }}</button>
          </div>

          <!-- Editar, deshacer y eliminar viven acá adentro a propósito: son lo
               que no se hace todos los días, y tenerlas sueltas al lado del
               botón principal era pedir un toque equivocado en el celular. -->
          <div v-if="openMoreId === row.id" class="dv-more-panel">
            <button type="button" class="dv-btn dv-btn-ghost" @click="openEditModal(project, row)">
              ✎ Editar nombre, fecha o cuota
            </button>
            <button
              v-if="row.status === 'entregado'"
              type="button"
              class="dv-btn dv-btn-ghost"
              :disabled="busyId === row.id"
              @click="undeliver(row)"
            >↩ No estaba entregado (deshacer)</button>
            <button
              type="button"
              class="dv-btn dv-btn-danger"
              :disabled="busyId === row.id"
              @click="removeDeliverable(row)"
            >🗑 Eliminar este entregable</button>
          </div>
        </article>
      </div>

      <p v-else-if="project.deliverables.length === 0" class="dv-note">
        Este proyecto todavía no tiene entregables. Agrega el primero con el botón de abajo.
      </p>
      <p v-else class="dv-note">
        Ninguno de sus {{ project.deliverables.length }} entregables está en «{{ stateLabel(stateFilter) }}».
      </p>

      <div class="dv-project-actions">
        <button type="button" class="dv-btn dv-btn-ghost" @click="openCreateModal(project)">
          ➕ Agregar entregable
        </button>
        <!-- Lo que ya está escrito en el contrato no se vuelve a teclear. Copia,
             no lectura en vivo: un contrato emitido no cambia porque alguien
             reprograme una entrega. -->
        <button
          v-if="project.contract_plan_available > 0"
          type="button"
          class="dv-btn dv-btn-ghost"
          :disabled="busyId === `import-${project.project_id}`"
          @click="importFromContract(project)"
        >
          📄 Traer los {{ project.contract_plan_available }} del contrato
        </button>
      </div>
    </section>

    <!-- Alta / edición del plan -->
    <div v-if="editModal.open" class="modal-overlay dv-overlay" @click.self="closeEditModal">
      <div class="dv-sheet" role="dialog" aria-modal="true">
        <header class="dv-sheet-head">
          <h3 class="dv-sheet-title">{{ editModal.id ? '✎ Editar entregable' : '➕ Nuevo entregable' }}</h3>
          <button type="button" class="dv-sheet-close" title="Cerrar" @click="closeEditModal">✕</button>
        </header>

        <form class="dv-sheet-body" @submit.prevent="saveDeliverable">
          <div class="dv-field">
            <label class="dv-label" for="dv-title">¿Qué se entrega?</label>
            <input
              id="dv-title"
              v-model="editModal.title"
              type="text"
              class="dv-input"
              placeholder="Por ejemplo: Capítulo I y II"
              required
            />
          </div>

          <div class="dv-field">
            <label class="dv-label" for="dv-desc">Detalle <span class="dv-optional">(opcional)</span></label>
            <textarea id="dv-desc" v-model="editModal.description" class="dv-input" rows="2"></textarea>
          </div>

          <div class="dv-field">
            <label class="dv-label" for="dv-due">¿Para qué fecha quedó?</label>
            <input id="dv-due" v-model="editModal.dueDate" type="date" class="dv-input" />
          </div>

          <div class="dv-field">
            <label class="dv-label" for="dv-income">¿Se entrega contra alguna cuota?</label>
            <select id="dv-income" v-model="editModal.incomeId" class="dv-input">
              <option value="">No depende de ninguna cuota</option>
              <option v-for="item in editModal.schedule" :key="item.income_id" :value="item.income_id">
                Cuota {{ item.cuota }} · {{ item.code }} ({{ item.estado }})
              </option>
            </select>
            <p class="dv-help">
              Elegir una cuota no bloquea nada. Solo sirve para que esta pantalla avise si se
              entrega antes de que Finanzas confirme el pago, o si ya se cobró y falta entregar.
            </p>
          </div>

          <p v-if="editModal.error" class="dv-sheet-error">⚠️ {{ editModal.error }}</p>

          <footer class="dv-sheet-actions">
            <button type="submit" class="dv-btn dv-btn-primary" :disabled="editModal.saving">
              {{ editModal.saving ? 'Guardando…' : 'Guardar' }}
            </button>
            <button type="button" class="dv-btn dv-btn-ghost" @click="closeEditModal">Cancelar</button>
          </footer>
        </form>
      </div>
    </div>

    <!-- Registro de la entrega -->
    <div v-if="deliverModal.open" class="modal-overlay dv-overlay" @click.self="closeDeliverModal">
      <div class="dv-sheet" role="dialog" aria-modal="true">
        <header class="dv-sheet-head">
          <h3 class="dv-sheet-title">✓ Registrar entrega</h3>
          <button type="button" class="dv-sheet-close" title="Cerrar" @click="closeDeliverModal">✕</button>
        </header>

        <form class="dv-sheet-body" @submit.prevent="submitDelivery">
          <p class="dv-sheet-subject">{{ deliverModal.title }}</p>

          <div class="dv-field">
            <label class="dv-label" for="dv-delivered-at">¿Qué día se entregó?</label>
            <input id="dv-delivered-at" v-model="deliverModal.deliveredAt" type="date" class="dv-input" />
          </div>

          <div class="dv-field">
            <label class="dv-label" for="dv-channel">¿Por dónde se lo mandaste?</label>
            <select id="dv-channel" v-model="deliverModal.channel" class="dv-input">
              <option value="">Prefiero no indicarlo</option>
              <option v-for="c in CHANNELS" :key="c.value" :value="c.value">{{ c.label }}</option>
            </select>
          </div>

          <div class="dv-field">
            <label class="dv-label">Copia del archivo <span class="dv-optional">(opcional)</span></label>
            <label class="dv-file-pick">
              <input type="file" @change="pickFile($event)" />
              <span>📎 {{ deliverModal.file ? deliverModal.file.name : 'Elegir un archivo de tu equipo' }}</span>
            </label>
            <button
              v-if="deliverModal.file"
              type="button"
              class="dv-file-clear"
              @click="deliverModal.file = null"
            >✕ Quitar el archivo</button>
            <p class="dv-help">
              Es solo un respaldo nuestro. El cliente ya lo recibió por donde se lo mandaste;
              esto sirve para saber mañana exactamente qué se le envió.
            </p>
          </div>

          <div class="dv-field">
            <label class="dv-label" for="dv-notes">Nota <span class="dv-optional">(opcional)</span></label>
            <textarea id="dv-notes" v-model="deliverModal.notes" class="dv-input" rows="2"></textarea>
          </div>

          <p v-if="deliverModal.warnUnpaid" class="dv-sheet-warn">
            ⚠️ El cliente ya pagó esta cuota, pero Finanzas todavía no la revisó. Se puede
            registrar igual: va a quedar marcado como <strong>«Entregado sin cobrar»</strong>
            hasta que la confirmen.
          </p>

          <p v-if="deliverModal.error" class="dv-sheet-error">⚠️ {{ deliverModal.error }}</p>

          <footer class="dv-sheet-actions">
            <button type="submit" class="dv-btn dv-btn-primary" :disabled="deliverModal.saving">
              {{ deliverModal.saving ? 'Registrando…' : '✓ Sí, ya se entregó' }}
            </button>
            <button type="button" class="dv-btn dv-btn-ghost" @click="closeDeliverModal">Cancelar</button>
          </footer>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { apiFetch } from '../apiClient.js';

/**
 * Módulo Entregables: CRUD sobre la tabla `deliverables` más el cruce con el
 * cobro. El estado operativo lo calcula el backend (`GET /api/deliverables`) y
 * acá solo se pinta, para que no se derive de dos formas distintas.
 *
 * No se muestran importes a propósito: una cuota se nombra por su código, igual
 * que en el módulo de Proyectos. El dinero se consulta en Finanzas.
 */

const overview = ref({ projects: [], totals: emptyTotals() });
const isLoading = ref(false);
const loadError = ref('');
const search = ref('');
const stateFilter = ref('');
const onlyNeedsAttention = ref(false);
const busyId = ref(null);

const CHANNELS = [
  { value: 'correo', label: '📧 Correo' },
  { value: 'whatsapp', label: '💬 WhatsApp' },
  { value: 'presencial', label: '🤝 Presencial' },
  { value: 'drive', label: '📁 Drive / enlace' },
  { value: 'otro', label: 'Otro' }
];

function emptyTotals() {
  return {
    projects: 0, projects_needing_attention: 0, deliverables: 0,
    entregado: 0, sin_cobrar: 0, por_entregar: 0, pendiente: 0, overdue: 0
  };
}

/**
 * Los textos están escritos para quien atiende las entregas, no para quien
 * programó la pantalla: el `hint` dice qué significa el número y el `todo` qué
 * hay que hacer con esa fila. Por eso no se reutiliza el `pending_reason` que
 * manda el backend, que está redactado desde el lado del dato.
 */
const STATE_META = {
  por_entregar: {
    label: 'Falta entregar',
    tile: 'Faltan por entregar',
    icon: '📤',
    tone: 'bad',
    hint: 'El cliente ya pagó y todavía no recibe su trabajo',
    todo: 'El pago ya está confirmado: falta hacerle llegar el trabajo.',
    todoNoIncome: 'Falta hacer la entrega. No está atado a ninguna cuota.'
  },
  overdue: {
    label: 'Fuera de fecha',
    icon: '⚠️',
    tone: 'bad',
    hint: 'Ya pasó el día acordado y sigue sin entregarse'
  },
  sin_cobrar: {
    label: 'Entregado sin cobrar',
    tile: 'Entregados sin cobrar',
    icon: '💸',
    tone: 'warn',
    hint: 'Ya se entregó, pero Finanzas aún no confirma el pago',
    todo: 'Ya se entregó. Falta que Finanzas confirme el pago de la cuota.'
  },
  pendiente: {
    label: 'Todavía no toca',
    icon: '⏳',
    tone: 'neutral',
    hint: 'Sin pago confirmado y sin entregar',
    todo: 'Todavía no toca: falta que paguen y falta entregar.',
    // El cliente YA pagó y solo falta el visto bueno de Finanzas: decirle a
    // quien lee "falta que paguen" sería mentirle sobre un pago que ya entró.
    todoPaidUnverified: 'El cliente ya pagó y Finanzas está revisando el comprobante. Se puede entregar.'
  },
  entregado: {
    label: 'Listo',
    tile: 'Listos',
    icon: '✅',
    tone: 'ok',
    hint: 'Entregado y con el pago confirmado',
    todo: 'Listo: entregado y pagado. No hay nada pendiente.'
  }
};

// Lo urgente primero: así el recuadro que hay que mirar está siempre arriba a
// la izquierda, que es donde cae la vista al abrir la pantalla.
const kpiTiles = computed(() => ['por_entregar', 'overdue', 'sin_cobrar', 'pendiente', 'entregado'].map((key) => ({
  key,
  value: overview.value.totals[key] || 0,
  ...STATE_META[key],
  // El recuadro cuenta varios ('Listos'), la tarjeta describe uno ('Listo').
  label: STATE_META[key].tile || STATE_META[key].label
})));

/*
 * Los nombres de estado que se ven en pantalla salen de acá y NO de
 * `row.state_label`, que es el vocabulario del dominio ("Pendiente",
 * "Entregado"). Si el recuadro de arriba dice "Todavía no toca" y la tarjeta
 * dice "Pendiente", quien lee cree que son dos cosas distintas: dentro de esta
 * pantalla se habla un solo idioma.
 */
const stateLabel = (key) => STATE_META[key]?.label || key;
const stateIcon = (key) => STATE_META[key]?.icon || '';
const stateTone = (key) => STATE_META[key]?.tone || 'neutral';

/** El color de la tarjeta: una entrega fuera de fecha se mira primero. */
const rowTone = (row) => (row.is_overdue ? 'bad' : stateTone(row.state));

function toggleStateFilter(key) {
  stateFilter.value = stateFilter.value === key ? '' : key;
}

const hasFilters = computed(() => Boolean(search.value.trim() || stateFilter.value || onlyNeedsAttention.value));

/**
 * Una sola salida para volver a verlo todo. Sin esto, alguien que tocó un
 * recuadro y una casilla tiene que acordarse de deshacer las dos para entender
 * por qué "le faltan proyectos".
 */
function clearFilters() {
  search.value = '';
  stateFilter.value = '';
  onlyNeedsAttention.value = false;
}

/** Qué fila tiene abierto su panel de "Más opciones" (una a la vez). */
const openMoreId = ref(null);

function toggleMore(id) {
  openMoreId.value = openMoreId.value === id ? null : id;
}

/** "overdue" no es un estado sino una marca que convive con cualquiera. */
function matchesStateFilter(row) {
  if (!stateFilter.value) return true;
  if (stateFilter.value === 'overdue') return row.is_overdue;
  return row.state === stateFilter.value;
}

const rowsFor = (project) => project.deliverables.filter(matchesStateFilter);

/**
 * Orden de la lista: lo que hay que hacer hoy arriba y lo terminado al final.
 * El backend devuelve el orden del plan (`position`), que es el correcto para
 * leer el cronograma pero no para trabajarlo — quien atiende las entregas abre
 * la pantalla para saber qué le falta, no en qué orden se pactó.
 */
const STATE_WEIGHT = { por_entregar: 0, pendiente: 10, sin_cobrar: 20, entregado: 30 };

function rowWeight(row) {
  const base = STATE_WEIGHT[row.state] ?? 40;
  return base - (row.is_overdue ? 5 : 0);
}

function sortedRows(project) {
  return [...rowsFor(project)].sort((a, b) => {
    const byState = rowWeight(a) - rowWeight(b);
    if (byState !== 0) return byState;
    // Entre iguales, primero lo que vence antes; lo que no tiene fecha, al final.
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

function matchesSearch(project) {
  const query = search.value.trim().toLowerCase();
  if (!query) return true;
  return [
    project.topic, project.client_name, project.client_email, project.university, project.field_of_study,
    ...project.deliverables.map((d) => `${d.title} ${d.income_code || ''}`)
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

const visibleProjects = computed(() => overview.value.projects.filter((project) => {
  if (!matchesSearch(project)) return false;
  if (onlyNeedsAttention.value && !project.needs_attention) return false;
  // Con un filtro de estado activo, un proyecto sin ninguna fila de ese estado
  // se esconde en vez de mostrarse vacío.
  if (stateFilter.value && rowsFor(project).length === 0) return false;
  return true;
}));

/** Etiqueta corta para los chips del proyecto: "2 por entregar", no "2 falta entregar". */
const CHIP_LABELS = {
  por_entregar: 'por entregar',
  overdue: 'fuera de fecha',
  sin_cobrar: 'sin cobrar',
  entregado: 'listos'
};

function projectStateChips(project) {
  return ['por_entregar', 'overdue', 'sin_cobrar', 'entregado']
    .filter((key) => (project.counts[key] || 0) > 0)
    .map((key) => ({
      key,
      value: project.counts[key],
      label: CHIP_LABELS[key],
      icon: STATE_META[key].icon,
      tone: STATE_META[key].tone
    }));
}

/**
 * La frase que dice qué hacer con esta fila. Es lo primero que se lee después
 * del título: el nombre del estado solo nombra la situación, y quien usa esta
 * pantalla necesita la acción.
 */
function todoSentence(row) {
  const meta = STATE_META[row.state] || {};
  const paidUnverified = row.income_estado === 'pagado' && meta.todoPaidUnverified;
  const base = paidUnverified
    || (!row.income_id && meta.todoNoIncome)
    || meta.todo
    || row.pending_reason
    || '';
  if (row.is_overdue) {
    const days = daysFromToday(row.due_date);
    const late = days != null && days < 0
      ? ` La fecha pasó hace ${plural(Math.abs(days), 'día', 'días')}.`
      : ' La fecha pactada ya pasó.';
    return `${base}${late}`;
  }
  return base;
}

/** "pagado" en Finanzas significa "con comprobante, a la espera del visto bueno". */
function paymentLabel(row) {
  if (row.income_estado === 'verificado') return '✅ Pago confirmado';
  if (row.income_estado === 'pagado') return '🧾 Pagado, Finanzas lo está revisando';
  return '⏳ Todavía sin pagar';
}

const channelLabel = (value) => CHANNELS.find((c) => c.value === value)?.label || 'no quedó registrado por dónde';

/**
 * Las fechas llegan como `AAAA-MM-DD` (un día de calendario, no un instante):
 * construir un `Date` con ellas las corre un día hacia atrás en Perú, así que se
 * formatean desde el texto. Mismo criterio que `src/views/finance/format.js`.
 */
function formatDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Cuántos días faltan (positivo) o pasaron (negativo) hasta esa fecha. Las dos
 * fechas se convierten a mediodía UTC antes de restar: así el resultado es una
 * cuenta de días de calendario y no depende de la hora ni del huso.
 */
function daysFromToday(iso) {
  if (!iso) return null;
  const toUtc = (value) => {
    const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
    return y && m && d ? Date.UTC(y, m - 1, d) : null;
  };
  const target = toUtc(iso);
  const today = toUtc(todayIso());
  if (target == null || today == null) return null;
  return Math.round((target - today) / 86400000);
}

/**
 * La fecha pactada contada como la contaría una persona ("faltan 3 días",
 * "venció hace 2 días"). El día exacto se sigue mostrando: la cuenta ayuda a
 * decidir, la fecha es la que se habla con el cliente.
 */
function dueText(row) {
  if (!row.due_date) return 'Sin fecha acordada';
  const date = formatDate(row.due_date);
  if (row.status === 'entregado') return date;

  const days = daysFromToday(row.due_date);
  if (days == null) return date;
  if (days === 0) return `${date} · es hoy`;
  if (days === 1) return `${date} · es mañana`;
  if (days === -1) return `${date} · fue ayer`;
  if (days > 1) return `${date} · faltan ${plural(days, 'día', 'días')}`;
  return `${date} · pasó hace ${plural(Math.abs(days), 'día', 'días')}`;
}

/** El `<input type="file">` va oculto dentro de su etiqueta: acá se recoge. */
function pickFile(event) {
  deliverModal.file = event.target.files?.[0] || null;
}

// ------------------------------------------------------------------- LECTURA

async function fetchOverview() {
  isLoading.value = true;
  loadError.value = '';
  // Las filas se vuelven a dibujar: dejar abierto el panel de opciones de una
  // fila que quizá ya no está sería dejarlo apuntando a nada.
  openMoreId.value = null;
  try {
    const response = await apiFetch('/api/deliverables');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al obtener el tablero de entregables.');
    overview.value = { projects: data.projects || [], totals: { ...emptyTotals(), ...(data.totals || {}) } };
  } catch (error) {
    loadError.value = error.message || 'Error de conexión con el servidor.';
  } finally {
    isLoading.value = false;
  }
}

// ----------------------------------------------------------- ALTA Y EDICIÓN

const editModal = reactive({
  open: false, id: null, projectId: null, title: '', description: '', dueDate: '', incomeId: '',
  schedule: [], saving: false, error: ''
});

function openCreateModal(project) {
  Object.assign(editModal, {
    open: true, id: null, projectId: project.project_id, title: '', description: '', dueDate: '',
    incomeId: '', schedule: project.schedule, saving: false, error: ''
  });
}

function openEditModal(project, row) {
  openMoreId.value = null;
  Object.assign(editModal, {
    open: true, id: row.id, projectId: project.project_id, title: row.title,
    description: row.description || '', dueDate: row.due_date || '', incomeId: row.income_id || '',
    schedule: project.schedule, saving: false, error: ''
  });
}

function closeEditModal() {
  editModal.open = false;
}

async function saveDeliverable() {
  editModal.saving = true;
  editModal.error = '';
  try {
    const payload = {
      title: editModal.title,
      description: editModal.description,
      dueDate: editModal.dueDate || null,
      incomeId: editModal.incomeId ? Number(editModal.incomeId) : null
    };
    const response = editModal.id
      ? await apiFetch(`/api/deliverables/${editModal.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
      : await apiFetch('/api/deliverables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, projectId: editModal.projectId })
      });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el entregable.');
    editModal.open = false;
    await fetchOverview();
  } catch (error) {
    editModal.error = error.message;
  } finally {
    editModal.saving = false;
  }
}

async function removeDeliverable(row) {
  // Los avisos están escritos como una pregunta con su consecuencia: quien usa
  // esta pantalla tiene que poder decidir sin saber qué hace el sistema por
  // dentro.
  if (!confirm(`¿Seguro que quieres borrar "${row.title}"?\n\nSe borra también la copia del archivo guardada. Esto no se puede deshacer.`)) return;
  busyId.value = row.id;
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo eliminar el entregable.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

// ------------------------------------------------------------------ ENTREGA

const deliverModal = reactive({
  open: false, id: null, title: '', deliveredAt: '', channel: '', notes: '', file: null,
  warnUnpaid: false, saving: false, error: ''
});

function openDeliverModal(project, row) {
  // El botón no se dibuja si la cuota está sin pagar, pero el tablero puede
  // llevar un rato abierto: si el dato cambió, no se abre el formulario para
  // que nadie llene algo que el servidor va a rechazar.
  if (row.delivery_blocked) {
    loadError.value = `${row.delivery_blocked_reason} No se puede registrar la entrega todavía.`;
    return;
  }

  openMoreId.value = null;
  Object.assign(deliverModal, {
    open: true, id: row.id, title: row.title, deliveredAt: todayIso(), channel: '', notes: row.notes || '',
    file: null,
    // Avisar ANTES y no después: entregar sin el pago verificado se puede, pero
    // quien lo registra tiene que saber que eso es lo que está haciendo.
    warnUnpaid: Boolean(row.income_id) && !row.payment_verified,
    saving: false, error: ''
  });
}

function closeDeliverModal() {
  deliverModal.open = false;
}

async function submitDelivery() {
  deliverModal.saving = true;
  deliverModal.error = '';
  try {
    const formData = new FormData();
    if (deliverModal.deliveredAt) formData.append('deliveredAt', deliverModal.deliveredAt);
    if (deliverModal.channel) formData.append('channel', deliverModal.channel);
    if (deliverModal.notes) formData.append('notes', deliverModal.notes);
    if (deliverModal.file) formData.append('attachment', deliverModal.file);

    const response = await apiFetch(`/api/deliverables/${deliverModal.id}/deliver`, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) {
      // 409 = el servidor frenó la entrega porque la cuota no está pagada. El
      // tablero que se está mirando quedó viejo, así que se vuelve a cargar: el
      // aviso sin la pantalla actualizada deja a la persona sin entender nada.
      if (response.status === 409) fetchOverview();
      throw new Error(data.error || 'No se pudo registrar la entrega.');
    }
    deliverModal.open = false;
    await fetchOverview();
  } catch (error) {
    deliverModal.error = error.message;
  } finally {
    deliverModal.saving = false;
  }
}

async function undeliver(row) {
  if (!confirm(`¿"${row.title}" todavía NO se entregó?\n\nVuelve a quedar pendiente. La copia del archivo se conserva.`)) return;
  busyId.value = row.id;
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}/undeliver`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).error || 'No se pudo revertir la entrega.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

async function importFromContract(project) {
  busyId.value = `import-${project.project_id}`;
  try {
    const response = await apiFetch(`/api/projects/${project.project_id}/deliverables/import-contract`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo importar el cronograma de entregas.');
    await fetchOverview();
  } catch (error) {
    loadError.value = error.message;
  } finally {
    busyId.value = null;
  }
}

/**
 * La descarga va por `apiFetch` y no por un `<a href>`: la ruta exige el Bearer
 * del panel, que un enlace directo no manda. Mismo patrón que el adjunto de un
 * avance en el detalle del proyecto.
 */
async function downloadAttachment(row) {
  try {
    const response = await apiFetch(`/api/deliverables/${row.id}/attachment`);
    if (!response.ok) throw new Error('No se pudo descargar el archivo.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = row.attachment_original_name || 'entregable';
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    loadError.value = error.message;
  }
}

onMounted(fetchOverview);
</script>

<style scoped>
/*
 * ESCALA PROPIA DE ESTA PANTALLA
 *
 * El resto de /admin usa la escala compacta de `src/style.css` (sección
 * "DENSIDAD Y ESTILO DEL PANEL INTERNO"), pensada para quien trabaja todo el
 * día con el panel y quiere ver mucho de un vistazo. Entregables lo usa una
 * persona que no trabaja con software, así que acá el texto, los botones y las
 * zonas de toque son deliberadamente más grandes. Es la única pantalla que se
 * sale de esa escala y lo hace a propósito: no se arregla "unificándola".
 *
 * Todo se arma en UNA columna que se ensancha, nunca en tablas: por eso no hay
 * ningún `overflow-x` en la página y se ve igual en un celular que en un
 * monitor.
 */

.deliverables-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  max-width: 1100px;
  margin: 0 auto;
  box-sizing: border-box;
  font-size: 1rem;
}

.dv-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* --- Encabezado ---------------------------------------------------------- */

.dv-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-bottom: 1.25rem;
}

.dv-header-text { flex: 1 1 320px; }

.dv-title {
  font-family: var(--font-heading);
  font-size: 1.5rem;
  color: var(--text-main);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.dv-subtitle {
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text-sub);
  margin: 0.4rem 0 0;
  max-width: 62ch;
}

.dv-alert {
  border: 1px solid var(--accent-rose);
  border-left-width: 5px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 1rem 1.1rem;
  margin-bottom: 1.25rem;
  color: var(--text-main);
}

.dv-alert p { margin: 0.35rem 0 0.75rem; font-size: 0.95rem; }

/* --- Botones ------------------------------------------------------------- */

/* Un solo botón para toda la pantalla: alto fijo de 48px (zona de toque
   cómoda), texto legible y SIEMPRE con palabras — ningún icono suelto. */
.dv-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 48px;
  padding: 0.6rem 1.1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.98rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.dv-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.dv-btn:focus-visible { outline: 3px solid var(--border-glow); outline-offset: 2px; }

.dv-btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #FFFFFF;
}

.dv-btn-primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }

.dv-btn-ghost:hover:not(:disabled) { background: var(--bg-card-hover); border-color: var(--primary); }

.dv-btn-danger { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.45); }
.dv-btn-danger:hover:not(:disabled) { background: rgba(200, 85, 50, 0.08); border-color: var(--accent-rose); }

/* --- Resumen / contadores ------------------------------------------------ */

.dv-summary { margin-bottom: 1.25rem; }

.dv-summary-hint {
  font-size: 0.88rem;
  color: var(--text-muted);
  margin: 0 0 0.5rem;
}

.dv-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.7rem;
}

.dv-kpi {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  text-align: left;
  min-height: 108px;
  padding: 0.85rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  border-top: 4px solid var(--border-strong);
  background: var(--bg-card);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.dv-kpi:hover { border-color: var(--border-strong); }
.dv-kpi:focus-visible { outline: 3px solid var(--border-glow); outline-offset: 2px; }

.dv-kpi.is-active {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 2px var(--primary);
}

.dv-kpi-value {
  font-family: var(--font-heading);
  font-size: 2rem;
  line-height: 1;
  color: var(--text-main);
}

.dv-kpi-label { font-size: 0.95rem; color: var(--text-main); font-weight: 600; }
.dv-kpi-hint { font-size: 0.8rem; line-height: 1.35; color: var(--text-muted); }

.dv-kpi-active {
  margin-top: 0.25rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--primary);
}

.dv-kpi.is-ok { border-top-color: var(--accent-emerald); }
.dv-kpi.is-warn { border-top-color: var(--accent-amber); }
.dv-kpi.is-bad { border-top-color: var(--accent-rose); }
.dv-kpi.is-ok .dv-kpi-value { color: var(--accent-emerald); }
.dv-kpi.is-warn .dv-kpi-value { color: var(--accent-amber); }
.dv-kpi.is-bad .dv-kpi-value { color: var(--accent-rose); }

/* --- Buscador y filtros -------------------------------------------------- */

.dv-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem 0.9rem;
  padding: 0.85rem 1rem;
  margin-bottom: 1.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.dv-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 280px;
  min-width: 0;
}

.dv-search-icon { position: absolute; left: 0.85rem; font-size: 1rem; pointer-events: none; }

.dv-search {
  width: 100%;
  min-height: 48px;
  padding: 0.6rem 2.6rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 1rem;
}

.dv-search:focus { outline: 3px solid var(--border-glow); outline-offset: 0; border-color: var(--primary); }

.dv-search-clear {
  position: absolute;
  right: 0.5rem;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-sub);
  font-size: 0.9rem;
  cursor: pointer;
}

.dv-toggle {
  min-height: 48px;
  padding: 0.6rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.dv-toggle.is-on { border-color: var(--primary); background: rgba(111, 129, 37, 0.1); color: var(--primary); }

.dv-filter-count { font-size: 0.9rem; color: var(--text-sub); margin: 0 0 0 auto; }
.dv-filter-count strong { color: var(--text-main); }

.dv-empty {
  padding: 2.5rem 1.25rem;
  text-align: center;
  color: var(--text-sub);
  font-size: 1rem;
  line-height: 1.6;
  background: var(--bg-card);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
}

.dv-empty p { margin: 0 0 0.75rem; }
.dv-empty-sub { font-size: 0.92rem; color: var(--text-muted); }

/* --- Proyecto ------------------------------------------------------------ */

.dv-project {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1.15rem 1.25rem 1.25rem;
  margin-bottom: 1.25rem;
  box-shadow: var(--shadow-sm);
}

.dv-project-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.6rem 1.25rem;
  padding-bottom: 0.9rem;
  margin-bottom: 1rem;
  border-bottom: 2px solid var(--border-color);
}

.dv-project-id { flex: 1 1 260px; min-width: 0; }

/* El cliente va primero y en grande: es como se piensa el trabajo ("lo de la
   señora X"), no por el título de la tesis. */
.dv-project-client {
  font-family: var(--font-heading);
  font-size: 1.2rem;
  color: var(--text-main);
  margin: 0;
  overflow-wrap: anywhere;
}

.dv-project-topic {
  display: inline-block;
  margin-top: 0.2rem;
  font-size: 0.95rem;
  color: var(--accent-cyan);
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
}

.dv-project-extra { font-size: 0.88rem; color: var(--text-muted); margin: 0.25rem 0 0; }

.dv-project-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }

.dv-chip {
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-sub);
  white-space: nowrap;
}

.dv-chip.is-ok { color: var(--accent-emerald); border-color: rgba(46, 125, 70, 0.45); background: rgba(46, 125, 70, 0.07); }
.dv-chip.is-warn { color: var(--accent-amber); border-color: rgba(222, 117, 75, 0.45); background: rgba(222, 117, 75, 0.07); }
.dv-chip.is-bad { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.45); background: rgba(200, 85, 50, 0.07); }

.dv-note {
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-sub);
  margin: 0 0 1rem;
  padding: 0.7rem 0.9rem;
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.dv-note.is-warn { color: var(--accent-amber); background: rgba(222, 117, 75, 0.08); }

.dv-project-actions {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

/* --- Tarjeta de entregable ----------------------------------------------- */

/* Una tarjeta por entregable en vez de una fila de tabla: la tabla obligaba a
   desplazarse de lado en el celular y escondía justo las columnas que importan
   (estado y acción). Acá cada dato lleva su nombre al lado. */
.dv-list { display: flex; flex-direction: column; gap: 0.85rem; }

.dv-item {
  border: 1px solid var(--border-color);
  border-left: 6px solid var(--border-strong);
  border-radius: var(--radius-md);
  padding: 1rem 1.1rem;
  background: var(--bg-card);
}

.dv-item.is-ok { border-left-color: var(--accent-emerald); }
.dv-item.is-warn { border-left-color: var(--accent-amber); }
.dv-item.is-bad { border-left-color: var(--accent-rose); }
.dv-item.is-neutral { border-left-color: var(--border-strong); }
.dv-item.is-open { background: var(--bg-card-hover); }

.dv-item-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem 0.85rem;
}

.dv-item-title {
  font-family: var(--font-heading);
  font-size: 1.1rem;
  color: var(--text-main);
  margin: 0;
  flex: 1 1 200px;
  overflow-wrap: anywhere;
}

.dv-item-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }

.dv-state {
  font-size: 0.88rem;
  font-weight: 700;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  white-space: nowrap;
}

.dv-state.is-ok { color: var(--accent-emerald); border-color: rgba(46, 125, 70, 0.45); background: rgba(46, 125, 70, 0.08); }
.dv-state.is-warn { color: var(--accent-amber); border-color: rgba(222, 117, 75, 0.45); background: rgba(222, 117, 75, 0.08); }
.dv-state.is-bad { color: var(--accent-rose); border-color: rgba(200, 85, 50, 0.45); background: rgba(200, 85, 50, 0.08); }
.dv-state.is-neutral { color: var(--text-sub); background: var(--surface-1); }

/* La frase que dice qué hacer. Va antes que cualquier dato suelto. */
.dv-item-todo {
  font-size: 1rem;
  line-height: 1.5;
  font-weight: 600;
  color: var(--text-main);
  margin: 0.6rem 0 0;
}

.dv-item-todo.is-bad { color: var(--accent-rose); }
.dv-item-todo.is-warn { color: var(--accent-amber); }
.dv-item-todo.is-ok { color: var(--accent-emerald); }
.dv-item-todo.is-neutral { color: var(--text-sub); }

.dv-item-desc {
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-sub);
  margin: 0.45rem 0 0;
  overflow-wrap: anywhere;
}

.dv-facts { margin: 0.85rem 0 0; display: flex; flex-direction: column; gap: 0.45rem; }

.dv-fact {
  display: flex;
  flex-wrap: wrap;
  gap: 0.15rem 0.6rem;
  font-size: 0.93rem;
  line-height: 1.45;
}

.dv-fact dt { flex: 0 0 11rem; color: var(--text-muted); font-weight: 600; }
.dv-fact dd { flex: 1 1 14rem; margin: 0; color: var(--text-main); overflow-wrap: anywhere; }
.dv-fact.is-bad dd { color: var(--accent-rose); font-weight: 600; }

.dv-file-btn {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: 0.7rem;
  padding: 0.4rem 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--accent-cyan);
  font-family: var(--font-body);
  font-size: 0.92rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  overflow-wrap: anywhere;
}

.dv-file-btn:hover { border-color: var(--primary); background: var(--bg-card-hover); }

/* Ocupa el lugar del botón principal cuando la cuota no está pagada: mismo
   peso visual, para que se lea como "acá va la acción, y por esto no está". */
.dv-locked {
  display: block;
  margin: 1rem 0 0;
  padding: 0.75rem 0.9rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-1);
  color: var(--text-sub);
  font-size: 0.95rem;
  line-height: 1.5;
}

.dv-locked strong { color: var(--text-main); }

.dv-item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 1rem;
}

.dv-item-actions .dv-btn-primary { flex: 1 1 15rem; }
.dv-more { flex: 0 1 auto; }

.dv-more-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px dashed var(--border-strong);
}

/* --- Formularios en hoja (modales) --------------------------------------- */

.dv-overlay { padding: 1rem; }

.dv-sheet {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.dv-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid var(--border-color);
}

.dv-sheet-title { font-family: var(--font-heading); font-size: 1.15rem; color: var(--text-main); margin: 0; }

.dv-sheet-close {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-sub);
  font-size: 1rem;
  cursor: pointer;
}

.dv-sheet-close:hover { border-color: var(--accent-rose); color: var(--accent-rose); }

.dv-sheet-body { padding: 1.1rem; overflow-y: auto; }

.dv-sheet-subject {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-color);
  overflow-wrap: anywhere;
}

.dv-field { margin-bottom: 1.1rem; }

.dv-label {
  display: block;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 0.4rem;
}

.dv-optional { font-weight: 400; color: var(--text-muted); }

.dv-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-height: 48px;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text-main);
  font-family: var(--font-body);
  /* 1rem = 16px: por debajo de eso Safari en iPhone hace zoom al enfocar el
     campo y descoloca la pantalla. */
  font-size: 1rem;
}

.dv-input:focus { outline: 3px solid var(--border-glow); border-color: var(--primary); }
textarea.dv-input { min-height: 80px; resize: vertical; }

.dv-help { font-size: 0.88rem; line-height: 1.5; color: var(--text-muted); margin: 0.4rem 0 0; }

/* El selector de archivo nativo no dice nada: se envuelve en una etiqueta con
   texto propio que además muestra el nombre del archivo elegido. */
.dv-file-pick {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0.6rem 0.9rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 0.98rem;
  font-weight: 600;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.dv-file-pick:hover { border-color: var(--primary); background: var(--bg-card-hover); }
.dv-file-pick input[type="file"] { display: none; }

.dv-file-clear {
  margin-top: 0.4rem;
  padding: 0.3rem 0;
  border: none;
  background: none;
  color: var(--accent-rose);
  font-family: var(--font-body);
  font-size: 0.9rem;
  cursor: pointer;
}

.dv-sheet-warn {
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--accent-amber);
  background: rgba(222, 117, 75, 0.08);
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.85rem;
  margin: 0 0 1rem;
}

.dv-sheet-error {
  font-size: 0.95rem;
  color: var(--accent-rose);
  background: rgba(200, 85, 50, 0.08);
  border-radius: var(--radius-sm);
  padding: 0.7rem 0.85rem;
  margin: 0 0 1rem;
}

/* El botón de confirmar va primero y queda pegado abajo: en un celular el
   formulario se desplaza y no hay que buscarlo al final. */
.dv-sheet-actions {
  position: sticky;
  /* El desplazamiento negativo iguala el `padding` del cuerpo: así la barra
     queda pegada al borde real de la hoja y tapa lo que pasa por debajo. */
  bottom: -1.1rem;
  display: flex;
  gap: 0.6rem;
  padding: 0.85rem 0 1.1rem;
  margin-top: 0.25rem;
  background: var(--bg-card-solid);
  border-top: 1px solid var(--border-color);
}

.dv-sheet-actions .dv-btn { flex: 1 1 auto; }

/* --- Pantallas chicas ---------------------------------------------------- */

@media (max-width: 860px) {
  .dv-fact dt { flex: 1 1 100%; }
  .dv-fact dd { flex: 1 1 100%; }
}

@media (max-width: 680px) {
  .dv-title { font-size: 1.3rem; }
  .dv-subtitle { font-size: 0.92rem; }

  /* Botones a todo el ancho: en el celular es la zona de toque más segura. */
  .dv-header > .dv-btn,
  .dv-project-actions .dv-btn,
  .dv-item-actions .dv-btn,
  .dv-empty .dv-btn { width: 100%; }

  .dv-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dv-kpi { min-height: 96px; padding: 0.7rem 0.75rem; }
  .dv-kpi-value { font-size: 1.7rem; }
  .dv-kpi-label { font-size: 0.88rem; }
  .dv-kpi-hint { font-size: 0.76rem; }

  .dv-filters { gap: 0.6rem; }
  .dv-search-wrap { flex: 1 1 100%; }
  .dv-toggle { flex: 1 1 100%; }
  .dv-filter-count { margin-left: 0; flex: 1 1 100%; }
  .dv-clear { width: 100%; }

  .dv-project { padding: 1rem; border-radius: var(--radius-md); }
  .dv-project-head { gap: 0.6rem; }
  .dv-project-client { font-size: 1.1rem; }
  .dv-item { padding: 0.9rem; }
  .dv-item-title { font-size: 1.05rem; }

  /* La hoja se pega al borde inferior, como cualquier app del teléfono. */
  .dv-overlay { padding: 0; align-items: flex-end; }
  .dv-sheet {
    max-width: none;
    max-height: 94vh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .dv-sheet-actions { flex-direction: column-reverse; }
}

@media (max-width: 380px) {
  .dv-kpi-grid { grid-template-columns: 1fr; }
}
</style>
