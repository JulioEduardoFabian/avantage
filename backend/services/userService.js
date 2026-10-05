import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';

/**
 * El permiso que define al área comercial (ver `listCommercialTeam()`).
 */
const COMMERCIAL_PERMISSION = 'leads.view';

/**
 * Servicio de acceso a datos para usuarios internos (login, gestión de cuentas).
 */
export class UserService {
  async getUserByEmail(email) {
    return db('users').where({ email }).first();
  }

  async getUserWithPermissions(userId) {
    const user = await db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .where('users.id', userId)
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role')
      .first();

    if (!user) return null;

    const permissions = await db('permissions')
      .join('role_permissions', 'role_permissions.permission_id', 'permissions.id')
      .where('role_permissions.role_id', user.role_id)
      .pluck('permissions.key');

    return { ...user, permissions };
  }

  async listUsers() {
    return db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .select('users.id', 'users.name', 'users.email', 'users.role_id', 'roles.name as role_name', 'users.created_at')
      .orderBy('users.created_at', 'desc');
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
    return db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .whereIn('users.role_id', db('role_permissions')
        .join('permissions', 'permissions.id', 'role_permissions.permission_id')
        .where('permissions.key', COMMERCIAL_PERMISSION)
        .select('role_permissions.role_id'))
      .select('users.id', 'users.name', 'users.email', 'roles.name as role_name')
      .orderBy('users.name', 'asc');
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
