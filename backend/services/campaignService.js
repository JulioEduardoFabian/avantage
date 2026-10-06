import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { campaignAdImageDir } from '../middleware/upload.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from './leadService.js';
import { loadWinningStatuses } from './salesFunnelStage.js';

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
const LOST_STATUSES = new Set(['perdido', 'descartado']);
const APPOINTMENT_STATUSES = new Set(['cita_agendada']);

/**
 * ¿Esta venta está cerrada? Dos caminos, y hacen falta los dos.
 *
 * `wonStatuses` viene de `loadWinningStatuses()` y depende de que la columna
 * del tablero esté marcada como `final`. `projectLeadIds` es el respaldo: si
 * alguien recrea esa columna sin marcarla, el lead seguiría teniendo su
 * proyecto abierto, y mostrar como "en espera de la reunión" a un cliente al
 * que ya se le está entregando trabajo es el peor de los dos errores posibles.
 *
 * Vive fuera de la clase para poder probarla sin base de datos: es una regla
 * de negocio, no una consulta.
 */
export function isWonLead(lead, wonStatuses, projectLeadIds) {
  if (!lead) return false;
  return wonStatuses.has(lead.status) || projectLeadIds.has(lead.id);
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
   * Primer mensaje entrante con `referral` de anuncio por contacto. Es el
   * "clic en el anuncio → escribió por WhatsApp" y define a qué anuncio se
   * atribuye ese contacto.
   */
  async #buildAttribution({ from, to } = {}) {
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
      firstByContact.set(row.wa_id, {
        waId: row.wa_id,
        contactName: row.contact_name || null,
        sourceId,
        headline: ref.headline || ref.body || null,
        sourceUrl: ref.source_url || null,
        platform: platformFromReferral(ref),
        firstMessageAt: row.received_at
      });
    }

    let list = [...firstByContact.values()];
    if (from) list = list.filter((a) => new Date(a.firstMessageAt) >= new Date(from));
    if (to) list = list.filter((a) => new Date(a.firstMessageAt) <= new Date(to));
    return list;
  }

  /**
   * Enriquece cada contacto atribuido con su recorrido real en el funnel.
   */
  async #enrichContacts(attribution) {
    const waIds = attribution.map((a) => a.waId);
    if (!waIds.length) return [];
    const phoneKeys = [...new Set(waIds.map(phoneMatchKey).filter(Boolean))];

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
      db('leads').whereIn(db.raw(PHONE_MATCH_KEY_SQL), phoneKeys)
        .select('id', 'phone', 'status', 'created_at', 'full_name', 'topic', 'overall_viability_score',
          // Correo y carrera solo los usa la hoja "Ruta de leads" del Excel.
          'email', 'field_of_study', 'sales_funnel_at'),
      db('whatsapp_bot_sessions').whereIn('wa_id', waIds)
        .select('wa_id', 'status', 'started_at', 'updated_at'),
      db('scheduled_meetings').whereIn('wa_id', waIds)
        .select('wa_id', 'lead_id', 'start_time', 'created_at')
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
    const sessionByWa = new Map(sessions.map((s) => [s.wa_id, s]));
    const meetingByWa = new Map();
    for (const m of meetings) {
      const prev = meetingByWa.get(m.wa_id);
      if (!prev || new Date(m.created_at) < new Date(prev.created_at)) meetingByWa.set(m.wa_id, m);
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

    if (leadIds.length) {
      const [quotes, contracts, income, projects] = await Promise.all([
        db('quotes').whereIn('lead_id', leadIds).orderBy('created_at', 'desc')
          .select('lead_id', 'amount', 'currency'),
        db('contracts').whereIn('lead_id', leadIds).whereNot('status', 'anulado')
          .select('lead_id'),
        db('finance_income').whereIn('lead_id', leadIds)
          .select('lead_id', 'monto', 'estado'),
        db('projects').whereIn('lead_id', leadIds).select('lead_id')
      ]);

      for (const project of projects) {
        if (project.lead_id) wonProjectLeadIds.add(project.lead_id);
      }

      for (const q of quotes) {
        if (!quoteByLead.has(q.lead_id)) quoteByLead.set(q.lead_id, q); // la más reciente
        proposalLeadIds.add(q.lead_id);
      }
      for (const c of contracts) proposalLeadIds.add(c.lead_id);
      for (const i of income) {
        const amount = Number(i.monto) || 0;
        billedByLead.set(i.lead_id, (billedByLead.get(i.lead_id) || 0) + amount);
        if (String(i.estado).toLowerCase() === 'pagado') {
          paidByLead.set(i.lead_id, (paidByLead.get(i.lead_id) || 0) + amount);
        }
        // Tener el cierre registrado en Finanzas implica que la propuesta ya
        // se hizo, aunque la cuota siga sin cobrarse.
        proposalLeadIds.add(i.lead_id);
      }
    }

    return attribution.map((a) => {
      const lead = leadByWa.get(phoneMatchKey(a.waId)) || null;
      const session = sessionByWa.get(a.waId) || null;
      const meeting = meetingByWa.get(a.waId) || null;
      const firstOut = firstOutByWa.get(a.waId) || null;

      const responded = !!firstOut;
      const qualified = (session && session.status === 'completed')
        || (lead && lead.overall_viability_score != null)
        || (lead && !['nuevo'].includes(lead.status));
      const hasAppointment = !!meeting || (lead && APPOINTMENT_STATUSES.has(lead.status));
      const won = isWonLead(lead, wonStatuses, wonProjectLeadIds);
      const lost = lead && LOST_STATUSES.has(lead.status);

      const quote = won && lead ? quoteByLead.get(lead.id) : null;
      const paidRevenue = lead ? paidByLead.get(lead.id) || 0 : 0;
      const billedRevenue = lead ? billedByLead.get(lead.id) || 0 : 0;
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
        firstResponseMinutes: minutesBetween(a.firstMessageAt, firstOut),
        qualifiedAt: session && session.status === 'completed' ? session.updated_at : null,
        meetingAt: meeting?.start_time || null,
        meetingBookedAt: meeting?.created_at || null,
        quotedValue: quote ? Number(quote.amount) : null,
        quotedCurrency: quote?.currency || null,
        paidRevenue,
        billedRevenue,
        hasProposal,
        crmStage,
        responded,
        qualified: !!qualified,
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
    const metaAd = metaAds.find((a) => String(a.adId) === sourceId)
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
  async #buildLeadTrail(contacts, campaigns, campaignByAd) {
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

    return contacts
      .slice()
      .sort((x, y) => new Date(y.firstMessageAt) - new Date(x.firstMessageAt))
      .map((c) => {
        const campaign = campaignByAd.get(c.sourceId) || null;
        const ad = this.#resolveContactAd(c, campaign, campaign ? metaAdsByCampaign.get(campaign.id) || [] : []);
        const lead = c.lead;

        return {
          leadId: lead?.id || null,
          name: lead?.full_name || c.contactName || c.waId,
          phone: c.waId,
          email: lead?.email || null,
          career: lead?.field_of_study || null,
          topic: lead?.topic || null,

          platform: c.platform || null,
          campaignId: campaign?.id || null,
          campaignName: campaign?.name || null,
          adsetName: ad.adsetName || null,
          adName: ad.adName || null,
          adHeadline: c.headline || null,
          adSourceId: ad.adSourceId || null,

          firstMessageAt: c.firstMessageAt,
          firstResponseMinutes: c.firstResponseMinutes,
          qualified: c.qualified,
          viability: c.viability,
          meetingAt: c.meetingAt,

          // Dónde está hoy: la columna del Kanban y, en paralelo, el cajón
          // comercial con el que se suman las cifras por anuncio.
          funnelColumn: lead ? (labelByKey.get(lead.status) || lead.status) : null,
          commercialStage: STAGE_LABELS[c.crmStage] || c.crmStage,

          quotedValue: c.quotedValue,
          paidRevenue: c.paidRevenue || 0,
          billedRevenue: c.billedRevenue || 0
        };
      });
  }

  #summariseGroup(contacts, campaign) {
    const conversations = contacts.length;
    const responded = contacts.filter((c) => c.responded).length;
    const qualified = contacts.filter((c) => c.qualified).length;
    const appointments = contacts.filter((c) => c.hasAppointment).length;
    const won = contacts.filter((c) => c.won).length;
    const lost = contacts.filter((c) => c.lost).length;

    const spend = campaign ? resolveSpend(campaign) : 0;
    const meta = campaign ? parseMetaInsights(campaign.meta_insights) : null;
    const metaAds = (campaign ? parseMetaInsights(campaign.meta_ads_insights) : null) || [];
    const quotedValue = contacts.reduce((sum, c) => sum + (c.quotedValue || 0), 0);

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
      { key: 'respondido', label: 'Avan respondió', count: responded },
      { key: 'calificado', label: 'Calificado (informe de viabilidad)', count: qualified },
      { key: 'cita_agendada', label: 'Cita agendada', count: appointments },
      { key: 'ganado', label: 'Ganado / matriculado', count: won }
    );

    return {
      funnel,
      metrics: {
        conversations,
        responded,
        qualified,
        appointments,
        won,
        lost,
        qualificationRate: rate(qualified, conversations),
        conversationToAppointmentRate: rate(appointments, conversations),
        appointmentToWonRate: rate(won, appointments),
        avgViability: (() => {
          const vals = contacts.map((c) => c.viability).filter((v) => v != null);
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        })(),
        medianFirstResponseMin: (() => {
          const m = median(contacts.map((c) => c.firstResponseMinutes));
          return m == null ? null : Math.round(m * 10) / 10;
        })(),
        spend,
        quotedValue,
        roas: spend > 0 && quotedValue > 0 ? Math.round((quotedValue / spend) * 100) / 100 : null,
        costPerConversation: perStage(conversations),
        costPerQualified: perStage(qualified),
        costPerAppointment: perStage(appointments),
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
          name: c.lead?.full_name || c.contactName || c.waId,
          leadId: c.lead?.id || null,
          topic: c.lead?.topic || null,
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
      const key = ad.adId ? `ad:${ad.adId}` : `src:${ad.adSourceId || 'sin-origen'}`;

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
          quotation: 0,
          followUp: 0,
          discarded: 0,
          won: 0,
          paidRevenue: 0,
          billedRevenue: 0,
          quotedValue: 0
        };
        groups.set(key, group);
      }

      group.leads += 1;
      if (c.responded) group.responded += 1;
      if (c.qualified) group.qualified += 1;
      if (c.hasAppointment) group.appointments += 1;
      if (c.crmStage === 'ganado') group.won += 1;
      else if (c.crmStage === 'cotizacion') group.quotation += 1;
      else if (c.crmStage === 'descartado') group.discarded += 1;
      else group.followUp += 1;
      group.paidRevenue += c.paidRevenue || 0;
      group.billedRevenue += c.billedRevenue || 0;
      group.quotedValue += c.quotedValue || 0;
      if (!group.headline && c.headline) group.headline = c.headline;
    }

    return [...groups.values()];
  }

  #buildTimeline(c) {
    const steps = [];
    const platformLabel = c.platform === 'instagram' ? 'Instagram' : c.platform === 'facebook' ? 'Facebook' : 'Meta';
    steps.push({ stage: `Escribió por WhatsApp desde el anuncio (${platformLabel})`, at: c.firstMessageAt });
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
      conversacion: 'Sin respuesta todavía'
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
      ? await this.#buildLeadTrail(contacts, campaigns, campaignByAd)
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
        totalSpend,
        totalQuotedValue: totalQuoted,
        roas: totalSpend > 0 && totalQuoted > 0 ? Math.round((totalQuoted / totalSpend) * 100) / 100 : null,
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
