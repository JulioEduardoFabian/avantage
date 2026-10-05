/**
 * Agrega `leads.assigned_user_id`: QUIÉN del área comercial tiene el lead a su
 * cargo, enlazado al usuario interno y no escrito a mano.
 *
 * Hasta ahora lo único que había era `assigned_to`, un texto libre de 100
 * caracteres con "Kevin" por defecto que solo se podía editar desde la ficha
 * de la Base de Datos. Dos problemas: en los tableros (el Setter Funnel y el
 * Kanban de Ventas), que es donde se reparte el trabajo, no se veía ni se
 * podía cambiar; y al ser texto nadie garantizaba que lo escrito fuera una
 * persona del equipo ("kevin", "Kevin R.", "kevon" son cuatro asesores
 * distintos para cualquier filtro o conteo).
 *
 * La columna vieja NO se borra y se sigue escribiendo con el nombre del
 * usuario asignado: la lee la Base de Datos, el buscador de los dos tableros y
 * el bot. Si el enlace se guardara solo acá, esas pantallas seguirían
 * mostrando al asesor anterior y el panel diría dos cosas distintas del mismo
 * lead. El enlace es la verdad; el texto, la copia legible que ya consumía
 * medio sistema (`assignmentPatch()` en leadService.js es el único sitio que
 * escribe las dos).
 *
 * ON DELETE SET NULL: dar de baja a un usuario no puede borrar leads ni
 * dejarlos apuntando a una cuenta que no existe. El lead queda sin asignar —
 * que es exactamente lo que pasó— y el nombre viejo sobrevive en `assigned_to`
 * para saber de quién venía.
 *
 * El relleno inicial enlaza los leads cuyo `assigned_to` ya coincide con el
 * nombre de un usuario del panel: sin eso, el día del despliegue todas las
 * fichas aparecerían "sin asignar" aunque el equipo las venga trabajando.
 */
export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.integer('assigned_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    // El acceso es siempre "los leads de esta persona".
    table.index('assigned_user_id');
  });

  const users = await knex('users').select('id', 'name');
  for (const user of users) {
    const name = String(user.name || '').trim();
    if (!name) continue;
    await knex('leads')
      .whereNull('assigned_user_id')
      .whereRaw('LOWER(TRIM(assigned_to)) = ?', [name.toLowerCase()])
      .update({ assigned_user_id: user.id });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropForeign('assigned_user_id');
    table.dropIndex('assigned_user_id');
    table.dropColumn('assigned_user_id');
  });
}
