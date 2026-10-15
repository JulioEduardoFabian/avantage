<template>
  <main class="container-fluid rt-page">
    <header class="page-header">
      <div class="page-header-titles">
        <span class="page-eyebrow">Configuración</span>
        <h2 class="section-heading"><span class="heading-icon">🔀</span> Reparto de leads</h2>
        <p class="section-subheading rt-subheading">
          Quién recibe los leads que entran solos —por el bot de WhatsApp, los formularios de Meta y el
          evaluador de tesis— y en qué proporción. Cada persona tiene un <strong>peso</strong>: de cada
          vuelta, le tocan tantos leads como su peso.
        </p>
      </div>
    </header>

    <section class="rt-status" :class="{ 'is-live': pool?.enabled }">
      <span class="rt-status-pill">{{ pool?.enabled ? 'Activo' : 'Vista previa' }}</span>
      <p class="rt-status-text">
        <template v-if="pool?.enabled">Los leads nuevos se están repartiendo con esta configuración.</template>
        <template v-else>
          <strong>Todavía no reparte.</strong> Los leads siguen entrando como hoy, sin responsable. Lo que
          armes acá es exactamente lo que se va a aplicar cuando se active.
        </template>
      </p>
    </section>

    <p v-if="error" class="info-box rt-alert">⚠️ {{ error }}</p>
    <p v-if="flash" class="info-box rt-flash">✔️ {{ flash }}</p>

    <div class="rt-layout">
      <!-- ===================== Quiénes reciben ===================== -->
      <section class="rt-card">
        <div class="rt-card-head">
          <h3 class="rt-card-title">Quiénes reciben leads <span class="rt-count">{{ members.length }}</span></h3>
          <p class="rt-card-note">Con pesos iguales, empieza el de más arriba.</p>
        </div>

        <p v-if="isLoading" class="rt-card-note">Cargando la configuración…</p>

        <div v-else-if="members.length === 0" class="empty-state rt-empty">
          <p class="empty-state-title">Nadie recibe leads todavía</p>
          <p class="empty-state-text">
            Suma abajo a la primera persona. Por ejemplo: la setter con peso 5 y el closer con peso 1
            reparte 5 leads a ella por cada 1 a él.
          </p>
        </div>

        <ul v-else class="rt-list">
          <li
            v-for="(member, index) in members"
            :key="member.id"
            class="rt-row"
            :class="{ 'is-paused': !inRotation(member) }"
          >
            <div class="rt-order">
              <button type="button" class="rt-icon-btn" title="Subir" :disabled="index === 0 || isBusy" @click="move(index, -1)">↑</button>
              <button type="button" class="rt-icon-btn" title="Bajar" :disabled="index === members.length - 1 || isBusy" @click="move(index, 1)">↓</button>
            </div>

            <span class="rt-avatar" :style="{ background: avatarColor(member.name) }">{{ initials(member.name) }}</span>

            <div class="rt-who">
              <span class="rt-name">{{ member.name }}</span>
              <span class="rt-role">{{ member.role_name }}</span>
              <span v-if="!member.eligible" class="rt-warn is-danger">
                Ya no es del área comercial: el reparto la saltea.
              </span>
              <span v-else-if="!member.can_see_setter_funnel" class="rt-warn">
                No tiene acceso al Setter Funnel, donde nacen estos leads: no vería los que le toquen.
                Dale el permiso en Perfiles.
              </span>
            </div>

            <div class="rt-weight" :title="`Peso: de cada vuelta, ${member.weight} lead(s) para esta persona`">
              <button type="button" class="rt-step" :disabled="member.weight <= 1 || isBusy" @click="setWeight(member, member.weight - 1)">−</button>
              <span class="rt-weight-value">{{ member.weight }}</span>
              <button type="button" class="rt-step" :disabled="member.weight >= 20 || isBusy" @click="setWeight(member, member.weight + 1)">+</button>
            </div>

            <div class="rt-share">
              <template v-if="inRotation(member)">
                <span class="rt-share-text">{{ member.weight }} de cada {{ roundSize }} · {{ percent(member) }}%</span>
                <span class="rt-bar"><span class="rt-bar-fill" :style="{ width: percent(member) + '%', background: avatarColor(member.name) }"></span></span>
              </template>
              <span v-else class="rt-share-text is-muted">No recibe</span>
            </div>

            <button
              type="button"
              class="rt-toggle"
              :class="{ 'is-on': member.active }"
              :disabled="isBusy"
              :title="member.active ? 'Pausar: deja de recibir sin perder su peso' : 'Volver a recibir leads'"
              @click="toggleActive(member)"
            >
              {{ member.active ? 'Recibe' : 'En pausa' }}
            </button>

            <button type="button" class="rt-icon-btn is-danger" title="Quitar del reparto" :disabled="isBusy" @click="remove(member)">🗑️</button>
          </li>
        </ul>

        <form class="rt-add" @submit.prevent="addMember">
          <select v-model="newMember.userId" class="form-select rt-add-select" :disabled="candidates.length === 0">
            <option :value="null">
              {{ candidates.length === 0 ? 'Todo el área comercial ya está en el reparto' : 'Sumar a una persona del área comercial…' }}
            </option>
            <option v-for="user in candidates" :key="user.id" :value="user.id">
              {{ user.name }} — {{ user.role_name }}
            </option>
          </select>
          <label class="rt-add-weight">
            Peso
            <input v-model.number="newMember.weight" type="number" min="1" max="20" class="form-input" />
          </label>
          <button type="submit" class="btn-action-primary" :disabled="!newMember.userId || isBusy">+ Sumar</button>
        </form>
      </section>

      <!-- ===================== Cómo va a quedar ===================== -->
      <aside class="rt-side">
        <section class="rt-card">
          <div class="rt-card-head">
            <h3 class="rt-card-title">Los próximos {{ preview.length || '' }} leads</h3>
            <p class="rt-card-note">Así se repartirían, en orden, a partir de ahora.</p>
          </div>

          <p v-if="preview.length === 0" class="rt-card-note">
            Sin nadie que reciba, los leads entrarían sin responsable, como hoy.
          </p>

          <template v-else>
            <ol class="rt-sequence">
              <li
                v-for="(memberId, index) in preview"
                :key="index"
                class="rt-seq-item"
                :class="{ 'is-round-end': (index + 1) % roundSize === 0 && index + 1 < preview.length }"
                :title="`Lead ${index + 1}: ${memberById(memberId)?.name}`"
              >
                <span class="rt-seq-num">{{ index + 1 }}</span>
                <span class="rt-avatar is-small" :style="{ background: avatarColor(memberById(memberId)?.name) }">
                  {{ initials(memberById(memberId)?.name) }}
                </span>
              </li>
            </ol>
            <p class="rt-summary">
              De cada <strong>{{ roundSize }}</strong> leads:
              <span v-for="(member, i) in rotation" :key="member.id">
                <strong>{{ member.weight }}</strong> para {{ member.name }}<template v-if="i < rotation.length - 2">, </template><template v-else-if="i === rotation.length - 2"> y </template>
              </span>.
              Se intercalan en vez de ir en bloque, así nadie recibe una ráfaga seguida.
            </p>
          </template>
        </section>

        <section class="rt-card rt-howto">
          <h3 class="rt-card-title">Cómo se va a usar</h3>
          <ol class="rt-steps">
            <li>Entra un lead por el <strong>bot de WhatsApp</strong>, un <strong>formulario de Meta</strong> o el <strong>evaluador de tesis</strong>.</li>
            <li>Si esa persona ya estaba registrada (mismo celular), <strong>sigue con quien la tenía</strong>: no se vuelve a repartir.</li>
            <li>Si es nueva, se le asigna a quien sigue en la vuelta y aparece como <strong>responsable</strong> en su tarjeta, igual que si la hubiera asignado el jefe comercial.</li>
            <li>Quien está <strong>en pausa</strong> o dejó de ser del área comercial se saltea, y los demás se reparten su parte.</li>
            <li>Los leads que se cargan <strong>a mano</strong> no pasan por acá, y reasignar desde la tarjeta sigue funcionando igual.</li>
          </ol>
          <p class="rt-card-note">
            Cada cambio en esta pantalla hace empezar la vuelta de nuevo, así lo que ves arriba es exactamente lo que va a salir.
          </p>
        </section>
      </aside>
    </div>
  </main>
