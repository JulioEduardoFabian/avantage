import { db } from '../db/connection.js';
import { downloadAdCreativeImage } from './adCreativeImage.js';

/**
 * Integración con la **TikTok Business API (Marketing API)** para el módulo de
 * Campañas, hermana de `metaAdsService.js`: importa las campañas de TikTok Ads
 * Manager con su jerarquía completa (campaña → grupo de anuncios → anuncio) y
 * trae las métricas del informe (gasto, resultados y coste por resultado,
 * alcance, frecuencia, impresiones, CPM, clics, CTR y CPC, reproducciones de
 * video e interacciones).
 *
 * Las dos integraciones escriben en las MISMAS columnas de `campaigns`
 * (`meta_insights`, `meta_adsets_insights`, `meta_ads_insights`): las métricas
 * ya normalizadas tienen idéntica forma en ambas plataformas, así que el
 * informe de rendimiento, el export a Excel y la vista funcionan igual sin
 * duplicar nada. Lo que distingue el origen es `campaigns.source`
 * ('meta' | 'tiktok' | 'manual').
 *
 * Diferencias de fondo con Meta que explican varias decisiones de este archivo:
 *
 *  - **No hay Click-to-WhatsApp.** TikTok no manda un `referral.source_id` al
 *    chat, así que por ese camino no hay nada que atribuir. Lo que sí hay
 *    —desde el 30/10/2026— son los leads de **formulario instantáneo**, que
 *    llegan con su `ad_id` (ver `tiktokLeadsService.js`), y por eso ahora sí
 *    se escriben filas en `campaign_ads`: sin ellas, un lead importado de
 *    TikTok no se podía acreditar a ninguna campaña y la trazabilidad salía
 *    vacía con 21 conversiones en el Ads Manager. El `ad_source_id` va
 *    prefijado con `tt:`, igual que el `external_id` de la campaña: los ids
 *    de anuncio de las dos plataformas son numéricos y `ad_source_id` es
 *    ÚNICO, así que sin el prefijo un anuncio de TikTok podría robarle la
 *    fila a uno de Meta y mandar sus leads a la campaña equivocada.
 *  - **La campaña no tiene fechas.** El calendario vive en el grupo de
 *    anuncios (`schedule_start_time`/`schedule_end_time`), así que las fechas
 *    de la campaña se derivan del mínimo y el máximo de sus grupos.
 *  - **Sólo hay un tipo de clic.** El `clicks` de TikTok ya es el clic al
 *    destino; no existe la distinción "clics (todos)" vs "clics en el enlace"
 *    de Meta, y por eso ambas columnas muestran el mismo número.
 */

const API_VERSION = process.env.TIKTOK_API_VERSION || 'v1.3';
const API_BASE = `https://business-api.tiktok.com/open_api/${API_VERSION}`;

/** Portal de autorización donde el anunciante concede acceso a la app. */
const AUTH_PORTAL = 'https://business-api.tiktok.com/portal/auth';

/** Cuántas páginas se siguen como máximo en un listado paginado. */
const MAX_PAGES = 20;
/*
 * Tamaño de página por defecto. NO es el mismo para todos los endpoints:
 * `campaign/get/`, `adgroup/get/` y `ad/get/` aceptan 1000, pero `page/get/`
 * (los formularios instantáneos) topa en 100 y responde
 * "page_size: number must be most 100" — un error de validación que parece de
 * permisos si uno lo lee rápido. Por eso quien llama puede mandar el suyo.
 */
const PAGE_SIZE = 1000;

/** Códigos de error de TikTok que significan "el token ya no sirve". */
const INVALID_TOKEN_CODES = new Set([40001, 40100, 40105, 40110]);

/**
 * `status` del anunciante. Sólo `STATUS_ENABLE` deja entregar datos nuevos; el
 * resto se muestra tal cual porque de CUÁL sea depende qué hay que regularizar
 * (no es lo mismo una verificación pendiente que una cuenta deshabilitada).
 */
const ADVERTISER_STATUS_LABELS = {
  STATUS_ENABLE: 'activa',
  STATUS_DISABLE: 'deshabilitada por TikTok',
  STATUS_PENDING_CONFIRM: 'pendiente de confirmación',
  STATUS_PENDING_VERIFIED: 'pendiente de verificación',
  STATUS_CONFIRM_FAIL: 'con la verificación rechazada',
  STATUS_CONFIRM_FAIL_END: 'con la verificación rechazada de forma definitiva',
  STATUS_LIMIT: 'limitada por TikTok',
  STATUS_WAIT_FOR_BPM_AUDIT: 'en revisión de calificaciones',
  STATUS_WAIT_FOR_PUBLIC_AUTH: 'esperando la autorización pública',
  STATUS_SELF_SERVICE_UNAUDITED: 'sin auditar (cuenta autogestionada)',
  STATUS_CONTRACT_PENDING: 'con el contrato pendiente'
};

