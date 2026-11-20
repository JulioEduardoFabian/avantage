<template>
  <div class="receipt-cell">
    <span
      v-for="rcpt in receipts"
      :key="rcpt.id"
      class="receipt-thumb"
      :title="receiptTitle(rcpt)"
    >
      <button
        v-if="urls[rcpt.id]"
        type="button"
        class="receipt-thumb-link"
        :aria-label="`Ver ${receiptTitle(rcpt)}`"
        @click="open(rcpt)"
      >
        <span v-if="isPdfReceipt(rcpt.mime_type, rcpt.original_name)" class="receipt-thumb-pdf">PDF</span>
        <img v-else :src="urls[rcpt.id]" alt="" />
      </button>
      <span v-else-if="rcpt.missing" class="receipt-thumb-missing">!</span>
      <span v-else class="receipt-thumb-loading">…</span>
      <button
        type="button"
        class="receipt-remove"
        title="Eliminar comprobante"
        @click="emit('remove', rcpt.id)"
      >✕</button>
    </span>

    <label class="receipt-add" title="Agregar comprobantes (imágenes o PDF)">
      <input
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        @change="(e) => emit('upload', e)"
      />
      +
    </label>

    <!--
      El visor va teleportado al `body` a propósito: la tabla del libro vive
      dentro de un contenedor con `overflow-x: auto`, y cualquier cosa
      posicionada dentro de ella se recorta en el borde. Es el mismo motivo por
      el que el menú de asignación de un lead se teletransporta.
    -->
    <Teleport to="body">
      <div
        v-if="viewing"
        class="receipt-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="receiptTitle(viewing)"
        @click.self="close"
      >
        <div class="receipt-viewer-box">
          <header class="receipt-viewer-head">
            <span class="receipt-viewer-name">{{ receiptTitle(viewing) }}</span>
            <a
              :href="urls[viewing.id]"
              target="_blank"
              rel="noopener"
              class="receipt-viewer-open"
            >Abrir en pestaña ↗</a>
            <button type="button" class="receipt-viewer-close" aria-label="Cerrar" @click="close">✕</button>
          </header>
          <iframe
            v-if="isPdfReceipt(viewing.mime_type, viewing.original_name)"
            :src="urls[viewing.id]"
            class="receipt-viewer-pdf"
            :title="receiptTitle(viewing)"
          ></iframe>
          <img v-else :src="urls[viewing.id]" :alt="receiptTitle(viewing)" class="receipt-viewer-img" />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { isPdfReceipt } from './receiptImage.js';

/**
 * La celda de comprobantes del libro: las miniaturas de lo ya subido, el botón
 * para agregar más y el visor para leerlos.
 *
 * Es un componente y no el mismo bloque copiado porque estaba **cuatro veces**
 * —Ingresos, Libro Diario y las dos filas de Salarios, el acuerdo y sus
 * pagos—, idénticas hasta el último atributo. Con cuatro copias, arreglar el
 * recorte de la miniatura en una dejaba las otras tres mostrando un pedazo del
 * comprobante.
 *
 * Dos decisiones del visor:
 *
 *  - La miniatura es **un botón que abre el visor**, no un enlace a una pestaña
 *    nueva. Un comprobante se mira para comprobar un dato (el monto, la fecha,
 *    el destinatario) y después se vuelve a la fila: la pestaña nueva obliga a
 *    cerrarla y a buscar dónde se estaba. El enlace sigue disponible dentro del
 *    visor para quien sí quiera la pestaña.
 *  - Se cierra con Escape, con el clic afuera y con su botón. Las tres, porque
 *    las tres se intentan.
 */
const props = defineProps({
  receipts: { type: Array, default: () => [] },
  /** Mapa id → object URL del blob, que resuelve cada pestaña del libro. */
  urls: { type: Object, required: true }
});
const emit = defineEmits(['upload', 'remove']);

const viewing = ref(null);

function receiptTitle(rcpt) {
  const name = rcpt?.original_name || 'Comprobante';
  return rcpt?.missing ? `${name} — el archivo ya no está en el servidor` : name;
}

function open(rcpt) {
  viewing.value = rcpt;
}
function close() {
  viewing.value = null;
}

function onKey(event) {
  if (event.key === 'Escape') close();
}

// El listener solo existe mientras el visor está abierto: con una tabla de
// cincuenta filas, dejarlo puesto en cada celda son cincuenta listeners.
watch(viewing, (abierto) => {
  if (abierto) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
/*
 * El visor. Los estilos de la celda y de las miniaturas viven en `ledger.css`
 * —son los del libro, compartidos con el resto de la tabla— y acá queda solo
 * lo que es propio de este componente.
 */
.receipt-viewer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  background: rgba(16, 20, 20, 0.72);
}

.receipt-viewer-box {
  display: flex;
  flex-direction: column;
  max-width: min(900px, 100%);
  max-height: 100%;
  background: var(--bg-card-solid);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.receipt-viewer-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
}

.receipt-viewer-name {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.receipt-viewer-open {
  font-size: 0.76rem;
  color: var(--text-sub);
  text-decoration: none;
  white-space: nowrap;
}
.receipt-viewer-open:hover { color: var(--primary); }

.receipt-viewer-close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  color: var(--text-muted);
  padding: 0.2rem;
}
.receipt-viewer-close:hover { color: var(--text-main); }

/* El comprobante entero a la vista: nunca recortado, que es justamente lo que
   la miniatura no puede hacer. */
.receipt-viewer-img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 8rem);
  object-fit: contain;
  background: var(--surface-2);
}

.receipt-viewer-pdf {
  width: min(860px, 90vw);
  height: calc(100vh - 8rem);
  border: 0;
  background: var(--surface-2);
}
</style>
