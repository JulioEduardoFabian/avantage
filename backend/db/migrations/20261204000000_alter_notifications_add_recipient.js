/**
 * Las notificaciones pasan a tener **destinatario**, y aparece el permiso para
 * escribir una a mano desde el panel (`notices.send`).
 *
 * Hasta acá `notifications` no tenía columna de usuario: la campana del navbar
 * era global y lo que salía ahí lo veía cualquiera con sesión. Eso estaba bien
 * mientras todo lo que entraba fuera automático —una reunión agendada, un pago
 * verificado: avisos del negocio, no de una persona a otra—. Desde que se puede
 * escribir un aviso y elegir a quién va, hace falta saber de quién es cada uno.
 *
 * **`user_id` en NULL significa "para todos"**, y por eso es nullable y no se
 * rellena: las notificaciones que ya están y TODAS las automáticas siguen
 * naciendo en NULL, así que ni la campana ni los ocho sitios que las crean
 * cambian de comportamiento. La lectura es
 * `where('user_id', viewer).orWhereNull('user_id')`. Al revés —rellenando una
 * fila por usuario— habría que tocar los ocho llamadores y multiplicar por la
 * cantidad de empleados cada aviso del bot.
 *
 * Un aviso dirigido a tres personas son **tres filas**, una por destinatario, y
 * no una fila con una lista. Es lo que hace que `is_read` siga significando lo
 * que significa: cada quien marca el suyo. Con una fila compartida, el primero
 * que lo lee lo marca leído para los otros dos — que es, de hecho, lo que hoy
 * les pasa a los avisos globales, y no hay razón para arrastrar esa rareza a lo
 * nuevo.
 *
 * `batch_id` es lo que vuelve a juntar esas tres filas en UN envío para el
 * historial de la pantalla: sin él, un aviso a diez personas se lee como diez
 * avisos distintos y no se puede decir "esto se mandó una vez, a diez".
 *
 * `created_by` es quién lo escribió, y queda en NULL para lo automático: ahí el
 * autor es el sistema, y poner un nombre sería inventarlo. Misma regla que
 * `leads.created_by`, que calla cuando el lead entró por el bot.
 */

/** Knex no tiene `hasIndex`: en MySQL se pregunta a `information_schema`. */
async function tieneIndice(knex, tabla, nombre) {
  const [filas] = await knex.raw(
    `SELECT COUNT(*) AS total FROM information_schema.STATISTICS
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [tabla, nombre]
  );
  return Number(filas?.[0]?.total || 0) > 0;
}

const PERMISO = { key: 'notices.send', label: 'Avisos al equipo (enviar notificaciones)' };

export async function up(knex) {
  if (!(await knex.schema.hasColumn('notifications', 'user_id'))) {
    await knex.schema.alterTable('notifications', (table) => {
      // CASCADE: una notificación dirigida a alguien que ya no existe no se le
      // puede mostrar a nadie. No es historia que valga la pena guardar.
      table.integer('user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('CASCADE');
    });
  }

  if (!(await knex.schema.hasColumn('notifications', 'created_by'))) {
    await knex.schema.alterTable('notifications', (table) => {
      // SET NULL y no CASCADE: el aviso se mandó y el equipo lo vio. Que quien
      // lo escribió ya no esté en el panel no borra el hecho.
      table.integer('created_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasColumn('notifications', 'batch_id'))) {
    await knex.schema.alterTable('notifications', (table) => {
      table.string('batch_id', 40).nullable();
    });
  }

  // De este índice cuelga la consulta que corre más veces de todas: el conteo
  // de no leídas, que la campana pide cada vez que se abre el panel.
  if (!(await tieneIndice(knex, 'notifications', 'notifications_user_id_is_read_index'))) {
    await knex.schema.alterTable('notifications', (table) => {
      table.index(['user_id', 'is_read'], 'notifications_user_id_is_read_index');
    });
  }

  if (!(await tieneIndice(knex, 'notifications', 'notifications_batch_id_index'))) {
    await knex.schema.alterTable('notifications', (table) => {
      table.index('batch_id', 'notifications_batch_id_index');
    });
  }

  // ── El permiso de enviar avisos ──
  //
  // Se siembra a quien ya administra el panel (`roles.manage`): mandar un aviso
  // llega al teléfono de la gente, así que no es algo que convenga tener
  // encendido por defecto para todos. Quien quiera dárselo a otro rol lo hace
  // desde Roles y Permisos, que es donde se ve a quién afecta.
  const existente = await knex('permissions').where({ key: PERMISO.key }).first();
  const permisoId = existente
    ? existente.id
    : (await knex('permissions').insert(PERMISO))[0];

  const rolesAdmin = await knex('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('permissions.key', 'roles.manage')
    .select('role_permissions.role_id');

  for (const { role_id: roleId } of rolesAdmin) {
    const yaLoTiene = await knex('role_permissions')
      .where({ role_id: roleId, permission_id: permisoId })
      .first();
    if (!yaLoTiene) {
      await knex('role_permissions').insert({ role_id: roleId, permission_id: permisoId });
    }
  }
}

export async function down(knex) {
  // Simétrico con el `up()`: en MySQL el DDL no es transaccional, así que esto
  // tiene que poder correr después de un `up()` que murió a la mitad.
  const permiso = await knex('permissions').where({ key: PERMISO.key }).first();
  if (permiso) {
    await knex('role_permissions').where({ permission_id: permiso.id }).del();
    await knex('permissions').where({ id: permiso.id }).del();
  }

  for (const indice of ['notifications_batch_id_index', 'notifications_user_id_is_read_index']) {
    if (await tieneIndice(knex, 'notifications', indice)) {
      await knex.schema.alterTable('notifications', (table) => {
        table.dropIndex([], indice);
      });
    }
  }

  // Las claves ajenas se sueltan antes de dropear la columna: MySQL no deja
  // quitar una columna con una FK encima.
  for (const columna of ['batch_id', 'created_by', 'user_id']) {
    if (await knex.schema.hasColumn('notifications', columna)) {
      if (columna !== 'batch_id') {
        try {
          await knex.schema.alterTable('notifications', (table) => {
            table.dropForeign([columna]);
          });
        } catch {
          // La FK puede no existir si el `up()` murió entre el alter y acá.
        }
      }
      await knex.schema.alterTable('notifications', (table) => {
        table.dropColumn(columna);
      });
    }
  }
}
