import { db } from '../db/connection.js';
import { phoneMatchKey } from './leadService.js';

/**
 * Conversaciones de WhatsApp que no tienen ficha en el CRM.
 *
 * Guardar el mensaje entrante y abrir la ficha del lead son **dos escrituras
 * del mismo webhook** (`recordInboundMessage` y `findOrCreateFromWhatsApp`), y
 * el webhook ya respondió 200 antes de procesar: si la segunda falla, no se
 * reintenta nunca y lo único que queda es una línea en un log que se rota. El
 * resultado es una persona que escribió, a la que el bot incluso le contestó, y
 * que no figura en ningún tablero — nadie la va a trabajar y nadie la va a
 * extrañar, porque un contacto perdido no falla: simplemente no está.
 *
 * Pasó de verdad: el 02/11/2026, ocho conversaciones seguidas quedaron así tras
 * un despliegue, y se descubrieron porque alguien buscó a mano a UN contacto que
 * no encontraba.
 *
 * Es el mismo agujero por el que se perdió el 39% de los leads de formulario de
 * Meta en septiembre de 2026, y se cierra igual: comparando lo que entró contra
 * lo que quedó registrado, en vez de confiar en que la escritura salió bien.
 *
 * La detección y la adopción viven acá y no en el script que las usa porque son
 * tres los que las necesitan —el diagnóstico, la recuperación y el barrido
 * automático— y con una copia en cada uno, el día que una cambie el sistema
 * contesta tres cosas distintas sobre los mismos contactos.
 */

/** Cuánto hacia atrás se mira por defecto. */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * ¿Esta conversación quedó sin ficha?
 *
 * Pura, para poder probarla: recibe el `wa_id` y los dos índices de lo que ya
 * existe. Se cruza igual que `findByPhone()` —la cadena exacta primero y
 * después los últimos 9 dígitos— porque la ficha y el webhook escriben el
 * número distinto ("+51931261225" contra "51931261225") y compararlos tal cual
 * daría por perdido a un contacto que sí está.
 *
 * Un `wa_id` que no es un teléfono (los `PE.xxxx` de quien escribe desde un
 * anuncio sin compartir su celular) no tiene sufijo con el que cruzar, así que
 * solo vale la coincidencia exacta.
 */
export function isOrphanConversation(waId, { exactPhones, phoneKeys } = {}) {
  const id = String(waId || '');
  if (!id) return false;
  if (exactPhones?.has(id)) return false;

  const key = phoneMatchKey(id);
  if (!key) return true;
  return !phoneKeys?.has(key);
}

/**
 * ¿La ficha de esta conversación no existe porque **alguien la borró**?
 *
 * Desde que el barrido las adopta solo, "nunca se abrió" y "la sacaron a
 * propósito" se ven igual —en las dos hay conversación y no hay ficha— y se
 * resuelven al revés: una hay que abrirla y la otra hay que dejarla en paz, o
 * el lead que alguien borró reaparece a los diez minutos.
 *
 * Lo que decide es la fecha: el borrado tapa lo que pasó **antes** de él, y
 * nunca lo de después. Si el contacto volvió a escribir después de que lo
 * borraron, eso es actividad nueva y su ficha se abre igual — que es lo mismo
 * que haría el webhook con ese mensaje.
 */
export function wasDeletedOnPurpose(orphan, deletions = []) {
  if (!deletions.length) return false;
  const last = orphan.lastAt ? new Date(orphan.lastAt).getTime() : null;

  return deletions.some((deletion) => {
    const when = deletion.deleted_at ? new Date(deletion.deleted_at).getTime() : null;
    if (when === null) return false;
    return last === null || last <= when;
  });
}

/**
 * Los borrados que podrían explicar la falta de ficha de estas conversaciones,
 * indexados igual que los teléfonos: por la cadena exacta y por los últimos 9
 * dígitos.
 *
 * Una consulta para todas y no una por conversación, por lo mismo que el
 * índice de teléfonos.
 */
export async function loadDeletionIndex() {
  const exact = new Map();
  const byKey = new Map();

  let rows = [];
  try {
    rows = await db('lead_deletions').select('phone', 'phone_key', 'deleted_at');
  } catch (error) {
    // Un entorno al que todavía no le corrió la migración no puede quedarse
    // sin recuperar conversaciones: sin bitácora de borrados, el barrido se
    // comporta como antes de que existiera.
    console.warn('⚠️ No se pudo leer la bitácora de fichas borradas:', error.message);
    return { exact, byKey };
  }

  for (const row of rows) {
    if (row.phone) {
      if (!exact.has(row.phone)) exact.set(row.phone, []);
      exact.get(row.phone).push(row);
    }
    if (row.phone_key) {
      if (!byKey.has(row.phone_key)) byKey.set(row.phone_key, []);
      byKey.get(row.phone_key).push(row);
    }
  }
  return { exact, byKey };
}

