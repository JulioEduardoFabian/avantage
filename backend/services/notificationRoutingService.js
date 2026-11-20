import { db } from '../db/connection.js';
import {
  KNOWN_TYPES,
  audienceRoleIds,
  blockedTypesFor,
  routableTypes,
  routingMap
} from './notificationAudience.js';

/**
 * El reparto de los avisos automáticos entre perfiles (`notification_routing`).
 *
 * Las reglas puras están en `notificationAudience.js`; acá vive lo que toca la
 * base y, sobre todo, **la caché**: de estas filas depende cada lectura de la
 * campana, que se consulta al abrir el menú y cada 60 s para el contador. Sin
 * caché serían dos consultas más por minuto y por persona para leer una tabla
 * de treinta filas que cambia una vez al mes.
 *
 * La caché es de 30 s y se invalida al guardar, así que un cambio hecho desde
 * el panel se ve al instante en la pantalla de quien lo hizo y en menos de
 * medio minuto en la de los demás. No se cachea más tiempo porque lo que está
 * en juego es que alguien deje de ver un aviso que sí le tocaba.
 *
 * Como `botQualityService` y las rutas de `financeOptionService`, **sobrevive a
 * que la migración no haya corrido**: sin la tabla, `rows()` devuelve vacío y
 * eso significa "todo va a todos", que es el comportamiento de siempre. Una
 * tabla de configuración que falta no puede dejar al equipo sin avisos.
 */

function missingTable(error) {
  return error?.code === 'ER_NO_SUCH_TABLE';
}

const CACHE_TTL_MS = 30_000;

export class NotificationRoutingService {
  #cache = null;
  #cachedAt = 0;

  /** Las filas crudas, cacheadas. Vacío = todo va a todos. */
  async rows() {
    if (this.#cache && Date.now() - this.#cachedAt < CACHE_TTL_MS) return this.#cache;

    try {
      this.#cache = await db('notification_routing').select('type', 'role_id');
    } catch (error) {
      if (!missingTable(error)) throw error;
      this.#cache = [];
    }
    this.#cachedAt = Date.now();
    return this.#cache;
  }

  #invalidate() {
    this.#cache = null;
    this.#cachedAt = 0;
  }

  /**
   * Los tipos que este usuario NO debe ver, resueltos desde su perfil.
   *
   * El perfil se consulta por el id del usuario y no se lee del token: el JWT
   * lleva el NOMBRE del rol y no su id, y dura 8 h — alguien a quien le
   * cambian el perfil seguiría recibiendo los avisos del anterior durante toda
   * su sesión. Es una búsqueda por clave primaria.
   */
  async blockedTypesForUser(userId) {
    const rows = await this.rows();
    if (rows.length === 0) return [];

    const user = await db('users').where({ id: userId }).select('role_id').first();
    return blockedTypesFor(user?.role_id ?? null, rows);
  }

  /**
   * A qué usuarios va un aviso de este tipo, o `null` si va a todos.
   *
   * Es lo que necesita el push, que no se puede filtrar al leer: ese ya salió.
   * Sale de las MISMAS filas que el filtro de la campana — si los dos canales
   * resolvieran el público por su cuenta, el aviso le sonaría en el bolsillo a
   * alguien que después no lo encuentra en el panel.
   */
  async audienceUserIds(type) {
    const rows = await this.rows();
    const roleIds = audienceRoleIds(type, rows);
    if (!roleIds) return null;

    const users = await db('users').whereIn('role_id', roleIds).select('id');
    // Un tipo repartido entre perfiles que hoy no tiene a nadie devuelve una
    // lista VACÍA y no null: "no le toca a nadie" y "le toca a todos" son
    // cosas distintas, y confundirlas mandaría el aviso al equipo entero justo
    // cuando alguien lo acotó.
    return users.map((u) => u.id);
  }

  /**
   * Lo que necesita la pantalla: el catálogo, los perfiles y el reparto actual.
   * Las tres cosas en una respuesta porque el formulario es una matriz y
   * pedirlas por separado dejaría dibujar una grilla a medias.
   */
  async getConfig() {
    const [rows, roles] = await Promise.all([
      this.rows(),
      db('roles').select('id', 'name').orderBy('name', 'asc')
    ]);

    return {
      types: routableTypes(),
      roles,
      routing: routingMap(rows),
      // Sin la tabla no se puede guardar nada, y la pantalla tiene que poder
      // decirlo en vez de aceptar cambios que se pierden en silencio.
      editable: await this.#tableExists()
    };
  }

  async #tableExists() {
    try {
      await db('notification_routing').select('id').limit(1);
      return true;
    } catch (error) {
      if (missingTable(error)) return false;
      throw error;
    }
  }

  /**
   * Reemplaza el reparto de UN tipo.
   *
   * Se guarda tipo por tipo y no la matriz entera porque la pantalla se edita
   * marcando casillas: mandar las quince filas en cada clic haría que dos
   * personas configurando a la vez se pisaran el trabajo entero en vez de la
   * casilla que tocaron.
   *
   * Una lista VACÍA borra las reglas de ese tipo, o sea lo devuelve a "para
   * todos". Es el valor por defecto seguro: lo contrario —un tipo sin público,
   * que no viera nadie— sería un aviso desapareciendo sin que nadie lo pida.
   */
  async setRoles(type, roleIds = []) {
    if (!KNOWN_TYPES.has(type)) {
      const error = new Error('Ese tipo de aviso no existe.');
      error.status = 422;
      throw error;
    }

    const limpios = [...new Set((roleIds || []).map(Number).filter(Number.isInteger))];

    if (limpios.length > 0) {
      const existentes = await db('roles').whereIn('id', limpios).pluck('id');
      if (existentes.length !== limpios.length) {
        const error = new Error('Alguno de los perfiles elegidos ya no existe.');
        error.status = 422;
        throw error;
      }
    }

    await db.transaction(async (trx) => {
      await trx('notification_routing').where({ type }).del();
      if (limpios.length > 0) {
        await trx('notification_routing').insert(limpios.map((role_id) => ({ type, role_id })));
      }
    });

    this.#invalidate();
    return this.getConfig();
  }
}
