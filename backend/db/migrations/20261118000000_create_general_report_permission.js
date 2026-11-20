/**
 * `reports.general` — el Reporte General.
 *
 * La pantalla de gerencia: ventas cerradas, caja, cartera por antigüedad,
 * embudo por cohorte y canales, comparados contra el período anterior.
 *
 * Tiene permiso propio por la regla de siempre —cada permiso es un botón del
 * menú—, pero muestra importes: por eso se copia de entrada SOLO a los roles y
 * excepciones personales que ya ven Finanzas (`finance.view`). Dárselo a quien
 * no veía la plata sería abrir el dinero por la puerta de atrás.
 */
const PERMISO = {
  key: 'reports.general',
  label: 'Reporte General (gerencia)'
};
const YA_VE_FINANZAS = 'finance.view';

export async function up(knex) {
  const existe = await knex('permissions').where({ key: PERMISO.key }).first();
  if (existe) return;
  const [permissionId] = await knex('permissions').insert(PERMISO);

  const previos = await knex('permissions').where({ key: YA_VE_FINANZAS }).pluck('id');
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
