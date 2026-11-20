/**
 * Una cita agendada no es una cita **asistida**, y el CRM no sabía decir la
 * diferencia.
 *
 * `scheduled_meetings` sabía si la reunión se había **cancelado** —el evento
 * desapareció del Google Calendar del asesor— pero no si alguien se presentó.
 * Con eso, todo lo que mide el embudo cuenta como "cita" a la que nadie fue:
 * la tasa de conversión por anuncio, el reporte de setters, el costo por cita
 * del exportable. Un anuncio que trae gente que agenda y no aparece se lee
 * exactamente igual que uno que trae gente que se presenta, y es la diferencia
 * entre un público bueno y uno que hay que dejar de comprar.
 *
 * Son tres estados y no dos, por la misma razón que `leads.qualified`: `null`
 * es "nadie lo registró todavía" y es información —separa la reunión que
 * todavía no ocurrió, o de la que nadie dijo nada, de la que se sabe que se
 * cayó—. Un `false` por defecto haría el mismo daño con el signo cambiado:
 * mostraría como ausencias todas las reuniones viejas, que son casi todas.
 *
 * Lo marca una **persona** y nunca un automatismo: Google Calendar no sabe
 * quién entró a la sala, y deducirlo de que la reunión ya pasó convertiría el
 * dato en lo que `qualified` era antes de arreglarse — un campo que dice "Sí"
 * en el 100% de las filas y no sirve para medir nada. Queda escrito quién y
 * cuándo, para poder preguntarle.
 *
 * Va en la misma tabla y no en una nueva: es un atributo de ESA reunión, nace
 * y muere con ella, y partirlo obligaría a unir dos tablas en cada lectura de
 * la agenda.
 *
 * Cada paso pregunta antes de hacer porque en MySQL el DDL **no es
 * transaccional**: una migración que muere a la mitad deja su DDL aplicado y a
 * sí misma sin registrar, y el reintento choca contra "Duplicate column name"
 * sin forma de avanzar ni de volver atrás. Pasó el 01/11/2026 con la migración
 * de atribución y la única salida fue tocar la base a mano.
 */

/** Las columnas nuevas, para poder agregar solo las que falten. */
const NUEVAS = [
  /*
   * 'asistio' | 'no_asistio'. Texto y no booleano porque el tercer estado ya
   * es el null, y porque esto crece: "reprogramada en el acto" y "asistió
   * tarde" son desenlaces que el equipo distingue al hablar, y agregarlos a un
   * booleano obliga a una migración de datos.
   */
  ['attendance', (table) => table.string('attendance', 16).nullable()],
  ['attendance_at', (table) => table.timestamp('attendance_at').nullable()],
  ['attendance_by', (table) => table.integer('attendance_by').unsigned().nullable()
    .references('id').inTable('users').onDelete('SET NULL')]
];

/*
 * Se repite en cada migración en vez de vivir en un módulo compartido, y es a
 * propósito: una migración es una foto de un momento del esquema, así que lo
 * que importa de afuera tiene que poder cambiar sin cambiarla. Un ayudante
 * compartido que alguien corrija el año que viene reescribiría lo que hizo esta.
 */
async function hasIndex(knex, tabla, indice) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tabla, indice]
  );
  return rows.length > 0;
}

export async function up(knex) {
  for (const [nombre, definir] of NUEVAS) {
    if (await knex.schema.hasColumn('scheduled_meetings', nombre)) continue;
    await knex.schema.alterTable('scheduled_meetings', definir);
  }

  // De este campo cuelgan los conteos del reporte por anuncio y del reporte de
  // setters, que filtran por él sobre rangos de fechas.
  if (!(await hasIndex(knex, 'scheduled_meetings', 'scheduled_meetings_attendance_index'))) {
    await knex.schema.alterTable('scheduled_meetings', (table) => table.index('attendance'));
  }
}

export async function down(knex) {
  if (await hasIndex(knex, 'scheduled_meetings', 'scheduled_meetings_attendance_index')) {
    await knex.schema.alterTable('scheduled_meetings', (table) => table.dropIndex('attendance'));
  }

  for (const [nombre] of [...NUEVAS].reverse()) {
    if (!(await knex.schema.hasColumn('scheduled_meetings', nombre))) continue;
    await knex.schema.alterTable('scheduled_meetings', (table) => {
      // La clave foránea se suelta antes de la columna: MySQL no deja dropear
      // una columna que todavía sostiene una restricción.
      if (nombre === 'attendance_by') table.dropForeign(nombre);
      table.dropColumn(nombre);
    });
  }
}
