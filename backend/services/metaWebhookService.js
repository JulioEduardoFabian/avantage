import crypto from 'crypto';
import { LeadService } from './leadService.js';
import { PageInteractionService } from './pageInteractionService.js';
import { PageMessageService } from './pageMessageService.js';
import {
  extractCustomFields,
  extractMetaLeadForm,
  formatCustomFieldsNote
} from './metaLeadFields.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

const MAX_RECENT_EVENTS = 50;

/*
 * La lectura del `field_data` vive en `metaLeadFields.js` (reglas puras, con
 * sus pruebas). Se re-exporta desde acá porque es el nombre por el que ya la
 * importan el backfill y los scripts.
 */
export { extractCustomFields, formatCustomFieldsNote, extractMetaLeadForm };

/**
 * Campos que se le piden a la Graph API por cada lead de un formulario
 * instantáneo. `ad_id`/`adset_id`/`campaign_id` son los que permiten
 * responder desde el panel "¿cuántos leads trajo este anuncio y cuántos
 * llegaron al CRM?" sin exportar a mano el CSV del Administrador de anuncios,
 * y `created_time` es el momento real del envío, distinto de cuándo el lead
 * entró a este sistema (ver la migración de atribución de Meta).
 *
 * Los tres `*_name` se piden aunque el nombre pueda resolverse después contra
 * las métricas sincronizadas de la campaña: ahí solo están los anuncios que
 * siguen entregando dentro de la ventana sincronizada, así que un anuncio
 * pausado, borrado o de un mes anterior dejaba al lead sin nombre de campaña y
 * la hoja de marketing lo mostraba como "Sin campaña asignada" teniendo su
 * `ad_id` guardado. El nombre que manda la API al momento del alta es el que
 * ese lead tuvo; el enlace sigue siendo por id.
 */
export const META_LEAD_FIELDS = 'id,created_time,field_data,form_id,platform,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name';

/**
 * Convierte la respuesta de la Graph API de UN lead en el prospecto del CRM.
 *
 * Es el único camino de alta de un lead de formulario: lo usan tanto el
 * webhook (`importLead`) como la conciliación que rescata los que el webhook
 * nunca llegó a procesar (`metaLeadReconciliationService`). Repetido en cada
 * llamador, el segundo termina guardando campos distintos que el primero y
 * las dos mitades de la misma tabla dejan de ser comparables — que es
 * exactamente el problema que la conciliación viene a medir.
 */
export async function persistMetaLead(leadService, data) {
  const leadgenId = String(data.id || '');

  // "platform" indica si el formulario se llenó en Facebook ("fb") o
  // Instagram ("ig"); sin ese dato, se etiqueta genéricamente como Meta Ads.
  const source = data.platform === 'ig' ? 'Instagram Ads' : data.platform === 'fb' ? 'Facebook Ads' : 'Meta Ads';

  /*
   * Las respuestas se leen por patrón y no por la clave exacta de Meta: los
   * formularios que se contestan dentro de Messenger o de Instagram traen
   * preguntas propias (`cual_es_tu_numero_de_celular`) en vez de las claves
   * canónicas (`phone_number`), y de esos leads entraba solo el nombre. Ver
   * `metaLeadFields.js`.
   */
  const form = extractMetaLeadForm(data.field_data);
  // El marcador sigue escribiéndose en las notas aunque el leadgen_id ya viva
  // en su propia columna: es lo que hace legible la ficha para el equipo, y
  // lo que permite reconocer estos leads si alguna vez hay que rehacer la
  // columna.
  const notesParts = [`[Meta leadgen_id=${leadgenId}] form_id=${data.form_id || 'desconocido'}`];
  const customNote = formatCustomFieldsNote(form);
  if (customNote) notesParts.push(customNote);

  const phone = form.phone || '';
  if (!phone) {
    // Un lead de formulario sin celular no se puede llamar ni cruzar contra la
    // ficha que ya exista, así que no puede quedarse en silencio: se deja
    // escrito qué preguntas SÍ mandó Meta, que es con lo que se corrige el
    // formulario (o este extractor) sin tener que reproducir el caso.
    const keys = (data.field_data || []).map((item) => item.name).join(', ') || 'ninguna';
    console.warn(`⚠️ [Meta Webhook] El lead ${leadgenId} llegó sin celular. Preguntas recibidas: ${keys}`);
  }

  const atribucion = {
    leadgenId: leadgenId || null,
    formId: data.form_id || null,
    adId: data.ad_id || null,
    adsetId: data.adset_id || null,
    campaignId: data.campaign_id || null,
    adName: data.ad_name || null,
    adsetName: data.adset_name || null,
    campaignName: data.campaign_name || null,
    platform: data.platform || null,
    createdTime: data.created_time || null
  };

  /*
   * Si ese teléfono YA es un lead, el envío se cuelga de esa ficha en vez de
   * abrir una segunda. Una persona es un lead, no uno por cada formulario que
   * llena. Duplicarla no es solo ruido: la fila nueva nace en "conversación
   * abierta" y, al indexar por teléfono, tapa a la que el equipo venía
   * trabajando — un contacto con cita agendada o ya ganado se cae de las
   * métricas de campaña (ver `esMejorLead` en campaignService.js).
   */
  const existente = phone ? await leadService.findByPhone(phone) : null;
  if (existente) {
    const lead = await leadService.attachMetaLeadToExisting(existente, {
      ...atribucion,
      note: notesParts.join('\n')
    });
    return { lead, created: false };
  }

  const lead = await leadService.createProspect({
    fullName: form.fullName || 'Prospecto de Facebook',
    email: form.email || '',
    phone,
    dni: form.dni,
    source,
    academicLevel: form.academicLevel,
    university: form.university,
    fieldOfStudy: form.fieldOfStudy,
    // Arranca igual que un contacto nuevo de WhatsApp que Avan todavía no
    // calificó: esta persona llenó el formulario pero nunca llegó a escribir
    // (o recibir) un mensaje de WhatsApp real, así que no es un lead comercial
    // todavía — debe quedarse en el Setter Funnel, no "graduar" directo al
    // Funnel de Ventas (ver SETTER_ONLY_STATUSES en LeadsView.vue).
    status: 'conversacion_abierta',
    additionalNotes: notesParts.join('\n'),
    metaLeadgenId: atribucion.leadgenId,
    metaFormId: atribucion.formId,
    metaAdId: atribucion.adId,
    metaAdsetId: atribucion.adsetId,
    metaCampaignId: atribucion.campaignId,
    metaAdName: atribucion.adName,
    metaAdsetName: atribucion.adsetName,
    metaCampaignName: atribucion.campaignName,
    metaPlatform: atribucion.platform,
    metaCreatedTime: atribucion.createdTime
  });

  return { lead, created: true };
}

