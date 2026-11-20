<template>
  <main class="container-fluid notices-page">
    <header class="notices-header">
      <div>
        <h2 class="section-heading">
          <span class="heading-icon">🔔</span> Avisos al equipo
        </h2>
        <p class="section-subheading">
          Lo que escribas acá le llega a la campana del panel y, si tiene la app instalada,
          al teléfono — aunque la tenga cerrada.
        </p>
      </div>
      <button class="btn-action-secondary" :disabled="loadingHistory" @click="refresh">
        <span :class="['btn-icon', { 'spin-animation': loadingHistory }]">🔄</span>
        {{ loadingHistory ? 'Cargando…' : 'Actualizar' }}
      </button>
    </header>

    <div class="notices-grid">
      <!-- ───────────────────────── Escribir el aviso ───────────────────────── -->
      <section class="card compose">
        <h3 class="card-title">Nuevo aviso</h3>

        <div class="form-group">
          <label class="form-label" for="aviso-titulo">Título</label>
          <input
            id="aviso-titulo"
            v-model="form.title"
            type="text"
            class="form-input"
            maxlength="120"
            placeholder="Reunión de equipo a las 5"
            @keydown.enter.prevent="focusBody"
          />
          <!-- El contador sale solo cerca del límite: permanente es ruido en un
               campo que casi nunca se acerca a 120. -->
          <span v-if="form.title.length > 90" class="field-hint">
            {{ 120 - form.title.length }} caracteres restantes
          </span>
        </div>

        <div class="form-group">
          <label class="form-label" for="aviso-cuerpo">Mensaje <em>(opcional)</em></label>
          <textarea
            id="aviso-cuerpo"
            ref="bodyInput"
            v-model="form.body"
            class="form-textarea"
            rows="3"
            maxlength="1000"
            placeholder="En la sala de arriba. Traigan el reporte de la semana."
          ></textarea>
        </div>

        <div class="form-group">
          <label class="form-label" for="aviso-link">Llevar a <em>(opcional)</em></label>
          <select id="aviso-link" v-model="form.link" class="form-select">
            <option value="">No llevar a ninguna pantalla</option>
            <option v-for="d in LINK_DESTINATIONS" :key="d.path" :value="d.path">{{ d.label }}</option>
          </select>
          <span class="field-hint">Al tocar el aviso, se abre esa pantalla del panel.</span>
        </div>

        <!-- ─────────────────────────── A quién ─────────────────────────── -->
        <div class="form-group">
          <span class="form-label">¿A quién?</span>

          <label class="choice" :class="{ 'is-on': form.everyone }">
            <input v-model="form.everyone" type="radio" :value="true" />
            <span>
              <strong>A todo el equipo</strong>
              <em>Lo ve cualquiera que entre al panel.</em>
            </span>
          </label>

          <label class="choice" :class="{ 'is-on': !form.everyone }">
            <input v-model="form.everyone" type="radio" :value="false" />
            <span>
              <strong>Solo a quien yo elija</strong>
              <em>Nadie más lo ve, ni en la campana ni en el teléfono.</em>
            </span>
          </label>
        </div>

        <div v-if="!form.everyone" class="picker">
          <div v-if="audiences.roles.length > 0" class="picker-block">
            <span class="picker-title">Por rol</span>
            <div class="chips">
              <button
                v-for="rol in audiences.roles"
                :key="'r' + rol.id"
                type="button"
                class="chip"
                :class="{ 'is-on': form.roleIds.includes(rol.id) }"
                :disabled="rol.people === 0"
                :title="rol.people === 0 ? 'Este rol no tiene a nadie' : ''"
                @click="toggle(form.roleIds, rol.id)"
              >
                {{ rol.name }}
                <span class="chip-count">{{ rol.people }}</span>
              </button>
            </div>
          </div>

          <div class="picker-block">
            <span class="picker-title">Por persona</span>
            <div class="chips">
              <button
                v-for="u in audiences.users"
                :key="'u' + u.id"
                type="button"
                class="chip chip-person"
                :class="{ 'is-on': form.userIds.includes(u.id), 'is-by-role': byRoleOnly(u) }"
                :title="byRoleOnly(u) ? `Ya le llega por su rol (${u.role_name})` : (u.role_name || u.email)"
                @click="toggle(form.userIds, u.id)"
              >
                <span class="avatar avatar-xs" :style="avatarStyle(u)">
                  <img v-if="u.avatar_url" :src="u.avatar_url" :alt="u.name || u.email" />
                  <template v-else>{{ initials(u.name || u.email) }}</template>
                </span>
                {{ u.name || u.email }}
              </button>
            </div>
          </div>

          <!-- Cuántos reciben Y quiénes, resuelto en la pantalla con la misma
               regla que el servidor (una persona elegida a dedo y además por su
               rol es UNA). Sin esto, "Setter + Lucía" parece dos avisos para
               Lucía; y sin las caras, "le va a llegar a 8" obliga a recontar los
               chips encendidos para saber si falta alguien. -->
          <div class="picker-total" :class="{ 'is-empty': recipients.length === 0 }">
            <template v-if="recipients.length === 0">Todavía no elegiste a nadie.</template>
            <template v-else>
              <span class="picker-total-text">
                Le va a llegar a {{ recipients.length }}
                {{ recipients.length === 1 ? 'persona' : 'personas' }}:
              </span>
              <span class="avatar-row">
                <span
                  v-for="u in recipients"
                  :key="'sel' + u.id"
                  class="avatar avatar-sm"
                  :style="avatarStyle(u)"
                  :title="u.name || u.email"
                >
                  <img v-if="u.avatar_url" :src="u.avatar_url" :alt="u.name || u.email" />
                  <template v-else>{{ initials(u.name || u.email) }}</template>
                </span>
              </span>
            </template>
          </div>
        </div>

        <p v-if="error" class="alert-error">{{ error }}</p>
        <p v-if="sent" class="alert-ok">{{ sent }}</p>

        <div class="compose-actions">
          <button type="button" class="btn-action-primary" :disabled="!canSend || sending" @click="send">
            {{ sending ? 'Enviando…' : 'Enviar aviso' }}
          </button>
          <button type="button" class="btn-action-ghost" :disabled="sending" @click="reset">
            Limpiar
          </button>
        </div>
      </section>

      <!-- ──────── Lo enviado, en dos vistas sobre los MISMOS datos ─────────
           «Enviados» contesta qué se mandó; «Quién recibe qué» contesta a quién
           le llega — la otra mitad del trabajo, que en la lista obliga a abrir
           aviso por aviso. El cuadro NO pide otra ruta ni calcula otro estado:
           se arma sobre `notices` y `audiences`, así que las dos vistas no
           pueden decir cosas distintas. -->
      <section class="card history">
        <div class="card-title">
          <div class="tabs">
            <button
              type="button"
              class="tab"
              :class="{ 'is-on': view === 'lista' }"
              @click="setView('lista')"
            >Enviados</button>
            <button
              type="button"
              class="tab"
              :class="{ 'is-on': view === 'matriz' }"
              @click="setView('matriz')"
            >Quién recibe qué</button>
            <!--
              La tercera pestaña no habla de los avisos que se escriben acá,
              sino de los AUTOMÁTICOS: los del bot, Finanzas y proyectos, que
              hoy le suenan en el teléfono a todo el mundo. Vive en esta
              pantalla porque la pregunta es la misma —"a quién le llega qué"—
              y separarla en otro menú dejaría dos sitios distintos para
              contestarla. Pide `roles.manage` y no `notices.send`: reparte
              trabajo entre perfiles, que es lo que administra ese permiso.
            -->
            <button
              v-if="puedeEnrutar"
              type="button"
              class="tab"
              :class="{ 'is-on': view === 'automaticos' }"
              @click="setView('automaticos')"
            >Avisos automáticos</button>
          </div>
          <span v-if="view !== 'automaticos'" class="muted">
            {{ notices.length }} envío{{ notices.length === 1 ? '' : 's' }}
          </span>
          <span v-else class="muted">{{ tiposAcotados }} de {{ routing.types.length }} acotados</span>
        </div>

        <p v-if="view === 'automaticos' && loadingRouting" class="muted">Cargando…</p>
        <p v-else-if="view !== 'automaticos' && loadingHistory" class="muted">Cargando…</p>
        <p v-else-if="view !== 'automaticos' && notices.length === 0" class="muted">
          Todavía no se mandó ningún aviso desde acá.
        </p>

        <!-- ──────────────────────────── Lista ──────────────────────────── -->
        <ul v-else-if="view === 'lista'" class="notice-list">
          <li v-for="n in notices" :key="n.batch_id" class="notice-row">
            <div class="notice-head">
              <strong class="notice-title">{{ n.title }}</strong>
              <span class="notice-when" :title="fullDate(n.created_at)">{{ relative(n.created_at) }}</span>
            </div>
            <p v-if="n.body" class="notice-body">{{ n.body }}</p>
            <div class="notice-meta">
              <span class="pill" :class="n.everyone ? 'pill-info' : 'pill-neutral'">
                {{ n.everyone ? 'Todo el equipo' : `${n.recipients} ${n.recipients === 1 ? 'persona' : 'personas'}` }}
              </span>
              <!-- Para un aviso a todos no se cuenta leído: es UNA fila con
                   `user_id` en NULL, así que su `is_read` es el de quien la
                   abrió primero y no dice nada de los demás. -->
              <span
                v-if="!n.everyone"
                class="pill"
                :class="n.read_count === n.recipients ? 'pill-success' : 'pill-warning'"
              >
                {{ n.read_count }} de {{ n.recipients }} leído{{ n.read_count === 1 ? '' : 's' }}
              </span>
              <span v-if="n.sender_name" class="notice-sender">por {{ n.sender_name }}</span>
            </div>
            <div v-if="!n.everyone && n.recipient_list.length > 0" class="avatar-row notice-to">
              <span
                v-for="r in n.recipient_list"
                :key="n.batch_id + '-' + r.id"
                class="avatar avatar-sm"
                :class="r.read ? 'is-read' : 'is-unread'"
                :style="avatarStyle(personOf(r))"
                :title="`${r.name || 'Sin nombre'} — ${r.read ? 'lo leyó' : 'todavía no lo leyó'}`"
              >
                <img v-if="personOf(r).avatar_url" :src="personOf(r).avatar_url" :alt="r.name || ''" />
                <template v-else>{{ initials(r.name) }}</template>
              </span>
            </div>
          </li>
        </ul>

        <!-- ───────────────────── Quién recibe qué ───────────────────── -->
        <div v-else-if="view === 'matriz'" class="matrix-wrap">
          <div class="legend">
            <span class="legend-item"><i class="cell-dot is-read">✓</i> lo leyó</span>
            <span class="legend-item"><i class="cell-dot is-unread">●</i> le llegó, sin leer</span>
            <span class="legend-item"><i class="cell-dot is-all">○</i> le llega por ser para todo el equipo</span>
            <span class="legend-item"><i class="cell-dot is-none">·</i> no le llegó</span>
          </div>

          <!-- Una tabla ancha se desplaza dentro de su propio contenedor: el
               cuerpo de la página nunca se desplaza de lado. -->
          <div class="matrix-scroll">
            <table class="matrix">
              <thead>
                <tr>
                  <th class="col-notice">Aviso</th>
                  <th
                    v-for="u in audiences.users"
                    :key="'h' + u.id"
                    class="col-person"
                    :class="{ 'is-focus': focusId === u.id }"
                  >
                    <button type="button" class="person-head" :title="`Ver lo que le llegó a ${u.name || u.email}`" @click="focusOn(u.id)">
                      <span class="avatar avatar-sm" :style="avatarStyle(u)">
                        <img v-if="u.avatar_url" :src="u.avatar_url" :alt="u.name || u.email" />
                        <template v-else>{{ initials(u.name || u.email) }}</template>
                      </span>
                      <span class="person-name">{{ shortName(u.name || u.email) }}</span>
                      <span class="person-count">{{ statsFor(u.id).directed }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in notices" :key="'m' + n.batch_id">
                  <th class="col-notice" scope="row">
                    <span class="matrix-title" :title="n.title">{{ n.title }}</span>
                    <span class="matrix-when" :title="fullDate(n.created_at)">{{ relative(n.created_at) }}</span>
                  </th>
                  <td
                    v-for="u in audiences.users"
                    :key="n.batch_id + '-' + u.id"
                    class="cell"
                    :class="{ 'is-focus': focusId === u.id }"
                  >
                    <span class="cell-dot" :class="'is-' + cellState(n, u.id)" :title="cellTitle(n, u)">
                      {{ CELL_GLYPH[cellState(n, u.id)] }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Tocar a una persona abre lo suyo: la columna contesta "¿le llegó
               este aviso?" y esto contesta "¿qué le llegó?", que es la pregunta
               con la que se entra acá cuando alguien dice que no se enteró. -->
          <div v-if="focusPerson" class="focus">
            <div class="focus-head">
              <span class="avatar avatar-md" :style="avatarStyle(focusPerson)">
                <img v-if="focusPerson.avatar_url" :src="focusPerson.avatar_url" :alt="focusPerson.name || ''" />
                <template v-else>{{ initials(focusPerson.name || focusPerson.email) }}</template>
              </span>
              <div>
                <strong>{{ focusPerson.name || focusPerson.email }}</strong>
                <span class="focus-role">{{ focusPerson.role_name || 'Sin rol' }}</span>
              </div>
              <button type="button" class="btn-action-ghost btn-mini" @click="focusId = null">Cerrar</button>
            </div>
            <p class="focus-sum">
              {{ focusStats.directed }} dirigido{{ focusStats.directed === 1 ? '' : 's' }}
              ({{ focusStats.unread }} sin leer)
              · {{ focusStats.broadcast }} a todo el equipo
            </p>
            <ul class="focus-list">
              <li v-for="n in focusNotices" :key="'f' + n.batch_id">
                <span class="cell-dot" :class="'is-' + cellState(n, focusPerson.id)">
                  {{ CELL_GLYPH[cellState(n, focusPerson.id)] }}
                </span>
                <span class="focus-title" :title="n.title">{{ n.title }}</span>
                <span class="focus-when">{{ relative(n.created_at) }}</span>
              </li>
              <li v-if="focusNotices.length === 0" class="muted">
                De los últimos avisos, a esta persona no le llegó ninguno.
              </li>
            </ul>
          </div>
        </div>

        <!-- ──────────────────── Avisos automáticos ───────────────────── -->
        <div v-else-if="view === 'automaticos'" class="routing">
          <p class="routing-intro">
            Estos los manda el sistema solo. <strong>Sin perfiles marcados van a
            todo el equipo</strong>, que es como funcionan hoy; marcando alguno,
            ese aviso deja de aparecer en la campana y en el teléfono de los
            demás.
          </p>
          <p v-if="!routing.editable" class="routing-warn">
            Falta aplicar la migración pendiente en el servidor
            (<code>npm run migrate</code>): hasta entonces todo sigue yendo a
            todo el equipo y lo que se marque acá no se puede guardar.
          </p>
          <p v-if="routingError" class="routing-warn">{{ routingError }}</p>

          <div v-for="grupo in tiposPorGrupo" :key="grupo.nombre" class="routing-group">
            <h4 class="routing-group-title">{{ grupo.nombre }}</h4>
            <div v-for="t in grupo.tipos" :key="t.type" class="routing-row">
              <div class="routing-what">
                <strong>{{ t.label }}</strong>
                <span class="routing-desc">{{ t.description }}</span>
              </div>
              <div class="routing-roles">
                <!-- "Todo el equipo" es una opción más y no la ausencia de
                     opciones: sin ella, dejar un tipo como está obliga a
                     adivinar que desmarcar todo es lo que lo devuelve a todos. -->
                <button
                  type="button"
                  class="role-chip"
                  :class="{ 'is-on': (routing.routing[t.type] || []).length === 0 }"
                  :disabled="!routing.editable || guardando === t.type"
                  @click="setRoles(t.type, [])"
                >Todo el equipo</button>
                <button
                  v-for="r in routing.roles"
                  :key="r.id"
                  type="button"
                  class="role-chip"
                  :class="{ 'is-on': (routing.routing[t.type] || []).includes(r.id) }"
                  :disabled="!routing.editable || guardando === t.type"
                  @click="toggleRole(t.type, r.id)"
                >{{ r.name }}</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { avatarColor, initials } from '../avatars.js';
import { hasPermission } from '../auth.js';

/**
 * A dónde puede llevar un aviso.
 *
 * Es una lista cerrada y no un campo libre a propósito: el servidor ya rechaza
 * cualquier cosa que no sea una ruta del panel —un aviso que manda a un dominio
 * de afuera es la forma exacta de un phishing interno, y el push le llega a todo
 * el equipo con el nombre de la empresa arriba— así que ofrecer un cuadro de
 * texto solo daría la oportunidad de escribir algo que va a ser rechazado.
 */
const LINK_DESTINATIONS = [
  { path: '/admin/dashboard', label: 'Dashboard' },
  { path: '/admin/leads', label: 'Funnel de Ventas' },
  { path: '/admin/setter-funnel', label: 'Setter Funnel' },
  { path: '/admin/calendario', label: 'Calendario' },
  { path: '/admin/entregables', label: 'Entregables' },
  { path: '/admin/proyectos', label: 'Proyectos' },
  { path: '/admin/cobranzas', label: 'Cobranzas' },
  { path: '/admin/finanzas', label: 'Finanzas' }
];

/** El glifo de cada estado de una celda del cuadro. */
const CELL_GLYPH = { read: '✓', unread: '●', all: '○', none: '·' };

const audiences = ref({ users: [], roles: [] });
const notices = ref([]);
const loadingHistory = ref(true);
const sending = ref(false);
const error = ref('');
const sent = ref('');
const bodyInput = ref(null);
const focusId = ref(null);

const emptyForm = () => ({ title: '', body: '', link: '', everyone: true, userIds: [], roleIds: [] });
const form = ref(emptyForm());

/* La vista elegida se recuerda, entre `try` porque en una ventana privada el
   acceso al `localStorage` lanza (mismo cuidado que Entregables). */
const VISTAS = ['lista', 'matriz', 'automaticos'];
const guardada = readStored('avisos.view');
const view = ref(VISTAS.includes(guardada) ? guardada : 'lista');

function readStored(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function setView(valor) {
  view.value = valor;
  try {
    localStorage.setItem('avisos.view', valor);
  } catch {
    /* Una ventana privada no impide usar la pantalla. */
  }
}

// ───────────────────────────── Quién recibe ──────────────────────────────

const usersById = computed(() => {
  const mapa = new Map();
  for (const u of audiences.value.users) mapa.set(u.id, u);
  return mapa;
});

/**
 * A quiénes les llegaría el aviso que se está escribiendo, con la MISMA regla
 * del servidor (`NoticeService.resolveRecipients`): quien está elegido a dedo y
 * además por su rol cuenta una vez. Con dos reglas distintas, la pantalla
 * prometería un número y el envío haría otro.
 */
const recipients = computed(() => {
  if (form.value.everyone) return [];
  const ids = new Set(form.value.userIds);
  for (const u of audiences.value.users) {
    if (u.role_id != null && form.value.roleIds.includes(u.role_id)) ids.add(u.id);
  }
  return audiences.value.users.filter((u) => ids.has(u.id));
});

/** Ya le llega por su rol, sin haberla elegido a dedo. */
function byRoleOnly(user) {
  return (
    !form.value.userIds.includes(user.id) &&
    user.role_id != null &&
    form.value.roleIds.includes(user.role_id)
  );
}

const canSend = computed(() => {
  if (!form.value.title.trim()) return false;
  return form.value.everyone || recipients.value.length > 0;
});

// ───────────────────────────── El cuadro ──────────────────────────────

/**
 * En qué estado está la celda (persona × aviso).
 *
 * Un aviso a todo el equipo es `all` y no `read`/`unread`: es UNA fila
 * compartida, así que su `is_read` es el de quien la abrió primero, y afirmar
 * con eso que una persona lo leyó sería inventar un dato.
 */
function cellState(notice, userId) {
  if (notice.everyone) return 'all';
  const fila = notice.recipient_list.find((r) => r.id === userId);
  if (!fila) return 'none';
  return fila.read ? 'read' : 'unread';
}

const CELL_WORDS = {
  all: 'le llega por ser un aviso a todo el equipo',
  read: 'lo leyó',
  unread: 'le llegó y todavía no lo leyó',
  none: 'no le llegó'
};

function cellTitle(notice, user) {
  return `${user.name || user.email}: ${CELL_WORDS[cellState(notice, user.id)]} — ${notice.title}`;
}

/** Cuántos avisos le llegaron a alguien, separando los dirigidos de los de todos. */
function statsFor(userId) {
  let directed = 0;
  let unread = 0;
  let broadcast = 0;
  for (const n of notices.value) {
    const estado = cellState(n, userId);
    if (estado === 'all') broadcast += 1;
    else if (estado === 'read') directed += 1;
    else if (estado === 'unread') {
      directed += 1;
      unread += 1;
    }
  }
  return { directed, unread, broadcast };
}

const focusPerson = computed(() => (focusId.value == null ? null : usersById.value.get(focusId.value) || null));
const focusStats = computed(() => (focusPerson.value ? statsFor(focusPerson.value.id) : { directed: 0, unread: 0, broadcast: 0 }));
const focusNotices = computed(() =>
  focusPerson.value ? notices.value.filter((n) => cellState(n, focusPerson.value.id) !== 'none') : []
);

function focusOn(userId) {
  focusId.value = focusId.value === userId ? null : userId;
}

/** El destinatario de una fila del historial, para poder dibujar su foto. */
function personOf(recipient) {
  return usersById.value.get(recipient.id) || { name: recipient.name, avatar_url: null };
}

function avatarStyle(user) {
  return user?.avatar_url ? {} : { background: avatarColor(user?.name || user?.email || '') };
}

/** En la cabecera del cuadro cada columna son ~70 px: entra el nombre de pila. */
function shortName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '—';
}

// ───────────────────────────── Acciones ──────────────────────────────

function toggle(list, id) {
  const i = list.indexOf(id);
  if (i === -1) list.push(id);
  else list.splice(i, 1);
}

function focusBody() {
  bodyInput.value?.focus();
}

function reset() {
  form.value = emptyForm();
  error.value = '';
  sent.value = '';
}

async function loadAudiences() {
  try {
    const r = await apiFetch('/api/notices/audiences');
    if (r.ok) audiences.value = await r.json();
  } catch (e) {
    error.value = 'No se pudo traer la lista de destinatarios.';
  }
}

async function loadHistory() {
  loadingHistory.value = true;
  try {
    const r = await apiFetch('/api/notices');
    if (r.ok) notices.value = (await r.json()).notices || [];
  } catch (e) {
    // Un historial que no carga no impide mandar un aviso.
  } finally {
    loadingHistory.value = false;
  }
}

function refresh() {
  loadAudiences();
  loadHistory();
}

async function send() {
  sending.value = true;
  error.value = '';
  sent.value = '';
  try {
    const r = await apiFetch('/api/notices', {
      method: 'POST',
      body: JSON.stringify({
        title: form.value.title,
        body: form.value.body,
        link: form.value.link || null,
        everyone: form.value.everyone,
        userIds: form.value.userIds,
        roleIds: form.value.roleIds
      })
    });
    const data = await r.json();
    if (!r.ok) {
      error.value = data.error || 'No se pudo enviar el aviso.';
      return;
    }
    sent.value = data.summary.everyone
      ? 'Enviado a todo el equipo.'
      : `Enviado a ${data.summary.recipients} ${data.summary.recipients === 1 ? 'persona' : 'personas'}.`;
    // Se limpia el aviso pero NO el "a quién": mandar dos avisos seguidos al
    // mismo grupo es el caso normal, y volver a elegir las ocho personas es el
    // trabajo que esta pantalla vino a ahorrar.
    form.value.title = '';
    form.value.body = '';
    form.value.link = '';
    await loadHistory();
  } catch (e) {
    error.value = 'No se pudo enviar el aviso.';
  } finally {
    sending.value = false;
  }
}

const RELATIVE = [
  [60, 'ahora'],
  [3600, (s) => `hace ${Math.floor(s / 60)} min`],
  [86400, (s) => `hace ${Math.floor(s / 3600)} h`],
  [172800, () => 'ayer']
];

/** En lenguaje llano, como las tarjetas de Entregables. */
function relative(iso) {
  if (!iso) return '';
  const segundos = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  for (const [limite, texto] of RELATIVE) {
    if (segundos < limite) return typeof texto === 'function' ? texto(segundos) : texto;
  }
  if (segundos < 604800) return `hace ${Math.floor(segundos / 86400)} días`;
  return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
}

function fullDate(iso) {
  return iso ? new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : '';
}

// ───────────────────── Avisos automáticos (enrutado) ──────────────────────

/*
 * El catálogo de tipos y los perfiles vienen del SERVIDOR y no copiados acá:
 * con una copia en cada lado, el tipo que se agregue mañana aparece en la base
 * y no en el formulario, así que nadie podría enrutarlo.
 */
const routing = ref({ types: [], roles: [], routing: {}, editable: true });
const loadingRouting = ref(false);
const routingError = ref('');
const guardando = ref(null);

const puedeEnrutar = computed(() => hasPermission('roles.manage'));

/* Agrupados por el trabajo al que pertenecen: una lista plana de diecisiete
   avisos no se reparte entre perfiles porque no se ve de qué va cada uno. */
const tiposPorGrupo = computed(() => {
  const grupos = [];
  for (const t of routing.value.types) {
    let grupo = grupos.find((g) => g.nombre === t.group);
    if (!grupo) {
      grupo = { nombre: t.group, tipos: [] };
      grupos.push(grupo);
    }
    grupo.tipos.push(t);
  }
  return grupos;
});

/* Cuántos tienen el público acotado. Es lo que dice de un vistazo si esto
   está configurado o si todo sigue yendo a todos. */
const tiposAcotados = computed(() => (
  routing.value.types.filter((t) => (routing.value.routing[t.type] || []).length > 0).length
));

async function loadRouting() {
  if (!puedeEnrutar.value) return;
  loadingRouting.value = true;
  routingError.value = '';
  try {
    const res = await apiFetch('/api/notification-routing');
    if (!res.ok) throw new Error('No se pudo leer el reparto de avisos automáticos.');
    routing.value = await res.json();
  } catch (error) {
    routingError.value = error.message;
  } finally {
    loadingRouting.value = false;
  }
}

function toggleRole(type, roleId) {
  const actuales = routing.value.routing[type] || [];
  const siguientes = actuales.includes(roleId)
    ? actuales.filter((id) => id !== roleId)
    : [...actuales, roleId];
  return setRoles(type, siguientes);
}

/*
 * Se guarda tipo por tipo, no la matriz entera: la pantalla se edita marcando
 * casillas, y mandar los diecisiete en cada clic haría que dos personas
 * configurando a la vez se pisaran el trabajo entero en vez de la casilla que
 * tocaron. La respuesta trae la configuración completa, así que la pantalla
 * queda mostrando lo que de verdad quedó guardado y no lo que se pidió.
 */
async function setRoles(type, roleIds) {
  if (!routing.value.editable) return;
  guardando.value = type;
  routingError.value = '';
  try {
    const res = await apiFetch(`/api/notification-routing/${type}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleIds })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo guardar el reparto.');
    }
    routing.value = await res.json();
  } catch (error) {
    routingError.value = error.message;
  } finally {
    guardando.value = null;
  }
}

onMounted(() => {
  refresh();
  loadRouting();
});
</script>

<style scoped>
/* El aire sale de los tokens del panel, no de un padding propio: ver
   "DENSIDAD Y ESTILO DEL PANEL INTERNO" en src/style.css. */
.notices-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
}

.notices-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.notices-header .section-subheading { max-width: 70ch; margin-bottom: 0; }

.notices-grid {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
@media (max-width: 1100px) {
  .notices-grid { grid-template-columns: minmax(0, 1fr); }
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 12px);
  padding: 1rem;
}
.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.95rem;
  font-weight: 700;
  margin: 0 0 0.85rem;
}

.field-hint {
  display: block;
  font-size: 0.74rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}
.form-label em { font-weight: 400; color: var(--text-muted); font-style: normal; }

/* ─────────────────────────────── A quién ─────────────────────────────── */

.choice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 0.4rem;
}
.choice:hover { background: var(--bg-card-hover); }
.choice.is-on {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 7%, transparent);
}
.choice input { margin-top: 0.2rem; }
.choice strong { display: block; font-size: 0.85rem; }
.choice em {
  display: block;
  font-style: normal;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.picker {
  border: 1px dashed var(--border-color);
  border-radius: 9px;
  padding: 0.7rem;
  margin-bottom: 0.85rem;
}
.picker-block + .picker-block { margin-top: 0.7rem; }
.picker-title {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  font-weight: 700;
  margin-bottom: 0.35rem;
}
.chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.6rem;
  font: inherit;
  font-size: 0.8rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-card);
  color: var(--text-main);
  cursor: pointer;
}
.chip-person { padding-left: 0.25rem; }
.chip:hover:not(:disabled) { border-color: var(--border-strong); }
.chip:disabled { opacity: 0.45; cursor: not-allowed; }
.chip.is-on {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
/* Ya le llega por su rol: se marca distinto de "la elegí a dedo" para que no
   parezca que falta encenderla. */
.chip.is-by-role:not(.is-on) {
  border-color: var(--primary);
  border-style: dashed;
}
.chip-count { font-size: 0.7rem; opacity: 0.75; }

.picker-total {
  font-size: 0.78rem;
  font-weight: 600;
  margin-top: 0.6rem;
  color: var(--text-sub);
}
.picker-total.is-empty { color: var(--text-muted); font-weight: 400; }
.picker-total-text { display: block; margin-bottom: 0.3rem; }

.compose-actions { display: flex; gap: 0.5rem; }

.alert-error,
.alert-ok {
  font-size: 0.8rem;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  margin: 0 0 0.7rem;
}
.alert-error {
  color: var(--accent-rose);
  background: color-mix(in srgb, var(--accent-rose) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-rose) 30%, transparent);
}
.alert-ok {
  color: var(--accent-emerald);
  background: color-mix(in srgb, var(--accent-emerald) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-emerald) 30%, transparent);
}

.muted { color: var(--text-muted); font-size: 0.8rem; font-weight: 400; }
.btn-mini { font-size: 0.75rem; padding: 0.2rem 0.5rem; }

/* ─────────────────────────────── Avatares ────────────────────────────── */

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  overflow: hidden;
  flex: 0 0 auto;
  line-height: 1;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.avatar-xs { width: 20px; height: 20px; font-size: 0.56rem; }
.avatar-sm { width: 26px; height: 26px; font-size: 0.64rem; }
.avatar-md { width: 38px; height: 38px; font-size: 0.85rem; }
.avatar-row { display: inline-flex; flex-wrap: wrap; gap: 0.3rem; }
/* Un anillo dice si lo leyó: la foto sola no distingue al que se enteró del
   que no, que es lo que se viene a mirar después de mandarlo. */
.avatar.is-read { box-shadow: 0 0 0 2px var(--accent-emerald); }
.avatar.is-unread { box-shadow: 0 0 0 2px var(--cta); opacity: 0.7; }

/* ─────────────────────────────── Pestañas ────────────────────────────── */

/* ───────────────── Avisos automáticos (enrutado por perfil) ───────────── */
.routing-intro { color: var(--text-muted); font-size: 0.85rem; margin: 0 0 0.9rem; }
.routing-warn {
  margin: 0 0 0.9rem;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  background: var(--surface-2);
  border-left: 3px solid var(--warning, #C9922E);
  font-size: 0.82rem;
}
.routing-group { margin-bottom: 1.1rem; }
.routing-group-title {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.routing-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border-color);
}
.routing-row:last-child { border-bottom: none; }
.routing-what { flex: 1 1 15rem; min-width: 0; }
.routing-what strong { display: block; font-size: 0.86rem; }
.routing-desc { display: block; font-size: 0.76rem; color: var(--text-muted); line-height: 1.35; }
.routing-roles { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: flex-start; }
/* La píldora pulsable del panel: el color y el borde los pone `.pill`, acá
   solo el estado elegido — misma pareja que el Libro Diario y Salarios. */
.role-chip {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: var(--surface-1);
  color: var(--text-muted);
  font-size: 0.76rem;
  cursor: pointer;
}
.role-chip:hover:not(:disabled) { border-color: var(--brand-olive, #6F8125); }
.role-chip.is-on {
  background: rgba(111, 129, 37, 0.14);
  border-color: var(--brand-olive, #6F8125);
  color: var(--text-main);
  font-weight: 600;
}
.role-chip:disabled { opacity: 0.5; cursor: not-allowed; }

.tabs { display: inline-flex; gap: 0.25rem; }
.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  cursor: pointer;
}
.tab:hover { color: var(--text-main); }
.tab.is-on {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  color: var(--on-tint-strong, var(--primary));
}

/* ──────────────────────────────── Lista ──────────────────────────────── */

.notice-list { list-style: none; margin: 0; padding: 0; }
.notice-row {
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--border-color);
}
.notice-row:last-child { border-bottom: none; }
.notice-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}
.notice-title { font-size: 0.88rem; }
.notice-when {
  font-size: 0.73rem;
  color: var(--text-muted);
  white-space: nowrap;
}
.notice-body {
  font-size: 0.8rem;
  color: var(--text-sub);
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
}
.notice-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.45rem;
}
.notice-sender { font-size: 0.73rem; color: var(--text-muted); }
.notice-to { margin-top: 0.45rem; }

/* ──────────────────────────────── Cuadro ─────────────────────────────── */

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.74rem;
  color: var(--text-muted);
  margin-bottom: 0.6rem;
}
.legend-item { display: inline-flex; align-items: center; gap: 0.3rem; }

.matrix-scroll {
  overflow-x: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 9px);
}
.matrix {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  font-size: 0.78rem;
}
.matrix th,
.matrix td { padding: 0.4rem 0.35rem; }

.matrix thead th {
  position: sticky;
  top: 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  z-index: 2;
}
/* La columna del aviso queda fija: con diez personas la fila se lee de lado, y
   sin el título a la vista no se sabe de qué aviso es la celda. */
.col-notice {
  position: sticky;
  left: 0;
  background: var(--bg-card);
  text-align: left;
  min-width: 190px;
  max-width: 230px;
  border-right: 1px solid var(--border-color);
  z-index: 1;
}
.matrix thead .col-notice { z-index: 3; }
.matrix tbody .col-notice { font-weight: 600; vertical-align: top; }
.matrix-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.matrix-when { font-size: 0.7rem; font-weight: 400; color: var(--text-muted); }

.col-person { width: 72px; }
.person-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  width: 100%;
  background: transparent;
  border: none;
  font: inherit;
  color: var(--text-sub);
  cursor: pointer;
  padding: 0;
}
.person-name {
  font-size: 0.7rem;
  max-width: 68px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.person-count {
  font-size: 0.65rem;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 0 0.35rem;
}

.matrix tbody tr:nth-child(even) td,
.matrix tbody tr:nth-child(even) .col-notice { background: var(--surface-1); }
.matrix tbody tr:hover td,
.matrix tbody tr:hover .col-notice { background: var(--bg-card-hover); }

.cell { text-align: center; }
.cell.is-focus,
.col-person.is-focus { background: color-mix(in srgb, var(--primary) 10%, transparent); }

.cell-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 700;
}
/* Los mismos tintes del sistema de píldoras del panel (`.pill-success` /
   `.pill-warning` / `.pill-neutral`, con sus correcciones de color para el tema
   oscuro): un cuadro de estados que inventa su propia paleta es el mismo verde
   diciendo dos cosas distintas según la pantalla. Y los tres se distinguen
   también por su FORMA —✓ relleno, ● relleno, ● hueco— porque el verde y el
   naranja son el mismo color con deuteranopía. */
.cell-dot.is-read {
  background: rgba(46, 125, 70, 0.12);
  color: #1F4A2C;
  border: 1px solid rgba(46, 125, 70, 0.35);
}
.cell-dot.is-unread {
  background: rgba(222, 117, 75, 0.14);
  color: #8C4A24;
  border: 1px solid rgba(222, 117, 75, 0.35);
}
.cell-dot.is-all {
  color: var(--text-sub);
  background: var(--surface-2);
  border: 1px solid var(--border-color);
}
.cell-dot.is-none { color: var(--text-muted); opacity: 0.5; }

:root[data-theme="dark"] .cell-dot.is-read { color: #5FBE79; }
:root[data-theme="dark"] .cell-dot.is-unread { color: #F0A87E; }

/* ──────────────────────── Lo que recibió una persona ─────────────────── */

.focus {
  margin-top: 0.85rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 9px);
  padding: 0.75rem;
  background: var(--surface-1);
}
.focus-head { display: flex; align-items: center; gap: 0.6rem; }
.focus-head > div { flex: 1; min-width: 0; }
.focus-head strong { display: block; font-size: 0.9rem; }
.focus-role { font-size: 0.74rem; color: var(--text-muted); }
.focus-sum { font-size: 0.78rem; color: var(--text-sub); margin: 0.5rem 0 0.4rem; }
.focus-list { list-style: none; margin: 0; padding: 0; }
.focus-list li {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.25rem 0;
  font-size: 0.8rem;
}
.focus-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.focus-when { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; }

@media (max-width: 760px) {
  .col-notice { min-width: 150px; }
}
</style>
