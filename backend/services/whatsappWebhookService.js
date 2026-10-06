import crypto from 'crypto';
import { WhatsappMessageService, detectWhatsappChannel, extractBody } from './whatsappMessageService.js';
import { LeadService } from './leadService.js';

const MAX_RECENT_EVENTS = 50;

// En modo coexistencia (número vinculado también a la app de WhatsApp
// Business del celular vía Embedded Signup), Meta puede reenviar como
// mensajes entrantes del historial del teléfono al sincronizar — no solo
// mensajes que el contacto acaba de escribir. Si se procesaran igual como
// disparador del bot, este le respondería (o le borraría el recordatorio de
// inactividad ya mandado, nudge_sent_at) a partir de un mensaje de hace rato.
// Se descarta como disparador cualquier mensaje cuyo "timestamp" real sea más
// viejo que esta ventana (igual se guarda en el historial de mensajes).
const COEXISTENCE_SYNC_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Recepción de eventos del webhook de WhatsApp Business Platform: mensajes
 * entrantes (campo "messages") y actualizaciones de estado de los mensajes
 * enviados (entregado/leído/fallido).
 */
export class WhatsappWebhookService {
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
   * Valida el reto de verificación (GET) que envía Meta al configurar el webhook.
   */
  verifyChallenge(mode, token) {
    return mode === 'subscribe' && !!process.env.META_WHATSAPP_VERIFY_TOKEN && token === process.env.META_WHATSAPP_VERIFY_TOKEN;
  }

  /**
   * Valida la firma X-Hub-Signature-256 del payload (POST). Usa el mismo App
   * Secret que el resto de webhooks de la app (WhatsApp comparte la app de Meta).
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
   * Procesa una entrada ("entry") del payload: guarda cada mensaje entrante y
   * actualiza el estado (enviado/entregado/leído/fallido) de los salientes.
   */
  async handleEntry(entry) {
    const changes = entry?.changes || [];
    for (const change of changes) {
      // En coexistencia, lo que el asesor escribe desde la app de WhatsApp
      // Business del celular NO llega por "messages" sino por su propio campo,
      // "smb_message_echoes" ("smb" por small business: es el eco de la APP,
      // no el de la Cloud API). Hasta que se empezó a leer, esos mensajes se
      // descartaban acá mismo y el bot nunca se enteraba de que había un
      // humano atendiendo: le seguía mandando recordatorios por encima y, si
      // la conversación no tenía fila de sesión, _recoverOrphanInbounds() la
      // revivía con un "Perdona la demora" porque el último mensaje guardado
      // seguía siendo el del contacto.
      //
      // OJO con el nombre: el campo hermano "message_echoes" (sin "smb") es
      // otra cosa —el eco de lo que sale por la Cloud API— y suscribirlo en el
      // panel de Meta da error en una cuenta de coexistencia. Se acepta igual
      // por si alguna versión lo entrega así; el filtro de duplicados de abajo
      // hace que, aun en ese caso, los mensajes del propio bot no pausen nada.
      if (change.field === 'smb_message_echoes' || change.field === 'message_echoes') {
        await this.handleEchoes(change.value || {});
        continue;
      }
      if (change.field !== 'messages') continue;
      const value = change.value || {};

      for (const message of value.messages || []) {
        const senderId = message.from || message.from_user_id;
        if (!senderId) continue;

        const isFreshMessage = message.timestamp
          ? Date.now() - Number(message.timestamp) * 1000 <= COEXISTENCE_SYNC_MAX_AGE_MS
          : true;

        try {
          const { record, isNew } = await this.messageService.createFromMessage(value, message);

          // Se crea/actualiza el lead tanto si el remitente compartió un
          // número real ("from") como si solo viene identificado por un
          // Business-Scoped User ID ("from_user_id" — típico de alguien que
          // escribió tras tocar "Enviar mensaje" en un anuncio o publicación
          // de Instagram/Facebook sin compartir su número). El "phone" del
          // lead queda con ese mismo identificador; sendTextMessage() ya
          // sabe responderle a un BSUID vía el campo "recipient" de la Graph
          // API, así que excluirlo aquí solo dejaba a esos leads sin bot.
          const contact = (value.contacts || []).find((c) => (c.wa_id || c.user_id) === senderId);
          await this.leadService.findOrCreateFromWhatsApp({
            phone: senderId,
            fullName: contact?.profile?.name,
            source: detectWhatsappChannel(message.referral)
          });

          // Mensajes de texto siempre; un audio solo si se pudo transcribir
          // (createFromMessage ya dejó la transcripción en record.body en vez
          // del placeholder "[Audio]" — ver resolveMessageBody()). Y solo si
          // el mensaje es realmente nuevo (Meta puede reenviar el mismo
          // evento por reintentos; sin este chequeo el bot lo procesaría dos veces).
          const triggerText = message.type === 'text'
            ? message.text?.body
            : (message.type === 'audio' && record?.body !== '[Audio]' ? record?.body : null);
          if (isNew && isFreshMessage && this.botService && triggerText) {
            await this.botService.handleIncomingMessage(senderId, triggerText, message.id);
          } else if (isNew && isFreshMessage && this.botService) {
            // Lo que el bot NO puede leer (una foto, un PDF, un audio que no se
            // pudo transcribir) caía acá y no pasaba nada: ni respuesta ni
            // aviso. Desde el otro lado eso se lee como un visto. Ahora al
            // menos se admite que llegó y se pide el dato por escrito — ver
            // `handleUnreadableMessage`, que decide a qué tipos sí contestar.
            await this.botService.handleUnreadableMessage(senderId, message.type);
          }
        } catch (error) {
          console.error(`❌ [WhatsApp Webhook] Error al guardar el mensaje ${message.id}:`, error);
        }
      }

      for (const status of value.statuses || []) {
        const statusError = (status.errors || [])
          .map((e) => `[${e.code}] ${e.title}${e.error_data?.details ? `: ${e.error_data.details}` : ''}`)
          .join(' | ') || null;

        console.log(`📶 [WhatsApp Webhook] Actualización de estado: mensaje ${status.id} → ${status.status}${statusError ? ` (${statusError})` : ''}`);
        try {
          await this.messageService.updateStatus(status.id, status.status, statusError);
        } catch (error) {
          console.error(`❌ [WhatsApp Webhook] Error al actualizar el estado del mensaje ${status.id}:`, error);
        }
      }
    }
  }

