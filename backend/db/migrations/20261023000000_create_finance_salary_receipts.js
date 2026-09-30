/**
 * Comprobantes de la planilla de salarios (1:N), calcados de
 * `finance_journal_receipts`: un pago al personal se respalda igual que un
 * asiento del libro diario (voucher de la transferencia, recibo firmado...),
 * y los archivos viven en la misma carpeta `uploads/finance-receipts/`.
 *
 * Se borran en cascada con el salario; el archivo en disco lo elimina
 * `financeSalaryService` al borrar la fila.
 */
export async function up(knex) {
  await knex.schema.createTable('finance_salary_receipts', (table) => {
    table.increments('id').primary();
    table.integer('salary_id').unsigned().notNullable()
      .references('id').inTable('finance_salaries').onDelete('CASCADE');
    table.string('filename', 255).notNullable();
    table.string('original_name', 255).nullable();
    table.string('mime_type', 150).nullable();
    table.integer('size').unsigned().nullable();
    table.timestamp('uploaded_at').defaultTo(knex.fn.now());

    table.index('salary_id');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('finance_salary_receipts');
}
