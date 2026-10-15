/**
 * Agrega `whatsapp_bot_settings.bot_enabled`: el interruptor **global** de Avan.
 *
 * Hasta ahora apagar el bot era por contacto (`whatsapp_bot_sessions.bot_enabled`,
 * que se pone solo en cuanto alguien responde a mano). No había forma de decir
 * "a partir de ahora atiende el equipo": había que ir conversación por
 * conversación, y los contactos NUEVOS seguían cayendo en el bot igual.
 *
 * De esta fila cuelgan dos cosas, y por eso es una sola y no dos:
 *
 *  - con el bot **encendido**, todo sigue como hasta hoy: Avan califica y
 *    agenda, y el reparto automático de leads NO corre (los leads entran como
 *    siempre, sin responsable);
 *  - con el bot **apagado**, Avan no manda un solo mensaje y el lead que entra
 *    solo (WhatsApp, formulario de Meta, evaluador) se le asigna a quien le
 *    toque según `/admin/reparto` y aparece en SU Setter Funnel.
 *
 * O sea que este booleano es también el interruptor del reparto. Son el mismo
 * botón a propósito: "el bot atiende" y "lo atiende una persona del equipo" son
 * los dos lados de la misma decisión, y con dos interruptores separados la
 * combinación "bot apagado y sin reparto" deja los leads sin dueño y sin
 * respuesta — nadie los ve y nadie los contesta, que es el peor estado posible.
 * Por eso `lead_routing_pools.enabled` deja de decidir nada (ver
 * `leadRoutingService.isActive()`).
 *
 * Nace en `true`: la migración no puede cambiarle el comportamiento a una
 * instalación que ya está funcionando.
 */
export async function up(knex) {
  await knex.schema.alterTable('whatsapp_bot_settings', (table) => {
    table.boolean('bot_enabled').notNullable().defaultTo(true);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('whatsapp_bot_settings', (table) => {
    table.dropColumn('bot_enabled');
  });
}
