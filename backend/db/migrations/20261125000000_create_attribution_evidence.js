/**
 * El origen de un lead pasa a ser un **sello**, y queda escrito con qué
 * evidencia se lo supo.
 *
 * El error que esto viene a cerrar estaba medido y corría solo. La importación
 * de leads de TikTok, cuando no encontraba la ficha por el `lead_id` del envío,
 * la buscaba por los **últimos 9 dígitos del teléfono** y, si daba con una, le
 * escribía campaña, grupo y anuncio. Como `leadOrigin()` preguntaba por las
 * columnas `tiktok_*` antes que por las demás, cualquier ficha que recibiera un
 * `tiktok_lead_id` por esa vía pasaba a ser "TikTok" en todas las hojas de
 * marketing y tapaba su origen real —el formulario de Meta o el clic que abrió
 * la conversación—. Y no era un botón que alguien aprieta mirando el resultado:
 * la conciliación diaria (`leadReconciliationSweep`) corre con `apply: true`,
 * así que eso se escribía sin supervisión, todos los días.
 *
 * Que TikTok reporte 21 leads y el CRM tenga 21 fichas del mismo corte no
 * empareja ninguna de las 21 con ninguna de las otras. **Coincidir no es
 * identificar**, y de estos números cuelga el reparto del presupuesto.
 *
 * Lo que se agrega:
 *
 *  - `origin_platform`: la plataforma de la que salió el lead, escrita UNA vez
 *    cuando la ficha nace y no vuelta a tocar nunca — un sello, como
 *    `sales_funnel_at` o `setter_user_id`. Lo que llegue después se informa
 *    aparte (`secondary` en `leadOrigin()`) en vez de reescribir la historia.
 *
 *  - `attribution_method` / `attribution_confidence`: CÓMO se emparejó el envío
 *    de la plataforma con esta ficha, y cuánto vale esa evidencia. Solo la
 *    confianza alta —el id que emitió la plataforma, el marcador que quedó en
 *    las notas, la recepción del webhook— habilita escribir campaña, grupo y
 *    anuncio. El teléfono sigue sirviendo para no duplicar a una persona, que
 *    es otro problema: dos fichas de la misma persona son un estorbo, una ficha
 *    con la plataforma equivocada es un presupuesto mal repartido.
 *
 *  - `attribution_reconciled_at`: cuándo se comparó esta ficha contra la
 *    plataforma. Se escribe incluso cuando la atribución NO se pudo resolver,
 *    porque "ya se la miró y quedó pendiente" es distinto de "nunca se la
 *    miró", y esa es la diferencia entre un pendiente y un agujero que nadie
 *    vio.
 *
 *  - `attribution_conflicts`: los emparejamientos que necesitan que los
 *    resuelva una persona. Un sufijo de teléfono que da con dos fichas no es un
 *    fallo del que haya que recuperarse eligiendo una: es un caso sin resolver,
 *    y elegir "la más reciente" es una moneda al aire.
 *
 * ---------------------------------------------------------------------------
 * Por qué esta migración es IDEMPOTENTE y por qué congela su lista de columnas
 * ---------------------------------------------------------------------------
 *
 * Las dos cosas salieron del mismo fallo, en producción, el 01/11/2026.
 *
 * La primera versión hacía el backfill con `.select('id', ...LEAD_ORIGIN_COLUMNS)`,
 * importando esa constante de `leadOrigin.js` para no repetir la lista. Después
 * se le agregaron a esa constante las columnas de Smart+ (`tiktok_parent_ad_id`
 * y compañía), que las crea una migración **posterior** — así que esta empezó a
 * pedirle a MySQL columnas que todavía no existían y murió con "Unknown column".
 *
 * La regla, entonces: **una migración puede importar funciones puras pero nunca
 * una lista de columnas**. La función es la lógica y conviene que sea una sola
 * (una copia en la migración dice lo viejo el día que alguien corrija la
 * original); la lista de columnas es una foto del esquema EN ESTE PUNTO de la
 * historia, y por definición no puede venir de un archivo que sigue creciendo.
 * De ahí `BACKFILL_COLUMNS`, escrita acá y congelada.
 *
 * Y la segunda: en MySQL el DDL **no es transaccional**. Cuando el backfill
 * falló, las cuatro columnas ya estaban agregadas y knex no pudo deshacerlas,
 * pero tampoco registró la migración como aplicada. El reintento chocó contra
 * "Duplicate column name 'origin_platform'" y quedó trabado sin forma de
 * avanzar ni de volver atrás. Por eso cada paso pregunta antes de hacer: una
 * migración que puede morir a la mitad tiene que poder continuar desde donde
 * quedó, o la única salida es tocar la base a mano.
 */
