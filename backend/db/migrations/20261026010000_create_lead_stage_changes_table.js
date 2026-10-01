/**
 * Bitácora de cambios de etapa de un lead (`lead_stage_changes`).
 *
 * Cada vez que el equipo reportó "este lead se regresó solo al Funnel de
 * Setter" hubo que reconstruir a mano qué pudo haberlo movido, porque
 * `leads.status` solo guarda el valor actual: quién lo cambió, desde qué etapa
 * y por qué no quedaba registrado en ninguna parte. Esta tabla responde esa
 * pregunta en una consulta.
 *
 * `actor_type` distingue lo que importa: `user` (una persona desde el panel),
 * `bot` (el bot de WhatsApp) y `system` (cierres y automatismos del backend,
 * como mover el lead al cotizar). `actor_name` guarda una copia del nombre por
 * la misma razón que en `lead_notes`: si al usuario lo dan de baja, el registro
 * tiene que seguir diciendo quién fue.
 *
 * `blocked` marca los intentos **rechazados**: cuando el bot quiso mover a un
 * lead que ya es del closer, la fila queda igual con el motivo. Sin eso, un
 * tope que funciona y un tope que nunca se activó se ven idénticos.
 */
export async function up(knex) {
  await knex.schema.createTable('lead_stage_changes', (table) => {
    table.increments('id').primary();
    table.integer('lead_id').unsigned().notNullable()
      .references('id').inTable('leads').onDelete('CASCADE');
    table.string('from_status', 60).nullable();
    table.string('to_status', 60).notNullable();
    table.string('actor_type', 20).notNullable().defaultTo('system');
    table.integer('actor_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('actor_name', 150).nullable();
    table.string('reason', 255).nullable();
    table.boolean('blocked').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // El único acceso es "el historial de este lead, del más nuevo al más
    // viejo": el índice compuesto cubre el filtro y el orden de una vez.
    table.index(['lead_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lead_stage_changes');
}
