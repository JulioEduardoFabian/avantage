import bcrypt from 'bcryptjs';

/**
 * Siembra el esquema de roles y permisos inicial:
 * - Permisos base para las herramientas internas existentes.
 * - Rol "Administrador" (todos los permisos) y "Comercial" (solo Leads).
 * - Un usuario administrador por defecto para el primer acceso.
 *
 * Credenciales por defecto (CAMBIAR después del primer login):
 *   Email:    admin@tesisperu.local
 *   Password: admin123
 */
export async function seed(knex) {
  await knex('role_permissions').del();
  await knex('users').del();
  await knex('permissions').del();
  await knex('roles').del();

  const permissions = [
    { key: 'leads.view', label: 'Panel de Leads (Funnel de Ventas)' },
    { key: 'projects.view', label: 'Proyectos' },
    { key: 'deliverables.view', label: 'Entregables' },
    { key: 'roles.manage', label: 'Roles y Permisos' }
  ];
  await knex('permissions').insert(permissions);
  const insertedPermissions = await knex('permissions').select('id', 'key');

  const [adminRoleId] = await knex('roles').insert({
    name: 'Administrador',
    description: 'Acceso completo a todas las herramientas internas'
  });
  await knex('role_permissions').insert(
    insertedPermissions.map(p => ({ role_id: adminRoleId, permission_id: p.id }))
  );

  const [commercialRoleId] = await knex('roles').insert({
    name: 'Comercial',
    description: 'Acceso al funnel de ventas (leads)'
  });
  const leadsPermission = insertedPermissions.find(p => p.key === 'leads.view');
  await knex('role_permissions').insert({ role_id: commercialRoleId, permission_id: leadsPermission.id });

  const passwordHash = await bcrypt.hash('admin123', 10);
  await knex('users').insert({
    name: 'Administrador',
    email: 'admin@tesisperu.local',
    password_hash: passwordHash,
    role_id: adminRoleId
  });
}
