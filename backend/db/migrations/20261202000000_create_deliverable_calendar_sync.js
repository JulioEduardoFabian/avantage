/**
 * La sincronización del calendario de Entregables con una cuenta de Google.
 *
 * Dos cosas: la **conexión** (una sola, de toda la empresa) y, en cada
 * entregable, el **rastro de su evento** en ese calendario.
 *
 * La conexión va en tabla propia y no en `google_calendar_connections` porque
 * aquella es de cada asesor —`user_id` único, con su Meet y su disponibilidad
 * colgando— y esta es del MÓDULO: la aprieta quien maneja las entregas y el
 * calendario es el mismo apriete quien apriete, igual que
 * `deliverable_settings.notice_email` es un solo correo y no el de cada uno.
 * Si colgara del usuario, el calendario de las entregas cambiaría según quién
 * sincronizó último y nadie sabría en cuál mirar.
 *
 * Es **una fila** (como `deliverable_settings`): se lee siempre la primera por
 * id. `connected_by` queda para poder preguntarle a alguien, no para decidir
 * nada — el que conectó la cuenta puede no estar más y la conexión sigue
 * valiendo.
 *
 * En `deliverables`, tres columnas:
 *
 *  - `google_event_id`: el evento que le corresponde en Google. Es lo que hace
 *    que sincronizar dos veces **actualice** en vez de duplicar. Sin esto, cada
 *    clic del botón dejaría el calendario con una copia más de cada entrega.
 *  - `google_signature`: una foto de lo que se mandó (título, cliente, fecha,
 *    estado). Si no cambió, esa entrega no se vuelve a escribir: 44 entregas
 *    son 44 llamadas a Google, y las que no cambiaron no tienen por qué gastar
 *    una.
 *  - `google_synced_at`: cuándo se mandó por última vez, que es lo que la
 *    pantalla puede mostrar al lado del botón.
 *
 * Nacen en null y eso significa "nunca se sincronizó", que es distinto de "se
 * sincronizó y no tiene evento" (eso es `google_event_id` en null con
 * `google_synced_at` escrito: la entrega se quedó sin fecha y su evento se
 * quitó del calendario).
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('deliverable_calendar_connection'))) {
    await knex.schema.createTable('deliverable_calendar_connection', (table) => {
      table.increments('id').primary();
      table.string('google_email', 255).nullable();
      table.text('access_token').notNullable();
      table.text('refresh_token').nullable();
      table.timestamp('access_token_expires_at').nullable();
      table.string('scope', 255).nullable();
      // En qué calendario de esa cuenta se escribe. 'primary' es el de la
      // propia cuenta: como la cuenta es de la empresa y se conecta para esto,
      // no hace falta crear uno aparte — y queda la columna para el día que sí.
      table.string('calendar_id', 255).notNullable().defaultTo('primary');
      table.integer('connected_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasColumn('deliverables', 'google_event_id'))) {
    await knex.schema.alterTable('deliverables', (table) => {
      table.string('google_event_id', 255).nullable();
    });
  }

  if (!(await knex.schema.hasColumn('deliverables', 'google_signature'))) {
    await knex.schema.alterTable('deliverables', (table) => {
      table.string('google_signature', 64).nullable();
    });
  }

  if (!(await knex.schema.hasColumn('deliverables', 'google_synced_at'))) {
    await knex.schema.alterTable('deliverables', (table) => {
      table.timestamp('google_synced_at').nullable();
    });
  }
}

export async function down(knex) {
  // Simétrico con el `up()`: en MySQL el DDL no es transaccional, así que esto
  // tiene que poder correr después de un `up()` que murió a la mitad.
  for (const column of ['google_synced_at', 'google_signature', 'google_event_id']) {
    if (await knex.schema.hasColumn('deliverables', column)) {
      await knex.schema.alterTable('deliverables', (table) => {
        table.dropColumn(column);
      });
    }
  }

  await knex.schema.dropTableIfExists('deliverable_calendar_connection');
}
