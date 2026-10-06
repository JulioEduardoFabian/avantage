import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { whatsappMediaDir } from '../middleware/upload.js';
import { isAdFormMessage } from './whatsappBotService.js';
import { WhisperService } from './whisperService.js';

const whisperService = new WhisperService();

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
// "meta" (Graph API directa) o "ycloud" (proveedor usado tras vincular el
// número en modo coexistencia vía YCloud, cuando no se llegó a completar el
// alta como Tech Provider de Meta). Ver .env.example.
const WHATSAPP_PROVIDER = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();
const YCLOUD_API_BASE = 'https://api.ycloud.com/v2/whatsapp';

/** YCloud exige el número en formato internacional con "+"; el wa_id de Meta no lo trae. */
function toE164(waId) {
  return waId.startsWith('+') ? waId : `+${waId}`;
}

/**
 * Clave para emparejar un teléfono con un wa_id: los últimos 9 dígitos, que es
 * el número nacional en Perú. El mismo contacto aparece como "+51934819600",
 * "51934819600" o "934819600" según de dónde venga el dato (webhook, formulario
 * de un anuncio, carga manual), y compararlos tal cual no emparejaba nunca.
 *
 * Devuelve null para los identificadores que no son teléfonos (los BSUID de
 * Instagram/Facebook, tipo "PE.2249505489171169"), para no emparejar por
 * casualidad dos contactos que solo comparten sus últimos dígitos.
 */
function phoneKey(value) {
  const raw = String(value || '');
  // Cualquier letra descarta: es un BSUID, no un teléfono. Los separadores
  // (espacios, guiones, paréntesis) sí se toleran, que es como se escriben los
  // números cuando alguien los carga a mano.
  if (!raw || /[a-z]/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.slice(-9);
}

/** Fecha de hoy ("YYYY-MM-DD") en el calendario de Lima, sin importar la zona horaria del servidor. */
function limaTodayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export function extractBody(message) {
  switch (message.type) {
    case 'text': return message.text?.body || '';
    case 'button': return message.button?.text || '';
    case 'interactive':
      return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
    case 'image': return message.image?.caption || '[Imagen]';
    case 'video': return message.video?.caption || '[Video]';
    case 'audio': return '[Audio]';
    case 'document': return message.document?.caption || message.document?.filename || '[Documento]';
    case 'location': return `[Ubicación] ${message.location?.name || ''}`.trim();
    case 'sticker': return '[Sticker]';
    default: return '';
  }
}

/**
 * Cuerpo final a guardar para un mensaje entrante: si es un audio y ya se
 * cacheó localmente, se intenta transcribir con Whisper y esa transcripción
 * reemplaza el placeholder "[Audio]" — así el mensaje se puede leer en el
 * panel Y el bot lo puede procesar como si lo hubieran escrito. Sin
 * OPENAI_API_KEY configurada (o si la transcripción falla), se cae de vuelta
 * al placeholder de siempre.
 */
export async function resolveMessageBody(message, cachedMedia) {
  const fallback = extractBody(message);
  if (message.type !== 'audio' || !cachedMedia?.filename) return fallback;

  const transcript = await whisperService.transcribe(
    path.join(whatsappMediaDir, cachedMedia.filename),
    cachedMedia.mimeType
  );
  return transcript || fallback;
}

// Tipos de mensaje de WhatsApp que traen un archivo adjunto real (no solo
// texto/botones), y el nombre del campo del mensaje donde viene ese adjunto
// — es el mismo nombre que el "type" en el formato de Meta/YCloud.
const MEDIA_MESSAGE_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

const MIME_TO_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'application/pdf': 'pdf'
};

function extensionForMime(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[clean] || 'bin';
}

async function saveMediaBuffer(buffer, mimeType, prefix) {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionForMime(mimeType)}`;
  await fs.promises.writeFile(path.join(whatsappMediaDir, filename), buffer);
  return filename;
}

/**
 * Descarga y cachea localmente el adjunto de un mensaje entrante de YCloud.
 * YCloud entrega un "link" de descarga directa en el propio webhook, pero
 * solo lo garantiza accesible por 30 días y pide el header "X-API-Key" — sin
 * copiarlo, el adjunto dejaba de verse en el panel pasado ese tiempo (o antes,
 * si el link exige ese header desde el inicio).
 * https://docs.ycloud.com/reference/whatsapp-inbound-message-webhook-examples
 */
export async function cacheYCloudMedia(message) {
  if (!MEDIA_MESSAGE_TYPES.includes(message.type)) return null;
  const media = message[message.type];
  if (!media?.link) return null;

  const apiKey = process.env.YCLOUD_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(media.link, { headers: { 'X-API-Key': apiKey } });
    if (!response.ok) return null;
    const mimeType = media.mime_type || response.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = await saveMediaBuffer(buffer, mimeType, 'ycloud');
    return { filename, mimeType };
  } catch (error) {
    console.warn('⚠️ [WhatsApp] No se pudo descargar el adjunto entrante (YCloud):', error.message);
    return null;
  }
}

/**
 * Descarga y cachea localmente el adjunto de un mensaje entrante nativo de la
 * Graph API de Meta. El webhook solo trae un "id" de media (nunca una URL
 * directa): hace falta resolverlo primero a una URL temporal —dura minutos—
 * y descargarla con el mismo access token, todo antes de que caduque.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
async function cacheMetaMedia(message) {
  if (!MEDIA_MESSAGE_TYPES.includes(message.type)) return null;
  const media = message[message.type];
  if (!media?.id) return null;

  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const metaUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${media.id}`;
    const metaResponse = await fetch(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!metaResponse.ok) return null;
    const metaData = await metaResponse.json();
    if (!metaData.url) return null;

    const fileResponse = await fetch(metaData.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!fileResponse.ok) return null;
    const mimeType = media.mime_type || metaData.mime_type || 'application/octet-stream';
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const filename = await saveMediaBuffer(buffer, mimeType, 'meta');
    return { filename, mimeType };
  } catch (error) {
    console.warn('⚠️ [WhatsApp] No se pudo descargar el adjunto entrante (Meta):', error.message);
    return null;
  }
}

