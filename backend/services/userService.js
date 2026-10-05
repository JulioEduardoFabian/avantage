import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';

/**
 * Los permisos que definen al área comercial (ver `listCommercialTeam()`).
 *
 * Son dos desde que el equipo se partió en setter y closer: cada uno entra por
 * su tablero y a los dos se les asignan leads. Se pregunta por el permiso y no
 * por el nombre del rol para que "Closer Senior" o "Setter de turno noche"
 * entren solos el día que el equipo los cree.
 */
const COMMERCIAL_PERMISSIONS = ['leads.view', 'setter.view'];

/**
 * Servicio de acceso a datos para usuarios internos (login, gestión de cuentas).
 */
export class UserService {
  async getUserByEmail(email) {
    return db('users').where({ email }).first();
  }

  /**
   * El usuario con sus permisos **efectivos**: los de su rol, más los que se le
   * dieron a él y menos los que se le quitaron (`user_permissions`).
   *
   * Es el único sitio donde se resuelve esa cuenta. Se llama en el login y en
   * `/api/auth/me`, y el resultado viaja embebido en el JWT: las rutas no
   * vuelven a consultarla en cada request. Por eso un cambio de permisos se ve
   * recién cuando el navegador refresca la sesión, igual que antes con los
   * permisos del rol.
   */
  async getUserWithPermissions(userId) {
    const user = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.id', userId)
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role')
      .first();

    if (!user) return null;

    const delRol = await db('permissions')
      .join('role_permissions', 'role_permissions.permission_id', 'permissions.id')
      .where('role_permissions.role_id', user.role_id)
      .pluck('permissions.key');

    const excepciones = await db('permissions')
      .join('user_permissions', 'user_permissions.permission_id', 'permissions.id')
      .where('user_permissions.user_id', user.id)
      .select('permissions.key', 'user_permissions.granted');

    const permissions = new Set(delRol);
    for (const excepcion of excepciones) {
      if (excepcion.granted) permissions.add(excepcion.key);
      else permissions.delete(excepcion.key);
    }

    return { ...user, permissions: [...permissions] };
  }