export function describeAdvertiserStatus(status) {
  return ADVERTISER_STATUS_LABELS[String(status || '').toUpperCase()] || `estado ${status}`;
}

/** Mapea el estado de TikTok a los estados internos del panel. */
function mapStatus(operationStatus, secondaryStatus) {
  const op = String(operationStatus || '').toUpperCase();
  if (op === 'ENABLE') return 'activa';
  if (op === 'DISABLE') return 'pausada';
  if (op === 'DELETE') return 'finalizada';
  // Sin `operation_status` (algunas cuentas antiguas) se deduce del estado
  // secundario, que siempre viene con el prefijo del nivel.
  const sec = String(secondaryStatus || '').toUpperCase();
  if (sec.endsWith('_DELETE')) return 'finalizada';
  if (sec.endsWith('_DISABLE')) return 'pausada';
  return sec ? 'activa' : 'finalizada';
}

/** `budget_mode` → cómo se muestra el presupuesto en el panel. */
function budgetTypeFromMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (m === 'BUDGET_MODE_DAY') return 'diario';
  if (m === 'BUDGET_MODE_TOTAL') return 'total';
  return null; // BUDGET_MODE_INFINITE: sin límite de presupuesto
}

function round2(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `YYYY-MM-DD` de una marca de tiempo de TikTok (`2026-09-23 14:05:00`). */
function toDateOnly(value) {
  if (!value) return null;
  const clean = String(value).trim().replace(' ', 'T');
  return clean.slice(0, 10) || null;
}

/**
 * "Resultados" e "Indicador de resultado" del Ads Manager. TikTok sí devuelve
 * la columna ya resuelta (`result` / `cost_per_result`), pero no dice de QUÉ
 * es el resultado: esa etiqueta se deduce del objetivo de la campaña.
 */
const RESULT_LABEL_BY_OBJECTIVE = {
  REACH: 'Alcance',
  RF_REACH: 'Alcance',
  TRAFFIC: 'Clics en el destino',
  RF_TRAFFIC: 'Clics en el destino',
  VIDEO_VIEWS: 'Reproducciones de video',
  RF_VIDEO_VIEWS: 'Reproducciones de video',
  ENGAGEMENT: 'Interacciones',
  RF_ENGAGEMENT: 'Interacciones',
  LEAD_GENERATION: 'Clientes potenciales',
  RF_LEAD_GENERATION: 'Clientes potenciales',
  WEB_CONVERSIONS: 'Conversiones',
  CONVERSIONS: 'Conversiones',
  APP_PROMOTION: 'Instalaciones de la aplicación',
  APP_INSTALL: 'Instalaciones de la aplicación',
  RF_APP_INSTALL: 'Instalaciones de la aplicación',
  PRODUCT_SALES: 'Compras',
  CATALOG_SALES: 'Compras',
  SHOP_PURCHASE: 'Compras'
};

/**
 * Respaldo cuando `result` no viene (objetivos viejos o informes sin la
 * métrica): la métrica cruda que mejor representa el objetivo.
 */
const RESULT_FALLBACK_BY_OBJECTIVE = {
  REACH: { metric: 'reach', label: 'Alcance' },
  RF_REACH: { metric: 'reach', label: 'Alcance' },
  TRAFFIC: { metric: 'clicks', label: 'Clics en el destino' },
  VIDEO_VIEWS: { metric: 'video_play_actions', label: 'Reproducciones de video' },
  ENGAGEMENT: { metric: 'engagements', label: 'Interacciones' }
};

function resolveResult(metrics, objective) {
  const obj = String(objective || '').toUpperCase();
  const label = RESULT_LABEL_BY_OBJECTIVE[obj] || 'Resultados';

  const result = num(metrics.result);
  if (result > 0) return { value: result, label };

  const conversions = num(metrics.conversion);
  if (conversions > 0) return { value: conversions, label: 'Conversiones' };

  const fallback = RESULT_FALLBACK_BY_OBJECTIVE[obj];
  if (fallback) {
    const value = num(metrics[fallback.metric]);
    if (value > 0) return { value, label: fallback.label };
  }
  return { value: null, label: null };
}

/**
 * Traduce una fila de `/report/integrated/get/` (de cualquier nivel) al mismo
 * juego de métricas que produce `metaAdsService`, con los nombres que usa el
 * panel. Los campos que TikTok no tiene se dejan en `null` a propósito: un 0
 * haría creer que se midió y dio cero.
 */
function normalizeInsightRow(metrics, { objective = null, dateStart = null, dateStop = null } = {}) {
  const spend = num(metrics.spend);
  const clicks = num(metrics.clicks);
  const result = resolveResult(metrics, objective);
  const costPerResult = metrics.cost_per_result != null && Number(metrics.cost_per_result) > 0
    ? round2(metrics.cost_per_result)
    : (result.value > 0 && spend > 0 ? round2(spend / result.value) : null);

  return {
    objective: objective || null,
    impressions: num(metrics.impressions),
    reach: num(metrics.reach),
    frequency: round2(metrics.frequency),
    spend,
    clicks,
    ctr: round2(metrics.ctr),
    cpc: round2(metrics.cpc),
    cpm: round2(metrics.cpm),
    // TikTok sólo mide el clic al destino: las dos columnas del panel
    // ("todos" y "del enlace") son el mismo dato.
    linkClicks: clicks,
    linkCtr: round2(metrics.ctr),
    costPerLinkClick: round2(metrics.cpc),
    landingPageViews: null,          // no existe como métrica en el informe básico
    costPerLandingPageView: null,
    shopClicks: null,
    messagingStarted: null,          // TikTok no tiene Click-to-WhatsApp
    conversions: num(metrics.conversion),
    costPerConversion: round2(metrics.cost_per_conversion),
    videoPlays: metrics.video_play_actions != null ? num(metrics.video_play_actions) : null,
    engagements: metrics.engagements != null ? num(metrics.engagements) : null,
    results: result.value,
    resultIndicator: result.label,
    costPerResult,
    attributionSetting: null,
    dateStart,
    dateStop
  };
}

/** Fila vacía para un objeto que existe pero nunca llegó a entregarse. */
function emptyInsightRow() {
  return {
    objective: null, impressions: null, reach: null, frequency: null, spend: 0,
    clicks: null, ctr: null, cpc: null, cpm: null,
    linkClicks: null, linkCtr: null, costPerLinkClick: null,
    landingPageViews: null, costPerLandingPageView: null, shopClicks: null,
    messagingStarted: null, conversions: null, costPerConversion: null,
    videoPlays: null, engagements: null,
    results: null, resultIndicator: null, costPerResult: null,
    attributionSetting: null, dateStart: null, dateStop: null
  };
}

/**
 * Métricas del informe. TikTok rechaza la petición entera (código 40002) si
 * una sola métrica no está disponible para la cuenta o el nivel, así que —como
 * en Meta— hay un juego mínimo de respaldo con el que se reintenta.
 */
const REPORT_METRICS = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'reach', 'frequency',
  'conversion', 'cost_per_conversion', 'conversion_rate',
  'result', 'cost_per_result', 'result_rate',
  'video_play_actions', 'video_watched_2s', 'video_watched_6s',
  'engagements', 'likes', 'comments', 'shares', 'follows'
];
const REPORT_METRICS_FALLBACK = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];