/**
 * Detecta el canal de origen de una conversación a partir del objeto
 * "referral" que WhatsApp incluye en el primer mensaje cuando el cliente
 * escribió después de tocar un anuncio o publicación de "Enviar mensaje" en
 * Facebook o Instagram. Sin ese objeto, es un contacto directo/orgánico.
 * Nota: Meta no manda un campo explícito "fb"/"ig" en el referral, así que
 * la distinción Facebook/Instagram se infiere del dominio de "source_url".
 */
export function detectWhatsappChannel(referral) {
  if (!referral) return 'WhatsApp Directo';

  const url = (referral.source_url || '').toLowerCase();
  if (url.includes('instagram.com')) return 'Instagram Ads';
  if (url.includes('facebook.com') || url.includes('fb.me') || url.includes('l.facebook.com')) return 'Facebook Ads';
  if (referral.source_type === 'ad') return 'Anuncio de Meta';
  if (referral.source_type === 'post') return 'Publicación de Meta';
  return 'Anuncio de Meta';
}

/**
 * Persistencia y envío de mensajes de WhatsApp Business Platform: guarda los
 * mensajes entrantes recibidos vía webhook y permite responder vía la Graph API.
 */
/** Ventana de servicio al cliente de WhatsApp: 24 h desde el último inbound. */
const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * La decisión sola, sin base de datos, para poder probarla: ¿sigue abierta la
 * ventana si el último mensaje del contacto llegó en `lastInboundAt`?
 * Sin ningún mensaje entrante (`null`) la ventana nunca estuvo abierta.
 */
