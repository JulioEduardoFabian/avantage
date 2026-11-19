import { db } from '../db/connection.js';

const MAX_RECENT = 30;

/**
 * Notificaciones internas del panel (campana del navbar): reuniones que Avan
 * agendó, pagos verificados, proyectos nuevos, casos donde un lead con reunión
 * ya agendada necesita que un asesor intervenga, y —desde el 13/11/2026— los
 * avisos que el equipo se escribe a mano (ver `noticeService.js`).
 *
 * Esto es además **el punto único desde donde sale el push a la app móvil**:
 * `create()` asienta la fila y de paso la empuja por Firebase. Se cuelga acá y
 * no de cada llamador por la misma razón que el aviso de proyecto nuevo vive en
 * `projectService` y no en sus tres rutas de alta — hay ocho sitios que crean
 * notificaciones, y puesto en cada uno, el noveno que se agregue se olvida y
 * nadie se entera de que no avisó. El push **no espera ni puede fallar hacia
 * afuera**: la fila ya quedó asentada, que es lo que la campana necesita, y un
 * FCM lento o caído no puede demorar el cierre de una venta ni tumbar el
 * webhook del bot.
 *
 * **`user_id` en NULL significa "para todos"**, y es como nacen todas las
 * automáticas: son avisos del negocio, no de una persona a otra. Un aviso
 * dirigido lleva el id de SU destinatario, y uno mandado a tres personas son
 * tres filas —una por cada una— para que `is_read` siga significando lo que
 * significa: cada quien marca el suyo. Ver la cabecera de la migración
 * `20261204000000_alter_notifications_add_recipient.js`.
 */
export class NotificationService {
  constructor({ pushService = null, routingService = null } = {}) {
    this.pushService = pushService;
    // El reparto por perfiles (`notification_routing`). Es OPCIONAL: sin él,
    // todo va a todos, que es el comportamiento de siempre.
    this.routingService = routingService;
  }

  /**
   * Lo que esa persona puede ver: lo suyo, más lo que es para todos **y le
   * toca por su perfil**.
   *
   * Está en un método y no copiado en las cuatro lecturas porque de él depende
   * que un aviso dirigido no se le muestre a quien no era — y una de las cuatro
   * que se olvide de filtrar es una fuga que no se ve mirando la pantalla.
   *
   * El reparto por perfiles solo recorta la rama de "para todos": un aviso
   * DIRIGIDO a una persona es suyo sin importar su perfil. Si no fuera así, dos
   * reglas pelearían por el mismo aviso y el que alguien mandó a tres personas
   * se le escondería a una de ellas.
   *
   * `blockedTypes` se pregunta una vez por lectura y se pasa, en vez de que el
   * método lo consulte: así las dos lecturas de un mismo pedido (la lista y el
   * contador) no pueden quedar mirando repartos distintos.
   */
  #visibleTo(query, userId, blockedTypes = []) {
    return query.where((builder) => {
      builder.where({ user_id: userId });
      builder.orWhere((global) => {
        global.whereNull('user_id');
        if (blockedTypes.length > 0) global.whereNotIn('type', blockedTypes);
      });
    });
  }

  /** Los tipos que este usuario no debe ver. Sin reparto configurado, ninguno. */
  async #blockedTypesFor(userId) {
    if (!userId || !this.routingService) return [];
    try {
      return await this.routingService.blockedTypesForUser(userId);
    } catch (error) {
      // Un fallo acá no puede dejar la campana vacía ni, peor, mostrarle a
      // alguien lo que no le toca: se cae del lado de mostrar de más, que es
      // el comportamiento que había antes del reparto.
      console.error('⚠️ [Notificaciones] No se pudo resolver el reparto por perfiles:', error.message);
      return [];
    }
  }

  async create({ type, title, body, link, userId = null, createdBy = null, batchId = null }) {
    const [id] = await db('notifications').insert({
      type,
      title,
      body: body || null,
      link: link || null,
      user_id: userId,
      created_by: createdBy,
      batch_id: batchId
    });
    const notification = await db('notifications').where({ id }).first();

    /*
     * El push NO se puede filtrar al leer, porque ya salió: el público se
     * resuelve acá, una vez, con las MISMAS filas de las que sale el filtro de
     * la campana. Si cada canal lo resolviera por su cuenta, el aviso le
     * sonaría en el bolsillo a alguien que después no lo encuentra en el panel.
     *
     * Solo para los avisos de "para todos": uno dirigido ya tiene destinatario.
     */
    let audienceUserIds = null;
    if (!userId && this.routingService) {
      audienceUserIds = await this.routingService.audienceUserIds(type).catch((error) => {
        console.error('⚠️ [Notificaciones] No se pudo resolver el público del push:', error.message);
        return null;
      });
    }

    // Dispara y se olvida: `sendForNotification` ya se traga su propio error.
    this.pushService?.sendForNotification(notification, { audienceUserIds });
    return notification;
  }

  async getRecent({ userId, limit = MAX_RECENT } = {}) {
    const query = db('notifications').orderBy('created_at', 'desc').limit(limit);
    if (!userId) return query;
    return this.#visibleTo(query, userId, await this.#blockedTypesFor(userId));
  }

  async getUnreadCount({ userId } = {}) {
    const query = db('notifications').where({ is_read: false });
    if (!userId) {
      const [{ count }] = await query.count('* as count');
      return Number(count);
    }
    const [{ count }] = await this.#visibleTo(query, userId, await this.#blockedTypesFor(userId))
      .count('* as count');
    return Number(count);
  }

  /**
   * Marcar leída comprueba que la notificación **sea visible para quien la
   * marca**, y no solo que exista.
   *
   * Sin eso, cualquiera con sesión podría marcar leído el aviso dirigido a otra
   * persona probando ids — que es el mismo cuidado que `requireLeadVisible`
   * tiene con la ficha de un lead: filtrar la lista y dejar la fila abierta por
   * id es una cortina, no un permiso.
   */
  async markRead(id, { userId } = {}) {
    const query = db('notifications').where({ id });
    if (!userId) return (await query.update({ is_read: true })) > 0;
    const afectadas = await this.#visibleTo(query, userId, await this.#blockedTypesFor(userId))
      .update({ is_read: true });
    return afectadas > 0;
  }

  /**
   * "Marcar todas leídas" marca exactamente **lo que esa persona ve**.
   *
   * El reparto por perfiles entra también acá y no solo en la lectura: un aviso
   * de "para todos" es UNA fila con el `is_read` compartido, así que marcar un
   * tipo que a uno le esconden se lo borraría de la campana a quien sí tenía
   * que atenderlo, sin haberlo visto nunca.
   */
  async markAllRead({ userId } = {}) {
    const query = db('notifications').where({ is_read: false });
    if (!userId) return query.update({ is_read: true });
    return this.#visibleTo(query, userId, await this.#blockedTypesFor(userId))
      .update({ is_read: true });
  }
}