/** Nivel del informe y la dimensión con la que se indexa cada fila. */
const REPORT_LEVELS = {
  campaign: { dataLevel: 'AUCTION_CAMPAIGN', dimension: 'campaign_id' },
  adgroup: { dataLevel: 'AUCTION_ADGROUP', dimension: 'adgroup_id' },
  ad: { dataLevel: 'AUCTION_AD', dimension: 'ad_id' }
};

/**
 * Cuántos días abarca cada ventana. TikTok no tiene presets: siempre se piden
 * `start_date`/`end_date`, y ambos **incluyen hoy** para que el panel coincida
 * con la columna "Hoy" del Ads Manager. `maximum` se topa en 365 días, que es
 * el rango máximo que acepta un solo informe.
 */
const PRESET_DAYS = { today: 1, last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90, maximum: 365 };

/** `YYYY-MM-DD` de un instante leído en el huso del anunciante. */
function dayInTimezone(millis, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(millis));
  } catch {
    return new Date(millis).toISOString().slice(0, 10); // huso desconocido: UTC
  }
}

export class TikTokAdsService {
  constructor({ fetchImpl } = {}) {
    this.fetch = fetchImpl || globalThis.fetch;
    this._resolvedAdvertiser = null; // cache: { id, name, source }
    this._timezone = null;           // cache: huso del anunciante
  }

  get accessToken() {
    return process.env.TIKTOK_ACCESS_TOKEN || null;
  }

  get appId() {
    return process.env.TIKTOK_APP_ID || null;
  }

  get appSecret() {
    return process.env.TIKTOK_APP_SECRET || null;
  }

  /**
   * URL del portal de autorización de TikTok. Es el primer paso de la
   * conexión: el anunciante entra, elige qué cuentas publicitarias autoriza y
   * TikTok redirige al `redirect_uri` con un `auth_code` de un solo uso.
   */
  authorizationUrl({ redirectUri = null, state = 'minirag' } = {}) {
    if (!this.appId) {
      const e = new Error('Falta TIKTOK_APP_ID en el .env (TikTok for Business > Developers > tu app > Basic Information).');
      e.code = 'NOT_CONFIGURED';
      throw e;
    }
    const params = new URLSearchParams({ app_id: this.appId, state });
    // El redirect_uri tiene que ser EXACTAMENTE uno de los "Advertiser redirect
    // URL" declarados en la app; si no se pasa, TikTok usa el primero.
    if (redirectUri) params.set('redirect_uri', redirectUri);
    return `${AUTH_PORTAL}?${params.toString()}`;
  }

