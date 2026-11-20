/**
 * Rastro de las fichas de lead borradas a mano.
 *
 * Hasta ahora borrar un lead no dejaba **nada**: de él cuelgan en CASCADE sus
 * notas, su historial de etapas y sus comisiones, así que después del borrado
 * no hay forma de saber que esa persona estuvo en el funnel ni quién la sacó.
 * Es la misma tabla y las mismas razones que `whatsapp_conversation_deletions`,
 * que es lo único que queda cuando se borra una conversación.
 *
 * Y hay una segunda razón, que es la que la hizo necesaria ahora: desde que el
 * barrido abre solo la ficha de las conversaciones de WhatsApp que quedaron sin
 * ella (`orphanConversationService` + `leadReconciliationSweep`), borrar una
 * ficha cuya conversación sigue en la bandeja la haría volver a los diez
 * minutos — "la borré y reapareció", que es peor que no tener el barrido. Con
 * este rastro el barrido sabe distinguir las dos cosas que se ven igual: una
 * ficha que **nunca se abrió** y una que alguien decidió sacar.
 *
 * El borrado no se deshace desde acá: esto no es una papelera, es una bitácora.
 * Por eso no guarda la ficha entera, solo con qué se la reconoce (el nombre y
 * el teléfono) y quién la borró.
 *
 * `phone_key` son los últimos 9 dígitos, el mismo criterio con el que se cruza
 * un teléfono en todo el sistema (`phoneMatchKey`), **congelado acá** como
 * columna: se calcula al borrar y se consulta por igualdad, que es lo que
 * permite indexarlo. `lead_id` no lleva llave foránea a propósito — la fila a
 * la que apuntaría ya no existe, que es justamente el motivo de esta tabla.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('lead_deletions'))) {
    await knex.schema.createTable('lead_deletions', (table) => {
      table.increments('id').primary();
      table.integer('lead_id').unsigned().notNullable();
      table.string('full_name', 150).nullable();
      table.string('phone', 30).nullable();
      table.string('phone_key', 9).nullable();
      table.string('status', 50).nullable();
      table.integer('deleted_by_user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.string('deleted_by_name', 150).nullable();
      table.timestamp('deleted_at').defaultTo(knex.fn.now());

      table.index('phone_key');
      table.index('deleted_at');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lead_deletions');
}
