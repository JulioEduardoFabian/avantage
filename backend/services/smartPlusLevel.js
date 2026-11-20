/**
 * En qué nivel de la jerarquía de TikTok está lo que sabemos de un lead, y qué
 * se puede afirmar con eso.
 *
 * Las campañas **Smart+** de TikTok no tienen un anuncio y una pieza: tienen un
 * anuncio *padre* y, debajo, piezas creativas que la plataforma combina y rota
 * sola. Eso rompe el supuesto sobre el que está construido el resto del reporte
 * —"un lead viene de un anuncio, y ese anuncio tiene un gasto"— de una manera
 * que no se ve: el gasto se reporta al **padre** y, según el endpoint, la
 * descarga de leads puede traer el padre, la pieza, o ninguno de los dos.
 *
 * El error que hay que no cometer es el mismo de siempre: **inferir la pieza por
 * descarte**. Si una campaña tiene tres videos y el lead trae solo el id del
 * padre, es tentador atribuirlo al video que más impresiones tuvo ese día. Eso
 * produce un número que parece cierto, que nadie puede auditar, y del que cuelga
 * la decisión de cortar una pieza que quizá era la que vendía.
 *
 * La regla, entonces:
 *
 *  - Lo que se puede afirmar se afirma, **en el nivel en que se sabe**. Si solo
 *    llega el padre, el costo por cita y por venta se reportan **al padre** —que
 *    es además el nivel en que TikTok reporta el gasto, así que ahí los dos
 *    lados de la división hablan del mismo objeto— y la pieza queda
 *    `desconocida`.
 *  - Lo que no se sabe se dice. `desconocida` es un valor, no un hueco: un
 *    reporte que lo muestra permite ir a buscar el acceso que falta; uno que lo
 *    rellena, no.
 *
 * Y tres identificadores que **no son lo mismo** y que se confundían en uno:
 * el **anuncio** (`ad_id`, lo que compra el presupuesto), la **pieza creativa**
 * (`creative_id`, la combinación que TikTok armó) y el **video** (`video_id`, el
 * archivo subido). Un mismo video vive en varias piezas y una pieza puede
 * cambiar de anuncio; mezclarlos hace que "el video que mejor convierte" y "el
 * anuncio que mejor convierte" devuelvan respuestas distintas sin que se sepa
 * cuál es cuál. El nombre del **archivo** tampoco es ninguno de los tres.
 *
 * Es puro y no toca la base ni la API.
 */

/** En qué nivel se conoce el origen de un lead de TikTok. */
export const LEVELS = {
  /** Se sabe la pieza creativa concreta. */
  pieza: 'pieza',
  /** Se sabe el anuncio padre y no la pieza: lo normal en Smart+ hoy. */
  padre: 'padre',
  /** No se sabe ninguno de los dos. */
  desconocido: 'desconocido'
};

/**
 * El nivel en el que TikTok reporta el **gasto**.
 *
 * Está escrito como constante y no como comentario porque es la mitad de la
 * división: el costo por cita es gasto ÷ citas, y si el gasto está en el padre y
 * las citas en la pieza, el resultado no es un costo de nada. Mientras esto
 * diga `padre`, todo costo por etapa se reporta al padre.
 */
export const SPEND_LEVEL = LEVELS.padre;

const text = (value) => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
};

/**
 * Lo que se sabe de la creatividad de un lead de TikTok.
 *
 * `attributionLevel` es el nivel en el que se puede atribuir de verdad, y
 * `attributionAdId` el id con el que hay que hacerlo: con la pieza conocida, la
 * pieza; sin ella, el padre. Nunca se devuelve un id "elegido" entre varios
 * candidatos.
 *
 * `vigencia` es la ventana en la que esa pieza estuvo entregando. Hace falta
 * para no comparar un lead contra el gasto de un período en el que su pieza ni
 * existía, que es la forma más silenciosa de que un costo por lead salga
 * ridículamente bajo o alto.
 */
