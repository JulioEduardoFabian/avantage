/**
 * Saca la atribución de Meta Lead Ads del texto libre a columnas propias.
 *
 * Hasta ahora lo único que quedaba de un lead de formulario era el marcador
 * `[Meta leadgen_id=...] form_id=...` escrito dentro de `additional_notes`
 * (metaWebhookService.importLead()). Eso alcanzaba para no reimportar dos
 * veces el mismo lead, pero no para responder la pregunta que hoy se
 * contesta a mano exportando el CSV del Administrador de anuncios: cuántos
 * leads trajo CADA anuncio y cuántos de esos llegaron realmente al CRM.
 *
 * `meta_created_time` es el momento en que la persona envió el formulario en
 * Meta, que NO es `created_at` (cuando el lead entró a este sistema). La
 * diferencia importa justamente al conciliar: un lead recuperado días después
 * tiene que contarse en el día en que ocurrió, no en el día en que se rescató.
 *
 * Los leads ya importados se completan leyendo el marcador que tienen en las
 * notas — el resto de las columnas (anuncio, conjunto, campaña) solo se puede
 * rellenar pidiéndoselas a la Graph API, y de eso se encarga la conciliación.
 */
const LEADGEN_MARKER_RE = /\[Meta leadgen_id=(\d+)\]/;
const FORM_MARKER_RE = /form_id=(\S+)/;

export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.string('meta_leadgen_id', 40).nullable();
    table.string('meta_form_id', 40).nullable();
    table.string('meta_ad_id', 40).nullable();
    table.string('meta_adset_id', 40).nullable();
    table.string('meta_campaign_id', 40).nullable();
    table.string('meta_platform', 20).nullable();
    table.timestamp('meta_created_time').nullable();

    table.index('meta_leadgen_id');
    table.index('meta_form_id');
    table.index('meta_ad_id');
  });

  const existing = await knex('leads')
    .select('id', 'additional_notes')
    .where('additional_notes', 'like', '%[Meta leadgen_id=%');

  for (const lead of existing) {
    const notes = String(lead.additional_notes || '');
    const leadgenId = notes.match(LEADGEN_MARKER_RE)?.[1] || null;
    const formId = notes.match(FORM_MARKER_RE)?.[1] || null;
    if (!leadgenId && !formId) continue;
    await knex('leads').where({ id: lead.id }).update({
      meta_leadgen_id: leadgenId,
      meta_form_id: formId && formId !== 'desconocido' ? formId : null
    });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropIndex('meta_ad_id');
    table.dropIndex('meta_form_id');
    table.dropIndex('meta_leadgen_id');

    table.dropColumn('meta_created_time');
    table.dropColumn('meta_platform');
    table.dropColumn('meta_campaign_id');
    table.dropColumn('meta_adset_id');
    table.dropColumn('meta_ad_id');
    table.dropColumn('meta_form_id');
    table.dropColumn('meta_leadgen_id');
  });
}
