/**
 * Carga la versión VIGENTE del contrato de locación de servicios, confirmada
 * por gerencia el 29/09/2026.
 *
 * La que estaba cargada (migración 20261013000000) tenía otra redacción y
 * nunca fue la que el área legal quería emitir: hablaba de "el cliente" donde
 * el resto del contrato usa los términos definidos «EL LOCADOR» y
 * «EL ASESORADO», y sus cláusulas no coincidían con el Word en uso. Se detectó
 * al comparar dos contratos emitidos con días de diferencia (CTR-2026-0004,
 * con el texto bueno pegado a mano, y CTR-2026-0005, creado ya desde la
 * plantilla equivocada).
 *
 * Respecto del Word original, el texto entra con tres arreglos:
 *   - los ordinales salen de los títulos (los arma el documento por posición;
 *     en el Word tres cláusulas los traían duplicados);
 *   - las viñetas llevan "- " en vez de la "o" que Word deja al pegar;
 *   - los cronogramas y las cuentas van como marcador y no como tabla tecleada.
 *
 * Solo reescribe la plantilla si su contenido sigue siendo uno de los que
 * cargamos nosotros: si alguien la curó a mano desde el panel, esa versión se
 * respeta y esta migración no hace nada (mismo criterio que 20261013000000).
 * Los contratos YA EMITIDOS no se tocan en ningún caso: copian su texto al
 * crearse justamente para eso.
 */
import { SERVICE_CONTRACT_MODEL } from '../data/serviceContractModel.js';

// Títulos con los que quedó la plantilla tras 20261013000000 (+ los marcadores
// de cronograma que le puso 20261014000000). Si son exactamente estos, nadie
// la editó desde el panel.
const SHIPPED_CLAUSE_TITLES = [
  'OBJETO DEL CONTRATO',
  'OBLIGACIONES DEL LOCADOR',
  'OBLIGACIONES DEL ASESORADO',
  'COSTO Y FORMA DEL PAGO',
  'ENTREGAS Y FORMA DE ENTREGAS',
  'EXCLUSIVIDAD',
  'SOBRE LA RESOLUCIÓN DEL CONTRATO',
  'MORA INDEMNIZATORIA Y PENALIDADES',
  'CONFIDENCIALIDAD',
  'GARANTÍA DEL SERVICIO',
  'SANCIONES',
  'SOLUCIÓN DE CONFLICTOS',
  'BONIFICACIONES',
  'SUSPENSIÓN Y REPROGRAMACIÓN POR INACTIVIDAD DEL ASESORADO'
];

function sameTitles(actual, expected) {
  return actual.length === expected.length && actual.every((t, i) => t === expected[i]);
}

async function replaceClauses(knex, templateId, clauses) {
  await knex('contract_template_clauses').where({ template_id: templateId }).del();
  await knex('contract_template_clauses').insert(
    clauses.map((c, i) => ({ template_id: templateId, position: i + 1, title: c.title, body: c.body }))
  );
}

export async function up(knex) {
  const templates = await knex('contract_templates')
    .where({ title: SERVICE_CONTRACT_MODEL.title })
    .orderBy('id')
    .select('id');

  for (const template of templates) {
    const rows = await knex('contract_template_clauses')
      .where({ template_id: template.id })
      .orderBy('position')
      .select('title');
    if (!sameTitles(rows.map((r) => r.title), SHIPPED_CLAUSE_TITLES)) continue;

    await knex('contract_templates').where({ id: template.id }).update({
      label: SERVICE_CONTRACT_MODEL.label,
      title: SERVICE_CONTRACT_MODEL.title,
      intro: SERVICE_CONTRACT_MODEL.intro,
      closing: SERVICE_CONTRACT_MODEL.closing,
      updated_at: knex.fn.now()
    });
    await replaceClauses(knex, template.id, SERVICE_CONTRACT_MODEL.clauses);
  }
}

/**
 * No se restaura el texto anterior: era el que nunca debió emitirse, y
 * devolverlo dejaría la plantilla peor de lo que está. Revertir esta migración
 * deja la plantilla como quedó, que es texto válido y editable desde el panel.
 */
export async function down() {
  // Intencionalmente vacía. Ver la nota de arriba.
}
