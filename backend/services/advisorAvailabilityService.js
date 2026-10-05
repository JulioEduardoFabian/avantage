import { db } from '../db/connection.js';

/**
 * Horario semanal recurrente de disponibilidad para reuniones, configurado
 * por cada usuario para sí mismo (bloques de media hora por día).
 */
export class AdvisorAvailabilityService {
  async getByUser(userId) {
    return db('advisor_availability')
      .select('day_of_week', 'start_time')
      .where({ user_id: userId })
      .orderBy(['day_of_week', 'start_time']);
  }

  /**
   * El horario de varias personas en UNA consulta, para cruzarlos.
   *
   * Lo pide el Calendario cuando se eligen dos o tres asesores y hay que
   * pintar en qué bloques coinciden: una consulta por persona dentro de un
   * bucle multiplica los viajes a la base cada vez que alguien marca una
   * casilla más.
   */
  async getByUsers(userIds) {
    const ids = [...new Set((userIds || []).map(Number).filter(Number.isInteger))];
    if (ids.length === 0) return [];
    return db('advisor_availability')
      .select('user_id', 'day_of_week', 'start_time')
      .whereIn('user_id', ids)
      .orderBy(['user_id', 'day_of_week', 'start_time']);
  }

  /**
   * Reemplaza todo el horario del usuario por la lista de bloques recibida
   * (guardado tipo "foto completa", más simple y predecible que un diff
   * incremental para una grilla que el usuario pinta libremente).
   */
  async replaceForUser(userId, slots) {
    const rows = (slots || [])
      .filter((slot) => Number.isInteger(slot.dayOfWeek) && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6 && /^\d{2}:\d{2}$/.test(slot.startTime))
      .map((slot) => ({ user_id: userId, day_of_week: slot.dayOfWeek, start_time: slot.startTime }));

    await db.transaction(async (trx) => {
      await trx('advisor_availability').where({ user_id: userId }).del();
      if (rows.length > 0) {
        await trx('advisor_availability').insert(rows);
      }
    });

    return this.getByUser(userId);
  }
}
