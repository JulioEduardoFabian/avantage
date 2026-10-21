import { db } from '../db/connection.js';
import { WA_ID_MATCH_KEY_SQL, phoneKey } from './whatsappMessageService.js';
import { loadFunnelStageIndex, stageOptions } from './funnelStageLabel.js';

/**
 * Conversiones hacia Meta (Conversions API): devolverle a Meta en qué etapa
 * terminó cada lead que nos mandó.
 *
 * Hasta acá el circuito con Meta era de una sola dirección: sus formularios y
 * sus anuncios Click-to-WhatsApp nos dejan leads, y su optimización solo podía
 * perseguir "más formularios llenados" porque nunca se enteraba de lo que pasó
 * después. Esta es la vuelta: cuando un lead llega a una etapa clave, se le
 * manda a Meta un evento con la etapa y el momento, atado al identificador con
 * el que **Meta** reconoce a ese lead.
 *
 * ## Por qué no se hace a través de YCloud
 *
 * YCloud (el BSP de WhatsApp, ver `WHATSAPP_PROVIDER`) tiene su propio reporte
 * de conversiones, y a primera vista parecía el camino corto. No alcanza: solo
 * cubre las conversaciones nacidas de un anuncio Click-to-WhatsApp —los leads
 * de formulario instantáneo, que son la mayoría, no pasan por ahí— y solo
 * admite dos eventos (`Lead` y `Purchase`), cuando el funnel tiene etapas que
 * el equipo crea y renombra. Y para que YCloud supiera que un lead pasó a
 * "Cotizado" habría que llamarlo igual desde acá: un salto extra para un dato
 * que el CRM ya tiene y el proveedor no.
 *
 * ## Los dos identificadores
 *
 * Un lead solo se puede reportar si Meta puede reconocerlo, y hay exactamente
 * dos formas:
 *
 *   - `lead_id` — el `leads.meta_leadgen_id` de los formularios instantáneos,
 *     que ya se guarda en columna propia desde la conciliación. Va con
 *     `action_source: 'system_generated'` y `custom_data.event_source: 'crm'`:
 *     es el flujo "Conversions API for CRM".
 *   - `ctwa_clid` — el click id de los anuncios Click-to-WhatsApp, que viaja
 *     dentro del `referral` del primer mensaje del contacto y que
 *     `whatsapp_messages` ya guarda entero. Va con
 *     `action_source: 'business_messaging'` + `messaging_channel: 'whatsapp'`.
 *
 * Y cada uno va a **su propio conjunto de datos**, que es la parte que no se
 * adivina: el de CRM es el que se crea en Events Manager (Integraciones >
 * Conectar un nuevo origen de datos > CRM) y el de mensajería es el que Meta
 * tiene ligado a la cuenta de WhatsApp Business. Mandar los eventos de
 * Click-to-WhatsApp al conjunto de CRM no da error: los acepta y no los
 * atribuye a ningún anuncio, que es la peor forma de fallar. Por eso, sin
 * `META_CAPI_MESSAGING_DATASET_ID`, esa mitad queda apagada y lo dice en
 * pantalla, en vez de enviar a un destino que no sirve.
 *
 * Un lead del evaluador público o cargado a mano **no tiene ninguno de los
 * dos** y no se reporta: no hay a qué anuncio atribuirlo, y mandar el evento
 * sin identificador es un evento que Meta descarta.
 *
 * ## Reglas que vienen de la documentación de Meta y no de acá
 *
 *   - El `event_time` tiene que ser **posterior** a la generación del lead en
 *     Meta, o el evento se descarta. El piso es `meta_created_time` (el momento
 *     del envío del formulario) y no `created_at`, que es cuándo entró a esta
 *     base: un lead recuperado por la conciliación tres días después tiene las
 *     dos fechas muy separadas.
 *   - Los eventos se aceptan hasta **7 días** hacia atrás. Lo más viejo que eso
 *     no se intenta: queda registrado como omitido, que es distinto de fallar.
 *
 * ## Lo que nunca puede pasar
 *
 * Un fallo de este servicio **no puede tumbar el movimiento del lead**. Se
 * engancha en `leadService.updateLeadStatus()` —el punto único por el que
 * cambia `leads.status`, el mismo del que cuelgan la comisión de la setter y la
 * bitácora— y se lanza sin esperarlo: arrastrar una tarjeta en el Kanban no
 * puede quedarse esperando a que responda la Graph API. Todo intento, salga o
 * no, queda en `meta_capi_events`.
 */

