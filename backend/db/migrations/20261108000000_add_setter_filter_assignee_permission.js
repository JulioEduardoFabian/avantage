/**
 * `setter.filter_assignee` — el filtro "Responsable" del Setter Funnel.
 *
 * El desplegable que deja mirar el tablero de otra persona aparecía solo con
 * tener `setter.view_all` o `leads.manage_all`. Son dos cosas distintas: una es
 * qué leads puede ver alguien (eso lo decide el servidor) y otra es darle la
 * herramienta para recorrer el tablero de cada compañero. Ahora la segunda se
 * reparte por separado.
 *
 * El permiso NO abre leads: el filtro trabaja sobre lo que `GET /api/leads` ya
 * le manda a esa persona. Sin `setter.view_all` ni `leads.manage_all` solo
 * tendrá lo propio entre qué elegir.
 *
 * Para que nadie pierda el filtro al desplegar, se copia a todo rol y a toda
 * excepción personal que hoy tenga alguno de los dos permisos que lo mostraban.
 */
const PERMISO = {
  key: 'setter.filter_assignee',
  label: 'Filtrar el Setter Funnel por responsable (ver el tablero de cada persona)'
};
const LO_MOSTRABAN = ['setter.view_all', 'leads.manage_all'];

export async function up(knex) {
  const existe = await knex('permissions').where({ key: PERMISO.key }).first();
  if (existe) return;
  const [permissionId] = await knex('permissions').insert(PERMISO);

  const previos = await knex('permissions').whereIn('key', LO_MOSTRABAN).pluck('id');
  if (previos.length === 0) return;

  const roles = await knex('role_permissions').whereIn('permission_id', previos).distinct('role_id');
  for (const { role_id: roleId } of roles) {
    await knex('role_permissions').insert({ role_id: roleId, permission_id: permissionId });
  }

  if (await knex.schema.hasTable('user_permissions')) {
    const personas = await knex('user_permissions')
      .whereIn('permission_id', previos)
      .where({ granted: true })
      .distinct('user_id');
    for (const { user_id: userId } of personas) {
      await knex('user_permissions').insert({ user_id: userId, permission_id: permissionId, granted: true });
    }
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
