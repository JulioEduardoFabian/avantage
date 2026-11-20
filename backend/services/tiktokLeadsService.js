import { db } from '../db/connection.js';
import {
  normalizeFieldKey,
  extractMetaLeadForm,
  formatCustomFieldsNote
} from './metaLeadFields.js';
import {
  ATTRIBUTION_METHODS,
  CONFLICT_REASONS,
  demoteLaunderedMarker,
  resolveMatch,
  writesAttribution
} from './attributionEvidence.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from './leadService.js';
import {
  BUCKETS,
  COMPARABILIDAD,
  classifySubmission,
  emptyBuckets,
  phoneKeyOf
} from './reconciliationBuckets.js';
import {
  BRIDGE_SCHEMAS,
  MINIMUM_ACCESS,
  bridgeEnvelope,
  listCapNotice,
  pageCapNotice
} from './bridgeContract.js';

/**
 * Importación de los leads de **formulario instantáneo de TikTok** (TikTok
 * Lead Generation) al CRM.
 *
 * Es la hermana de `metaLeadReconciliationService.js`, y existe por el mismo
 * agujero visto desde el otro lado. En Meta el problema era que el webhook
 * perdía leads en silencio y la conciliación los iba a buscar; acá **no hay
 * webhook en absoluto**: los leads de TikTok se quedan en el Centro de
 * clientes potenciales de TikTok y el CRM nunca se entera de que existen. El
 * caso que destapó esto (30/10/2026): la campaña "TT | WA | Asesor | 27Oct"
 * marcaba 21 conversiones en el Ads Manager y la trazabilidad de Campañas
 * decía "todavía no hay contactos atribuidos a esta campaña".
 *
 * Tres decisiones que conviene no deshacer:
 *
 *  1. **Las respuestas se leen con el MISMO extractor que las de Meta**
 *     (`extractMetaLeadForm` en `metaLeadFields.js`). Las dos plataformas
 *     tienen exactamente el mismo problema —el nombre de cada pregunta no es
 *     estable, es el texto que escribió el equipo convertido a slug— y ahí ya
 *     están resueltas las reglas que costaron casos reales: la universidad se
 *     resuelve antes que el nombre ("¿cuál es el nombre de tu universidad?"),
 *     un documento nunca entra como celular aunque su pregunta diga "número",
 *     y una respuesta de 9 dígitos o más que no sea documento se toma como
 *     celular se llame como se llame la pregunta. Copiarlas acá sería tener
 *     dos extractores que, el día que alguien corrija uno, dirán cosas
 *     distintas según de qué plataforma venga el lead.
 *  2. **La importación es explícita, no automática.** Igual que el `POST` de
 *     la conciliación de Meta: traer leads agrega gente al funnel que el
 *     equipo va a trabajar y a repartir, así que no puede ser el efecto de
 *     abrir una pantalla. El `GET` solo reporta.
 *  3. **Un lead ya importado no se vuelve a dar de alta.** La llave es
 *     `leads.tiktok_lead_id` (más el marcador en las notas, para la ficha que
 *     se colgó de otra por teléfono), así que correr la importación dos veces
 *     no duplica a nadie.
 *
 * Lo que TikTok NO da, y por qué el flujo es tan raro: no existe un endpoint
 * que devuelva los leads de un formulario de una. Hay que pedir una **tarea
 * de descarga**, esperar a que TikTok la prepare y bajarse el archivo. Por eso
 * esto es un botón que tarda unos segundos y no una llamada más.
 */

/** Cuántas veces se le pregunta a TikTok si la descarga ya está lista. */
const TASK_POLL_ATTEMPTS = 20;
const TASK_POLL_INTERVAL_MS = 1500;

/** Tope de formularios que se recorren en una corrida. */
const MAX_FORMS = 100;

/*
 * `page/get/` topa el tamaño de página en 100 y rechaza cualquier cosa mayor
 * con "page_size: number must be most 100" — que es un error de VALIDACIÓN y
 * no de permisos, aunque leído rápido parezca lo segundo. El paginador que se
 * comparte con el servicio de anuncios usa 1000 por defecto, que es lo que
 * aceptan `campaign/get/`, `adgroup/get/` y `ad/get/`, así que acá hay que
 * pedir el propio.
 */
const FORMS_PAGE_SIZE = 100;

/*
 * Cómo se crea la tarea de descarga, en orden de probabilidad.
 *
 * El portal de documentación de TikTok es una aplicación JavaScript que no se
 * puede leer de forma programática, así que la ruta exacta no se pudo fijar de
 * antemano. Lo que sí se sabe es el patrón del resto de la familia —los
 * endpoints de lead de prueba son `page/lead/mock/create/` y
 * `page/lead/mock/delete/`, con el verbo como segmento propio— y lo que
 * contestó la cuenta real el 30/10/2026: `GET page/lead/task/` devolvió 405
 * ("existe, pero no por este método") y 404.
 *
 * Por eso se prueban las variantes en vez de adivinar una: la que funciona se
 * recuerda en la instancia, así que esto cuesta un intento la primera vez y
 * cero en todas las demás. Y si fallan todas, el error las lista con su
 * estado HTTP, que es lo que permite arreglarlo en una sola vuelta en vez de
 * seguir probando a ciegas.
 */
const TASK_CREATE_VARIANTS = [
  { path: 'page/lead/task/create/', method: 'POST' },
  { path: 'page/lead/task/', method: 'POST' },
  { path: 'page/lead/task/', method: 'GET' }
];

/**
 * Lo mismo para consultar si la tarea ya está lista.
 *
 * Contra la cuenta real (30/10/2026) **ninguna de estas existe**: la creación
 * por `POST page/lead/task/create/` sí funcionó, pero `check/` y la raíz
 * devolvieron 404/405. Se siguen probando porque una cuenta o una versión de
 * la API podrían tenerlas, y cuando ninguna responde NO se da por perdido el
 * formulario: se pasa a sondear la descarga, que es el camino que de verdad
 * importa (ver `#fetchLeadsForPage`). Un endpoint de estado es una comodidad;
 * el archivo es el objetivo.
 */
const TASK_CHECK_VARIANTS = [
  { path: 'page/lead/task/check/', method: 'GET' },
  { path: 'page/lead/task/get/', method: 'GET' },
  { path: 'page/lead/task/', method: 'GET' }
];

/** Cuántas veces se reintenta la descarga mientras TikTok la prepara. */
const DOWNLOAD_RETRY_ATTEMPTS = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
 * Códigos y frases con las que TikTok dice "este token no puede hacer esto".
 * Hacen falta porque el aviso de "falta el scope de Lead Generation" sólo
 * sirve si el error ES de permisos: colgado de cualquier fallo mandaba a
 * reautorizar la app por un `page_size` inválido (caso real del 30/10/2026),
 * que es el peor consejo posible — se pierde media hora rehaciendo el OAuth
 * para volver al mismo error.
 */
