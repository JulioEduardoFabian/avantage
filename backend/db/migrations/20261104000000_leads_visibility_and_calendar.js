/**
 * Dos permisos nuevos y las columnas que necesita una reunión agendada a mano.
 *
 * 1) `leads.manage_all` — "administrador del área comercial".
 *
 * Hasta ahora cualquiera con acceso a un tablero veía TODOS los leads. Con el
 * equipo repartido, cada persona tiene que ver los suyos: el que no tiene este
 * permiso ve en su funnel únicamente los leads que le asignaron, y el que lo
 * tiene ve el total y es el único que puede repartirlos. El filtro vive en el
 * servidor (`getAllLeads({ viewerId })` y el middleware de visibilidad de
 * `/api/leads/:id`), no escondiendo tarjetas en la pantalla: lo que no viaja no
 * se puede mirar con las herramientas del navegador.
 *
 * Ojo con lo que esto significa el primer día: los leads que todavía no tienen
 * responsable (`assigned_user_id` nulo) **no los ve nadie** salvo quien tenga
 * este permiso. Es a propósito —el tablero se ve en blanco hasta que se
 * reparte— y no se borra ni se toca ningún dato.
 *
 * 2) `calendar.view` — el módulo de Calendario, donde cada closer ve sus
 * reuniones y agenda nuevas.
 *
 * 3) `scheduled_meetings` deja de ser solo lo que agenda el bot. Una reunión
 * creada a mano desde el Calendario o desde la ficha del lead no tiene
 * conversación de WhatsApp detrás, así que `wa_id` pasa a admitir nulos, y se
 * guarda quién la creó, a qué correo se invitó y por dónde entró (`source`).
 * Sin `source` no se puede distinguir después una reunión del bot de una
 * cargada a mano, que es justo lo que hay que mirar para saber si el bot está
 * agendando o lo está haciendo el equipo.
 */
const PERMISOS = [
  { key: 'leads.manage_all', label: 'Ver y asignar todos los leads (jefe comercial)' },
  { key: 'calendar.view', label: 'Calendario' }
];

export async function up(knex) {
  for (const permiso of PERMISOS) {
    const existe = await knex('permissions').where({ key: permiso.key }).first();
    if (existe) continue;
    const [permissionId] = await knex('permissions').insert(permiso);

    // `leads.manage_all` arranca SOLO en Administrador: repartirlo es una
    // decisión del equipo, y dárselo a todos de entrada dejaría el filtro sin
    // efecto el mismo día que se estrena. El Calendario, en cambio, lo usan
    // todos los puestos que atienden leads.
    const nombres = permiso.key === 'calendar.view'
      ? ['Administrador', 'Comercial', 'Closer', 'Setter']
      : ['Administrador'];
    const roles = await knex('roles').whereIn('name', nombres).select('id');
    for (const rol of roles) {
      await knex('role_permissions').insert({ role_id: rol.id, permission_id: permissionId });
    }
  }

  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.string('wa_id', 30).nullable().alter();
    table.integer('created_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('attendee_email', 255).nullable();
    // 'bot' = la agendó Avan; 'manual' = la cargó una persona.
    table.string('source', 20).notNullable().defaultTo('bot');
  });
}

export async function down(knex) {
  const ids = await knex('permissions').whereIn('key', PERMISOS.map((p) => p.key)).pluck('id');
  if (ids.length > 0) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    await knex('permissions').whereIn('id', ids).del();
  }

  await knex('scheduled_meetings').whereNull('wa_id').del();
  await knex.schema.alterTable('scheduled_meetings', (table) => {
    table.dropForeign('created_by');
    table.dropColumn('created_by');
    table.dropColumn('attendee_email');
    table.dropColumn('source');
    table.string('wa_id', 30).notNullable().alter();
  });
}