/** Meta acepta eventos hasta 7 días hacia atrás. */
export const BACKFILL_WINDOW_DAYS = 7;

/** Nombre con el que Meta identifica de dónde salió el evento. */
const DEFAULT_LEAD_EVENT_SOURCE = 'Avantage CRM';

/**
 * Versión de la Graph API para ESTE endpoint, aparte de la global
 * (`META_GRAPH_API_VERSION`, hoy v21.0) y no cayendo a ella a propósito.
 *
 * La Conversions API crece por su cuenta: los campos de mensajería
 * (`ctwa_clid`, `messaging_channel`) son recientes, y una versión vieja no los
 * rechaza —acepta el evento y no atribuye nada—, que es la misma forma
 * silenciosa de fallar que mandar el evento al conjunto de datos equivocado.
 * Es la versión que el propio asistente de Events Manager entrega al crear el
 * conjunto de datos. La global se queda donde está porque de ella cuelgan los
 * webhooks, Instagram y las métricas de anuncios, que se probaron con esa.
 */
const DEFAULT_CAPI_VERSION = 'v26.0';

/**
 * `lead_id` es un entero de 15 a 17 dígitos y Meta pide no hashearlo. El
 * problema es JavaScript: a partir de 2^53 un entero pierde los últimos
 * dígitos, así que convertir a número un id de 17 dígitos lo convierte en el id
 * de otro lead (o de ninguno). Se manda como número cuando entra exacto y como
 * cadena cuando no: que Meta tenga que convertir un texto es un problema
 * menor que mandarle un id corrupto.
 */
export function leadIdValue(raw) {
  const digits = String(raw ?? '').trim();
  if (!/^\d+$/.test(digits)) return null;
  const asNumber = Number(digits);
  return Number.isSafeInteger(asNumber) ? asNumber : digits;
}

/**
 * Con qué identificador puede Meta reconocer a este lead, si puede.
 * `ctwaClid` es lo que se haya encontrado en el `referral` de su conversación.
 *
 * El `lead_id` manda sobre el `ctwa_clid` cuando están los dos: el formulario
 * es la atribución que Meta considera propia del lead, mientras que el click id
 * identifica una conversación.
 */
export function resolveIdentifier(lead, ctwaClid = null) {
  const leadId = leadIdValue(lead?.meta_leadgen_id);
  if (leadId !== null) return { kind: 'lead_id', value: leadId };
  const clid = String(ctwaClid || '').trim();
  return clid ? { kind: 'ctwa_clid', value: clid } : null;
}

/** Fecha → segundos Unix, que es lo que pide la Conversions API. */
function unix(value) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Qué `event_time` lleva el evento, o por qué no se manda.
 *
 * Dos reglas de Meta, escritas juntas porque las dos descartan el evento: no
 * puede ser anterior a la generación del lead, y no puede tener más de 7 días.
 * Cuando el movimiento quedó registrado con una hora anterior al nacimiento del
 * lead en Meta (relojes que no coinciden, un lead conciliado y movido en el
 * mismo minuto) se usa el nacimiento + 1 s: el movimiento ocurrió después, lo
 * que discrepa es el reloj.
 */
export function eventTimeFor({ movedAt, metaCreatedAt = null, createdAt = null, now = new Date() } = {}) {
  const moved = unix(movedAt);
  if (moved === null) return { ok: false, reason: 'El movimiento no tiene fecha válida.' };

  const nowUnix = unix(now);
  const limite = nowUnix - BACKFILL_WINDOW_DAYS * 86400;
  if (moved < limite) {
    return { ok: false, reason: `El movimiento tiene más de ${BACKFILL_WINDOW_DAYS} días: Meta ya no lo acepta.` };
  }

  const piso = unix(metaCreatedAt) ?? unix(createdAt);
  const eventTime = piso !== null && moved <= piso ? piso + 1 : moved;
  // Un evento con fecha futura (un reloj adelantado) también se descarta.
  return { ok: true, eventTime: Math.min(eventTime, nowUnix) };
}

/**
 * El evento tal como lo recibe la Conversions API. Dos formas según el
 * identificador, y es la única diferencia entre los dos orígenes:
 * `system_generated` + `event_source: 'crm'` para los leads de formulario,
 * `business_messaging` + `messaging_channel: 'whatsapp'` para los de
 * Click-to-WhatsApp.
 *
 * No viaja ningún importe. Es la misma regla que el resto del sistema —el
 * dinero vive en Finanzas, con su propio permiso— y acá además significa no
 * mandarle a Meta cuánto facturó cada cliente: para optimizar por calidad de
 * lead alcanza con la etapa.
 */
