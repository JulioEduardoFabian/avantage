/**
 * Módulo de **Cobranzas**: la lista de cuotas que todavía no entraron (o que
 * entraron y Finanzas aún no verificó), con quién cobró cada una.
 *
 * El dato no existía en ningún lado. `finance_income` sabe si una cuota está
 * `pendiente`, `pagado` o `verificado`, y quién la creó (`created_by`) y quién
 * la verificó (`verified_by`), pero no quién la **cobró**: el que persigue el
 * pago y el que lo verifica casi nunca son la misma persona, y de eso cuelga
 * ahora una comisión.
 *
 * Cobranzas no es otra tabla de pagos: es la misma `finance_income` vista desde
 * el trabajo de cobrar. Marcar "cobrado" deja la cuota en `pagado`, el estado
 * que ya significa "el cliente pagó y Finanzas todavía no dio el visto bueno",
 * así que los dos pasos que ya existían se conservan: cobrar no es verificar, y
 * verificar sigue pidiendo `finance.verify` desde la pantalla de Finanzas.
 *
 * Lo que sí se agrega a `sales_commissions` es `income_id`: la comisión de
 * cobranza es **por cuota**, no por lead. Sin esa columna, el índice único
 * (lead_id, user_id, role) dejaría comisionar la primera cuota de un lead y
 * rechazaría la segunda, que es lo contrario de lo que se quiere. `lead_id`
 * pasa a admitir nulos por la misma razón: hay ingresos de Finanzas que no
 * cuelgan de ningún lead y también se cobran.
 *
 * El orden de las operaciones sobre `sales_commissions` no es negociable y por
 * eso va paso a paso: MySQL se niega a soltar el índice único mientras la llave
 * foránea de `lead_id` se apoye en él. Y cada paso se pregunta si hace falta
 * —columnas, índice, llave— para que una migración cortada a la mitad se pueda
 * reintentar en vez de quedar trabada.
 */
async function tieneIndice(knex, tabla, nombre) {
  const [filas] = await knex.raw(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tabla, nombre]
  );
  return filas.length > 0;
}

async function nombreDeLlaveForanea(knex, tabla, columna) {
  const [filas] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1`,
    [tabla, columna]
  );
  return filas[0]?.CONSTRAINT_NAME || null;
}

const UNICO_VIEJO = 'sales_commissions_lead_id_user_id_role_unique';
const UNICO_NUEVO = 'sales_commissions_lead_id_user_id_role_income_id_unique';

export async function up(knex) {
  if (!(await knex.schema.hasColumn('finance_income', 'collected_at'))) {
    await knex.schema.alterTable('finance_income', (table) => {
      table.timestamp('collected_at').nullable();
      table.integer('collected_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasColumn('sales_commissions', 'income_id'))) {
    await knex.schema.alterTable('sales_commissions', (table) => {
      table.integer('income_id').unsigned().nullable()
        .references('id').inTable('finance_income').onDelete('CASCADE');
    });
  }

  // 1. La llave foránea de lead_id se apoya en el índice único viejo: primero
  //    se suelta la llave, si no MySQL no deja tocar el índice.
  const llaveLead = await nombreDeLlaveForanea(knex, 'sales_commissions', 'lead_id');
  if (llaveLead) {
    await knex.raw(`ALTER TABLE sales_commissions DROP FOREIGN KEY \`${llaveLead}\``);
  }

  // 2. Fuera el único viejo (lead_id, user_id, role).
  if (await tieneIndice(knex, 'sales_commissions', UNICO_VIEJO)) {
    await knex.raw(`ALTER TABLE sales_commissions DROP INDEX \`${UNICO_VIEJO}\``);
  }

  // 3. lead_id admite nulos (ingresos sin lead) y recupera su llave.
  await knex.schema.alterTable('sales_commissions', (table) => {
    table.integer('lead_id').unsigned().nullable().alter();
  });

  if (!(await tieneIndice(knex, 'sales_commissions', UNICO_NUEVO))) {
    await knex.raw(
      `ALTER TABLE sales_commissions ADD UNIQUE \`${UNICO_NUEVO}\` (lead_id, user_id, role, income_id)`
    );
  }

  if (!(await nombreDeLlaveForanea(knex, 'sales_commissions', 'lead_id'))) {
    await knex.schema.alterTable('sales_commissions', (table) => {
      table.foreign('lead_id').references('id').inTable('leads').onDelete('CASCADE');
    });
  }

  const existe = await knex('permissions').where({ key: 'collections.view' }).first();
  if (!existe) {
    const [permissionId] = await knex('permissions').insert({
      key: 'collections.view',
      label: 'Cobranzas'
    });
    // Cobrar es trabajo del área comercial: arranca habilitado para los puestos
    // que ya trabajan leads y para el administrador; de ahí en más se reparte
    // a mano (por rol o por persona).
    const roles = await knex('roles')
      .whereIn('name', ['Administrador', 'Comercial', 'Closer', 'Setter'])
      .select('id');
    for (const rol of roles) {
      await knex('role_permissions').insert({ role_id: rol.id, permission_id: permissionId });
    }
  }
}

export async function down(knex) {
  const permiso = await knex('permissions').where({ key: 'collections.view' }).first();
  if (permiso) {
    await knex('role_permissions').where({ permission_id: permiso.id }).del();
    await knex('permissions').where({ id: permiso.id }).del();
  }

  await knex('sales_commissions').where({ role: 'cobranza' }).del();

  const llaveLead = await nombreDeLlaveForanea(knex, 'sales_commissions', 'lead_id');
  if (llaveLead) await knex.raw(`ALTER TABLE sales_commissions DROP FOREIGN KEY \`${llaveLead}\``);
  if (await tieneIndice(knex, 'sales_commissions', UNICO_NUEVO)) {
    await knex.raw(`ALTER TABLE sales_commissions DROP INDEX \`${UNICO_NUEVO}\``);
  }

  if (await knex.schema.hasColumn('sales_commissions', 'income_id')) {
    await knex.schema.alterTable('sales_commissions', (table) => {
      table.dropForeign('income_id');
      table.dropColumn('income_id');
    });
  }

  await knex('sales_commissions').whereNull('lead_id').del();
  await knex.schema.alterTable('sales_commissions', (table) => {
    table.integer('lead_id').unsigned().notNullable().alter();
  });
  await knex.raw(
    `ALTER TABLE sales_commissions ADD UNIQUE \`${UNICO_VIEJO}\` (lead_id, user_id, role)`
  );
  await knex.schema.alterTable('sales_commissions', (table) => {
    table.foreign('lead_id').references('id').inTable('leads').onDelete('CASCADE');
  });

  if (await knex.schema.hasColumn('finance_income', 'collected_at')) {
    await knex.schema.alterTable('finance_income', (table) => {
      table.dropForeign('collected_by');
      table.dropColumn('collected_by');
      table.dropColumn('collected_at');
    });
  }
}
