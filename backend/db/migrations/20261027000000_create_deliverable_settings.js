/**
 * Tabla `deliverable_settings` (fila única): la configuración del módulo de
 * Entregables.
 *
 * Por ahora guarda una sola cosa, `notice_email`: a qué correo llega el aviso
 * de "Finanzas verificó esta cuota, ya se puede entregar". Antes ese aviso se
 * repartía entre todos los usuarios con permiso `deliverables.view`, y eso no
 * es lo que el equipo quiere: de las entregas se encarga UNA persona, y
 * mandárselo a todos convierte el aviso en ruido que nadie termina de mirar.
 *
 * Es una fila en la base y no una variable de entorno a propósito: el
 * destinatario cambia cuando cambia quién ocupa el puesto, y eso tiene que
 * poder hacerse desde el panel —sin tocar el `.env` ni reiniciar el
 * servidor— por la misma persona que usa la pantalla.
 *
 * Tabla propia y de una sola fila, como `whatsapp_bot_settings`: cuando el
 * módulo necesite más ajustes, van acá como columnas nuevas.
 */
export async function up(knex) {
  await knex.schema.createTable('deliverable_settings', (table) => {
    table.increments('id').primary();
    // Nullable: mientras nadie lo configure, el aviso cae en
    // INTERNAL_ALERT_EMAIL (ver `paymentNoticeService`), que es la red de
    // seguridad para que no se pierda en silencio.
    table.string('notice_email', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // La fila nace acá para que el servicio no tenga que crearla al vuelo en
  // cada lectura. Arranca vacía: el valor lo pone el equipo desde el panel.
  await knex('deliverable_settings').insert({ notice_email: null });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('deliverable_settings');
}