export function buildEvent({ eventName, eventTime, identifier, leadEventSource = DEFAULT_LEAD_EVENT_SOURCE }) {
  if (identifier.kind === 'ctwa_clid') {
    return {
      event_name: eventName,
      event_time: eventTime,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: { ctwa_clid: identifier.value }
    };
  }

  return {
    event_name: eventName,
    event_time: eventTime,
    action_source: 'system_generated',
    user_data: { lead_id: identifier.value },
    custom_data: { lead_event_source: leadEventSource, event_source: 'crm' }
  };
}

/**
 * A qué conjunto de datos va el evento según con qué se identifica el lead.
 *
 * Son dos destinos distintos y no es un detalle de configuración: el conjunto
 * de CRM es el que lleva el flujo "Conversion Leads" y entiende un `lead_id`,
 * y el de mensajería es el que Meta mantiene ligado a la cuenta de WhatsApp
 * Business, que es el único contra el que un `ctwa_clid` se puede atribuir al
 * anuncio. Cruzarlos no devuelve error: Meta acepta el evento y no lo atribuye
 * a nada, así que la campaña sigue optimizando a ciegas y nadie se entera.
 */
export function datasetFor(identifierKind, { datasetId, messagingDatasetId } = {}) {
  return (identifierKind === 'ctwa_clid' ? messagingDatasetId : datasetId) || null;
}

export class MetaConversionsService {
  constructor({ fetchImpl = null } = {}) {
    // Inyectable para las pruebas: nada en este servicio tiene que llamar a
    // Meta de verdad para poder verificarse.
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
  }

  /**
   * Lo que hace falta para poder enviar, leído del `.env` en cada uso (no
   * cacheado: un despliegue que agrega el token no debería necesitar reinicio
   * del proceso para que la pantalla lo note).
   *
   * El token cae a `META_ADS_ACCESS_TOKEN` porque es el que ya tiene permisos
   * de anuncios (`ads_management`), que es exactamente lo que pide la
   * Conversions API. No cae a `META_PAGE_ACCESS_TOKEN`: ese es de Página y
   * sirve para otra cosa.
   */
  config() {
    const datasetId = String(process.env.META_CAPI_DATASET_ID || '').trim();
    const messagingDatasetId = String(process.env.META_CAPI_MESSAGING_DATASET_ID || '').trim();
    const accessToken = String(
      process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ADS_ACCESS_TOKEN || ''
    ).trim();
    return {
      datasetId,
      messagingDatasetId,
      accessToken,
      version: String(process.env.META_CAPI_GRAPH_API_VERSION || '').trim() || DEFAULT_CAPI_VERSION,
      testEventCode: String(process.env.META_CAPI_TEST_EVENT_CODE || '').trim() || null,
      leadEventSource: String(process.env.META_CAPI_LEAD_EVENT_SOURCE || '').trim() || DEFAULT_LEAD_EVENT_SOURCE,
      enabled: Boolean(accessToken && (datasetId || messagingDatasetId))
    };
  }

  /** El mapeo etapa → evento, tal como lo dejó el equipo. */
  async mapping() {
    return db('meta_capi_stage_events').orderBy('status_key');
  }

  /**
   * Guarda el mapeo completo: cada fila es `{ statusKey, eventName, enabled }`.
   * Una etapa sin nombre de evento se borra en vez de guardarse vacía — es la
   * forma de sacar una etapa del reporte sin dejar una fila que no significa
   * nada (mismo criterio que las excepciones de permisos que repiten el rol).
   */
  async saveMapping(rows = []) {
    for (const row of rows) {
      const statusKey = String(row?.statusKey || '').trim().slice(0, 60);
      if (!statusKey) continue;
      const eventName = String(row?.eventName || '').trim().slice(0, 60);

      if (!eventName) {
        await db('meta_capi_stage_events').where({ status_key: statusKey }).del();
        continue;
      }

      const patch = { event_name: eventName, enabled: Boolean(row.enabled), updated_at: db.fn.now() };
      const updated = await db('meta_capi_stage_events').where({ status_key: statusKey }).update(patch);
      if (!updated) {
        await db('meta_capi_stage_events').insert({ status_key: statusKey, ...patch });
      }
    }
    return this.mapping();
  }

