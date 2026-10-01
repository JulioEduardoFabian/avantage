/**
 * Agrega `leads.sales_funnel_at`: el momento en que el lead "graduó" al Funnel
 * de Ventas y pasó a ser del closer.
 *
 * Hasta ahora esa pregunta se respondía **deduciéndola** del texto de
 * `leads.status`: si ese valor era la clave de una columna de `funnel_columns`
 * (o uno de los desenlaces fijos), el lead era comercial. Esa deducción se cae
 * sola en cuanto el equipo toca el tablero, y por eso los leads cotizados
 * seguían reapareciendo en el Setter Funnel:
 *
 *   - si alguien borra, recrea o reemplaza una columna, los leads que estaban
 *     ahí se quedan con una clave que ya no existe en `funnel_columns`. Desde
 *     ese momento NADA los reconoce como comerciales: el Setter Funnel vuelve a
 *     mostrarlos y el bot vuelve a moverlos (congelarlos por inactividad);
 *   - un lead que el closer dejó en la primera columna ("Nuevo") tiene un status
 *     de bandeja, que a propósito no cuenta como comercial — también quedaba
 *     a merced del bot;
 *   - y si la consulta de columnas falla en el navegador, el tablero del setter
 *     se quedaba sin la lista y mostraba todo.
 *
 * El marcador no se deduce: se escribe cuando el lead entra al funnel comercial
 * y solo lo borra una persona que lo devuelva a propósito al setter (ver
 * `leadService.updateLeadStatus`). Sobrevive a que se renombre, borre o
 * reconfigure cualquier columna.
 *
 * El relleno marca a los que hoy ya son del closer por su status, y además a
 * los que **tienen cotización, proyecto o ingreso** aunque su status diga otra
 * cosa: esos son justamente los que el bot ya había devuelto al Setter Funnel,
 * y así vuelven al tablero de Ventas. Se excluye `descartado`, que es una
 * decisión explícita de una persona y no hay que revivir.
 */

/** Etapas que SOLO existen en el Setter Funnel (copia fija, ver salesFunnelStage.js). */
const SETTER_ONLY_STATUSES = ['conversacion_abierta', 'calificando', 'congelado', 'transferido_closer', 'descartado'];

/** Etapas de bandeja: están en la primera columna de ambos tableros. */
const INBOX_STATUSES = ['nuevo', 'inbox', 'abierto'];

/** Desenlaces comerciales que existen aunque el tablero no tenga esa columna. */
const GRADUATED_STATUSES = ['cita_agendada', 'en_negociacion', 'ganado', 'perdido'];

export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.timestamp('sales_funnel_at').nullable();
    table.index('sales_funnel_at');
  });

  // 1) Los que hoy son comerciales por su status.
  const columns = await knex('funnel_columns').select('key');
  const salesStatuses = new Set(GRADUATED_STATUSES);
  for (const column of columns) {
    if (!column.key) continue;
    if (SETTER_ONLY_STATUSES.includes(column.key)) continue;
    if (INBOX_STATUSES.includes(column.key)) continue;
    salesStatuses.add(column.key);
  }
  if (salesStatuses.size > 0) {
    await knex('leads')
      .whereIn('status', [...salesStatuses])
      .whereNull('sales_funnel_at')
      .update({ sales_funnel_at: knex.fn.now() });
  }

  // 2) Los que el closer ya trabajó aunque su status diga otra cosa: tienen
  //    cotización, proyecto o un ingreso en Finanzas. Son los que hay que
  //    rescatar del Setter Funnel.
  const worked = new Set();
  for (const table of ['quotes', 'projects', 'finance_income']) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;
    const rows = await knex(table).distinct('lead_id').whereNotNull('lead_id');
    for (const row of rows) worked.add(row.lead_id);
  }
  if (worked.size > 0) {
    await knex('leads')
      .whereIn('id', [...worked])
      .whereNull('sales_funnel_at')
      .whereNot('status', 'descartado')
      .update({ sales_funnel_at: knex.fn.now() });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropIndex('sales_funnel_at');
    table.dropColumn('sales_funnel_at');
  });
}
