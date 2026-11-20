/**
 * El origen de cada lead, completo y guardado en el momento en que entra, más
 * la calificación comercial como dato propio.
 *
 * Marketing cruza la exportación "Ruta de leads" contra el Administrador de
 * anuncios de Meta y el Centro de clientes potenciales de TikTok, y ese cruce
 * no cerraba por tres agujeros, los tres de la misma forma: el CRM sabía el
 * **id** del anuncio pero no su **nombre**, y el nombre lo resolvía después
 * cruzando contra las métricas sincronizadas de la campaña. Un anuncio fuera
 * de la ventana sincronizada, pausado o borrado se quedaba sin nombre, y el
 * lead salía en la hoja como "Sin campaña asignada" aunque su `ad_id`
 * estuviera guardado.
 *
 *  - `meta_*_name` / `tiktok_*_name`: el nombre EXACTO que devuelve la API al
 *    momento del alta. Se copia y no se vuelve a resolver: si en la plataforma
 *    le cambian el nombre al anuncio, el id sigue siendo el mismo y el enlace
 *    es por id — el nombre guardado es el que ese lead tuvo.
 *
 *  - `ctwa_*`: la atribución de un Click-to-WhatsApp. Vivía SOLO en el
 *    `referral` del primer mensaje de la conversación (`whatsapp_messages`),
 *    así que un lead cuyo primer mensaje no se guardó (el webhook responde 200
 *    antes de procesar: un fallo posterior no se reintenta) se quedaba sin
 *    origen para siempre y se leía como orgánico. Es el mismo dato que ya
 *    traía el referral, escrito donde se lo va a leer.
 *
 *  - `qualified` / `qualified_at` / `qualified_by`: la calificación del setter,
 *    en TRES estados (null = nadie la miró todavía). Antes la columna
 *    "Calificado" del exportable se DERIVABA de que el lead hubiera salido de
 *    `nuevo`, así que daba "Sí" en el 100% de los leads (403 de 403 en el
 *    corte del 31/10/2026) y no servía para medir la calidad de un anuncio,
 *    que es justo para lo que se la mira. Vacío por defecto a propósito: un
 *    "No" por defecto haría el mismo daño con el signo cambiado.
 *
 * El `referral` de los leads que ya existen se rescata acá mismo (es el único
 * dato histórico recuperable sin pedirle nada a nadie); los nombres de anuncio
 * de Meta los completa el backfill de la conciliación, que es el que tiene el
 * token para preguntárselos a la Graph API.
 */
const PHONE_KEY_SQL = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9)";

function parseReferral(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

export async function up(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.string('meta_ad_name', 255).nullable();
    table.string('meta_adset_name', 255).nullable();
    table.string('meta_campaign_name', 255).nullable();

    table.string('tiktok_ad_name', 255).nullable();
    table.string('tiktok_adgroup_name', 255).nullable();
    table.string('tiktok_campaign_name', 255).nullable();

    // El anuncio del que salió el clic que abrió la conversación. Es el mismo
    // valor que el `ad_id` de un formulario, así que los dos caminos de Meta
    // caen en la misma fila de `campaign_ads` (ver `campaignService`).
    table.string('ctwa_ad_id', 40).nullable();
    // El click id con el que Meta reconoce el clic en la Conversions API.
    table.string('ctwa_clid', 255).nullable();
    table.string('ctwa_source_type', 20).nullable();
    table.string('ctwa_headline', 255).nullable();
    table.timestamp('ctwa_created_time').nullable();

    // Tres estados: null = sin calificar, 1 = sí, 0 = no.
    table.boolean('qualified').nullable();
    table.timestamp('qualified_at').nullable();
    table.integer('qualified_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');

    table.index('ctwa_ad_id');
  });

  /*
   * Rescate del referral histórico. Se recorre el PRIMER mensaje con referral
   * de cada conversación y se escribe en el lead que le corresponde por los
   * ÚLTIMOS 9 DÍGITOS del teléfono, el mismo criterio de
   * `leadService.findByPhone()`: el `wa_id` llega como lo manda Meta
   * ("51987654321") y el teléfono del lead como lo escribió quien llenó el
   * formulario ("+51 987 654 321").
   *
   * Un `wa_id` que no es un teléfono —los Business-Scoped User ID tipo
   * "PE.2379096279586501" de quien escribe desde un anuncio sin compartir su
   * número— no tiene últimos 9 dígitos con los que cruzar, así que se busca
   * además por la cadena exacta, que es lo que ese lead tiene en `phone`.
   */
  const rows = await knex('whatsapp_messages')
    .whereNotNull('referral')
    .andWhere('direction', 'inbound')
    .orderBy('received_at', 'asc')
    .select('wa_id', 'referral', 'received_at');

  const primeroPorWaId = new Map();
  for (const row of rows) {
    if (primeroPorWaId.has(row.wa_id)) continue;
    const referral = parseReferral(row.referral);
    if (!referral) continue;
    primeroPorWaId.set(row.wa_id, { referral, receivedAt: row.received_at });
  }

  let rescatados = 0;
  for (const [waId, { referral, receivedAt }] of primeroPorWaId) {
    const sourceType = referral.source_type || referral.sourceType || null;
    const sourceId = referral.source_id || referral.sourceId || null;
    const clid = referral.ctwa_clid || referral.ctwaClid || null;
    if (!sourceId && !clid) continue;

    const digits = String(waId).replace(/[^0-9]/g, '');
    const key = digits.length >= 9 ? digits.slice(-9) : null;

    const afectados = await knex('leads')
      .where((q) => {
        q.where('leads.phone', waId);
        if (key) q.orWhereRaw(`${PHONE_KEY_SQL} = ?`, [key]);
      })
      .whereNull('ctwa_ad_id')
      .whereNull('ctwa_clid')
      .update({
        ctwa_ad_id: sourceType === 'ad' && sourceId ? String(sourceId).slice(0, 40) : null,
        ctwa_clid: clid ? String(clid).slice(0, 255) : null,
        ctwa_source_type: sourceType ? String(sourceType).slice(0, 20) : null,
        ctwa_headline: referral.headline ? String(referral.headline).slice(0, 255) : null,
        ctwa_created_time: receivedAt || null
      });
    rescatados += afectados;
  }

  if (rescatados) {
    console.log(`✅ [Migración] Atribución de Click-to-WhatsApp rescatada en ${rescatados} lead(s).`);
  }
}

export async function down(knex) {
  await knex.schema.alterTable('leads', (table) => {
    table.dropIndex('ctwa_ad_id');
    table.dropForeign('qualified_by');

    table.dropColumn('qualified_by');
    table.dropColumn('qualified_at');
    table.dropColumn('qualified');
    table.dropColumn('ctwa_created_time');
    table.dropColumn('ctwa_headline');
    table.dropColumn('ctwa_source_type');
    table.dropColumn('ctwa_clid');
    table.dropColumn('ctwa_ad_id');
    table.dropColumn('tiktok_campaign_name');
    table.dropColumn('tiktok_adgroup_name');
    table.dropColumn('tiktok_ad_name');
    table.dropColumn('meta_campaign_name');
    table.dropColumn('meta_adset_name');
    table.dropColumn('meta_ad_name');
  });
}