const PERMISSION_CODES = new Set([40001, 40002, 40100, 40102, 40105, 40110]);
const PERMISSION_TEXT_RE = /permission|permiso|not authoriz|unauthoriz|scope|access denied|no autoriz/i;

/**
 * ¿Este fallo es "la ruta no es esa" y no "la llamada estaba mal"?
 *
 * Solo 404 (no existe) y 405 (existe pero no por este método) justifican
 * probar la variante siguiente. Un error de permisos, de parámetros o de la
 * cuenta tiene que propagarse tal cual: reintentarlo contra otra ruta lo
 * convierte en un 404 engañoso y esconde el error que de verdad hay que leer.
 */
export function isRoutingError(error) {
  return error?.httpStatus === 404 || error?.httpStatus === 405;
}

export function looksLikePermissionError(error) {
  return PERMISSION_CODES.has(Number(error?.tiktokCode))
    || PERMISSION_TEXT_RE.test(String(error?.message || ''));
}

/**
 * Las columnas del archivo de leads que son METADATOS y no respuestas del
 * formulario. Se reconocen por patrón y no por su nombre exacto por la misma
 * razón que las preguntas: TikTok devuelve las cabeceras en el idioma de la
 * cuenta, así que "Fecha de creación" y "Create Time" son la misma columna.
 */
const META_COLUMNS = [
  ['leadId', /^(lead id|id del cliente potencial|id de cliente potencial)$/],
  ['createdTime', /^(create time|created time|createtime|submission time|fecha de creacion|hora de creacion|fecha de envio)$/],
  ['adId', /^(ad id|id del anuncio)$/],
  ['adgroupId', /^(adgroup id|ad group id|id del grupo de anuncios)$/],
  ['campaignId', /^(campaign id|id de la campana|id de campana)$/],
  ['pageId', /^(page id|id de la pagina|id del formulario)$/],
  /*
   * Los NOMBRES, que hasta ahora no se reconocían como metadatos: caían en las
   * respuestas del formulario y terminaban escritos en las notas de la ficha
   * como si la persona hubiera contestado "Nombre del anuncio: TT | WA |
   * Asesor". Son, además, el dato que le faltaba a la hoja de marketing: el
   * `ad_id` por sí solo no dice qué video se está mirando.
   */
  ['adName', /^(ad name|nombre del anuncio)$/],
  ['adgroupName', /^(adgroup name|ad group name|nombre del grupo de anuncios)$/],
  ['campaignName', /^(campaign name|nombre de la campana)$/],
  ['pageName', /^(page name|nombre de la pagina|nombre del formulario)$/],
  /*
   * La jerarquía de Smart+. No se sabe si esta cuenta las entrega —TikTok no
   * expone el nivel hijo hoy— pero las cabeceras se reconocen igual por dos
   * razones: el día que aparezcan se capturan solas, y mientras no aparezcan
   * NO caen en las respuestas del formulario, que es donde terminaban los
   * nombres del anuncio antes de reconocerlos (escritos en las notas de la
   * ficha como si la persona hubiera contestado "ID del video: 7412").
   *
   * Los tres son identificadores DISTINTOS: el anuncio compra el presupuesto,
   * la pieza es la combinación que armó TikTok, y el video es el archivo
   * subido. Un mismo video vive en varias piezas.
   */
  ['parentAdId', /^(parent ad id|smart ad id|id del anuncio padre|id del anuncio principal)$/],
  ['creativeId', /^(creative id|ad creative id|id de la creatividad|id del creativo)$/],
  ['videoId', /^(video id|material id|id del video|id del material)$/],
  ['videoName', /^(video name|material name|nombre del video|nombre del material)$/]
];

/** Qué metadato es esta cabecera, o null si es una pregunta del formulario. */
export function metaColumnFor(header) {
  const key = normalizeFieldKey(header);
  for (const [field, re] of META_COLUMNS) {
    if (re.test(key)) return field;
  }
  return null;
}

/**
 * Parser de CSV con comillas: TikTok entrega el archivo de leads como CSV y
 * una respuesta de texto libre puede traer comas, comillas y saltos de línea
 * dentro del campo. Partir por `split(',')` rompe justamente en el lead cuya
 * respuesta era interesante, así que se parsea de verdad.
 *
 * Devuelve filas como objetos `{ cabecera: valor }`, con la cabecera tal cual
 * vino (normalizarla es trabajo de quien la lee).
 */
