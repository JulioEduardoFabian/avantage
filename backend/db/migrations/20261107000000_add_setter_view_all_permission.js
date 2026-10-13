/**
 * `setter.view_all` — ver TODOS los leads del Setter Funnel, no solo los propios.
 *
 * Desde `leads.manage_all` cada persona ve únicamente los leads que tiene
 * asignados, y la única forma de ver el resto era ese permiso, que además deja
 * repartir y abre el Funnel de Ventas entero. Faltaba el punto medio: quien
 * hace el triaje necesita ver todo lo que entra al sistema —incluido lo que
 * todavía no tiene responsable— sin ser por eso el jefe comercial.
 *
 * Con este permiso se ve lo propio más cualquier lead que aún no graduó a
 * Ventas (`leadHasGraduated()`); sin él, solo lo asignado, como hasta ahora. No
 * deja asignar (eso sigue siendo de `leads.manage_all`) ni muestra los leads
 * que ya son del closer. El filtro vive en el servidor
 * (`leadService.visibilityFor()` / `canView()`), igual que el anterior.
 *
 * Arranca SOLO en Administrador: dárselo al rol Setter de entrada cambiaría lo
 * que ve cada setter el día del despliegue, y eso lo decide el equipo desde
 * Roles y Permisos (al rol, o a una persona como excepción).
 */
const PERMISO = {
  key: 'setter.view_all',
  label: 'Ver todos los leads del Setter Funnel (no solo los asignados)'
};

export async function up(knex) {
  const existe = await knex('permissions').where({ key: PERMISO.key }).first();
  if (existe) return;
  const [permissionId] = await knex('permissions').insert(PERMISO);

  const roles = await knex('roles').where({ name: 'Administrador' }).select('id');
  for (const rol of roles) {
    await knex('role_permissions').insert({ role_id: rol.id, permission_id: permissionId });
  }
}

export async function down(knex) {
  const ids = await knex('permissions').where({ key: PERMISO.key }).pluck('id');
  if (ids.length === 0) return;
  await knex('role_permissions').whereIn('permission_id', ids).del();
  if (await knex.schema.hasTable('user_permissions')) {
    await knex('user_permissions').whereIn('permission_id', ids).del();
  }
  await knex('permissions').whereIn('id', ids).del();
}
