/**
 * `bot_quality_events`: el monitor de calidad del bot.
 *
 * El bot ya anotaba todo —más de cien tipos de evento en `logActivity()`— pero
 * en un arreglo **en memoria** de tamaño fijo: se pierde entero en cada
 * despliegue, no se puede consultar por fecha y no se puede sumar. O sea que
 * las cuatro preguntas que de verdad se hacen sobre el bot no tenían
 * respuesta: cuántas preguntas quedaron sin resolver, cuántos errores hubo,
 * cuántas veces repitió lo mismo y cuántas conversaciones se abandonaron. Las
 * tres veces que se encontró algo así —las ocho conversaciones huérfanas, los
 * cuatro "estoy en sala de espera", los 35 entrantes sin responder— fue porque
 * alguien se puso a abrir conversaciones a mano.
 *
 * Qué se guarda lo decide `botQuality.js` (puro, con test), y **no se guarda
 * todo**: de los cien tipos entran los que contestan una de las cuatro
 * preguntas. `send_success` y `llm_request` solos son dos filas por turno, así
 * que guardarlos enterraría las cuatro cifras que esta tabla viene a hacer
 * visibles. La bitácora en memoria sigue existiendo para depurar UNA
 * conversación, que es otra pregunta.
 *
 * `actor` es quién lo provocó, y en un abandono es la mitad del dato: un
 * contacto que se fue y una conversación que NOSOTROS dejamos sin contestar se
 * ven igual en una cifra y se arreglan al revés —al primero se le insiste, al
 * segundo se le reclama al equipo—. Mezclados, el número no decide nada.
 *
 * `wa_id` y no `lead_id`: estos eventos ocurren en la conversación, y hay
 * conversaciones que todavía no tienen ficha (son justo las que más interesan
 * en el cajón de abandonos). Sin llave foránea por lo mismo.
 *
 * Los índices van DENTRO del `createTable`, como en `lead_deletions`: en MySQL
 * el DDL no es transaccional, así que el único punto donde una migración puede
 * morir a la mitad es ENTRE dos sentencias — declarados acá no hay un "entre",
 * y el `hasTable` de arriba es toda la guarda que hace falta para reintentarla.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('bot_quality_events'))) {
    await knex.schema.createTable('bot_quality_events', (table) => {
      table.increments('id').primary();

      // Una de las cuatro preguntas: pregunta_no_resuelta | error |
      // respuesta_repetida | abandono.
      table.string('kind', 30).notNullable();
      // contacto | equipo | bot.
      table.string('actor', 20).notNullable().defaultTo('bot');
      // alta | media | baja.
      table.string('severity', 10).notNullable().defaultTo('media');
      // El tipo de la bitácora del que salió, que es lo que permite volver al
      // código que lo escribió sin tener que adivinar.
      table.string('event_type', 60).notNullable();

      table.string('wa_id', 30).nullable();
      // El texto del contacto, el motivo o el mensaje de error: sin esto la
      // tabla dice "12 preguntas no resueltas" y no deja arreglar ninguna.
      table.string('detail', 500).nullable();

      table.timestamp('created_at').defaultTo(knex.fn.now());

      // El período es el filtro de todas las lecturas; `kind` y `wa_id` son
      // los dos recortes de la pantalla.
      table.index('created_at');
      table.index(['kind', 'created_at']);
      table.index('wa_id');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('bot_quality_events');
}
