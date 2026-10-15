/**
 * Reparto automático de leads: quiénes reciben los leads que entran solos (bot,
 * formularios de Meta, evaluador público) y en qué proporción.
 *
 * - `lead_routing_pools`: un grupo de reparto. Hoy hay uno solo ("General"),
 *   pero la tabla existe desde ahora para que el día que haga falta repartir
 *   distinto por origen (una campaña, una universidad) sea agregar reglas y no
 *   migrar los miembros a otra estructura. `enabled` nace en falso: la
 *   configuración se arma antes de que reparta nada.
 * - `lead_routing_members`: cada persona del grupo con su **peso** (de cada
 *   "suma de pesos" leads, cuántos le tocan) y si está activa. `current_weight`
 *   es el estado del reparto ponderado suave (ver `backend/services/leadRouting.js`)
 *   y se guarda acá para que el reparto siga donde quedó entre reinicios.
 *
 * Además crea el permiso `leads.routing` (un botón del menú, como el resto) y
 * se lo da a quien hoy reparte a mano (`leads.manage_all`).
 */
const PERMISO = { key: 'leads.routing', label: 'Reparto automático de leads' };
const LO_TIENE_QUIEN_REPARTE = 'leads.manage_all';

export async function up(knex) {
  await knex.schema.createTable('lead_routing_pools', (table) => {
    table.increments('id').primary();
    table.string('name', 120).notNullable();
    table.boolean('enabled').notNullable().defaultTo(false);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('lead_routing_members', (table) => {
    table.increments('id').primary();
    table.integer('pool_id').unsigned().notNullable()
      .references('id').inTable('lead_routing_pools').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('weight').unsigned().notNullable().defaultTo(1);
    table.boolean('active').notNullable().defaultTo(true);
    table.integer('position').notNullable().defaultTo(0);
    table.integer('current_weight').notNullable().defaultTo(0);
    table.timestamps(true, true);
    table.unique(['pool_id', 'user_id']);
  });

  await knex('lead_routing_pools').insert({ name: 'General', enabled: false });

  const existe = await knex('permissions').where({ key: PERMISO.key }).first();
  if (existe) return;
  const [permissionId] = await knex('permissions').insert(PERMISO);

  const previo = await knex('permissions').where({ key: LO_TIENE_QUIEN_REPARTE }).first();
  if (!previo) return;
  const roles = await knex('role_permissions').where({ permission_id: previo.id }).distinct('role_id');
  for (const { role_id: roleId } of roles) {
    await knex('role_permissions').insert({ role_id: roleId, permission_id: permissionId });
  }
}

export async function down(knex) {
  const ids = await knex('permissions').where({ key: PERMISO.key }).pluck('id');
  if (ids.length > 0) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    if (await knex.schema.hasTable('user_permissions')) {
      await knex('user_permissions').whereIn('permission_id', ids).del();
    }
    await knex('permissions').whereIn('id', ids).del();
  }
  await knex.schema.dropTableIfExists('lead_routing_members');
  await knex.schema.dropTableIfExists('lead_routing_pools');
}
