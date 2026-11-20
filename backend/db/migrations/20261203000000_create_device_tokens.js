/**
 * `device_tokens`: a qué dispositivos se les empuja una notificación.
 *
 * La campana del panel (`notifications`) es el registro de lo que pasó y vive
 * en el servidor; esta tabla es la lista de pantallas a las que hay que
 * avisarle. Son dos cosas distintas y por eso son dos tablas: una notificación
 * sigue existiendo aunque nadie tenga la app instalada, y un dispositivo
 * registrado vale para todas las notificaciones que vengan después.
 *
 * **El token identifica al DISPOSITIVO y no a la persona**, y de ahí que el
 * índice único sea `token` a secas y no (`user_id`, `token`): Firebase le da un
 * token a cada instalación de la app, así que si en ese celular entra otra
 * persona, el token tiene que MUDARSE a la cuenta nueva. Con el único sobre el
 * par quedarían dos filas vivas con el mismo token y la notificación de un lead
 * le llegaría a la pantalla de quien usó el teléfono antes — que es exactamente
 * el fallo que no se puede dejar pasar en un panel con permisos por rol.
 *
 * `user_id` está en CASCADE porque un token sin dueño no se le puede mandar a
 * nadie: no es historia que valga la pena guardar, es una dirección de envío.
 *
 * `revoked_at` existe para el token que Firebase rechaza por caducado
 * (`UNREGISTERED`): se marca en vez de borrarse para que el barrido no lo
 * reintente y para poder ver en la pantalla de dispositivos que esa instalación
 * dejó de responder. El cierre de sesión, en cambio, sí BORRA la fila — ahí no
 * hay nada que diagnosticar y lo que importa es que no le siga llegando nada a
 * un teléfono que ya no es de esa sesión.
 *
 * `platform` se guarda porque no todas reciben igual: Firebase Cloud Messaging
 * no existe en Windows ni en Linux, así que esas instalaciones trabajan por
 * sondeo y no tienen token — la columna es lo que permite contar por separado
 * las que de verdad pueden recibir un push.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('device_tokens'))) {
    await knex.schema.createTable('device_tokens', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      // 512 y no TEXT: el token tiene que entrar en un índice único, y en
      // MySQL una columna TEXT no se indexa sin longitud de prefijo. Los
      // tokens de FCM rondan los 160 caracteres; 512 × 4 bytes (utf8mb4)
      // quedan debajo del límite de 3072 bytes de InnoDB.
      table.string('token', 512).notNullable().unique();
      // android | ios | web | macos | windows | linux
      table.string('platform', 20).notNullable();
      // Cómo se enteró de la notificación: 'fcm' (push de verdad) o 'polling'
      // (Windows y Linux, donde FCM no llega). Queda escrito y no se deduce de
      // la plataforma: el día que Firebase soporte una más, la fila vieja
      // seguiría diciendo la verdad de cuando se registró.
      table.string('transport', 20).notNullable().defaultTo('fcm');
      // Para reconocer el aparato en la pantalla de dispositivos ("Redmi Note
      // 12"). Es texto libre que manda la app: no se decide nada con él.
      table.string('device_label', 120).nullable();
      table.string('app_version', 40).nullable();
      table.timestamp('last_seen_at').nullable();
      table.timestamp('revoked_at').nullable();
      table.string('revoked_reason', 60).nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      // El envío pregunta siempre "los tokens vivos de esta gente".
      table.index(['user_id', 'revoked_at']);
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('device_tokens');
}
