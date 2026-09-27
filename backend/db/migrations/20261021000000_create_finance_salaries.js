/**
 * Planilla de salarios (`finance_salaries`).
 *
 * Es un registro **aparte** de la contabilidad de la empresa: lo que se anota
 * acá no es un ingreso ni un egreso. Por eso no se guarda en `finance_journal`
 * ni en `finance_fixed_expenses` (que sí alimentan los totales y el flujo de
 * caja de `getOverview()`), sino en su propia tabla, sin ninguna llave hacia
 * ellas. Es un historial de cuánto se le pagó a cada persona y cuándo, no un
 * movimiento de dinero de la empresa.
 *
 * `fecha` es el dato que da sentido a la fila — el día del pago — y por eso es
 * obligatoria e indexada: la planilla se lee siempre ordenada por fecha.
 *
 * `persona` se guarda como **texto libre** y no como `user_id`: se le paga a
 * gente que no necesariamente tiene cuenta en el panel (practicantes,
 * asesores externos), y renombrar o dar de baja a un usuario no debe
 * reescribir la planilla de meses pasados.
 */

export async function up(knex) {
  await knex.schema.createTable('finance_salaries', (table) => {
    table.increments('id').primary();
    table.string('persona', 150).notNullable();
    table.string('cargo', 120).nullable();
    table.date('fecha').notNullable();          // día en que se pagó el salario
    table.string('periodo', 40).nullable();     // mes/quincena que cubre el pago
    table.decimal('monto', 12, 2).notNullable();
    table.string('moneda', 10).notNullable().defaultTo('soles'); // 'soles' | 'dolares'
    table.string('metodo_pago', 40).nullable();
    table.string('banco', 20).nullable();
    table.text('detalle').nullable();
    table.integer('created_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('fecha');
    table.index('persona');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('finance_salaries');
}
