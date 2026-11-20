import crypto from 'node:crypto';
import { db } from '../db/connection.js';
import { avatarUrlFor } from './userService.js';

/**
 * Los avisos que el equipo se escribe a mano desde el panel
 * (`/admin/avisos`, permiso `notices.send`).
 *
 * Hasta el 13/11/2026 las notificaciones nacían SOLO de eventos del negocio
 * (ocho sitios: el bot, los dos avisos de Finanzas, el de proyecto nuevo, el
 * del portal del cliente). Con la app móvil instalada, el equipo tiene de golpe
 * un canal al bolsillo de cada uno y no había forma de usarlo para lo que la
 * gente de verdad necesita decirse: "reunión a las 5", "se cayó el internet",
 * "hoy no hay luz en la oficina".
 *
 * **No tiene tabla propia**, como Cobranzas y el Reporte de Leads: un aviso
 * manual es una fila de `notifications` con `created_by` escrito. Inventarle una
 * tabla paralela obligaría a que la campana del panel leyera de dos lados y a
 * mantener sincronizado el "no leído" en los dos — y el día que se separen,
 * nadie sabría cuál dice la verdad.
 *
 * **Un aviso a tres personas son TRES filas**, una por destinatario, unidas por
 * `batch_id`. Es lo que hace que `is_read` siga significando lo que significa:
 * cada quien marca el suyo. Con una fila compartida, el primero que lo abre lo
 * marca leído para los otros dos.
 *
 * **Los roles se expanden a personas EN EL MOMENTO DE MANDAR**, y el rol elegido
 * queda escrito solo para mostrarlo. Resolverlo en cada lectura haría que quien
 * entre al rol la semana que viene vea un aviso que nunca recibió —el push ya
 * salió sin él— y que quien salga del rol pierda uno que sí le llegó al
 * teléfono. Es la misma razón por la que la comisión guarda su porcentaje en la
 * fila: lo que pasó, pasó con los datos de ese momento.
 */

export const MANUAL_NOTICE_TYPE = 'team_notice';

const MAX_TITLE = 120;
const MAX_BODY = 1000;
const MAX_HISTORY = 50;

export class NoticeService {
  constructor({ notificationService, userService } = {}) {
    this.notificationService = notificationService;
    this.userService = userService;
  }

  /**
   * A quién se le puede mandar: las personas del panel y los roles.
   *
   * Son TODOS los usuarios y no el área comercial (`listCommercialTeam()`): un
   * aviso del equipo le puede tocar a quien lleva las entregas o a quien hace
   * la contabilidad, que no trabajan leads.
   */
  async audiences() {
    const [usuarios, roles] = await Promise.all([
      db('users')
        .leftJoin('roles', 'roles.id', 'users.role_id')
        .select(
          'users.id', 'users.name', 'users.email', 'users.avatar_filename',
          'users.role_id', 'roles.name as role_name'
        )
        .orderBy('users.name', 'asc'),
      db('roles')
        .leftJoin('users', 'users.role_id', 'roles.id')
        .select('roles.id', 'roles.name')
        .count('users.id as people')
        .groupBy('roles.id', 'roles.name')
        .orderBy('roles.name', 'asc')
    ]);
    return {
      // La foto viaja como URL ya armada (`avatarUrlFor`, el mismo sitio que la
      // del navbar y la del equipo de un proyecto) y no como nombre de archivo:
      // la carpeta base la decide `UPLOADS_DIR` y puede cambiar entre
      // despliegues. Donde no haya foto, la pantalla dibuja las iniciales.
      users: usuarios.map(({ avatar_filename: avatarFilename, ...resto }) => ({
        ...resto,
        avatar_url: avatarUrlFor(avatarFilename)
      })),
      roles: roles.map((rol) => ({ ...rol, people: Number(rol.people) }))
    };
  }

  /**
   * ¿Es una ruta de ESTE panel?
   *
   * No alcanza con que empiece por `/`: **`//evil.com` también empieza por `/`**
   * y el navegador lo resuelve como `https://evil.com` (es una URL relativa al
   * protocolo). Lo mismo con `/\evil.com`, que varios navegadores normalizan a
   * `//evil.com`. Los dos pasaban la comprobación anterior, y de acá cuelga el
   * destino al que va el que toca un aviso que le llegó al teléfono con el
   * nombre de la empresa arriba — o sea, la forma exacta de un phishing interno.
   *
   * Se exige entonces: una sola barra, y que lo que sigue no sea otra barra ni
   * una barra invertida.
   */
  static isInternalPath(link) {
    return /^\/(?![/\\])/.test(link);
  }

  /**
   * Quiénes reciben, resuelto una vez y sin repetidos.
   *
   * Es puro a propósito (recibe las filas, no consulta): de acá depende a qué
   * teléfonos llega el aviso, y es la parte que conviene poder probar sin base.
   */
  static resolveRecipients({ everyone = false, userIds = [], roleUsers = [] }) {
    if (everyone) return { everyone: true, userIds: [] };
    // Una persona elegida a dedo Y además por su rol es UNA destinataria: sin
    // el desduplicado le llegarían dos avisos idénticos y dos pushes.
    const unicos = new Set([...userIds, ...roleUsers].map(Number).filter((id) => Number.isInteger(id) && id > 0));
    return { everyone: false, userIds: [...unicos] };
  }

