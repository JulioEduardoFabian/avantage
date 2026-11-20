/**
 * El pago de una comisión se registra como cualquier otro egreso de Finanzas:
 * con la **cuenta** de la que sale y su **comprobante**.
 *
 * Hasta acá `sales_commissions` guardaba el devengo y, del pago, solo la fecha
 * (`paid_at`). Eso dejaba dos agujeros que se ven apenas se mira el Resumen:
 *
 *  - **Sin banco**, el egreso de la comisión caía en el cajón "Sin cuenta" de
 *    `getOverview()`: restaba del total pero no de la tarjeta de la cuenta de
 *    la que de verdad salió, así que el saldo de BCP decía más de lo que hay.
 *    Es la misma razón por la que `finance_salaries` tiene su columna `banco`.
 *  - **Sin comprobante**, el único pago de Finanzas que no se puede respaldar
 *    era justo el que se le hace a una persona del equipo.
 *
 * `metodo_pago` va con el banco (transferencia, Yape, efectivo...) por lo mismo
 * que en la planilla: la cuenta dice de dónde salió y el método cómo, y las dos
 * se preguntan juntas al registrar el pago.
 *
 * Los comprobantes son 1:N y su tabla está calcada de `finance_salary_receipts`
 * —misma forma, misma carpeta `uploads/finance-receipts/`—: un pago al equipo se
 * respalda igual se anote en la planilla o acá. Se borran en cascada con la
 * comisión; el archivo en disco lo elimina `commissionService`.
 *
 * Lo que NO se agrega es un `estado` nuevo ni un segundo monto: la comisión
 * sigue siendo una fila con su devengo y su pago, y `estado` + `paid_at` ya
 * dicen si salió y cuándo.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('sales_commissions', 'banco'))) {
    await knex.schema.alterTable('sales_commissions', (table) => {
      table.string('banco', 50).nullable();
      table.string('metodo_pago', 100).nullable();
    });
  }

  if (!(await knex.schema.hasTable('sales_commission_receipts'))) {
    await knex.schema.createTable('sales_commission_receipts', (table) => {
      table.increments('id').primary();
      table.integer('commission_id').unsigned().notNullable()
        .references('id').inTable('sales_commissions').onDelete('CASCADE');
      table.string('filename', 255).notNullable();
      table.string('original_name', 255).nullable();
      table.string('mime_type', 150).nullable();
      table.integer('size').unsigned().nullable();
      table.timestamp('uploaded_at').defaultTo(knex.fn.now());

      table.index('commission_id');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sales_commission_receipts');
  if (await knex.schema.hasColumn('sales_commissions', 'banco')) {
    await knex.schema.alterTable('sales_commissions', (table) => {
      table.dropColumn('banco');
      table.dropColumn('metodo_pago');
    });
  }
}