export function parseLeadCsv(text) {
  const raw = String(text || '').replace(/^﻿/, '');
  if (!raw.trim()) return [];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (quoted) {
      if (ch === '"') {
        // Dos comillas seguidas dentro de un campo entrecomillado son una
        // comilla literal, no el final del campo.
        if (raw[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  if (!header) return [];

  return rows
    .filter((cells) => cells.some((c) => String(c).trim()))
    .map((cells) => {
      const obj = {};
      header.forEach((name, idx) => { obj[String(name).trim()] = String(cells[idx] ?? '').trim(); });
      return obj;
    });
}

/**
 * Una fila del archivo (o un objeto del JSON, que algunas cuentas devuelven en
 * vez del CSV) convertida a la forma que entiende `persistTikTokLead`.
 *
 * Todo lo que no es metadato se trata como respuesta del formulario y viaja
 * con la MISMA forma que el `field_data` de Meta (`{ name, values: [] }`),
 * que es lo que permite reusar el extractor de aquel lado sin adaptadores.
 */
export function leadFromRow(row, { pageId = null } = {}) {
  const out = {
    leadId: null, createdTime: null,
    adId: null, adgroupId: null, campaignId: null, pageId,
    adName: null, adgroupName: null, campaignName: null, pageName: null,
    fieldData: []
  };

  for (const [name, value] of Object.entries(row || {})) {
    const text = value == null ? '' : String(value).trim();
    const meta = metaColumnFor(name);
    if (meta) {
      // El `page_id` que viene en el archivo gana sobre el del formulario que
      // se estaba recorriendo: son el mismo dato, pero el del archivo es el
      // que TikTok afirma.
      if (text) out[meta] = text;
      continue;
    }
    if (!text) continue;
    out.fieldData.push({ name, values: [text] });
  }

  return out;
}

/**
 * La fecha que manda TikTok, en algo que `new Date()` entienda.
 *
 * Llega de tres formas según el endpoint y la cuenta: segundos de epoch,
 * milisegundos, o "2026-10-27 14:05:31" en el huso del anunciante. Esa última
 * la lee `Date` como hora LOCAL del servidor, que es lo que queremos: el
 * backend corre en el huso de Lima, el mismo de la cuenta.
 */
export function parseTikTokTime(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();

  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000);
  if (/^\d{13}$/.test(text)) return new Date(Number(text));

  const date = new Date(text.includes('T') ? text : text.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * La atribución de un envío de TikTok, con los nombres de campo que esperan
 * `attachTikTokLeadToExisting` y `createProspect`.
 *
 * Vive en un solo sitio porque la escriben los DOS caminos —el alta y la
 * conciliación que completa fichas— y es justo la clase de objeto que, copiado,
 * termina guardando un campo de más en uno y de menos en el otro: ahí las dos
 * mitades de la misma tabla dejan de ser comparables, que es exactamente lo que
 * esta importación existe para medir.
 *
 * Los nombres se copian tal como los manda TikTok y no se resuelven después
 * contra las métricas sincronizadas: ahí solo están los anuncios que siguen
 * entregando, así que un lead de un video pausado salía en la hoja de marketing
 * sin anuncio teniendo su `ad_id` guardado.
 */
export function atribucionDe(lead = {}) {
  return {
    leadId: lead.leadId ? String(lead.leadId) : null,
    pageId: lead.pageId || null,
    adId: lead.adId || null,
    adgroupId: lead.adgroupId || null,
    campaignId: lead.campaignId || null,
    adName: lead.adName || null,
    adgroupName: lead.adgroupName || null,
    campaignName: lead.campaignName || null,
    /*
     * La jerarquía de Smart+, si la descarga la trajo. Vacía es el caso normal
     * hoy y significa "la pieza es desconocida", que es un valor y no un hueco:
     * un reporte que lo muestra permite ir a buscar el acceso que falta, uno
     * que lo rellena con el video que más impresiones tuvo ese día no — y de
     * ese número cuelga cortar una pieza que quizá era la que vendía.
     */
    parentAdId: lead.parentAdId || null,
    creativeId: lead.creativeId || null,
    videoId: lead.videoId || null,
    videoName: lead.videoName || null
  };
}

/**
 * Anota un pendiente desde el camino de alta, que es una función de módulo y no
 * tiene el servicio a mano.
 *
 * Nunca puede tumbar la importación: traer los leads que faltan es el objetivo,
 * y perderlos porque la tabla de pendientes falló sería cambiar un problema por
 * uno peor.
 */
async function recordPersistConflict(conflicts, { leadId, reason, phone, candidates, payload }) {
  const ids = (candidates || []).map((c) => c?.id).filter(Boolean);

  if (!conflicts) {
    console.warn(`⚠️ [TikTok Leads] Lead ${leadId}: ${reason} (fichas ${ids.join(', ') || 'ninguna'}). `
      + 'La atribución NO se escribió y no hay dónde anotar el pendiente.');
    return;
  }

  try {
    await conflicts.record({
      platform: 'TikTok',
      platformLeadId: leadId,
      phoneKey: phoneMatchKey(phone),
      reason,
      candidateLeadIds: ids,
      payload
    });
  } catch (error) {
    console.error(`❌ [TikTok Leads] No se pudo anotar el pendiente del lead ${leadId}:`, error.message);
  }
}

/**
 * Da de alta (o cuelga de la ficha que ya existe) un lead de formulario de
 * TikTok. Es `persistMetaLead` para la otra plataforma y se mantiene como
 * **camino único**: la importación y cualquier cosa que venga después —un
 * webhook el día que TikTok lo ofrezca, una carga manual del CSV— tienen que
 * entrar por acá, o las dos mitades de la misma tabla dejan de ser
 * comparables.
 */
export async function persistTikTokLead(leadService, data, { conflicts = null } = {}) {
  const leadId = String(data.leadId || '');
  const form = extractMetaLeadForm(data.fieldData);

  /*
   * El marcador se escribe en las notas aunque el `lead_id` ya tenga su propia
   * columna: es lo que hace legible la ficha para el equipo (el mismo estilo
   * que el `[Meta leadgen_id=...]`) y lo que permite reconocer estos leads si
   * alguna vez hay que rehacer la columna.
   */
  const notesParts = [`[TikTok lead_id=${leadId}] page_id=${data.pageId || 'desconocido'}`];
  const customNote = formatCustomFieldsNote(form);
  if (customNote) notesParts.push(customNote);

  const phone = form.phone || '';
  if (!phone) {
    // Mismo aviso que en Meta y por lo mismo: un lead de formulario sin
    // celular no se puede llamar ni cruzar contra la ficha que ya exista, así
    // que queda escrito qué preguntas SÍ vinieron — es con lo que se corrige
    // el formulario (o el extractor) sin reproducir el caso.
    const keys = (data.fieldData || []).map((item) => item.name).join(', ') || 'ninguna';
    console.warn(`⚠️ [TikTok Leads] El lead ${leadId} llegó sin celular. Preguntas recibidas: ${keys}`);
  }

  const atribucion = { ...atribucionDe({ ...data, leadId }), createdTime: data.createdTime || null };

  /*
   * Una persona es un lead, no uno por cada formulario que llena. Acá pesa
   * todavía más que en Meta: estas campañas corren a la vez que las de Meta
   * sobre el mismo público, así que el contacto que ya escribió por WhatsApp
   * y además llenó el formulario de TikTok es el caso normal.
   *
   * Pero reconocer a la persona y acreditarle el anuncio son dos preguntas
   * distintas, y el teléfono solo contesta la primera. Por eso se pide primero
   * el `lead_id` —evidencia que emitió TikTok para este envío— y las candidatas
   * por teléfono se piden TODAS: con más de una no hay nada que elegir, hay un
   * caso que resolver (ver `attributionEvidence.js`).
   */
  const porId = leadId ? await leadService.findByTikTokLeadId(leadId) : null;
  const porTelefono = (!porId && phone) ? await leadService.findAllByPhone(phone) : [];
  const match = resolveMatch({ byPlatformLeadId: porId, phoneCandidates: porTelefono });
  const method = demoteLaunderedMarker(match.method, match.lead);

  if (match.ambiguous) {
    /*
     * Dos fichas con el mismo sufijo de teléfono pueden ser dos personas. No se
     * elige ninguna y tampoco se abre una tercera: la persona ya está en el
     * funnel —por eso hay fichas que coinciden— así que lo único pendiente es
     * de qué anuncio salió, y eso queda anotado con las candidatas y con los
     * datos del envío, que es lo que hace falta para decidirlo después (TikTok
     * conserva los leads de un formulario solo 90 días).
     */
    await recordPersistConflict(conflicts, {
      leadId,
      reason: CONFLICT_REASONS.multiplePhoneMatch,
      phone,
      candidates: match.candidates,
      payload: { ...atribucion, form }
    });
    return { lead: null, created: false, pendiente: true };
  }

  if (match.lead) {
    const lead = await leadService.attachTikTokLeadToExisting(match.lead, {
      ...atribucion,
      note: notesParts.join('\n'),
      method
    });

    /*
     * Con el teléfono como única evidencia el envío queda colgado de la ficha
     * —el marcador en las notas— y su atribución NO escrita. Es la diferencia
     * entre "esta persona también llenó un formulario de TikTok" y "esta
     * persona vino de TikTok": lo segundo decide presupuesto.
     */
    if (!writesAttribution(method)) {
      await recordPersistConflict(conflicts, {
        leadId,
        reason: CONFLICT_REASONS.phoneOnlyMatch,
        phone,
        candidates: [match.lead],
        payload: { ...atribucion, form }
      });
      return { lead, created: false, pendiente: true };
    }

    return { lead, created: false, pendiente: false };
  }

  const lead = await leadService.createProspect({
    fullName: form.fullName || 'Prospecto de TikTok',
    email: form.email || '',
    phone,
    dni: form.dni,
    source: 'TikTok Ads',
    academicLevel: form.academicLevel,
    university: form.university,
    fieldOfStudy: form.fieldOfStudy,
    // Igual que el de Meta: esta persona llenó un formulario pero todavía no
    // habló con nadie, así que arranca en el Setter Funnel y no "gradúa" al
    // Funnel de Ventas.
    status: 'conversacion_abierta',
    additionalNotes: notesParts.join('\n'),
    tiktokLeadId: atribucion.leadId,
    tiktokPageId: atribucion.pageId,
    tiktokAdId: atribucion.adId,
    tiktokAdgroupId: atribucion.adgroupId,
    tiktokCampaignId: atribucion.campaignId,
    tiktokAdName: atribucion.adName,
    tiktokAdgroupName: atribucion.adgroupName,
    tiktokCampaignName: atribucion.campaignName,
    tiktokParentAdId: atribucion.parentAdId,
    tiktokCreativeId: atribucion.creativeId,
    tiktokVideoId: atribucion.videoId,
    tiktokVideoName: atribucion.videoName,
    tiktokCreatedTime: atribucion.createdTime
  });

  return { lead, created: true, pendiente: false };
}

/** Las columnas que esta importación escribe, para saber si cambió algo. */
const TIKTOK_ATTRIBUTION_COLUMNS = [
  'tiktok_lead_id', 'tiktok_page_id', 'tiktok_ad_id', 'tiktok_adgroup_id', 'tiktok_campaign_id',
  'tiktok_ad_name', 'tiktok_adgroup_name', 'tiktok_campaign_name', 'tiktok_created_time',
  // La jerarquía de Smart+ entra en la comparación: una corrida que completa
  // solo la pieza creativa SÍ arregló algo, y sin esto el reporte diría que no
  // cambió nada.
  'tiktok_parent_ad_id', 'tiktok_creative_id', 'tiktok_video_id', 'tiktok_video_name'
];

export class TikTokLeadsService {
  /**
   * @param {object} deps
   * @param {import('./tiktokAdsService.js').TikTokAdsService} deps.ads servicio
   *   de TikTok Ads: aporta el token, la versión de la API, el anunciante y el
   *   tratamiento de los errores que TikTok devuelve dentro de un HTTP 200.
   * @param {object} deps.leadService
   */
  constructor({ ads, leadService, conflicts = null, fetchImpl } = {}) {
    this.ads = ads;
    this.leadService = leadService;
    /*
     * Dónde se anotan los emparejamientos que no se pudieron resolver. Es
     * opcional para no romper a los tests que construyen el servicio con lo
     * mínimo, pero sin él un caso ambiguo se descarta en silencio — y un
     * lead descartado en silencio es lo que esto vino a terminar.
     */
    this.conflicts = conflicts;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  }

  /** Base de la API, la misma versión que usa el servicio de anuncios. */
  get apiBase() {
    return `https://business-api.tiktok.com/open_api/${process.env.TIKTOK_API_VERSION || 'v1.3'}`;
  }

  /**
   * Los formularios instantáneos de la cuenta.
   *
   * Si TikTok no deja listarlos —el permiso de Lead Generation es propio y el
   * token puede no tenerlo— se cae a los `page_id` que ya figuran en el CRM,
   * exactamente como hace la conciliación de Meta cuando le falta
   * `pages_manage_ads`: con eso se pueden seguir trayendo leads de los
   * formularios conocidos, que es lo que de verdad hace falta. Un formulario
   * que nunca entregó un lead queda fuera, y el aviso lo dice.
   */
  async listForms(advertiserId) {
    try {
      /*
       * El aviso de recorte se recoge acá y viaja al reporte: una cuenta con
       * más formularios que el tope de páginas del paginador dejaba fuera los
       * últimos sin que nada lo dijera, y sus leads no figuraban ni como
       * presentes ni como faltantes.
       */
      const recortes = [];
      const list = await this.ads.apiPaged('page/get/', {
        advertiser_id: advertiserId,
        business_type: 'LEAD_GEN',
        page_size: FORMS_PAGE_SIZE
      }, {
        onTruncate: ({ paginasLeidas, paginasTotales, tope }) => {
          const aviso = pageCapNotice({
            que: 'Formularios instantáneos de TikTok',
            paginasLeidas,
            paginasTotales,
            tope
          });
          if (aviso) recortes.push(aviso);
        }
      });
      const forms = list.map((page) => ({
        id: String(page.page_id ?? page.id ?? ''),
        name: page.title || page.page_name || page.name || null,
        status: page.status || page.page_status || null
      })).filter((f) => f.id);

      if (forms.length) return { forms, source: 'tiktok', aviso: null, recortes };
      return {
        forms,
        source: 'tiktok',
        aviso: 'La cuenta no tiene ningún formulario instantáneo (Instant Page) de generación de leads.',
        recortes
      };
    } catch (error) {
      const known = await this.#knownPageIds();
      if (!known.length) {
        // El consejo sólo se da cuando corresponde: ver `looksLikePermissionError`.
        const pista = looksLikePermissionError(error)
          ? ' La app necesita el scope de Lead Generation y hay que volver a autorizarla para emitir un token nuevo (README > "Traer los leads de los formularios instantáneos de TikTok").'
          : '';
        const e = new Error(`No se pudieron listar los formularios instantáneos de TikTok: ${error.message}.${pista}`);
        e.code = error.code || 'TIKTOK_PAGES_UNAVAILABLE';
        e.tiktokCode = error.tiktokCode || null;
        throw e;
      }
      console.warn(`⚠️ [TikTok Leads] No se pudieron listar los formularios (${error.message}). Se usan los ${known.length} que ya figuran en la base.`);
      return {
        forms: known.map((id) => ({ id, name: null, status: null })),
        source: 'crm',
        aviso: `No se pudieron listar los formularios desde TikTok (${error.message}). Se compararon los ${known.length} que ya tienen al menos un lead en el CRM; un formulario que nunca entregó ninguno queda fuera. Hace falta el permiso de Lead Generation en el token para cubrirlos todos.`
      };
    }
  }

  /**
   * Las fichas que ya existen para los teléfonos de un lote de envíos,
   * indexadas por los últimos 9 dígitos.
   *
   * Una consulta para todo el lote y no una por envío, por la misma razón que
   * el resto del sistema: esto corre sobre cien formularios en el barrido
   * diario. Se queda con la ficha **más antigua** de cada teléfono porque la
   * pregunta es "¿esta persona ya estaba?", y la respuesta la da la primera
   * vez que entró, no la última.
   */
  async #existingByPhoneKey(leads) {
    const keys = [...new Set(
      (leads || [])
        .map((lead) => phoneKeyOf(extractMetaLeadForm(lead.fieldData).phone))
        .filter(Boolean)
    )];
    if (!keys.length) return new Map();

    const rows = await db('leads')
      .select('id', 'created_at', 'phone')
      .whereRaw(`${PHONE_MATCH_KEY_SQL} IN (${keys.map(() => '?').join(', ')})`, keys)
      .orderBy('created_at', 'asc');

    const out = new Map();
    for (const row of rows) {
      const key = phoneKeyOf(row.phone);
      if (key && !out.has(key)) out.set(key, row);
    }
    return out;
  }

  /**
   * La misma descarga que usa la importación, expuesta para diagnosticar.
   *
   * Existe porque la pregunta "¿qué nivel de la jerarquía trae la descarga?"
   * no se puede contestar leyendo el código —depende de la cuenta y de la
   * versión de la API— y la alternativa era hacer pública la privada o
   * copiarla en el script, que es como se llega a que el diagnóstico pruebe
   * un camino distinto del que corre en producción.
   *
   * Solo LEE: devuelve las filas tal como vienen y no da de alta nada.
   */
  async fetchLeadsForDiagnosis(pageId, advertiserId, { from = null, to = null } = {}) {
    return this.#fetchLeadsForPage(advertiserId, pageId, { from, to });
  }

  /** Los `page_id` que ya tienen al menos un lead en el CRM. */
  async #knownPageIds() {
    const rows = await db('leads')
      .distinct('tiktok_page_id')
      .whereNotNull('tiktok_page_id')
      .andWhere('tiktok_page_id', '!=', '');
    return rows.map((row) => String(row.tiktok_page_id));
  }

  /**
   * Los leads de un formulario en una ventana de fechas.
   *
   * TikTok no los devuelve de una: hay que pedir una tarea de descarga,
   * esperar a que la prepare y recién entonces bajar el archivo. Los tres
   * pasos viven juntos acá para que el resto del servicio no tenga que saber
   * nada de eso.
   */
  async #fetchLeadsForPage(advertiserId, pageId, { from, to }) {
    const params = { advertiser_id: advertiserId, page_id: pageId };
    if (from) params.start_time = from;
    if (to) params.end_time = to;

    const created = await this.#callVariant('create', TASK_CREATE_VARIANTS, params, pageId);
    const taskId = created?.task_id ?? created?.taskId ?? created?.id;
    if (!taskId) {
      /*
       * Los NOMBRES de los campos que vinieron, nunca sus valores: en esta
       * respuesta puede venir el dato de una persona, y el mensaje de error
       * termina en la pantalla y en el log. Con los nombres alcanza para saber
       * qué devuelve de verdad este endpoint.
       */
      const campos = Object.keys(created || {}).join(', ') || 'ninguno';
      throw new Error(`TikTok aceptó crear la tarea del formulario ${pageId} pero no devolvió su identificador. Campos recibidos: ${campos}.`);
    }

    /*
     * La tarea tarda. Se pregunta por ella hasta `TASK_POLL_ATTEMPTS` veces y
     * se abandona con un error claro en vez de quedarse colgado: el botón que
     * dispara esto es sincrónico y del otro lado hay alguien esperando.
     */
    let state = String(created?.status ?? created?.state ?? '').toUpperCase();
    for (let attempt = 0; attempt < TASK_POLL_ATTEMPTS && !isTaskReady(state); attempt++) {
      await sleep(TASK_POLL_INTERVAL_MS);

      const check = await this.#checkTask(advertiserId, taskId, pageId);
      /*
       * `null` = esta cuenta no tiene endpoint de estado (es lo que pasa hoy:
       * la creación funciona y `check/` no existe). No es motivo para dar el
       * formulario por perdido: se pasa a sondear la descarga, que es lo que
       * de verdad se vino a buscar. Un endpoint de estado es una comodidad, el
       * archivo es el objetivo.
       */
      if (check === null) break;

      state = String(check?.status ?? check?.state ?? '').toUpperCase();
      if (state === 'FAILED' || state === 'FAIL') {
        throw new Error(`TikTok no pudo preparar la descarga de leads del formulario ${pageId}.`);
      }
    }

    return this.#downloadTask(advertiserId, taskId, pageId);
  }

  /**
   * El estado de la tarea, o `null` si esta cuenta no expone ningún endpoint
   * para consultarlo.
   *
   * Devolver `null` en vez de lanzar es la diferencia entre "no pudimos
   * preguntar cómo va" y "no se pueden traer los leads", que son cosas muy
   * distintas: lo primero se resuelve esperando y bajando igual.
   */
  async #checkTask(advertiserId, taskId, pageId) {
    // Una vez que se supo que no hay endpoint de estado, no se vuelve a
    // probar: con varios formularios serían tres llamadas fallidas por cada
    // uno, y la respuesta ya se sabe.
    if (this._sinEndpointDeEstado) return null;

    try {
      return await this.#callVariant(
        'check', TASK_CHECK_VARIANTS, { advertiser_id: advertiserId, task_id: taskId }, pageId
      );
    } catch (error) {
      if (error.code === 'TIKTOK_LEAD_TASK_UNAVAILABLE') {
        this._sinEndpointDeEstado = true;
        console.warn('⚠️ [TikTok Leads] Esta cuenta no expone un endpoint de estado de la tarea; se sondea la descarga directamente.');
        return null;
      }
      throw error;
    }
  }

  /**
   * Llama al primer endpoint de la lista que funcione y se queda con él.
   *
   * La ruta exacta de estos dos endpoints no se pudo fijar leyendo la
   * documentación (ver `TASK_CREATE_VARIANTS`), así que se prueban en orden.
   * Dos cuidados:
   *
   *  - Solo se pasa a la variante siguiente cuando el fallo es de RUTA (404 o
   *    405, o sea "no existe" / "no por este método"). Un error de permisos,
   *    de parámetros o de la propia cuenta se propaga tal cual: reintentarlo
   *    contra otra ruta lo convertiría en un 404 engañoso y escondería el
   *    error que de verdad hay que leer.
   *  - La que funciona se recuerda, así que el precio de esto es un intento
   *    fallido la primera vez y nada en los formularios siguientes.
   */
  async #callVariant(kind, variants, params, pageId) {
    this._endpoint ??= {};
    const lista = this._endpoint[kind] ? [this._endpoint[kind]] : variants;
    const fallos = [];

    for (const variant of lista) {
      try {
        const data = variant.method === 'POST'
          ? await this.ads.apiPost(variant.path, params)
          : await this.ads.api(variant.path, params);
        this._endpoint[kind] = variant;
        return data;
      } catch (error) {
        fallos.push(`${variant.method} ${variant.path} → ${error.message}`);
        if (!isRoutingError(error)) throw error;
      }
    }

    const e = new Error(`Ninguna ruta de descarga de leads respondió para el formulario ${pageId}. Intentos: ${fallos.join(' | ')}`);
    e.code = 'TIKTOK_LEAD_TASK_UNAVAILABLE';
    throw e;
  }

  /**
   * Baja el archivo de la tarea ya preparada.
   *
   * No pasa por `ads.api()` porque esta respuesta NO es el JSON `{code, data}`
   * del resto de la API: es el archivo. Aun así hay cuentas que devuelven el
   * JSON con la lista adentro, así que se admiten las dos formas — leer el
   * cuerpo una sola vez como texto y decidir después es más barato que
   * adivinar por el Content-Type, que TikTok no siempre manda.
   */
  async #downloadTask(advertiserId, taskId, pageId) {
    let ultimo = null;

    /*
     * Se reintenta porque, sin endpoint de estado, la única forma de saber que
     * la tarea ya está lista es pedir el archivo. TikTok contesta con un error
     * mientras la prepara, así que un solo intento devolvería vacío justo
     * cuando hay leads.
     */
    for (let intento = 0; intento < DOWNLOAD_RETRY_ATTEMPTS; intento++) {
      if (intento > 0) await sleep(TASK_POLL_INTERVAL_MS);

      const search = new URLSearchParams({ advertiser_id: String(advertiserId), task_id: String(taskId) });
      const res = await this.fetch(`${this.apiBase}/page/lead/task/download/?${search.toString()}`, {
        headers: { 'Access-Token': this.ads.accessToken }
      });
      const text = await res.text();

      /*
       * 404/405 es la RUTA, no la tarea: reintentarlo treinta segundos no la
       * va a hacer aparecer. Se corta en el acto y el mensaje lo dice, que es
       * lo que permite arreglarlo en una vuelta.
       */
      if (res.status === 404 || res.status === 405) {
        const e = new Error(`La ruta de descarga de leads no existe en esta cuenta: GET page/lead/task/download/ → HTTP ${res.status}.`);
        e.httpStatus = res.status;
        throw e;
      }

      if (res.ok && !text.trim().startsWith('{')) {
        /*
         * El archivo. Sin la comprobación de `res.ok` de arriba, una página de
         * error HTML se le pasaba al parser de CSV —que no falla: devuelve
         * filas de basura—, o sea leads inventados a partir de un error.
         */
        return parseLeadCsv(text).map((row) => leadFromRow(row, { pageId }));
      }

      let json = {};
      try { json = JSON.parse(text); } catch { json = {}; }

      if (res.ok && (json.code === 0 || json.code === undefined)) {
        const list = json.data?.list || json.data?.leads || [];
        return list.map((item) => leadFromRow(flattenJsonLead(item), { pageId }));
      }

      ultimo = json.message || `HTTP ${res.status}`;
      // Cualquier otra cosa se lee como "todavía no está lista" y se reintenta.
    }

    throw new Error(`La descarga de leads del formulario ${pageId} no estuvo lista a tiempo (último aviso de TikTok: ${ultimo || 'sin detalle'}). Volvé a intentarlo en un minuto; la tarea sigue preparándose del lado de TikTok.`);
  }

  /**
   * Le escribe a una ficha que ya existe la atribución de TikTok que le falte
   * —**si** hay con qué respaldarla—.
   *
   * Acá vivía el error que destapó todo esto. La ficha se buscaba por el
   * `lead_id` de TikTok y, si no aparecía, por los **últimos 9 dígitos del
   * teléfono**; con eso bastaba para escribirle campaña, grupo y anuncio. Como
   * `leadOrigin()` preguntaba por las columnas `tiktok_*` antes que por las
   * demás, esa ficha pasaba a ser "TikTok" en todas las hojas de marketing y
   * tapaba su origen real. Y lo hacía sola: la conciliación diaria corre con
   * `apply: true`.
   *
   * Ahora el teléfono alcanza para **colgar el envío** de la ficha (una persona
   * es un lead, no uno por cada formulario que llena) y no para **atribuirlo**.
   * Los tres desenlaces, y ninguno escribe una campaña que no se pueda
   * respaldar:
   *
   *  - evidencia independiente (el `lead_id` o su marcador): se atribuye;
   *  - un solo candidato por teléfono: se marca la ficha, se anota el pendiente
   *    y la atribución queda sin escribir;
   *  - varios candidatos: no se toca ninguna ficha y se anota el pendiente con
   *    todas las candidatas, que es lo que una persona necesita para decidir.
   *
   * Devuelve `{ completado, pendiente }` en vez de un booleano porque el
   * reporte tiene que poder decir las dos cosas: un pendiente no es un lead
   * arreglado, pero tampoco es un lead que no pasó nada.
   */
  async #completeAttribution(lead) {
    const form = extractMetaLeadForm(lead.fieldData);
    const porId = await this.leadService.findByTikTokLeadId(lead.leadId);

    /*
     * Las candidatas por teléfono se piden TODAS y no la que gana el desempate:
     * quedarse con la primera es la asignación arbitraria que esto evita. Solo
     * se pregunta si el id no resolvió nada, para no gastar la consulta en el
     * camino bueno, que es el normal.
     */
    const porTelefono = (!porId && form.phone)
      ? await this.leadService.findAllByPhone(form.phone)
      : [];

    const match = resolveMatch({ byPlatformLeadId: porId, phoneCandidates: porTelefono });
    /*
     * El marcador de las notas vale lo que valió la evidencia que lo escribió:
     * si una corrida anterior colgó este envío por teléfono, encontrarlo hoy
     * por su marcador no lo vuelve evidencia fuerte (ver
     * `demoteLaunderedMarker`).
     */
    const method = demoteLaunderedMarker(match.method, match.lead);
    // El payload lleva además las respuestas del formulario: quien resuelva
    // el pendiente las necesita, y TikTok conserva los leads de un formulario
    // solo 90 días — pasado ese plazo ya no hay a quién volver a pedírselas.
    const payload = { ...atribucionDe(lead), form };

    if (match.ambiguous) {
      await this.#recordConflict(lead, {
        reason: CONFLICT_REASONS.multiplePhoneMatch,
        phone: form.phone,
        candidates: match.candidates,
        payload
      });
      return { completado: false, pendiente: true };
    }

    if (!match.lead) return { completado: false, pendiente: false };

    const antes = await this.leadService.getLeadById(match.lead.id);
    await this.leadService.attachTikTokLeadToExisting(match.lead, {
      ...payload,
      createdTime: parseTikTokTime(lead.createdTime),
      // El marcador ya está escrito en la ficha; repetirlo solo ensuciaría
      // las notas.
      note: null,
      method
    });
    const despues = await this.leadService.getLeadById(match.lead.id);

    if (!writesAttribution(method)) {
      await this.#recordConflict(lead, {
        reason: CONFLICT_REASONS.phoneOnlyMatch,
        phone: form.phone,
        candidates: [match.lead],
        payload
      });
      return { completado: false, pendiente: true };
    }

    const completado = TIKTOK_ATTRIBUTION_COLUMNS
      .some((col) => String(antes?.[col] ?? '') !== String(despues?.[col] ?? ''));
    return { completado, pendiente: false };
  }

  /**
   * Anota un emparejamiento sin resolver.
   *
   * Nunca puede tumbar la corrida: traer los leads que faltan es el objetivo, y
   * perderlos porque la tabla de pendientes falló sería cambiar un problema por
   * uno peor. Sin servicio de conflictos queda el aviso en el log, que es lo
   * único que hay cuando el servicio no está inyectado (los tests).
   */
  async #recordConflict(lead, { reason, phone, candidates, payload }) {
    const ids = (candidates || []).map((c) => c?.id).filter(Boolean);
    if (!this.conflicts) {
      console.warn(`⚠️ [TikTok Leads] Lead ${lead.leadId}: ${reason} (fichas ${ids.join(', ') || 'ninguna'}). `
        + 'La atribución NO se escribió y no hay dónde anotar el pendiente.');
      return;
    }

    try {
      await this.conflicts.record({
        platform: 'TikTok',
        platformLeadId: lead.leadId,
        phoneKey: phoneMatchKey(phone),
        reason,
        candidateLeadIds: ids,
        payload
      });
    } catch (error) {
      console.error(`❌ [TikTok Leads] No se pudo anotar el pendiente del lead ${lead.leadId}:`, error.message);
    }
  }

  /**
   * Compara lo que TikTok tiene contra lo que llegó al CRM y, si `apply`,
   * importa lo que falta.
   *
   * Mismo contrato que la conciliación de Meta a propósito: el `GET` de la
   * ruta llama con `apply: false` y solo reporta; el `POST`, con `apply: true`.
   */
  async run({ from = null, to = null, apply = false } = {}) {
    const advertiser = await this.ads.resolveAdvertiser();
    const { forms, source, aviso, recortes = [] } = await this.listForms(advertiser.id);

    /*
     * Los formularios que de verdad se van a recorrer, y el aviso si quedaron
     * afuera. `forms.slice(0, MAX_FORMS)` recortaba en silencio: en una cuenta
     * con más de cien formularios, los que sobraban no se comparaban contra
     * nada y sus leads no figuraban ni como presentes ni como faltantes — una
     * comparación recortada que devolvía un resultado con pinta de completo.
     */
    const revisados = forms.slice(0, MAX_FORMS);
    const avisos = [
      ...recortes,
      listCapNotice({
        que: 'Formularios instantáneos revisados',
        revisados: revisados.length,
        totales: forms.length,
        tope: MAX_FORMS
      })
    ].filter(Boolean);

    const known = await this.leadService.getKnownTikTokLeadIds();

    const report = {
      advertiser_id: advertiser.id,
      origen_formularios: source,
      aviso,
      aplicado: apply,
      ventana: { from, to },
      totals: {
        en_tiktok: 0, en_crm: 0, faltantes: 0, importados: 0, adjuntados: 0, fallidos: 0,
        sin_anuncio: 0,
        // Fichas que ya estaban en el CRM y a las que esta corrida les
        // completó la atribución que les faltaba (ver más abajo).
        completados: 0,
        /*
         * Envíos que no se pudieron atribuir con evidencia independiente y
         * quedaron anotados en `attribution_conflicts` para que los resuelva
         * una persona. Se cuentan aparte de `fallidos` a propósito: no falló
         * nada, falta decidir — y mezclarlos haría que un pendiente se lea
         * como un error del que no hay que hacer nada.
         */
        pendientes: 0,
        /*
         * Los cinco cajones de los envíos del corte (ver
         * `reconciliationBuckets.js`). Sin ellos, "faltan 37" podía ser 37
         * leads perdidos o 12 duplicados + 9 reingresos + 6 formularios sin un
         * dato de contacto + 10 entregados tarde — y tres de esos cinco no se
         * arreglan, están bien así. Su suma es el total de envíos, que es lo
         * único que permite afirmar que la comparación cerró.
         */
        cajones: emptyBuckets()
      },
      /*
       * Qué universo cuenta cada cifra, escrito en la respuesta y no solo en un
       * comentario del código: el error que evita se comete leyendo la
       * pantalla, exigiendo que el CRM dé el mismo número que la columna de
       * «conversiones» del Ads Manager, que no cuenta envíos de formulario.
       */
      comparabilidad: COMPARABILIDAD,
      /*
       * El sobre del puente: cuántos formularios hay, cuántos se revisaron, con
       * qué límites y si algo quedó fuera. Un consumidor automático tiene que
       * poder contestar "¿me falta algo?" sin leer este archivo.
       */
      ...bridgeEnvelope({
        esquema: BRIDGE_SCHEMAS.tiktokLeads,
        totalFilas: forms.length,
        filas: revisados.length,
        limites: {
          formularios_max: MAX_FORMS,
          formularios_por_pagina: FORMS_PAGE_SIZE,
          intentos_estado_tarea: TASK_POLL_ATTEMPTS,
          intentos_descarga: DOWNLOAD_RETRY_ATTEMPTS
        },
        avisos
      }),
      /*
       * El acceso mínimo que hace falta y qué deja de funcionar sin él. Va en la
       * respuesta porque el reflejo ante un 403 de una API de anuncios es pedir
       * todos los permisos y reautorizar, y eso amplía el alcance del token a
       * ciegas (ver `MINIMUM_ACCESS`).
       */
      acceso_minimo: MINIMUM_ACCESS,
      forms: [],
      errores: []
    };

    /*
     * Los dos conjuntos son de la CORRIDA y no del formulario: un mismo envío
     * puede venir en dos formularios, y la misma persona puede haber llenado
     * dos. Reiniciarlos por formulario contaría ese repetido como nuevo en el
     * segundo.
     */
    const seenLeadIds = new Set();
    const seenPhoneKeys = new Set();
    const windowStart = from ? new Date(`${from}T00:00:00-05:00`) : null;

    for (const form of revisados) {
      const row = {
        page_id: form.id,
        nombre: form.name,
        estado: form.status,
        en_tiktok: 0,
        en_crm: 0,
        faltantes: 0,
        importados: 0,
        adjuntados: 0,
        completados: 0,
        pendientes: 0,
        fallidos: 0,
        cajones: emptyBuckets(),
        ejemplos_faltantes: []
      };

      let leads = [];
      try {
        leads = await this.#fetchLeadsForPage(advertiser.id, form.id, { from, to });
      } catch (error) {
        // Un formulario que falla no puede tumbar la corrida: los otros
        // todavía pueden traer sus leads, que es para lo que se aprieta el
        // botón. El error viaja en el reporte.
        report.errores.push({ page_id: form.id, error: error.message });
        console.error(`❌ [TikTok Leads] Formulario ${form.id}:`, error.message);
        report.forms.push(row);
        continue;
      }

      /*
       * Las fichas que ya existen para los teléfonos de ESTE formulario, en UNA
       * consulta y no una por envío. Hace falta para distinguir al reingreso
       * —la persona que ya estaba antes del corte y volvió a llenar el
       * formulario— del lead nuevo, que es la diferencia que explica por qué el
       * total de la plataforma es legítimamente mayor que el de altas del CRM.
       */
      const fichasPorTelefono = await this.#existingByPhoneKey(leads);

      for (const lead of leads) {
        if (!lead.leadId) continue;
        row.en_tiktok++;
        report.totals.en_tiktok++;

        const respuestas = extractMetaLeadForm(lead.fieldData);
        const phoneKey = phoneKeyOf(respuestas.phone);
        const cajon = classifySubmission(
          {
            platformLeadId: lead.leadId,
            phone: respuestas.phone,
            email: respuestas.email,
            createdTime: parseTikTokTime(lead.createdTime)
          },
          {
            windowStart,
            seenLeadIds,
            seenPhoneKeys,
            existingLead: phoneKey ? fichasPorTelefono.get(phoneKey) || null : null
          }
        );
        row.cajones[cajon]++;
        report.totals.cajones[cajon]++;
        seenLeadIds.add(String(lead.leadId));
        if (phoneKey) seenPhoneKeys.add(phoneKey);

        /*
         * Un envío que la plataforma devolvió dos veces no se procesa dos veces.
         * Antes esto lo cubría a medias `known`, que solo conoce lo que ya está
         * en el CRM: dos formularios que comparten un envío nuevo lo daban de
         * alta y después lo adjuntaban, contando una persona como dos.
         */
        if (cajon === BUCKETS.duplicado) continue;

        if (known.has(String(lead.leadId))) {
          row.en_crm++;
          report.totals.en_crm++;

          /*
           * Está en el CRM, pero puede estar a medias: los 21 leads que se
           * importaron entre el 27 y el 31/10/2026 entraron con los ids de
           * atribución y SIN los nombres (el importador los descartaba como
           * si fueran respuestas del formulario), así que en la hoja de
           * marketing salían con el anuncio en blanco. Completarlos es parte
           * de conciliar: traer solo lo que falta por entero dejaría a medio
           * arreglar justo lo que se vino a arreglar. Solo se escriben los
           * huecos — `attachTikTokLeadToExisting()` nunca pisa lo que ya está.
           */
          if (apply) {
            try {
              const { completado, pendiente } = await this.#completeAttribution(lead);
              if (completado) {
                row.completados++;
                report.totals.completados++;
              }
              if (pendiente) {
                row.pendientes++;
                report.totals.pendientes++;
              }
            } catch (error) {
              report.errores.push({ page_id: form.id, lead_id: lead.leadId, error: error.message });
              console.error(`❌ [TikTok Leads] No se pudo completar el lead ${lead.leadId}:`, error.message);
            }
          }
          continue;
        }

        row.faltantes++;
        report.totals.faltantes++;
        if (row.ejemplos_faltantes.length < 5) {
          row.ejemplos_faltantes.push({ lead_id: lead.leadId, created_time: lead.createdTime || null });
        }
        // Un lead sin `ad_id` entra igual al CRM pero no se puede acreditar a
        // ninguna campaña: se cuenta aparte para que el reporte no dé por
        // cerrada una comparación que no cerró (misma regla que `sin_anuncio`
        // en la conciliación de Meta).
        if (!lead.adId) report.totals.sin_anuncio++;

        if (!apply) continue;

        try {
          const { lead: prospect, created, pendiente } = await persistTikTokLead(this.leadService, {
            ...lead,
            createdTime: parseTikTokTime(lead.createdTime)
          }, { conflicts: this.conflicts });
          if (pendiente) {
            row.pendientes++;
            report.totals.pendientes++;
          }
          // Conocido en el acto: si el mismo lead_id volviera a aparecer en
          // esta misma corrida (dos formularios que lo comparten), no se
          // duplica.
          known.add(String(lead.leadId));

          /*
           * Sin ficha devuelta el envío no se dio de alta ni se colgó de
           * ninguna: el teléfono coincidió con más de una y se anotó el
           * pendiente. No se cuenta como "adjuntado" —no se adjuntó a nada— ni
           * se abre una tercera ficha: la persona ya está en el funnel (por eso
           * hay fichas que coinciden) y lo único que falta es decidir de cuál es
           * este formulario.
           */
          if (!prospect) {
            console.warn(`⚠️ [TikTok Leads] Lead ${lead.leadId}: el teléfono coincide con varias fichas. `
              + 'Queda pendiente de resolución y su atribución no se escribió.');
          } else if (created) {
            row.importados++;
            report.totals.importados++;
            console.log(`📥 [TikTok Leads] Lead ${lead.leadId} importado como prospecto #${prospect.id}.`);
          } else {
            // "Adjuntado" se cuenta aparte de "importado" porque no es lo
            // mismo para quien lee el reporte: un lead nuevo es una persona
            // más para trabajar, y un adjuntado es un formulario que se sumó a
            // una ficha que el equipo ya tenía.
            row.adjuntados++;
            report.totals.adjuntados++;
            console.log(`🔗 [TikTok Leads] Lead ${lead.leadId} colgado del lead existente #${prospect.id} `
              + (pendiente ? '(mismo teléfono: atribución pendiente).' : '(mismo lead_id).'));
          }
        } catch (error) {
          row.fallidos++;
          report.totals.fallidos++;
          report.errores.push({ page_id: form.id, lead_id: lead.leadId, error: error.message });
          console.error(`❌ [TikTok Leads] No se pudo importar el lead ${lead.leadId}:`, error);
        }
      }

      report.forms.push(row);
    }

    report.forms.sort((a, b) => b.faltantes - a.faltantes || b.en_tiktok - a.en_tiktok);

    /*
     * Un formulario que TikTok da por ACTIVO y del que no llegó un solo lead
     * al CRM es el síntoma de que esta importación nunca se corrió para él, y
     * se dice aparte porque en una lista larga (la mayoría de formularios
     * viejos y vacíos) no se distingue del ruido.
     */
    report.formularios_activos_sin_leads = report.forms
      .filter((f) => ['ACTIVE', 'ENABLE', 'STATUS_ENABLE'].includes(String(f.estado || '').toUpperCase()) && f.en_crm === 0)
      .map((f) => ({ page_id: f.page_id, nombre: f.nombre, en_tiktok: f.en_tiktok }));

    return report;
  }
}

/** La tarea de descarga ya está lista (TikTok no usa siempre la misma palabra). */
function isTaskReady(state) {
  return state === 'SUCCEED' || state === 'SUCCESS' || state === 'FINISHED';
}

/**
 * Un lead que vino como JSON, aplanado a `{ cabecera: valor }` para que lo lea
 * el mismo `leadFromRow` que las filas del CSV. Las respuestas vienen anidadas
 * en `field_data`/`answers` y los metadatos sueltos en la raíz.
 */
function flattenJsonLead(item) {
  const flat = {};
  for (const [key, value] of Object.entries(item || {})) {
    if (value == null || typeof value === 'object') continue;
    flat[key] = value;
  }
  const answers = item?.field_data || item?.answers || item?.fields || [];
  for (const answer of Array.isArray(answers) ? answers : []) {
    const name = answer?.name ?? answer?.field_name ?? answer?.question ?? answer?.key;
    const value = Array.isArray(answer?.values) ? answer.values[0] : (answer?.value ?? answer?.answer);
    if (name != null && value != null && String(value).trim()) flat[String(name)] = String(value);
  }
  return flat;
}