  /**
   * Manda el aviso. Devuelve el resumen para que la pantalla diga qué pasó.
   *
   * El push **no se espera**: cada `create()` lo dispara y se olvida (es la
   * regla de `notificationService`). Así, mandarle un aviso a quince personas
   * contesta al instante en vez de esperar quince llamadas a Firebase.
   */
  async send({ title, body = '', link = null, everyone = false, userIds = [], roleIds = [], senderId }) {
    const tituloLimpio = String(title || '').trim();
    if (!tituloLimpio) throw new Error('El aviso necesita un título.');
    if (tituloLimpio.length > MAX_TITLE) {
      throw new Error(`El título no puede pasar de ${MAX_TITLE} caracteres.`);
    }
    const cuerpoLimpio = String(body || '').trim();
    if (cuerpoLimpio.length > MAX_BODY) {
      throw new Error(`El mensaje no puede pasar de ${MAX_BODY} caracteres.`);
    }

    // El enlace se valida: termina siendo un destino al que la app y el panel
    // llevan al que toca el aviso. Se admite solo una ruta interna del panel
    // (`/admin/...`), no una URL cualquiera: un aviso que manda a un dominio de
    // afuera es exactamente la forma de la que está hecho un phishing interno,
    // y el push le llega a todo el equipo con el nombre de la empresa arriba.
    const enlaceLimpio = String(link || '').trim();
    if (enlaceLimpio && !NoticeService.isInternalPath(enlaceLimpio)) {
      throw new Error('El enlace tiene que ser una ruta del panel (empieza con "/"), no una dirección de afuera.');
    }

    const roleUsers = roleIds.length > 0
      ? (await db('users').whereIn('role_id', roleIds.map(Number)).select('id')).map((u) => u.id)
      : [];

    const destino = NoticeService.resolveRecipients({ everyone, userIds, roleUsers });
    if (!destino.everyone && destino.userIds.length === 0) {
      throw new Error('Elegí a quién le llega el aviso, o marcá "a todo el equipo".');
    }

    // El lote se marca incluso cuando va a todos (una sola fila): así el
    // historial lo encuentra por el mismo camino que los dirigidos, en vez de
    // tener que distinguir dos formas de lo mismo.
    const batchId = crypto.randomBytes(12).toString('hex');
    const comun = {
      type: MANUAL_NOTICE_TYPE,
      title: tituloLimpio,
      body: cuerpoLimpio || null,
      link: enlaceLimpio || null,
      createdBy: senderId,
      batchId
    };

    if (destino.everyone) {
      await this.notificationService.create({ ...comun, userId: null });
      return { batchId, everyone: true, recipients: 0 };
    }

    for (const userId of destino.userIds) {
      await this.notificationService.create({ ...comun, userId });
    }
    return { batchId, everyone: false, recipients: destino.userIds.length };
  }

  /**
   * El historial: UN renglón por envío, no uno por destinatario.
   *
   * Agrupa por `batch_id` porque es la única forma de que un aviso a diez
   * personas se lea como "esto se mandó una vez, a diez" y no como diez avisos
   * distintos. Y dice cuántos lo leyeron, que es lo que uno se pregunta después
   * de mandarlo.
   */
  async history({ limit = MAX_HISTORY } = {}) {
    const lotes = await db('notifications')
      .whereNotNull('batch_id')
      .select('batch_id')
      .max('created_at as created_at')
      .groupBy('batch_id')
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (lotes.length === 0) return [];

    const ids = lotes.map((l) => l.batch_id);
    const filas = await db('notifications')
      .leftJoin('users as autor', 'autor.id', 'notifications.created_by')
      .leftJoin('users as destino', 'destino.id', 'notifications.user_id')
      .whereIn('notifications.batch_id', ids)
      .select(
        'notifications.batch_id', 'notifications.title', 'notifications.body', 'notifications.link',
        'notifications.is_read', 'notifications.created_at', 'notifications.user_id',
        'autor.name as sender_name', 'destino.name as recipient_name'
      );

    const leida = (fila) => fila.is_read === 1 || fila.is_read === true;

    return lotes.map(({ batch_id: batchId }) => {
      const delLote = filas.filter((f) => f.batch_id === batchId);
      const primera = delLote[0];
      const paraTodos = delLote.some((f) => f.user_id === null);
      return {
        batch_id: batchId,
        title: primera.title,
        body: primera.body,
        link: primera.link,
        created_at: primera.created_at,
        sender_name: primera.sender_name || null,
        everyone: paraTodos,
        // Para un aviso a todos no hay destinatarios que contar: la campana la
        // ve cualquiera con sesión, y poner la cantidad de usuarios del panel
        // afirmaría que le llegó a gente que quizá nunca abrió la app.
        recipients: paraTodos ? null : delLote.length,
        read_count: paraTodos ? null : delLote.filter(leida).length,
        /*
         * QUIÉNES, y no solo cuántos. Es lo que le permite a la pantalla
         * dibujar el cuadro de "quién recibe qué" sin pedir otra ruta ni
         * calcular otro estado: el cuadro se arma sobre estas mismas filas, así
         * que el historial y el cuadro no pueden decir cosas distintas.
         *
         * `read` viaja por destinatario porque cada uno marca el suyo (son
         * filas distintas, unidas por `batch_id`). En un aviso a TODOS no hay
         * destinatarios ni lectura por persona que informar: es una sola fila
         * con `user_id` en NULL, así que su `is_read` es el de quien la abrió
         * primero y no dice nada de los demás.
         */
        recipient_list: paraTodos
          ? []
          : delLote
            .filter((f) => f.user_id !== null)
            .map((f) => ({ id: f.user_id, name: f.recipient_name || null, read: leida(f) }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
      };
    });
  }
}
