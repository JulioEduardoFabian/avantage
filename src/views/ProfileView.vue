<template>
  <main class="container-fluid pf-page">
    <header class="page-header">
      <div class="page-header-titles">
        <span class="page-eyebrow">Tu cuenta</span>
        <h2 class="section-heading"><span class="heading-icon">👤</span> Mi perfil</h2>
        <p class="section-subheading pf-subheading">
          Tu foto y tu contraseña las manejas desde acá, sin pedirle nada a nadie. Tu nombre, tu
          correo y tu rol los administra quien gestiona Perfiles, porque de ellos cuelgan los
          permisos y los documentos que ya se emitieron a tu nombre.
        </p>
      </div>
    </header>

    <p v-if="loadError" class="info-box pf-alert">⚠️ {{ loadError }}</p>

    <div v-if="profile" class="pf-grid">
      <!-- ============================ Identidad ============================ -->
      <section class="pf-card">
        <div class="pf-identity">
          <span class="pf-avatar" :style="avatarStyle">
            <img v-if="profile.avatar_url" :src="profile.avatar_url" :alt="'Foto de ' + profile.name" />
            <span v-else>{{ initials(profile.name) }}</span>
          </span>
          <div class="pf-identity-text">
            <h3 class="pf-name">{{ profile.name }}</h3>
            <span class="pf-email data-mono">{{ profile.email }}</span>
            <span class="pill pill-neutral pf-role">{{ profile.role }}</span>
          </div>
        </div>

        <div class="pf-photo-actions">
          <!-- El input va oculto y lo dispara el botón: el control nativo no se
               puede estilar y en el panel quedaba como una pieza de otro sitio. -->
          <input
            ref="fileInput"
            type="file"
            class="pf-file-input"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="onFileChosen"
          />
          <button
            type="button"
            class="btn-action-primary"
            :disabled="isUploading"
            @click="fileInput?.click()"
          >
            <span class="btn-icon">📷</span>
            {{ uploadButtonLabel }}
          </button>
          <button
            v-if="profile.avatar_url"
            type="button"
            class="btn-action-secondary"
            :disabled="isUploading"
            @click="removeAvatar"
          >
            Quitar foto
          </button>
        </div>

        <p v-if="avatarError" class="pf-field-error">{{ avatarError }}</p>
        <p v-else-if="avatarFlash" class="pf-field-ok">✔️ {{ avatarFlash }}</p>
        <p v-else class="pf-hint">
          JPG, PNG, WEBP o GIF, hasta 4 MB. Se recorta en círculo, así que una foto cuadrada se ve
          mejor. Donde no haya foto se siguen viendo tus iniciales.
        </p>
      </section>

      <!-- =========================== Contraseña ============================ -->
      <section class="pf-card">
        <h3 class="pf-card-title">Contraseña</h3>
        <p class="pf-card-note">
          <template v-if="profile.password_changed_at">
            La cambiaste por última vez el {{ formatDay(profile.password_changed_at) }}.
          </template>
          <template v-else>
            Todavía no la cambiaste desde esta pantalla. Si sigues usando la que te dieron al crear
            la cuenta, este es el momento.
          </template>
        </p>

        <form class="pf-form" @submit.prevent="changePassword">
          <div class="pf-field">
            <label class="form-label" for="pf-current">Contraseña actual</label>
            <input
              id="pf-current"
              v-model="form.current"
              type="password"
              class="form-input"
              autocomplete="current-password"
              placeholder="La que usas hoy"
            />
          </div>

          <div class="pf-field">
            <label class="form-label" for="pf-new">Contraseña nueva</label>
            <input
              id="pf-new"
              v-model="form.next"
              type="password"
              class="form-input"
              autocomplete="new-password"
              :placeholder="'Mínimo ' + minLength + ' caracteres'"
            />
          </div>

          <div class="pf-field">
            <label class="form-label" for="pf-repeat">Repetir la nueva</label>
            <input
              id="pf-repeat"
              v-model="form.repeat"
              type="password"
              class="form-input"
              autocomplete="new-password"
              placeholder="Otra vez, para descartar un dedazo"
            />
          </div>

          <p v-if="passwordError" class="pf-field-error">{{ passwordError }}</p>
          <p v-else-if="passwordFlash" class="pf-field-ok">✔️ {{ passwordFlash }}</p>

          <div class="pf-form-actions">
            <button type="submit" class="btn-action-primary" :disabled="isSavingPassword">
              {{ isSavingPassword ? 'Guardando…' : 'Cambiar contraseña' }}
            </button>
          </div>
        </form>

        <p class="pf-hint">
          Tu sesión abierta sigue valiendo: lo que cambia es la contraseña, no tu identidad. La
          próxima vez que entres, usa la nueva.
        </p>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { apiFetch } from '../apiClient.js';
