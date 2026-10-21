/**
 * Dos datos que a la reunión cargada a mano le faltaban: con quién es y por
 * dónde se hace.
 *
 * 1) `contact_name` — el nombre de la persona con la que se reúne uno.
 *
 * Hasta ahora el nombre salía únicamente del lead asociado, así que una
 * reunión agendada desde el Calendario (sin lead detrás) no tenía ninguno, y
 * una agendada sobre un lead que el bot abrió sin nombre de perfil mostraba el
 * marcador "Contacto de WhatsApp" en la agenda. Guardarlo en la reunión deja
 * escribirlo a mano cuando no hay ficha, y corregirlo cuando la ficha todavía
 * no lo tiene, sin tocar el lead.
 *
 * No reemplaza al lead: cuando la reunión viene del funnel, el nombre del lead
 * se precarga acá y el que manda es este, que es el que la persona confirmó al
 * agendar.
 *
 * 2) `modality` — `meet` (videollamada con enlace de Google Meet) o `llamada`
 * (telefónica).
 *
 * De esto depende si falta o no la conexión con Google: una reunión por Meet
 * sin evento en el calendario es una reunión sin sala, y guardarla igual —como
 * se hacía— dejaba al asesor con una cita a la que nadie puede entrar. Ahora
 * esa combinación se rechaza al agendar; para el caso legítimo de reunirse por
 * teléfono está esta columna, que lo dice explícitamente en vez de deducirlo de
 * que falte el enlace.
 *
 * Lo ya agendado queda en `meet`: todas las reuniones existentes nacieron de un
 * flujo que creaba (o intentaba crear) su enlace de Meet.
 */
export async function up(knex) {
  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.string('contact_name', 160).nullable();
    table.string('modality', 20).notNullable().defaultTo('meet');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.dropColumn('contact_name');
    table.dropColumn('modality');
  });
}
