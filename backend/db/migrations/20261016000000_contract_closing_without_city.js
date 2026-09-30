/**
 * El cierre del contrato deja de nombrar la ciudad de firma.
 *
 * Decía "…y ambos firman en la ciudad de {{ciudad}}, el {{fecha}}", pero el
 * contrato se firma a distancia casi siempre —el asesorado puede estar en otra
 * región—, así que esa frase declaraba algo que no ocurrió. Queda
 * "…y ambos firman el {{fecha}}".
 *
 * `{{ciudad}}` sigue existiendo como marcador y el campo "Ciudad" sigue en el
 * formulario: solo se quita de este texto, no del sistema.
 *
 * A diferencia de las migraciones anteriores de texto, esta SÍ toca los
 * contratos en BORRADOR además de la plantilla. El cierre es una línea fija
 * que nadie redacta por contrato, y dejar a los borradores con la frase vieja
 * obligaría a resincronizarlos uno por uno para un cambio de media oración.
 * Los contratos FIRMADOS o ANULADOS no se tocan: lo que se firmó es lo que
 * dice el papel.
 */
const OLD_CLOSING = 'y ambos firman en la ciudad de {{ciudad}}, el {{fecha}}.';
const NEW_CLOSING = 'y ambos firman el {{fecha}}.';

export async function up(knex) {
  const templates = await knex('contract_templates').select('id', 'closing');
  for (const t of templates) {
    if (t.closing?.includes(OLD_CLOSING)) {
      await knex('contract_templates').where({ id: t.id })
        .update({ closing: t.closing.replace(OLD_CLOSING, NEW_CLOSING), updated_at: knex.fn.now() });
    }
  }

  const drafts = await knex('contracts').where({ status: 'borrador' }).select('id', 'closing');
  for (const c of drafts) {
    if (c.closing?.includes(OLD_CLOSING)) {
      await knex('contracts').where({ id: c.id })
        .update({ closing: c.closing.replace(OLD_CLOSING, NEW_CLOSING), updated_at: knex.fn.now() });
    }
  }
}

export async function down(knex) {
  const templates = await knex('contract_templates').select('id', 'closing');
  for (const t of templates) {
    if (t.closing?.includes(NEW_CLOSING)) {
      await knex('contract_templates').where({ id: t.id })
        .update({ closing: t.closing.replace(NEW_CLOSING, OLD_CLOSING), updated_at: knex.fn.now() });
    }
  }

  const drafts = await knex('contracts').where({ status: 'borrador' }).select('id', 'closing');
  for (const c of drafts) {
    if (c.closing?.includes(NEW_CLOSING)) {
      await knex('contracts').where({ id: c.id })
        .update({ closing: c.closing.replace(NEW_CLOSING, OLD_CLOSING), updated_at: knex.fn.now() });
    }
  }
}
