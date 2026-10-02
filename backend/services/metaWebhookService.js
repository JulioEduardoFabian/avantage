import crypto from 'crypto';
import { LeadService } from './leadService.js';
import { PageInteractionService } from './pageInteractionService.js';
import { PageMessageService } from './pageMessageService.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

const MAX_RECENT_EVENTS = 50;

/** Sin tildes/mayúsculas y con guiones/guiones bajos como espacio, para comparar contra la clave de una pregunta del formulario sea cual sea el formato en que Meta la mande. */
function normalizeFieldKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Título profesional" / "Maestría" / etc. -> uno de los tres niveles canónicos, o null. */
function mapAcademicLevel(value) {
  const v = normalizeFieldKey(value);
  if (/doctorado/.test(v)) return 'Posgrado (Doctorado)';
  if (/maestria|magister|master/.test(v)) return 'Posgrado (Maestría)';
  if (/bachiller|titulo|pregrado|licenciatura/.test(v)) return 'Pregrado (Bachiller/Título)';
  return null;
}

/**
 * Las respuestas de opción múltiple de un formulario de Meta Lead Ads a
 * veces llegan como la CLAVE interna de la opción ("estoy_con_el_proyecto")
 * en vez del texto que la persona vio y eligió ("Estoy con el proyecto") —
 * caso real: la misma respuesta que en el visor nativo de Meta se ve
 * legible llegaba así por la Graph API. Si el valor tiene esa forma
 * (todo en snake_case/kebab-case, sin espacios ni mayúsculas), se convierte
 * a texto legible; un valor que ya viene con espacios o mayúsculas propias
 * (como "UNDAC" o "Título profesional") se deja tal cual.
 */
function prettifyFormValue(value) {
  const v = String(value || '').trim();
  if (!v || !/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(v)) return v;
  const words = v.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Mismas preguntas que ya reconoce extractLeadFormFields() en
// whatsappBotService.js para el resumen que llega por WhatsApp — acá se
// comparan contra la CLAVE de cada pregunta del formulario de Meta Lead Ads
// (no contra texto libre), que suele conservar palabras de la pregunta
// original aunque venga en snake_case.
const LEVEL_KEY_RE = /sacando|nivel academ|grado academ/;
const UNIVERSITY_KEY_RE = /universidad/;
const FIELD_KEY_RE = /carrera/;
const PROGRESS_KEY_RE = /punto|avanzad|avance|estado.*tesis/;

/**
 * Extrae grado académico, universidad, carrera y avance declarado a partir
 * del `field_data` que devuelve la Graph API para un lead de Meta Lead Ads
 * (formulario instantáneo) — sin esto, esas respuestas quedaban capturadas
 * por Meta pero nunca se guardaban en el lead (solo nombre/teléfono/correo),
 * y la ficha del lead se veía con los valores por defecto ("General", "No
 * especificada") aunque la persona sí los hubiera contestado.
 */
export function extractCustomFields(fieldData) {
  const extracted = {};
  for (const item of fieldData || []) {
    const key = normalizeFieldKey(item.name);
    const value = (item.values?.[0] || '').trim();
    if (!key || !value) continue;

    if (!extracted.academicLevel && LEVEL_KEY_RE.test(key)) {
      const level = mapAcademicLevel(value);
      if (level) extracted.academicLevel = level;
    } else if (!extracted.university && UNIVERSITY_KEY_RE.test(key)) {
      extracted.university = prettifyFormValue(value);
    } else if (!extracted.fieldOfStudy && FIELD_KEY_RE.test(key)) {
      extracted.fieldOfStudy = prettifyFormValue(value);
    } else if (!extracted.progressNote && PROGRESS_KEY_RE.test(key)) {
      extracted.progressNote = prettifyFormValue(value);
    }
  }
  return extracted;
}

/**
 * Arma el bloque de notas legible con lo que se pudo extraer del
 * formulario ("Grado académico: ...", "Universidad: ...", etc.) — mismo
 * estilo de etiquetas que ya usa whatsappBotService.finalize() para las
 * notas de un lead calificado por WhatsApp, para que el equipo vea el
 * mismo formato sea cual sea el origen del lead.
 */
export function formatCustomFieldsNote(custom) {
  const lines = [];
  if (custom.academicLevel) lines.push(`Grado académico: ${custom.academicLevel}`);
  if (custom.fieldOfStudy) lines.push(`Carrera: ${custom.fieldOfStudy}`);
  if (custom.university) lines.push(`Universidad: ${custom.university}`);
  if (custom.progressNote) lines.push(`Avance declarado: ${custom.progressNote}`);
  return lines.join('\n');
}

/**
 * Campos que se le piden a la Graph API por cada lead de un formulario
 * instantáneo. `ad_id`/`adset_id`/`campaign_id` son los que permiten
 * responder desde el panel "¿cuántos leads trajo este anuncio y cuántos
 * llegaron al CRM?" sin exportar a mano el CSV del Administrador de anuncios,
 * y `created_time` es el momento real del envío, distinto de cuándo el lead
 * entró a este sistema (ver la migración de atribución de Meta).
 */
export const META_LEAD_FIELDS = 'id,created_time,field_data,form_id,platform,ad_id,adset_id,campaign_id';

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

  const fields = {};
  for (const item of data.field_data || []) {
    fields[item.name] = item.values?.[0] || '';
  }

  // "platform" indica si el formulario se llenó en Facebook ("fb") o
  // Instagram ("ig"); sin ese dato, se etiqueta genéricamente como Meta Ads.
  const source = data.platform === 'ig' ? 'Instagram Ads' : data.platform === 'fb' ? 'Facebook Ads' : 'Meta Ads';

  const custom = extractCustomFields(data.field_data);
  // El marcador sigue escribiéndose en las notas aunque el leadgen_id ya viva
  // en su propia columna: es lo que hace legible la ficha para el equipo, y
  // lo que permite reconocer estos leads si alguna vez hay que rehacer la
  // columna.
  const notesParts = [`[Meta leadgen_id=${leadgenId}] form_id=${data.form_id || 'desconocido'}`];
  const customNote = formatCustomFieldsNote(custom);
  if (customNote) notesParts.push(customNote);

  return leadService.createProspect({
    fullName: fields.full_name || fields.nombre_completo || 'Prospecto de Facebook',
    email: fields.email || fields.correo_electronico || '',
    phone: fields.phone_number || fields.phone || '',
    source,
    academicLevel: custom.academicLevel,
    university: custom.university,
    fieldOfStudy: custom.fieldOfStudy,
    // Arranca igual que un contacto nuevo de WhatsApp que Avan todavía no
    // calificó: esta persona llenó el formulario pero nunca llegó a escribir
    // (o recibir) un mensaje de WhatsApp real, así que no es un lead comercial
    // todavía — debe quedarse en el Setter Funnel, no "graduar" directo al
    // Funnel de Ventas (ver SETTER_ONLY_STATUSES en LeadsView.vue).
    status: 'conversacion_abierta',
    additionalNotes: notesParts.join('\n'),
    metaLeadgenId: leadgenId || null,
    metaFormId: data.form_id || null,
    metaAdId: data.ad_id || null,
    metaAdsetId: data.adset_id || null,
    metaCampaignId: data.campaign_id || null,
    metaPlatform: data.platform || null,
    metaCreatedTime: data.created_time || null
  });
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

    const prospect = await persistMetaLead(this.leadService, { ...data, id: data.id || leadgenId });

    console.log(`📥 [Meta Webhook] Lead importado como prospecto #${prospect.id} (leadgen_id=${leadgenId})`);
    return prospect;
  }
}