  /**
   * Mensajes que salieron del número SIN pasar por este panel: el asesor
   * respondiendo desde la app de WhatsApp Business vinculada, o desde un
   * dispositivo enlazado (coexistencia). Meta los reenvía por el campo
   * "smb_message_echoes".
   *
   * Hacen dos cosas: se guardan en el hilo (sin esto el panel mostraba la
   * conversación con huecos, porque lo que el asesor escribía no estaba en
   * ninguna parte) y PAUSAN el bot para ese contacto, igual que el botón
   * "Enviar" del panel. Sin esa pausa, Avan le seguía mandando "¿Sigues por
   * ahí?" por encima de un humano que ya estaba atendiendo.
   *
   * Que este eco sea señal limpia de "hay un humano" no es casualidad: según
   * la documentación de Meta, "smb_message_echoes" trae SOLO lo enviado desde
   * la app o un dispositivo enlazado, nunca lo que sale por la Cloud API. Es
   * decir, los mensajes del propio bot no aparecen acá y no hay riesgo de que
   * se apague solo.
   *
   * Aun así se pausa únicamente cuando `recordOutboundEcho` devuelve isNew:
   * inserta con onConflict(message_id).ignore(), así que un reenvío del mismo
   * evento (Meta reintenta) no vuelve a pausar, y si alguna vez llegara por
   * acá un eco de la Cloud API, chocaría con la fila que ya guardó
   * sendTextMessage() con ese mismo wamid y tampoco pausaría.
   */
  async handleEchoes(value) {
    // Según la versión de la API el array viene como "message_echoes" o,
    // reusando el nombre de siempre, como "messages" dentro de este campo.
    const echoes = value.message_echoes || value.messages || [];

    for (const echo of echoes) {
      // "to" es el contacto; "from" es el número del negocio. Un eco sin
      // destinatario no se puede atribuir a ninguna conversación.
      const waId = echo.to || echo.recipient_id;
      if (!waId) continue;

      try {
        const { isNew } = await this.messageService.recordOutboundEcho({
          waId,
          messageId: echo.id,
          messageType: echo.type,
          body: extractBody(echo),
          sentAt: echo.timestamp ? new Date(Number(echo.timestamp) * 1000) : new Date(),
          rawPayload: echo
        });

        if (isNew && this.botService) {
          console.log(`🙋 [WhatsApp Webhook] Eco saliente de ${waId} desde la app de Business: se pausa Avan.`);
          await this.botService.setBotEnabled(waId, false);
        }
      } catch (error) {
        console.error(`❌ [WhatsApp Webhook] Error al guardar el eco saliente ${echo.id}:`, error);
      }
    }
  }
}
