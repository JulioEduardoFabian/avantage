import { db } from '../db/connection.js';
import { classifyActivity, summarise, QUALITY_KINDS } from './botQuality.js';

/**
 * Persistencia del monitor de calidad del bot (`bot_quality_events`).
 *
 * La mitad que decide QUÉ se guarda es `botQuality.js`, que es pura y tiene
 * test. Acá está lo que toca la base y las dos lecturas que usa la pantalla.
 *
 * Tres reglas de este servicio, y las tres salieron de que esto se cuelga del
 * camino por el que pasa cada turno del bot:
 *
 * (1) **No puede lanzar.** Un fallo al anotar que algo salió mal no puede ser
 *     la causa de que el turno se caiga: lo que se perdería es la respuesta al
 *     contacto, que es infinitamente más caro que la fila de la bitácora. Todo
 *     lo que escribe va dentro de un `catch` que solo registra en consola.
 *
 * (2) **No se espera.** `record()` se llama sin `await` desde
 *     `logActivity()`, que es sincrónico y corre a mitad de un turno. Mismo
 *     patrón y mismas razones que el push de `notificationService.create()` y
 *     que los avisos de Finanzas: el hecho ya ocurrió, y la anotación no puede
 *     demorar la conversación.
 *
 * (3) **Sobrevive a que la migración no haya corrido** (`missingTable()`),
 *     igual que las tres rutas de `financeOptionService`: en un entorno sin la
 *     tabla el bot sigue conversando y lo único que no pasa es que se mida.
 *     Al revés —el bot caído porque falta una tabla de métricas— es cambiar
 *     una función que no existía por la que sí había.
 */

function missingTable(error) {
  return error?.code === 'ER_NO_SUCH_TABLE';
}

const MIGRATION_PENDING = 'El monitor de calidad del bot todavía no está creado en esta base de '
  + 'datos: falta aplicar la migración pendiente (npm run migrate) en el servidor.';

export class BotQualityService {
  /**
   * Anota una entrada de la bitácora si contesta una de las cuatro preguntas.
   * Devuelve una promesa que NUNCA se rechaza (ver regla 1).
   */
  async record(entry) {
    const event = classifyActivity(entry);
    if (!event) return null;

    try {
      await db('bot_quality_events').insert({
        kind: event.kind,
        actor: event.actor,
        severity: event.severity,
        event_type: event.eventType,
        wa_id: event.waId,
        detail: event.detail
      });
      return event;
    } catch (error) {
      if (!missingTable(error)) {
        console.error('❌ [Bot Calidad] No se pudo anotar el evento:', error.message);
      }
      return null;
    }
  }

  /**
   * Las filas del período, de la más reciente a la más vieja.
   *
   * `days` se cuenta en días y no en fechas exactas porque la pregunta que se
   * hace es "¿cómo viene la última semana?", y el tope de filas existe porque
   * esta tabla crece con cada turno: una consulta sin límite sobre tres meses
   * de conversaciones es una pantalla que no carga.
   */
  async list({ days = 7, kind = null, waId = null, limit = 500 } = {}) {
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    try {
      const query = db('bot_quality_events')
        .where('created_at', '>=', since)
        .orderBy('created_at', 'desc')
        .limit(Math.min(Math.max(1, limit), 2000));

      if (kind && QUALITY_KINDS.includes(kind)) query.where({ kind });
      if (waId) query.where({ wa_id: waId });

      return await query;
    } catch (error) {
      if (missingTable(error)) return [];
      throw error;
    }
  }

  /**
   * El resumen del período: el total por pregunta y quién la provocó.
   *
   * El conteo se hace en el servidor con un `GROUP BY` y no sumando las filas
   * de `list()`: aquella está limitada, así que el resumen derivado de ella
   * diría "500" para cualquier semana con más de 500 eventos — una cifra que
   * se parece a un dato y es el tope de la consulta disfrazado, el mismo fallo
   * que tenía el "100 conversaciones" de la bandeja de WhatsApp.
   */
  async summary({ days = 7 } = {}) {
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    try {
      const rows = await db('bot_quality_events')
        .where('created_at', '>=', since)
        .select('kind', 'actor', 'severity', 'event_type')
        .count({ total: 'id' })
        .countDistinct({ conversaciones: 'wa_id' })
        .groupBy('kind', 'actor', 'severity', 'event_type');

      // `summarise()` cuenta filas, así que el agrupado se expande a su
      // número de ocurrencias: de esa forma la cuenta vive en UN solo sitio y
      // la pantalla no puede decir un total distinto del de la tira de arriba.
      const expanded = [];
      for (const row of rows) {
        for (let i = 0; i < Number(row.total); i += 1) {
          expanded.push({ kind: row.kind, actor: row.actor, event_type: row.event_type });
        }
      }

      const conversaciones = await db('bot_quality_events')
        .where('created_at', '>=', since)
        .countDistinct({ total: 'wa_id' })
        .first();

      return {
        ...summarise(expanded),
        // El distinto de conversaciones sale de su propia consulta: el mismo
        // contacto aparece en varias filas del agrupado y sumarlas lo contaría
        // una vez por pregunta.
        conversaciones: Number(conversaciones?.total || 0),
        dias: days,
        disponible: true
      };
    } catch (error) {
      if (missingTable(error)) {
        return { ...summarise([]), conversaciones: 0, dias: days, disponible: false, aviso: MIGRATION_PENDING };
      }
      throw error;
    }
  }

  /**
   * Borra lo anterior al período de retención. Esta tabla no es historia que
   * haya que conservar —es un tablero de lo que hay que arreglar ahora—, y sin
   * una poda crece con cada turno de cada conversación para siempre.
   */
  async prune({ keepDays = 90 } = {}) {
    const cutoff = new Date(Date.now() - Math.max(1, keepDays) * 24 * 60 * 60 * 1000);
    try {
      return await db('bot_quality_events').where('created_at', '<', cutoff).del();
    } catch (error) {
      if (missingTable(error)) return 0;
      throw error;
    }
  }
}