import { authState, setSession } from '../auth.js';
import { avatarColor, initials } from '../avatars.js';

/*
 * Lo que acepta el servidor (ver `AVATAR_MIMES` y el límite de multer en
 * backend/middleware/upload.js). Se comprueba también acá para no hacerle subir
 * 4 MB a alguien y rechazárselos después — el que manda sigue siendo el
 * servidor, esto solo evita el viaje.
 */
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const profile = ref(null);
const minLength = ref(8);
const loadError = ref('');

const fileInput = ref(null);
const isUploading = ref(false);
const avatarError = ref('');
const avatarFlash = ref('');

const avatarStyle = computed(() => (
  profile.value?.avatar_url ? null : { background: avatarColor(profile.value?.name) }
));

const uploadButtonLabel = computed(() => {
  if (isUploading.value) return 'Subiendo…';
  return profile.value?.avatar_url ? 'Cambiar foto' : 'Subir foto';
});

const form = reactive({ current: '', next: '', repeat: '' });
const isSavingPassword = ref(false);
const passwordError = ref('');
const passwordFlash = ref('');

onMounted(load);

async function load() {
  loadError.value = '';
  try {
    const response = await apiFetch('/api/profile');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar tu perfil.');
    profile.value = data.profile;
    if (data.minPasswordLength) minLength.value = data.minPasswordLength;
  } catch (error) {
    loadError.value = error.message || 'No se pudo cargar tu perfil.';
  }
}

/**
 * Deja la sesión del navegador con la foto nueva.
 *
 * El avatar del navbar sale de `authState.user`, que se refresca UNA vez por
 * carga de la app (`refreshSessionOnce`), así que sin esto la foto recién
 * subida no se vería arriba hasta recargar la página. El token no se toca: lo
 * que lleva son los permisos, y esos no cambiaron.
 */
function syncSessionAvatar(url) {
  if (!authState.user) return;
  setSession(authState.token, { ...authState.user, avatar_url: url });
}

function onFileChosen(event) {
  const file = event.target.files?.[0];
  // El input se limpia siempre: si no, elegir la MISMA foto otra vez (después
  // de un error) no dispara el `change` y parece que el botón no hace nada.
  event.target.value = '';
  if (file) uploadAvatar(file);
}

