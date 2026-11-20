import { db } from '../db/connection.js';

/**
 * Lo que TikTok nos manda **vuelve a TikTok**: en qué etapa del funnel terminó
 * cada lead que llegó de un formulario instantáneo.
 *
 * Es la hermana de `metaConversionsService.js` y existe por el mismo agujero
 * visto desde el otro lado. TikTok nos entrega los leads —a mano, porque no hay
 * webhook— y nunca se entera de lo que pasó después, así que su optimización
 * solo puede perseguir "más formularios llenados". Esa métrica es justo la que
 * se llena de leads que no contestan: la campaña aprende a traer gente que
 * completa un formulario, no gente que compra.
 *
 * Cuatro decisiones que conviene no deshacer:
 *
 *  1. **El identificador es el `lead_id` de TikTok, y nada más.** Es con lo
 *     único que TikTok puede reconocer a este lead como suyo. No hay
 *     equivalente del `ctwa_clid` de Meta —TikTok no manda un referral al
 *     chat—, así que un lead del evaluador, del alta manual o de WhatsApp
 *     orgánico **no se reporta**: no hay anuncio al que atribuirlo, y forzarlo
 *     con un identificador aproximado le enseñaría a la campaña una conversión
 *     que no trajo.
 *
 *  2. **El `event_time` es el del hecho real.** Para el alta es
 *     `tiktok_created_time` (cuándo se llenó el formulario en TikTok) y no
 *     `created_at` (cuándo entró acá): un lead que la importación rescató tres
 *     días después tiene las dos fechas muy separadas, y una plataforma
 *     descarta el evento anterior a la generación del lead. Para los cambios de
 *     etapa es el momento del movimiento.
 *
 *  3. **Que TikTok acepte el evento no significa que la campaña optimice por
 *     él.** La aceptación es del Events API; la optimización depende del
 *     `optimization_goal` del grupo de anuncios y de que el evento esté
 *     configurado en el origen. Dar por buena la optimización porque el POST
 *     devolvió 200 es el fallo silencioso de esta integración — el mismo que en
 *     Meta era mandar al conjunto de datos equivocado y que la campaña siguiera
 *     optimizando a ciegas. Por eso `checkEligibility()` va aparte y la
 *     pantalla lo dice.
 *
 *  4. **Los nombres de evento son los estándar de TikTok, no libres.** El
 *     conjunto válido lo fija la plataforma, así que ofrecer un campo de texto
 *     solo daría la oportunidad de escribir algo que va a ser rechazado. La
 *     tabla deja elegir QUÉ etapa manda cada evento estándar, que es la
 *     decisión que de verdad es del equipo.
 *
 * **Lo que no está verificado contra la cuenta real**: este `.env` no tiene
 * credenciales de TikTok, así que la forma del payload sale de la documentación
 * del Events API 2.0 y no de una respuesta observada (a diferencia de la
 * integración de Meta, que quedó funcionando el 20/10/2026 con los dos canales
 * enviando). Mientras falten las credenciales la integración queda **apagada**
 * y no se intenta nada; el primer envío real hay que mirarlo con
 * `GET /api/tiktok-capi` en la mano, porque la Business API responde HTTP 200
 * con el fallo adentro y un error de forma no se ve en el estado.
 *
 * No viaja ningún importe, igual que en Meta: TikTok recibe la etapa, no cuánto
 * facturó el cliente.
 */

/** Los nombres de evento que el Events API de TikTok admite para esto. */
export const TIKTOK_EVENT_NAMES = [
  'Contact',
  'SubmitForm',
  'CompleteRegistration',
  'CompletePayment',
  'PlaceAnOrder'
];

/**
 * Objetivos de optimización que de verdad aprenden de un evento de conversión.
 *
 * Hace falta para `checkEligibility()`: una campaña optimizada a clics o a
 * alcance **no** usa los eventos que le mandamos aunque los acepte, así que
 * reportarlos no mejora nada y creer que sí es el error que esta comprobación
 * evita.
 */
const OPTIMIZING_GOALS = new Set(['CONVERT', 'CONVERSION', 'LEAD_GENERATION', 'VALUE', 'OFFLINE_CONVERT']);

/** Cuánto hacia atrás acepta TikTok un evento, en días. */
const MAX_EVENT_AGE_DAYS = 10;

const text = (value) => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
};