export function creativeOf(lead = {}) {
  const parentAdId = text(lead.tiktok_parent_ad_id);
  const adId = text(lead.tiktok_ad_id);
  const creativeId = text(lead.tiktok_creative_id);
  const videoId = text(lead.tiktok_video_id);

  /*
   * El padre es el que se declaró como tal y, si no hay ninguno, el `ad_id` a
   * secas: en una campaña que NO es Smart+ el anuncio es su propio padre, y
   * tratarlo como "sin padre" dejaría sin atribución a la mayoría de los leads
   * por una distinción que a ellos no les aplica.
   */
  const padre = parentAdId || adId;

  const level = creativeId || videoId
    ? LEVELS.pieza
    : padre ? LEVELS.padre : LEVELS.desconocido;

  return {
    parentAdId: padre,
    creativeId,
    videoId,
    /*
     * Los tres nombres, separados. El del anuncio es lo que compra el
     * presupuesto, el del video es el archivo subido, y no son el mismo texto
     * aunque en una campaña simple coincidan. Mezclarlos hace que "el video que
     * mejor convierte" y "el anuncio que mejor convierte" den respuestas
     * distintas sin que se sepa cuál es cuál.
     */
    adName: text(lead.tiktok_ad_name),
    videoName: text(lead.tiktok_video_name),

    level,
    /*
     * Con qué id se atribuye. Sin pieza conocida se atribuye al PADRE, que es
     * además donde TikTok reporta el gasto: así los dos lados de la división
     * hablan del mismo objeto.
     */
    attributionLevel: level === LEVELS.pieza ? LEVELS.pieza : level,
    attributionAdId: level === LEVELS.pieza ? (creativeId || videoId) : padre,
    /*
     * La pieza se declara desconocida en vez de inferirse. Un reporte que lo
     * muestra permite ir a buscar el acceso que falta; uno que lo rellena con el
     * video que más impresiones tuvo ese día, no — y de ese número cuelga cortar
     * una pieza que quizá era la que vendía.
     */
    pieceKnown: level === LEVELS.pieza,
    vigencia: {
      desde: lead.tiktok_creative_valid_from || null,
      hasta: lead.tiktok_creative_valid_to || null
    }
  };
}

/**
 * Cómo se nombra el nivel en una hoja o una pantalla.
 *
 * `-` no sirve acá: este campo no es "no corresponde" sino "no lo sabemos", que
 * es información y es lo que marketing va a ir a buscar.
 */
export function levelLabel(level) {
  if (level === LEVELS.pieza) return 'Pieza creativa';
  if (level === LEVELS.padre) return 'Anuncio padre (pieza desconocida)';
  return 'Desconocido';
}

/**
 * ¿Este lead cae dentro de la vigencia de su pieza?
 *
 * Devuelve `null` cuando no se puede saber —sin vigencia guardada no hay nada
 * que comprobar— y eso es distinto de `false`. Sirve para no dividir el gasto
 * de un período por leads cuya pieza ni existía entonces, que es la forma más
 * silenciosa de que un costo por lead salga absurdo.
 */
export function withinValidity(lead = {}, at = null) {
  const { vigencia } = creativeOf(lead);
  if (!vigencia.desde && !vigencia.hasta) return null;

  const cuando = at || lead.tiktok_created_time || lead.created_at;
  if (!cuando) return null;

  const ts = new Date(cuando).getTime();
  if (Number.isNaN(ts)) return null;

  if (vigencia.desde && ts < new Date(vigencia.desde).getTime()) return false;
  if (vigencia.hasta && ts > new Date(vigencia.hasta).getTime()) return false;
  return true;
}

/** Las columnas de `leads` que hacen falta para resolver la creatividad. */
export const SMART_PLUS_COLUMNS = [
  'tiktok_parent_ad_id',
  'tiktok_creative_id',
  'tiktok_video_id',
  'tiktok_video_name',
  'tiktok_creative_valid_from',
  'tiktok_creative_valid_to'
];