async function uploadAvatar(file) {
  avatarError.value = '';
  avatarFlash.value = '';

  if (!AVATAR_TYPES.includes(file.type)) {
    avatarError.value = 'La foto debe ser JPG, PNG, WEBP o GIF.';
    return;
  }
  if (file.size > MAX_AVATAR_BYTES) {
    avatarError.value = 'La foto pesa más de 4 MB. Usa una más liviana o recórtala.';
    return;
  }

  isUploading.value = true;
  try {
    const body = new FormData();
    body.append('avatar', file);
    // Sin Content-Type a mano: el navegador tiene que poner el boundary del
    // multipart (mismo cuidado que el resto de los formularios con archivo).
    const response = await apiFetch('/api/profile/avatar', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar la foto.');

    // El nombre del archivo cambia en cada subida, así que la foto nueva se ve
    // al instante sin pelear con la caché del navegador.
    profile.value = { ...profile.value, avatar_url: data.avatar_url };
    syncSessionAvatar(data.avatar_url);
    avatarFlash.value = 'Foto actualizada.';
  } catch (error) {
    avatarError.value = error.message || 'No se pudo guardar la foto.';
  } finally {
    isUploading.value = false;
  }
}

async function removeAvatar() {
  avatarError.value = '';
  avatarFlash.value = '';
  isUploading.value = true;
  try {
    const response = await apiFetch('/api/profile/avatar', { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo quitar la foto.');

    profile.value = { ...profile.value, avatar_url: null };
    syncSessionAvatar(null);
    avatarFlash.value = 'Volviste a tus iniciales.';
  } catch (error) {
    avatarError.value = error.message || 'No se pudo quitar la foto.';
  } finally {
    isUploading.value = false;
  }
}

async function changePassword() {
  passwordError.value = '';
  passwordFlash.value = '';

  /*
   * Las cuatro comprobaciones que se pueden hacer sin preguntarle nada al
   * servidor. Las reglas de verdad están en `#writePassword()` del backend
   * —estas solo evitan un viaje— y por eso dicen lo mismo, palabra por palabra:
   * dos mensajes distintos para el mismo rechazo se leen como dos problemas.
   */
  if (!form.current) {
    passwordError.value = 'Escribe tu contraseña actual.';
    return;
  }
  if (form.next.length < minLength.value) {
    passwordError.value = `La contraseña nueva debe tener al menos ${minLength.value} caracteres.`;
    return;
  }
  if (form.next !== form.repeat) {
    passwordError.value = 'La contraseña nueva y su repetición no coinciden.';
    return;
  }
  if (form.next === form.current) {
    passwordError.value = 'La contraseña nueva es igual a la actual.';
    return;
  }

  isSavingPassword.value = true;
  try {
    const response = await apiFetch('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: form.current, newPassword: form.next })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña.');

    profile.value = { ...profile.value, password_changed_at: data.changed_at };
    form.current = '';
    form.next = '';
    form.repeat = '';
    passwordFlash.value = 'Contraseña cambiada. Úsala la próxima vez que entres.';
  } catch (error) {
    passwordError.value = error.message || 'No se pudo cambiar la contraseña.';
  } finally {
    isSavingPassword.value = false;
  }
}

function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
}
</script>

<style scoped>
/* El aire de la pantalla sale de los tokens del panel y no de un padding
   propio: así esta vista respira igual que las demás de /admin. */
.pf-page {
  padding: var(--page-py) var(--page-px) var(--page-pb);
  width: 100%;
  box-sizing: border-box;
}

.pf-subheading {
  max-width: 62ch;
}

.pf-grid {
  display: grid;
  /* Dos tarjetas en escritorio y una columna en cuanto no entren: no hay nada
     que comparar entre ellas, así que apiladas se leen igual de bien. */
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
  align-items: start;
}

.pf-card {
  background: var(--bg-card-solid);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1.1rem 1.15rem;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.pf-identity {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.pf-avatar {
  width: 86px;
  height: 86px;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #ffffff;
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: 1.6rem;
  border: 2px solid var(--border-color);
}

.pf-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pf-identity-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-width: 0;
}

.pf-name {
  font-family: var(--font-heading);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.pf-email {
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.pf-role {
  font-size: 0.7rem;
}

.pf-photo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pf-file-input {
  display: none;
}

.pf-card-title {
  font-family: var(--font-heading);
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--text-main);
  margin: 0;
}

.pf-card-note,
.pf-hint {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}

.pf-form {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.pf-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.pf-form-actions {
  display: flex;
  justify-content: flex-start;
}

.pf-field-error,
.pf-field-ok {
  font-size: 0.8rem;
  line-height: 1.45;
  margin: 0;
}

.pf-field-error {
  color: var(--accent-rose);
}

.pf-field-ok {
  color: var(--accent-emerald);
}

.pf-alert {
  border-left: 3px solid var(--accent-rose);
}

@media (max-width: 520px) {
  .pf-identity {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
