/**
 * Salarios: estado del pago y monto con signo.
 *
 * - `estado` ('pagado' | 'pendiente'): la planilla ahora también sirve para
 *   anotar un salario que todavía no se pagó. Las filas que ya existían se
 *   registraron como pagos hechos, así que quedan en 'pagado'.
 * - `monto` pasa a guardarse en **negativo**: un salario es dinero que sale.
 *   Se convierten las filas existentes (siempre positivas hasta ahora).
 *
 * La planilla sigue siendo independiente de la contabilidad: nada de esto la
 * conecta con `finance_journal`, `finance_income` ni `getOverview()`.
 */

export async function up(knex) {
  await knex.schema.alterTable('finance_salaries', (table) => {
    table.string('estado', 20).notNullable().defaultTo('pagado'); // 'pagado' | 'pendiente'
    table.index('estado');
  });
  await knex('finance_salaries').where('monto', '>', 0).update({ monto: knex.raw('-monto') });
}

export async function down(knex) {
  await knex('finance_salaries').where('monto', '<', 0).update({ monto: knex.raw('-monto') });
  await knex.schema.alterTable('finance_salaries', (table) => {
    table.dropIndex('estado');
    table.dropColumn('estado');
  });
}