  /**
   * Todas las etapas que un lead puede tener, para poder mapear las que
   * falten: las columnas de los dos tableros más los desenlaces fijos. Es la
   * misma lista que ofrece el filtro del Reporte de Leads (`stageOptions()`),
   * no una copia: una etapa renombrada en el Kanban tiene que leerse igual en
   * las dos pantallas.
   */
  async availableStages() {
    return stageOptions(await loadFunnelStageIndex());
  }

  /** La etapa mapeada y encendida para este status, o nada. */
  async activeStageFor(status) {
    if (!status) return null;
    const row = await db('meta_capi_stage_events').where({ status_key: status }).first();
    return row && row.enabled ? row : null;
  }

  /**
   * El `ctwa_clid` del lead: sale del `referral` del primer mensaje de su
   * conversación, que es el único que lo trae (Meta no lo repite en los
   * siguientes).
   *
   * Se cruza por los últimos 9 dígitos del teléfono, con la pareja
   * `phoneKey`/`WA_ID_MATCH_KEY_SQL` que ya empareja leads con conversaciones:
   * la ficha y el webhook escriben el número distinto. Se usa esa y no
   * `phoneMatchKey` de leadService para no importar leadService, que a su vez
   * importa este servicio — y porque `phoneKey` descarta además los
   * identificadores que no son teléfonos (los BSUID de Instagram).
   */
  async ctwaClidFor(lead) {
    const identificador = String(lead?.phone || '').trim();
    if (!identificador) return null;

    /*
     * Primero la coincidencia EXACTA y después los últimos 9 dígitos, el mismo
     * orden que `resolveWaIdForPhone()`. La exacta no es una optimización: hay
     * conversaciones cuyo `wa_id` no es un teléfono sino un identificador de
     * usuario de la empresa (`PE.2379096279586501`), y el lead que nace de
     * ellas guarda ESE texto en `phone`. Para esos, `phoneKey()` devuelve null
     * —con razón: no son teléfonos y emparejarlos por sus últimos dígitos
     * cruzaría contactos distintos—, así que sin este primer paso se quedaban
     * sin reportar, y son una parte grande de los leads de Click-to-WhatsApp.
     */
    const clid = await this.#clidFromMessages((query) => query.where('wa_id', identificador));
    if (clid) return clid;

    const key = phoneKey(identificador);
    if (!key) return null;
    return this.#clidFromMessages((query) => query.whereRaw(`${WA_ID_MATCH_KEY_SQL} = ?`, [key]));
  }

  /**
   * El primer `ctwa_clid` de los mensajes que elija `filtro`. Se miran los
   * primeros con referral y no solo el primero: Meta manda el click id en el
   * mensaje que abre la conversación, pero si esa fila quedó guardada sin él
   * (un payload recortado) el del siguiente anuncio sirve igual.
   */
  async #clidFromMessages(filtro) {
    const rows = await filtro(db('whatsapp_messages'))
      .whereNotNull('referral')
      .orderBy('received_at', 'asc')
      .limit(5)
      .select('referral');