import { leadOrigin } from '../../services/leadOrigin.js';
import { ATTRIBUTION_METHODS, confidenceFor } from '../../services/attributionEvidence.js';

/** Cuántos leads se traen por vuelta: la tabla entera no entra en memoria. */
const LOTE = 500;

/**
 * Las columnas de `leads` con las que se resuelve el origen **en este punto de
 * la historia del esquema**.
 *
 * Congelada a propósito: ver la nota del encabezado. Son las que existen
 * después de `20261031` (atribución de Meta), `20261121` (atribución de TikTok)
 * y `20261123` (los nombres de anuncio y el Click-to-WhatsApp). Las de Smart+
 * llegan recién en `20261127` y no pueden estar acá.
 *
 * `leadOrigin()` lee las que no estén como `undefined`, que es exactamente lo
 * que corresponde: al sellar una ficha histórica no se puede saber algo que el
 * CRM todavía no guardaba.
 */
const BACKFILL_COLUMNS = [
  'source',
  'created_at',
  'meta_leadgen_id', 'meta_form_id', 'meta_ad_id', 'meta_adset_id', 'meta_campaign_id',
  'meta_platform', 'meta_created_time',
  'meta_ad_name', 'meta_adset_name', 'meta_campaign_name',
  'tiktok_lead_id', 'tiktok_page_id', 'tiktok_ad_id', 'tiktok_adgroup_id', 'tiktok_campaign_id',
  'tiktok_created_time',
  'tiktok_ad_name', 'tiktok_adgroup_name', 'tiktok_campaign_name',
  'ctwa_ad_id', 'ctwa_clid', 'ctwa_source_type', 'ctwa_headline', 'ctwa_created_time'
];

/** Las columnas nuevas, con su definición, para poder agregar solo las que falten. */
const NUEVAS = [
  // Los cinco valores de `PLATFORMS` en `leadOrigin.js` ("Meta", "TikTok",
  // "Orgánico", "Referido", "Otro"). Se guarda el texto que lee marketing y no
  // un código, porque es el mismo vocabulario de la hoja exportada.
  ['origin_platform', (table) => table.string('origin_platform', 20).nullable()],
  ['attribution_method', (table) => table.string('attribution_method', 24).nullable()],
  ['attribution_confidence', (table) => table.string('attribution_confidence', 10).nullable()],
  ['attribution_reconciled_at', (table) => table.timestamp('attribution_reconciled_at').nullable()]
];

/**
 * ¿Existe este índice?
 *
 * Knex no tiene `hasIndex`, y agregar uno que ya está es un error — lo mismo
 * que pasó con las columnas. Se pregunta a `information_schema` con el nombre
 * que knex le pone por convención (`<tabla>_<columna>_index`).
 */
async function hasIndex(knex, tabla, indice) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tabla, indice]
  );
  return rows.length > 0;
}

/**
 * Con qué evidencia nació la atribución que esta ficha ya tiene.
 *
 * Los ids de envío (`leadgen_id`, `lead_id`) y el click id del `referral` son
 * identificadores que emitió la plataforma: no se llega a ellos por descarte.
 * Una ficha sin ninguno de los tres no tiene atribución que respaldar, y ahí el
 * método queda en null — que es información, no un hueco.
 */
function metodoHistorico(lead) {
  if (lead.tiktok_lead_id || lead.meta_leadgen_id) return ATTRIBUTION_METHODS.platformLeadId;
  if (lead.ctwa_clid) return ATTRIBUTION_METHODS.webhook;
  return null;
}

