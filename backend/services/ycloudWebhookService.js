import crypto from 'crypto';
import { WhatsappMessageService, detectWhatsappChannel, cacheYCloudMedia, resolveMessageBody, extractBody } from './whatsappMessageService.js';
import { LeadService } from './leadService.js';

const MAX_RECENT_EVENTS = 50;

// En modo coexistencia (número vinculado también a la app de WhatsApp
// Business del celular), YCloud puede reenviar como
// "whatsapp.inbound_message.received" mensajes viejos del historial del
// teléfono al sincronizar — no solo mensajes que el contacto acaba de
// escribir. Si se procesaran igual como disparador del bot, este le
// respondería (o le borraría el recordatorio de inactividad ya mandado,
// nudge_sent_at) a partir de un mensaje de hace rato, sin que el contacto
// haya escrito nada de verdad. Se descarta como disparador cualquier mensaje
// cuyo "sendTime" real sea más viejo que esta ventana (igual se guarda en el
// historial de mensajes).
const COEXISTENCE_SYNC_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Recepción de eventos del webhook de YCloud: proveedor de WhatsApp Business
 * Platform usado en modo coexistencia cuando el número se vinculó por YCloud
 * en vez de completar el alta como Tech Provider de Meta (ver
 * WHATSAPP_PROVIDER en whatsappMessageService.js). A diferencia del webhook
 * nativo de Meta, YCloud no usa el formato "entry/changes/value" de la Graph
 * API: envuelve cada evento en un objeto propio {id, type, ...}.
 * https://docs.ycloud.com/reference/webhook-integration-guide
 */