</template>

<script setup>
/**
 * Configuración del reparto automático de leads (`/admin/reparto`).
 *
 * La vista previa se calcula acá con `src/leadRouting.js` —el espejo de la
 * regla del servidor— para que mover un peso cambie la secuencia al instante.
 * Lo que se guarda lo decide el servidor: después de cada cambio la lista se
 * reemplaza con la que devuelve la respuesta.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { avatarColor, initials } from '../avatars.js';
import { isEligible, simulateRouting } from '../leadRouting.js';

const MAX_PREVIEW = 24;

const pool = ref(null);
const members = ref([]);
const candidates = ref([]);
const isLoading = ref(true);
const isBusy = ref(false);
const error = ref('');
const flash = ref('');
const newMember = reactive({ userId: null, weight: 1 });

const rotation = computed(() => members.value.filter(isEligible));
const roundSize = computed(() => rotation.value.reduce((sum, member) => sum + member.weight, 0));

/** Una vuelta completa (o dos, si es corta), nunca más de 24 círculos. */
const preview = computed(() => {
  if (roundSize.value === 0) return [];
  const count = Math.min(MAX_PREVIEW, roundSize.value < 8 ? roundSize.value * 2 : roundSize.value);
  return simulateRouting(members.value, count);
});

function inRotation(member) {
  return isEligible(member);
}

