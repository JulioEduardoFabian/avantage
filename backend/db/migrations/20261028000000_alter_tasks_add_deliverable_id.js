/**
 * Agrega `tasks.deliverable_id`: de qué entregable es esta tarea.
 *
 * Hasta ahora el proyecto tenía dos listas que no se hablaban: las **tareas**
 * (lo que hace el equipo por dentro) y los **entregables** (lo que el cliente
 * recibe, con su fecha pactada y su cuota). En el tablero del proyecto se veían
 * treinta tareas sueltas sin forma de saber cuáles de ellas había que terminar
 * para poder entregar el capítulo que vence el viernes.
 *
 * Con esta llave un entregable pasa a ser lo que de verdad es: un paquete de
 * trabajo. "Capítulo I y II" deja de ser un título suelto y pasa a tener sus
 * tareas, su avance (hechas/total) y su fecha — y el tablero puede filtrarse
 * por él.
 *
 * Es **opcional** a propósito: hay tareas internas que no corresponden a
 * ninguna entrega (coordinar con el asesor, revisar formato) y obligarlas a
 * colgar de un entregable inventado sería peor que dejarlas sueltas.
 *
 * ON DELETE SET NULL y no CASCADE: quitar un entregable del plan no puede
 * borrar el trabajo que ya se registró. Las tareas quedan sueltas, visibles en
 * el tablero, y se reasignan si hace falta.
 */
export async function up(knex) {
  await knex.schema.alterTable('tasks', (table) => {
    table.integer('deliverable_id').unsigned().nullable()
      .references('id').inTable('deliverables').onDelete('SET NULL');
    // El acceso es siempre "las tareas de este entregable".
    table.index('deliverable_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('tasks', (table) => {
    table.dropForeign('deliverable_id');
    table.dropIndex('deliverable_id');
    table.dropColumn('deliverable_id');
  });
}
