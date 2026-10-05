/**
 * Crea los roles **Setter** y **Closer**, las dos mitades del área comercial.
 *
 * Hasta ahora había un solo rol "Comercial" con `leads.view`, que abría los dos
 * tableros y todo lo que colgaba de esa clave. El equipo trabaja partido: la
 * setter conversa, califica y agenda; el closer recibe el lead agendado,
 * cotiza, contrata y cierra. Con un rol único, cada uno veía el tablero del
 * otro y podía moverle los leads.
 *
 * Los dos siguen siendo **área comercial** —a los dos se les puede asignar un
 * lead— porque esa pregunta no se contesta con el nombre del rol sino con los
 * permisos: `userService.listCommercialTeam()` toma a quien tenga `leads.view`
 * o `setter.view`, o sea a quien pueda trabajar un lead en alguno de los dos
 * tableros. Un rol nuevo ("Closer Senior") entra solo.
 *
 * El rol "Comercial" anterior no se toca: los usuarios que lo tengan siguen
 * viendo lo mismo que antes (la migración de permisos le repartió las claves en
 * las que se partió `leads.view`). Pasar a cada persona a su rol nuevo es una
 * decisión del equipo, no de una migración.
 */
const ROLES = [
  {
    name: 'Setter',
    description: 'Califica y agenda: Setter Funnel, WhatsApp e interacciones de redes',
    permissions: ['setter.view', 'whatsapp.view', 'instagram.view', 'social.view', 'availability.view']
  },
  {
    name: 'Closer',
    description: 'Cierra la venta: Funnel de Ventas, documentos y contratos',
    permissions: ['leads.view', 'documents.view', 'contracts.manage', 'availability.view', 'whatsapp.view']
  }
];

export async function up(knex) {
  for (const rol of ROLES) {
    const existente = await knex('roles').where({ name: rol.name }).first();
    if (existente) continue;

    const [roleId] = await knex('roles').insert({ name: rol.name, description: rol.description });
    const permisos = await knex('permissions').whereIn('key', rol.permissions).select('id');
    if (permisos.length > 0) {
      await knex('role_permissions').insert(
        permisos.map((permiso) => ({ role_id: roleId, permission_id: permiso.id }))
      );
    }
  }
}

export async function down(knex) {
  for (const rol of ROLES) {
    const existente = await knex('roles').where({ name: rol.name }).first();
    if (!existente) continue;
    // Un rol con gente adentro no se borra: `users.role_id` es RESTRICT y
    // dejaría usuarios sin puesto.
    const enUso = await knex('users').where({ role_id: existente.id }).first();
    if (enUso) continue;
    await knex('role_permissions').where({ role_id: existente.id }).del();
    await knex('roles').where({ id: existente.id }).del();
  }
}
