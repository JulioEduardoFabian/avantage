/**
 * La comisión de la setter: el 2% de la venta que cerró el closer con el lead
 * que ella le pasó.
 *
 * Tabla propia y no una fila de `finance_salaries` (la planilla de pagos al
 * personal) ni de `finance_journal`: una comisión **nace de un lead concreto**
 * y hay que poder contestar "¿de qué venta salió?" y "¿ya se le pagó?". La
 * planilla no tiene de dónde colgarla —guarda a la persona como texto libre— y
 * el libro diario es contabilidad, que no es lo que se está registrando acá.
 * Cuando se le pague, ese pago se anota en la planilla como cualquier otro
 * egreso; esta tabla es el **devengo**, lo que se le debe.
 *
 * Dos columnas en `leads` sostienen el cálculo, y las dos son **sellos**:
 *
 *   - `setter_user_id` se escribe UNA vez, en el momento en que el lead
 *     gradúa al Funnel de Ventas (el mismo instante que `sales_funnel_at`), con
 *     quien lo tenía asignado entonces. Después el lead se reasigna al closer:
 *     si la comisión se calculara al cerrar mirando el responsable actual, se
 *     la llevaría siempre el closer.
 *   - `closer_user_id` se escribe al ganar, con quien registró el cierre. No
 *     comisiona hoy; queda para saber quién vendió sin tener que reconstruirlo
 *     desde el historial de etapas.
 *
 * El porcentaje y el monto base se guardan **en cada fila** y no se leen de una
 * constante al mostrar: cambiar el 2% el año que viene no puede reescribir lo
 * que ya se devengó.
 *
 * `beneficiary_name` es la copia del nombre, como `leads.assigned_to`: dar de
 * baja a una persona (ON DELETE SET NULL) no puede dejar una deuda sin dueño
 * en la pantalla.
 *
 * Un lead comisiona UNA vez por beneficiario (índice único): volver a arrastrar
 * el lead a "Ganado" —o reabrirlo y cerrarlo de nuevo— no genera una segunda
 * comisión.
 */
export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.integer('setter_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.integer('closer_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.index('setter_user_id');
  });

  await knex.schema.createTable('sales_commissions', (table) => {
    table.increments('id').primary();
    table.integer('lead_id').unsigned().notNullable()
      .references('id').inTable('leads').onDelete('CASCADE');
    table.integer('project_id').unsigned().nullable()
      .references('id').inTable('projects').onDelete('SET NULL');

    table.integer('user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('beneficiary_name', 150).notNullable();
    // Por qué le toca: hoy siempre 'setter'. La columna existe para que sumar
    // la comisión del closer sea una fila más y no otra tabla.
    table.string('role', 20).notNullable().defaultTo('setter');

    table.decimal('percent', 5, 2).notNullable();
    table.decimal('base_amount', 12, 2).notNullable();
    table.decimal('monto', 12, 2).notNullable();

    table.string('estado', 20).notNullable().defaultTo('pendiente');
    table.date('paid_at').nullable();
    table.string('detalle', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['lead_id', 'user_id', 'role']);
    table.index('estado');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sales_commissions');
  await knex.schema.alterTable('leads', (table) => {
    table.dropForeign('setter_user_id');
    table.dropForeign('closer_user_id');
    table.dropIndex('setter_user_id');
    table.dropColumn('setter_user_id');
    table.dropColumn('closer_user_id');
  });
}
