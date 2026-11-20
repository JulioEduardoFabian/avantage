/**
 * Atribución de TikTok Lead Generation en columnas propias de `leads`.
 *
 * Hermana de `20261031000000_alter_leads_add_meta_attribution.js` y por las
 * mismas razones, con una diferencia de fondo: los leads de Meta ya existían
 * en el CRM cuando se creó aquella (el webhook los daba de alta desde el
 * principio y lo único que faltaba era sacar la atribución del texto libre),
 * mientras que los de **formulario instantáneo de TikTok nunca llegaron**: no
 * hay webhook, no hay marcador en las notas y no hay una sola ficha que
 * completar. Esta migración abre el hueco donde van a entrar.
 *
 * Por qué columnas propias y no reusar las `meta_*`:
 *
 *  - De `meta_leadgen_id` cuelgan la conciliación de Meta y el backfill, que
 *    le preguntan a la **Graph API** por cada id que encuentran. Un id de
 *    TikTok metido ahí haría que la conciliación de Meta lo reportara para
 *    siempre como "falta en el CRM" y que el backfill gastara una llamada por
 *    lead contra la API equivocada.
 *  - `campaignService` ya trata `meta_ad_id` como "el anuncio de Meta de este
 *    lead" para construir la atribución; mezclarlos obligaría a enseñarle a
 *    cada lectura de qué plataforma es el id que está mirando.
 *
 * `tiktok_created_time` es el momento en que la persona ENVIÓ el formulario en
 * TikTok, que no es `created_at` (cuándo entró acá). La diferencia es la razón
 * de ser de esta importación: los 21 leads del 26 al 30 de octubre de 2026 se
 * dieron de alta el día que se corrió la importación, y tienen que contarse en
 * el día en que la persona los llenó o el reporte no cierra nunca contra el
 * Centro de clientes potenciales de TikTok.
 */
export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    // El id del lead en TikTok. Es la llave de la importación: lo que ya tiene
    // ficha no se vuelve a dar de alta, así que importar dos veces no duplica.
    table.string('tiktok_lead_id', 40).nullable();
    // El formulario instantáneo (la "Instant Page") que la persona llenó.
    table.string('tiktok_page_id', 40).nullable();
    table.string('tiktok_ad_id', 40).nullable();
    table.string('tiktok_adgroup_id', 40).nullable();
    table.string('tiktok_campaign_id', 40).nullable();
    table.timestamp('tiktok_created_time').nullable();

    table.index('tiktok_lead_id');
    table.index('tiktok_page_id');
    table.index('tiktok_ad_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropIndex('tiktok_lead_id');
    table.dropIndex('tiktok_page_id');
    table.dropIndex('tiktok_ad_id');
    table.dropColumn('tiktok_lead_id');
    table.dropColumn('tiktok_page_id');
    table.dropColumn('tiktok_ad_id');
    table.dropColumn('tiktok_adgroup_id');
    table.dropColumn('tiktok_campaign_id');
    table.dropColumn('tiktok_created_time');
  });
}