/**
 * Cuándo ocurrió el hecho que se reporta, y si entra en la ventana.
 *
 * Devuelve `{ ok, eventTime, reason }`. La fecha de referencia para el alta es
 * la de TikTok y no la del CRM, por la razón del punto 2 del encabezado; y el
 * evento se descarta ANTES de gastar la llamada cuando queda fuera de la
 * ventana, porque un rechazo por antigüedad se ve igual que un error de forma y
 * manda a buscar el problema donde no está.
 */
export function eventTimeFor({ movedAt = null, tiktokCreatedAt = null, createdAt = null, now = new Date() }) {
  const candidato = movedAt || tiktokCreatedAt || createdAt;
  if (!candidato) return { ok: false, eventTime: null, reason: 'sin_fecha' };

  const ts = new Date(candidato).getTime();
  if (Number.isNaN(ts)) return { ok: false, eventTime: null, reason: 'fecha_invalida' };

  const ahora = new Date(now).getTime();
  if (ts > ahora + 60_000) return { ok: false, eventTime: null, reason: 'fecha_futura' };

  const dias = (ahora - ts) / 86_400_000;
  if (dias > MAX_EVENT_AGE_DAYS) return { ok: false, eventTime: null, reason: 'fuera_de_ventana' };

  /*
   * El evento no puede ser anterior a la generación del lead: TikTok lo
   * descarta, y la causa más común es un movimiento de etapa fechado por el
   * CRM sobre un lead cuyo formulario se llenó después (pasa con las fechas
   * corregidas a mano).
   */
  if (tiktokCreatedAt) {
    const nacimiento = new Date(tiktokCreatedAt).getTime();
    if (!Number.isNaN(nacimiento) && ts < nacimiento) {
      return { ok: true, eventTime: Math.floor(nacimiento / 1000), reason: 'ajustado_al_alta' };
    }
  }

  return { ok: true, eventTime: Math.floor(ts / 1000), reason: null };
}

/**
 * El `event_id` con el que TikTok desduplica del lado de la plataforma.
 *
 * Es determinista —lead + evento— y no un azar: así un reenvío del mismo hecho
 * (el botón de reintentar, un barrido que corrió dos veces) llega con el mismo
 * id y TikTok lo descarta en vez de contarlo como una segunda venta. La
 * bitácora local ya evita el reenvío en el caso normal; esto cubre el caso en
 * que la bitácora y la plataforma no estén de acuerdo.
 */
export function eventIdFor(leadId, eventName) {
  return `crm-${leadId}-${String(eventName || '').toLowerCase()}`;
}

/**
 * El payload de un evento, con la forma del Events API 2.0.
 *
 * `event_source: 'crm'` y `user.lead_id` son lo que le dice a TikTok "esto es
 * el desenlace de un lead que me diste", que es exactamente la vuelta que falta.
 * No se manda ningún dato de contacto: con el `lead_id` TikTok ya sabe quién
 * es, y mandarle el teléfono sería exportar un dato personal para nada.
 */
export function buildEvent({ eventName, eventTime, tiktokLeadId, eventId }) {
  return {
    event: eventName,
    event_time: eventTime,
    event_id: eventId,
    user: {
      // El Lead ID de TikTok, preservado tal cual: es el único identificador
      // con el que la plataforma reconoce a este lead como suyo.
      lead_id: String(tiktokLeadId)
    }
  };
}

export class TikTokConversionsService {
  /**
   * @param {object} deps
   * @param {object} [deps.ads] servicio de anuncios de TikTok, solo para la
   *   comprobación de elegibilidad (de ahí salen los grupos y su objetivo de
   *   optimización). Opcional: sin él la comprobación dice que no se pudo
   *   hacer, que es distinto de decir que todo está bien.
   */
  constructor({ ads = null, fetchImpl = null } = {}) {
    this.ads = ads;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  }

  get apiBase() {
    return `https://business-api.tiktok.com/open_api/${process.env.TIKTOK_EVENTS_API_VERSION || 'v1.3'}`;
  }

