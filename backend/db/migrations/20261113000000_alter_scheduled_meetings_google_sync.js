/**
 * Sincronización del Calendario con el Google Calendar de cada asesor.
 *
 * El panel escribía en Google (crea el evento al agendar) pero nunca volvía a
 * leerlo: si el asesor movía la reunión en su calendario —o la borraba— el
 * Calendario seguía mostrando la hora vieja, y el recordatorio que el bot le
 * manda al lead salía con esa hora. Estas tres columnas son lo que hacía falta
 * para que la lectura tenga dónde aterrizar:
 *
 * - `cancelled_at`: el evento ya no está en Google. Se MARCA en vez de borrar
 *   la fila: de una reunión cancelada cuelgan el lead, el autor y el estado del
 *   recordatorio, y borrarla deja al equipo sin saber que existió — además de
 *   que un botón de sincronizar que destruye filas es un botón que nadie se
 *   atreve a apretar. Una reunión marcada deja de contar en todas partes
 *   (recordatorios, próximas reuniones, agenda del día) MENOS en el Calendario,
 *   que es donde se ve tachada para que alguien se entere.
 * - `synced_at`: cuándo se la comparó por última vez contra Google.
 * - el índice de `calendar_event_id`: es la llave con la que se reconoce lo que
 *   ya está en el panel, y de eso depende que sincronizar dos veces no importe
 *   el mismo evento dos veces.
 *
 * `source` suma un valor, 'google' (traída de Google Calendar), junto a los dos
 * que ya tenía ('bot', 'manual'). Es una columna de texto libre, así que no hay
 * nada que alterar.
 */
export async function up(knex) {
  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.timestamp('cancelled_at').nullable();
    table.timestamp('synced_at').nullable();
    table.index('calendar_event_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.dropIndex('calendar_event_id');
    table.dropColumn('cancelled_at');
    table.dropColumn('synced_at');
  });
}
