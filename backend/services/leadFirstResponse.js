import { db } from '../db/connection.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from './leadService.js';

/**
 * La marca de "a este lead ya se le contestó", escrita desde los dos caminos
 * por los que de verdad se contesta.
 *
 * Vive en un módulo propio —y no dentro de `leadService`— porque los que la
 * escriben son los otros: el servicio de mensajes de WhatsApp (cada saliente,
 * lo mande Avan o una persona) y la primera nota de la ficha, que es donde
 * queda el registro de una llamada. Metida en `leadService` obligaría a
 * `whatsappMessageService` a importar el servicio de leads entero.
 *
 * Nunca pisa la marca existente: lo que interesa es la PRIMERA respuesta, que
 * es la que se compara contra las 24 horas. Y nunca puede tumbar un envío: si
 * el `UPDATE` falla, el mensaje ya salió y lo que se pierde es una marca de
 * seguimiento, así que se registra y se sigue.
 */

/**
 * Marca la primera respuesta del lead que tenga este teléfono.
 *
 * El cruce es por los ÚLTIMOS 9 DÍGITOS y además por la cadena exacta, el
 * mismo criterio de `leadService.findByPhone()`: el `wa_id` llega como lo manda
 * Meta ("51987654321"), el teléfono del lead como lo escribió quien llenó el
 * formulario ("+51 987 654 321"), y hay `wa_id` que no son teléfonos sino
 * identificadores de usuario de la empresa ("PE.2379096279586501") — para esos
 * la única comparación posible es la exacta.
 *
 * @param {string} waId    el contacto al que se le escribió
 * @param {object} options `sentBy` null = contestó Avan (igual que `sent_by`)
 */
export async function stampFirstResponseByPhone(waId, { sentBy = null, at = null } = {}) {
  const phone = String(waId || '').trim();
  if (!phone) return 0;

  const key = phoneMatchKey(phone);

  try {
    return await db('leads')
      .where((q) => {
        q.where('leads.phone', phone);
        if (key) q.orWhereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [key]);
      })
      .whereNull('first_response_at')
      .update({
        first_response_at: at || new Date(),
        first_response_by: sentBy || null
      });
  } catch (error) {
    console.error(`⚠️ No se pudo marcar la primera respuesta de ${phone}:`, error.message);
    return 0;
  }
}

/** Ídem, cuando ya se sabe de qué lead se trata (una nota de la ficha). */
export async function stampFirstResponseByLead(leadId, { sentBy = null, at = null } = {}) {
  if (!leadId) return 0;

  try {
    return await db('leads')
      .where({ id: leadId })
      .whereNull('first_response_at')
      .update({
        first_response_at: at || new Date(),
        first_response_by: sentBy || null
      });
  } catch (error) {
    console.error(`⚠️ No se pudo marcar la primera respuesta del lead #${leadId}:`, error.message);
    return 0;
  }
}
