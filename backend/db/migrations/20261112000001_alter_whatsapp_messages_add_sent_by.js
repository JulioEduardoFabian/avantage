/**
 * Agrega `whatsapp_messages.sent_by`: quién mandó un mensaje SALIENTE.
 *
 * Hasta ahora todo lo saliente se pintaba en el panel como "Avan", porque era
 * verdad: el bot era el único que escribía. Desde que se puede responder al
 * lead desde su propia ficha —y no solo desde la bandeja de WhatsApp— el hilo
 * es una mezcla, y sin esta columna el setter no distingue lo que escribió él
 * de lo que escribió el bot ni de lo que escribió un compañero. En una
 * conversación donde hay que decidir qué decir a continuación, eso no es un
 * detalle estético: es no saber si al lead ya le contestaron.
 *
 * `null` es "no lo mandó nadie del panel", que son dos casos legítimos y que
 * se ven igual: lo mandó el bot, o lo mandó un asesor desde la app de WhatsApp
 * Business del celular (llega por `recordOutboundEcho` y ahí no hay usuario
 * que atribuir). Por eso es nullable y no tiene valor por defecto: inventar un
 * autor para los mensajes viejos sería escribir una historia que no pasó.
 *
 * `ON DELETE SET NULL` y no `CASCADE`: dar de baja a una persona no puede
 * borrar los mensajes que le mandó al cliente — el hilo es del cliente.
 */
export async function up(knex) {
  await knex.schema.alterTable('whatsapp_messages', (table) => {
    table.integer('sent_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('whatsapp_messages', (table) => {
    table.dropForeign('sent_by');
    table.dropColumn('sent_by');
  });
}