/** Los dos índices de teléfonos que ya tienen ficha. */
export async function loadLeadPhoneIndex() {
  const leads = await db('leads').select('phone');
  const exactPhones = new Set();
  const phoneKeys = new Set();
  for (const lead of leads) {
    exactPhones.add(String(lead.phone || ''));
    const key = phoneMatchKey(lead.phone);
    if (key) phoneKeys.add(key);
  }
  return { exactPhones, phoneKeys };
}

/**
 * Las conversaciones sin ficha de los últimos `days` días, con lo que hace
 * falta para abrirla: el nombre del perfil, el canal y el `referral` del clic.
 *
 * El `referral` se recupera del PRIMER mensaje entrante y no se descarta: es el
 * único rastro del anuncio que trajo a esa persona, y una ficha abierta sin él
 * nace como orgánica — un lead pago contado como gratis es un presupuesto mal
 * repartido, que es justo lo que el resto del sistema viene a evitar.
 */
export async function findOrphanConversations({ days = DEFAULT_WINDOW_DAYS } = {}) {
  const desde = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  /*
   * Las dos listas enteras y el cruce en memoria, en vez de una consulta por
   * conversación: son cientos de contactos y la pregunta es sobre todos a la
   * vez. El índice de teléfonos se pide una sola vez por la misma razón.
   */
  const conversaciones = await db('whatsapp_messages')
    .where('received_at', '>=', desde)
    .groupBy('wa_id')
    .select(
      'wa_id',
      db.raw('COUNT(*) as total'),
      db.raw('MIN(received_at) as primero'),
      db.raw('MAX(received_at) as ultimo')
    )
    .orderBy('primero', 'asc');

  const index = await loadLeadPhoneIndex();
  const huerfanas = conversaciones.filter((c) => isOrphanConversation(c.wa_id, index));
  if (!huerfanas.length) return { total: conversaciones.length, orphans: [], borradas: 0 };

  const deletions = await loadDeletionIndex();
  const orphans = [];
  let borradas = 0;
  for (const c of huerfanas) {
    /*
     * La ficha que alguien borró a propósito no se vuelve a abrir. Se cuenta
     * aparte y no se descarta en silencio: "no había nada que recuperar" y
     * "había tres y las habían borrado" son dos respuestas distintas, y la
     * segunda es la que explica por qué una conversación sigue sin ficha.
     */
    const waId = String(c.wa_id);
    const key = phoneMatchKey(waId);
    const candidatas = [...(deletions.exact.get(waId) || []), ...(key ? deletions.byKey.get(key) || [] : [])];
    if (wasDeletedOnPurpose({ lastAt: c.ultimo }, candidatas)) {
      borradas += 1;
      continue;
    }

    /*
     * El primer ENTRANTE y no el primer mensaje a secas: el nombre del perfil
     * y el `referral` solo viajan en lo que manda el contacto (los salientes
     * traen el nombre en null), así que mirar la primera fila sin filtrar
     * dejaría la ficha sin nombre justo cuando el eco de un saliente llegó
     * antes.
     */
    const inicial = await db('whatsapp_messages')
      .where({ wa_id: c.wa_id })
      .where(function () {
        this.where('direction', 'inbound').orWhereNull('direction');
      })
      .orderBy('received_at', 'asc')
      .select('contact_name', 'channel', 'referral', 'received_at')
      .first();

    let referral = null;
    if (inicial?.referral) {
      try {
        referral = typeof inicial.referral === 'string' ? JSON.parse(inicial.referral) : inicial.referral;
      } catch {
        // Un referral ilegible no puede impedir que la persona entre al funnel:
        // se pierde la atribución del clic, no el contacto.
        referral = null;
      }
    }

    orphans.push({
      waId: String(c.wa_id),
      messages: Number(c.total),
      firstAt: c.primero,
      lastAt: c.ultimo,
      contactName: inicial?.contact_name || null,
      channel: inicial?.channel || null,
      referral,
      isPhone: !!phoneMatchKey(c.wa_id)
    });
  }

  return { total: conversaciones.length, orphans, borradas };
}

/**
 * Abre la ficha que le faltaba a una conversación.
 *
 * Usa `findOrCreateFromWhatsApp()`, el MISMO camino del webhook, y no un
 * `insert` propio: el alta de un lead escribe el sello de origen, la evidencia
 * y el reparto, y una segunda forma de crear leads es una que el día que
 * cambien esas reglas se queda con las viejas. Si ese camino está roto —que es
 * la causa más probable de que haya huérfanas—, esto falla con el error de
 * verdad a la vista, que es exactamente lo que hace falta ver.
 *
 * Es idempotente por su propia naturaleza: `findOrCreateFromWhatsApp` cruza por
 * teléfono antes de crear, así que correrlo dos veces no abre dos fichas.
 */
export async function adoptOrphanConversation(orphan, { leadService }) {
  return leadService.findOrCreateFromWhatsApp({
    phone: orphan.waId,
    fullName: orphan.contactName,
    source: orphan.channel || 'WhatsApp Directo',
    referral: orphan.referral
  });
}
