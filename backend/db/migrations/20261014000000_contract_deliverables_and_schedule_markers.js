/**
 * Correcciones al contrato de locación de servicios pedidas por gerencia
 * (29/09/2026), y la tabla que hacía falta para una de ellas.
 *
 * 1. `contract_deliverables`: el cronograma de ENTREGAS de la cláusula quinta.
 *    Hasta ahora la tabla "Fecha | Avance" se tecleaba dentro del texto de la
 *    cláusula, con el resultado previsible: contratos emitidos con la tabla
 *    vacía. Ahora son filas del contrato, se editan en el mismo formulario que
 *    las cuotas y se imprimen con el marcador {{cronograma_entregas}}.
 *
 *    No se parece a las cuotas en un punto importante: las cuotas son filas de
 *    `finance_income` (dinero real que Finanzas cobra), mientras que una
 *    entrega es solo un compromiso escrito en el contrato. Por eso tiene tabla
 *    propia y no toca la contabilidad.
 *
 * 2. La comparecencia pasa a nombrar al representante legal, y el domicilio de
 *    la empresa deja de repetir la ciudad (eso último es cambio de código, en
 *    `contractDocument.js`).
 *
 * 3. Las cláusulas cuarta y quinta cambian su tabla escrita a mano por los
 *    marcadores {{cronograma_pagos}} y {{cronograma_entregas}}.
 *
 * Los puntos 2 y 3 solo se aplican si el texto sigue siendo el que cargó la
 * migración 20261013000000: si alguien ya lo adaptó a mano, se respeta lo suyo
 * (misma regla que esa migración). Y los contratos YA EMITIDOS no se tocan en
 * ningún caso — copian su texto al crearse justamente para eso.
 */

const OLD_INTRO_FRAGMENT = '{{domicilio_empresa}}; a quien en adelante se le denominará como «EL LOCADOR».';
const NEW_INTRO_FRAGMENT = '{{domicilio_empresa}}, representada legalmente por {{representante}}; a quien en adelante se le denominará como «EL LOCADOR».';

// Las tablas vacías tal cual quedaron en el modelo cargado el 13/10.
const OLD_PAYMENT_TABLE = 'Fecha | Monto en soles\n | \n | ';
const OLD_DELIVERY_TABLE = 'Fecha | Avance\n | Firma de contrato\n | ';

export async function up(knex) {
  await knex.schema.createTable('contract_deliverables', (table) => {
    table.increments('id').primary();
    table.integer('contract_id').unsigned().notNullable()
      .references('id').inTable('contracts').onDelete('CASCADE');
    table.integer('position').unsigned().notNullable();
    // La fecha pactada de la entrega. Nullable porque al redactar el contrato
    // se sabe QUÉ se entrega antes que CUÁNDO ("Firma de contrato" no tiene
    // fecha propia): sin fecha, el documento imprime "Por definir".
    table.date('due_date').nullable();
    table.string('avance', 500).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['contract_id', 'position']);
  });

  // --- Textos del tipo de contrato -----------------------------------------

  const templates = await knex('contract_templates')
    .where({ title: 'CONTRATO DE LOCACIÓN DE SERVICIOS' })
    .select('id', 'intro');

  for (const template of templates) {
    if (template.intro && template.intro.includes(OLD_INTRO_FRAGMENT)) {
      await knex('contract_templates').where({ id: template.id }).update({
        intro: template.intro.replace(OLD_INTRO_FRAGMENT, NEW_INTRO_FRAGMENT),
        updated_at: knex.fn.now()
      });
    }

    const clauses = await knex('contract_template_clauses')
      .where({ template_id: template.id })
      .select('id', 'body');

    for (const clause of clauses) {
      if (!clause.body) continue;
      let body = clause.body;
      if (body.includes(OLD_PAYMENT_TABLE)) body = body.replace(OLD_PAYMENT_TABLE, '{{cronograma_pagos}}');
      if (body.includes(OLD_DELIVERY_TABLE)) body = body.replace(OLD_DELIVERY_TABLE, '{{cronograma_entregas}}');
      if (body !== clause.body) {
        await knex('contract_template_clauses').where({ id: clause.id }).update({ body });
      }
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('contract_deliverables');

  const templates = await knex('contract_templates')
    .where({ title: 'CONTRATO DE LOCACIÓN DE SERVICIOS' })
    .select('id', 'intro');

  for (const template of templates) {
    if (template.intro && template.intro.includes(NEW_INTRO_FRAGMENT)) {
      await knex('contract_templates').where({ id: template.id }).update({
        intro: template.intro.replace(NEW_INTRO_FRAGMENT, OLD_INTRO_FRAGMENT),
        updated_at: knex.fn.now()
      });
    }

    const clauses = await knex('contract_template_clauses')
      .where({ template_id: template.id })
      .select('id', 'body');

    for (const clause of clauses) {
      if (!clause.body) continue;
      let body = clause.body;
      if (body.includes('{{cronograma_pagos}}')) body = body.replace('{{cronograma_pagos}}', OLD_PAYMENT_TABLE);
      if (body.includes('{{cronograma_entregas}}')) body = body.replace('{{cronograma_entregas}}', OLD_DELIVERY_TABLE);
      if (body !== clause.body) {
        await knex('contract_template_clauses').where({ id: clause.id }).update({ body });
      }
    }
  }
}