  /**
   * El detalle de permisos de una persona para la pantalla de Perfiles: qué le
   * da el rol, qué excepción tiene encima y con qué se queda.
   */
  async getUserPermissionDetail(userId) {
    const user = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.id', userId)
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role')
      .first();
    if (!user) return null;

    const todos = await db('permissions').select('id', 'key', 'label').orderBy('id');
    const delRol = new Set(await db('permissions')
      .join('role_permissions', 'role_permissions.permission_id', 'permissions.id')
      .where('role_permissions.role_id', user.role_id)
      .pluck('permissions.key'));

    const excepciones = new Map((await db('user_permissions')
      .join('permissions', 'permissions.id', 'user_permissions.permission_id')
      .where('user_permissions.user_id', user.id)
      .select('permissions.key', 'user_permissions.granted'))
      .map((row) => [row.key, Boolean(row.granted)]));

    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role, role_id: user.role_id },
      permissions: todos.map((permiso) => {
        const fromRole = delRol.has(permiso.key);
        const override = excepciones.has(permiso.key) ? excepciones.get(permiso.key) : null;
        return {
          ...permiso,
          from_role: fromRole,
          override,
          effective: override === null ? fromRole : override
        };
      })
    };
  }

  /**
   * Reemplaza las excepciones de una persona. `overrides` es `{ clave: true |
   * false | null }`: `true` se lo da, `false` se lo quita y `null` lo devuelve
   * a lo que diga su rol.
   *
   * Se guarda solo lo que se APARTA del rol: una excepción que repite lo que el
   * rol ya dice se borra en vez de guardarse. Si no, cambiar el rol de alguien
   * no cambiaría nada —sus permisos viejos quedarían congelados como
   * excepciones— que es la trampa clásica de este tipo de tabla.
   */
  async setUserPermissionOverrides(userId, overrides = {}) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) return null;

    const permisos = await db('permissions').select('id', 'key');
    const porClave = new Map(permisos.map((permiso) => [permiso.key, permiso]));
    const delRol = new Set(await db('permissions')
      .join('role_permissions', 'role_permissions.permission_id', 'permissions.id')
      .where('role_permissions.role_id', user.role_id)
      .pluck('permissions.key'));

    for (const [key, valor] of Object.entries(overrides)) {
      const permiso = porClave.get(key);
      if (!permiso) continue;

      const redundante = valor === null || valor === undefined || valor === delRol.has(key);
      if (redundante) {
        await db('user_permissions').where({ user_id: userId, permission_id: permiso.id }).del();
        continue;
      }

      const existente = await db('user_permissions')
        .where({ user_id: userId, permission_id: permiso.id })
        .first();
      if (existente) {
        await db('user_permissions').where({ id: existente.id }).update({ granted: Boolean(valor) });
      } else {
        await db('user_permissions').insert({
          user_id: userId,
          permission_id: permiso.id,
          granted: Boolean(valor)
        });
      }
    }

    return this.getUserPermissionDetail(userId);
  }

  /**
   * Las cuentas internas con su rol y cuántas herramientas tienen de verdad
   * (`permission_count`).
   *
   * El conteo es el **efectivo**, no el del rol: desde que hay excepciones por
   * persona, mostrar el número del rol haría que la tabla de Perfiles dijera
   * "5/19" de alguien que tiene 7. Se calcula en memoria con dos consultas de
   * apoyo en vez de una por fila.
   */
  async listUsers() {
    const usuarios = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role_name', 'users.created_at')
      .orderBy('users.created_at', 'desc');

    const porRol = await db('role_permissions').select('role_id', 'permission_id');
    const excepciones = await db('user_permissions').select('user_id', 'permission_id', 'granted');

    const delRol = new Map();
    for (const fila of porRol) {
      if (!delRol.has(fila.role_id)) delRol.set(fila.role_id, new Set());
      delRol.get(fila.role_id).add(fila.permission_id);
    }
    const delUsuario = new Map();
    for (const fila of excepciones) {
      if (!delUsuario.has(fila.user_id)) delUsuario.set(fila.user_id, []);
      delUsuario.get(fila.user_id).push(fila);
    }

    return usuarios.map((usuario) => {
      const ids = new Set(delRol.get(usuario.role_id) || []);
      for (const fila of delUsuario.get(usuario.id) || []) {
        if (fila.granted) ids.add(fila.permission_id);
        else ids.delete(fila.permission_id);
      }
      return { ...usuario, permission_count: ids.size, has_overrides: (delUsuario.get(usuario.id) || []).length > 0 };
    });
  }

  /**
   * Listado ligero de usuarios internos para asignar líder/colaboradores a un
   * proyecto (no requiere permiso de gestión de roles, a diferencia de listUsers).
   */
  async listDirectory() {
    return db('users').select('id', 'name', 'email').orderBy('name', 'asc');
  }

  /**
   * Los usuarios del **área comercial**: a quiénes se les puede asignar un lead.
   *
   * "Área comercial" no es una columna ni una lista de nombres: son los
   * usuarios cuyo rol tiene el permiso `leads.view`, o sea los que pueden
   * entrar al funnel y trabajar un lead. Definirlo por el permiso y no por el
   * nombre del rol es lo que hace que siga funcionando cuando el equipo crea
   * "Closer", "Setter" o "Comercial Junior" desde Roles y Permisos — con una
   * lista de roles cableada, cada rol nuevo quedaría fuera y habría que tocar
   * el código para poder asignarle un lead. El Administrador aparece porque
   * también tiene el permiso, y en la práctica también reparte y cierra.
   *
   * Es el mismo criterio que protege la pantalla (`requirePermission('leads.view')`):
   * asignarle un lead a alguien que no puede abrir el tablero sería mandar el
   * trabajo a un buzón que nadie lee.
   */
  async listCommercialTeam() {
    const usuarios = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role_name')
      .orderBy('users.name', 'asc');

    const porRol = await db('role_permissions')
      .join('permissions', 'permissions.id', 'role_permissions.permission_id')
      .whereIn('permissions.key', COMMERCIAL_PERMISSIONS)
      .select('role_permissions.role_id', 'permissions.key');

    const excepciones = await db('user_permissions')
      .join('permissions', 'permissions.id', 'user_permissions.permission_id')
      .whereIn('permissions.key', COMMERCIAL_PERMISSIONS)
      .select('user_permissions.user_id', 'permissions.key', 'user_permissions.granted');

    /*
     * Se mira el permiso EFECTIVO, no el del rol: a alguien se le puede haber
     * dado (o quitado) el acceso al funnel a título personal
     * (`user_permissions`), y el desplegable de asignación tiene que decir lo
     * mismo que la puerta de la pantalla. Son tres consultas y el filtro se
     * hace acá: el equipo son decenas de personas, no millones de filas.
     */
    const claveDeRol = new Map();
    for (const fila of porRol) {
      if (!claveDeRol.has(fila.role_id)) claveDeRol.set(fila.role_id, new Set());
      claveDeRol.get(fila.role_id).add(fila.key);
    }

    const claveDeUsuario = new Map();
    for (const fila of excepciones) {
      if (!claveDeUsuario.has(fila.user_id)) claveDeUsuario.set(fila.user_id, new Map());
      claveDeUsuario.get(fila.user_id).set(fila.key, Boolean(fila.granted));
    }

    return usuarios
      .filter((usuario) => {
        const claves = new Set(claveDeRol.get(usuario.role_id) || []);
        for (const [key, granted] of claveDeUsuario.get(usuario.id) || []) {
          if (granted) claves.add(key);
          else claves.delete(key);
        }
        return claves.size > 0;
      })
      .map(({ role_id, ...usuario }) => usuario);
  }

  /**
   * El usuario del área comercial con ese id, o nada si no existe o no es del
   * área. Lo usa `leadService.assignLead()` para no confiar en que el
   * desplegable del tablero sea la única puerta de entrada.
   */
  async findCommercialMember(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const team = await this.listCommercialTeam();
    return team.find((user) => user.id === id) || null;
  }

  /**
   * El usuario del área comercial que se llama así, o nada.
   *
   * Lo usa `leadService.updateLead()` cuando la asignación llega como texto
   * (la ficha de la Base de Datos): si el nombre es el de alguien del panel,
   * el lead queda enlazado a esa cuenta en vez de guardar solo la cadena. Sin
   * esto, la misma asignación hecha desde dos pantallas dejaría la ficha en
   * dos estados distintos.
   */
  async findCommercialByName(name) {
    const buscado = String(name || '').trim().toLowerCase();
    if (!buscado) return null;
    const team = await this.listCommercialTeam();
    return team.find((user) => String(user.name || '').trim().toLowerCase() === buscado) || null;
  }

  async createUser({ name, email, password, roleId }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const [id] = await db('users').insert({ name, email, password_hash: passwordHash, role_id: roleId });
    return this.getUserWithPermissions(id);
  }

  async updateUserRole(userId, roleId) {
    await db('users').where({ id: userId }).update({ role_id: roleId });
    return this.getUserWithPermissions(userId);
  }

  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.password_hash);
  }
}