  /**
   * La configuración, leída del entorno en cada llamada.
   *
   * Se lee cada vez y no se cachea porque de esto depende que la integración
   * esté encendida: con el valor en caché, agregar la credencial obligaría a
   * reiniciar el servidor para que empiece a mandar.
   */
  config() {
    const sourceId = text(process.env.TIKTOK_EVENTS_SOURCE_ID);
    /*
     * El token cae al de anuncios porque suele ser el mismo de la Business API.
     * Que exista no garantiza que tenga el alcance del Events API — eso solo lo
     * dice el primer envío real, y por eso la bitácora guarda la respuesta
     * cruda.
     */
    const token = text(process.env.TIKTOK_EVENTS_ACCESS_TOKEN)
      || text(process.env.TIKTOK_ACCESS_TOKEN);

    return {
      sourceId,
      token,
      enabled: Boolean(sourceId && token),
      /*
       * Qué falta, nombrado. "No configurado" sin decir qué falta obliga a leer
       * el código para enterarse, y es lo primero que mira quien viene a
       * encender la integración.
       */
      missing: [
        !sourceId ? 'TIKTOK_EVENTS_SOURCE_ID' : null,
        !token ? 'TIKTOK_EVENTS_ACCESS_TOKEN' : null
      ].filter(Boolean)
    };
  }

  /** El mapeo etapa → evento que el equipo tiene configurado. */
  async stages() {
    return db('tiktok_capi_stage_events').select('*').orderBy('status_key', 'asc');
  }

  async activeStageFor(statusKey) {
    const key = text(statusKey);
    if (!key) return null;
    return db('tiktok_capi_stage_events').where({ status_key: key, enabled: true }).first();
  }

  /**
   * Guarda el mapeo etapa → evento.
   *
   * Rechaza un nombre de evento que no sea de los estándar de TikTok: el
   * conjunto válido lo fija la plataforma, y un nombre propio se acepta en la
   * pantalla y se rechaza en el envío — un error que recién se ve en la
   * bitácora, días después, cuando alguien va a buscar por qué la campaña no
   * optimiza.
   *
   * Dos etapas PUEDEN compartir el nombre del evento (el desenlace fijo
   * `ganado` y la columna marcada `final` son la misma venta), y entonces el
   * control de repetidos hace que se mande una sola vez por lead: reabrir y
   * volver a ganar no es una segunda venta.
   */
  async saveMapping(rows = []) {
    for (const row of rows) {
      const key = text(row?.status_key);
      const eventName = text(row?.event_name);
      if (!key) continue;

      if (eventName && !TIKTOK_EVENT_NAMES.includes(eventName)) {
        const error = new Error(`"${eventName}" no es un evento que TikTok admita. `
          + `Los válidos son: ${TIKTOK_EVENT_NAMES.join(', ')}.`);
        error.code = 'INVALID_EVENT_NAME';
        throw error;
      }

      const enabled = row.enabled === undefined ? true : Boolean(row.enabled);
      const existente = await db('tiktok_capi_stage_events').where({ status_key: key }).first();

      if (existente) {
        await db('tiktok_capi_stage_events').where({ id: existente.id }).update({
          event_name: eventName || existente.event_name,
          enabled,
          updated_at: new Date()
        });
      } else if (eventName) {
        await db('tiktok_capi_stage_events').insert({
          status_key: key,
          event_name: eventName,
          enabled,
          updated_at: new Date()
        });
      }
    }

    return this.stages();
  }

  /**
   * Cuántos envíos hubo y en qué terminaron.
   *
   * Los `omitido` se cuentan aparte de los `error` por lo mismo que en la
   * conciliación: un omitido no falló, se decidió no mandarlo, y mezclarlos
   * hace que la pantalla muestre una alarma por el caso normal.
   */
  async summary() {
    const rows = await db('tiktok_capi_events')
      .select('state')
      .count({ total: '*' })
      .groupBy('state');

    const out = { enviado: 0, error: 0, omitido: 0 };
    for (const row of rows) out[row.state] = Number(row.total) || 0;
    return out;
  }

  /** ¿Este lead ya reportó este evento con éxito? */
  async alreadySent(leadId, eventName) {
    const row = await db('tiktok_capi_events')
      .where({ lead_id: leadId, event_name: eventName, state: 'enviado' })
      .first('id');
    return Boolean(row);
  }