export class YCloudWebhookService {
  constructor({ botService } = {}) {
    this.messageService = new WhatsappMessageService();
    this.leadService = new LeadService();
    this.botService = botService || null;
    this.recentEvents = [];
  }

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
   * Valida la firma "YCloud-Signature: t={timestamp},s={signature}" de cada
   * evento con el secret generado al crear el endpoint (dashboard.ycloud.com
   * > Developer > Webhooks). Payload firmado: "{timestamp}.{rawBody}" (sin
   * punto final).
   * https://docs.ycloud.com/reference/webhook-integration-guide
   */
  verifySignature(rawBody, signatureHeader) {
    const secret = process.env.YCLOUD_WEBHOOK_SECRET;
    if (!secret || !rawBody || !signatureHeader) return false;

    const parts = Object.fromEntries(
      signatureHeader.split(',').map((part) => part.trim().split('='))
    );
    const { t: timestamp, s: signature } = parts;
    if (!timestamp || !signature) return false;

    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  /**
   * Despacha un evento del webhook según su "type": mensaje entrante o
   * actualización de estado de un mensaje saliente. Mismo pipeline
   * (lead + bot) que WhatsappWebhookService, adaptado al payload de YCloud.
   */
  async handleEvent(event) {
    if (event?.type === 'whatsapp.inbound_message.received') {
      await this.handleInboundMessage(event.whatsappInboundMessage || {});
    } else if (event?.type === 'whatsapp.message.updated') {
      await this.handleStatusUpdate(event.whatsappMessage || {});
    } else if (event?.type === 'whatsapp.smb.message.echoes') {
      await this.handleOutboundEcho(event.whatsappMessage || {});
    }
  }

  async handleInboundMessage(message) {
    // Normalmente el remitente viene en "from" (teléfono). Un contacto que
    // escribió tras tocar "Enviar mensaje" en un anuncio o publicación de
    // Instagram/Facebook sin compartir su número real llega SOLO con
    // "fromUserId" (un Business-Scoped User ID tipo "PE.xxxxx") — antes de
    // este fix, esos mensajes se descartaban en silencio acá mismo: ni se
    // guardaban, ni el bot se enteraba, y la conversación no aparecía en
    // ningún lado del panel (caso real confirmado: un contacto identificado
    // solo por fromUserId no dejó ningún rastro en el sistema).
    const senderId = message.from || message.fromUserId;
    if (!senderId) return;

    const sentAt = message.sendTime ? new Date(message.sendTime) : new Date();
    const isFreshMessage = Date.now() - sentAt.getTime() <= COEXISTENCE_SYNC_MAX_AGE_MS;

    try {
      // Cuando el contacto escribió tras tocar un anuncio "Click to WhatsApp",
      // YCloud sí reenvía el "referral" (igual que el webhook nativo de Meta),
      // solo que dentro del mensaje entrante y no documentado en el ejemplo
      // genérico de su guía — se confirmó en la doc específica de "Inbound
      // Text message triggered by click to WhatsApp Ads". Si no vino (mensaje
      // orgánico), detectWhatsappChannel() cae a "WhatsApp Directo" igual que
      // con Meta.
      const channel = detectWhatsappChannel(message.referral);
      const cachedMedia = await cacheYCloudMedia(message);
      const body = await resolveMessageBody(message, cachedMedia);

      const { isNew } = await this.messageService.recordInboundMessage({
        waId: senderId,
        contactName: message.customerProfile?.name,
        messageId: message.wamid,
        messageType: message.type,
        body,
        channel,
        referral: message.referral || null,
        receivedAt: sentAt,
        rawPayload: message,
        mediaFilename: cachedMedia?.filename || null,
        mediaMimeType: cachedMedia?.mimeType || null
      });

      await this.leadService.findOrCreateFromWhatsApp({
        phone: senderId,
        fullName: message.customerProfile?.name,
        source: channel,
        // Ídem que en el webhook nativo: la atribución del clic se guarda en
        // el lead, que es donde después se la va a leer.
        referral: message.referral || null
      });

      // Texto siempre; un audio solo si se pudo transcribir (ver
      // resolveMessageBody(), que ya dejó la transcripción en `body` en vez
      // del placeholder "[Audio]").
      const triggerText = message.type === 'text' ? message.text?.body : (message.type === 'audio' && body !== '[Audio]' ? body : null);
      if (isNew && isFreshMessage && this.botService && triggerText) {
        // Se pasa el "id" interno de YCloud (no el "wamid") porque el
        // indicador de leído/escribiendo lo referencia así:
        // POST /whatsapp/inboundMessages/{id}/markAsRead — ver
        // whatsappMessageService.sendTypingIndicatorViaYCloud.
        await this.botService.handleIncomingMessage(senderId, triggerText, message.id);
      } else if (isNew && isFreshMessage && this.botService) {
        /*
         * Lo que el bot NO puede leer (un PDF, una foto, un audio que no se
         * pudo transcribir) caía acá y no pasaba absolutamente nada: ni
         * respuesta ni aviso. Desde el otro lado eso se lee como un visto.
         *
         * El webhook nativo de Meta ya lo atendía; este, que es el que está en
         * producción (`WHATSAPP_PROVIDER=ycloud`), no — así que la mitad
         * multimedia del bot estaba escrita y apagada. Es el mismo fallo
         * silencioso de siempre: no falla nada, simplemente no ocurre.
         */
        await this.botService.handleUnreadableMessage(senderId, message.type, {
          mediaFilename: cachedMedia?.filename || null
        });
      }
    } catch (error) {
      console.error(`❌ [YCloud Webhook] Error al guardar el mensaje ${message.id}:`, error);
    }
  }

  /**
   * Un asesor puede responder directo desde la app de WhatsApp Business
   * vinculada al número (modo coexistencia) o desde el inbox propio de
   * YCloud, sin pasar por este panel. YCloud reenvía esos envíos como
   * "whatsapp.smb.message.echoes" para que no se pierdan del historial — sin
   * esto, el hilo del panel se veía con saltos respecto a lo que el contacto
   * realmente recibió. Se guardan igual que un mensaje saliente y se pausa el
   * bot para ese contacto, igual que si hubiera respondido desde el botón
   * "Enviar" de este panel: evita que Avan le siga escribiendo encima de un
   * humano que ya está atendiendo.
   */
  async handleOutboundEcho(message) {
    const waId = message.to;
    if (!waId) return;

    try {
      const { isNew } = await this.messageService.recordOutboundEcho({
        waId,
        messageId: message.wamid || message.id,
        messageType: message.type,
        // Un adjunto que manda el asesor desde su celular no trae texto: con
        // `message.text?.body || ''` se guardaba una fila VACÍA y el panel (y
        // el resumen diario) mostraban renglones en blanco. `extractBody` le
        // pone la misma etiqueta que a un adjunto entrante ("[Imagen]",
        // "[Audio]", el nombre del documento…).
        body: extractBody(message),
        sentAt: message.sendTime ? new Date(message.sendTime) : new Date(),
        rawPayload: message
      });

      if (isNew && this.botService) {
        await this.botService.setBotEnabled(waId, false);
      }
    } catch (error) {
      console.error(`❌ [YCloud Webhook] Error al guardar el eco saliente ${message.id}:`, error);
    }
  }

  async handleStatusUpdate(message) {
    if (!message.wamid) return;
    const statusError = message.error
      ? `${message.error.code ? `[${message.error.code}] ` : ''}${message.error.message || ''}`.trim() || null
      : null;

    console.log(`📶 [YCloud Webhook] Actualización de estado: mensaje ${message.wamid} → ${message.status}${statusError ? ` (${statusError})` : ''}`);
    try {
      await this.messageService.updateStatus(message.wamid, message.status, statusError, message.id);
    } catch (error) {
      console.error(`❌ [YCloud Webhook] Error al actualizar el estado del mensaje ${message.wamid}:`, error);
    }
  }
}