export function isWithinCustomerWindow(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return false;
  const at = new Date(lastInboundAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < CUSTOMER_WINDOW_MS;
}

export class WhatsappMessageService {
  async createFromMessage(value, message) {
    // Normalmente el remitente viene en "from" (teléfono). Algunos mensajes
    // (p. ej. contactos vinculados por Instagram que no comparten su número)
    // en cambio traen "from_user_id" con un identificador tipo "PE.xxxxx".
    const senderId = message.from || message.from_user_id;
    if (!senderId) {
      console.error('❌ [WhatsApp] Mensaje sin remitente identificable, se descarta:', JSON.stringify(message));
      return null;
    }

    const contact = (value.contacts || []).find((c) => (c.wa_id || c.user_id) === senderId);
    const cachedMedia = await cacheMetaMedia(message);
    const body = await resolveMessageBody(message, cachedMedia);

    const [id] = await db('whatsapp_messages')
      .insert({
        wa_id: senderId,
        contact_name: contact?.profile?.name || null,
        message_id: message.id,
        message_type: message.type,
        body,
        direction: 'inbound',
        channel: detectWhatsappChannel(message.referral),
        referral: message.referral ? JSON.stringify(message.referral) : null,
        raw_payload: JSON.stringify(message),
        media_filename: cachedMedia?.filename || null,
        media_mime_type: cachedMedia?.mimeType || null,
        received_at: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date()
      })
      .onConflict('message_id')
      .ignore();

    // "isNew" indica si esta llamada realmente insertó el mensaje o si ya
    // existía (Meta reenvía el mismo evento de webhook por reintentos) — el
    // llamador lo usa para no procesar dos veces el mismo mensaje en el bot.
    if (!id) return { record: await this.getByMessageId(message.id), isNew: false };
    return { record: await this.getById(id), isNew: true };
  }

  /**
   * Inserta un mensaje entrante ya normalizado, para proveedores que no usan
   * el formato nativo de webhook de la Graph API (p. ej. YCloud, ver
   * YCloudWebhookService). Mismo contrato de retorno que createFromMessage().
   */
  async recordInboundMessage({ waId, contactName, messageId, messageType, body, channel, referral, receivedAt, rawPayload, mediaFilename, mediaMimeType }) {
    const [id] = await db('whatsapp_messages')
      .insert({
        wa_id: waId,
        contact_name: contactName || null,
        message_id: messageId,
        message_type: messageType,
        body,
        direction: 'inbound',
        channel,
        referral: referral ? JSON.stringify(referral) : null,
        raw_payload: rawPayload ? JSON.stringify(rawPayload) : null,
        media_filename: mediaFilename || null,
        media_mime_type: mediaMimeType || null,
        received_at: receivedAt || new Date()
      })
      .onConflict('message_id')
      .ignore();

    if (!id) return { record: await this.getByMessageId(messageId), isNew: false };
    return { record: await this.getById(id), isNew: true };
  }

  /**
   * Guarda un mensaje saliente que no se envió desde este panel — p. ej. un
   * asesor respondiendo directo desde la app de WhatsApp Business vinculada
   * (modo coexistencia) o desde el inbox propio de YCloud — a partir del eco
   * que el proveedor reenvía por webhook (ver YCloudWebhookService). Sin
   * esto, esos mensajes no quedaban guardados y el hilo del panel se veía con
   * saltos respecto a lo que el contacto realmente recibió.
   */
  async recordOutboundEcho({ waId, messageId, messageType, body, sentAt, rawPayload }) {
    const [id] = await db('whatsapp_messages')
      .insert({
        wa_id: waId,
        contact_name: null,
        message_id: messageId,
        message_type: messageType,
        body,
        direction: 'outbound',
        status: 'sent',
        raw_payload: rawPayload ? JSON.stringify(rawPayload) : null,
        received_at: sentAt || new Date()
      })
      .onConflict('message_id')
      .ignore();

    if (!id) return { record: await this.getByMessageId(messageId), isNew: false };
    return { record: await this.getById(id), isNew: true };
  }

  /**
   * Inserta un mensaje entrante simulado (usado por el simulador de pruebas
   * del panel admin, que no pasa por el webhook real de Meta) para que el
   * motor conversacional del bot pueda reconstruir el hilo con el historial
   * completo, igual que con mensajes reales.
   */
  async createSimulatedInbound(waId, body) {
    const [id] = await db('whatsapp_messages').insert({
      wa_id: waId,
      contact_name: null,
      message_id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message_type: 'text',
      body,
      direction: 'inbound',
      channel: 'Simulado (Panel Admin)',
      received_at: new Date()
    });
    return this.getById(id);
  }

  /**
   * Envía un mensaje de texto libre a un contacto vía la Graph API. Solo
   * funciona dentro de la ventana de 24h desde el último mensaje del cliente;
   * fuera de ella, WhatsApp exige usar una plantilla aprobada.
   *
   * Para contactos identificados solo por BSUID (p. ej. "PE.1551888569771124",
   * cuando no compartieron su número) NO se usa el campo "to": la Graph API
   * exige el campo "recipient" en su lugar, con el BSUID completo.
   * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
   */
  async sendTextMessage(waId, body) {
    if (WHATSAPP_PROVIDER === 'ycloud') return this.sendTextMessageViaYCloud(waId, body);

    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!phoneNumberId) {
      throw new Error('META_WHATSAPP_PHONE_NUMBER_ID no está configurado en el servidor.');
    }
    if (!accessToken) {
      throw new Error('META_WHATSAPP_ACCESS_TOKEN (o META_PAGE_ACCESS_TOKEN) no está configurado en el servidor.');
    }

    const isBsuid = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/.test(waId);

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        ...(isBsuid ? { recipient: waId } : { to: waId }),
        type: 'text',
        text: { body }
      })
    });
    const data = await response.json();

    if (!response.ok) {
      const reason = data?.error?.message || JSON.stringify(data);
      throw new Error(`WhatsApp rechazó el envío: ${reason}`);
    }

    // "message_id" es NOT NULL + unique: si la Graph API alguna vez no trae
    // "messages[0].id" (respuesta parcial, cambio de formato), sin este
    // respaldo el insert fallaría o, peor, colisionaría con otro mensaje que
    // haya caído en el mismo vacío — y el mensaje se perdería del CRM aunque
    // ya se haya entregado de verdad (ver el mismo respaldo en
    // sendTextMessageViaYCloud, donde se confirmó el problema).
    const messageId = data.messages?.[0]?.id;
    const [id] = await db('whatsapp_messages').insert({
      wa_id: waId,
      contact_name: null,
      message_id: messageId || `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message_type: 'text',
      body,
      direction: 'outbound',
      status: 'sent',
      raw_payload: JSON.stringify(data)
    });

    return this.getById(id);
  }

  /**
   * Envía un mensaje de texto libre vía la API de YCloud (WHATSAPP_PROVIDER=ycloud).
   * https://docs.ycloud.com/reference/whatsapp-message-sending-guide
   */
  async sendTextMessageViaYCloud(waId, body) {
    const apiKey = process.env.YCLOUD_API_KEY;
    const from = process.env.YCLOUD_WHATSAPP_FROM;
    if (!apiKey) throw new Error('YCLOUD_API_KEY no está configurado en el servidor.');
    if (!from) throw new Error('YCLOUD_WHATSAPP_FROM no está configurado en el servidor.');

    // Un contacto que escribió sin compartir su número real (entró por
    // "Enviar mensaje" en un anuncio/publicación de Instagram/Facebook)
    // llega identificado solo por un Business-Scoped User ID ("PE.xxxxx",
    // ver ycloudWebhookService.handleInboundMessage) — mandarlo por "to"
    // como si fuera un teléfono lo convertía en "+PE.xxxxx", un número
    // inválido que YCloud iba a rechazar. Se usa "recipient" en su lugar,
    // el mismo campo que la Graph API nativa de Meta exige para este tipo
    // de ID (YCloud reenvía a esa misma plataforma). OJO: esto NO está
    // documentado en la guía pública de YCloud — si de todos modos lo
    // rechaza, el error de abajo lo va a decir explícito.
    const isBsuid = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/.test(waId);

    const response = await fetch(`${YCLOUD_API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        from,
        ...(isBsuid ? { recipient: waId } : { to: toE164(waId) }),
        type: 'text',
        text: { body, preview_url: false }
      })
    });
    const data = await response.json();

    if (!response.ok) {
      const reason = data?.message || data?.error?.message || JSON.stringify(data);
      throw new Error(`YCloud rechazó el envío: ${reason}`);
    }

    // Se guarda el "wamid" (no el "id" interno de YCloud) como message_id
    // para que quede en el mismo formato que usan las actualizaciones de
    // estado del webhook "whatsapp.message.updated" (ver YCloudWebhookService).
    // "message_id" es NOT NULL + unique en la tabla: si la respuesta de YCloud
    // no trae "wamid" en la forma esperada (campo movido, respuesta parcial,
    // etc.), el insert de abajo reventaba y el mensaje se perdía del CRM
    // aunque WhatsApp ya lo hubiera entregado de verdad — se detectó porque
    // varios mensajes salientes (recordatorios de inactividad incluidos)
    // llegaban al contacto pero nunca aparecían en el panel. Con un id de
    // respaldo generado acá, el mensaje siempre queda guardado (con su
    // "raw_payload" completo para poder ubicar el campo correcto después).
    const providerMessageId = data.wamid || data.id || data.whatsappMessage?.wamid || data.whatsappMessage?.id;
    const [id] = await db('whatsapp_messages').insert({
      wa_id: waId,
      contact_name: null,
      message_id: providerMessageId || `ycloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message_type: 'text',
      body,
      direction: 'outbound',
      status: 'sent',
      raw_payload: JSON.stringify(data)
    });

    return this.getById(id);
  }

  /**
   * Envía un archivo (imagen o documento) a un contacto vía la Graph API:
   * primero sube el fichero al endpoint /media para obtener un media id y
   * luego manda el mensaje referenciándolo. Igual que el texto libre, solo
   * funciona dentro de la ventana de 24h desde el último mensaje del cliente.
   */
  async sendMediaMessage(waId, { filePath, filename, mimeType, caption }) {
    // YCloud envía adjuntos por URL pública o subiéndolos antes a su propio
    // storage (no acepta un archivo local como Meta) y esta app hoy no expone
    // los archivos por una URL pública — hace falta resolver eso antes de
    // soportar este método con WHATSAPP_PROVIDER=ycloud.
    // https://docs.ycloud.com/reference/whatsapp-message-sending-guide
    if (WHATSAPP_PROVIDER === 'ycloud') {
      throw new Error('El envío de archivos por WhatsApp aún no está soportado con el proveedor YCloud.');
    }

    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!phoneNumberId) {
      throw new Error('META_WHATSAPP_PHONE_NUMBER_ID no está configurado en el servidor.');
    }
    if (!accessToken) {
      throw new Error('META_WHATSAPP_ACCESS_TOKEN (o META_PAGE_ACCESS_TOKEN) no está configurado en el servidor.');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('El archivo a enviar no existe en el servidor.');
    }

    const resolvedMime = mimeType || 'application/octet-stream';
    const isImage = resolvedMime.startsWith('image/');
    const isBsuid = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/.test(waId);
    const baseUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}`;

    // 1. Subir el archivo y obtener el media id.
    const fileBuffer = await fs.promises.readFile(filePath);
    const uploadForm = new FormData();
    uploadForm.append('messaging_product', 'whatsapp');
    uploadForm.append('type', resolvedMime);
    uploadForm.append('file', new Blob([fileBuffer], { type: resolvedMime }), filename || path.basename(filePath));

    const uploadResponse = await fetch(`${baseUrl}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: uploadForm
    });
    const uploadData = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadData.id) {
      const reason = uploadData?.error?.message || JSON.stringify(uploadData);
      throw new Error(`WhatsApp rechazó la subida del archivo: ${reason}`);
    }

    // 2. Enviar el mensaje con el media id.
    const mediaObject = isImage
      ? { id: uploadData.id, caption: caption || undefined }
      : { id: uploadData.id, filename: filename || 'documento', caption: caption || undefined };

    const sendResponse = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        ...(isBsuid ? { recipient: waId } : { to: waId }),
        type: isImage ? 'image' : 'document',
        [isImage ? 'image' : 'document']: mediaObject
      })
    });
    const sendData = await sendResponse.json();
    if (!sendResponse.ok) {
      const reason = sendData?.error?.message || JSON.stringify(sendData);
      throw new Error(`WhatsApp rechazó el envío: ${reason}`);
    }

    const messageId = sendData.messages?.[0]?.id;
    const [id] = await db('whatsapp_messages').insert({
      wa_id: waId,
      contact_name: null,
      message_id: messageId,
      message_type: isImage ? 'image' : 'document',
      body: caption || `[${isImage ? 'Imagen' : 'Documento'}] ${filename || ''}`.trim(),
      direction: 'outbound',
      status: 'sent',
      raw_payload: JSON.stringify(sendData)
    });

    return this.getById(id);
  }

  /**
   * Marca el último mensaje del contacto como leído y muestra el indicador de
   * "escribiendo..." de WhatsApp (dura hasta 25s o hasta que el bot envía su
   * respuesta). Requiere el `message_id` del mensaje entrante. Silencioso si
   * WhatsApp no está configurado o no hay un id.
   */
  async sendTypingIndicator(messageId) {
    if (WHATSAPP_PROVIDER === 'ycloud') return this.sendTypingIndicatorViaYCloud(messageId);

    const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!phoneNumberId || !accessToken || !messageId) return;

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' }
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.error?.message || `WhatsApp rechazó el indicador de escritura (HTTP ${response.status}).`);
    }
  }

  /**
   * Marca como leído un mensaje entrante y muestra "escribiendo..." vía YCloud.
   * `inboundMessageId` es el "id" interno de YCloud del mensaje entrante (no
   * el "wamid") — ver YCloudWebhookService.handleInboundMessage.
   * Nota: el nombre exacto del campo del body para activar el indicador de
   * escritura no está confirmado en la documentación pública de YCloud; si
   * difiere, en el peor caso YCloud igual marca el mensaje como leído y
   * solo se pierde el indicador visual (falla silenciosa, sin romper el bot:
   * quien llama a este método ya captura sus errores).
   * https://docs.ycloud.com/reference/whatsapp_inbound_message-typing-indicator
   */
  async sendTypingIndicatorViaYCloud(inboundMessageId) {
    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey || !inboundMessageId) return;

    const response = await fetch(`${YCLOUD_API_BASE}/inboundMessages/${inboundMessageId}/markAsRead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ typingIndicator: { type: 'text' } })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data?.message || `YCloud rechazó el indicador de escritura (HTTP ${response.status}).`);
    }
  }

  /**
   * Actualiza el estado (sent/delivered/read/failed) de un mensaje saliente a
   * partir de las actualizaciones de estado recibidas por webhook, guardando
   * el motivo del fallo si WhatsApp lo reporta.
   *
   * `fallbackId` cubre el envío por YCloud: la respuesta de
   * sendTextMessageViaYCloud() no trae el "wamid" (solo su "id" interno de
   * YCloud), así que el mensaje queda guardado con ese id interno como
   * message_id. Cuando llega esta actualización de estado — que sí trae
   * ambos, "wamid" e "id" — si no hay match por wamid se reintenta por el id
   * interno y, de encontrarlo, se corrige message_id al wamid real para que
   * quede correlacionado con el resto de actualizaciones futuras.
   */
  async updateStatus(messageId, status, statusError = null, fallbackId = null) {
    const updated = await db('whatsapp_messages').where({ message_id: messageId }).update({ status, status_error: statusError });
    if (!updated && fallbackId) {
      await db('whatsapp_messages').where({ message_id: fallbackId }).update({ message_id: messageId, status, status_error: statusError });
    }
  }

  async getById(id) {
    return db('whatsapp_messages').where({ id }).first();
  }

  async getByMessageId(messageId) {
    return db('whatsapp_messages').where({ message_id: messageId }).first();
  }

  /**
   * Cuelga de cada conversación el nombre y el id del lead correspondiente
   * (`lead_name`, `lead_id`), emparejando por los últimos 9 dígitos del
   * teléfono: el wa_id llega en formato internacional ("+51934819600") y el
   * teléfono del lead puede estar guardado con el "+", sin él o como el
   * celular local a secas, y comparar las cadenas tal cual no emparejaba.
   *
   * Se traen todos los leads con teléfono de una vez porque son pocos (cientos
   * como mucho) y así el emparejamiento por sufijo se hace en memoria, sin
   * depender de funciones de expresiones regulares que no existen en todas las
   * versiones de MySQL.
   */
  async #attachLeadNames(conversations) {
    if (conversations.length === 0) return conversations;

    const leads = await db('leads')
      .whereNotNull('phone').where('phone', '!=', '')
      .select('id', 'phone', 'full_name')
      .orderBy('id', 'desc');

    const porSufijo = new Map();
    for (const lead of leads) {
      const key = phoneKey(lead.phone);
      // Gana el lead más reciente con ese teléfono (van ordenados desc), que
      // es el que refleja el nombre con el que se registró la última vez.
      if (key && !porSufijo.has(key)) porSufijo.set(key, lead);
    }

    for (const conversation of conversations) {
      const lead = porSufijo.get(phoneKey(conversation.wa_id));
      const nombre = lead?.full_name?.trim();
      conversation.lead_id = lead?.id ?? null;
      conversation.lead_name = nombre && nombre !== 'Contacto de WhatsApp' ? nombre : null;
    }
    return conversations;
  }

  async getRecent({ limit = 50 } = {}) {
    return db('whatsapp_messages').orderBy('received_at', 'desc').limit(limit);
  }

  /**
   * Una página de la bandeja: un registro por contacto con su último mensaje,
   * de la conversación más reciente a la más vieja.
   *
   * Antes traía TODOS los mensajes de la tabla a memoria, los plegaba por
   * contacto y recortaba a 100. Eso tenía dos problemas: la bandeja se quedaba
   * en los 100 más recientes —el resto no existía para el panel— y cada
   * refresco leía la tabla entera, que crece con cada mensaje de cada
   * conversación. Ahora se pagina: primero se pide la PÁGINA de contactos
   * (una consulta agrupada, que es lo que el índice `wa_id, received_at`
   * resuelve), y recién después se traen los mensajes de esos contactos.
   *
   * El plegado sigue haciéndose en JavaScript sobre esos mensajes porque la
   * bandeja necesita datos que no salen de la última fila: el canal del PRIMER
   * mensaje, si ese primer mensaje entrante era el resumen de un formulario, y
   * el último nombre de perfil conocido (los mensajes salientes lo traen en
   * null). Son decenas de filas por contacto, no la tabla entera.
   *
   * `before` es el cursor: `{ lastAt, waId }` de la última fila entregada. Se
   * pagina por el par y no solo por la fecha porque dos conversaciones pueden
   * tener el mismo último mensaje al segundo, y con un cursor de fecha sola una
   * de las dos se perdería entre páginas.
   */
  async getConversations({ limit = 30, before = null, search = '' } = {}) {
    const termino = String(search || '').trim();
    const sufijos = await this.#leadPhoneSuffixesMatching(termino);

    const pagina = await this.#conversationKeys({ limit, before, search: termino, sufijos });
    if (pagina.length === 0) return { conversations: [], nextCursor: null, hasMore: false };

    const waIds = pagina.map((fila) => fila.wa_id);
    const rows = await db('whatsapp_messages')
      .whereIn('wa_id', waIds)
      .orderBy('received_at', 'asc')
      .orderBy('id', 'asc');

    const map = new Map();
    for (const row of rows) {
      const prev = map.get(row.wa_id);
      // Solo el PRIMER mensaje entrante decide si la conversación arrancó con
      // el resumen automático de un formulario de un anuncio — se evalúa una
      // sola vez por contacto, no en cada mensaje que llega después.
      const isFormLead = prev
        ? prev.is_form_lead
        : (row.direction === 'inbound' && isAdFormMessage(row.body));
      map.set(row.wa_id, {
        ...row,
        origin_channel: prev?.origin_channel ?? row.channel,
        is_form_lead: isFormLead,
        // El nombre del perfil de WhatsApp solo viaja en los mensajes
        // ENTRANTES que traen el bloque "contacts"; los salientes lo dejan en
        // null. Como aquí gana el último mensaje del contacto, la primera
        // respuesta del bot borraba el nombre de la bandeja y volvía a
        // aparecer el número. Se conserva el último nombre conocido.
        contact_name: row.contact_name || prev?.contact_name || null
      });
    }

    // Se respeta el orden de la consulta paginada y no el del Map: es el único
    // que coincide con el cursor que se devuelve.
    const conversations = waIds.map((waId) => map.get(waId)).filter(Boolean);

    // El nombre REAL del lead (el que dio en el formulario) manda sobre el
    // alias del perfil de WhatsApp. Antes solo se usaba cuando el perfil no
    // traía ninguno, y un contacto guardado como "kevin" o "😎😎😎😎" quedaba
    // imposible de encontrar buscándolo por su nombre de verdad. El alias no
    // se pierde: viaja aparte para mostrarlo como dato secundario.
    await this.#attachLeadNames(conversations);

    // Marca las conversaciones que Avan transfirió a un asesor (ver
    // handOffToAdvisor en whatsappBotService.js), para que el panel pueda
    // resaltarlas como urgentes en vez de que se pierdan entre el resto.
    const sessions = await db('whatsapp_bot_sessions').whereIn('wa_id', waIds).select('wa_id', 'answers');
    const handoffMap = new Map();
    for (const session of sessions) {
      try {
        const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
        if (answers.__handedOffAt) handoffMap.set(session.wa_id, answers.__handedOffAt);
      } catch {
        // Sesión con JSON corrupto: se ignora, no bloquea la bandeja.
      }
    }
    for (const conversation of conversations) {
      conversation.handed_off_at = handoffMap.get(conversation.wa_id) || null;
    }

    const ultima = pagina[pagina.length - 1];
    return {
      conversations,
      // Se devuelve el cursor de la consulta agrupada, no el `received_at` de
      // la conversación plegada: son el mismo instante, pero el de la consulta
      // es el que la siguiente página va a comparar.
      nextCursor: { lastAt: new Date(ultima.last_at).toISOString(), waId: ultima.wa_id },
      hasMore: pagina.length === limit
    };
  }

  /**
   * La página de contactos ordenada por su último mensaje. Devuelve solo
   * `wa_id` y esa fecha: traer el mensaje entero acá obligaría a una
   * subconsulta por grupo que MySQL resuelve mucho peor que un GROUP BY plano.
   */
  async #conversationKeys({ limit, before, search, sufijos }) {
    const query = db('whatsapp_messages')
      .whereNotNull('wa_id')
      .where('wa_id', '!=', '')
      .groupBy('wa_id')
      .select('wa_id')
      .max('received_at as last_at')
      .orderBy('last_at', 'desc')
      .orderBy('wa_id', 'desc')
      .limit(limit);

    this.#applyConversationSearch(query, search, sufijos);

    if (before?.lastAt && before?.waId) {
      const fecha = new Date(before.lastAt);
      query.havingRaw('(MAX(received_at) < ? OR (MAX(received_at) = ? AND wa_id < ?))', [fecha, fecha, before.waId]);
    }

    return query;
  }

  /** Cuántas conversaciones hay en total (con el filtro de búsqueda aplicado). */
  async countConversations({ search = '' } = {}) {
    const termino = String(search || '').trim();
    const sufijos = await this.#leadPhoneSuffixesMatching(termino);

    const query = db('whatsapp_messages')
      .whereNotNull('wa_id')
      .where('wa_id', '!=', '')
      .countDistinct('wa_id as total');

    this.#applyConversationSearch(query, termino, sufijos);
    const [fila] = await query;
    return Number(fila?.total || 0);
  }

  /**
   * El filtro de la búsqueda de la bandeja, en el SERVIDOR.
   *
   * Se buscaba en el navegador sobre lo que ya estaba cargado, lo que con la
   * lista completa significaría "busca entre los últimos 30": justo el
   * contacto viejo que uno no encuentra a mano es el que se busca escribiendo.
   *
   * Se cruza por el número y por el alias del perfil; el nombre REAL del lead
   * no está en esta tabla, así que llega resuelto en `sufijos` (los últimos 9
   * dígitos de los teléfonos de los leads que coinciden por nombre).
   */
  #applyConversationSearch(query, search, sufijos) {
    if (!search) return query;
    // El LIKE se arma con el texto de quien busca: sus `%` y `_` se escapan
    // para que no se conviertan en comodines.
    const patron = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;

    return query.where((builder) => {
      builder
        .whereRaw('LOWER(wa_id) LIKE ?', [patron])
        .orWhereRaw('LOWER(COALESCE(contact_name, "")) LIKE ?', [patron]);
      for (const sufijo of sufijos) builder.orWhere('wa_id', 'like', `%${sufijo}`);
    });
  }

  /**
   * Los últimos 9 dígitos de los teléfonos de los leads cuyo nombre coincide
   * con lo buscado — el puente entre "busco a Elisa Porras" y un `wa_id` que
   * solo es un número. Se acota a 300 porque es una ayuda de búsqueda: con más
   * coincidencias que eso, lo que hace falta es escribir un poco más.
   */
  async #leadPhoneSuffixesMatching(search) {
    if (!search) return [];
    const patron = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    const leads = await db('leads')
      .whereNotNull('phone')
      .where('phone', '!=', '')
      .whereRaw('LOWER(full_name) LIKE ?', [patron])
      .select('phone')
      .limit(300);

    return [...new Set(leads.map((lead) => phoneKey(lead.phone)).filter(Boolean))];
  }

  /** Borra la marca de "transferido a un asesor" de una conversación (ver
   * getConversations) — se usa cuando alguien del equipo ya la atendió,
   * respondiendo desde el panel. */
  async clearHandoffMark(waId) {
    const session = await db('whatsapp_bot_sessions').where({ wa_id: waId }).first();
    if (!session) return;
    const answers = typeof session.answers === 'string' ? JSON.parse(session.answers) : (session.answers || {});
    if (!answers.__handedOffAt) return;
    delete answers.__handedOffAt;
    delete answers.__handedOffReason;
    await db('whatsapp_bot_sessions').where({ wa_id: waId }).update({ answers: JSON.stringify(answers) });
  }

  /**
   * Hilo completo (entrantes + salientes) de un contacto, en orden cronológico.
   * `since` acota a mensajes desde esa fecha en adelante (p. ej. desde que
   * arrancó la sesión actual del bot), sin borrar ni tocar el historial real
   * — solo para no arrastrarle al LLM el contexto de una conversación previa
   * ya reiniciada desde el panel.
   */
  async getThread(waId, { limit = 200, since = null } = {}) {
    let query = db('whatsapp_messages').where({ wa_id: waId });
    if (since) query = query.where('received_at', '>=', since);

    // Se piden los ÚLTIMOS `limit` mensajes y recién después se ordenan
    // ascendente para pintarlos. Con `orderBy('asc').limit()` se devolvían los
    // 200 mensajes MÁS ANTIGUOS del contacto: en un hilo largo lo nuevo no
    // llegaba nunca al panel por más que se refrescara. El desempate por `id`
    // tampoco es opcional — varias burbujas caen en el mismo segundo y sin él
    // el orden entre ellas cambiaba de un sondeo a otro.
    const rows = await query.orderBy('received_at', 'desc').orderBy('id', 'desc').limit(limit);
    return rows.reverse();
  }

  async getStats() {
    const [{ total }] = await db('whatsapp_messages').count('* as total');
    const [{ contacts }] = await db('whatsapp_messages').countDistinct('wa_id as contacts');
    return { total: Number(total), contacts: Number(contacts) };
  }

  /**
   * Elimina todos los mensajes de una conversación (y su sesión del bot, si
   * existe) y deja un registro en `whatsapp_conversation_deletions` con quién
   * la eliminó — la conversación en sí no deja rastro una vez borrada, así
   * que esta tabla es la única forma de saber después quién la quitó.
   */
  async deleteConversation(waId, { deletedByUserId, deletedByName }) {
    const lastMessage = await db('whatsapp_messages')
      .where({ wa_id: waId })
      .orderBy('received_at', 'desc')
      .first();
    if (!lastMessage) return null;

    const [{ count }] = await db('whatsapp_messages').where({ wa_id: waId }).count('* as count');

    await db('whatsapp_bot_sessions').where({ wa_id: waId }).delete();
    await db('whatsapp_messages').where({ wa_id: waId }).delete();

    const [id] = await db('whatsapp_conversation_deletions').insert({
      wa_id: waId,
      contact_name: lastMessage.contact_name || null,
      message_count: Number(count),
      deleted_by_user_id: deletedByUserId || null,
      deleted_by_name: deletedByName || null
    });

    return db('whatsapp_conversation_deletions').where({ id }).first();
  }

  /**
   * ¿Sigue abierta la ventana de servicio al cliente de 24 h con este
   * contacto?
   *
   * WhatsApp solo deja mandar texto libre dentro de las 24 h siguientes al
   * ÚLTIMO mensaje del cliente; pasado ese plazo hay que usar una plantilla
   * aprobada o el envío se rechaza. El bot no lo comprobaba nunca: todos los
   * mensajes que quedaron en `failed` —recordatorios de reunión y las alertas
   * "🆘 Lead transferido a un asesor" al número interno— eran texto libre
   * mandado fuera de la ventana. Los asesores nunca se enteraron de esas
   * transferencias.
   *
   * Ante un error de base de datos devuelve `true` (falla abierta): quedarse
   * sin poder responder por una consulta caída es peor que intentar un envío
   * que WhatsApp rechazará.
   */
  async isCustomerWindowOpen(waId) {
    if (!waId) return false;
    try {
      // Por `id` y no por `received_at`: dos mensajes del mismo segundo son
      // indistinguibles por fecha, y aquí importa cuál fue realmente el último.
      const last = await db('whatsapp_messages')
        .where({ wa_id: waId, direction: 'inbound' })
        .orderBy('id', 'desc')
        .first('received_at');
      return isWithinCustomerWindow(last?.received_at);
    } catch (error) {
      console.error(`❌ [WhatsApp] No se pudo comprobar la ventana de 24 h de ${waId}:`, error.message);
      return true;
    }
  }

  /** Últimas conversaciones eliminadas, para mostrar quién borró qué. */
  async getRecentDeletions({ limit = 50 } = {}) {
    return db('whatsapp_conversation_deletions').orderBy('deleted_at', 'desc').limit(limit);
  }

  /**
   * Todos los mensajes (entrantes + salientes) de un día del calendario de
   * Lima, en orden cronológico. Se usa para exportar la bitácora completa de
   * conversaciones a un archivo de texto. `dateStr` es "YYYY-MM-DD" en
   * calendario de Lima (por defecto, hoy en Lima). Perú es UTC-5 todo el año
   * (sin horario de verano), así que 00:00 de Lima son las 05:00 UTC.
   */
  async getMessagesForDay(dateStr = limaTodayIso()) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return db('whatsapp_messages')
      .whereNotNull('wa_id')
      .where('wa_id', '!=', '')
      .where('received_at', '>=', start)
      .where('received_at', '<', end)
      .orderBy('received_at', 'asc')
      .orderBy('id', 'asc');
  }

  /**
   * Arma un volcado de texto plano de todas las conversaciones de un día,
   * agrupadas por contacto y ordenadas cronológicamente dentro de cada una.
   * `dateStr` es "YYYY-MM-DD" en calendario de Lima (por defecto, hoy en Lima).
   * Devuelve `{ filename, content }` listo para descargar.
   */
  async buildDayTranscript(dateStr = limaTodayIso()) {
    const messages = await this.getMessagesForDay(dateStr);

    const dateFmt = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const timeFmt = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const [ly, lm, ld] = dateStr.split('-');
    const dayLabel = `${ld}/${lm}/${ly}`;

    // Un bloque por contacto, conservando el último nombre de perfil conocido.
    const byContact = new Map();
    for (const msg of messages) {
      const entry = byContact.get(msg.wa_id) || { name: null, messages: [] };
      if (msg.contact_name) entry.name = msg.contact_name;
      entry.messages.push(msg);
      byContact.set(msg.wa_id, entry);
    }

    const lines = [];
    lines.push(`Conversaciones de WhatsApp — ${dayLabel}`);
    lines.push(`Generado: ${dateFmt.format(new Date())} ${timeFmt.format(new Date())}`);
    lines.push(`Contactos: ${byContact.size} · Mensajes: ${messages.length}`);
    lines.push('='.repeat(60));
    lines.push('');

    if (byContact.size === 0) {
      lines.push('(No hubo mensajes este día.)');
    }

    for (const [waId, entry] of byContact) {
      const header = entry.name ? `${entry.name} (${waId})` : waId;
      lines.push(header);
      lines.push('-'.repeat(header.length));
      for (const msg of entry.messages) {
        const who = msg.direction === 'outbound' ? 'Asesor/Bot' : (entry.name || 'Contacto');
        const time = timeFmt.format(new Date(msg.received_at));
        const body = (msg.body || '').replace(/\r?\n/g, '\n           ');
        lines.push(`[${time}] ${who}: ${body}`);
      }
      lines.push('');
    }

    return {
      filename: `conversaciones-whatsapp-${dateStr}.txt`,
      content: lines.join('\n')
    };
  }
}