export async function up(knex) {
  /*
   * Paso 1: las columnas, una por una y solo las que falten. Agregarlas en un
   * solo `alterTable` es más rápido, pero si una ya está el ALTER entero falla
   * y las otras tres no entran — que es exactamente cómo quedó trabada la
   * corrida del 01/11/2026.
   */
  for (const [nombre, definir] of NUEVAS) {
    if (await knex.schema.hasColumn('leads', nombre)) continue;
    await knex.schema.alterTable('leads', definir);
  }

  for (const columna of ['origin_platform', 'attribution_confidence']) {
    const indice = `leads_${columna}_index`;
    if (await hasIndex(knex, 'leads', indice)) continue;
    await knex.schema.alterTable('leads', (table) => table.index(columna));
  }

  // Paso 2: la tabla de pendientes.
  if (!(await knex.schema.hasTable('attribution_conflicts'))) {
    await knex.schema.createTable('attribution_conflicts', (table) => {
      table.increments('id').primary();

      // "Meta" o "TikTok": de qué plataforma venía el envío que no se pudo
      // emparejar.
      table.string('platform', 20).notNullable();
      /*
       * El id del envío en la plataforma (`lead_id` de TikTok, `leadgen_id` de
       * Meta). Es la llave con la que este pendiente se reconoce entre
       * corridas: sin ella, cada pasada de la conciliación diaria volvería a
       * anotar el mismo caso y la lista de pendientes crecería sola.
       */
      table.string('platform_lead_id', 64).nullable();
      // Los últimos 9 dígitos con los que se buscó, para poder reproducir el
      // caso sin guardar el teléfono completo en una tabla de diagnóstico.
      table.string('phone_key', 16).nullable();

      // `CONFLICT_REASONS` en `attributionEvidence.js`.
      table.string('reason', 32).notNullable();
      // Los ids de las fichas candidatas, como JSON. Son los que una persona
      // tiene que abrir para decidir.
      table.text('candidate_lead_ids').nullable();
      /*
       * La atribución que NO se escribió, tal como la mandó la plataforma. Se
       * guarda porque es lo que hay que aplicar si alguien resuelve el caso a
       * favor de una ficha: sin esto habría que volver a pedirle los datos a la
       * API, y TikTok conserva los leads de un formulario solo 90 días.
       */
      table.text('payload').nullable();

      table.timestamp('detected_at').defaultTo(knex.fn.now());
      table.timestamp('resolved_at').nullable();
      table.integer('resolved_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      // 'adjuntado' | 'descartado' | 'ficha_nueva'
      table.string('resolution', 20).nullable();
      table.string('notes', 500).nullable();

      /*
       * Un envío no genera dos pendientes. MySQL admite varios NULL en un
       * índice único, así que un conflicto sin id de plataforma (un formulario
       * sin celular ni lead_id legible) se sigue pudiendo anotar más de una vez
       * — es el caso raro y vale más anotarlo dos veces que perderlo.
       */
      table.unique(['platform', 'platform_lead_id']);
      table.index('reason');
      table.index('resolved_at');
    });
  }

  /*
   * Paso 3: sellado de lo que ya existe. Se recorre por lotes y por id
   * ascendente para que la migración no cargue la tabla entera ni dependa del
   * orden del motor.
   *
   * Solo las fichas SIN sello, y eso es más que una optimización del
   * reintento: el sello se escribe una vez y no se reescribe nunca, así que
   * volver a pasar por encima de una ya sellada sería romper justo la regla que
   * esta migración viene a establecer.
   */
  let ultimoId = 0;
  let sellados = 0;
  let conflictos = 0;

  for (;;) {
    const leads = await knex('leads')
      .select('id', ...BACKFILL_COLUMNS)
      .whereNull('origin_platform')
      .where('id', '>', ultimoId)
      .orderBy('id', 'asc')
      .limit(LOTE);
    if (!leads.length) break;

    for (const lead of leads) {
      const origin = leadOrigin(lead);
      const method = metodoHistorico(lead);

      await knex('leads').where({ id: lead.id }).update({
        origin_platform: origin.platform,
        attribution_method: method,
        attribution_confidence: confidenceFor(method),
        /*
         * A propósito en null: estas fichas se sellaron con lo que ya tenían
         * guardado, no comparándolas contra la plataforma. Poner la fecha de
         * hoy haría creer que las 400 fichas históricas se conciliaron en el
         * minuto en que corrió la migración.
         */
        attribution_reconciled_at: null
      });
      sellados++;
      if (origin.conflict) conflictos++;
    }

    ultimoId = leads[leads.length - 1].id;
  }

  if (sellados) {
    console.log(`✅ [Migración] Origen sellado en ${sellados} lead(s).`);
    if (conflictos) {
      console.log(`⚠️  [Migración] ${conflictos} lead(s) tienen atribución de más de una plataforma: `
        + 'el origen quedó en la más antigua y el resto se informa como secundario '
        + '(columna "Plataforma secundaria" de la hoja "Ruta de leads").');
    }
  } else {
    console.log('✅ [Migración] No había leads sin sellar.');
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('attribution_conflicts');

  /*
   * Simétrico con `up()`: se quita solo lo que esté. Un `down` que asume el
   * estado completo es un `down` que no se puede correr después de un `up` que
   * murió a la mitad, y entonces no sirve para lo único que existe.
   */
  for (const columna of ['origin_platform', 'attribution_confidence']) {
    const indice = `leads_${columna}_index`;
    if (await hasIndex(knex, 'leads', indice)) {
      await knex.schema.alterTable('leads', (table) => table.dropIndex(columna));
    }
  }

  for (const [nombre] of [...NUEVAS].reverse()) {
    if (!(await knex.schema.hasColumn('leads', nombre))) continue;
    await knex.schema.alterTable('leads', (table) => table.dropColumn(nombre));
  }
}
