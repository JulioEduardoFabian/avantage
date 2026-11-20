/**
 * `reports.setters` — el Reporte de Setters.
 *
 * Es una herramienta de **supervisión** y no de trabajar leads, así que tiene
 * permiso propio —cada permiso es un botón del menú— y se copia de entrada solo
 * a quien ya administra el área comercial (`leads.manage_all`), que es el mismo
 * criterio del Reporte de Leads: el que reparte los leads es el que necesita
 * saber cómo le fue a cada uno.
 *
 * No se reparte a los setters aunque la pantalla les serviría para ver su propio
 * desempeño: el reporte reusa la visibilidad del funnel, así que dárselo no
 * expondría leads ajenos, pero repartir un permiso es una decisión del equipo y
 * no de una migración. Dado a mano, el setter ve una sola fila: la suya.
 */
const PERMISO = {
  key: 'reports.setters',
  label: 'Reporte de Setters (desempeño del equipo)'
};
const YA_SUPERVISA = 'leads.manage_all';

export async function up(knex) {
  const existe = await knex('permissions').where({ key: PERMISO.key }).first();
  if (existe) return;
  const [permissionId] = await knex('permissions').insert(PERMISO);

  const previos = await knex('permissions').where({ key: YA_SUPERVISA }).pluck('id');
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
