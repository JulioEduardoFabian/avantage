import { computed, ref } from 'vue';
import { apiFetch } from './apiClient.js';

/*
 * "¿Este celular / este DNI ya está en la base?", preguntado mientras se
 * escribe el formulario de alta manual.
 *
 * Espejo de `phoneMatchKey`/`dniMatchKey` del backend (ver leadService.js) y
 * usado para UNA sola cosa: decidir si el dato ya tiene forma de dato antes de
 * salir a preguntar. Quién es duplicado de quién lo sigue contestando el
 * servidor, que es el único que ve toda la tabla — acá no se puede, porque el
 * tablero muestra solo los leads de quien mira y el duplicado que más daño hace
 * es justamente el del lead que trabaja otra persona.
 *
 * El aviso en pantalla NO es la regla: el alta también se rechaza con 409 al
 * guardar (`registerManualLead()`). Son dos cosas distintas a propósito — la
 * pantalla avisa a tiempo para no tipear la ficha entera en vano, y el servidor
 * es el que impide el duplicado aunque alguien tuviera el formulario abierto
 * desde antes de que el otro lo cargara.
 */

/** Los últimos 9 dígitos, el número nacional en Perú. Menos de 8 no identifica a nadie. */
export function phoneQueryKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length < 8 ? null : digits.slice(-9);
}

/** El documento sin separadores. Menos de 6 caracteres es alguien tipeando. */
export function dniQueryKey(dni) {
  const clean = String(dni || '').replace(/[\s.\-/]/g, '').toUpperCase();
  return clean.length < 6 ? null : clean;
}

/**
 * Lo que hay que preguntar al EDITAR una ficha: solo el celular o el DNI que
 * cambiaron respecto de lo que estaba guardado.
 *
 * Es el espejo de lo que hace `updateLead()` en el servidor, y por la misma
 * razón: en la base quedaron gemelos de antes, y preguntar por el valor que la
 * ficha ya tenía dejaría su propio formulario bloqueado para siempre — nadie
 * podría ni corregirle el nombre a uno de esos leads.
 */
export function changedIdentityFields(form, saved) {
  const phoneChanged = phoneQueryKey(form?.phone) !== phoneQueryKey(saved?.phone);
  const dniChanged = dniQueryKey(form?.dni) !== dniQueryKey(saved?.dni);
  return {
    phone: phoneChanged ? form?.phone : null,
    dni: dniChanged ? form?.dni : null
  };
}

/** Cómo se nombra en pantalla el dato que está repetido. */
export function reasonsLabel(reasons = []) {
  const phone = reasons.includes('phone');
  const dni = reasons.includes('dni');
  if (phone && dni) return 'mismo celular y mismo DNI';
  if (dni) return 'mismo DNI';
  return 'mismo celular';
}

/**
 * El estado del chequeo para un formulario de alta (o de edición, pasando
 * `excludeId`: nadie es duplicado de sí mismo).
 *
 * Pregunta con un retardo corto porque se dispara al tipear, y descarta las
 * respuestas que llegan fuera de orden (`seq`): la respuesta lenta de un número
 * a medio escribir no puede tapar el aviso del número completo.
 */
export function useLeadDuplicateCheck({ delay = 450 } = {}) {
  const duplicates = ref([]);
  const checking = ref(false);
  const failed = ref(false);
  let timer = null;
  let seq = 0;

  const hasDuplicates = computed(() => duplicates.value.length > 0);

  function reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    seq += 1;
    duplicates.value = [];
    checking.value = false;
    failed.value = false;
  }

  async function run({ phone, dni, excludeId }) {
    const params = new URLSearchParams();
    const phoneKey = phoneQueryKey(phone);
    const dniKey = dniQueryKey(dni);
    if (phoneKey) params.set('phone', String(phone).trim());
    if (dniKey) params.set('dni', String(dni).trim());
    if (excludeId) params.set('excludeId', String(excludeId));

    if (!phoneKey && !dniKey) {
      duplicates.value = [];
      checking.value = false;
      failed.value = false;
      return;
    }

    const mine = ++seq;
    checking.value = true;
    try {
      const res = await apiFetch(`/api/leads/check-duplicate?${params.toString()}`);
      const data = await res.json();
      if (mine !== seq) return;
      if (!res.ok) throw new Error(data.error || 'No se pudo verificar.');
      duplicates.value = data.duplicates || [];
      failed.value = false;
    } catch (err) {
      if (mine !== seq) return;
      // Si la consulta falla no se bloquea el alta: el tope de verdad está en
      // el servidor al guardar, y dejar a alguien sin poder cargar un lead
      // porque se cayó una comprobación es peor que el duplicado.
      duplicates.value = [];
      failed.value = true;
    } finally {
      if (mine === seq) checking.value = false;
    }
  }

  /**
   * Vuelve a preguntar tras el retardo (se llama en cada tecla).
   *
   * El aviso anterior se borra en el acto: mientras se corrige el número, el
   * aviso que sigue en pantalla es sobre un dato que ya no está escrito, y con
   * él se queda deshabilitado el botón de guardar. Si el dato nuevo también
   * está repetido, el aviso vuelve solo. `seq` también avanza para que una
   * respuesta en vuelo del dato viejo no lo reviva.
   */
  function schedule(payload) {
    if (timer) clearTimeout(timer);
    seq += 1;
    duplicates.value = [];
    timer = setTimeout(() => run(payload), delay);
  }

  /**
   * Las fichas que devolvió el servidor al rechazar el guardado (409). El aviso
   * en pantalla y el rechazo tienen que mostrar lo MISMO: si la comprobación de
   * mientras se escribía quedó vieja, lo que vale es lo que contestó el alta.
   */
  function setDuplicates(list) {
    if (timer) clearTimeout(timer);
    timer = null;
    seq += 1;
    duplicates.value = list || [];
    checking.value = false;
  }

  /** Pregunta ya, sin esperar (al salir del campo o antes de guardar). */
  async function checkNow(payload) {
    if (timer) clearTimeout(timer);
    timer = null;
    await run(payload);
    return duplicates.value;
  }

  return { duplicates, checking, failed, hasDuplicates, schedule, checkNow, setDuplicates, reset };
}
