/**
 * Salarios por proyecto: el acuerdo y sus pagos.
 *
 * Hasta ahora la planilla era una lista plana de pagos, y el equipo la estaba
 * usando a mano para otra cosa: cuatro filas seguidas del mismo asesor con el
 * detalle "Usuario Elena Milagro", "Pago del 40% del usuario Juan Diego"…
 * Lo que falta es la estructura que ya estaban escribiendo en el campo de
 * texto: **cuánto se le paga a quien consiguió el lead por ESE proyecto**
 * (el acuerdo) y **los pagos parciales** con los que se va cubriendo.
 *
 * Se resuelve con la misma tabla y no con una nueva porque es la misma
 * planilla vista con un nivel más: el acuerdo y sus pagos comparten persona,
 * moneda, banco y comprobantes, y partirlos en dos tablas obligaría a
 * duplicar todo eso y a unirlas en cada lectura.
 *
 * - `kind`: `'pago'` (lo de siempre, y el valor por defecto para todo lo ya
 *   cargado) o `'acuerdo'`. La distinción es EXPLÍCITA y no deducida de que
 *   tenga proyecto o hijos: de ella depende qué plata se descuenta en el
 *   Resumen Financiero, y una regla implícita ahí se rompe sola. **Un acuerdo
 *   nunca es dinero que salió**: es el compromiso, como la comisión de la
 *   setter. Lo que resta son sus pagos.
 * - `parent_id`: el acuerdo del que cuelga un pago. CASCADE: borrar el acuerdo
 *   se lleva sus pagos, que no significan nada sueltos.
 * - `project_id`: el proyecto por el que se paga ese salario.
 * - `user_id`: el beneficiario con cuenta en el panel. `persona` (texto libre)
 *   se conserva y se sigue escribiendo SIEMPRE: a la planilla también entra
 *   gente sin cuenta, y renombrar o dar de baja a un usuario no puede
 *   reescribir la planilla de meses pasados.
 *
 * El porcentaje de cada pago NO se guarda: se deriva de su monto sobre el del
 * acuerdo en cada lectura, por lo mismo que `is_locked` de un hito — si el
 * acuerdo se corrige, un porcentaje guardado seguiría diciendo el viejo.
 */
export async function up(knex) {
  await knex.schema.alterTable('finance_salaries', (table) => {
    table.string('kind', 20).notNullable().defaultTo('pago');
    table.integer('parent_id').unsigned().nullable()
      .references('id').inTable('finance_salaries').onDelete('CASCADE');
    table.integer('project_id').unsigned().nullable()
      .references('id').inTable('projects').onDelete('SET NULL');
    table.integer('user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.index('parent_id');
    table.index('project_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('finance_salaries', (table) => {
    table.dropForeign('parent_id');
    table.dropForeign('project_id');
    table.dropForeign('user_id');
    table.dropIndex('parent_id');
    table.dropIndex('project_id');
    table.dropColumn('kind');
    table.dropColumn('parent_id');
    table.dropColumn('project_id');
    table.dropColumn('user_id');
  });
}
