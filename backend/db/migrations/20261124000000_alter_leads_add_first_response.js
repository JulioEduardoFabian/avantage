/**
 * Cuándo se le contestó por primera vez a un lead, y quién.
 *
 * Hasta ahora esto se calculaba —solo para el exportable de Campañas— como el
 * primer mensaje SALIENTE de la conversación de WhatsApp de ese contacto. Eso
 * deja fuera a los leads que son justamente el problema: el que llenó un
 * formulario y nunca escribió por WhatsApp no tiene conversación, así que su
 * primera respuesta salía vacía y no se podía distinguir "no se le contactó"
 * de "se le llamó y no quedó registrado" (12 de 22 leads del anuncio "FORM |
 * contrato | 25Oct", corte del 31/10/2026).
 *
 * Con la marca en el lead:
 *
 *  - se escribe sola desde los dos caminos por los que de verdad se contesta:
 *    el envío de un mensaje de WhatsApp (lo mande Avan o una persona desde el
 *    panel, igual que `whatsapp_messages.sent_by`) y la primera nota de la
 *    ficha, que es donde queda el registro de una llamada;
 *  - saber si un lead está sin atender deja de costar una consulta sobre toda
 *    la tabla de mensajes: es una columna de `leads`, así que el tablero puede
 *    avisar en la tarjeta.
 *
 * `first_response_by` nulo significa que contestó Avan, la misma convención que
 * `whatsapp_messages.sent_by`: ahí nulo es "lo mandó el bot".
 *
 * Se rellena con lo que ya se puede saber: el primer saliente de cada
 * conversación de WhatsApp, cruzado al lead por los últimos 9 dígitos del
 * teléfono (el criterio de `leadService.findByPhone()`). Lo que no se pueda
 * reconstruir queda en null, que es lo que corresponde: nadie dejó registro.
 */
const PHONE_KEY_SQL = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9)";

export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.timestamp('first_response_at').nullable();
    table.integer('first_response_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
  });

  const primeros = await knex('whatsapp_messages')
    .where('direction', 'outbound')
    .groupBy('wa_id')
    .select('wa_id')
    .min('received_at as primero');

  let rellenados = 0;
  for (const row of primeros) {
    if (!row.primero) continue;

    const digits = String(row.wa_id).replace(/[^0-9]/g, '');
    const key = digits.length >= 9 ? digits.slice(-9) : null;

    rellenados += await knex('leads')
      .where((q) => {
        // La cadena exacta cubre los `wa_id` que no son teléfonos sino
        // identificadores de usuario de la empresa ("PE.2379096279586501"),
        // que es lo que esos leads tienen en `phone`.
        q.where('leads.phone', row.wa_id);
        if (key) q.orWhereRaw(`${PHONE_KEY_SQL} = ?`, [key]);
      })
      .whereNull('first_response_at')
      .update({ first_response_at: row.primero });
  }

  if (rellenados) {
    console.log(`✅ [Migración] Primera respuesta reconstruida en ${rellenados} lead(s).`);
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropForeign('first_response_by');
    table.dropColumn('first_response_by');
    table.dropColumn('first_response_at');
  });
}