/**
 * Recepción e importación de leads generados por Meta Lead Ads (Facebook/Instagram)
 * vía el webhook de la app de Meta (campo "leadgen").
 */
export class MetaWebhookService {
  constructor() {
    this.leadService = new LeadService();
    this.pageInteractionService = new PageInteractionService();
    this.pageMessageService = new PageMessageService();
    this.recentEvents = [];
  }

  /**
   * Guarda en memoria los últimos webhooks recibidos (de cualquier campo, no
   * solo "leadgen"), para poder verificar en la UI que Meta está llegando al
   * endpoint mientras se prueba la integración.
   */
  recordEvent({ body, signatureValid, hasSecret }) {
    this.recentEvents.unshift({
      id: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      signatureValid,
      hasSecret,
      body
    });
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.length = MAX_RECENT_EVENTS;
    }
  }

  getRecentEvents() {
    return this.recentEvents;
  }

  clearRecentEvents() {
    this.recentEvents = [];
  }

  /**
   * Valida el reto de verificación (GET) que envía Meta al configurar el webhook.
   */
  verifyChallenge(mode, token) {
    return mode === 'subscribe' && !!process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN;
  }

  /**
   * Valida la firma X-Hub-Signature-256 del payload (POST) usando el App Secret.
   */
  verifySignature(rawBody, signatureHeader) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || !rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const provided = signatureHeader.slice('sha256='.length);

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  /**
   * Procesa una entrada ("entry") del payload del webhook: importa los leads
   * del campo "leadgen", guarda las interacciones (comentarios, reacciones,
   * publicaciones, compartidos) del campo "feed", y los mensajes directos de
   * Messenger (formato "messaging", distinto al de "changes").
   */
  async handleEntry(entry) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      try {
        if (change.field === 'leadgen') {
          const leadgenId = change.value?.leadgen_id;
          if (leadgenId) await this.importLead(leadgenId);
        } else if (change.field === 'feed') {
          await this.pageInteractionService.createFromFeedChange(entry?.id, change.value || {});
        }
      } catch (error) {
        console.error(`❌ [Meta Webhook] Error al procesar el cambio de campo "${change.field}":`, error);
      }
    }

    const messagingEvents = entry?.messaging || [];
    for (const event of messagingEvents) {
      try {
        await this.pageMessageService.createFromMessagingEvent(entry?.id, event);
      } catch (error) {
        console.error('❌ [Meta Webhook] Error al procesar un evento de Messenger:', error);
      }
    }
  }

  /**
   * Recupera un lead desde la Graph API y lo registra como prospecto,
   * evitando duplicados si Meta reenvía el mismo evento.
   */
  async importLead(leadgenId) {
    const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (!pageAccessToken) {
      console.error('❌ [Meta Webhook] Falta META_PAGE_ACCESS_TOKEN en el entorno, no se puede recuperar el lead.');
      return null;
    }

    const existing = await this.leadService.findByMetaLeadgenId(leadgenId);
    if (existing) {
      console.log(`↩️ [Meta Webhook] Lead ${leadgenId} ya importado como prospecto #${existing.id}, se omite.`);
      return existing;
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=${META_LEAD_FIELDS}&access_token=${encodeURIComponent(pageAccessToken)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error('❌ [Meta Webhook] Error al recuperar el lead desde la Graph API:', data);
      return null;
    }

    console.log(`📋 [Meta Webhook] field_data del lead ${leadgenId}:`, JSON.stringify(data.field_data));

    const { lead, created } = await persistMetaLead(this.leadService, { ...data, id: data.id || leadgenId });

    console.log(created
      ? `📥 [Meta Webhook] Lead importado como prospecto #${lead.id} (leadgen_id=${leadgenId})`
      : `🔗 [Meta Webhook] Lead ${leadgenId} colgado del lead existente #${lead.id} (mismo teléfono).`);
    return lead;
  }
}
