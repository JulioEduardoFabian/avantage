/**
 * Un permiso por cada botón del menú lateral.
 *
 * Hasta ahora `leads.view` abría once pantallas distintas: el Funnel de Ventas,
 * el Setter Funnel, Campañas, Webhooks, Interacciones, Instagram, WhatsApp, la
 * Personalidad del Bot, Documentos, la Base de Datos y (sin permiso ninguno)
 * Disponibilidad. Con un solo rol comercial eso alcanzaba; con un setter y un
 * closer separados, no: dar acceso al tablero del setter obligaba a dar también
 * el libro de documentos y la configuración del bot.
 *
 * Las claves nuevas son exactamente los botones del menú, para que habilitar
 * una herramienta sea marcar una casilla y no haya que saber qué pantallas
 * arrastra. Las rutas del backend se reparten igual (`server.js`), y las que
 * son de datos compartidos —la lista de leads, las columnas del funnel— aceptan
 * `leads.view` O `setter.view`: son el mismo lead visto desde los dos tableros.
 *
 * Nadie pierde acceso al aplicarla: cada rol que hoy tiene `leads.view` recibe
 * las claves en las que se partió. Una migración de permisos que deja a medio
 * equipo afuera se "arregla" devolviéndole todo a todos, que es justo lo que
 * esto viene a evitar.
 */
const NUEVOS_PERMISOS = [
  { key: 'setter.view', label: 'Setter Funnel' },
  { key: 'campaigns.view', label: 'Campañas' },
  { key: 'webhooks.view', label: 'Webhooks' },
  { key: 'social.view', label: 'Interacciones (Facebook)' },
  { key: 'instagram.view', label: 'Instagram' },
  { key: 'whatsapp.view', label: 'WhatsApp' },
  { key: 'bot.manage', label: 'Personalidad del Bot' },
  { key: 'availability.view', label: 'Disponibilidad' },
  { key: 'documents.view', label: 'Documentos' },
  { key: 'database.view', label: 'Base de Datos' }
];

export async function up(knex) {
  for (const permiso of NUEVOS_PERMISOS) {
    const existe = await knex('permissions').where({ key: permiso.key }).first();
    if (!existe) await knex('permissions').insert(permiso);
  }

  // "Panel de Leads (Funnel de Ventas)" ahora nombra UN botón, no un paquete.
  await knex('permissions').where({ key: 'leads.view' }).update({ label: 'Funnel de Ventas' });

  const nuevos = await knex('permissions').whereIn('key', NUEVOS_PERMISOS.map((p) => p.key)).select('id', 'key');
  const leadsPermission = await knex('permissions').where({ key: 'leads.view' }).first();
  if (!leadsPermission) return;

  // Los roles que hoy entran con `leads.view` conservan todo lo que ya veían.
  const rolesConLeads = await knex('role_permissions')
    .where({ permission_id: leadsPermission.id })
    .pluck('role_id');

  const adminRole = await knex('roles').where({ name: 'Administrador' }).first();
  const destinatarios = new Set(rolesConLeads);
  if (adminRole) destinatarios.add(adminRole.id);

  for (const roleId of destinatarios) {
    for (const permiso of nuevos) {
      const yaEsta = await knex('role_permissions')
        .where({ role_id: roleId, permission_id: permiso.id })
        .first();
      if (!yaEsta) await knex('role_permissions').insert({ role_id: roleId, permission_id: permiso.id });
    }
  }
}

export async function down(knex) {
  const ids = await knex('permissions').whereIn('key', NUEVOS_PERMISOS.map((p) => p.key)).pluck('id');
  if (ids.length > 0) {
    await knex('role_permissions').whereIn('permission_id', ids).del();
    await knex('permissions').whereIn('id', ids).del();
  }
  await knex('permissions').where({ key: 'leads.view' }).update({ label: 'Panel de Leads (Funnel de Ventas)' });
}