function percent(member) {
  return roundSize.value ? Math.round((member.weight / roundSize.value) * 100) : 0;
}

function memberById(id) {
  return members.value.find((member) => member.id === id);
}

function notify(message) {
  flash.value = message;
  error.value = '';
  setTimeout(() => {
    if (flash.value === message) flash.value = '';
  }, 4000);
}

function apply(data) {
  pool.value = data.pool || null;
  members.value = data.members || [];
  candidates.value = data.candidates || [];
}

async function send(method, url, body) {
  isBusy.value = true;
  try {
    const response = await apiFetch(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el cambio.');
    apply(data);
    return data;
  } finally {
    isBusy.value = false;
  }
}

async function run(action, successMessage) {
  try {
    await action();
    if (successMessage) notify(successMessage);
  } catch (err) {
    error.value = err.message;
    flash.value = '';
    await fetchConfig();
  }
}

async function fetchConfig() {
  try {
    const response = await apiFetch('/api/lead-routing');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el reparto.');
    apply(data);
  } catch (err) {
    error.value = err.message;
  } finally {
    isLoading.value = false;
  }
}

async function addMember() {
  const user = candidates.value.find((candidate) => candidate.id === newMember.userId);
  if (!user) return;
  await run(
    () => send('POST', '/api/lead-routing/members', { userId: user.id, weight: newMember.weight }),
    `${user.name} ya está en el reparto.`
  );
  newMember.userId = null;
  newMember.weight = 1;
}

async function setWeight(member, weight) {
  member.weight = weight; // la vista previa se mueve antes de que vuelva la respuesta
  await run(() => send('PATCH', `/api/lead-routing/members/${member.id}`, { weight }));
}

async function toggleActive(member) {
  const active = !member.active;
  await run(
    () => send('PATCH', `/api/lead-routing/members/${member.id}`, { active }),
    active ? `${member.name} vuelve a recibir leads.` : `${member.name} queda en pausa: no recibe hasta que la reactives.`
  );
}

async function remove(member) {
  if (!confirm(`¿Quitar a ${member.name} del reparto? Los leads que ya tiene no cambian.`)) return;
  await run(() => send('DELETE', `/api/lead-routing/members/${member.id}`), `${member.name} ya no recibe leads.`);
}

async function move(index, offset) {
  const ids = members.value.map((member) => member.id);
  const target = index + offset;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  await run(() => send('PATCH', '/api/lead-routing/members/reorder', { ids }));
}

onMounted(fetchConfig);
</script>

<style scoped>
.rt-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  box-sizing: border-box;
}

.rt-subheading {
  max-width: 720px;
  margin-bottom: 0;
}

.rt-alert {
  border-color: rgba(200, 85, 50, 0.4);
  color: var(--accent-rose);
}

.rt-flash {
  border-color: rgba(60, 160, 120, 0.4);
  color: var(--accent-emerald);
}

/* ---------- estado ---------- */
.rt-status {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  border: 1px dashed var(--accent-amber);
  border-radius: var(--radius-md);
  background: rgba(222, 117, 75, 0.08);
}

.rt-status.is-live {
  border-style: solid;
  border-color: var(--accent-emerald);
  background: rgba(46, 125, 70, 0.08);
}

.rt-status-pill {
  flex-shrink: 0;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #fff;
  background: var(--accent-amber);
}

