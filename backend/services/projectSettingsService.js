import { db } from '../db/connection.js';
import { isEmailShaped } from './deliverableSettingsService.js';

/**
 * Configuración (fila única) del módulo de Proyectos.
 *
 * Hoy solo lleva `notice_email`: el correo al que llega el aviso de proyecto
 * nuevo. Ver la migración `20261029000000_create_project_settings.js` para por
 * qué es una fila en la base y no una variable de entorno.
 *
 * La validación del correo se reusa de `deliverableSettingsService`: es la
 * misma pregunta y responderla distinto en cada pantalla sería peor que
 * compartirla — un correo que una acepta y la otra rechaza no tiene
 * explicación para quien lo escribe.
 */
export class ProjectSettingsService {
  async get() {
    let row = await db('project_settings').orderBy('id', 'asc').first();
    // Salvaguarda por si la tabla quedó vacía (no debería: la migración siembra
    // la fila).
    if (!row) {
      const [id] = await db('project_settings').insert({ notice_email: null });
      row = await db('project_settings').where({ id }).first();
    }
    return { noticeEmail: row.notice_email || '' };
  }

  /**
   * Guarda el destinatario del aviso. Vaciar el campo es una opción válida y no
   * un error: deja el aviso en manos de `INTERNAL_ALERT_EMAIL`.
   */
  async update({ noticeEmail } = {}) {
    const value = String(noticeEmail ?? '').trim();
    if (value && !isEmailShaped(value)) {
      const error = new Error('Ese correo no parece válido. Revisa que tenga una arroba y un punto, por ejemplo: nombre@empresa.com');
      error.code = 'INVALID_EMAIL';
      throw error;
    }

    const row = await db('project_settings').orderBy('id', 'asc').first();
    if (row) {
      await db('project_settings').where({ id: row.id }).update({
        notice_email: value || null,
        updated_at: db.fn.now()
      });
    } else {
      await db('project_settings').insert({ notice_email: value || null });
    }
    return this.get();
  }
}
