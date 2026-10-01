import { db } from '../db/connection.js';

/**
 * Configuración (fila única) del módulo de Entregables.
 *
 * Hoy solo lleva `notice_email`: el correo al que llega el aviso de cuota
 * verificada. Ver la migración `20261027000000_create_deliverable_settings.js`
 * para por qué es una fila en la base y no una variable de entorno.
 */

/**
 * Validación deliberadamente laxa: "tiene algo, una arroba, un punto después y
 * ningún espacio". Una expresión estricta de correo rechaza direcciones
 * válidas y la persona que la escribe no tiene cómo saber por qué — para eso
 * está el botón de prueba, que comprueba lo único que importa de verdad: que
 * el correo LLEGUE.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailShaped(value) {
  return EMAIL_SHAPE.test(String(value || '').trim());
}

export class DeliverableSettingsService {
  async get() {
    let row = await db('deliverable_settings').orderBy('id', 'asc').first();
    // Salvaguarda por si la tabla quedó vacía (no debería: la migración siembra
    // la fila).
    if (!row) {
      const [id] = await db('deliverable_settings').insert({ notice_email: null });
      row = await db('deliverable_settings').where({ id }).first();
    }
    return { noticeEmail: row.notice_email || '' };
  }

  /**
   * Guarda el destinatario del aviso. Vaciar el campo es una opción válida y
   * no un error: deja el aviso en manos de `INTERNAL_ALERT_EMAIL`, que es el
   * comportamiento de una instalación recién montada.
   */
  async update({ noticeEmail } = {}) {
    const value = String(noticeEmail ?? '').trim();
    if (value && !isEmailShaped(value)) {
      const error = new Error('Ese correo no parece válido. Revisa que tenga una arroba y un punto, por ejemplo: nombre@empresa.com');
      error.code = 'INVALID_EMAIL';
      throw error;
    }

    const row = await db('deliverable_settings').orderBy('id', 'asc').first();
    if (row) {
      await db('deliverable_settings').where({ id: row.id }).update({
        notice_email: value || null,
        updated_at: db.fn.now()
      });
    } else {
      await db('deliverable_settings').insert({ notice_email: value || null });
    }
    return this.get();
  }
}
