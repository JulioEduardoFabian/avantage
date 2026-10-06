/**
 * Índice compuesto (`wa_id`, `received_at`) en `whatsapp_messages`.
 *
 * La bandeja de WhatsApp dejó de traer la tabla entera para plegarla en
 * memoria: ahora pide la página de contactos con un `GROUP BY wa_id` ordenado
 * por `MAX(received_at)`. Con los índices sueltos que había (uno por columna)
 * MySQL resuelve ese agrupamiento recorriendo todo y ordenando en disco; con
 * el compuesto lee el máximo de cada grupo del propio índice.
 */
export async function up(knex) {
  await knex.schema.alterTable('whatsapp_messages', (table) => {
    table.index(['wa_id', 'received_at'], 'whatsapp_messages_wa_id_received_at_index');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('whatsapp_messages', (table) => {
    table.dropIndex(['wa_id', 'received_at'], 'whatsapp_messages_wa_id_received_at_index');
  });
}
