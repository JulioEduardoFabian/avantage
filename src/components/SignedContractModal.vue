<template>
  <!--
    Registrar el contrato ya firmado por el cliente.

    Dos formas y no una, porque el equipo usa las dos: el escaneo que llega por
    WhatsApp se sube, y el que ya vive en la carpeta de Drive del cliente se
    enlaza — copiarlo sería tener dos originales y no saber cuál manda. Son
    pestañas y no dos campos sueltos para que quede claro que es una o la otra:
    el servidor rechaza las dos juntas, y un formulario que deja llenar algo
    que después se rechaza es un formulario que miente.

    El resto de los campos son opcionales a propósito. Lo que no puede faltar
    es el documento; pedir además la fecha de firma y un título antes de dejar
    guardar es el camino más corto a que el contrato se quede sin subir.
  -->
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content signed-modal">
      <div class="modal-header">
        <h3 class="modal-title">📝 Contrato firmado</h3>
        <button class="modal-close-btn" @click="close">✕</button>
      </div>

      <div class="modal-body">
        <p class="sc-intro">
          Guarda acá el contrato que el cliente devolvió firmado, para
          <strong>{{ leadName }}</strong>. Queda en su ficha y no se puede borrar la ficha
          mientras exista.
        </p>

        <div v-if="error" class="sc-error" role="alert">{{ error }}</div>

        <!-- Documento: archivo o enlace -->
        <div class="form-group">
          <label class="form-label">¿Cómo lo tienes?</label>
          <div class="sc-tabs" role="radiogroup" aria-label="Forma de guardar el contrato firmado">
            <button
              v-for="mode in MODES"
              :key="mode.value"
              type="button"
              role="radio"
              :aria-checked="source === mode.value"
              class="sc-tab"
              :class="{ 'is-active': source === mode.value }"
              @click="selectSource(mode.value)"
            >
              <span aria-hidden="true">{{ mode.icon }}</span> {{ mode.label }}
            </button>
          </div>
        </div>

        <div v-if="source === 'archivo'" class="form-group">
          <label class="form-label" for="sc-file">Archivo firmado *</label>
          <input
            id="sc-file"
            ref="fileInput"
            type="file"
            class="form-input sc-file"
            :accept="ACCEPT"
            @change="onFilePicked"
          />
          <small class="sc-hint">
            PDF, Word o una foto del documento. Hasta 25 MB.
            <template v-if="file"> · Elegido: <strong>{{ file.name }}</strong> ({{ sizeLabel }})</template>
          </small>
        </div>

        <div v-else class="form-group">
          <label class="form-label" for="sc-url">Enlace al documento *</label>
          <input
            id="sc-url"
            v-model="externalUrl"
            type="url"
            class="form-input"
            placeholder="https://drive.google.com/file/d/..."
            inputmode="url"
          />
          <small class="sc-hint">
            El enlace de Drive (o de donde esté). Comprueba que esté compartido con el equipo:
            acá se guarda la dirección, no una copia.
          </small>
        </div>

        <div class="sc-grid">
          <div class="form-group">
            <label class="form-label" for="sc-title">Nombre del documento</label>
            <input
              id="sc-title"
              v-model="title"
              type="text"
              class="form-input"
              maxlength="200"
              placeholder="Contrato firmado"
            />
            <small class="sc-hint">Útil cuando hay más de uno (una adenda, una versión corregida).</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="sc-date">Fecha de firma</label>
            <input id="sc-date" v-model="signedAt" type="date" class="form-input" />
            <small class="sc-hint">El día en que se firmó, no el de hoy.</small>
          </div>
        </div>

        <!-- Atarlo al contrato emitido: lo marca como firmado en su módulo -->
        <div v-if="contracts.length" class="form-group">
          <label class="form-label" for="sc-contract">¿A qué contrato emitido corresponde?</label>
          <select id="sc-contract" v-model="contractId" class="form-input">
            <option :value="null">Ninguno · se firmó fuera del sistema</option>
            <option v-for="c in contracts" :key="c.id" :value="c.id">
              {{ c.title }}{{ c.contract_date ? ` · ${diaCorto(c.contract_date)}` : '' }}
              {{ c.status === 'firmado' ? '· ya marcado como firmado' : '' }}
            </option>
          </select>
          <small class="sc-hint">
            Si eliges uno, ese contrato queda marcado como <strong>firmado</strong> en el módulo de
            Contratos: así las dos pantallas no dicen cosas distintas del mismo papel.
          </small>
        </div>

        <div class="form-group">
          <label class="form-label" for="sc-notes">Nota</label>
          <textarea
            id="sc-notes"
            v-model="notes"
            class="form-input sc-notes"
            rows="2"
            maxlength="500"
            placeholder="Ej.: firmado por el apoderado; falta la firma de la página 3."
          ></textarea>
        </div>

        <div class="sc-actions">
          <button type="button" class="btn-action-ghost" :disabled="isSaving" @click="close">Cancelar</button>
          <button
            type="button"
            class="btn-action-primary"
            :disabled="isSaving || !canSave"
            :title="canSave ? '' : 'Falta el documento: sube el archivo o pega el enlace.'"
            @click="save"
          >
            {{ isSaving ? 'Guardando…' : '📝 Guardar contrato firmado' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { apiFetch } from '../apiClient.js';

const props = defineProps({
  lead: { type: Object, required: true },
  /**
   * Los contratos emitidos del lead, que la ficha ya pidió al abrir la lista.
   * Se reciben en vez de volver a pedirlos: es la misma respuesta.
   */
  contracts: { type: Array, default: () => [] }
});
const emit = defineEmits(['close', 'saved']);

const MODES = [
  { value: 'archivo', icon: '📎', label: 'Subir archivo' },
  { value: 'enlace', icon: '🔗', label: 'Enlace de Drive' }
];
/** Lo mismo que acepta el servidor (`uploadSignedContract`). */
const ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,image/*';

const source = ref('archivo');
const file = ref(null);
const fileInput = ref(null);
const externalUrl = ref('');
const title = ref('');
const signedAt = ref('');
/*
 * Con un solo contrato emitido, el desplegable no es una pregunta: es el
 * contrato. Se preselecciona —y se puede cambiar— desde el arranque: las props
 * ya están acá, así que esperar al montaje solo lo dibujaría una vez vacío.
 */
const contractId = ref(props.contracts.length === 1 ? props.contracts[0].id : null);
const notes = ref('');
const isSaving = ref(false);
const error = ref('');

const leadName = computed(() => props.lead?.full_name || `Lead #${props.lead?.id}`);

/** "2026-10-19" → "19/10/2026", armada como fecha LOCAL para no correr el día. */
function diaCorto(iso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : iso;
}

const sizeLabel = computed(() => {
  const bytes = file.value?.size || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
});

/** La misma regla que aplica el servidor: uno u otro, nunca ninguno. */
const canSave = computed(() => (
  source.value === 'archivo' ? Boolean(file.value) : externalUrl.value.trim().length > 0
));

/**
 * Cambiar de pestaña limpia la otra forma: si no, se manda el archivo Y el
 * enlace y el servidor rechaza con razón — el formulario no puede ofrecer algo
 * que ya sabe que no se acepta.
 */
function selectSource(value) {
  source.value = value;
  error.value = '';
  if (value === 'archivo') externalUrl.value = '';
  else clearFile();
}

function clearFile() {
  file.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

function onFilePicked(event) {
  file.value = event.target.files?.[0] || null;
  error.value = '';
}

function close() {
  if (isSaving.value) return;
  emit('close');
}

async function save() {
  if (!canSave.value) return;
  isSaving.value = true;
  error.value = '';
  try {
    const body = new FormData();
    if (source.value === 'archivo') body.append('file', file.value);
    else body.append('externalUrl', externalUrl.value.trim());
    if (title.value.trim()) body.append('title', title.value.trim());
    if (signedAt.value) body.append('signedAt', signedAt.value);
    if (contractId.value) body.append('contractId', String(contractId.value));
    if (notes.value.trim()) body.append('notes', notes.value.trim());

    const response = await apiFetch(`/api/leads/${props.lead.id}/signed-contracts`, {
      method: 'POST',
      body
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo guardar el contrato firmado.');
    emit('saved', data.document);
  } catch (e) {
    error.value = e.message;
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.signed-modal { max-width: 560px; width: 100%; }
.sc-intro {
  font-size: 0.84rem;
  color: var(--text-sub);
  margin: 0 0 0.75rem;
  line-height: 1.5;
}
.sc-error {
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-rose);
  color: var(--accent-rose);
  font-size: 0.82rem;
  margin-bottom: 0.75rem;
}

.sc-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.sc-tab {
  flex: 1 1 160px;
  border: 1px solid var(--border-strong);
  background: var(--bg-card-solid);
  color: var(--text-sub);
  padding: 0.5rem 0.7rem;
  border-radius: var(--radius-md);
  font-size: 0.84rem;
  cursor: pointer;
}
.sc-tab.is-active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

.sc-file { padding: 0.4rem; }
.sc-notes { resize: vertical; min-height: 56px; font-family: inherit; }
.sc-hint {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.73rem;
  color: var(--text-muted);
  line-height: 1.45;
}
.sc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 0.75rem; }
.sc-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }

@media (max-width: 540px) {
  .sc-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