  /**
   * Reporta un cambio de etapa. Devuelve `{ state, reason }` y **nunca lanza**.
   *
   * Lo llama `updateLeadStatus()`, donde una excepción dejaría el lead movido y
   * la respuesta en error: arrastrar una tarjeta en el Kanban no puede fallar
   * porque la Business API de TikTok esté caída. Y por lo mismo se lanza sin
   * esperarlo — un envío que falla se reenvía, un movimiento perdido no se
   * recupera.
   *
   * Los omitidos del caso normal (una etapa que nadie mapeó, un lead que no
   * vino de TikTok) **no** se anotan: son casi todos los movimientos y
   * llenarían la bitácora de filas que nadie lee. Sí se anota lo que se intentó
   * y no se pudo, que es lo que alguien tiene que ver.
   */
  async reportStageChange(lead, { status, movedAt = new Date(), stageChangeId = null } = {}) {
    try {
      const config = this.config();
      if (!config.enabled) return { state: 'omitido', reason: 'sin_configurar' };

      const stage = await this.activeStageFor(status);
      if (!stage) return { state: 'omitido', reason: 'etapa_no_reportada' };

      const tiktokLeadId = text(lead?.tiktok_lead_id);
      if (!tiktokLeadId) return { state: 'omitido', reason: 'sin_lead_id_de_tiktok' };

      const eventName = stage.event_name;
      if (await this.alreadySent(lead.id, eventName)) {
        return { state: 'omitido', reason: 'ya_enviado' };
      }

      const time = eventTimeFor({
        movedAt,
        tiktokCreatedAt: lead.tiktok_created_time,
        createdAt: lead.created_at
      });
      if (!time.ok) {
        await this.#log({
          lead, stage, eventName, tiktokLeadId, stageChangeId,
          state: 'omitido', reason: time.reason
        });
        return { state: 'omitido', reason: time.reason };
      }

      const event = buildEvent({
        eventName,
        eventTime: time.eventTime,
        tiktokLeadId,
        eventId: eventIdFor(lead.id, eventName)
      });

      const envio = await this.#send(config, event);

