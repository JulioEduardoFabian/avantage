/**
 * La jerarquía de las campañas **Smart+** de TikTok, que el CRM no sabía
 * representar.
 *
 * Una campaña Smart+ no tiene un anuncio y una pieza: tiene un anuncio **padre**
 * y, debajo, piezas creativas que TikTok combina y rota sola. Eso rompe el
 * supuesto sobre el que está construido el resto del reporte —"un lead viene de
 * un anuncio, y ese anuncio tiene un gasto"— de una manera que no se ve: el
 * gasto se reporta al padre y, según el endpoint, la descarga de leads puede
 * traer el padre, la pieza, o ninguno de los dos.
 *
 * Hasta ahora el CRM guardaba un solo `tiktok_ad_id`, así que de un lead de
 * Smart+ no se podía decir qué pieza lo trajo **ni se podía decir que no se
 * sabía**: salía como un lead de ese anuncio, igual que uno de una campaña
 * simple. Las columnas que se agregan son las que permiten distinguir las dos
 * situaciones.
 *
 *  - `tiktok_parent_ad_id`: el anuncio padre, que es el nivel en el que TikTok
 *    reporta el GASTO. De ahí cuelga que el costo por cita y por venta se
 *    calculen contra el mismo objeto del que se conoce la inversión: con el
 *    gasto en el padre y las citas en la pieza, la división no da el costo de
 *    nada.
 *  - `tiktok_creative_id` y `tiktok_video_id`: la pieza y el archivo, que **no
 *    son lo mismo** —un mismo video vive en varias piezas y una pieza puede
 *    cambiar de anuncio—. Van en columnas separadas porque mezclarlos hace que
 *    "el video que mejor convierte" y "el anuncio que mejor convierte" devuelvan
 *    respuestas distintas sin que se sepa cuál es cuál.
 *  - `tiktok_video_name`: el nombre del video, que tampoco es el nombre del
 *    anuncio ni el del archivo subido. Se guarda aparte por la misma razón que
 *    el resto de los nombres: se copia al entrar el lead y no se vuelve a
 *    resolver contra las métricas sincronizadas, donde solo están las piezas que
 *    siguen entregando.
 *  - `tiktok_creative_valid_from` / `_to`: la **vigencia** de la pieza. Hace
 *    falta para no dividir el gasto de un período por leads cuya pieza ni
 *    existía entonces, que es la forma más silenciosa de que un costo por lead
 *    salga absurdo y nadie entienda por qué.
 *
 * Todas nacen vacías y no hay backfill posible: TikTok no expone el nivel hijo
 * de Smart+ en esta cuenta hoy (ver `MINIMUM_ACCESS` en `bridgeContract.js`), y
 * el dato histórico no está en ningún lado. Eso es a propósito y no una tarea
 * pendiente mal hecha: la regla es que la pieza quede **desconocida** y no que
 * se infiera por descarte. Si una campaña tiene tres videos y el lead trae solo
 * el id del padre, atribuirlo al video que más impresiones tuvo ese día produce
 * un número que parece cierto, que nadie puede auditar, y del que cuelga cortar
 * una pieza que quizá era la que vendía.
 *
 * Las columnas son `tiktok_*` y no genéricas por la misma razón que el resto de
 * la atribución de TikTok vive aparte de la de Meta: de `meta_leadgen_id`
 * cuelgan la conciliación y el backfill de Meta, que le preguntan a la Graph API
 * por cada id que encuentran.
 *
 * Cada paso pregunta antes de hacer porque en MySQL el DDL **no es
 * transaccional**: una migración que muere a la mitad deja su DDL aplicado y a
 * sí misma sin registrar, y el reintento choca contra "Duplicate column name"
 * sin forma de avanzar ni de volver atrás (pasó el 01/11/2026 con la migración
 * de atribución).
 */

/** Las columnas nuevas, para poder agregar solo las que falten. */
const NUEVAS = [
  // Los ids de TikTok tienen 19 dígitos y viajan como texto: cualquier paso por
  // `Number` les cambia los últimos (ver `leadOrigin.js`).
  ['tiktok_parent_ad_id', (table) => table.string('tiktok_parent_ad_id', 40).nullable()],
  ['tiktok_creative_id', (table) => table.string('tiktok_creative_id', 40).nullable()],
  ['tiktok_video_id', (table) => table.string('tiktok_video_id', 60).nullable()],
  ['tiktok_video_name', (table) => table.string('tiktok_video_name', 255).nullable()],
  ['tiktok_creative_valid_from', (table) => table.timestamp('tiktok_creative_valid_from').nullable()],
  ['tiktok_creative_valid_to', (table) => table.timestamp('tiktok_creative_valid_to').nullable()]
];

/*
 * Se repite en cada migración en vez de vivir en un módulo compartido, y es a
 * propósito: una migración es una foto de un momento del esquema, así que lo
 * que importa de afuera tiene que poder cambiar sin cambiarla.
 */
async function hasIndex(knex, tabla, indice) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tabla, indice]
  );
  return rows.length > 0;
}

export async function up(knex) {
  for (const [nombre, definir] of NUEVAS) {
    if (await knex.schema.hasColumn('leads', nombre)) continue;
    await knex.schema.alterTable('leads', definir);
  }

  /*
   * El índice va en el PADRE y no en la pieza: es el nivel por el que se agrupa
   * para cruzar contra el gasto, y mientras TikTok no entregue el nivel hijo la
   * pieza va a estar vacía en casi todas las filas — un índice sobre una columna
   * vacía cuesta escrituras y no ahorra lecturas.
   */
  if (!(await hasIndex(knex, 'leads', 'leads_tiktok_parent_ad_id_index'))) {
    await knex.schema.alterTable('leads', (table) => table.index('tiktok_parent_ad_id'));
  }
}

export async function down(knex) {
  if (await hasIndex(knex, 'leads', 'leads_tiktok_parent_ad_id_index')) {
    await knex.schema.alterTable('leads', (table) => table.dropIndex('tiktok_parent_ad_id'));
  }

  for (const [nombre] of [...NUEVAS].reverse()) {
    if (!(await knex.schema.hasColumn('leads', nombre))) continue;
    await knex.schema.alterTable('leads', (table) => table.dropColumn(nombre));
  }
}
