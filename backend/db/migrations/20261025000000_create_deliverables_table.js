/**
 * Tabla `deliverables`: el registro propio de las entregas de cada proyecto.
 *
 * Hasta ahora un "entregable" era un hito de la línea de tiempo
 * (`project_updates`) con adjunto y una cuota que lo liberaba en el portal del
 * cliente. Ese camino sigue existiendo y no se toca — el cliente sigue viendo
 * su línea de tiempo igual —, pero ya no es por donde se entrega: la entrega
 * pasó a ser un acto que ocurre fuera del sistema (por correo, por WhatsApp, en
 * persona) y que operaciones registra acá.
 *
 * Por eso hace falta tabla propia y no alcanzaba con derivar de las otras:
 *
 *   - `project_updates` solo sabe de lo que YA se publicó. No puede decir "esto
 *     falta entregar", que es justo lo que el tablero tiene que mostrar.
 *   - `contract_deliverables` es el compromiso escrito en un contrato emitido:
 *     es inmutable a propósito (un contrato firmado no cambia porque alguien
 *     reprograme una entrega), así que no puede llevar el estado operativo.
 *   - `finance_income` es el dinero, no el trabajo.
 *
 * Una fila es un entregable PLANIFICADO que después se marca como entregado:
 * primero se sabe qué hay que entregar y contra qué cuota, y más tarde cuándo,
 * quién y por qué canal se entregó. Las dos mitades en la misma fila para que
 * "lo que falta" y "lo que se hizo" nunca se cuenten dos veces.
 *
 * `income_id` es la cuota que condiciona la entrega, y es opcional: hay
 * entregables que no se atan a ningún cobro. Va con ON DELETE SET NULL (no
 * CASCADE) porque borrar una cuota del cronograma no puede borrar el registro
 * de un trabajo que ya se entregó.
 */
export async function up(knex) {
  await knex.schema.createTable('deliverables', (table) => {
    table.increments('id').primary();
    table.integer('project_id').unsigned().notNullable()
      .references('id').inTable('projects').onDelete('CASCADE');
    table.integer('income_id').unsigned().nullable()
      .references('id').inTable('finance_income').onDelete('SET NULL');

    // Orden dentro del proyecto: las entregas son una secuencia ("Capítulo I",
    // "Capítulo II"), y ordenar por fecha deja fuera a las que todavía no la
    // tienen.
    table.integer('position').unsigned().notNullable().defaultTo(0);
    table.string('title', 255).notNullable();
    table.text('description').nullable();
    // Nullable por la misma razón que en `contract_deliverables`: al planificar
    // se sabe QUÉ se entrega antes que CUÁNDO.
    table.date('due_date').nullable();

    // pendiente | entregado. Dos estados y no más: el estado operativo que ve
    // el tablero (entregado / sin cobrar / por entregar / pendiente) sale de
    // cruzar esto con el estado de la cuota, y no se guarda — igual que
    // `projects.is_locked`.
    table.string('status', 20).notNullable().defaultTo('pendiente');

    table.date('delivered_at').nullable();
    table.integer('delivered_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    // Por dónde se entregó de verdad (correo, WhatsApp, presencial, Drive…).
    // Es el dato que reemplaza al portal: si mañana el cliente reclama, esto es
    // lo que dice dónde buscar.
    table.string('delivery_channel', 30).nullable();

    // Copia del archivo entregado, como respaldo interno. Opcional: se entrega
    // por fuera, así que puede no haber archivo que guardar.
    table.string('attachment_filename', 255).nullable();
    table.string('attachment_original_name', 255).nullable();
    table.string('attachment_mime_type', 150).nullable();
    table.integer('attachment_size').unsigned().nullable();

    table.text('notes').nullable();
    table.integer('created_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index(['project_id', 'position']);
    table.index('income_id');
    table.index('status');
  });

  // El módulo ya no es solo de consulta, así que la etiqueta del permiso deja
  // de prometer únicamente eso.
  await knex('permissions')
    .where({ key: 'deliverables.view' })
    .update({ label: 'Entregables' });
}

export async function down(knex) {
  await knex('permissions')
    .where({ key: 'deliverables.view' })
    .update({ label: 'Entregables (pago verificado + trabajo subido)' });
  await knex.schema.dropTableIfExists('deliverables');
}