  /**
   * Canjea el `auth_code` de la redirección por un access token de larga
   * duración. El token que devuelve TikTok **no caduca** mientras el
   * anunciante no revoque la autorización, así que se guarda a mano en el
   * `.env` (`TIKTOK_ACCESS_TOKEN`) en vez de persistirlo en la base.
   */
  async exchangeAuthCode(authCode) {
    if (!this.appId || !this.appSecret) {
      const e = new Error('Faltan TIKTOK_APP_ID y/o TIKTOK_APP_SECRET en el .env.');
      e.code = 'NOT_CONFIGURED';
      throw e;
    }
    if (!authCode || !String(authCode).trim()) {
      const e = new Error('Falta el auth_code de la redirección de TikTok.');
      e.code = 'NO_AUTH_CODE';
      throw e;
    }

    const res = await this.fetch(`${API_BASE}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.appId,
        secret: this.appSecret,
        auth_code: String(authCode).trim(),
        grant_type: 'auth_code'
      })
    });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) {
      const e = new Error(`TikTok Business API: ${json.message || `HTTP ${res.status}`}`);
      e.tiktokCode = json.code || null;
      throw e;
    }
    return {
      accessToken: json.data?.access_token || null,
      advertiserIds: json.data?.advertiser_ids || [],
      scope: json.data?.scope || null
    };
  }

  /**
   * Resuelve la cuenta publicitaria: usa TIKTOK_ADVERTISER_ID si está
   * definida, o la descubre con el token vía `/oauth2/advertiser/get/` (el
   * equivalente de `/me/adaccounts` en Meta, salvo que aquí hacen falta el
   * app_id y el secret además del token).
   */
  async resolveAdvertiser({ force = false } = {}) {
    if (this._resolvedAdvertiser && !force) return this._resolvedAdvertiser;
    if (!this.accessToken) {
      const e = new Error('No hay ningún token de TikTok configurado (TIKTOK_ACCESS_TOKEN).');
      e.code = 'NO_TOKEN';
      throw e;
    }

    const envId = String(process.env.TIKTOK_ADVERTISER_ID || '').trim();
    if (envId) {
      this._resolvedAdvertiser = { id: envId, name: null, source: 'env' };
      return this._resolvedAdvertiser;
    }

    if (!this.appId || !this.appSecret) {
      const e = new Error('Para descubrir la cuenta publicitaria automáticamente hacen falta TIKTOK_APP_ID y TIKTOK_APP_SECRET; si no, define TIKTOK_ADVERTISER_ID en el .env.');
      e.code = 'NOT_CONFIGURED';
      throw e;
    }

    const data = await this.#get('oauth2/advertiser/get/', { app_id: this.appId, secret: this.appSecret });
    const list = data?.list || [];
    if (!list.length) {
      const e = new Error('El token no tiene acceso a ninguna cuenta publicitaria de TikTok. Vuelve a autorizar la app desde TikTok Ads Manager y marca la cuenta.');
      e.code = 'NO_AD_ACCOUNT';
      throw e;
    }
    const first = list[0];
    this._resolvedAdvertiser = {
      id: String(first.advertiser_id),
      name: first.advertiser_name || null,
      source: 'auto',
      options: list.length
    };
    return this._resolvedAdvertiser;
  }

  /** Estado de la integración, con comprobación en vivo contra la API. */
  async status() {
    if (!this.accessToken) {
      return { configured: false, reason: 'no_token', hasToken: false };
    }
    try {
      const advertiser = await this.resolveAdvertiser({ force: true });

      // `resolveAdvertiser` NO toca la API cuando el ID viene del .env, así
      // que sin esta llamada el panel daría por buena una configuración con el
      // token ya revocado. Leer la propia cuenta valida el token y, de paso,
      // trae el nombre, la moneda y el huso reales.
      const info = await this.#get('advertiser/info/', { advertiser_ids: JSON.stringify([advertiser.id]) });
      const live = info?.list?.[0] || {};
      const rawStatus = live.status || null;
      const inactive = !!rawStatus && String(rawStatus).toUpperCase() !== 'STATUS_ENABLE';
      this._timezone = live.timezone || live.display_timezone || null;

      return {
        configured: true,
        hasToken: true,
        advertiserId: advertiser.id,
        advertiserName: live.name || live.advertiser_name || advertiser.name,
        advertiserCurrency: live.currency || null,
        advertiserTimezone: this._timezone,
        advertiserDisabled: inactive,
        advertiserStatus: rawStatus,
        advertiserStatusLabel: inactive ? describeAdvertiserStatus(rawStatus) : null,
        advertiserSource: advertiser.source,
        advertiserOptions: advertiser.options || 1
      };
    } catch (err) {
      return {
        configured: false,
        hasToken: true,
        // Estos códigos siempre significan token caducado, revocado o sin
        // permiso sobre la cuenta: la solución es reautorizar, no tocar el ID.
        reason: INVALID_TOKEN_CODES.has(Number(err.tiktokCode)) ? 'invalid_token' : (err.code || 'error').toLowerCase(),
        error: err.message,
        tiktokCode: err.tiktokCode || null
      };
    }
  }

  /**
   * Los dos `#get` abiertos al resto del backend.
   *
   * `tiktokLeadsService` necesita hablar con la MISMA API —mismo token, misma
   * versión, mismo tratamiento de los errores que TikTok devuelve dentro de un
   * HTTP 200 y mismo paginado— y la alternativa era copiar esas cuatro cosas
   * en el otro archivo. Copiadas, el día que el token caducado deje de
   * reconocerse en uno de los dos la importación fallaría diciendo cualquier
   * otra cosa.
   */
  async api(path, params = {}) {
    return this.#get(path, params);
  }

  /**
   * @param {function} [onTruncate] se llama con `{ path, paginasLeidas,
   *   paginasTotales, tope }` cuando el tope de páginas corta el recorrido.
   *   Es un callback y no un campo en la instancia para no dejar estado
   *   compartido entre corridas; y existe porque este paginador se detenía en
   *   la página 20 aunque `total_page` dijera 35, **sin decírselo a nadie** —
   *   una comparación recortada que devuelve un resultado con pinta de
   *   completo.
   */
  async apiPaged(path, params = {}, { onTruncate = null } = {}) {
    return this.#getPaged(path, params, { onTruncate });
  }

  /**
   * POST a un endpoint de la API, con el cuerpo en JSON.
   *
   * Lo pide la creación de la tarea de descarga de leads, que no se puede
   * hacer por GET. Mismo tratamiento del error que `#get`: TikTok responde
   * HTTP 200 con el fallo adentro, salvo cuando el fallo es del gateway (404,
   * 405) y el cuerpo ni siquiera es JSON — por eso se mira también el estado.
   */
  async apiPost(path, body = {}) {
    const res = await this.fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Access-Token': this.accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) {
      const e = new Error(`TikTok Business API: ${json.message || `HTTP ${res.status}`}`);
      e.tiktokCode = json.code || null;
      e.httpStatus = res.status;
      throw e;
    }
    return json.data;
  }

  /**
   * GET a un endpoint de la API. TikTok responde SIEMPRE HTTP 200: el error
   * real viene en `code` del cuerpo, así que hay que mirarlo siempre.
   */
  async #get(path, params = {}) {
    const search = new URLSearchParams(params);
    const res = await this.fetch(`${API_BASE}/${path}?${search.toString()}`, {
      headers: { 'Access-Token': this.accessToken, 'Content-Type': 'application/json' }
    });
    const json = await res.json().catch(() => ({}));
    if (json.code !== 0) {
      const e = new Error(`TikTok Business API: ${json.message || `HTTP ${res.status}`}`);
      e.tiktokCode = json.code || null;
      // El estado HTTP distingue "esta ruta no existe" (404) de "existe pero
      // no por este método" (405), que es lo que deja elegir la variante
      // correcta en `tiktokLeadsService`.
      e.httpStatus = res.status;
      throw e;
    }
    return json.data;
  }

