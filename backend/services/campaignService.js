import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { campaignAdImageDir } from '../middleware/upload.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from './leadService.js';
import { LEAD_ORIGIN_COLUMNS, bareSourceId, leadOrigin, onlyGreeted } from './leadOrigin.js';
import { LEVELS, SPEND_LEVEL, levelLabel } from './smartPlusLevel.js';
import { GENERIC_CONTACT_NAME } from './contactName.js';
import { APPOINTMENT_STATUSES, LOST_STATUSES, loadWinningStatuses } from './salesFunnelStage.js';
import { percentile } from './reportPeriod.js';

/**
 * Campañas de marketing digital: definición manual (nombre, presupuesto,
 * fechas) + cálculo en vivo del rendimiento cruzando la atribución de
 * WhatsApp Click-to-WhatsApp con el funnel real (leads, sesiones del bot,
 * reuniones agendadas y cotizaciones).
 */

const AD_SOURCE_TYPES = new Set(['ad', 'post']);

function parseReferral(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function platformFromReferral(ref) {
  const url = (ref?.source_url || '').toLowerCase();
  if (url.includes('instagram')) return 'instagram';
  if (url.includes('facebook') || url.includes('fb.me') || url.includes('fb.com')) return 'facebook';
  return 'meta';
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return diff >= 0 ? diff : null;
}

function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/*
 * El P90 de la primera respuesta sale de `reportPeriod.js`, el módulo de
 * aritmética que comparten los reportes: la pregunta ("¿qué esconde la
 * mediana?") es la misma acá y en el Reporte de Setters, y con una copia por
 * pantalla las dos terminarían midiendo la cola distinto. Se re-exporta porque
 * la prueba que fija su comportamiento vive al lado de este reporte.
 */
export { percentile };

const AD_IMAGE_MIME_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

/*
 * "Ganado" NO es la cadena 'ganado' y nada más.
 *
 * El equipo arma sus propias columnas en el Kanban y sus claves se generan
 * solas (`col_mtc2nwec_fij`), así que la columna que ellos llaman "Ganado"
 * tiene una clave que no se puede escribir acá. Con el conjunto fijo que había,
 * un lead cerrado aparecía en la trazabilidad de Campañas como "En espera de la
 * reunión" mientras en el funnel estaba en Ganado — y los contadores de la
 * campaña (GANADOS, los ingresos atribuidos) lo dejaban afuera. Caso real:
 * Rafael Anderson Gonzales Ureta, 05/10/2026.
 *
 * Se pregunta por `loadWinningStatuses()`, el mismo sitio del que cuelgan la
 * creación del proyecto y la comisión de la setter: tres pantallas contestando
 * la misma pregunta con tres listas propias es exactamente como se llega a que
 * cada una diga un número distinto.
 */

/**
 * ¿Esta venta está cerrada? Tres caminos, y hacen falta los tres.
 *
 * `wonStatuses` viene de `loadWinningStatuses()` y depende de que la columna
 * del tablero esté marcada como `final`. `projectLeadIds` es el respaldo: si
 * alguien recrea esa columna sin marcarla, el lead seguiría teniendo su
 * proyecto abierto, y mostrar como "en espera de la reunión" a un cliente al
 * que ya se le está entregando trabajo es el peor de los dos errores posibles.
 *
 * `paidLeadIds` son los leads con al menos un ingreso **verificado**: Finanzas
 * dio el visto bueno de que esa plata entró. Un cliente que ya pagó es una
 * venta cerrada aunque su tarjeta se haya quedado sin mover, y sin este camino
 * el reporte mostraba dinero cobrado en una fila cuya etapa decía
 * "cotización" — el 17/09/2026, S/ 2.300 registrados en un anuncio con cero
 * leads en Ganado. La plata es el hecho más difícil de discutir de los tres.
 *
 * Vive fuera de la clase para poder probarla sin base de datos: es una regla
 * de negocio, no una consulta.
 */
export function isWonLead(lead, wonStatuses, projectLeadIds, paidLeadIds = new Set()) {
  if (!lead) return false;
  return wonStatuses.has(lead.status) || projectLeadIds.has(lead.id) || paidLeadIds.has(lead.id);
}

/**
 * De dos filas del mismo teléfono, cuál representa al lead real: primero la
 * que ya graduó al Funnel de Ventas (es la que el closer está trabajando) y,
 * entre iguales, la más reciente. Espejo de `leadService.findByPhone()`.
 */
export function esMejorLead(candidato, actual, wonStatuses = new Set()) {
  // Primero el que llegó MÁS LEJOS en el embudo. "El más reciente" parecía
  // razonable mientras los gemelos eran un lead viejo y uno recién creado,
  // pero en cuanto los dos graduaron se volvió una moneda al aire: la ficha
  // cerrada podía ser la vieja, y la campaña leía la otra. Así se veía
  // "En espera de la reunión" en Campañas sobre un lead que el funnel ya
  // mostraba en Ganado (caso real: Rafael Anderson Gonzales Ureta, 05/10/2026).
  const ganado = (l) => (wonStatuses.has(l.status) ? 1 : 0);
  if (ganado(candidato) !== ganado(actual)) return ganado(candidato) > ganado(actual);

  const graduado = (l) => (l.sales_funnel_at ? 1 : 0);
  if (graduado(candidato) !== graduado(actual)) return graduado(candidato) > graduado(actual);

  return new Date(candidato.created_at) > new Date(actual.created_at);
}

/**
 * Un contacto atribuido por cada lead de formulario instantáneo.
 *
 * `waIdByKey` es el índice "últimos 9 dígitos → wa_id" de las conversaciones
 * que existen: si la persona del formulario después escribió por WhatsApp, su
 * conversación es la que hay que contarle (tiempo de respuesta, sesión del bot,
 * reunión agendada por el bot). Sin eso, un lead de formulario al que el equipo
 * sí atendió se leía como un lead al que nadie contestó.
 *
 * Vive fuera de la clase, como `isWonLead` y `esMejorLead`: es una regla de
 * negocio y no una consulta, y de ella depende a qué anuncio se le acreditan
 * los leads de formulario.
 */
export const META_FORM_SPEC = {
  adColumn: 'meta_ad_id',
  formColumn: 'meta_form_id',
  createdColumn: 'meta_created_time',
  // El "ID de origen" de Meta es el `ad_id` pelado: es el mismo valor que
  // llega en el `referral.source_id` de un Click-to-WhatsApp, y los dos
  // caminos tienen que caer en la misma fila de `campaign_ads`.
  sourceIdOf: (row) => String(row.meta_ad_id),
  platformOf: (row) => (row.meta_platform === 'ig' ? 'instagram'
    : row.meta_platform === 'fb' ? 'facebook' : 'meta')
};

/**
 * TikTok, con dos diferencias que no son cosméticas:
 *
 *  - El `sourceId` lleva el prefijo `tt:`, el mismo con el que
 *    `tiktokAdsService` escribe `campaign_ads.ad_source_id`. Los ids de
 *    anuncio de las dos plataformas son numéricos y esa columna es ÚNICA, así
 *    que sin el prefijo un anuncio de TikTok podría quedarse con la fila de
 *    uno de Meta y mandar sus leads a la campaña equivocada.
 *  - El "formulario" es la Instant Page (`tiktok_page_id`), que es lo que
 *    cumple el papel del `form_id` de Meta.
 */
export const TIKTOK_FORM_SPEC = {
  adColumn: 'tiktok_ad_id',
  formColumn: 'tiktok_page_id',
  createdColumn: 'tiktok_created_time',
  sourceIdOf: (row) => `tt:${row.tiktok_ad_id}`,
  platformOf: () => 'tiktok'
};

/**
 * El clic en un anuncio que abrió una conversación, leído del LEAD y no del
 * `referral` del mensaje.
 *
 * Es la red que tapa la fuga de P3: el webhook de WhatsApp responde 200 antes
 * de procesar, así que un primer mensaje que no se guardó se llevaba consigo
 * el único rastro de que ese contacto vino de un anuncio — la conversación
 * existía en Meta y en el CRM aparecía como orgánica. Desde que la atribución
 * se escribe también en el lead (`ctwa_ad_id`), ese contacto se puede
 * recuperar desde acá.
 *
 * Va ÚLTIMO en el desduplicado: cuando el mensaje sí se guardó gana la fila de
 * `whatsapp_messages`, que además trae el titular del anuncio y la
 * conversación detrás.
 */
export const CTWA_LEAD_SPEC = {
  adColumn: 'ctwa_ad_id',
  formColumn: null,
  createdColumn: 'ctwa_created_time',
  sourceIdOf: (row) => String(row.ctwa_ad_id),
  platformOf: () => 'meta',
  headlineOf: (row) => row.ctwa_headline || null,
  origin: 'whatsapp'
};

/**
 * ¿Esta conversación trajo a una persona que NO estaba en el CRM?
 *
 * La respuesta es si la ficha nació de ESTA conversación, y se contesta
 * comparando cuándo se creó la ficha con cuándo llegó el primer mensaje: una
 * ficha anterior al mensaje es alguien que el equipo ya tenía y que volvió a
 * escribir desde un anuncio.
 *
 * El margen de cinco minutos no es un detalle: el lead que nace del primer
 * mensaje se crea en el mismo acto de recibirlo, pero las dos marcas de tiempo
 * las escriben caminos distintos (el webhook y el alta), así que comparar por
 * igualdad estricta contaría como "ya estaba" a la persona que acaba de
 * llegar. Un lead de formulario que después escribe por WhatsApp sí queda del
 * lado correcto: entre el formulario y el mensaje pasan minutos u horas.
 *
 * Sin ficha no hay oportunidad que contar: el contacto escribió y nadie lo
 * registró, que es la brecha que `onlyGreeted` mide aparte.
 */
const NEW_OPPORTUNITY_MARGIN_MS = 5 * 60 * 1000;

export function isNewOpportunity(contact) {
  const nacida = contact?.lead?.created_at ? Date.parse(contact.lead.created_at) : null;
  const primerMensaje = contact?.firstMessageAt ? Date.parse(contact.firstMessageAt) : null;
  if (!nacida || !primerMensaje) return false;
  return nacida >= primerMensaje - NEW_OPPORTUNITY_MARGIN_MS;
}

export function formContactsFromLeads(rows, waIdByKey = new Map(), spec = META_FORM_SPEC) {
  return rows
    .filter((row) => row[spec.adColumn])
    .map((row) => {
      const matchKey = phoneMatchKey(row.phone);
      return {
        // Casi todos estos caminos son formularios; el del clic que abrió
        // WhatsApp usa esta misma función y declara su propio origen.
        origin: spec.origin || 'form',
        waId: (matchKey && waIdByKey.get(matchKey)) || null,
        leadId: row.id,
        phone: row.phone || null,
        matchKey,
        // Un formulario puede llegar sin celular (pasa, y el webhook lo deja
        // avisado en el log): ese lead se desduplica por su id, que es lo
        // único que lo identifica.
        dedupeKey: matchKey || `lead:${row.id}`,
        contactName: row.full_name || null,
        // El "ID de origen": el mismo campo por el que ya viajaba el
        // `source_id` del referral de WhatsApp.
        sourceId: spec.sourceIdOf(row),
        formId: spec.formColumn ? row[spec.formColumn] || null : null,
        headline: spec.headlineOf ? spec.headlineOf(row) : null,
        sourceUrl: null,
        platform: spec.platformOf(row),
        /*
         * `meta_created_time` —cuándo la persona envió el formulario en Meta—
         * y no `created_at`: un lead que la conciliación rescató tres días
         * después pertenece al día en que lo llenó, y mezclar las dos fechas
         * es lo que impide que este reporte cierre contra el Administrador de
         * anuncios.
         */
        firstMessageAt: row[spec.createdColumn] || row.created_at
      };
    });
}

/**
 * Los contactos de los dos caminos, con la misma persona contada UNA vez.
 *
 * Alguien puede haber hecho clic en un anuncio Click-to-WhatsApp y además
 * llenado un formulario: son dos toques del mismo contacto, y contarlo dos
 * veces infla las conversaciones atribuidas y abarata el costo por lead de la
 * campaña.
 *
 * Gana el primero de la lista —se llama con WhatsApp primero— porque es el que
 * tiene la conversación detrás (tiempo de primera respuesta, sesión del bot,
 * línea de tiempo) y porque así los números que el equipo ya venía mirando no
 * se mueven: lo que la mitad de formularios suma son los leads que hasta hoy
 * no estaban en ninguna parte.
 */
export function dedupeAttribution(...listas) {
  const vistos = new Set();
  const out = [];
  for (const entry of listas.flat()) {
    if (vistos.has(entry.dedupeKey)) continue;
    vistos.add(entry.dedupeKey);
    out.push(entry);
  }
  return out;
}

/**
 * Etapas en las que el lead ya tiene una propuesta económica sobre la mesa.
 * Se miran además de las tablas de cotizaciones/contratos/ingresos porque el
 * equipo negocia por WhatsApp y a veces mueve la tarjeta antes de emitir el
 * documento: si sólo se contara `quotes`, un anuncio que está cerrando trato
 * aparecería como si no hubiera pasado de la primera conversación.
 */
const QUOTATION_STATUSES = new Set(['transferido_closer', 'en_negociacion']);

/**
 * Lee una columna JSON de `campaigns` (`meta_insights`, un objeto, o
 * `meta_ads_insights`, un arreglo). Según el driver, Knex la devuelve ya
 * parseada o como texto.
 */
function parseMetaInsights(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Gasto real de la campaña: métricas de Meta > gasto manual > presupuesto. */
function resolveSpend(campaign) {
  if (!campaign) return 0;
  const meta = parseMetaInsights(campaign.meta_insights);
  if (meta && Number(meta.spend) > 0) return Number(meta.spend);
  if (campaign.spend_to_date != null) return Number(campaign.spend_to_date);
  return Number(campaign.budget_total) || 0;
}

export class CampaignService {
  // ─────────────────────────── CRUD de campañas ───────────────────────────
  async listCampaigns() {
    const campaigns = await db('campaigns').orderBy([{ column: 'status', order: 'asc' }, { column: 'created_at', order: 'desc' }]);
    const ads = await db('campaign_ads').orderBy('created_at', 'asc');
    const adsByCampaign = new Map();
    for (const ad of ads) {
      if (!adsByCampaign.has(ad.campaign_id)) adsByCampaign.set(ad.campaign_id, []);
      adsByCampaign.get(ad.campaign_id).push(ad);
    }
    return campaigns.map((c) => ({ ...c, ads: adsByCampaign.get(c.id) || [] }));
  }

  async getCampaign(id) {
    const campaign = await db('campaigns').where({ id }).first();
    if (!campaign) return null;
    campaign.ads = await db('campaign_ads').where({ campaign_id: id }).orderBy('created_at', 'asc');
    return campaign;
  }

  async createCampaign(data) {
    const [id] = await db('campaigns').insert(this.#sanitize(data));
    return this.getCampaign(id);
  }

  async updateCampaign(id, data) {
    await db('campaigns').where({ id }).update({ ...this.#sanitize(data), updated_at: db.fn.now() });
    return this.getCampaign(id);
  }

  async deleteCampaign(id) {
    return db('campaigns').where({ id }).del();
  }

  /**
   * Imagen del creativo de un anuncio, para la pestaña de Anuncios.
   *
   * El nombre del archivo sale de `meta_ads_insights` (lo escribió la
   * sincronización), nunca del parámetro de la ruta: un `adId` manipulado no
   * puede sacar la lectura de la carpeta de imágenes.
   */
  async getAdCreativeImage(campaignId, adId) {
    const campaign = await db('campaigns').where({ id: campaignId }).first();
    if (!campaign) return null;

    const ads = parseMetaInsights(campaign.meta_ads_insights) || [];
    const ad = ads.find((a) => String(a.adId) === String(adId));
    if (!ad?.imageFilename) return null;

    const file = path.join(campaignAdImageDir, path.basename(ad.imageFilename));
    if (!fs.existsSync(file)) return null;

    return { path: file, mimeType: AD_IMAGE_MIME_TYPES[path.extname(file).slice(1).toLowerCase()] || 'image/jpeg' };
  }

  #sanitize(data) {
    const out = {};
    if (data.name !== undefined) out.name = String(data.name).trim().slice(0, 200);
    if (data.platform !== undefined) out.platform = String(data.platform || 'meta').trim().slice(0, 30);
    if (data.objective !== undefined) out.objective = data.objective ? String(data.objective).trim().slice(0, 120) : null;
    if (data.status !== undefined) out.status = ['activa', 'pausada', 'finalizada'].includes(data.status) ? data.status : 'activa';
    if (data.budgetTotal !== undefined) out.budget_total = Number(data.budgetTotal) || 0;
    if (data.spendToDate !== undefined) out.spend_to_date = data.spendToDate === '' || data.spendToDate === null ? null : Number(data.spendToDate);
    if (data.currency !== undefined) out.currency = String(data.currency || 'PEN').trim().slice(0, 10);
    if (data.startDate !== undefined) out.start_date = data.startDate || null;
    if (data.endDate !== undefined) out.end_date = data.endDate || null;
    if (data.notes !== undefined) out.notes = data.notes ? String(data.notes).trim() : null;
    return out;
  }

  // ─────────────────────── Mapeo de anuncios → campaña ─────────────────────
  async addAdMapping(campaignId, { adSourceId, adLabel }) {
    const clean = String(adSourceId || '').trim();
    if (!clean) throw new Error('Falta el ID del anuncio.');
    await db('campaign_ads')
      .insert({ campaign_id: campaignId, ad_source_id: clean, ad_label: adLabel ? String(adLabel).slice(0, 300) : null })
      .onConflict('ad_source_id')
      .merge({ campaign_id: campaignId, ad_label: adLabel ? String(adLabel).slice(0, 300) : null });
    return this.getCampaign(campaignId);
  }

  async removeAdMapping(mappingId) {
    return db('campaign_ads').where({ id: mappingId }).del();
  }

  // ──────────────────────────── Atribución base ───────────────────────────
  /**
   * De qué anuncio llegó cada persona, por los DOS caminos por los que Meta
   * nos manda gente y no solo por uno.
   *
   * Hasta el 29/10/2026 esto era únicamente el `referral` de WhatsApp —el
   * "clic en el anuncio → escribió por WhatsApp"—, así que un lead de
   * formulario instantáneo, que es la mayoría de lo que entra, no figuraba en
   * ninguna hoja de Campañas: su `meta_ad_id`/`meta_campaign_id` se guardaba
   * desde el webhook pero nadie lo leía, y el reporte por anuncio contaba la
   * mitad de los leads y la mitad del dinero que trajo cada anuncio.
   *
   * El formulario entra ahora por el MISMO campo `sourceId` —el "ID de
   * origen"— que ya usaba el referral, con el `ad_id` que Meta manda junto al
   * lead. Es deliberado que sea el mismo campo y no uno nuevo: de `sourceId`
   * cuelgan el mapeo a campaña, el funnel por anuncio, la trazabilidad y el
   * exportable, y un campo paralelo obligaría a enseñarle los dos caminos a
   * cada uno de ellos.
   */
  async #buildAttribution({ from, to } = {}) {
    /*
     * El índice de conversaciones se arma UNA vez acá y se les pasa a los dos
     * caminos de formulario: es la misma consulta para los dos, y cacheado en
     * la instancia —que vive lo que vive el proceso— se quedaría sin los
     * contactos que escriban después del primer reporte del día.
     */
    const waIdByKey = await this.#waIdsByPhoneKey();
    const [whatsapp, forms, tiktok, ctwaLeads] = await Promise.all([
      this.#attributionFromWhatsApp(),
      this.#attributionFromMetaForms(waIdByKey),
      this.#attributionFromTikTokForms(waIdByKey),
      this.#attributionFromCtwaLeads(waIdByKey)
    ]);

    // WhatsApp primero: es el que gana cuando los dos hablan de la misma
    // persona (ver `dedupeAttribution`). Los formularios de TikTok van al
    // final por lo mismo: alguien que hizo clic en un anuncio de Meta y
    // además llenó el formulario de TikTok es UN contacto, y contarlo dos
    // veces infla las conversaciones atribuidas y abarata el costo por lead
    // de las dos campañas a la vez.
    let list = dedupeAttribution(whatsapp, forms, tiktok, ctwaLeads);

    if (from) list = list.filter((a) => new Date(a.firstMessageAt) >= new Date(from));
    if (to) list = list.filter((a) => new Date(a.firstMessageAt) <= new Date(to));
    return list;
  }

  /**
   * Primer mensaje entrante con `referral` de anuncio por contacto: el clic
   * en el anuncio que terminó en una conversación de WhatsApp.
   */
  async #attributionFromWhatsApp() {
    const rows = await db('whatsapp_messages')
      .whereNotNull('referral')
      .andWhere('direction', 'inbound')
      .orderBy('received_at', 'asc')
      .select('wa_id', 'referral', 'received_at', 'contact_name');

    const firstByContact = new Map();
    for (const row of rows) {
      if (firstByContact.has(row.wa_id)) continue;
      const ref = parseReferral(row.referral);
      const sourceId = ref?.source_id ? String(ref.source_id) : null;
      const sourceType = ref?.source_type || (sourceId ? 'ad' : null);
      if (!sourceId || !AD_SOURCE_TYPES.has(sourceType)) continue;
      const matchKey = phoneMatchKey(row.wa_id);
      firstByContact.set(row.wa_id, {
        origin: 'whatsapp',
        waId: row.wa_id,
        leadId: null,
        phone: row.wa_id,
        matchKey,
        /*
         * Hay `wa_id` que no son teléfonos sino identificadores de usuario de
         * la empresa (`PE.2379096279586501`): `phoneMatchKey` devuelve null
         * con razón, y se desduplican por sí mismos en vez de por sus últimos
         * dígitos, que emparejaría contactos distintos.
         */
        dedupeKey: matchKey || `wa:${row.wa_id}`,
        contactName: row.contact_name || null,
        sourceId,
        headline: ref.headline || ref.body || null,
        sourceUrl: ref.source_url || null,
        platform: platformFromReferral(ref),
        firstMessageAt: row.received_at
      });
    }

    return [...firstByContact.values()];
  }

  /**
   * Los leads de formulario instantáneo, atribuidos por el `ad_id` que Meta
   * manda junto al lead (`leads.meta_ad_id`, escrito por `persistMetaLead`).
   *
   * Se les busca su `wa_id` por los últimos 9 dígitos del teléfono: si
   * esa persona después escribió por WhatsApp —sin referral, porque no vino de
   * un clic— su conversación, su sesión del bot y su reunión son las que hay
   * que contarle. El cruce se hace en JavaScript sobre los contactos agrupados
   * (una fila por `wa_id`, no una por mensaje) y no con un `RIGHT()` en SQL:
   * son unos pocos miles de filas y evita que este servicio arrastre el módulo
   * de WhatsApp, que ya importa a este por otro lado.
   */
  async #attributionFromMetaForms(waIdByKey) {
    const rows = await db('leads')
      .whereNotNull('meta_ad_id')
      .select('id', 'phone', 'full_name', 'meta_ad_id', 'meta_form_id',
        'meta_platform', 'meta_created_time', 'created_at');
    if (!rows.length) return [];
    return formContactsFromLeads(rows, waIdByKey, META_FORM_SPEC);
  }

  /**
   * Los leads de formulario instantáneo de **TikTok**, atribuidos por el
   * `ad_id` que TikTok manda junto al lead (`leads.tiktok_ad_id`, escrito por
   * `tiktokLeadsService`).
   *
   * Es la misma mitad que faltaba en Meta hasta el 29/10/2026, repetida en la
   * otra plataforma: las columnas de atribución de TikTok se guardaban al
   * importar pero nadie las leía, así que una campaña con 21 conversiones en
   * el Ads Manager mostraba "todavía no hay contactos atribuidos" en su
   * trazabilidad.
   */
  async #attributionFromTikTokForms(waIdByKey) {
    const rows = await db('leads')
      .whereNotNull('tiktok_ad_id')
      .select('id', 'phone', 'full_name', 'tiktok_ad_id', 'tiktok_page_id',
        'tiktok_created_time', 'created_at');
    if (!rows.length) return [];
    return formContactsFromLeads(rows, waIdByKey, TIKTOK_FORM_SPEC);
  }

  /**
   * Los contactos que vinieron de un Click-to-WhatsApp según su propio lead.
   *
   * Recupera a los que `#attributionFromWhatsApp()` no puede ver porque su
   * primer mensaje no quedó guardado (ver `CTWA_LEAD_SPEC`). El que sí está en
   * `whatsapp_messages` entra por aquel camino y este no lo duplica.
   */
  async #attributionFromCtwaLeads(waIdByKey) {
    const rows = await db('leads')
      .whereNotNull('ctwa_ad_id')
      .select('id', 'phone', 'full_name', 'ctwa_ad_id', 'ctwa_headline',
        'ctwa_created_time', 'created_at');
    if (!rows.length) return [];
    return formContactsFromLeads(rows, waIdByKey, CTWA_LEAD_SPEC);
  }

  /**
   * Índice "últimos 9 dígitos -> wa_id" de las conversaciones que existen.
   *
   * Lo comparten los dos caminos de formulario: si la persona que llenó el
   * formulario después escribió por WhatsApp, esa conversación es la que hay
   * que contarle (tiempo de respuesta, sesión del bot, reunión agendada).
   * Está acá y no dentro de cada uno porque son la misma pregunta y la misma
   * consulta, y duplicada se pagaría dos veces en cada carga del reporte. No
   * se cachea en la instancia: este servicio vive lo que vive el proceso, y un
   * índice congelado dejaría fuera a todo el que escriba después.
   */
  async #waIdsByPhoneKey() {
    const waIdByKey = new Map();
    const contactos = await db('whatsapp_messages')
      .groupBy('wa_id')
      .select('wa_id')
      .max('received_at as lastAt');
    for (const row of contactos.sort((a, b) => new Date(a.lastAt) - new Date(b.lastAt))) {
      const key = phoneMatchKey(row.wa_id);
      // El último gana: si el mismo número figura con dos formatos de
      // `wa_id`, el que importa es la conversación viva.
      if (key) waIdByKey.set(key, row.wa_id);
    }

    return waIdByKey;
  }

  /**
   * Enriquece cada contacto atribuido con su recorrido real en el funnel.
   */
  async #enrichContacts(attribution) {
    if (!attribution.length) return [];
    // Solo los contactos de WhatsApp tienen `wa_id` siempre; los de
    // formulario, únicamente si esa persona además escribió alguna vez.
    const waIds = [...new Set(attribution.map((a) => a.waId).filter(Boolean))];
    const phoneKeys = [...new Set(attribution.map((a) => a.matchKey).filter(Boolean))];
    /*
     * Los leads de formulario se traen además por su id y no solo por
     * teléfono: un formulario puede llegar sin celular, y entonces no hay
     * últimos 9 dígitos con los que cruzarlo — que es justo el lead al que
     * hace falta mirarle la ficha.
     */
    const formLeadIds = [...new Set(attribution.map((a) => a.leadId).filter(Boolean))];

    const [outboundRows, leads, sessions, meetings] = await Promise.all([
      db('whatsapp_messages').whereIn('wa_id', waIds).andWhere('direction', 'outbound')
        .groupBy('wa_id').select('wa_id').min('received_at as firstOut'),
      /*
       * Los leads se cruzan por los ÚLTIMOS 9 DÍGITOS y no por la cadena
       * exacta, igual que `leadService.findByPhone()`. El `wa_id` llega como
       * lo manda Meta ("+51999922762" o "51999922762" según el caso) y el
       * teléfono del lead se guardó como lo escribió quien llenó el formulario
       * ("+51 999 922 762"). Comparando tal cual, el lead simplemente no
       * aparecía: la trazabilidad mostraba al contacto sin ficha, o sea sin
       * etapa comercial, y lo dejaba congelado en "En espera de la reunión".
       */
      db('leads')
        .where((q) => q
          .whereIn(db.raw(PHONE_MATCH_KEY_SQL), phoneKeys)
          .orWhereIn('id', formLeadIds))
        .select('id', 'phone', 'status', 'created_at', 'full_name', 'topic', 'overall_viability_score',
          // Correo y carrera solo los usa la hoja "Ruta de leads" del Excel.
          'email', 'field_of_study', 'sales_funnel_at',
          // La calificación del setter es un dato propio del lead y ya no se
          // deduce de su etapa (ver la migración de `qualified`).
          'qualified', 'qualified_at',
          /*
           * A este lead ya se le contestó, y quién. Es una COLUMNA del lead y
           * no el primer saliente de su conversación de WhatsApp, que es como
           * se calculaba acá: el lead de formulario que nunca escribió por
           * WhatsApp no tiene conversación, así que salía con la celda vacía
           * y "no se le contactó" y "se le llamó y nadie lo registró" se
           * escribían igual (109 de 450 leads en el corte del 10/11/2026).
           * `first_response_by` nulo = contestó Avan o llegó por el eco de la
           * app de WhatsApp Business, la misma convención que `sent_by`.
           */
          'first_response_at', 'first_response_by',
          // Con qué se decide si el contacto dejó algo con lo que trabajar o
          // solo saludó (ver `onlyGreeted`): sin la universidad, un lead que
          // sí contó dónde estudia figuraría como que solo saludó.
          'dni', 'university',
          // Las columnas con las que `leadOrigin()` contesta de dónde salió.
          ...LEAD_ORIGIN_COLUMNS.filter((c) => c !== 'created_at')),
      db('whatsapp_bot_sessions').whereIn('wa_id', waIds)
        .select('wa_id', 'status', 'started_at', 'updated_at'),
      /*
       * Por `wa_id` y además por `lead_id`: a un lead de formulario la
       * reunión se le carga desde su ficha o desde el Calendario, donde no hay
       * conversación de WhatsApp detrás y `scheduled_meetings.wa_id` queda en
       * null (ver `bookManual()`). Buscando solo por `wa_id`, el anuncio que
       * trajo una cita aparecería con cero citas.
       */
      db('scheduled_meetings')
        .where((q) => q.whereIn('wa_id', waIds).orWhereIn('lead_id', formLeadIds))
        // `attendance` y `cancelled_at`: una cita AGENDADA no es una cita
        // ASISTIDA, y un anuncio que trae gente que agenda y no aparece se
        // leía igual que uno que trae gente que se presenta.
        .select('wa_id', 'lead_id', 'start_time', 'created_at', 'attendance', 'cancelled_at')
    ]);

    // Qué status significan "venta ganada" HOY, según el tablero del equipo.
    const wonStatuses = await loadWinningStatuses();

    const firstOutByWa = new Map(outboundRows.map((r) => [r.wa_id, r.firstOut]));
    /*
     * Un teléfono puede tener MÁS de una fila en `leads` (la misma persona que
     * escribió por WhatsApp y además llenó un formulario de Meta, o que llenó
     * el formulario dos veces). Armar el índice con `new Map()` a secas dejaba
     * ganar a la última fila que devolviera MySQL —sin ORDER BY, en la
     * práctica la de id más alto, o sea la más nueva— y entonces un contacto
     * con cita agendada o ganado se leía con el status de su gemelo recién
     * creado y desaparecía de las métricas de la campaña.
     *
     * Gana el lead que ya graduó al Funnel de Ventas y, entre iguales, el más
     * reciente: la misma regla que `leadService.findByPhone()`, porque es la
     * misma pregunta ("de estas filas, ¿cuál es el lead de verdad?") y dos
     * respuestas distintas para eso es como se llega a que dos pantallas
     * cuenten cosas diferentes.
     */
    const leadByWa = new Map();
    for (const lead of leads) {
      const key = phoneMatchKey(lead.phone);
      if (!key) continue;
      const previo = leadByWa.get(key);
      if (!previo || esMejorLead(lead, previo, wonStatuses)) leadByWa.set(key, lead);
    }
    const leadById = new Map(leads.map((l) => [l.id, l]));
    /*
     * Quién contestó primero, por su nombre. Hace falta para separar el ACUSE
     * —Avan, que responde en segundos— de la ATENCIÓN HUMANA, que es la que
     * de verdad mueve al lead: con las dos mezcladas en una sola cifra, la
     * mediana de 20 segundos del corte del 10/11/2026 daba por atendido un
     * funnel con 51 leads esperando más de una hora a que alguien les
     * escribiera.
     */
    const responderIds = [...new Set(leads.map((l) => l.first_response_by).filter(Boolean))];
    const responderById = new Map(
      responderIds.length
        ? (await db('users').whereIn('id', responderIds).select('id', 'name'))
          .map((u) => [u.id, u.name])
        : []
    );
    const sessionByWa = new Map(sessions.map((s) => [s.wa_id, s]));
    const meetingByWa = new Map();
    const meetingByLead = new Map();
    for (const m of meetings) {
      const prev = meetingByWa.get(m.wa_id);
      if (m.wa_id && (!prev || new Date(m.created_at) < new Date(prev.created_at))) {
        meetingByWa.set(m.wa_id, m);
      }
      const prevLead = m.lead_id ? meetingByLead.get(m.lead_id) : null;
      if (m.lead_id && (!prevLead || new Date(m.created_at) < new Date(prevLead.created_at))) {
        meetingByLead.set(m.lead_id, m);
      }
    }

    // Propuestas y dinero real por lead. El ingreso sale del libro de
    // Finanzas (`finance_income`) y no de `quotes`: una cotización es lo que
    // se pidió, un ingreso "pagado" es lo que el cliente de verdad depositó, y
    // el ROAS del reporte por anuncio sólo tiene sentido con lo segundo.
    const leadIds = leads.map((l) => l.id);
    const quoteByLead = new Map();
    const proposalLeadIds = new Set();
    const paidByLead = new Map();
    const billedByLead = new Map();
    /*
     * Leads que ya tienen un proyecto abierto. Es el segundo camino para saber
     * que la venta se cerró, y hace falta: el primero depende de que la
     * columna del tablero esté marcada como `final`, y si alguien la recrea
     * sin marcarla, la trazabilidad volvería a mostrar como "en espera" a un
     * cliente al que ya se le está entregando trabajo. Un proyecto no nace
     * solo — sale de ganar el lead, de cerrar con el pago inicial o de un alta
     * manual — y los tres significan lo mismo.
     */
    const wonProjectLeadIds = new Set();
    // Leads con al menos una cuota verificada: el tercer camino de `isWonLead`.
    const paidLeadIds = new Set();
    const closedAtByLead = new Map();

    if (leadIds.length) {
      const [quotes, contracts, income, projects] = await Promise.all([
        db('quotes').whereIn('lead_id', leadIds).orderBy('created_at', 'desc')
          .select('lead_id', 'amount', 'currency'),
        db('contracts').whereIn('lead_id', leadIds).whereNot('status', 'anulado')
          .select('lead_id'),
        db('finance_income').whereIn('lead_id', leadIds)
          .select('lead_id', 'monto', 'estado'),
        /*
         * `created_at` es la fecha de cierre de la venta: el proyecto nace al
         * ganar el lead (ver `projectService`), así que es el único momento
         * datado de ese hecho — `leads.status` dice que está ganado pero no
         * desde cuándo. Es la misma fecha con la que el Reporte General fecha
         * lo vendido.
         */
        db('projects').whereIn('lead_id', leadIds).select('lead_id', 'created_at')
      ]);

      for (const project of projects) {
        if (!project.lead_id) continue;
        wonProjectLeadIds.add(project.lead_id);
        const previo = closedAtByLead.get(project.lead_id);
        if (!previo || new Date(project.created_at) < new Date(previo)) {
          closedAtByLead.set(project.lead_id, project.created_at);
        }
      }

      for (const q of quotes) {
        if (!quoteByLead.has(q.lead_id)) quoteByLead.set(q.lead_id, q); // la más reciente
        proposalLeadIds.add(q.lead_id);
      }
      for (const c of contracts) proposalLeadIds.add(c.lead_id);
      for (const i of income) {
        const amount = Number(i.monto) || 0;
        billedByLead.set(i.lead_id, (billedByLead.get(i.lead_id) || 0) + amount);
        /*
         * "Cobrado" es lo `verificado` y no lo `pagado`: de los tres estados
         * de una cuota, `verificado` es el único que suma en los libros de
         * Finanzas (ver `ESTADOS_INGRESO`) — `pagado` es "el cliente dice que
         * pagó y Finanzas todavía no dio el visto bueno". Contando `pagado` el
         * reporte sumaba dinero que podía no haber llegado y, peor, dejaba
         * FUERA el dinero confirmado, así que el ingreso y el ROAS de cada
         * anuncio no coincidían con el Resumen Financiero.
         */
        if (String(i.estado).toLowerCase() === 'verificado') {
          paidByLead.set(i.lead_id, (paidByLead.get(i.lead_id) || 0) + amount);
          paidLeadIds.add(i.lead_id);
        }
        // Tener el cierre registrado en Finanzas implica que la propuesta ya
        // se hizo, aunque la cuota siga sin cobrarse.
        proposalLeadIds.add(i.lead_id);
      }
    }

    return attribution.map((a) => {
      /*
       * El cruce por teléfono manda también para los leads de formulario, y no
       * se usa directo el id de la fila que trajo la atribución: es el mismo
       * `esMejorLead()` de arriba el que decide cuál de los gemelos de un
       * teléfono es el lead de verdad, y preguntarlo distinto acá es como se
       * llega a que dos pantallas cuenten cosas diferentes. El id queda como
       * respaldo para el formulario que llegó sin celular.
       */
      const lead = (a.matchKey ? leadByWa.get(a.matchKey) : null)
        || (a.leadId ? leadById.get(a.leadId) : null)
        || null;
      const session = a.waId ? sessionByWa.get(a.waId) || null : null;
      const meeting = (a.waId ? meetingByWa.get(a.waId) : null)
        || (lead ? meetingByLead.get(lead.id) : null)
        || null;
      const firstOut = a.waId ? firstOutByWa.get(a.waId) || null : null;

      /*
       * Cuándo se le contestó por primera vez a este lead.
       *
       * Gana la marca de la ficha (`leads.first_response_at`) y el primer
       * saliente de WhatsApp queda de respaldo para el contacto que escribió y
       * al que nadie registró como lead. La marca cubre los dos caminos por
       * los que de verdad se contesta —cualquier saliente de WhatsApp y la
       * primera nota de la ficha, que es el único registro que deja una
       * llamada—, así que es la que reconoce al lead de formulario que nunca
       * escribió por WhatsApp. Ver `leadFirstResponse.js`.
       */
      const firstResponseAt = lead?.first_response_at || firstOut || null;
      const responderId = lead?.first_response_at ? lead.first_response_by : null;
      const responded = !!firstResponseAt;
      const qualified = (session && session.status === 'completed')
        || (lead && lead.overall_viability_score != null)
        || (lead && !['nuevo'].includes(lead.status));
      const hasAppointment = !!meeting || (lead && APPOINTMENT_STATUSES.has(lead.status));
      const won = isWonLead(lead, wonStatuses, wonProjectLeadIds, paidLeadIds);
      const lost = lead && LOST_STATUSES.has(lead.status);

      /*
       * La cotización del lead, lo haya ganado o no.
       *
       * Estaba condicionada a `won`, así que el valor del pipeline ABIERTO era
       * invisible: en el corte del 10/11/2026 había 63 oportunidades en
       * "Cotización / propuesta" y las 63 salían con cotizado 0, de modo que
       * no se podía saber cuánto dinero había en juego, ni qué descuento se
       * ofreció, ni qué tan efectivas son las propuestas — que es justo lo que
       * se mira para decidir si el problema es el anuncio o el cierre. Lo que
       * se cotizó es un hecho con fecha propia y no un atributo de haber
       * ganado; que la venta se cierre o no es otra columna.
       */
      const quote = lead ? quoteByLead.get(lead.id) : null;
      /*
       * `null` es "no se puede saber" y `0` es "no entró nada", y son dos
       * cosas distintas que estaban colapsadas en cero. Un contacto SIN ficha
       * en el CRM —alguien que escribió desde un anuncio y a quien nadie
       * registró— no tiene cobros que consultar: decir "S/ 0" de él es
       * afirmar que no pagó nada, cuando lo que pasa es que no sabemos. Con
       * ficha, el cero sí es un cero: esa persona está en la base y no tiene
       * ninguna cuota verificada.
       */
      const paidRevenue = lead ? paidByLead.get(lead.id) || 0 : null;
      const billedRevenue = lead ? billedByLead.get(lead.id) || 0 : null;
      const hasProposal = lead ? proposalLeadIds.has(lead.id) : false;

      // Etapa comercial del reporte por anuncio: cuatro cajones excluyentes y
      // por prioridad, para que la suma de las cuatro columnas sea siempre el
      // total de leads del anuncio. Un cerrado no se vuelve a contar como
      // cotización, y "seguimiento" es todo lo que no cayó en los otros tres.
      let crmStage = 'seguimiento';
      if (won) crmStage = 'ganado';
      else if (lost) crmStage = 'descartado';
      else if (hasProposal || (lead && QUOTATION_STATUSES.has(lead.status))) crmStage = 'cotizacion';

      let currentStage = 'conversacion';
      if (responded) currentStage = 'respondido';
      if (qualified) currentStage = 'calificado';
      if (hasAppointment) currentStage = 'cita_agendada';
      if (won) currentStage = 'ganado';
      else if (lost) currentStage = 'perdido';

      return {
        ...a,
        lead,
        leadStatus: lead?.status || null,
        viability: lead?.overall_viability_score ?? null,
        firstResponseMinutes: minutesBetween(a.firstMessageAt, firstResponseAt),
        /*
         * Quién contestó, y el tiempo de la respuesta HUMANA por separado.
         *
         * Son dos relojes distintos y hay que medirlos distinto: el acuse de
         * Avan sale en segundos y la atención de una persona es la que mueve
         * al lead. Promediados en una sola cifra, el funnel se ve atendido
         * —mediana de 20 segundos— con 51 leads esperando más de una hora. El
         * responsable nulo es "Avan o el eco de la app de WhatsApp Business",
         * la misma convención que `whatsapp_messages.sent_by`, así que no se
         * afirma que contestó el bot: se dice que no fue nadie del panel.
         */
        firstResponseBy: responderId ? responderById.get(responderId) || null : null,
        firstResponseIsHuman: !!responderId,
        humanFirstResponseMinutes: responderId
          ? minutesBetween(a.firstMessageAt, firstResponseAt)
          : null,
        qualifiedAt: session && session.status === 'completed' ? session.updated_at : null,
        meetingAt: meeting?.start_time || null,
        meetingBookedAt: meeting?.created_at || null,
        /*
         * Los tres desenlaces de la cita, separados. `null` en `attendance` es
         * "nadie lo registró" y no "no vino": un "no" por defecto mostraría
         * como ausencias todas las reuniones viejas, que son casi todas.
         */
        meetingAttendance: meeting?.attendance || null,
        meetingCancelled: !!meeting?.cancelled_at,
        /*
         * La etapa dice "cita agendada" y no hay ninguna reunión con fecha y
         * hora. No se frena el movimiento —el setter puede no tener permiso
         * para agendar, ver `updateLeadStatus()`— pero sí se deja el rastro:
         * sin él, "cita con reunión" y "cita sin reunión" se escriben igual en
         * la columna y el reporte cuenta 43 citas de las que solo 36 se pueden
         * ir a buscar en una agenda (corte del 10/11/2026). Se deriva en cada
         * lectura y no se guarda: en cuanto alguien cargue la reunión deja de
         * ser cierto.
         */
        appointmentWithoutMeeting: !!hasAppointment && !meeting,
        quotedValue: quote ? Number(quote.amount) : null,
        quotedCurrency: quote?.currency || null,
        paidRevenue,
        /*
         * `billedRevenue` es TODO lo registrado en Finanzas para ese lead, y
         * mezclaba dos cosas que se deciden distinto: lo de una venta ya
         * cerrada y lo de un acuerdo que todavía no se ganó. En el corte del
         * 10/11/2026 esa única columna decía S/ 40.600 —S/ 14.800 de 7 ventas
         * ganadas y S/ 25.800 de 7 leads en "Cuota pactada" sin un solo cobro—
         * y se leía como facturación cerrada. El total sigue publicándose,
         * pero con sus dos mitades al lado para que no haga falta restarlas.
         */
        wonRevenue: won ? billedRevenue : (lead ? 0 : null),
        pactedRevenue: won ? (lead ? 0 : null) : billedRevenue,
        billedRevenue,
        hasProposal,
        crmStage,
        closedAt: lead ? closedAtByLead.get(lead.id) || null : null,
        responded,
        qualified: !!qualified,
        /*
         * Tres estados y no dos: `null` es "nadie la miró todavía", que es con
         * lo que marketing separa el lead sin revisar del lead revisado y
         * descartado. `qualified` (sin prefijo) es otra cosa —el informe de
         * viabilidad de Avan— y de ella cuelgan las tasas por anuncio de la
         * pantalla de Campañas.
         */
        setterQualified: lead && lead.qualified !== null && lead.qualified !== undefined
          ? !!lead.qualified
          : null,
        hasAppointment: !!hasAppointment,
        won: !!won,
        lost: !!lost,
        currentStage
      };
    });
  }

  /**
   * De qué anuncio llegó un contacto. El `source_id` del referral que manda
   * WhatsApp puede ser el id del anuncio, el de la publicación que hay detrás
   * o el del media de Instagram —la sincronización mapea los tres al mismo
   * anuncio—, así que se busca primero la fila de métricas por id y, si no
   * casa, por el nombre que guardó el mapeo.
   */
  #resolveContactAd(contact, campaign, metaAds) {
    const sourceId = contact.sourceId ? String(contact.sourceId) : null;
    const label = campaign?.ads?.find((a) => String(a.ad_source_id) === sourceId)?.ad_label || null;
    /*
     * El `sourceId` de TikTok lleva el prefijo `tt:` porque `campaign_ads` es
     * compartida y su `ad_source_id` es único; las MÉTRICAS, en cambio, se
     * guardan con el id pelado que devuelve cada plataforma. Sin quitarlo acá,
     * un contacto de TikTok nunca encontraba su anuncio en las métricas y la
     * trazabilidad salía sin nombre de anuncio ni miniatura.
     */
    const insightsId = sourceId?.startsWith('tt:') ? sourceId.slice(3) : sourceId;
    const metaAd = metaAds.find((a) => String(a.adId) === insightsId)
      || (label ? metaAds.find((a) => a.adName === label) : null);
    return {
      adSourceId: sourceId,
      // Sólo hay `adId` cuando el anuncio existe en las métricas: es lo que
      // permite pedirle la miniatura del creativo al backend.
      adId: metaAd?.adId || null,
      adName: metaAd?.adName || label || null,
      adsetId: metaAd?.adsetId || null,
      adsetName: metaAd?.adsetName || null
    };
  }

  /**
   * Una fila por lead atribuido, con de dónde llegó y dónde está hoy.
   *
   * Dos decisiones que la diferencian del resto del reporte:
   *
   *  - El estado que se imprime es la COLUMNA REAL del Kanban (su etiqueta,
   *    no la clave `col_xxx`), porque es la que el equipo ve y mueve todos los
   *    días. `crmStage` es una clasificación derivada de cuatro cajones que
   *    sirve para sumar por anuncio, pero nadie la reconoce en una hoja.
   *  - Van TODOS los contactos, incluidos los que llegaron por un anuncio que
   *    no está mapeado a ninguna campaña: esos leads existen y hoy no salían
   *    en ninguna hoja, que es justo el agujero que tapa esta.
   */
  async #buildLeadTrail(contacts, campaigns, campaignByAd, { from = null, to = null } = {}) {
    const columns = await db('funnel_columns').select('key', 'label');
    const labelByKey = new Map(columns.map((c) => [c.key, c.label]));

    // Las métricas de Meta se parsean una vez por campaña, no una por lead.
    const metaAdsByCampaign = new Map(
      campaigns.map((c) => [c.id, parseMetaInsights(c.meta_ads_insights) || []])
    );

    const STAGE_LABELS = {
      ganado: 'Ganado',
      cotizacion: 'Cotización / propuesta',
      descartado: 'Descartado',
      seguimiento: 'En seguimiento'
    };

    /*
     * La etapa de esta hoja es más fina que los cuatro cajones con los que se
     * cuentan los leads por anuncio (`crmStage`), y tiene que serlo: ahí la
     * suma de las cuatro columnas es siempre el total de leads del anuncio
     * —una quinta los descuadraría—, mientras que acá cada fila es un lead y
     * lo que se lee es su situación.
     *
     * "Cuota pactada" es el lead que todavía no se ganó y YA tiene un
     * cronograma registrado en Finanzas: el precio está acordado y el dinero
     * no entró. Sin ese nombre, la hoja mostraba un importe en una fila cuya
     * etapa decía "cotización", que es lo que hacía imposible saber si una
     * venta estaba cerrada o solo prometida.
     */
    const stageLabel = (c) => {
      if (c.crmStage === 'ganado' || c.crmStage === 'descartado') return STAGE_LABELS[c.crmStage];
      if ((c.billedRevenue || 0) > 0) return 'Cuota pactada';
      return STAGE_LABELS[c.crmStage] || c.crmStage;
    };

    /*
     * Los leads que NO vinieron de un anuncio van en la misma hoja: la
     * pregunta que contesta es "¿de dónde salió cada lead?", y una hoja donde
     * solo figuran los de campaña no permite comprobar que ningún lead se haya
     * quedado sin plataforma — que es justo lo que marketing verifica. Se
     * enriquecen por el mismo camino que los atribuidos para que su etapa, su
     * cita y su dinero se calculen con las mismas reglas.
     */
    const atribuidos = new Set(contacts.map((c) => c.lead?.id).filter(Boolean));
    const organicos = await this.#enrichContacts(
      await this.#nonAttributedContacts({ from, to }, atribuidos)
    );

    const row = (c) => {
      const campaign = campaignByAd.get(c.sourceId) || null;
      const ad = this.#resolveContactAd(c, campaign, campaign ? metaAdsByCampaign.get(campaign.id) || [] : []);
      const lead = c.lead;
      /*
       * El origen sale del propio lead y no de la campaña mapeada: ahí están
       * los nombres y los ids que la plataforma mandó al dar de alta el lead,
       * que es lo único que sigue siendo verdad cuando el anuncio se pausó o
       * se borró y ya no figura en las métricas sincronizadas.
       */
      const origin = leadOrigin(lead || {});

      return {
        leadId: lead?.id || null,
        name: lead?.full_name || c.contactName || c.phone || c.waId,
        // El teléfono de la ficha cuando el lead no tiene conversación: el
        // de formulario llega sin `wa_id` y la columna quedaba vacía justo
        // en la hoja con la que se lo va a llamar.
        phone: c.phone || c.waId || lead?.phone || null,
        origin: c.origin === 'form' ? 'Formulario' : 'WhatsApp',
        email: lead?.email || null,
        career: lead?.field_of_study || null,
        topic: lead?.topic || null,

        // ── De dónde salió ──
        platform: origin.platform,
        network: origin.network,
        channel: origin.channel,
        paid: origin.paid,
        /*
         * El nombre guardado en el lead gana sobre el resuelto contra las
         * métricas: el primero es el que mandó la plataforma al entrar el
         * lead, el segundo depende de que el anuncio siga sincronizado. El
         * nombre de la campaña del CRM queda de último recurso para los leads
         * anteriores a que se guardaran los nombres.
         */
        campaignId: bareSourceId(origin.campaignId || campaign?.external_id || null),
        campaignName: origin.campaignName || campaign?.name || null,
        adsetId: bareSourceId(origin.adsetId || ad.adsetId || null),
        adsetName: origin.adsetName || ad.adsetName || null,
        adName: origin.adName || ad.adName || null,
        adHeadline: c.headline || origin.headline || null,
        // El "ID de origen" sale pelado: el prefijo `tt:` es interno del CRM
        // y en la hoja se compara dígito por dígito contra el Ads Manager.
        adSourceId: bareSourceId(ad.adSourceId || origin.adId || null),
        platformLeadId: origin.platformLeadId,
        /*
         * Con qué evidencia se supo de dónde salió este lead. Sin esto la hoja
         * afirma una plataforma y no deja comprobar cómo se llegó a ella, que
         * es justo lo que hacía imposible auditar los leads atribuidos por
         * coincidencia de teléfono (ver `attributionEvidence.js`).
         */
        attributionMethod: origin.method,
        attributionConfidence: origin.confidence,
        attributionReconciledAt: origin.reconciledAt,
        /*
         * La ficha que tiene atribución de más de una plataforma: el origen es
         * el sellado y esto es lo que llegó después. Va a la hoja porque es la
         * lista de fichas que hay que revisar, y escondido no se revisa.
         */
        attributionConflict: !!origin.conflict,
        /*
         * La jerarquía de Smart+. En esas campañas TikTok reporta el gasto al
         * anuncio PADRE y la pieza creativa puede no venir, así que el costo por
         * cita y por venta se calculan al padre —los dos lados de la división
         * hablan del mismo objeto— y la pieza se declara desconocida.
         *
         * Los tres ids son cosas distintas: el anuncio compra el presupuesto, la
         * pieza es la combinación que armó TikTok y el video es el archivo
         * subido. Van en columnas separadas porque un mismo video vive en varias
         * piezas, y mezclarlos hace que "el video que mejor convierte" y "el
         * anuncio que mejor convierte" den respuestas distintas.
         */
        attributionLevel: origin.creative ? origin.creative.level : null,
        parentAdId: bareSourceId(origin.creative?.parentAdId || null),
        creativeId: origin.creative?.creativeId || null,
        videoId: origin.creative?.videoId || null,
        videoName: origin.creative?.videoName || null,
        creativeValidFrom: origin.creative?.vigencia?.desde || null,
        creativeValidTo: origin.creative?.vigencia?.hasta || null,
        secondaryPlatforms: (origin.secondary || []).map((s) => s.platform).join(' + ') || null,
        // El id interno de la campaña del CRM, con el que el exportable
        // respeta el filtro de campañas de la pantalla.
        crmCampaignId: campaign?.id || null,

        enteredAt: origin.enteredAt || c.firstMessageAt || null,
        firstMessageAt: c.firstMessageAt,
        firstResponseMinutes: c.firstResponseMinutes,
        /*
         * El acuse y la atención humana, separados. La hoja publica los dos
         * porque con uno solo no se puede distinguir al lead al que Avan le
         * contestó en 20 segundos y nadie volvió a escribirle, del lead que un
         * setter atendió de verdad.
         */
        firstResponseBy: c.firstResponseBy,
        firstResponseIsHuman: c.firstResponseIsHuman,
        humanFirstResponseMinutes: c.humanFirstResponseMinutes,
        // Tres estados: `null` es "sin calificar", y se escribe con todas las
        // letras para que ningún importador lo lea como un "No".
        qualified: c.setterQualified,
        // Agendada y asistida son dos columnas y no una: de la segunda cuelga
        // si el público del anuncio de verdad se presenta.
        meetingAttendance: c.meetingAttendance,
        // La etapa dice "cita agendada" y no hay reunión con fecha y hora:
        // esa cita no se puede ir a buscar en ninguna agenda.
        appointmentWithoutMeeting: c.appointmentWithoutMeeting,
        viability: c.viability,
        meetingAt: c.meetingAt,
        /*
         * Meta cuenta como conversación iniciada cualquier clic que abre el
         * chat, así que su total siempre va a ser mayor que el del CRM. Este
         * marcador separa al que escribió y no dejó un dato —el chat vacío—
         * de la pérdida real, que es la mitad que hay que corregir.
         */
        onlyGreeted: lead ? onlyGreeted(lead, { genericName: GENERIC_CONTACT_NAME }) : true,

        // Dónde está hoy: la columna del Kanban y, en paralelo, el cajón
        // comercial con el que se suman las cifras por anuncio.
        funnelColumn: lead ? (labelByKey.get(lead.status) || lead.status) : null,
        commercialStage: stageLabel(c),

        closedAt: c.closedAt || null,
        quotedValue: c.quotedValue,
        // Se pasan tal cual: `null` (sin ficha, no se puede saber) no es 0.
        paidRevenue: c.paidRevenue ?? null,
        // Las dos mitades de lo registrado, al lado del total: una venta
        // ganada y un acuerdo que no se cerró no son la misma plata.
        wonRevenue: c.wonRevenue ?? null,
        pactedRevenue: c.pactedRevenue ?? null,
        billedRevenue: c.billedRevenue ?? null
      };
    };

    return [...contacts, ...organicos]
      .sort((x, y) => new Date(y.firstMessageAt) - new Date(x.firstMessageAt))
      .map(row);
  }

  /**
   * Los leads del rango que no vinieron de ningún anuncio, con la forma de un
   * contacto atribuido para poder pasarlos por `#enrichContacts()`.
   *
   * `excluidos` son los leads que ya entraron por atribución: un contacto de
   * WhatsApp se atribuye desde `whatsapp_messages` y su lead no tiene ninguna
   * columna de anuncio, así que sin esa resta saldría dos veces en la hoja.
   *
   * El rango se mide por `created_at` —cuándo entró el lead al CRM— porque un
   * lead orgánico no tiene fecha en ninguna plataforma.
   */
  async #nonAttributedContacts({ from, to }, excluidos = new Set()) {
    const query = db('leads')
      .whereNull('meta_ad_id')
      .whereNull('tiktok_ad_id')
      .whereNull('ctwa_ad_id');
    if (from) query.where('created_at', '>=', from);
    if (to) query.where('created_at', '<=', to);

    const rows = await query.select('id', 'phone', 'full_name', 'created_at');
    const pendientes = rows.filter((r) => !excluidos.has(r.id));
    if (!pendientes.length) return [];

    // Si esa persona además tiene conversación de WhatsApp, es la suya: de ahí
    // salen su tiempo de primera respuesta, su sesión del bot y su reunión.
    const waIdByKey = await this.#waIdsByPhoneKey();

    return pendientes.map((lead) => {
      const matchKey = phoneMatchKey(lead.phone);
      return {
        origin: 'organic',
        waId: (matchKey && waIdByKey.get(matchKey)) || null,
        leadId: lead.id,
        phone: lead.phone || null,
        matchKey,
        dedupeKey: `lead:${lead.id}`,
        contactName: lead.full_name || null,
        // Sin anuncio no hay ID de origen, y por eso ninguna campaña lo
        // reclama: `campaignByAd.get(null)` no encuentra nada.
        sourceId: null,
        formId: null,
        headline: null,
        sourceUrl: null,
        platform: null,
        firstMessageAt: lead.created_at
      };
    });
  }

  #summariseGroup(contacts, campaign) {
    const conversations = contacts.length;
    /*
     * Los tres niveles de WhatsApp, que se confundían en uno.
     *
     *  1. `metaMessagingStarted` — el EVENTO ATRIBUIDO: lo que Meta cuenta como
     *     conversación iniciada, o sea cualquier clic que abre el chat. Es de
     *     la plataforma y siempre va a ser el número más grande.
     *  2. `conversations` — la CONVERSACIÓN ENTRANTE que el CRM reconoce y
     *     atribuye a este anuncio.
     *  3. `newOpportunities` — la conversación que trajo a una persona que NO
     *     estaba: la ficha nació de ella. El resto son clientes y contactos
     *     que el equipo ya tenía y volvieron a escribir desde un anuncio.
     *
     * Sin el tercero, el costo por conversación se lee como costo por persona
     * nueva, y un anuncio de retargeting —que por definición le habla a quien
     * ya está en la base— parece tan eficiente como uno que trae gente nueva.
     * Los tres se publican juntos justamente para que la brecha entre ellos se
     * pueda explicar en vez de discutir.
     */
    const newOpportunities = contacts.filter((c) => isNewOpportunity(c)).length;
    const responded = contacts.filter((c) => c.responded).length;
    const qualified = contacts.filter((c) => c.qualified).length;
    const appointments = contacts.filter((c) => c.hasAppointment).length;
    const won = contacts.filter((c) => c.won).length;
    const lost = contacts.filter((c) => c.lost).length;
    /*
     * Los desenlaces que faltaban para que el reporte se pueda auditar sin
     * salir de él: a cuántos no se les contestó nunca, cuántas de las citas
     * agendadas no tienen una reunión que ir a buscar, cuántas se asistieron
     * y cuántos leads tienen una cotización emitida.
     */
    const noFirstResponse = contacts.filter((c) => !c.responded).length;
    const appointmentsWithoutMeeting = contacts.filter((c) => c.appointmentWithoutMeeting).length;
    const attended = contacts.filter((c) => c.meetingAttendance === 'asistio').length;
    const quotedLeads = contacts.filter((c) => c.quotedValue != null).length;
    /*
     * La calificación comercial tiene TRES estados y el vacío es información:
     * separa al lead que nadie revisó del revisado y descartado. Se publican
     * los tres, porque una tasa de calificación en cero puede ser un público
     * malo o un equipo que no está registrando el dato, y a uno se le corta el
     * presupuesto y al otro se le pide que complete la ficha.
     */
    const setterQualified = contacts.filter((c) => c.setterQualified === true).length;
    const setterDisqualified = contacts.filter((c) => c.setterQualified === false).length;
    const setterUnreviewed = contacts.filter((c) => c.setterQualified == null).length;

    const spend = campaign ? resolveSpend(campaign) : 0;
    const meta = campaign ? parseMetaInsights(campaign.meta_insights) : null;
    const metaAds = (campaign ? parseMetaInsights(campaign.meta_ads_insights) : null) || [];
    /*
     * Las cuatro cifras de dinero del funnel, separadas porque se deciden
     * distinto y estaban colapsadas en dos:
     *
     *   quotedValue    lo COTIZADO: el pipeline abierto, lo que se propuso.
     *   wonRevenue     lo registrado en Finanzas de ventas YA ganadas.
     *   pactedRevenue  lo registrado de acuerdos que todavía no se ganaron.
     *   collectedRevenue  lo COBRADO y verificado, el hecho más difícil de
     *                  discutir de los cuatro.
     *
     * `billedRevenue` (ganado + pactado) se sigue publicando porque es lo que
     * venían leyendo las hojas, pero ya no es la única cifra disponible.
     */
    const quotedValue = contacts.reduce((sum, c) => sum + (c.quotedValue || 0), 0);
    const wonRevenue = contacts.reduce((sum, c) => sum + (c.wonRevenue || 0), 0);
    const pactedRevenue = contacts.reduce((sum, c) => sum + (c.pactedRevenue || 0), 0);
    const collectedRevenue = contacts.reduce((sum, c) => sum + (c.paidRevenue || 0), 0);
    const billedRevenue = wonRevenue + pactedRevenue;

    const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
    const perStage = (den) => (den > 0 && spend > 0 ? Math.round((spend / den) * 100) / 100 : null);

    const funnel = [];
    if (meta && meta.impressions > 0) {
      funnel.push({ key: 'impresiones', label: 'Impresiones (Meta)', count: meta.impressions });
      funnel.push({ key: 'clics', label: 'Clics en el anuncio (Meta)', count: meta.clicks || 0 });
    }
    if (meta && meta.messagingStarted > 0) {
      funnel.push({ key: 'msg_meta', label: 'Conversaciones iniciadas (Meta)', count: meta.messagingStarted });
    }
    funnel.push(
      { key: 'conversacion', label: 'Conversaciones atribuidas (CRM)', count: conversations },
      { key: 'oportunidad', label: 'Personas nuevas (no estaban en el CRM)', count: newOpportunities },
      { key: 'respondido', label: 'Avan respondió', count: responded },
      { key: 'calificado', label: 'Calificado (informe de viabilidad)', count: qualified },
      { key: 'cita_agendada', label: 'Cita agendada', count: appointments },
      { key: 'ganado', label: 'Ganado / matriculado', count: won }
    );

    return {
      funnel,
      metrics: {
        conversations,
        newOpportunities,
        responded,
        qualified,
        appointments,
        won,
        lost,
        noFirstResponse,
        appointmentsWithoutMeeting,
        attended,
        quotedLeads,
        setterQualified,
        setterDisqualified,
        setterUnreviewed,
        qualificationRate: rate(qualified, conversations),
        conversationToAppointmentRate: rate(appointments, conversations),
        appointmentToWonRate: rate(won, appointments),
        /*
         * El cierre se mide sobre las citas ASISTIDAS y no sobre las
         * agendadas: una cita a la que nadie fue no tuvo oportunidad de
         * cerrar, y contarla en el denominador castiga al closer por un
         * problema del público del anuncio. Va junto a la de agendadas, no en
         * su lugar: la brecha entre las dos es lo que se mira.
         */
        attendedToWonRate: rate(won, attended),
        attendanceRate: rate(attended, appointments),
        avgViability: (() => {
          const vals = contacts.map((c) => c.viability).filter((v) => v != null);
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        })(),
        medianFirstResponseMin: (() => {
          const m = median(contacts.map((c) => c.firstResponseMinutes));
          return m == null ? null : Math.round(m * 10) / 10;
        })(),
        /*
         * El P90 va al lado de la mediana y no en su lugar: con la mediana
         * sola, un funnel donde Avan acusa recibo en segundos se ve atendido
         * aunque la décima parte de los leads espere horas. Y la mediana de la
         * respuesta HUMANA aparte, que es el reloj que de verdad importa.
         */
        p90FirstResponseMin: (() => {
          const p = percentile(contacts.map((c) => c.firstResponseMinutes), 0.9);
          return p == null ? null : Math.round(p * 10) / 10;
        })(),
        medianHumanResponseMin: (() => {
          const m = median(contacts.map((c) => c.humanFirstResponseMinutes));
          return m == null ? null : Math.round(m * 10) / 10;
        })(),
        spend,
        quotedValue,
        wonRevenue,
        pactedRevenue,
        billedRevenue,
        collectedRevenue,
        /*
         * El ROAS se calcula sobre lo COBRADO y verificado, no sobre lo
         * cotizado.
         *
         * Antes dividía el valor cotizado de los leads ganados entre el gasto,
         * y eso ya era discutible; con la cotización abierta ahora incluida
         * —que es lo que hacía falta para ver el pipeline— sería directamente
         * falso: un anuncio que solo genera propuestas sin cerrar ninguna
         * mostraría el mejor retorno del libro. Lo cotizado no es dinero que
         * entró, y de esta cifra cuelga la decisión de dónde poner el
         * presupuesto. El retorno sobre lo cotizado se sigue publicando
         * aparte, nombrado por lo que es.
         */
        roas: spend > 0 && collectedRevenue > 0
          ? Math.round((collectedRevenue / spend) * 100) / 100 : null,
        quotedToSpend: spend > 0 && quotedValue > 0
          ? Math.round((quotedValue / spend) * 100) / 100 : null,
        costPerConversation: perStage(conversations),
        costPerQualified: perStage(qualified),
        costPerAppointment: perStage(appointments),
        // Lo que de verdad cuesta una reunión que ocurrió. El costo por cita
        // AGENDADA abarata a los anuncios cuyo público agenda y no aparece.
        costPerAttended: perStage(attended),
        costPerWon: perStage(won),
        // Métricas tal como las reporta el Administrador de anuncios (Meta).
        // `metaSpend` es el gasto real de Meta; `spend` puede venir del gasto
        // manual de la campaña cuando no hay sincronización.
        metaSpend: meta?.spend ?? null,
        impressions: meta?.impressions ?? null,
        reach: meta?.reach ?? null,
        frequency: meta?.frequency ?? null,
        clicks: meta?.clicks ?? null,               // Clics (todos)
        ctr: meta?.ctr ?? null,                     // CTR (todos)
        cpm: meta?.cpm ?? null,
        cpc: meta?.cpc ?? null,                     // CPC (todos)
        linkClicks: meta?.linkClicks ?? null,       // Clics en el enlace
        linkCtr: meta?.linkCtr ?? null,
        costPerLinkClick: meta?.costPerLinkClick ?? null,
        landingPageViews: meta?.landingPageViews ?? null,
        costPerLandingPageView: meta?.costPerLandingPageView ?? null,
        shopClicks: meta?.shopClicks ?? null,
        metaResults: meta?.results ?? null,
        metaResultIndicator: meta?.resultIndicator ?? null,
        metaCostPerResult: meta?.costPerResult ?? null,
        attributionSetting: meta?.attributionSetting ?? null,
        reportStart: meta?.dateStart ?? null,
        reportStop: meta?.dateStop ?? null,
        metaMessagingStarted: meta?.messagingStarted ?? null,
        costPerLeadMeta: meta && meta.messagingStarted > 0 && spend > 0
          ? Math.round((spend / meta.messagingStarted) * 100) / 100 : null
      },
      // Funnel comercial por anuncio concreto, que es el grano del exportable
      // de atribución. Va sobre TODOS los contactos, no sobre la muestra.
      adBreakdown: campaign ? this.#breakdownByAd(contacts, campaign, metaAds) : [],
      // El modal de trazabilidad los agrupa por anuncio, así que se mandan
      // bastantes más de los que cabían en la vista en línea anterior.
      sampleContacts: contacts
        .slice()
        .sort((x, y) => new Date(y.firstMessageAt) - new Date(x.firstMessageAt))
        .slice(0, 60)
        .map((c) => ({
          name: c.lead?.full_name || c.contactName || c.phone || c.waId,
          leadId: c.lead?.id || null,
          topic: c.lead?.topic || null,
          // Por dónde entró: el formulario instantáneo o el clic en el anuncio.
          origin: c.origin,
          currentStage: c.currentStage,
          viability: c.viability,
          platform: c.platform || null,
          adHeadline: c.headline,
          firstMessageAt: c.firstMessageAt,
          firstResponseMinutes: c.firstResponseMinutes,
          meetingAt: c.meetingAt,
          quotedValue: c.quotedValue,
          ...this.#resolveContactAd(c, campaign, metaAds),
          timeline: this.#buildTimeline(c)
        }))
    };
  }

  /**
   * Agrega el funnel del CRM por anuncio individual: cuántos leads trajo cada
   * anuncio, en qué etapa comercial están y cuánto dinero cobró la empresa de
   * ellos. Es el cruce "gasto de Meta ↔ venta real" que pide el exportable.
   *
   * Se agrupa por `adId` cuando el referral casó con un anuncio de las
   * métricas de Meta y, si no, por el `source_id` crudo: un anuncio borrado
   * en Meta —o fuera de la ventana sincronizada— sigue apareciendo con sus
   * leads en vez de desaparecer del reporte junto con el dinero que trajo.
   */
  #breakdownByAd(contacts, campaign, metaAds) {
    const groups = new Map();

    for (const c of contacts) {
      const ad = this.#resolveContactAd(c, campaign, metaAds);
      /*
       * La plataforma entra en la clave. Los ids de anuncio de Meta y de
       * TikTok son los dos numéricos y la hoja los publica pelados, así que
       * sin esto dos anuncios distintos podrían caer en la misma fila y
       * sumar sus leads y su dinero como si fueran uno. Es la misma razón por
       * la que `campaign_ads.ad_source_id` lleva el prefijo `tt:`.
       */
      const plataforma = c.platform || 'na';
      const key = ad.adId ? `${plataforma}|ad:${ad.adId}` : `${plataforma}|src:${ad.adSourceId || 'sin-origen'}`;

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          adId: ad.adId,
          adName: ad.adName,
          adsetId: ad.adsetId,
          adsetName: ad.adsetName,
          adSourceId: ad.adSourceId,
          headline: c.headline || null,
          leads: 0,
          responded: 0,
          qualified: 0,
          appointments: 0,
          /*
           * Los cinco desenlaces, separados: agendada, asistida, cotizada,
           * ganada y cobrada. Estaban colapsados en tres, así que un anuncio
           * que trae gente que agenda y no aparece se leía igual que uno que
           * trae gente que se presenta — y es la diferencia entre un público
           * bueno y uno que hay que dejar de comprar.
           */
          attended: 0,
          collected: 0,
          quotation: 0,
          followUp: 0,
          discarded: 0,
          won: 0,
          /*
           * Leads de este anuncio a los que NADIE contestó. Es la otra mitad
           * de la mediana de respuesta: un anuncio puede traer leads baratos y
           * que la cuarta parte se quede sin una sola respuesta, y entonces lo
           * que hay que arreglar no es el anuncio.
           */
          noFirstResponse: 0,
          /*
           * Cuántos leads tienen una cotización emitida, que es el
           * denominador de `quotedValue`: sin él, S/ 9.700 en una fila no
           * dice si son una propuesta grande o diez chicas.
           */
          quoted: 0,
          paidRevenue: 0,
          /*
           * Las dos mitades de lo registrado: lo de las ventas ya ganadas y lo
           * de los acuerdos que todavía no se cerraron. Sumadas en una sola
           * columna se leen como facturación cerrada (ver `wonRevenue`).
           */
          wonRevenue: 0,
          pactedRevenue: 0,
          billedRevenue: 0,
          /*
           * Contactos de este anuncio SIN ficha en el CRM. Su dinero no es cero,
           * es desconocido, y una suma no puede sumar un desconocido: sin este
           * conteo el total de abajo se lee como completo cuando puede no
           * estarlo, que es el error que lleva a apagar un anuncio que sí
           * vendía.
           */
          sinFicha: 0,
          /*
           * Leads de este anuncio cuya PIEZA creativa no se conoce: en Smart+ el
           * gasto se reporta al padre y la pieza puede no venir. Se cuenta para
           * que la fila pueda decir "este costo es del anuncio padre, no de una
           * pieza" en vez de dejar creer que mide una creatividad concreta.
           */
          piezaDesconocida: 0,
          quotedValue: 0
        };
        groups.set(key, group);
      }

      group.leads += 1;
      if (c.responded) group.responded += 1;
      if (c.qualified) group.qualified += 1;
      if (c.hasAppointment) group.appointments += 1;
      if (c.meetingAttendance === 'asistio') group.attended += 1;
      // "Cobrado" es dinero verificado, que es el hecho más difícil de
      // discutir del funnel. Un desconocido (contacto sin ficha) no cuenta.
      if ((c.paidRevenue || 0) > 0) group.collected += 1;
      if (c.crmStage === 'ganado') group.won += 1;
      else if (c.crmStage === 'cotizacion') group.quotation += 1;
      else if (c.crmStage === 'descartado') group.discarded += 1;
      else group.followUp += 1;
      if (c.paidRevenue === null) group.sinFicha += 1;
      if (c.attributionLevel === LEVELS.padre) group.piezaDesconocida += 1;
      if (!c.responded) group.noFirstResponse += 1;
      if (c.quotedValue != null) group.quoted += 1;
      group.paidRevenue += c.paidRevenue || 0;
      group.wonRevenue += c.wonRevenue || 0;
      group.pactedRevenue += c.pactedRevenue || 0;
      group.billedRevenue += c.billedRevenue || 0;
      group.quotedValue += c.quotedValue || 0;
      if (!group.headline && c.headline) group.headline = c.headline;
    }

    return [...groups.values()];
  }

  #buildTimeline(c) {
    const steps = [];
    const platformLabel = c.platform === 'instagram' ? 'Instagram' : c.platform === 'facebook' ? 'Facebook' : 'Meta';
    // El primer hito es cómo entró, y los dos caminos no son lo mismo para
    // quien lee la trazabilidad: del formulario tenemos sus respuestas y
    // todavía nadie habló con él; del clic, una conversación abierta.
    steps.push(c.origin === 'form'
      ? { stage: `Llenó el formulario del anuncio (${platformLabel})`, at: c.firstMessageAt }
      : { stage: `Escribió por WhatsApp desde el anuncio (${platformLabel})`, at: c.firstMessageAt });
    if (c.firstResponseMinutes != null && c.responded) {
      steps.push({ stage: 'Avan respondió', at: null, note: `${Math.round(c.firstResponseMinutes)} min de espera` });
    }
    if (c.qualifiedAt) steps.push({ stage: 'Calificado por Avan (informe de viabilidad)', at: c.qualifiedAt });
    else if (c.qualified) steps.push({ stage: 'Calificado por Avan', at: null });
    if (c.meetingBookedAt) {
      steps.push({ stage: 'Cita agendada', at: c.meetingBookedAt, note: c.meetingAt ? `para ${new Date(c.meetingAt).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : null });
    }
    const finalLabel = {
      ganado: 'Ganado / matriculado',
      perdido: 'Perdido / descartado',
      cita_agendada: 'En espera de la reunión',
      calificado: 'Calificado, sin cita aún',
      respondido: 'En conversación con Avan',
      // Un lead de formulario al que nadie escribió todavía no está "sin
      // responder" por decisión de nadie: es que la conversación no existe.
      conversacion: c.origin === 'form' ? 'Sin contactar todavía' : 'Sin respuesta todavía'
    }[c.currentStage];
    steps.push({ stage: `Estado actual: ${finalLabel}`, at: null, isFinal: true });
    return steps;
  }

  // ──────────────────────────── Rendimiento global ────────────────────────
  async getPerformance({ from = null, to = null, includeLeadTrail = false } = {}) {
    const [campaigns, attribution] = await Promise.all([
      this.listCampaigns(),
      this.#buildAttribution({ from, to })
    ]);
    const contacts = await this.#enrichContacts(attribution);

    // source_id -> campaña
    const campaignByAd = new Map();
    for (const campaign of campaigns) {
      for (const ad of campaign.ads) campaignByAd.set(ad.ad_source_id, campaign);
    }

    const contactsByCampaign = new Map();
    const unclassified = [];
    for (const c of contacts) {
      const campaign = campaignByAd.get(c.sourceId);
      if (!campaign) {
        unclassified.push(c);
        continue;
      }
      if (!contactsByCampaign.has(campaign.id)) contactsByCampaign.set(campaign.id, []);
      contactsByCampaign.get(campaign.id).push(c);
    }

    const campaignReports = campaigns.map((campaign) => {
      const group = contactsByCampaign.get(campaign.id) || [];
      const summary = this.#summariseGroup(group, campaign);
      return {
        id: campaign.id,
        name: campaign.name,
        platform: campaign.platform,
        objective: campaign.objective,
        status: campaign.status,
        budgetTotal: Number(campaign.budget_total) || 0,
        spendToDate: campaign.spend_to_date != null ? Number(campaign.spend_to_date) : null,
        currency: campaign.currency,
        startDate: campaign.start_date,
        endDate: campaign.end_date,
        notes: campaign.notes,
        source: campaign.source || 'manual',
        externalId: campaign.external_id || null,
        metaStatus: campaign.meta_status || null,
        hasImage: !!campaign.ad_image_filename,
        lastSyncedAt: campaign.last_synced_at || null,
        insightsWindow: parseMetaInsights(campaign.meta_insights)?.window || null,
        // La jerarquía del Administrador de anuncios: la campaña, sus
        // conjuntos y sus anuncios, todos con el mismo juego de métricas.
        metaAdsets: parseMetaInsights(campaign.meta_adsets_insights) || [],
        metaAds: parseMetaInsights(campaign.meta_ads_insights) || [],
        budgetType: campaign.budget_type || null,
        ads: campaign.ads.map((a) => ({ id: a.id, sourceId: a.ad_source_id, label: a.ad_label })),
        ...summary
      };
    });

    // Anuncios detectados en los referrals que aún no están mapeados
    const unclassifiedByAd = new Map();
    for (const c of unclassified) {
      const entry = unclassifiedByAd.get(c.sourceId) || {
        sourceId: c.sourceId,
        headline: c.headline,
        sourceUrl: c.sourceUrl,
        platform: c.platform,
        conversations: 0,
        qualified: 0,
        appointments: 0,
        won: 0,
        firstSeen: c.firstMessageAt,
        lastSeen: c.firstMessageAt
      };
      entry.conversations += 1;
      if (c.qualified) entry.qualified += 1;
      if (c.hasAppointment) entry.appointments += 1;
      if (c.won) entry.won += 1;
      if (new Date(c.firstMessageAt) < new Date(entry.firstSeen)) entry.firstSeen = c.firstMessageAt;
      if (new Date(c.firstMessageAt) > new Date(entry.lastSeen)) entry.lastSeen = c.firstMessageAt;
      if (!entry.headline && c.headline) entry.headline = c.headline;
      unclassifiedByAd.set(c.sourceId, entry);
    }

    const totalsClassified = this.#summariseGroup(
      contacts.filter((c) => campaignByAd.has(c.sourceId)),
      null
    ).metrics;
    const totalSpend = campaigns.reduce((sum, c) => sum + resolveSpend(c), 0);
    const totalQuoted = contacts.reduce((sum, c) => sum + (c.quotedValue || 0), 0);
    // Las tres cifras que estaban mezcladas en una. Ver `#summariseGroup()`.
    const totalWonRevenue = contacts.reduce((sum, c) => sum + (c.wonRevenue || 0), 0);
    const totalPactedRevenue = contacts.reduce((sum, c) => sum + (c.pactedRevenue || 0), 0);
    const totalCollected = contacts.reduce((sum, c) => sum + (c.paidRevenue || 0), 0);
    const metaTotals = campaigns.reduce((acc, c) => {
      const m = parseMetaInsights(c.meta_insights);
      if (m) {
        acc.impressions += Number(m.impressions || 0);
        acc.clicks += Number(m.clicks || 0);
        acc.reach += Number(m.reach || 0);
        acc.messagingStarted += Number(m.messagingStarted || 0);
        acc.linkClicks += Number(m.linkClicks || 0);
        acc.landingPageViews += Number(m.landingPageViews || 0);
        acc.hasData = true;
      }
      return acc;
    }, { impressions: 0, clicks: 0, reach: 0, messagingStarted: 0, linkClicks: 0, landingPageViews: 0, hasData: false });

    // La ruta lead a lead solo se arma cuando alguien la pide (hoy, el
    // exportable a Excel): son todos los contactos del rango, no la muestra
    // acotada de `sampleContacts`, y engordaría la respuesta que consume la
    // vista de Campañas en cada refresco.
    const leadTrail = includeLeadTrail
      ? await this.#buildLeadTrail(contacts, campaigns, campaignByAd, { from, to })
      : undefined;

    return {
      generatedAt: new Date().toISOString(),
      range: { from, to },
      ...(leadTrail ? { leadTrail } : {}),
      kpis: {
        activeCampaigns: campaigns.filter((c) => c.status === 'activa').length,
        totalConversations: contacts.length,
        classifiedConversations: totalsClassified.conversations,
        unclassifiedConversations: unclassified.length,
        qualified: contacts.filter((c) => c.qualified).length,
        appointments: contacts.filter((c) => c.hasAppointment).length,
        won: contacts.filter((c) => c.won).length,
        noFirstResponse: contacts.filter((c) => !c.responded).length,
        attended: contacts.filter((c) => c.meetingAttendance === 'asistio').length,
        appointmentsWithoutMeeting: contacts.filter((c) => c.appointmentWithoutMeeting).length,
        setterUnreviewed: contacts.filter((c) => c.setterQualified == null).length,
        totalSpend,
        totalQuotedValue: totalQuoted,
        // Las tres cifras separadas: lo ganado, lo solo pactado y lo cobrado.
        // Juntas en un único "registrado" se leían como facturación cerrada.
        totalWonRevenue,
        totalPactedRevenue,
        totalCollectedRevenue: totalCollected,
        // Sobre lo COBRADO y verificado, no sobre lo cotizado (ver
        // `#summariseGroup()`).
        roas: totalSpend > 0 && totalCollected > 0
          ? Math.round((totalCollected / totalSpend) * 100) / 100 : null,
        quotedToSpend: totalSpend > 0 && totalQuoted > 0
          ? Math.round((totalQuoted / totalSpend) * 100) / 100 : null,
        costPerConversation: totalSpend > 0 && totalsClassified.conversations > 0
          ? Math.round((totalSpend / totalsClassified.conversations) * 100) / 100 : null,
        costPerAppointment: totalSpend > 0 && totalsClassified.appointments > 0
          ? Math.round((totalSpend / totalsClassified.appointments) * 100) / 100 : null,
        costPerWon: totalSpend > 0 && totalsClassified.won > 0
          ? Math.round((totalSpend / totalsClassified.won) * 100) / 100 : null,
        metaImpressions: metaTotals.hasData ? metaTotals.impressions : null,
        metaClicks: metaTotals.hasData ? metaTotals.clicks : null,
        metaReach: metaTotals.hasData ? metaTotals.reach : null,
        metaMessagingStarted: metaTotals.hasData ? metaTotals.messagingStarted : null,
        metaCtr: metaTotals.hasData && metaTotals.impressions > 0
          ? Math.round((metaTotals.clicks / metaTotals.impressions) * 10000) / 100 : null,
        metaLinkClicks: metaTotals.hasData ? metaTotals.linkClicks : null,
        metaLandingPageViews: metaTotals.hasData ? metaTotals.landingPageViews : null,
        metaLinkCtr: metaTotals.hasData && metaTotals.impressions > 0
          ? Math.round((metaTotals.linkClicks / metaTotals.impressions) * 10000) / 100 : null
      },
      meta: {
        syncedCampaigns: campaigns.filter((c) => c.source === 'meta').length,
        lastSyncedAt: campaigns
          .map((c) => c.last_synced_at)
          .filter(Boolean)
          .sort()
          .pop() || null
      },
      campaigns: campaignReports,
      unclassifiedAds: [...unclassifiedByAd.values()].sort((a, b) => b.conversations - a.conversations)
    };
  }
}