    for (const row of rows) {
      const referral = typeof row.referral === 'string' ? safeParse(row.referral) : row.referral;
      const clid = referral?.ctwa_clid || referral?.ctwaClid || null;
      if (clid) return String(clid);
    }
    return null;
  }

  /** ¿Este lead ya reportó este evento con éxito? */
  async alreadySent(leadId, eventName) {
    const row = await db('meta_capi_events')
      .where({ lead_id: leadId, event_name: eventName, state: 'enviado' })
      .first('id');
    return Boolean(row);
  }

  /**
   * Reporta un cambio de etapa. Devuelve `{ state, reason }` y **nunca lanza**:
   * lo llama `updateLeadStatus()`, donde una excepción dejaría el lead movido y
   * la respuesta en error.
   *
   * Los `skipped` no se guardan en la bitácora salvo que digan algo que haya
   * que arreglar: una etapa que nadie mapeó o un lead que no vino de Meta son
   * el caso normal de casi todos los movimientos, y anotarlos llenaría la
   * tabla de filas que no se leen. Sí se anota lo que se intentó y no se pudo
   * (fuera de ventana, error de Meta), que es lo que alguien tiene que ver.
   */
  async reportStageChange(lead, { status, movedAt = new Date(), stageChangeId = null } = {}) {
    try {
      const config = this.config();
      if (!config.enabled) return { state: 'omitido', reason: 'sin_configurar' };

      const stage = await this.activeStageFor(status);
      if (!stage) return { state: 'omitido', reason: 'etapa_no_reportada' };

      const identifier = resolveIdentifier(lead, await this.ctwaClidFor(lead));
      if (!identifier) return { state: 'omitido', reason: 'sin_atribucion_meta' };

      // Cada origen tiene su conjunto de datos. Si falta el que le toca, no se
      // manda al otro: se omite, y la pantalla lo muestra como configuración
      // incompleta (no se anota en la bitácora porque se repetiría en cada
      // movimiento de cada lead hasta que alguien lo configure).
      const dataset = datasetFor(identifier.kind, config);
      if (!dataset) {
        return {
          state: 'omitido',
          reason: identifier.kind === 'ctwa_clid' ? 'sin_dataset_de_mensajes' : 'sin_dataset_de_crm'
        };
      }

      if (await this.alreadySent(lead.id, stage.event_name)) {
        return { state: 'omitido', reason: 'ya_enviado' };
      }

      const time = eventTimeFor({
        movedAt,
        metaCreatedAt: lead.meta_created_time,
        createdAt: lead.created_at
      });
      if (!time.ok) {
        await this.#log({ lead, stage, identifier, stageChangeId, state: 'omitido', reason: time.reason });
        return { state: 'omitido', reason: time.reason };
      }

      const event = buildEvent({
        eventName: stage.event_name,
        eventTime: time.eventTime,
        identifier,
        leadEventSource: config.leadEventSource
      });

      const result = await this.sendEvents([event], config, dataset);
      await this.#log({
        lead,
        stage,
        identifier,
        stageChangeId,
        eventTime: new Date(time.eventTime * 1000),
        state: result.ok ? 'enviado' : 'error',
        reason: result.ok ? null : result.error,
        httpStatus: result.httpStatus,
        response: result.body
      });

      if (result.ok) {
        console.log(`📤 [Meta CAPI] Lead #${lead.id} → "${stage.event_name}" (${identifier.kind}).`);
      } else {
        console.error(`❌ [Meta CAPI] Lead #${lead.id} → "${stage.event_name}": ${result.error}`);
      }
      return { state: result.ok ? 'enviado' : 'error', reason: result.error || null };
    } catch (error) {
      console.error(`❌ [Meta CAPI] No se pudo reportar el lead #${lead?.id}:`, error.message);
      return { state: 'error', reason: error.message };
    }
  }

  /**
   * POST a la Conversions API. Un lote por llamada y no un acumulador en
   * memoria: Meta descarta el lote entero si una fila viene mal, así que un
   * evento con un id raro no puede arrastrar a los demás.
   */
  async sendEvents(events, config = this.config(), datasetId = config.datasetId) {
    if (!config.accessToken) return { ok: false, error: 'Falta el token de acceso de Meta.' };
    if (!datasetId) return { ok: false, error: 'Falta el conjunto de datos (dataset) de Meta.' };

    const url = `https://graph.facebook.com/${config.version}/${datasetId}/events`;
    const payload = { data: events, access_token: config.accessToken };
    if (config.testEventCode) payload.test_event_code = config.testEventCode;

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = await response.text();

      if (!response.ok) {
        return { ok: false, httpStatus: response.status, body, error: errorMessageFrom(body, response.status) };
      }
      return { ok: true, httpStatus: response.status, body };
    } catch (error) {
      // Una caída de red no es un evento rechazado: queda como error con su
      // motivo y se puede reenviar mientras esté dentro de los 7 días.
      return { ok: false, error: `No se pudo contactar a Meta: ${error.message}` };
    }
  }

  /**
   * Reenvía los movimientos de etapa de los últimos 7 días que debían
   * reportarse y todavía no lo hicieron — porque la integración se acaba de
   * configurar, porque Meta devolvió un error o porque el proceso estaba caído.
   *
   * Existe por la ventana de Meta: lo que no se mande en 7 días ya no entra
   * nunca, así que no puede depender de que alguien se dé cuenta el mismo día.
   * Lee `lead_stage_changes` (los movimientos **no** bloqueados) y pasa cada
   * uno por el mismo `reportStageChange()`, así el reenvío no puede aplicar
   * reglas distintas que el envío normal.
   */
  async backfill({ limit = 200 } = {}) {
    const config = this.config();
    if (!config.enabled) return { sent: 0, skipped: 0, failed: 0, reason: 'sin_configurar' };

    const desde = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86400 * 1000);
    const activos = await db('meta_capi_stage_events').where({ enabled: true }).pluck('status_key');
    if (activos.length === 0) return { sent: 0, skipped: 0, failed: 0, reason: 'sin_etapas' };

    const movimientos = await db('lead_stage_changes as c')
      .join('leads', 'leads.id', 'c.lead_id')
      .where('c.blocked', false)
      .whereIn('c.to_status', activos)
      .where('c.created_at', '>=', desde)
      .orderBy('c.created_at', 'asc')
      .limit(limit)
      .select('c.id', 'c.lead_id', 'c.to_status', 'c.created_at', 'leads.*');

    const resumen = { sent: 0, skipped: 0, failed: 0 };
    for (const fila of movimientos) {
      const { state } = await this.reportStageChange(fila, {
        status: fila.to_status,
        movedAt: fila.created_at,
        stageChangeId: fila.id
      });
      if (state === 'enviado') resumen.sent += 1;
      else if (state === 'error') resumen.failed += 1;
      else resumen.skipped += 1;
    }
    return resumen;
  }

  /**
   * Un evento de prueba **por cada conjunto de datos configurado**, con un lead
   * real de ESE origen.
   *
   * Dos razones para que sean dos pruebas y no una: un identificador inventado
   * lo rechaza Meta —así que la prueba no probaría nada— y, sobre todo, las dos
   * mitades fallan por motivos distintos. El conjunto de CRM puede andar
   * perfecto mientras el de mensajería rechaza por permisos del token, y
   * probar solo el primero diría que "todo está bien" justo cuando la mitad
   * grande del volumen no está saliendo.
   *
   * Con `META_CAPI_TEST_EVENT_CODE` puesto, Meta los muestra en "Probar
   * eventos" sin contarlos en las métricas.
   *
   * Es la ÚNICA forma fiable de saber si un conjunto de datos acepta nuestros
   * eventos, y conviene no reemplazarla por algo más barato. Hubo dos intentos
   * de diagnóstico sin enviar nada y los dos mintieron: un GET al objeto
   * devuelve "(#100) Missing Permission" hasta para el conjunto que funciona
   * (el token del Administrador de eventos puede enviar pero no leer), y un
   * POST con la lista de eventos vacía da por buena la ruta porque Meta valida
   * el payload antes que el permiso. Solo un evento de verdad recorre el
   * camino de verdad.
   */
  async sendTestEvent() {
    const config = this.config();
    if (!config.accessToken) {
      return { ok: false, error: 'Falta el token de acceso (META_CAPI_ACCESS_TOKEN o META_ADS_ACCESS_TOKEN).', results: [] };
    }

    const candidatos = [];
    if (config.datasetId) {
      candidatos.push({ origin: 'lead_id', label: 'Leads de formulario', lead: await this.#leadConFormulario() });
    }
    if (config.messagingDatasetId) {
      candidatos.push({ origin: 'ctwa_clid', label: 'Leads de Click-to-WhatsApp', lead: await this.#leadConCtwa() });
    }

    if (candidatos.length === 0) {
      return { ok: false, error: 'No hay ningún conjunto de datos configurado todavía.', results: [] };
    }

    const results = [];
    for (const candidato of candidatos) {
      if (!candidato.lead) {
        results.push({
          origin: candidato.origin,
          label: candidato.label,
          ok: false,
          error: candidato.origin === 'lead_id'
            ? 'No hay ningún lead con `lead_id` de un formulario de Meta todavía.'
            : 'No hay ningún lead cuya conversación traiga un `ctwa_clid` todavía.'
        });
        continue;
      }

      const identifier = resolveIdentifier(
        candidato.origin === 'ctwa_clid' ? { ...candidato.lead, meta_leadgen_id: null } : candidato.lead,
        candidato.clid || (await this.ctwaClidFor(candidato.lead))
      );
      if (!identifier) {
        results.push({ origin: candidato.origin, label: candidato.label, ok: false, error: 'No se pudo resolver el identificador del lead.' });
        continue;
      }

      const event = buildEvent({
        eventName: 'Prueba de integración',
        eventTime: Math.floor(Date.now() / 1000),
        identifier,
        leadEventSource: config.leadEventSource
      });
      const result = await this.sendEvents([event], config, datasetFor(identifier.kind, config));
      results.push({
        origin: candidato.origin,
        label: candidato.label,
        ok: result.ok,
        error: result.error || null,
        leadId: candidato.lead.id,
        identifierKind: identifier.kind,
        dataset: datasetFor(identifier.kind, config)
      });
    }

    return {
      ok: results.every((r) => r.ok),
      error: results.every((r) => r.ok) ? null : results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.error}`).join(' · '),
      results,
      testEventCode: config.testEventCode
    };
  }

  /** El lead más reciente con `lead_id` de un formulario instantáneo. */
  async #leadConFormulario() {
    return db('leads').whereNotNull('meta_leadgen_id').orderBy('id', 'desc').first();
  }

  /**
   * Un lead cuya conversación traiga un `ctwa_clid`. Se recorren las
   * conversaciones de anuncio más recientes y se busca su lead con los MISMOS
   * dos caminos de `ctwaClidFor()` (exacto y por los últimos 9 dígitos): la
   * prueba tiene que recorrer el camino real, no uno parecido.
   */
  async #leadConCtwa() {
    const filas = await db('whatsapp_messages')
      .whereNotNull('referral')
      .where('referral', 'like', '%ctwa_clid%')
      .orderBy('received_at', 'desc')
      .limit(25)
      .select('wa_id');

    for (const fila of filas) {
      const waId = String(fila.wa_id || '');
      const exacto = await db('leads').where('phone', waId).orderBy('id', 'desc').first();
      if (exacto) return exacto;

      const key = phoneKey(waId);
      if (!key) continue;
      const porSufijo = await db('leads')
        .whereRaw(`RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9) = ?`, [key])
        .orderBy('id', 'desc')
        .first();
      if (porSufijo) return porSufijo;
    }
    return null;
  }

  /** Los últimos envíos, para la pantalla. */
  async recentEvents({ limit = 30 } = {}) {
    const rows = await db('meta_capi_events as e')
      .leftJoin('leads', 'leads.id', 'e.lead_id')
      .orderBy('e.created_at', 'desc')
      .orderBy('e.id', 'desc')
      .limit(limit)
      .select(
        'e.id',
        'e.lead_id',
        'e.status_key',
        'e.event_name',
        'e.event_time',
        'e.identifier_kind',
        'e.state',
        'e.reason',
        'e.http_status',
        'e.created_at',
        'leads.full_name as lead_name'
      );
    return rows;
  }

  /** Cuántos envíos salieron, fallaron o se omitieron en los últimos 7 días. */
  async summary() {
    const desde = new Date(Date.now() - BACKFILL_WINDOW_DAYS * 86400 * 1000);
    const rows = await db('meta_capi_events')
      .where('created_at', '>=', desde)
      .groupBy('state')
      .select('state', db.raw('COUNT(*) as n'));

    const resumen = { enviado: 0, error: 0, omitido: 0 };
    for (const row of rows) resumen[row.state] = Number(row.n || 0);
    return resumen;
  }

  async #log({ lead, stage, identifier, stageChangeId, eventTime = null, state, reason = null, httpStatus = null, response = null }) {
    try {
      await db('meta_capi_events').insert({
        lead_id: lead?.id || null,
        stage_change_id: stageChangeId || null,
        status_key: stage?.status_key || null,
        event_name: stage?.event_name || '',
        event_time: eventTime,
        identifier_kind: identifier?.kind || null,
        // Del `ctwa_clid` se guarda el dato entero porque es lo que hace
        // rastreable el envío; no es un dato personal, es un id de clic.
        identifier: identifier ? String(identifier.value).slice(0, 255) : null,
        state,
        reason: reason ? String(reason).slice(0, 255) : null,
        http_status: httpStatus,
        response: response ? String(response).slice(0, 4000) : null
      });
    } catch (error) {
      console.error('❌ [Meta CAPI] No se pudo registrar el envío:', error.message);
    }
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * El mensaje de error de Meta, que viene dentro de `error.message` del cuerpo.
 * Se saca acá para que la pantalla lo muestre tal cual: "el evento se descartó
 * porque el lead_id no existe" es accionable, "HTTP 400" no.
 */
function errorMessageFrom(body, httpStatus) {
  const parsed = safeParse(body);
  const message = parsed?.error?.error_user_msg || parsed?.error?.message;
  return message ? String(message) : `Meta respondió HTTP ${httpStatus}.`;
}
