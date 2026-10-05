/**
 * Crea `user_permissions`: permisos puestos o quitados a UNA persona, por
 * encima de lo que le da su rol.
 *
 * Los permisos se resolvían solo por rol, así que la única forma de darle una
 * herramienta a una persona era crear un rol nuevo para ella ("Comercial pero
 * con Finanzas") o aflojarle el permiso a todo su rol. Con el equipo partido en
 * setter y closer eso se vuelve diario: el closer que además lleva los
 * contratos, la setter que necesita ver Campañas.
 *
 * Son excepciones, no un segundo sistema de permisos: el rol sigue siendo el
 * que define el puesto y acá solo se anota la diferencia. Por eso hay
 * `granted`: una fila puede DAR (`true`) o QUITAR (`false`) el permiso, y el
 * permiso que no tiene fila se hereda del rol tal cual. Sin el quitar, sacarle
 * Finanzas a una persona de un rol que la tiene obligaría otra vez a inventarle
 * un rol propio.
 *
 * El cálculo vive en `userService.getUserWithPermissions()` —permisos del rol,
 * más los otorgados, menos los revocados— y se resuelve una sola vez en el
 * login, como hasta ahora: lo que viaja embebido en el JWT ya es el resultado.
 *
 * CASCADE en las dos llaves: borrar al usuario o el permiso se lleva su
 * excepción, que sin ellos no significa nada.
 */
export async function up(knex) {
  await knex.schema.createTable('user_permissions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.integer('permission_id').unsigned().notNullable()
      .references('id').inTable('permissions').onDelete('CASCADE');
    // true = se le da aunque su rol no lo tenga; false = se le quita aunque su
    // rol sí lo tenga.
    table.boolean('granted').notNullable().defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // Una sola excepción por persona y permiso: dos filas contradictorias
    // dejarían el resultado a merced del orden de lectura.
    table.unique(['user_id', 'permission_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_permissions');
}
