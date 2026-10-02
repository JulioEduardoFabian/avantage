/**
 * Tabla `project_settings` (fila única): la configuración del módulo de
 * Proyectos.
 *
 * Por ahora guarda `notice_email`: a qué correo llega el aviso de "se creó un
 * proyecto nuevo". Un proyecto nace casi siempre solo —cuando una venta se
 * cierra en el Funnel de Ventas—, así que nadie se entera hasta que entra a
 * mirar la pantalla; este aviso es el que lo cuenta.
 *
 * Mismo patrón y mismas razones que `deliverable_settings`: UN solo
 * destinatario (repartirlo entre todos los que pueden abrir el módulo lo
 * convierte en ruido que nadie mira) y en la base y no en el `.env`, porque
 * cambia cuando cambia quién ocupa el puesto y eso tiene que poder hacerse
 * desde el panel, sin reiniciar nada, por la misma gente que usa la pantalla.
 *
 * Cada módulo lleva su propia fila de ajustes (ver también
 * `whatsapp_bot_settings`): así cada pantalla configura lo suyo y la columna
 * dice a qué se refiere, que una tabla genérica de clave/valor no puede.
 */
export async function up(knex) {
  await knex.schema.createTable('project_settings', (table) => {
    table.increments('id').primary();
    // Nullable: mientras nadie lo configure, el aviso cae en
    // INTERNAL_ALERT_EMAIL, que es la red de seguridad para que no se pierda
    // en silencio.
    table.string('notice_email', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // La fila nace acá para que el servicio no tenga que crearla al vuelo en
  // cada lectura. Arranca vacía: el valor lo pone el equipo desde el panel.
  await knex('project_settings').insert({ notice_email: null });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('project_settings');
}
