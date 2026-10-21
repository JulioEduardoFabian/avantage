/**
 * `leads.report` — el Reporte de Leads.
 *
 * Es la bitácora de etapas (`lead_stage_changes`) leída de corrido: todos los
 * leads con su trazabilidad, quién movió a cada uno, hacia qué etapa y en qué
 * fecha y hora. Hasta ahora eso solo se podía ver de a un lead, entrando a su
 * ficha en el Funnel de Ventas.
 *
 * Tiene permiso propio y no entra con `leads.view` por la misma razón que el
 * resto del panel: cada permiso es un botón del menú, no un paquete de
 * pantallas. El reporte es una herramienta de supervisión —se abre para revisar
 * el trabajo del equipo, no para trabajar un lead—, así que se reparte aparte.
 *
 * El permiso NO amplía la visibilidad: el reporte reusa la regla del funnel
 * (`applyLeadVisibility()`), así que quien ve solo sus leads ve solo la
 * trazabilidad de sus leads. Para arrancar se copia a todo rol y a toda
 * excepción personal que ya administre el área comercial (`leads.manage_all`),
 * que es quien ve el tablero completo y, por lo tanto, para quien el reporte
 * dice algo el primer día.
 */
const PERMISO = {
  key: 'leads.report',
  label: 'Reporte de Leads (trazabilidad de etapas)'
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
