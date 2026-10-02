/**
 * Reparación de un solo uso: funde las fichas duplicadas que dejó la primera
 * corrida de la conciliación con Meta.
 *
 * `persistMetaLead()` daba de alta el lead sin cruzar por teléfono (solo por
 * `leadgen_id`), así que al recuperar los envíos perdidos le abrió una segunda
 * ficha a cada persona que ya era lead. La fila nueva nace en "conversación
 * abierta" y, al indexar por teléfono, tapaba a la que el equipo venía
 * trabajando: el tablero de campañas pasó de 40 citas agendadas y 3 ganados a
 * 39 y 1 — los contactos seguían ahí, pero se leían con el estado equivocado.
 *
 * El camino de alta ya cruza por teléfono, así que esto no vuelve a pasar;
 * esta rutina es para el daño ya hecho. Mueve la atribución y las respuestas
 * del formulario a la ficha vieja (la que tiene el historial) y borra la nueva,
 * pero SOLO si no se le colgó nada en el medio: un proyecto, una cotización,
 * un contrato, dinero, notas del equipo o un movimiento de etapa la vuelven
 * intocable, y entonces se reporta para que una persona decida.
 *
 * Se expone también por HTTP (`/api/leads/merge-duplicate-meta` en server.js)
 * por la misma razón que el backfill de campos: corre dentro del proceso que
 * Passenger ya arrancó con las variables de entorno puestas, y un script
 * lanzado por SSH en hosting compartido no las hereda.
 */
import { db } from '../db/connection.js';
import { LeadService, PHONE_MATCH_KEY_SQL, phoneMatchKey } from '../services/leadService.js';

const leadService = new LeadService();

/** Tablas que, si apuntan al lead duplicado, lo vuelven intocable. */
const REFERENCIAS = [
  ['projects', 'lead_id'],
  ['quotes', 'lead_id'],
  ['contracts', 'lead_id'],
  ['finance_income', 'lead_id'],
  ['lead_notes', 'lead_id'],
  ['scheduled_meetings', 'lead_id']
];

async function tieneHistorial(leadId) {
  for (const [tabla, columna] of REFERENCIAS) {
    const existe = await db(tabla).where({ [columna]: leadId }).first();
    if (existe) return tabla;
  }
  // Un movimiento de etapa significa que alguien ya lo trabajó en el tablero.
  const movido = await db('lead_stage_changes').where({ lead_id: leadId }).first();
  return movido ? 'lead_stage_changes' : null;
}

export async function mergeDuplicateMetaLeads({ apply = false } = {}) {
  const candidatos = await db('leads')
    .whereNotNull('meta_leadgen_id')
    .select('id', 'phone', 'status', 'additional_notes', 'meta_leadgen_id', 'meta_form_id',
      'meta_ad_id', 'meta_adset_id', 'meta_campaign_id', 'meta_platform', 'meta_created_time')
    .orderBy('id', 'desc');

  const resultado = { applied: apply, revisados: candidatos.length, fundidos: [], conservados: [], errores: [] };

  for (const duplicado of candidatos) {
    const clave = phoneMatchKey(duplicado.phone);
    if (!clave) continue;

    // La ficha vieja del mismo teléfono: id menor, porque es la que ya existía
    // antes de que la conciliación insertara ésta.
    const original = await db('leads')
      .whereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [clave])
      .andWhere('id', '<', duplicado.id)
      .orderBy('id', 'asc')
      .first();

    if (!original) continue;

    const motivo = await tieneHistorial(duplicado.id);
    if (motivo) {
      resultado.conservados.push({ id: duplicado.id, phone: duplicado.phone, original_id: original.id, motivo });
      continue;
    }

    if (!apply) {
      resultado.fundidos.push({ id: duplicado.id, phone: duplicado.phone, original_id: original.id, original_status: original.status });
      continue;
    }

    try {
      await leadService.attachMetaLeadToExisting(original, {
        leadgenId: duplicado.meta_leadgen_id,
        formId: duplicado.meta_form_id,
        adId: duplicado.meta_ad_id,
        adsetId: duplicado.meta_adset_id,
        campaignId: duplicado.meta_campaign_id,
        platform: duplicado.meta_platform,
        createdTime: duplicado.meta_created_time,
        note: duplicado.additional_notes
      });
      await db('leads').where({ id: duplicado.id }).delete();
      resultado.fundidos.push({ id: duplicado.id, phone: duplicado.phone, original_id: original.id, original_status: original.status });
      console.log(`🧹 [Fusión Meta] Lead duplicado #${duplicado.id} fundido en #${original.id}.`);
    } catch (error) {
      resultado.errores.push({ id: duplicado.id, error: error.message });
      console.error(`❌ [Fusión Meta] No se pudo fundir el lead #${duplicado.id}:`, error);
    }
  }

  return resultado;
}
