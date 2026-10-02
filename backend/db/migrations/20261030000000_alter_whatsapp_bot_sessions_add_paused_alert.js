/**
 * Agrega `whatsapp_bot_sessions.paused_alert_at`: cuándo se avisó por última
 * vez de que un contacto escribió con el bot PAUSADO.
 *
 * El bot se pausa solo en cuanto una persona responde a mano desde el panel, y
 * también cuando se manda una plantilla de reactivación ("¿Aún te encuentras
 * interesado...?"). A partir de ahí, lo que conteste el contacto entra, se
 * guarda en `whatsapp_messages`… y no le llega a nadie: el bot lo registra en
 * su bitácora interna como `skipped` y se va.
 *
 * El 01/10 eso dejó sin respuesta a un lead que preguntó el precio DOS veces
 * ("Precio de una tesis de ingeniería civil" / "Cuánto es si en caso lo arman
 * uds") — intención de compra explícita, silencio total. Ahora esa respuesta
 * despierta un aviso al equipo.
 *
 * Hace falta la marca en la base, y no un contador en memoria, por dos
 * razones: el proceso se reinicia en cada despliegue (y volvería a avisar de
 * conversaciones viejas), y el aviso tiene que espaciarse aunque el contacto
 * mande diez burbujas seguidas.
 */
export async function up(knex) {
  await knex.schema.alterTable('whatsapp_bot_sessions', (table) => {
    table.timestamp('paused_alert_at').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('whatsapp_bot_sessions', (table) => {
    table.dropColumn('paused_alert_at');
  });
}
