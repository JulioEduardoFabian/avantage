/**
 * Quién cargó este lead a mano.
 *
 * La ficha ya decía por qué canal entró ("Manual") y cuándo, pero no a quién
 * preguntarle: un lead cargado a mano trae datos que no están en ningún otro
 * lado —lo que la persona contó por teléfono, de dónde salió el contacto— y el
 * responsable comercial que figura al lado no es necesariamente quien lo
 * registró (se asigna aparte, y el que reparte puede cambiarlo después). Sin el
 * autor, una ficha incompleta que apareció en el tablero no tiene dueño a quien
 * consultarle.
 *
 * Es la misma columna, con el mismo nombre y las mismas razones, que la que
 * guarda quién cargó una reunión a mano en `scheduled_meetings`.
 *
 * Nulable y `SET NULL` al borrar el usuario: los leads que entraron por el bot,
 * por Meta o por el evaluador público no los cargó nadie —ahí el canal lo dice
 * todo— y los que se cargaron antes de esta columna tampoco tienen autor
 * conocido. La ficha calla en vez de inventar un nombre.
 */
export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.integer('created_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropForeign('created_by');
    table.dropColumn('created_by');
  });
}