.rt-status.is-live .rt-status-pill {
  background: var(--accent-emerald);
}

.rt-status-text {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-sub);
}

/* ---------- layout ---------- */
.rt-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
  gap: 1rem;
  align-items: start;
}

.rt-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rt-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: 1rem;
  box-shadow: var(--shadow-sm);
}

.rt-card-head {
  margin-bottom: 0.75rem;
}

.rt-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.rt-card-note {
  margin: 0.2rem 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.rt-count {
  font-size: 0.72rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--bg-page-alt);
  color: var(--text-muted);
}

.rt-empty {
  padding: 1.5rem 0.5rem;
}

/* ---------- miembros ---------- */
.rt-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rt-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto 150px auto auto;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.rt-row.is-paused {
  background: var(--bg-page-alt);
}

.rt-row.is-paused .rt-avatar,
.rt-row.is-paused .rt-name {
  opacity: 0.55;
}

.rt-order {
  display: flex;
  flex-direction: column;
}

.rt-icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.1rem 0.3rem;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
}

.rt-icon-btn:hover:not(:disabled) {
  background: var(--bg-card-hover);
  color: var(--text-main);
}

.rt-icon-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.rt-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.rt-avatar.is-small {
  width: 28px;
  height: 28px;
  font-size: 0.68rem;
}

.rt-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rt-name {
  font-weight: 600;
  font-size: 0.88rem;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rt-role {
  font-size: 0.74rem;
  color: var(--text-muted);
}

.rt-warn {
  margin-top: 0.25rem;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--accent-amber);
}

.rt-warn.is-danger {
  color: var(--accent-rose);
}

.rt-weight {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.rt-step {
  border: none;
  background: var(--bg-page-alt);
  width: 28px;
  height: 30px;
  cursor: pointer;
  font-size: 1rem;
  color: var(--text-main);
}

.rt-step:disabled {
  opacity: 0.35;
  cursor: default;
}

.rt-weight-value {
  min-width: 30px;
  text-align: center;
  font-weight: 700;
  font-family: var(--font-mono);
  font-size: 0.9rem;
}

.rt-share {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.rt-share-text {
  font-size: 0.75rem;
  color: var(--text-sub);
  white-space: nowrap;
}

.rt-share-text.is-muted {
  color: var(--text-muted);
  font-style: italic;
}

.rt-bar {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-page-alt);
  overflow: hidden;
}

.rt-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  transition: width 0.2s ease;
}

.rt-toggle {
  border: 1px solid var(--border-strong);
  background: var(--bg-page-alt);
  color: var(--text-muted);
  border-radius: 999px;
  padding: 0.25rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  min-width: 82px;
}

.rt-toggle.is-on {
  border-color: var(--accent-emerald);
  background: rgba(46, 125, 70, 0.12);
  color: var(--accent-emerald);
}

/* ---------- sumar ---------- */
.rt-add {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--border-color);
}

.rt-add-select {
  flex: 1;
  min-width: 0;
}

.rt-add-weight {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.rt-add-weight .form-input {
  width: 64px;
}

/* ---------- vista previa ---------- */
.rt-sequence {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.rt-seq-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.rt-seq-item.is-round-end {
  padding-right: 0.6rem;
  margin-right: 0.15rem;
  border-right: 2px dotted var(--border-strong);
}

.rt-seq-num {
  font-size: 0.62rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.rt-summary {
  margin: 0.8rem 0 0;
  font-size: 0.8rem;
  color: var(--text-sub);
  line-height: 1.5;
}

/* ---------- cómo se usa ---------- */
.rt-steps {
  margin: 0.6rem 0 0.4rem;
  padding-left: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-size: 0.8rem;
  color: var(--text-sub);
  line-height: 1.45;
}

@media (max-width: 1100px) {
  .rt-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .rt-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'avatar who remove'
      'weight share toggle';
  }

  .rt-order {
    display: none;
  }

  .rt-avatar { grid-area: avatar; }
  .rt-who { grid-area: who; }
  .rt-weight { grid-area: weight; }
  .rt-share { grid-area: share; }
  .rt-toggle { grid-area: toggle; }
  .rt-row > .rt-icon-btn { grid-area: remove; }

  .rt-add {
    flex-wrap: wrap;
  }

  .rt-add-select {
    flex-basis: 100%;
  }
}
</style>
