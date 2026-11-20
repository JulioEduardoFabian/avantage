/**
 * `notification_routing`: a qué perfiles le toca cada aviso automático.
 *
 * Todas las notificaciones automáticas nacen con `user_id` en NULL —"para
 * todos"—, que era lo correcto cuando eran ocho avisos del negocio. Hoy son
 * quince tipos muy distintos y le suenan en el teléfono a todo el mundo: el
 * "Recordatorio de reunión sin entregar" le interesa a quien lleva la agenda,
 * "pago verificado" a Finanzas y "escribió y nadie le respondió" a quien
 * trabaja leads. Con los tres mezclados, la campana deja de mirarse — 645 sin
 * leer (19/11/2026) es exactamente eso, y a partir de ahí el aviso que sí
 * importaba tampoco se ve.
 *
 * **Una fila por (tipo, perfil), y un tipo SIN filas va a todos.** El valor por
 * defecto es el comportamiento de hoy, así que la función se enciende cuando
 * alguien la configura y un entorno donde esta migración no corrió se comporta
 * igual que antes — en vez de dejar a medio equipo sin avisos, que es como se
 * rompe una base a la que le falta una tabla de configuración.
 *
 * Se guarda el **perfil y no la persona** a propósito: lo que se reparte es un
 * trabajo ("de las entregas se encarga quien tenga ese rol"), no una lista de
 * nombres que hay que corregir cada vez que alguien entra o sale. Es la misma
 * razón por la que el área comercial se define por permiso y no por una
 * columna con nombres.
 *
 * El `role_id` va en CASCADE: si se borra un perfil, sus reglas no significan
 * nada. Y borrarlas devuelve ese tipo a "para todos", que es el valor por
 * defecto seguro — lo contrario (que el tipo quedara sin público y no lo viera
 * nadie) sería un aviso que desaparece sin que nadie lo haya pedido.
 *
 * El índice único impide la fila repetida, que no significaría nada distinto y
 * haría que el mismo perfil contara dos veces al pintar el cuadro.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('notification_routing'))) {
    await knex.schema.createTable('notification_routing', (table) => {
      table.increments('id').primary();
      table.string('type', 60).notNullable();
      table.integer('role_id').unsigned().notNullable()
        .references('id').inTable('roles').onDelete('CASCADE');
      table.timestamp('created_at').defaultTo(knex.fn.now());

      table.unique(['type', 'role_id']);
      // La lectura de la campana pregunta siempre por el tipo.
      table.index('type');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('notification_routing');
}
