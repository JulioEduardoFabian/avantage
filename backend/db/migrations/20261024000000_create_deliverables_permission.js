/**
 * Permiso `deliverables.view`: el módulo "Entregables".
 *
 * El módulo NO trae tablas nuevas a propósito. Su trabajo es cruzar tres cosas
 * que ya existen y que hoy solo se pueden mirar por separado, saltando de
 * pantalla en pantalla:
 *
 *   - las cuotas del cronograma (`finance_income` del lead) y su `estado`,
 *     que es lo que dice si Finanzas ya verificó el pago;
 *   - el trabajo subido (`project_updates`, con su adjunto) y la cuota a la que
 *     se ató (`project_updates.income_id`), que es lo que libera el entregable
 *     en el portal del cliente;
 *   - las entregas comprometidas por escrito (`contract_deliverables`).
 *
 * Una tabla propia sería una cuarta verdad sobre el mismo hecho y se
 * desincronizaría el primer día: el estado operativo de un entregable se
 * DERIVA de esas tres fuentes en cada lectura, igual que `projects.is_locked` y
 * `project_updates.is_locked` ya se derivan del estado del ingreso.
 *
 * El permiso es propio y no `projects.view` ni `finance.view` porque el módulo
 * es justo el cruce: operaciones necesita ver el estado del pago (no el monto,
 * igual que en Proyectos) sin que eso implique abrir toda la contabilidad.
 */
export async function up(knex) {
  const existing = await knex('permissions').where({ key: 'deliverables.view' }).first();
  if (existing) return;

  const [permissionId] = await knex('permissions').insert({
    key: 'deliverables.view',
    label: 'Entregables (pago verificado + trabajo subido)'
  });

  const adminRole = await knex('roles').where({ name: 'Administrador' }).first();
  if (adminRole) {
    await knex('role_permissions').insert({ role_id: adminRole.id, permission_id: permissionId });
  }
}

export async function down(knex) {
  const permission = await knex('permissions').where({ key: 'deliverables.view' }).first();
  if (!permission) return;
  await knex('role_permissions').where({ permission_id: permission.id }).del();
  await knex('permissions').where({ id: permission.id }).del();
}