      await this.#log({
        lead,
        stage,
        eventName,
        tiktokLeadId,
        stageChangeId,
        eventTime: new Date(time.eventTime * 1000),
        state: envio.ok ? 'enviado' : 'error',
        reason: envio.ok ? time.reason : envio.reason,
        httpStatus: envio.httpStatus,
        tiktokCode: envio.tiktokCode,
        response: envio.body
      });

      return envio.ok
        ? { state: 'enviado', reason: time.reason }
        : { state: 'error', reason: envio.reason };
    } catch (error) {
      console.error('❌ [TikTok Events] No se pudo reportar el cambio de etapa:', error.message);
      return { state: 'error', reason: error.message };
    }
  }

  /**
   * ¿Hay alguna campaña que de verdad **optimice** por los eventos que mandamos?
   *
   * La pregunta existe porque la respuesta del Events API no la contesta: TikTok
   * acepta el evento, devuelve `code: 0`, y la campaña sigue optimizando a
   * clics si así está configurada. Esa es la versión TikTok del fallo silencioso
   * que en Meta era mandar al conjunto de datos equivocado — todo "funciona" y
   * nada mejora.
   *
   * Sin servicio de anuncios la respuesta es `no_comprobado` y **no** "todo
   * bien": dar por bueno lo que no se comprobó es el peor diagnóstico posible
   * (misma regla que `subscriptionState()` en la conciliación de Meta).
   */
  async checkEligibility() {
    const config = this.config();
    const eventos = (await this.stages()).filter((s) => s.enabled).map((s) => s.event_name);

    const base = {
      configurado: config.enabled,
      falta: config.missing,
      eventos_reportados: [...new Set(eventos)]
    };

    if (!this.ads) {
      return {
        ...base,
        estado: 'no_comprobado',
        detalle: 'No hay servicio de anuncios conectado, así que no se pudo leer el objetivo de '
          + 'optimización de los grupos. Que TikTok acepte los eventos no significa que alguna '
          + 'campaña aprenda de ellos.'
      };
    }

    try {
      const advertiser = await this.ads.resolveAdvertiser();
      const grupos = await this.ads.apiPaged('adgroup/get/', { advertiser_id: advertiser.id, page_size: 100 });

      const optimizando = grupos.filter((g) => OPTIMIZING_GOALS.has(String(g.optimization_goal || '').toUpperCase()));

      if (!grupos.length) {
        return { ...base, estado: 'sin_grupos', detalle: 'La cuenta no devolvió grupos de anuncios.' };
      }

      if (!optimizando.length) {
        return {
          ...base,
          estado: 'no_optimiza',
          grupos_totales: grupos.length,
          grupos_optimizando: 0,
          detalle: `Ninguno de los ${grupos.length} grupos optimiza por conversión: sus objetivos son `
            + `${[...new Set(grupos.map((g) => g.optimization_goal || 'sin objetivo'))].join(', ')}. `
            + 'Los eventos se van a aceptar y la campaña no va a aprender de ellos. Hay que cambiar el '
            + 'objetivo del grupo y configurar el evento en el origen, no mandar más eventos.'
        };
      }

      return {
        ...base,
        estado: 'optimiza',
        grupos_totales: grupos.length,
        grupos_optimizando: optimizando.length,
        detalle: `${optimizando.length} de ${grupos.length} grupos optimizan por conversión. `
          + 'Que optimicen no garantiza que sea por ESTOS eventos: eso se confirma en el origen de '
          + 'eventos de TikTok, donde cada evento tiene que figurar como recibido.'
      };
    } catch (error) {
      return {
        ...base,
        estado: 'no_comprobado',
        detalle: `No se pudo leer el objetivo de los grupos: ${error.message}. `
          + 'La integración puede estar enviando igual; lo que no se sabe es si algo aprende.'
      };
    }
  }

  /**
   * Lo enviado, para la pantalla.
   *
   * Incluye los errores y los omitidos anotados: la pregunta que se le hace a
   * esta lista es "¿por qué no llegó el de este lead?", y para eso hace falta
   * ver justamente lo que no se envió.
   */
  async recent({ limit = 50 } = {}) {
    const tope = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return db('tiktok_capi_events as e')
      .leftJoin('leads as l', 'l.id', 'e.lead_id')
      .select('e.*', 'l.full_name as lead_name')
      .orderBy('e.created_at', 'desc')
      .limit(tope);
  }

  /**
   * El POST al Events API.
   *
   * La Business API responde **HTTP 200 con el fallo adentro** (`code` distinto
   * de 0), así que mirar solo el estado HTTP da por enviado lo que se rechazó.
   * Es la misma trampa que en el resto de la integración de TikTok, y acá
   * costaría más caro: un evento rechazado que queda anotado como enviado no se
   * reintenta nunca.
   */
  async #send(config, event) {
    const payload = {
      event_source: 'crm',
      event_source_id: config.sourceId,
      data: [event]
    };

    let res;
    let body = '';
    try {
      res = await this.fetch(`${this.apiBase}/event/track/`, {
        method: 'POST',
        headers: { 'Access-Token': config.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      body = await res.text();
    } catch (error) {
      return { ok: false, reason: `red: ${error.message}`, httpStatus: null, tiktokCode: null, body: null };
    }

    let json = {};
    try { json = JSON.parse(body); } catch { json = {}; }

    const code = json.code === undefined ? null : Number(json.code);
    const ok = res.ok && (code === 0 || code === null);

    return {
      ok,
      reason: ok ? null : (json.message || `HTTP ${res.status}${code === null ? '' : ` / code ${code}`}`),
      httpStatus: res.status,
      tiktokCode: code,
      body: body ? body.slice(0, 2000) : null
    };
  }

  async #log({ lead, stage, eventName, tiktokLeadId, stageChangeId, eventTime = null, state, reason = null, httpStatus = null, tiktokCode = null, response = null }) {
    /*
     * Con `logEntries` puesto la bitácora se escribe en memoria. Existe para
     * las pruebas: lo que hay que poder probar sin base es cómo se LEE la
     * respuesta de TikTok —que responde HTTP 200 con el fallo adentro— y con
     * qué estado se registra, porque un rechazo anotado como enviado no se
     * reintenta nunca.
     */
    if (Array.isArray(this.logEntries)) {
      this.logEntries.push({ leadId: lead?.id || null, eventName, state, reason, httpStatus, tiktokCode });
      return;
    }

    try {
      await db('tiktok_capi_events').insert({
        lead_id: lead?.id || null,
        stage_change_id: stageChangeId || null,
        status_key: stage?.status_key || null,
        event_name: eventName || stage?.event_name || 'desconocido',
        event_time: eventTime,
        tiktok_lead_id: tiktokLeadId || null,
        state,
        reason: reason ? String(reason).slice(0, 255) : null,
        http_status: httpStatus,
        tiktok_code: tiktokCode,
        response
      });
    } catch (error) {
      // La bitácora no puede tumbar el envío ni el movimiento del lead: si falla
      // el registro, queda el log del proceso.
      console.error('❌ [TikTok Events] No se pudo registrar el envío:', error.message);
    }
  }
}