  /** GET paginado (`page`/`page_info.total_page`), acumulando `data.list`. */
  async #getPaged(path, params = {}, { onTruncate = null } = {}) {
    const out = [];
    let totalPages = 1;
    let leidas = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.#get(path, {
        ...params,
        page: String(page),
        page_size: String(params.page_size ?? PAGE_SIZE)
      });
      out.push(...(data?.list || []));
      leidas = page;
      totalPages = Number(data?.page_info?.total_page || 1);
      if (page >= totalPages) break;
    }

    // El recorte se avisa, no se asume. Sin esto, un recorrido cortado en la
    // página 20 de 35 devuelve una lista con pinta de completa.
    if (totalPages > leidas) {
      console.warn(`⚠️ [TikTok] ${path}: se leyeron ${leidas} de ${totalPages} páginas (tope ${MAX_PAGES}).`);
      if (onTruncate) onTruncate({ path, paginasLeidas: leidas, paginasTotales: totalPages, tope: MAX_PAGES });
    }

    return out;
  }

  /** Huso horario del anunciante: es el que decide qué día es "hoy" en TikTok. */
  async #timezoneOf(advertiserId) {
    if (this._timezone) return this._timezone;
    try {
      const info = await this.#get('advertiser/info/', { advertiser_ids: JSON.stringify([advertiserId]) });
      this._timezone = info?.list?.[0]?.timezone || info?.list?.[0]?.display_timezone || 'UTC';
    } catch {
      this._timezone = 'UTC'; // ante la duda, UTC: peor es quedarse sin métricas
    }
    return this._timezone;
  }

  /** Ventana del informe, en el huso del anunciante e incluyendo hoy. */
  async #dateRange(advertiserId, datePreset) {
    const days = PRESET_DAYS[datePreset] || PRESET_DAYS.last_30d;
    const tz = await this.#timezoneOf(advertiserId);
    const now = Date.now();
    return {
      start_date: dayInTimezone(now - (days - 1) * 86400000, tz),
      end_date: dayInTimezone(now, tz)
    };
  }

  /**
   * Informe de un nivel, indexado por el id del objeto. Si TikTok falla se
   * anota en el resumen y se sigue con un mapa vacío: el panel prefiere
   * mostrar la jerarquía sin métricas antes que no mostrar nada.
   */
  async #reportById(advertiserId, { level, range, summary, what }) {
    const { dataLevel, dimension } = REPORT_LEVELS[level];
    const params = {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: dataLevel,
      service_type: 'AUCTION',
      dimensions: JSON.stringify([dimension]),
      ...range
    };

    let rows;
    try {
      rows = await this.#getPaged('report/integrated/get/', { ...params, metrics: JSON.stringify(REPORT_METRICS) });
    } catch (err) {
      console.warn(`⚠️ [TikTok Ads] Métricas completas rechazadas en ${dataLevel} (${err.message}); se reintenta con el juego mínimo.`);
      try {
        rows = await this.#getPaged('report/integrated/get/', { ...params, metrics: JSON.stringify(REPORT_METRICS_FALLBACK) });
      } catch (retryError) {
        summary.errors.push(`No se pudieron traer las métricas de ${what}: ${retryError.message}`);
        return new Map();
      }
    }

    return new Map(
      rows
        .filter((r) => r?.dimensions?.[dimension] != null)
        .map((r) => [String(r.dimensions[dimension]), r.metrics || {}])
    );
  }

  /**
   * Sincroniza campañas + grupos de anuncios + anuncios + métricas.
   * `datePreset` es la ventana que muestra el panel (today | last_7d |
   * last_14d | last_30d | last_90d | maximum) y se traduce a un rango de
   * fechas que llega hasta hoy.
   */
  async sync({ datePreset = 'last_30d' } = {}) {
    const advertiser = (await this.resolveAdvertiser()).id;
    const range = await this.#dateRange(advertiser, datePreset);
    const summary = {
      campaigns: 0, adgroups: 0, ads: 0, insightsUpdated: 0, adgroupInsights: 0, adInsights: 0,
      advertiserId: advertiser, datePreset, window: range, errors: []
    };

    // 1) Campañas
    const campaigns = await this.#getPaged('campaign/get/', { advertiser_id: advertiser });

    const localIdByExternal = new Map();   // campaign_id de TikTok -> id local
    const objectiveByExternal = new Map(); // para resolver el "indicador de resultado"
    for (const c of campaigns) {
      const externalId = `tt:${c.campaign_id}`;
      objectiveByExternal.set(String(c.campaign_id), c.objective_type || null);

      const budget = Number(c.budget || 0);
      const patch = {
        name: c.campaign_name || `Campaña ${c.campaign_id}`,
        platform: 'tiktok',
        source: 'tiktok',
        external_id: externalId,
        objective: c.objective_type || null,
        status: mapStatus(c.operation_status, c.secondary_status),
        meta_status: c.secondary_status || c.operation_status || null,
        budget_type: budgetTypeFromMode(c.budget_mode),
        last_synced_at: db.fn.now(),
        updated_at: db.fn.now()
      };
      if (budget > 0) patch.budget_total = budget;

      const existing = await db('campaigns').where({ external_id: externalId }).first();
      if (existing) {
        await db('campaigns').where({ id: existing.id }).update(patch);
        localIdByExternal.set(String(c.campaign_id), existing.id);
      } else {
        const [id] = await db('campaigns').insert({ currency: 'PEN', budget_total: 0, ...patch });
        localIdByExternal.set(String(c.campaign_id), id);
      }
      summary.campaigns++;
    }

    // 2) Grupos de anuncios (el "conjunto de anuncios" de Meta). Se listan
    //    todos —no sólo los que tienen métricas— porque el panel replica la
    //    jerarquía del Ads Manager, donde un grupo sin entrega también sale.
    let adgroups = [];
    try {
      adgroups = await this.#getPaged('adgroup/get/', { advertiser_id: advertiser });
    } catch (err) {
      summary.errors.push(`No se pudieron traer los grupos de anuncios: ${err.message}`);
    }

    const adgroupMetaById = new Map();
    for (const g of adgroups) {
      adgroupMetaById.set(String(g.adgroup_id), {
        adsetId: String(g.adgroup_id),
        adsetName: g.adgroup_name || `Grupo ${g.adgroup_id}`,
        campaignExternalId: String(g.campaign_id),
        delivery: g.secondary_status || g.operation_status || null,
        budget: Number(g.budget || 0) > 0 ? Number(g.budget) : null,
        budgetType: budgetTypeFromMode(g.budget_mode),
        startTime: g.schedule_start_time || null,
        endTime: g.schedule_end_time || null,
        optimizationGoal: g.optimization_goal || null
      });
      summary.adgroups++;
    }

    // 3) Anuncios. Se mapean en `campaign_ads` con el prefijo `tt:` para que
    //    los leads de formulario instantáneo —que sí traen su `ad_id`— se
    //    puedan acreditar a su campaña (ver la nota de cabecera del archivo).
    let ads = [];
    try {
      ads = await this.#getPaged('ad/get/', { advertiser_id: advertiser });
    } catch (err) {
      summary.errors.push(`No se pudieron traer los anuncios: ${err.message}`);
    }

    // Las miniaturas se resuelven en lote: el creativo referencia un video o
    // una imagen por id, y la URL hay que pedirla aparte (una llamada por
    // tipo, no una por anuncio).
    const thumbnailByVideoId = await this.#videoPosters(advertiser, ads, summary);
    const thumbnailByImageId = await this.#imageUrls(advertiser, ads, summary);

    const imageSetForCampaign = new Set();
    const adMetaById = new Map();

    for (const ad of ads) {
      const thumbnailUrl = thumbnailByVideoId.get(String(ad.video_id))
        || thumbnailByImageId.get(String((ad.image_ids || [])[0]))
        || null;
      // La clave lleva el prefijo `tt-` para que un anuncio de TikTok no pise
      // en disco el archivo de un anuncio de Meta con el mismo id numérico.
      const image = await downloadAdCreativeImage(thumbnailUrl, `tt-${ad.ad_id}`, { label: 'TikTok Ads' });

      adMetaById.set(String(ad.ad_id), {
        adId: String(ad.ad_id),
        adName: ad.ad_name || `Anuncio ${ad.ad_id}`,
        campaignExternalId: String(ad.campaign_id),
        adsetId: ad.adgroup_id ? String(ad.adgroup_id) : null,
        delivery: ad.secondary_status || ad.operation_status || null,
        createdTime: ad.create_time || null,
        imageFilename: image?.filename || null
      });

      const localCampaignId = localIdByExternal.get(String(ad.campaign_id));

      /*
       * El mapeo anuncio -> campaña, que es de lo que cuelga la atribución de
       * los leads de formulario. Se reescribe en cada sincronización
       * (`onConflict().merge()`) y no sólo se inserta: un anuncio renombrado
       * tiene que decir su nombre nuevo en la trazabilidad.
       */
      if (localCampaignId) {
        await db('campaign_ads')
          .insert({ campaign_id: localCampaignId, ad_source_id: `tt:${ad.ad_id}`, ad_label: ad.ad_name || null })
          .onConflict('ad_source_id')
          .merge({ campaign_id: localCampaignId, ad_label: ad.ad_name || null });
      }

      if (localCampaignId && image && !imageSetForCampaign.has(localCampaignId)) {
        // La campaña se reconoce de un vistazo por el creativo de su primer
        // anuncio, igual que en Meta.
        imageSetForCampaign.add(localCampaignId);
        await db('campaigns').where({ id: localCampaignId }).update({
          ad_image_filename: image.filename,
          ad_image_mime_type: image.mimeType
        });
      }
      summary.ads++;
    }

    // 4) Informes de los tres niveles
    const campaignInsights = await this.#reportById(advertiser, { level: 'campaign', range, summary, what: 'las campañas' });
    const adgroupInsights = await this.#reportById(advertiser, { level: 'adgroup', range, summary, what: 'los grupos de anuncios' });
    const adInsights = await this.#reportById(advertiser, { level: 'ad', range, summary, what: 'los anuncios' });

    // 5) Fechas de la campaña: TikTok las guarda en el grupo de anuncios, así
    //    que la campaña abarca desde el primer grupo hasta el último.
    const scheduleByCampaign = new Map();
    for (const meta of adgroupMetaById.values()) {
      const entry = scheduleByCampaign.get(meta.campaignExternalId) || { start: null, end: null, openEnded: false };
      const start = toDateOnly(meta.startTime);
      const end = toDateOnly(meta.endTime);
      if (start && (!entry.start || start < entry.start)) entry.start = start;
      if (end) { if (!entry.end || end > entry.end) entry.end = end; } else { entry.openEnded = true; }
      scheduleByCampaign.set(meta.campaignExternalId, entry);
    }

    // 6) Métricas de la campaña + jerarquía. Se reescribe para TODAS las
    //    campañas sincronizadas —no sólo las que trajeron filas— para que no
    //    sobrevivan objetos de una ventana anterior.
    const adgroupRowsByCampaign = new Map();
    for (const meta of adgroupMetaById.values()) {
      const localCampaignId = localIdByExternal.get(meta.campaignExternalId);
      if (!localCampaignId) continue;
      const metrics = adgroupInsights.get(meta.adsetId);
      if (!adgroupRowsByCampaign.has(localCampaignId)) adgroupRowsByCampaign.set(localCampaignId, []);
      adgroupRowsByCampaign.get(localCampaignId).push({
        adsetId: meta.adsetId,
        adsetName: meta.adsetName,
        delivery: meta.delivery,
        budget: meta.budget,
        budgetType: meta.budgetType,
        startTime: meta.startTime,
        endTime: meta.endTime,
        optimizationGoal: meta.optimizationGoal,
        hasInsights: !!metrics,
        ...(metrics
          ? normalizeInsightRow(metrics, {
              objective: objectiveByExternal.get(meta.campaignExternalId),
              dateStart: range.start_date,
              dateStop: range.end_date
            })
          : emptyInsightRow())
      });
    }

    const adRowsByCampaign = new Map();
    for (const meta of adMetaById.values()) {
      const localCampaignId = localIdByExternal.get(meta.campaignExternalId);
      if (!localCampaignId) continue;
      const metrics = adInsights.get(meta.adId);
      const group = meta.adsetId ? adgroupMetaById.get(meta.adsetId) : null;
      if (!adRowsByCampaign.has(localCampaignId)) adRowsByCampaign.set(localCampaignId, []);
      adRowsByCampaign.get(localCampaignId).push({
        adId: meta.adId,
        adName: meta.adName,
        adsetId: meta.adsetId,
        adsetName: group?.adsetName || null,
        delivery: meta.delivery,
        imageFilename: meta.imageFilename,
        adsetBudget: group?.budget ?? null,
        adsetBudgetType: group?.budgetType || null,
        endTime: group?.endTime || null,
        // TikTok no publica las clasificaciones de calidad de Meta.
        qualityRanking: null,
        engagementRanking: null,
        conversionRanking: null,
        hasInsights: !!metrics,
        ...(metrics
          ? normalizeInsightRow(metrics, {
              objective: objectiveByExternal.get(meta.campaignExternalId),
              dateStart: range.start_date,
              dateStop: range.end_date
            })
          : emptyInsightRow())
      });
    }

    const bySpend = (a, b) => (b.spend || 0) - (a.spend || 0);
    for (const [externalId, localCampaignId] of localIdByExternal.entries()) {
      const metrics = campaignInsights.get(externalId);
      const schedule = scheduleByCampaign.get(externalId);
      const adgroupRows = (adgroupRowsByCampaign.get(localCampaignId) || []).sort(bySpend);
      const adRows = (adRowsByCampaign.get(localCampaignId) || []).sort(bySpend);

      const patch = {
        meta_adsets_insights: adgroupRows.length ? JSON.stringify(adgroupRows) : null,
        meta_ads_insights: adRows.length ? JSON.stringify(adRows) : null
      };
      if (schedule) {
        patch.start_date = schedule.start;
        // Con algún grupo sin fecha de fin la campaña sigue abierta: dejar la
        // última fecha conocida la haría parecer terminada.
        patch.end_date = schedule.openEnded ? null : schedule.end;
      }
      if (metrics) {
        patch.meta_insights = JSON.stringify({
          ...normalizeInsightRow(metrics, {
            objective: objectiveByExternal.get(externalId),
            dateStart: range.start_date,
            dateStop: range.end_date
          }),
          window: datePreset,
          windowRange: range
        });
        patch.last_synced_at = db.fn.now();
        summary.insightsUpdated++;
      }

      await db('campaigns').where({ id: localCampaignId }).update(patch);
      summary.adgroupInsights += adgroupRows.length;
      summary.adInsights += adRows.length;
    }

    return summary;
  }

  /** `video_id` -> URL del póster, en una sola llamada para todos los anuncios. */
  async #videoPosters(advertiserId, ads, summary) {
    const ids = [...new Set(ads.map((a) => a.video_id).filter(Boolean).map(String))];
    if (!ids.length) return new Map();
    try {
      const out = new Map();
      // El endpoint acepta como mucho 100 ids por petición.
      for (let i = 0; i < ids.length; i += 100) {
        const data = await this.#get('file/video/ad/info/', {
          advertiser_id: advertiserId,
          video_ids: JSON.stringify(ids.slice(i, i + 100))
        });
        for (const v of data?.list || []) {
          const url = v.poster_url || v.video_cover_url || null;
          if (url) out.set(String(v.video_id), url);
        }
      }
      return out;
    } catch (err) {
      summary.errors.push(`No se pudieron traer las miniaturas de los videos: ${err.message}`);
      return new Map();
    }
  }

  /** `image_id` -> URL de la imagen, para los anuncios que no son de video. */
  async #imageUrls(advertiserId, ads, summary) {
    const ids = [...new Set(ads.flatMap((a) => a.image_ids || []).filter(Boolean).map(String))];
    if (!ids.length) return new Map();
    try {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const data = await this.#get('file/image/ad/info/', {
          advertiser_id: advertiserId,
          image_ids: JSON.stringify(ids.slice(i, i + 100))
        });
        for (const img of data?.list || []) {
          if (img.image_url) out.set(String(img.image_id), img.image_url);
        }
      }
      return out;
    } catch (err) {
      summary.errors.push(`No se pudieron traer las miniaturas de las imágenes: ${err.message}`);
      return new Map();
    }
  }
}
