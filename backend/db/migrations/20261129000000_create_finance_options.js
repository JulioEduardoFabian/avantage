/**
 * Opciones de Finanzas que agrega el equipo: las **áreas de la empresa** del
 * Libro Diario y las **cuentas** (bancos) donde entra o sale el dinero.
 *
 * Las de fábrica siguen en el código (`BANCOS` y `DEFAULT_AREAS`) y esta tabla
 * guarda solo las que se suman después. Así la lista de fábrica no se puede
 * borrar por error desde la pantalla —de "BCP" cuelgan años de asientos y las
 * tarjetas del Resumen— y una base recién creada funciona sin sembrar nada.
 *
 * `kind` es 'area' | 'banco'. El nombre del banco cabe en 20 caracteres porque
 * es lo que mide `banco` en `finance_income` y `finance_journal`.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('finance_options'))) {
    await knex.schema.createTable('finance_options', (table) => {
      table.increments('id').primary();
      table.string('kind', 10).notNullable();
      table.string('label', 120).notNullable();
      table.integer('created_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.unique(['kind', 'label']);
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('finance_options');
}
