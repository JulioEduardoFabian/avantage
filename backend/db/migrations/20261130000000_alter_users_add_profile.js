/**
 * La foto de perfil de un usuario interno y cuándo cambió su contraseña por
 * última vez.
 *
 * Son las dos columnas que necesita la sección "Mi perfil" del panel, y las dos
 * son del usuario y no de su rol: el rol dice qué puede hacer, esto dice quién
 * es y cuándo tocó su acceso.
 *
 * `avatar_filename` guarda SOLO el nombre del archivo en `uploads/avatars/`,
 * nunca una ruta ni una URL: la carpeta base la decide `UPLOADS_DIR` y puede
 * cambiar entre despliegues (ver la nota de persistencia de uploads en
 * README.md), así que una ruta guardada en la base queda apuntando al disco de
 * ayer. La URL pública se arma en cada lectura (`avatarUrlFor()` en
 * `userService.js`), igual que el resto de lo que se sirve desde `uploads/`.
 * Nace en null y eso es lo correcto: quien no subió foto se sigue viendo con
 * sus iniciales, que es lo que el panel ya dibujaba.
 *
 * `password_changed_at` no es parte de ninguna regla —no caduca nada, no se
 * fuerza ningún cambio— y es a propósito: existe para que la propia pantalla
 * pueda decir "la cambiaste el 9 de noviembre", que es lo único que contesta
 * "¿esta contraseña es la vieja que me dieron al crearme la cuenta?". Nulo
 * significa que nunca se cambió desde que existe esta columna, no que nunca se
 * haya cambiado: de los cambios anteriores no hay registro en ningún lado y
 * rellenarlo con `created_at` afirmaría algo que no se sabe.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'avatar_filename'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('avatar_filename', 255).nullable();
    });
  }

  if (!(await knex.schema.hasColumn('users', 'password_changed_at'))) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('password_changed_at').nullable();
    });
  }
}

export async function down(knex) {
  // Simétrico con el `up()`: el DDL de MySQL no es transaccional, así que este
  // `down()` tiene que poder correr después de un `up()` que murió entre las
  // dos columnas.
  if (await knex.schema.hasColumn('users', 'password_changed_at')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('password_changed_at');
    });
  }

  if (await knex.schema.hasColumn('users', 'avatar_filename')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('avatar_filename');
    });
  }
}
