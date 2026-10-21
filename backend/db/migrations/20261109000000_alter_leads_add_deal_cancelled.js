/**
 * Cierres que no llegaron a concretarse.
 *
 * Una venta cerrada deja un cronograma de cuotas (`finance_income` del lead) y
 * un precio total (`leads.total_amount`). Cuando el cliente se cae después de
 * firmar, esas cuotas pendientes se quedan para siempre: Cobranzas las sigue
 * poniendo en la lista de a quién llamar, y el "por cobrar" de Finanzas cuenta
 * una plata que nadie espera. No había forma de decir "esto ya no va".
 *
 * Se marca el CIERRE y no cada cuota a propósito:
 *
 *  - El trato es del lead (ahí viven el precio total y el cronograma), así que
 *    la decisión se toma una vez y no cuota por cuota. Marcar cada fila sería
 *    el mismo dato escrito N veces, y basta olvidar una para que el cliente
 *    reaparezca en Cobranzas.
 *  - No se toca `finance_income.estado`. Eso deja intacta la contabilidad —lo
 *    ya verificado entró de verdad y sigue contando— y hace que deshacerlo sea
 *    borrar tres columnas, sin tener que recordar en qué estado estaba cada
 *    cuota antes.
 *
 * El motivo se guarda porque "no se concretó" sin el porqué no sirve para
 * nada seis meses después, y el quién/cuándo porque es una decisión sobre
 * dinero que alguien tomó.
 */
export async function up(knex) {
  const exists = await knex.schema.hasColumn('leads', 'deal_cancelled_at');
  if (exists) return;

  await knex.schema.alterTable('leads', (table) => {
    // NULL = el cierre sigue vigente. Cobranzas y Finanzas filtran por esta
    // columna en cada lectura, de ahí el índice.
    table.dateTime('deal_cancelled_at').nullable().index('idx_leads_deal_cancelled_at');
    table.integer('deal_cancelled_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('deal_cancelled_reason', 255).nullable();
  });
}

export async function down(knex) {
  const exists = await knex.schema.hasColumn('leads', 'deal_cancelled_at');
  if (!exists) return;

  await knex.schema.alterTable('leads', (table) => {
    table.dropForeign('deal_cancelled_by');
    table.dropIndex('deal_cancelled_at', 'idx_leads_deal_cancelled_at');
    table.dropColumn('deal_cancelled_by');
    table.dropColumn('deal_cancelled_at');
    table.dropColumn('deal_cancelled_reason');
  });
}
